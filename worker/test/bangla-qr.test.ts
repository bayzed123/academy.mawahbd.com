import { afterEach, describe, expect, it } from "vitest";
import { SETTING_DEFAULTS, setSetting } from "../src/lib/settings";
import { Client, env, freshState, json, loginStaff, registerStudent } from "./helpers";

/*
 * The three ways to pay, as the owner wants them: send money by hand (the shop's bKash / Nagad / Rocket numbers), SSLCommerz's auto pay,
 * and the shop's Bangla QR (its own QR built in), which the owner switches Active / Inactive. A QR payment is a manual order like send-money (a payment window,
 * then a TrxID and/or a screenshot, then staff check and approve) — only where the money is sent differs. The student's own number is never
 * required: a missing number must not stop anyone from going on to pay.
 */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=="), (ch) => ch.charCodeAt(0));
const numbers = { bkash: "01711111111", nagad: "", rocket: "" };

let seq = 0;
async function makeCourse(price = 900) {
  const n = ++seq;
  const slug = `qr-test-${Date.now().toString(36)}-${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, 'published', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `কিউআর ক্লাস ${n}`, `QR Course ${n}`, price)
    .run();
  return { id: res.meta.last_row_id as number, slug };
}

async function setPayments(over: Partial<typeof SETTING_DEFAULTS.payments>) {
  await setSetting(env, "payments", { ...SETTING_DEFAULTS.payments, manual: true, manual_numbers: numbers, ...over }, null);
  freshState();
}
afterEach(async () => setPayments({}));

/** the owner uploads the QR picture as it is (Settings → Payments) */
async function uploadQr(client: Client) {
  const res = await client.fetch("/api/admin/media/image?folder=payments", { method: "POST", body: PNG, headers: { "content-type": "image/png" } });
  expect(res.status).toBe(201);
  return (await json(res)).key as string;
}

const orderRow = (publicId: string) => env.DB.prepare("SELECT * FROM orders WHERE public_id = ?").bind(publicId).first<any>();

describe("Bangla QR: the owner's switch", () => {
  it("starts Active with the shop's own QR built in; a different picture may be uploaded, and only one uploaded for payments", async () => {
    const { client } = await loginStaff("super_admin");
    expect(SETTING_DEFAULTS.payments).toMatchObject({ bangla_qr: true, qr_image: "", qr_name: "MAWAH" });
    const builtIn = await env.ASSETS.fetch(new Request(`${env.SITE_URL.replace(/\/$/, "")}/pay/bangla-qr.png`)); // a static file, served before the Worker
    expect(builtIn.status).toBe(200);
    expect(builtIn.headers.get("content-type")).toMatch(/image\/png/);

    const base = { ...SETTING_DEFAULTS.payments, manual: true, manual_numbers: numbers };
    expect((await client.put("/api/admin/settings/payments", { ...base, bangla_qr: true, qr_image: "" })).status, "the built-in QR needs no upload").toBe(200);
    const elsewhere = await client.put("/api/admin/settings/payments", { ...base, bangla_qr: true, qr_image: "courses/0123456789abcdef0123456789abcdef.png" });
    expect(elsewhere.status).toBe(422);

    const key = await uploadQr(client);
    expect(key).toMatch(/^payments\/[a-f0-9]{32}\.png$/);
    expect((await client.put("/api/admin/settings/payments", { ...base, bangla_qr: true, qr_image: key, qr_name: "Mawah Academy" })).status).toBe(200);
    const pic = await new Client().get(`/media/${key}`);
    expect(pic.status).toBe(200);
    expect(pic.headers.get("content-type")).toMatch(/image\/png/);
    expect((await client.put("/api/admin/settings/payments", { ...base, bangla_qr: false, qr_image: key })).status).toBe(200);
  });

  it("is offered at checkout only while Active with a picture, and never the old direct bKash or pay-link ways", async () => {
    const course = await makeCourse();
    const quote = async () => (await json(await new Client().post("/api/checkout/quote", { courses: [course.slug] }))).quote;

    await setPayments({ bangla_qr: false });
    expect((await quote()).channels).not.toContain("bangla_qr");

    await setPayments({ bangla_qr: true, qr_image: "" });
    const builtIn = await quote();
    expect(builtIn.channels, "Active with the built-in QR").toContain("bangla_qr");
    expect(builtIn.manual.qr).toEqual({ image: "/pay/bangla-qr.png", name: "MAWAH" });

    const key = await uploadQr((await loginStaff("super_admin")).client);
    await setPayments({ bangla_qr: true, qr_image: key, qr_name: "Mawah Academy" });
    const q = await quote();
    expect(q.channels).toContain("bangla_qr");
    expect(q.channels).not.toContain("bkash");
    expect(q.manual.qr).toEqual({ image: `/media/${key}`, name: "Mawah Academy" });
    expect(q.manual).not.toHaveProperty("link");
  });
});

describe("Bangla QR: paying", () => {
  it("opens a manual order marked as QR; the student sees the QR; the TrxID is checked and approved like send-money", async () => {
    const key = await uploadQr((await loginStaff("super_admin")).client);
    await setPayments({ bangla_qr: true, qr_image: key, qr_name: "Mawah Academy" });
    const course = await makeCourse();
    const { client, id: studentId } = await registerStudent();

    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "bangla_qr" });
    expect(res.status).toBe(201);
    const publicId = (await json(res)).order.public_id as string;
    expect(await orderRow(publicId)).toMatchObject({ status: "pending", gateway: "manual", method: "manual", gateway_ref: "bangla_qr", payer_number: null });

    const { order } = await json(await client.get(`/api/student/orders/${publicId}`));
    expect(order).toMatchObject({ via_qr: true, via_link: false });
    expect(order.manual.qr).toEqual({ image: `/media/${key}`, name: "Mawah Academy" });

    expect((await client.post(`/api/checkout/${publicId}/proof`, { trx_id: "QRPAY12345" })).status).toBe(200);
    expect(await orderRow(publicId)).toMatchObject({ status: "awaiting_verification", gateway_txn: "QRPAY12345" });

    const support = (await loginStaff("support")).client;
    const id = (await orderRow(publicId)).id;
    const { order: staffView } = await json(await support.get(`/api/admin/orders/${id}`));
    expect(staffView).toMatchObject({ via_qr: 1, gateway_txn: "QRPAY12345" });
    expect((await support.post(`/api/admin/orders/${id}/approve`)).status).toBe(200);
    const enrolled = await env.DB.prepare("SELECT status FROM enrollments WHERE student_id = ? AND course_id = ?").bind(studentId, course.id).first<any>();
    expect(enrolled?.status).toBe("active");
  });

  it("is refused while Inactive", async () => {
    await setPayments({ bangla_qr: false });
    const course = await makeCourse();
    const { client } = await registerStudent();
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "bangla_qr" });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("payment_unavailable");
  });
});

describe("send money: nothing but the service is needed to go on", () => {
  it("the student's own number may be left out — the order opens and waits for the TrxID or screenshot", async () => {
    await setPayments({});
    const course = await makeCourse();
    const { client } = await registerStudent();
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "manual", manual: { method: "bkash" } });
    expect(res.status).toBe(201);
    const publicId = (await json(res)).order.public_id as string;
    expect(await orderRow(publicId)).toMatchObject({ status: "pending", method: "bkash", payer_number: null });

    const blank = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "manual", manual: { method: "bkash", payer_number: "" } });
    expect(blank.status, "an empty box is the same as none").toBe(201);
  });

  it("a service the shop has no number for is refused with a reason, not silently", async () => {
    await setPayments({});
    const course = await makeCourse();
    const { client } = await registerStudent();
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "manual", manual: { method: "rocket" } });
    expect(res.status).toBe(422);
    expect((await json(res)).error.fields).toMatchObject({ "manual.method": "required" });
  });
});
