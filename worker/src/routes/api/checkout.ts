import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { formatMoney, isNoEmail, MAX_PROOF_IMAGE_BYTES, readSslLogo, type Channel, type QuoteDTO } from "@mawah/shared";
import type { AppEnv, Ctx, StudentCtx } from "../../env";
import { audit } from "../../lib/audit";
import { first, nowIso, run } from "../../lib/db";
import { HttpError, ok, parseBody } from "../../lib/http";
import { manualPaymentReceivedMail } from "../../lib/mailer";
import { toMe } from "../../lib/me";
import { addressSchema, langSchema, nameSchema, optionalEmailSchema, requiredPhoneSchema, turnstileField } from "../../lib/schemas";
import { proofReceivedSms } from "../../lib/smsText";
import { createSession } from "../../lib/session";
import { getSettings } from "../../lib/settings";
import { verifyTurnstile } from "../../lib/turnstile";
import { loadStudent, requireStudent } from "../../middleware/auth";
import { rateLimit } from "../../middleware/ratelimit";
import { buildQuote, cancelReplacedManualOrders, closeOrder, createOrder, markOrderPaid, notifyProof, saveProofImage, submitManualProof, type ManualProof, type Quote } from "../../services/orders";
import { resolveGuestAccount } from "../../services/guests";
import { tellStudent } from "../../services/studentMessages";
import { notices, notifyOwner } from "../../services/notify";
import { availableChannels, manualPayInfo } from "../../services/payments";
import { bkashCreate } from "../../services/payments/bkash";
import { rememberSsl, sslInit } from "../../services/payments/sslcommerz";

/**
 * Checkout. Seeing the price (/quote) and buying as a visitor (/guest) need no account — that is the point: a buyer who is sent to a log-in
 * page first is a buyer lost. Everything that touches an existing order (proof, screenshot) needs the student who owns it.
 */
export const checkoutRoutes = new Hono<AppEnv>();
checkoutRoutes.use("*", rateLimit("RL_CHECKOUT"));

const cartSchema = z
  .object({
    courses: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    bundle_id: z.coerce.number().int().positive().optional(),
    coupon: z.string().trim().max(40).optional(),
  })
  .refine((d) => !!d.bundle_id || !!d.courses?.length, { message: "required", path: ["courses"] });

const TRX_ID = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,24}$/, "invalid_trx");

const checkoutSchema = z.object({
  courses: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  bundle_id: z.coerce.number().int().positive().optional(),
  coupon: z.string().trim().max(40).optional(),
  channel: z.enum(["sslcommerz", "bkash", "manual", "mock"]).optional(),
  // a signed-in student whose profile has no mobile number or address yet gives them here; they are kept on the profile
  details: z.object({ phone: requiredPhoneSchema.optional(), address: addressSchema.optional() }).optional(),
  manual: z
    .object({
      method: z.enum(["bkash", "nagad", "rocket"], { error: "required" }),
      payer_number: z.string().trim().regex(/^(?:\+?88)?01[3-9]\d{8}$/, "invalid_phone"),
      // left out when the student is only starting: they pay first and send the TrxID / screenshot to the open order afterwards
      trx_id: TRX_ID.optional(),
    })
    .optional(),
});

/** The same, from someone who is not signed in: who they are comes with it. Name, mobile number and address are needed; the e-mail is up to them. */
const guestSchema = checkoutSchema.extend({
  name: nameSchema,
  email: optionalEmailSchema,
  phone: requiredPhoneSchema,
  address: addressSchema,
  lang: langSchema.optional().default("bn"),
  turnstile: turnstileField,
});

const proofSchema = z.object({ trx_id: TRX_ID.optional() });

type Cart = z.output<typeof checkoutSchema>;

function toQuoteDTO(q: Quote, channels: Channel[], settings: Awaited<ReturnType<typeof getSettings>>): QuoteDTO {
  return {
    items: q.items,
    subtotal: q.subtotal,
    discount: q.discount,
    total: q.total,
    coupon_code: q.coupon?.code ?? null,
    bundle_id: q.bundle_id,
    channels: q.total === 0 ? [] : channels,
    manual: channels.includes("manual") ? manualPayInfo(settings) : null,
    ssl_logo: q.total > 0 && channels.includes("sslcommerz") ? (readSslLogo(settings.payments.ssl_logo)?.src ?? null) : null,
  };
}

checkoutRoutes.post("/quote", loadStudent, async (c) => {
  const body = await parseBody(c, cartSchema);
  const student = c.get("student");
  const [quote, settings] = await Promise.all([
    buildQuote(c.env, { studentId: student?.id ?? null, courseSlugs: body.courses, bundleId: body.bundle_id, coupon: body.coupon }),
    getSettings(c.env),
  ]);
  return ok(c, { quote: toQuoteDTO(quote, availableChannels(c.env, settings), settings) });
});

interface Prepared {
  settings: Awaited<ReturnType<typeof getSettings>>;
  quote: Quote;
  channel: Channel | "free";
}

/** Price the basket and check the way of paying — before anything is created. `studentId` null = nobody yet (nothing owned, no earlier coupon use). */
async function prepare(c: Ctx, body: Cart, studentId: number | null): Promise<Prepared> {
  if (!body.bundle_id && !body.courses?.length) throw new HttpError(422, "validation", "validation", { courses: "required" });
  const settings = await getSettings(c.env);
  const quote = await buildQuote(c.env, { studentId, courseSlugs: body.courses, bundleId: body.bundle_id, coupon: body.coupon });
  // free (price 0 or a 100% coupon): no payment step
  if (quote.total === 0) return { settings, quote, channel: "free" };
  const channel = body.channel;
  if (!channel || !availableChannels(c.env, settings).includes(channel)) throw new HttpError(400, "payment_unavailable");
  // a send-money payment says which number it is paid from; the TrxID / screenshot come afterwards
  if (channel === "manual" && !body.manual) throw new HttpError(422, "validation", "validation", { payer_number: "required" });
  return { settings, quote, channel };
}

/** Make the order and start the payment. `extra` is added to the answer (a new visitor's account, so the app can show them signed in). */
async function place(c: Ctx, student: StudentCtx, body: Cart, p: Prepared, extra: object) {
  const { quote, settings, channel } = p;

  // ---- free: no payment step, enrolled immediately ----
  if (channel === "free") {
    const order = await createOrder(c.env, student, quote, "free");
    await markOrderPaid(c.env, order.id, { gateway: "free", method: "free", waitUntil: (job) => c.executionCtx.waitUntil(job) });
    await audit(c, { action: "checkout.free", entity: "order", entityId: order.id });
    return ok(c, { order: { public_id: order.public_id, status: "paid", total: 0 }, ...extra }, 201);
  }

  // ---- manual send-money: the student states which number they pay from and gets a payment window; they then pay and send the TrxID
  //      and/or a screenshot (POST /:publicId/proof); staff verify and enrollment follows ----
  if (channel === "manual") {
    const proof: ManualProof = { ...body.manual!, payer_number: body.manual!.payer_number.replace(/^\+?88/, "") };
    // starting again replaces the student's own unpaid manual order for the same class(es)
    await cancelReplacedManualOrders(c.env, student.id, quote.items.map((i) => i.course_id));
    const order = await createOrder(c.env, student, quote, "manual", proof, settings.payments.manual_window_min);
    const withProof = !!proof.trx_id;
    await audit(c, { action: withProof ? "checkout.manual_submitted" : "checkout.manual_started", entity: "order", entityId: order.id, meta: { method: proof.method } });
    if (withProof) {
      const mail = manualPaymentReceivedMail(student.locale, { name: student.name, total: formatMoney(quote.total, student.locale) });
      c.executionCtx.waitUntil(tellStudent(c.env, student, { mail, sms: proofReceivedSms(student.locale, { total: quote.total }) }, { capped: true }).then(() => undefined));
      c.executionCtx.waitUntil(notifyProof(c.env, order.id));
    }
    const created = await first<{ pay_by: string }>(c.env.DB, "SELECT pay_by FROM orders WHERE id = ?", order.id);
    return ok(c, { order: { public_id: order.public_id, status: withProof ? "awaiting_verification" : "pending", total: quote.total, pay_by: created?.pay_by ?? null }, ...extra }, 201);
  }

  const order = await createOrder(c.env, student, quote, channel);
  const summary = quote.items.map((i) => i.title_en).join(", ");
  try {
    let redirectUrl: string;
    if (channel === "sslcommerz") {
      // the gateway wants an e-mail address: a buyer who gave none is sent through with the shop's own
      const gatewayEmail = isNoEmail(student.email) ? c.env.NOTIFY_EMAIL?.trim() || "customer@mawahacademy.com" : student.email;
      const r = await sslInit(c.env, { public_id: order.public_id, total: quote.total }, { name: student.name, email: gatewayEmail, phone: student.phone ?? "", address: student.address ?? "" }, summary);
      await rememberSsl(c.env, r, "checkout");
      if (!r.ok) {
        // SSLCommerz said no. The student is told plainly (and offered the other way of paying); the owner gets the gateway's own words — in the
        // activity log, by e-mail and in Settings → Payments — because that sentence is what tells "wrong keys" from "wrong website address"
        await audit(c, { action: "checkout.gateway_failed", entity: "order", entityId: order.id, summary: `sslcommerz: ${r.problem}`, meta: { problem: r.problem, status: r.status ?? null, said: r.detail } });
        c.executionCtx.waitUntil(notifyOwner(c.env, notices.paymentFailed({ student: student.name, phone: student.phone ?? null, items: quote.items.map((i) => i.title_en), total: quote.total, problem: r.problem, said: r.detail })));
        throw new HttpError(502, "gateway_error");
      }
      redirectUrl = r.redirectUrl;
      await run(c.env.DB, "UPDATE orders SET gateway_ref = ? WHERE id = ?", r.sessionKey, order.id);
    } else if (channel === "bkash") {
      const r = await bkashCreate(c.env, { public_id: order.public_id, total: quote.total }, isNoEmail(student.email) ? (student.phone ?? "student") : student.email);
      redirectUrl = r.redirectUrl;
      await run(c.env.DB, "UPDATE orders SET gateway_ref = ? WHERE id = ?", r.paymentId, order.id);
    } else {
      redirectUrl = `/api/payments/mock/pay/${order.public_id}`;
    }
    await audit(c, { action: "checkout.started", entity: "order", entityId: order.id, summary: channel });
    return ok(c, { order: { public_id: order.public_id, status: "pending", total: quote.total }, redirect_url: redirectUrl, ...extra }, 201);
  } catch (err) {
    await closeOrder(c.env, order.public_id, "failed", "gateway_init_failed");
    if (channel === "bkash" && err instanceof HttpError && err.code === "gateway_error") await audit(c, { action: "checkout.gateway_failed", entity: "order", entityId: order.id, summary: "bkash" });
    throw err;
  }
}

/**
 * A signed-in student's mobile number and address must be on file before they buy (the shop writes them on the order). Someone who has
 * them is not asked; someone who has not gives them here, and they are kept on the profile.
 */
async function withDetails(c: Ctx, student: StudentCtx, details: Cart["details"]): Promise<StudentCtx> {
  const phone = details?.phone ?? student.phone ?? null;
  const address = details?.address ?? student.address ?? "";
  const missing: Record<string, string> = {};
  if (!phone) missing.phone = "required";
  if (!address) missing.address = "required";
  if (Object.keys(missing).length) throw new HttpError(422, "validation", "validation", missing);
  if (phone !== student.phone || address !== (student.address ?? "")) {
    await run(c.env.DB, "UPDATE students SET phone = ?, address = ?, updated_at = ? WHERE id = ?", phone, address, nowIso(), student.id);
  }
  return { ...student, phone, address };
}

/** A signed-in student buys. */
checkoutRoutes.post("/", requireStudent, async (c) => {
  const body = await parseBody(c, checkoutSchema);
  const student = c.get("student")!;
  const prepared = await prepare(c, body, student.id);
  return place(c, await withDetails(c, student, body.details), body, prepared, {});
});

/**
 * A visitor buys without an account. They give a name, a mobile number and an e-mail; the account is made for them (no password yet) and
 * they are signed in on this phone, so the payment, the proof and the class all work as for any student. It is a real student the moment
 * the payment arrives. An e-mail that already belongs to a student is NOT opened by typing it (409 account_exists): that person signs in,
 * or is sent a link — anything else would let a stranger into someone's classes.
 */
checkoutRoutes.post("/guest", loadStudent, async (c) => {
  const body = await parseBody(c, guestSchema);
  const signedIn = c.get("student");
  // already a student (say, signed in from another tab): the details typed here fill in what their profile lacks
  if (signedIn) {
    const prepared = await prepare(c, body, signedIn.id);
    return place(c, await withDetails(c, signedIn, { phone: signedIn.phone ? undefined : body.phone, address: signedIn.address ? undefined : body.address }), body, prepared, {});
  }

  if (!(await verifyTurnstile(c.env, body.turnstile, c.get("ip")))) throw new HttpError(400, "captcha");
  // the basket and the way of paying must be good before an account is made for them
  await prepare(c, body, null);

  const found = await resolveGuestAccount(c.env, { name: body.name, email: body.email, phone: body.phone, address: body.address, lang: body.lang }, c.get("ip"));
  if (found.kind === "exists") {
    // which of the two said who they are (the e-mail, or — with no e-mail — the number) is the field the buyer is told about
    throw new HttpError(409, "account_exists", "account_exists", { [found.by]: found.hasPassword ? "account_exists" : "account_exists_link" });
  }
  const student = found.student;
  await createSession(c, "student", student.id);
  c.set("student", student);
  await audit(c, { action: found.kind === "new" ? "student.guest_created" : "student.guest_returned", entity: "student", entityId: student.id });
  return place(c, student, body, await prepare(c, body, student.id), { student: toMe(student) });
});

/** The student sends the proof for an open manual order: a TrxID, a screenshot sent just before (POST /:publicId/proof-image), or both. */
checkoutRoutes.post("/:publicId/proof", requireStudent, async (c) => {
  const body = await parseBody(c, proofSchema);
  const student = c.get("student")!;
  const publicId = c.req.param("publicId");
  const { id, first: firstProof } = await submitManualProof(c.env, student.id, publicId, body.trx_id ?? null);
  await audit(c, { action: "checkout.manual_proof", entity: "order", entityId: id });
  const order = await first<{ total: number; method: string | null; status: string }>(c.env.DB, "SELECT total, method, status FROM orders WHERE id = ?", id);
  if (firstProof && order) {
    const mail = manualPaymentReceivedMail(student.locale, { name: student.name, total: formatMoney(order.total, student.locale) });
    // the text goes to whatever number was typed at checkout, before any money is proven: it is capped like the other texts a visitor can set off
    c.executionCtx.waitUntil(tellStudent(c.env, student, { mail, sms: proofReceivedSms(student.locale, { total: order.total }) }, { capped: true }).then(() => undefined));
    c.executionCtx.waitUntil(notifyProof(c.env, id));
  }
  return ok(c, { order: { public_id: publicId, status: order?.status ?? "awaiting_verification" } });
});

/**
 * The payment screenshot: raw image bytes (the app shrinks it on the phone first), a hard size cap, the type read from the bytes.
 * It is stored privately — only staff who verify payments can open it.
 */
checkoutRoutes.post(
  "/:publicId/proof-image",
  requireStudent,
  bodyLimit({
    maxSize: MAX_PROOF_IMAGE_BYTES + 4096,
    onError: () => {
      throw new HttpError(413, "file_too_large");
    },
  }),
  async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const id = await saveProofImage(c.env, c.get("student")!.id, c.req.param("publicId"), bytes);
    await audit(c, { action: "checkout.manual_proof_image", entity: "order", entityId: id, meta: { size: bytes.length } });
    return ok(c, { has_proof_image: true }, 201);
  },
);
