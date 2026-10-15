import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { formatMoney, MAX_PROOF_IMAGE_BYTES, type Channel, type QuoteDTO } from "@mawah/shared";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { first, run } from "../../lib/db";
import { HttpError, ok, parseBody } from "../../lib/http";
import { manualPaymentReceivedMail, sendMail } from "../../lib/mailer";
import { getSettings } from "../../lib/settings";
import { requireStudent } from "../../middleware/auth";
import { rateLimit } from "../../middleware/ratelimit";
import { buildQuote, cancelReplacedManualOrders, closeOrder, createOrder, markOrderPaid, notifyProof, saveProofImage, submitManualProof, type ManualProof, type Quote } from "../../services/orders";
import { availableChannels, manualPayInfo } from "../../services/payments";
import { bkashCreate } from "../../services/payments/bkash";
import { sslInit } from "../../services/payments/sslcommerz";

export const checkoutRoutes = new Hono<AppEnv>();
checkoutRoutes.use("*", requireStudent, rateLimit("RL_CHECKOUT"));

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
  manual: z
    .object({
      method: z.enum(["bkash", "nagad", "rocket"], { error: "required" }),
      payer_number: z.string().trim().regex(/^(?:\+?88)?01[3-9]\d{8}$/, "invalid_phone"),
      // left out when the student is only starting: they pay first and send the TrxID / screenshot to the open order afterwards
      trx_id: TRX_ID.optional(),
    })
    .optional(),
});

const proofSchema = z.object({ trx_id: TRX_ID.optional() });

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
  };
}

checkoutRoutes.post("/quote", async (c) => {
  const body = await parseBody(c, cartSchema);
  const student = c.get("student")!;
  const [quote, settings] = await Promise.all([
    buildQuote(c.env, { studentId: student.id, courseSlugs: body.courses, bundleId: body.bundle_id, coupon: body.coupon }),
    getSettings(c.env),
  ]);
  return ok(c, { quote: toQuoteDTO(quote, availableChannels(c.env, settings), settings) });
});

checkoutRoutes.post("/", async (c) => {
  const body = await parseBody(c, checkoutSchema);
  if (!body.bundle_id && !body.courses?.length) throw new HttpError(422, "validation", "validation", { courses: "required" });
  const student = c.get("student")!;
  const settings = await getSettings(c.env);
  const quote = await buildQuote(c.env, { studentId: student.id, courseSlugs: body.courses, bundleId: body.bundle_id, coupon: body.coupon });

  // ---- free (price 0 or 100% coupon): no payment step, enrolled immediately ----
  if (quote.total === 0) {
    const order = await createOrder(c.env, student, quote, "free");
    await markOrderPaid(c.env, order.id, { gateway: "free", method: "free", waitUntil: (p) => c.executionCtx.waitUntil(p) });
    await audit(c, { action: "checkout.free", entity: "order", entityId: order.id });
    return ok(c, { order: { public_id: order.public_id, status: "paid", total: 0 } }, 201);
  }

  const channels = availableChannels(c.env, settings);
  const channel = body.channel;
  if (!channel || !channels.includes(channel)) throw new HttpError(400, "payment_unavailable");

  // ---- manual send-money: the student states which number they pay from and gets a payment window; they then pay and send the TrxID
  //      and/or a screenshot (POST /:publicId/proof); staff verify and enrollment follows ----
  if (channel === "manual") {
    if (!body.manual) throw new HttpError(422, "validation", "validation", { payer_number: "required" });
    const proof: ManualProof = { ...body.manual, payer_number: body.manual.payer_number.replace(/^\+?88/, "") };
    // starting again replaces the student's own unpaid manual order for the same class(es)
    await cancelReplacedManualOrders(c.env, student.id, quote.items.map((i) => i.course_id));
    const order = await createOrder(c.env, student, quote, "manual", proof, settings.payments.manual_window_min);
    const withProof = !!proof.trx_id;
    await audit(c, { action: withProof ? "checkout.manual_submitted" : "checkout.manual_started", entity: "order", entityId: order.id, meta: { method: proof.method } });
    if (withProof) {
      const mail = manualPaymentReceivedMail(student.locale, { name: student.name, total: formatMoney(quote.total, student.locale) });
      c.executionCtx.waitUntil(sendMail(c.env, { to: student.email, ...mail }));
      c.executionCtx.waitUntil(notifyProof(c.env, order.id));
    }
    const created = await first<{ pay_by: string }>(c.env.DB, "SELECT pay_by FROM orders WHERE id = ?", order.id);
    return ok(c, { order: { public_id: order.public_id, status: withProof ? "awaiting_verification" : "pending", total: quote.total, pay_by: created?.pay_by ?? null } }, 201);
  }

  const order = await createOrder(c.env, student, quote, channel);
  const summary = quote.items.map((i) => i.title_en).join(", ");
  try {
    let redirectUrl: string;
    if (channel === "sslcommerz") {
      const r = await sslInit(c.env, { public_id: order.public_id, total: quote.total }, { name: student.name, email: student.email, phone: student.phone ?? "" }, summary);
      redirectUrl = r.redirectUrl;
      await run(c.env.DB, "UPDATE orders SET gateway_ref = ? WHERE id = ?", r.sessionKey, order.id);
    } else if (channel === "bkash") {
      const r = await bkashCreate(c.env, { public_id: order.public_id, total: quote.total }, student.email);
      redirectUrl = r.redirectUrl;
      await run(c.env.DB, "UPDATE orders SET gateway_ref = ? WHERE id = ?", r.paymentId, order.id);
    } else {
      redirectUrl = `/api/payments/mock/pay/${order.public_id}`;
    }
    await audit(c, { action: "checkout.started", entity: "order", entityId: order.id, summary: channel });
    return ok(c, { order: { public_id: order.public_id, status: "pending", total: quote.total }, redirect_url: redirectUrl }, 201);
  } catch (err) {
    await closeOrder(c.env, order.public_id, "failed", "gateway_init_failed");
    throw err;
  }
});

/** The student sends the proof for an open manual order: a TrxID, a screenshot sent just before (POST /:publicId/proof-image), or both. */
checkoutRoutes.post("/:publicId/proof", async (c) => {
  const body = await parseBody(c, proofSchema);
  const student = c.get("student")!;
  const publicId = c.req.param("publicId");
  const { id, first: firstProof } = await submitManualProof(c.env, student.id, publicId, body.trx_id ?? null);
  await audit(c, { action: "checkout.manual_proof", entity: "order", entityId: id });
  const order = await first<{ total: number; method: string | null; status: string }>(c.env.DB, "SELECT total, method, status FROM orders WHERE id = ?", id);
  if (firstProof && order) {
    const mail = manualPaymentReceivedMail(student.locale, { name: student.name, total: formatMoney(order.total, student.locale) });
    c.executionCtx.waitUntil(sendMail(c.env, { to: student.email, ...mail }));
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
