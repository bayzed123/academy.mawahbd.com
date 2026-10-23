import { beforeEach, describe, expect, it } from "vitest";
import { Client, env, json, loginStaff, registerStudent, uniqueEmail } from "./helpers";
import { sslPayLinkFor } from "@mawah/shared";
import { setSetting } from "../src/lib/settings";

/*
 * The shop's SSLCommerz payment link (Admin → Settings → Payments): one more way under manual payment. The student pays on SSLCommerz's own
 * page by card or mobile banking and sends the transaction ID; staff find the payment in the SSLCommerz panel and approve it, exactly like a
 * send-money payment. The link is a made-up one here.
 */
const LINK = "https://invoice.sslcommerz.com/invoice-form?refer=0TESTREF00000";
const NO_NUMBERS = { bkash: "", nagad: "", rocket: "" };
const NUMBERS = { bkash: "01711111111", nagad: "", rocket: "" };

let seq = 0;
async function makeCourse(price = 900) {
  const n = ++seq;
  const slug = `pay-link-${Date.now().toString(36)}-${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, 'published', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `লিংক ক্লাস ${n}`, `Link Course ${n}`, price)
    .run();
  return { id: res.meta.last_row_id as number, slug };
}

const setPayments = (extra: Record<string, unknown>) =>
  setSetting(env, "payments", { sslcommerz: false, bkash_direct: false, manual: true, manual_numbers: NO_NUMBERS, manual_note_bn: "", manual_note_en: "", ...extra }, null);
const orderRow = (publicId: string) => env.DB.prepare("SELECT * FROM orders WHERE public_id = ?").bind(publicId).first<any>();
const paymentsBody = (extra: Record<string, unknown>) => ({ sslcommerz: true, bkash_direct: false, manual: true, manual_numbers: NUMBERS, manual_note_bn: "", manual_note_en: "", ...extra });

async function quote(client: Client, slug: string) {
  return (await json(await client.post("/api/checkout/quote", { courses: [slug] }))).quote;
}

/** the owner's note about this order, once the work after the answer has sent it */
async function ownerNote(to: string, about: RegExp) {
  for (let i = 0; i < 60; i++) {
    const { messages } = await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(to)}`));
    const note = (messages as { subject: string; text: string }[]).find((m) => about.test(m.subject));
    if (note) return note;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("no note");
}

describe("the SSLCommerz payment link in Settings → Payments", () => {
  it("the owner saves the link from the SSLCommerz panel; it is kept as an address, without the spaces around it", async () => {
    const owner = (await loginStaff("super_admin")).client;
    expect((await owner.put("/api/admin/settings/payments", paymentsBody({ manual_link: `  ${LINK}\n` }))).status).toBe(200);
    expect((await json(await owner.get("/api/admin/settings"))).settings.payments.manual_link).toBe(LINK);
    // emptied: not offered any more
    expect((await owner.put("/api/admin/settings/payments", paymentsBody({ manual_link: "" }))).status).toBe(200);
    expect((await json(await owner.get("/api/admin/settings"))).settings.payments.manual_link).toBe("");
  });

  it("nothing but an https address on sslcommerz.com is taken, and only from someone who may change settings", async () => {
    const owner = (await loginStaff("super_admin")).client;
    for (const bad of [
      "http://invoice.sslcommerz.com/invoice-form?refer=0TESTREF00000",
      "https://sslcommerz.com.example.net/invoice-form",
      "https://example.net/?next=https://invoice.sslcommerz.com/",
      "https://notsslcommerz.com/invoice-form",
      "https://someone@invoice.sslcommerz.com/invoice-form",
      "https://invoice.sslcommerz.com:8443/invoice-form",
      "javascript:alert(1)",
      "invoice.sslcommerz.com/invoice-form?refer=0TESTREF00000",
      "pay here",
    ]) {
      const res = await owner.put("/api/admin/settings/payments", paymentsBody({ manual_link: bad }));
      expect(res.status, bad).toBe(422);
      expect((await json(res)).error.fields, bad).toMatchObject({ manual_link: "pay_link_invalid" });
    }
    const long = await owner.put("/api/admin/settings/payments", paymentsBody({ manual_link: `${LINK}&x=${"a".repeat(500)}` }));
    expect((await json(long)).error.fields).toMatchObject({ manual_link: "too_long" });
    expect((await (await loginStaff("support")).client.put("/api/admin/settings/payments", paymentsBody({ manual_link: LINK }))).status).toBe(403);
  });
});

describe("the SSLCommerz payment link at checkout", () => {
  beforeEach(async () => setPayments({ manual_link: LINK }));

  it("with only the link set, manual payment is offered, the price answer carries the link and the dashboard has nothing to warn about", async () => {
    const course = await makeCourse();
    const { client } = await registerStudent();
    const q = await quote(client, course.slug);
    expect(q.channels).toContain("manual");
    expect(q.manual).toMatchObject({ link: LINK, numbers: NO_NUMBERS });
    const owner = (await loginStaff("super_admin")).client;
    const pay = (await json(await owner.get("/api/admin/health"))).checks.find((h: any) => h.key === "payments");
    expect(pay.issues).not.toContain("manual_numbers_missing");

    // no link and no number: manual payment is not offered, and the dashboard says why
    await setPayments({ manual_link: "" });
    expect((await quote(client, course.slug)).channels).not.toContain("manual");
    const warned = (await json(await owner.get("/api/admin/health"))).checks.find((h: any) => h.key === "payments");
    expect(warned.issues).toContain("manual_numbers_missing");
  });

  it("send-money is listed first and SSLCommerz's secure online payment second — the checkout chooses the first", async () => {
    const course = await makeCourse();
    const { client } = await registerStudent();
    await setPayments({ manual_link: LINK, manual_numbers: NUMBERS, sslcommerz: true });
    expect(((await quote(client, course.slug)).channels as string[]).slice(0, 2)).toEqual(["manual", "sslcommerz"]);
    // without send-money the online payment is the first (and chosen)
    await setPayments({ manual: false, sslcommerz: true });
    expect(((await quote(client, course.slug)).channels as string[])[0]).toBe("sslcommerz");
  });

  it("the link opens with the amount, the order code and the buyer's name and number filled in, the owner's own code kept", () => {
    const u = new URL(sslPayLinkFor(LINK, { amount: 1850, code: "ABCD2345", name: " Rina Akter ", phone: "01712345678" })!);
    expect(u.origin + u.pathname).toBe("https://invoice.sslcommerz.com/invoice-form");
    expect(Object.fromEntries(u.searchParams)).toEqual({ refer: "0TESTREF00000", amount: "1850", currency: "BDT", acct: "ABCD2345", cus_name: "Rina Akter", cus_phone: "01712345678" });
    // nothing for what is not known; a value already in the owner's link is replaced, never doubled
    const bare = new URL(sslPayLinkFor(`${LINK}&amount=5`, { amount: 900, code: "WXYZ6789", name: "", phone: null })!);
    expect(bare.searchParams.getAll("amount")).toEqual(["900"]);
    expect(bare.searchParams.has("cus_name")).toBe(false);
    expect(bare.searchParams.has("cus_phone")).toBe(false);
    // a name with spaces or Bangla letters travels safely in the address
    expect(new URL(sslPayLinkFor(LINK, { amount: 900, code: "WXYZ6789", name: "রিনা & co" })!).searchParams.get("cus_name")).toBe("রিনা & co");
    // only SSLCommerz's own address is ever built on
    expect(sslPayLinkFor("https://example.com/pay?refer=1", { amount: 900, code: "WXYZ6789" })).toBeNull();
  });

  it("a student pays on the link: the order waits with the link, SSLCommerz's transaction ID is taken, staff approve and the class opens", async () => {
    const to = uniqueEmail("owner");
    await setSetting(env, "notifications", { emails: [to], off: [] }, null);
    const course = await makeCourse();
    const { client, id: studentId } = await registerStudent();
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "manual", manual: { method: "card", payer_number: "01712345678" } });
    expect(res.status).toBe(201);
    const publicId = (await json(res)).order.public_id as string;
    expect(await orderRow(publicId)).toMatchObject({ status: "pending", gateway: "manual", method: "card", payer_number: "01712345678", gateway_txn: null });
    const { order } = await json(await client.get(`/api/student/orders/${publicId}`));
    expect(order).toMatchObject({ via_link: true, manual: { link: LINK } });

    // SSLCommerz's transaction IDs are longer than a wallet's TrxID and in mixed case
    expect((await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "2410231520531hYp6gZXZ4hjQ6vx" })).status).toBe(200);
    const row = await orderRow(publicId);
    expect(row).toMatchObject({ status: "awaiting_verification", gateway_txn: "2410231520531HYP6GZXZ4HJQ6VX" });
    // the owner is told where to look: the SSLCommerz panel, not a bKash message
    const waiting = await ownerNote(to, /waiting for you to verify/);
    expect(waiting.subject).toContain("SSLCommerz payment link");
    expect(waiting.text).toContain("2410231520531HYP6GZXZ4HJQ6VX");
    expect(waiting.text).toContain("SSLCommerz panel");
    expect(waiting.text).not.toMatch(/\bCard\b/);

    const support = (await loginStaff("support")).client;
    const { order: seen } = await json(await support.get(`/api/admin/orders/${row.id}`));
    expect(seen).toMatchObject({ gateway: "manual", method: "card", gateway_txn: "2410231520531HYP6GZXZ4HJQ6VX", via_link: 1 });
    expect((await support.post(`/api/admin/orders/${row.id}/approve`)).status).toBe(200);
    expect((await orderRow(publicId)).status).toBe("paid");
    const enrolled = await env.DB.prepare("SELECT status FROM enrollments WHERE student_id = ? AND course_id = ?").bind(studentId, course.id).first<any>();
    expect(enrolled?.status).toBe("active");
    expect((await ownerNote(to, /New payment received/)).text).toContain("SSLCommerz payment link");
    // the student's invoice says where it was paid (in the student's language: Bangla here)
    const invoice = await (await client.get(`/api/student/orders/${publicId}/invoice`)).text();
    expect(invoice).toContain("SSLCommerz পেমেন্ট লিংক");
  });

  it("a card sale staff record by hand is a card sale, not the payment link; nor is a send-money order", async () => {
    const owner = (await loginStaff("super_admin")).client;
    const course = await makeCourse();
    const email = uniqueEmail("by-hand");
    expect((await owner.post("/api/admin/students", { name: "Paid By Card", email, course_ids: [course.id], payment: { amount: 900, method: "card" } })).status).toBe(201);
    const sale = await env.DB.prepare("SELECT id FROM orders WHERE customer_email = ?").bind(email).first<any>();
    const { order: recorded } = await json(await owner.get(`/api/admin/orders/${sale.id}`));
    expect(recorded).toMatchObject({ gateway: "manual", method: "card", via_link: 0 });

    const { client } = await registerStudent();
    const bkash = await json(await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "manual", manual: { method: "bkash", payer_number: "01712345678" } }));
    expect((await json(await client.get(`/api/student/orders/${bkash.order.public_id}`))).order.via_link).toBe(false);
  });

  it("the link can be chosen only while the owner has one; nothing is created otherwise", async () => {
    await setPayments({ manual_numbers: NUMBERS, manual_link: "" });
    const course = await makeCourse();
    const { client, id: studentId } = await registerStudent();
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "manual", manual: { method: "card", payer_number: "01712345678" } });
    expect(res.status).toBe(422);
    expect((await json(res)).error.fields).toMatchObject({ "manual.method": "invalid" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE student_id = ?").bind(studentId).first<any>()).n).toBe(0);
    // the numbers still work as before
    const bkash = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "manual", manual: { method: "bkash", payer_number: "01712345678" } });
    expect(bkash.status).toBe(201);
  });

  it("a transaction ID may hold - or _ and run to 40 characters; anything else is still refused, and one ID pays for one order only", async () => {
    const start = async () => {
      const course = await makeCourse();
      const { client } = await registerStudent();
      const res = await json(await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "manual", manual: { method: "card", payer_number: "01712345678" } }));
      return { client, publicId: res.order.public_id as string };
    };
    const first = await start();
    for (const bad of ["x", "-ABCDEF12", "ABCDEF12_", "AB CD EF 12", "A".repeat(41)]) {
      const res = await first.client.post(`/api/checkout/${first.publicId}/proof`, { trx_id: bad });
      expect(res.status, bad).toBe(422);
      expect((await json(res)).error.fields, bad).toMatchObject({ trx_id: "invalid_trx" });
    }
    expect((await first.client.post(`/api/checkout/${first.publicId}/proof`, { trx_id: "SSLCZ_LIVE-6720A1B2C3" })).status).toBe(200);
    expect((await orderRow(first.publicId)).gateway_txn).toBe("SSLCZ_LIVE-6720A1B2C3");

    const second = await start();
    const reuse = await second.client.post(`/api/checkout/${second.publicId}/proof`, { trx_id: "sslcz_live-6720a1b2c3" });
    expect(reuse.status).toBe(409);
    expect((await json(reuse)).error.code).toBe("trx_used");
  });
});
