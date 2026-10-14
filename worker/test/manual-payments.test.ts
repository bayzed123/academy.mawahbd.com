import { beforeEach, describe, expect, it } from "vitest";
import { MANUAL_WINDOW_DEFAULT_MIN, MAX_PROOF_IMAGE_BYTES } from "@mawah/shared";
import { Client, env, json, loginStaff, registerStudent, uniqueEmail } from "./helpers";
import { purgeOldProofs } from "../src/cron";
import { setSetting } from "../src/lib/settings";

/*
 * Manual (send-money) payments, step by step: the student says which number they pay from and gets a payment window, pays, then sends a
 * TrxID and/or a screenshot; staff check it and approve. The one-step form older clients use is covered in commerce.test.ts.
 */
let seq = 0;
async function makeCourse(price = 1200) {
  const n = ++seq;
  const slug = `manual-test-${Date.now().toString(36)}-${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, 'published', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `ম্যানুয়াল ক্লাস ${n}`, `Manual Course ${n}`, price)
    .run();
  return { id: res.meta.last_row_id as number, slug };
}

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8Dwn+E/w38AEAAB/wGJp5ySAAAAAElFTkSuQmCC"), (c) => c.charCodeAt(0));
const orderRow = (publicId: string) => env.DB.prepare("SELECT * FROM orders WHERE public_id = ?").bind(publicId).first<any>();
const upload = (client: Client, publicId: string, bytes: Uint8Array | string, type = "image/png") =>
  client.fetch(`/api/checkout/${publicId}/proof-image`, { method: "POST", body: bytes, headers: { "content-type": type } });

const numbers = { bkash: "01711111111", nagad: "01722222222", rocket: "" };
const setPayments = (extra: Record<string, unknown> = {}) =>
  setSetting(env, "payments", { sslcommerz: true, bkash_direct: false, manual: true, manual_numbers: numbers, manual_note_bn: "", manual_note_en: "", ...extra }, null);

/** a student who has started a manual order (nothing sent yet) */
async function startOrder(opts: { price?: number; method?: string; payer?: string } = {}) {
  const course = await makeCourse(opts.price);
  const { client, id: studentId, email } = await registerStudent();
  const res = await client.post("/api/checkout", { courses: [course.slug], channel: "manual", manual: { method: opts.method ?? "bkash", payer_number: opts.payer ?? "01712345678" } });
  const body = await json(res);
  return { course, client, studentId, email, res, body, publicId: body.order?.public_id as string };
}

describe("manual payment: starting", () => {
  beforeEach(async () => setPayments());

  it("opens a pending order with a 20-minute window, the student's own number, and grants nothing", async () => {
    const { res, body, client, publicId } = await startOrder({ method: "nagad", payer: "+8801712345678" });
    expect(res.status).toBe(201);
    expect(body.order).toMatchObject({ status: "pending", total: 1200 });
    const row = await orderRow(publicId);
    expect(row).toMatchObject({ gateway: "manual", method: "nagad", payer_number: "01712345678", gateway_txn: null, proof_at: null, proof_key: null, invoice_no: null });
    const minutes = (Date.parse(row.pay_by) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(MANUAL_WINDOW_DEFAULT_MIN - 1);
    expect(minutes).toBeLessThanOrEqual(MANUAL_WINDOW_DEFAULT_MIN);
    expect(body.order.pay_by).toBe(row.pay_by);
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(0);
  });

  it("the open order tells the page where to send the money and for how long", async () => {
    const { client, publicId } = await startOrder();
    const { order } = await json(await client.get(`/api/student/orders/${publicId}`));
    expect(order).toMatchObject({ status: "pending", has_proof_image: false, proof_at: null });
    expect(order.manual).toMatchObject({ numbers: { bkash: "01711111111", nagad: "01722222222" }, window_min: MANUAL_WINDOW_DEFAULT_MIN });
    expect(Date.parse(order.pay_by)).toBeGreaterThan(Date.now());
  });

  it("the window length is the owner's setting (5 to 120 minutes)", async () => {
    await setPayments({ manual_window_min: 45 });
    const { publicId } = await startOrder();
    const row = await orderRow(publicId);
    expect((Date.parse(row.pay_by) - Date.now()) / 60_000).toBeGreaterThan(44);

    const owner = (await loginStaff("super_admin")).client;
    const put = (min: number) => owner.put("/api/admin/settings/payments", { sslcommerz: true, bkash_direct: false, manual: true, manual_numbers: numbers, manual_note_bn: "", manual_note_en: "", manual_window_min: min });
    expect((await put(3)).status).toBe(422);
    expect((await put(121)).status).toBe(422);
    expect((await put(30)).status).toBe(200);
  });

  it("asks for a valid number the student pays from", async () => {
    const course = await makeCourse();
    const { client } = await registerStudent();
    const bad = await client.post("/api/checkout", { courses: [course.slug], channel: "manual", manual: { method: "bkash", payer_number: "12345" } });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields).toMatchObject({ "manual.payer_number": "invalid_phone" });
    const missing = await client.post("/api/checkout", { courses: [course.slug], channel: "manual" });
    expect(missing.status).toBe(422);
  });

  it("starting again replaces the student's own unpaid order for the same class", async () => {
    const { course, client, publicId: first } = await startOrder();
    const again = await json(await client.post("/api/checkout", { courses: [course.slug], channel: "manual", manual: { method: "rocket", payer_number: "01812345678" } }));
    expect(await orderRow(first)).toMatchObject({ status: "cancelled", note: "replaced" });
    expect(await orderRow(again.order.public_id)).toMatchObject({ status: "pending", method: "rocket" });
  });
});

describe("manual payment: sending proof", () => {
  beforeEach(async () => setPayments());

  it("a TrxID alone moves the order to awaiting verification and thanks the student by e-mail", async () => {
    const { client, publicId, email } = await startOrder();
    const res = await client.post(`/api/checkout/${publicId}/proof`, { trx_id: " 8n7a6d5e4c " });
    expect(res.status).toBe(200);
    expect((await json(res)).order).toMatchObject({ public_id: publicId, status: "awaiting_verification" });
    const row = await orderRow(publicId);
    expect(row).toMatchObject({ status: "awaiting_verification", gateway_txn: "8N7A6D5E4C" });
    expect(row.proof_at).not.toBeNull();
    const outbox = await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(email)}`));
    expect(outbox.messages.length).toBeGreaterThan(0);
  });

  it("a screenshot alone is enough, and it is stored privately", async () => {
    const { client, publicId } = await startOrder();
    const up = await upload(client, publicId, PNG);
    expect(up.status).toBe(201);
    const row = await orderRow(publicId);
    expect(row.proof_key).toMatch(new RegExp(`^proofs/${publicId}/[0-9a-f]{24}\\.png$`));
    const stored = await env.R2.get(row.proof_key);
    expect(stored?.httpMetadata?.contentType).toBe("image/png");
    expect(row.status).toBe("pending"); // the picture alone does not send the order to staff
    expect((await client.post(`/api/checkout/${publicId}/proof`, {})).status).toBe(200);
    expect(await orderRow(publicId)).toMatchObject({ status: "awaiting_verification", gateway_txn: null });
    expect((await json(await client.get(`/api/student/orders/${publicId}`))).order).toMatchObject({ has_proof_image: true, status: "awaiting_verification" });
  });

  it("without a TrxID or a screenshot there is nothing to verify", async () => {
    const { client, publicId } = await startOrder();
    const res = await client.post(`/api/checkout/${publicId}/proof`, {});
    expect(res.status).toBe(422);
    expect((await json(res)).error.fields).toMatchObject({ trx_id: "required" });
    expect((await orderRow(publicId)).status).toBe("pending");
    const bad = await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "x" });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields).toMatchObject({ trx_id: "invalid_trx" });
  });

  it("a TrxID that is already on another order is refused", async () => {
    const a = await startOrder();
    const b = await startOrder();
    expect((await a.client.post(`/api/checkout/${a.publicId}/proof`, { trx_id: "SAMETRX123" })).status).toBe(200);
    const dup = await b.client.post(`/api/checkout/${b.publicId}/proof`, { trx_id: "sametrx123" });
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.code).toBe("trx_used");
    expect((await orderRow(b.publicId)).status).toBe("pending");
  });

  it("a typo can be fixed while staff have not decided, and a screenshot added later", async () => {
    const { client, publicId } = await startOrder();
    await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "TYPO111111" });
    const first = (await orderRow(publicId)).proof_at;
    expect((await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "RIGHT22222" })).status).toBe(200);
    expect(await orderRow(publicId)).toMatchObject({ gateway_txn: "RIGHT22222", proof_at: first, status: "awaiting_verification" });
    expect((await upload(client, publicId, PNG)).status).toBe(201);
  });

  it("proof sent after the window is accepted — the money may already be on its way", async () => {
    const { client, publicId } = await startOrder();
    await env.DB.prepare("UPDATE orders SET pay_by = ? WHERE public_id = ?").bind(new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d+Z$/, "Z"), publicId).run();
    expect((await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "LATEPROOF1" })).status).toBe(200);
    const row = await orderRow(publicId);
    expect(row.status).toBe("awaiting_verification");
    expect(Date.parse(row.proof_at)).toBeGreaterThan(Date.parse(row.pay_by));
  });

  it("only the student's own manual order, and only while it is open", async () => {
    const { client, publicId } = await startOrder();
    const { client: stranger } = await registerStudent();
    expect((await stranger.post(`/api/checkout/${publicId}/proof`, { trx_id: "STRANGER11" })).status).toBe(404);
    expect((await upload(stranger, publicId, PNG)).status).toBe(404);

    const course = await makeCourse();
    const mock = await json(await client.post("/api/checkout", { courses: [course.slug], channel: "mock" }));
    expect((await client.post(`/api/checkout/${mock.order.public_id}/proof`, { trx_id: "NOTMANUAL1" })).status).toBe(409);

    await env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE public_id = ?").bind(publicId).run();
    const closed = await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "CLOSEDONE1" });
    expect(closed.status).toBe(409);
    expect((await json(closed)).error.code).toBe("order_closed");
    expect((await upload(client, publicId, PNG)).status).toBe(409);
  });

  it("the screenshot must be a real image, not too big", async () => {
    const { client, publicId } = await startOrder();
    expect((await upload(client, publicId, "this is not a picture, whatever the header says", "image/png")).status).toBe(415);
    expect((await upload(client, publicId, new Uint8Array(0))).status).toBe(400);
    const big = new Uint8Array(MAX_PROOF_IMAGE_BYTES + 100_000);
    big.set(PNG);
    expect((await upload(client, publicId, big)).status).toBe(413);
    expect((await orderRow(publicId)).proof_key).toBeNull();
  });

  it("a second picture replaces the first one in storage", async () => {
    const { client, publicId } = await startOrder();
    await upload(client, publicId, PNG);
    const firstKey = (await orderRow(publicId)).proof_key;
    const other = new Uint8Array(PNG.length + 1);
    other.set(PNG);
    other[other.length - 1] = 7;
    await upload(client, publicId, other);
    const secondKey = (await orderRow(publicId)).proof_key;
    expect(secondKey).not.toBe(firstKey);
    expect(await env.R2.head(firstKey)).toBeNull();
    expect(await env.R2.head(secondKey)).not.toBeNull();
  });

  it("tells the owner by e-mail when proof arrives, if a contact address is set", async () => {
    const owner = uniqueEmail("owner");
    await setSetting(env, "contact", { whatsapp: "", phone: "", email: owner, facebook: "", youtube: "", instagram: "" }, null);
    const { client, publicId } = await startOrder();
    await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "NOTIFYME11" });
    await new Promise((r) => setTimeout(r, 50)); // waitUntil work
    const outbox = await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(owner)}`));
    const mail = outbox.messages.at(-1);
    expect(mail.subject).toMatch(/Payment to verify/);
    expect(mail.text).toContain("/admin/orders?status=awaiting_verification");
    await setSetting(env, "contact", { whatsapp: "", phone: "", email: "", facebook: "", youtube: "", instagram: "" }, null);
  });
});

describe("manual payment: staff", () => {
  beforeEach(async () => setPayments());

  it("only staff who verify payments can open the screenshot, and browsers are told not to keep it", async () => {
    const { client, publicId } = await startOrder();
    await upload(client, publicId, PNG);
    await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "STAFFLOOK1" });
    const id = (await orderRow(publicId)).id;

    const support = (await loginStaff("support")).client;
    const shot = await support.get(`/api/admin/orders/${id}/proof-image`);
    expect(shot.status).toBe(200);
    expect(shot.headers.get("content-type")).toBe("image/png");
    expect(shot.headers.get("cache-control")).toBe("private, no-store");
    expect(shot.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await shot.arrayBuffer()).length).toBe(PNG.length);

    expect((await (await loginStaff("viewer")).client.get(`/api/admin/orders/${id}/proof-image`)).status).toBe(403);
    expect((await (await loginStaff("content_manager")).client.get(`/api/admin/orders/${id}/proof-image`)).status).toBe(403);
    expect((await client.get(`/api/admin/orders/${id}/proof-image`)).status).toBeGreaterThanOrEqual(401);
    expect((await new Client().get(`/api/admin/orders/${id}/proof-image`)).status).toBeGreaterThanOrEqual(401);
  });

  it("the order detail carries the proof facts staff compare with the wallet statement", async () => {
    const { client, publicId } = await startOrder({ method: "rocket", payer: "01812345678" });
    await upload(client, publicId, PNG);
    await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "DETAIL1234" });
    const id = (await orderRow(publicId)).id;
    const { order } = await json(await (await loginStaff("support")).client.get(`/api/admin/orders/${id}`));
    expect(order).toMatchObject({ status: "awaiting_verification", method: "rocket", payer_number: "01812345678", gateway_txn: "DETAIL1234", has_proof_image: 1, total: 1200 });
    expect(order.pay_by).toBeTruthy();
    expect(order.proof_at).toBeTruthy();
  });

  it("approving opens the class once; the student sees the payment as confirmed", async () => {
    const { course, client, publicId, studentId } = await startOrder();
    await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "APPROVE123" });
    const support = (await loginStaff("support")).client;
    const id = (await orderRow(publicId)).id;
    expect((await support.post(`/api/admin/orders/${id}/approve`)).status).toBe(200);
    expect((await support.post(`/api/admin/orders/${id}/approve`)).status).toBe(409);
    expect(await orderRow(publicId)).toMatchObject({ status: "paid" });
    const { order: seen } = await json(await client.get(`/api/student/orders/${publicId}`));
    expect(seen.status).toBe("paid");
    expect(seen.manual).toBeUndefined(); // a settled order no longer shows where to send money
    const enrolled = await env.DB.prepare("SELECT status FROM enrollments WHERE student_id = ? AND course_id = ?").bind(studentId, course.id).first<any>();
    expect(enrolled?.status).toBe("active");
  });

  it("an order the student never filled in can be approved too (they paid and sent the details on WhatsApp)", async () => {
    const { client, publicId } = await startOrder();
    const support = (await loginStaff("support")).client;
    const id = (await orderRow(publicId)).id;
    expect((await support.post(`/api/admin/orders/${id}/approve`)).status).toBe(200);
    expect((await orderRow(publicId)).status).toBe("paid");
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(1);
  });

  it("an unpaid card/mock order cannot be approved by hand", async () => {
    const course = await makeCourse();
    const { client } = await registerStudent();
    const mock = await json(await client.post("/api/checkout", { courses: [course.slug], channel: "mock" }));
    const id = (await orderRow(mock.order.public_id)).id;
    expect(((await (await loginStaff("support")).client.post(`/api/admin/orders/${id}/approve`)).status)).toBe(409);
  });

  it("a refusal closes the order and the e-mail names the reason", async () => {
    const { client, publicId, email } = await startOrder();
    await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "REFUSEME11" });
    const id = (await orderRow(publicId)).id;
    expect((await (await loginStaff("support")).client.post(`/api/admin/orders/${id}/reject`, { reason: "No such payment in our statement" })).status).toBe(200);
    expect(await orderRow(publicId)).toMatchObject({ status: "failed" });
    const mails = await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(email)}`));
    expect(mails.messages.at(-1).text).toContain("No such payment in our statement");
  });
});

describe("manual payment: housekeeping", () => {
  beforeEach(async () => setPayments());

  it("screenshots of settled orders are deleted 90 days later; open orders keep theirs", async () => {
    const settled = await startOrder();
    await upload(settled.client, settled.publicId, PNG);
    await settled.client.post(`/api/checkout/${settled.publicId}/proof`, { trx_id: "OLDSETTLE1" });
    const waiting = await startOrder();
    await upload(waiting.client, waiting.publicId, PNG);
    await waiting.client.post(`/api/checkout/${waiting.publicId}/proof`, { trx_id: "STILLOPEN1" });

    const key = (await orderRow(settled.publicId)).proof_key;
    const keepKey = (await orderRow(waiting.publicId)).proof_key;
    const old = new Date(Date.now() - 100 * 86400_000).toISOString().replace(/\.\d+Z$/, "Z");
    await env.DB.prepare("UPDATE orders SET status = 'paid', updated_at = ? WHERE public_id = ?").bind(old, settled.publicId).run();
    await env.DB.prepare("UPDATE orders SET updated_at = ? WHERE public_id = ?").bind(old, waiting.publicId).run();

    const removed = await purgeOldProofs(env, new Date(Date.now() - 90 * 86400_000));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect((await orderRow(settled.publicId)).proof_key).toBeNull();
    expect(await env.R2.head(key)).toBeNull();
    expect((await orderRow(waiting.publicId)).proof_key).toBe(keepKey); // still waiting for staff: never deleted
    expect(await env.R2.head(keepKey)).not.toBeNull();
  });
});
