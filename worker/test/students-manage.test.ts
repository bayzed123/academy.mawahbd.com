import { describe, expect, it } from "vitest";
import { mockSignature } from "../src/services/payments";
import { Client, env, json, loginStaff, registerStudent, uniqueEmail } from "./helpers";

/*
 * Students the owner adds by hand or imports from a spreadsheet (people who studied before the website existed, or paid in cash).
 * What the owner cannot check by eye, and these tests protect:
 *  - only Super Admin and Support can add, change or import students; a Viewer can only look, a Content Manager cannot see students at all;
 *  - an added student has NO password and can never sign in until they choose one through a link (valid for three days);
 *  - classes and the payment already made are saved together with the student or not at all — never a half-saved person;
 *  - a recorded payment is a normal PAID order on the day it was really paid, with that day's next invoice number, and no e-mail goes out;
 *  - a list is read line by line: a line with a problem is named, and saving does exactly what the check said, and can be repeated safely;
 *  - changing a sign-in address leaves a trail, and an address already in use is refused.
 */

let seq = 0;
async function newClass(price = 1000, over: { title_en?: string; title_bn?: string } = {}) {
  const n = `${Date.now().toString(36)}${++seq}`;
  const slug = `stu-${n}`;
  const title_en = over.title_en ?? `Cake Mastery ${n}`;
  const title_bn = over.title_bn ?? `কেক মাস্টারি ${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, long_bn, long_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, 'ছোট', 'Short', '', '', ?, 'published', 1, 1, '2026-01-01T00:00:00Z')`,
  )
    .bind(slug, title_bn, title_en, price)
    .run();
  return { id: res.meta.last_row_id as number, slug, title_en, title_bn, price };
}
type Cls = Awaited<ReturnType<typeof newClass>>;

const as = async (role: "super_admin" | "content_manager" | "support" | "viewer" = "super_admin") => (await loginStaff(role)).client;
const rowOf = (email: string) => env.DB.prepare("SELECT * FROM students WHERE email = ?").bind(email).first<any>();
const enrolments = async (studentId: number) => (await env.DB.prepare("SELECT * FROM enrollments WHERE student_id = ? ORDER BY course_id").bind(studentId).all<any>()).results;
const ordersOf = async (studentId: number) => (await env.DB.prepare("SELECT * FROM orders WHERE student_id = ? ORDER BY id").bind(studentId).all<any>()).results;
const itemsOf = async (orderId: number) => (await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").bind(orderId).all<any>()).results;
const outbox = async (to: string) => (await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(to)}`))).messages as { subject: string; text: string }[];
const studentCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM students").first<{ n: number }>())!.n;
const orderCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM orders").first<{ n: number }>())!.n;
const invoice = (day: string, n: number) => `INV-${env.BRAND_CODE}-${day}-${String(n).padStart(4, "0")}`;

describe("who can add and change students", () => {
  it("visitors and students get nothing; Support and the owner can write; a Viewer can only look; a Content Manager does not see students", async () => {
    const email = uniqueEmail("hand");
    expect((await new Client().post("/api/admin/students", { name: "Nobody", email })).status).toBe(401);
    expect((await (await registerStudent()).client.post("/api/admin/students", { name: "Nobody", email })).status).toBe(401);
    for (const role of ["content_manager", "viewer"] as const) {
      const client = await as(role);
      expect((await client.post("/api/admin/students", { name: "Nobody", email })).status, role).toBe(403);
      expect((await client.post("/api/admin/students/import/preview", { rows: [{ name: "A B", email }] })).status, role).toBe(403);
      expect((await client.post("/api/admin/students/import", { rows: [{ name: "A B", email }] })).status, role).toBe(403);
      expect((await client.post("/api/admin/students/1/invite", { mode: "link" })).status, role).toBe(403);
      expect((await client.get("/api/admin/students")).status, role).toBe(role === "viewer" ? 200 : 403);
    }
    expect(await rowOf(email)).toBeNull();
    expect((await (await as("support")).post("/api/admin/students", { name: "By Support", email })).status).toBe(201);
  });
});

describe("adding a student by hand", () => {
  it("makes an account with no password, marks how they joined, and keeps the private note", async () => {
    const admin = await as();
    const email = uniqueEmail("hand");
    const res = await admin.post("/api/admin/students", { name: "  Rina   Akter ", email: email.toUpperCase(), phone: "০১৭১২৩৪৫৬৭৮", locale: "bn", notes: "Old group member since 2022" });
    expect(res.status).toBe(201);
    const { id } = await json(res);
    const row = await rowOf(email);
    expect(row).toMatchObject({ id, name: "Rina Akter", email, phone: "01712345678", locale: "bn", source: "admin", notes: "Old group member since 2022", marketing_opt_in: 0, blocked: 0 });
    expect(row.password_hash).toBeNull();

    const detail = await json(await admin.get(`/api/admin/students/${id}`));
    expect(detail.student).toMatchObject({ source: "admin", notes: "Old group member since 2022" });
    const list = await json(await admin.get(`/api/admin/students?source=admin&q=${encodeURIComponent(email)}`));
    expect(list.items.map((s: any) => s.id)).toEqual([id]);
    expect((await json(await admin.get(`/api/admin/students?source=import&q=${encodeURIComponent(email)}`))).items).toEqual([]);
  });

  it("nobody can sign in to it with a password they guess, and the sign-up form tells them to use 'Forgot your password?'", async () => {
    const admin = await as();
    const email = uniqueEmail("hand");
    await admin.post("/api/admin/students", { name: "No Password", email });
    for (const password of ["password", "", "correct-horse-battery"]) {
      const res = await new Client().post("/api/auth/login", { email, password: password || "x" });
      expect(res.status).toBe(401);
    }
    const signup = await new Client().post("/api/auth/register", { name: "Someone Else", email, password: "correct-horse-battery" });
    expect(signup.status).toBe(409);
    expect((await json(signup)).error.fields.email).toBe("email_taken");
  });

  it("keeps a number from another country, and refuses things that are not a phone number", async () => {
    const admin = await as();
    const abroad = uniqueEmail("abroad");
    expect((await admin.post("/api/admin/students", { name: "Abroad Student", email: abroad, phone: "+971 50 123 4567" })).status).toBe(201);
    expect((await rowOf(abroad)).phone).toBe("+971501234567");
    const bad = await admin.post("/api/admin/students", { name: "Bad Phone", email: uniqueEmail("bad"), phone: "12345" });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields.phone).toBe("invalid_phone");
  });

  it("refuses an address that is already in use (any capitals) and a name or address that is not valid", async () => {
    const admin = await as();
    const taken = await registerStudent();
    const res = await admin.post("/api/admin/students", { name: "Copy Cat", email: taken.email.toUpperCase() });
    expect(res.status).toBe(409);
    expect((await json(res)).error.fields.email).toBe("email_taken");
    const bad = await admin.post("/api/admin/students", { name: "A", email: "nope" });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields).toMatchObject({ name: "required", email: "invalid_email" });
  });

  it("gives classes from a date in the past: the student 'joined' that day, not today", async () => {
    const admin = await as();
    const [a, b] = [await newClass(), await newClass()];
    const email = uniqueEmail("old");
    const res = await admin.post("/api/admin/students", { name: "Old Student", email, course_ids: [a.id, b.id], enrolled_on: "2023-05-17" });
    expect(res.status).toBe(201);
    expect((await json(res)).granted).toBe(2);
    const row = await rowOf(email);
    expect(row.created_at).toBe("2023-05-17T06:00:00Z"); // noon in Dhaka
    const rows = await enrolments(row.id);
    expect(rows.map((e) => [e.course_id, e.status, e.source, e.order_id, e.enrolled_at])).toEqual([
      [a.id, "active", "admin", null, "2023-05-17T06:00:00Z"],
      [b.id, "active", "admin", null, "2023-05-17T06:00:00Z"],
    ]);
    expect(await ordersOf(row.id)).toEqual([]); // no payment was recorded, so nothing in Orders
  });

  it("records a payment already made: one paid order on that day with that day's invoice number, split across the classes, and no e-mail", async () => {
    const admin = await as();
    const [a, b] = [await newClass(1000), await newClass(2000)];
    const email = uniqueEmail("paid");
    const res = await admin.post("/api/admin/students", {
      name: "Paid Earlier",
      email,
      course_ids: [a.id, b.id],
      enrolled_on: "2023-05-17",
      payment: { amount: 1500, method: "bkash", txn_id: "8n7a6d5e", paid_on: "2023-05-18" },
    });
    expect(res.status).toBe(201);
    const student = await rowOf(email);
    const [order] = await ordersOf(student.id);
    expect(order).toMatchObject({
      status: "paid",
      subtotal: 1500,
      discount: 0,
      total: 1500,
      method: "bkash",
      gateway: "manual",
      gateway_txn: "8N7A6D5E",
      customer_email: email,
      paid_at: "2023-05-18T06:00:00Z",
      invoice_no: invoice("20230518", 1),
    });
    expect(order.note).toContain("Recorded by staff");
    const items = await itemsOf(order.id);
    expect(items.map((i) => [i.course_id, i.price])).toEqual([[a.id, 500], [b.id, 1000]]); // 1500 split by list price, nothing lost
    expect(items.reduce((s, i) => s + i.price, 0)).toBe(1500);
    expect((await enrolments(student.id)).map((e) => [e.source, e.order_id])).toEqual([["purchase", order.id], ["purchase", order.id]]);
    expect(await outbox(email)).toEqual([]); // a receipt for something paid years ago would only confuse them

    // the owner sees it in Orders, the student will see it among their own
    const listed = await json(await admin.get(`/api/admin/orders?q=${encodeURIComponent(email)}`));
    expect(listed.items.some((o: any) => o.id === order.id && o.status === "paid")).toBe(true);
  });

  it("numbers recorded sales one after the other for the same day, and leaves today's counter alone", async () => {
    const admin = await as();
    const cls = await newClass(900);
    const todayBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM invoice_counters WHERE day = ?").bind(new Date().toISOString().slice(0, 10).replaceAll("-", "")).first<{ n: number }>();
    for (const [i, expected] of [[1, 1], [2, 2]] as const) {
      const email = uniqueEmail(`seq${i}`);
      expect((await admin.post("/api/admin/students", { name: "Seq Student", email, course_ids: [cls.id], enrolled_on: "2022-11-03", payment: { amount: 900, method: "cash" } })).status).toBe(201);
      const [o] = await ordersOf((await rowOf(email)).id);
      expect(o.invoice_no).toBe(invoice("20221103", expected));
      expect(o).toMatchObject({ method: "manual", gateway: "manual", gateway_txn: null });
      expect(o.note).toContain("cash");
    }
    const todayAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM invoice_counters WHERE day = ?").bind(new Date().toISOString().slice(0, 10).replaceAll("-", "")).first<{ n: number }>();
    expect(todayAfter!.n).toBe(todayBefore!.n);
  });

  it("splits a payment for free classes equally instead of losing it", async () => {
    const admin = await as();
    const [a, b] = [await newClass(0), await newClass(0)];
    const email = uniqueEmail("free");
    expect((await admin.post("/api/admin/students", { name: "Free Classes", email, course_ids: [a.id, b.id], payment: { amount: 301, method: "other" } })).status).toBe(201);
    const [o] = await ordersOf((await rowOf(email)).id);
    expect((await itemsOf(o.id)).map((i) => i.price)).toEqual([150, 151]);
  });

  it("saves nothing at all when any part is wrong (no half-made student)", async () => {
    const admin = await as();
    const cls = await newClass();
    const first = uniqueEmail("first");
    await admin.post("/api/admin/students", { name: "First One", email: first, course_ids: [cls.id], payment: { amount: 500, method: "bkash", txn_id: "REUSE12345" } });

    // the same transaction id cannot pay twice
    const email = uniqueEmail("second");
    const reuse = await admin.post("/api/admin/students", { name: "Second One", email, course_ids: [cls.id], payment: { amount: 500, method: "bkash", txn_id: "reuse12345" } });
    expect(reuse.status).toBe(409);
    expect((await json(reuse)).error.fields["payment.txn_id"]).toBe("trx_used");
    expect(await rowOf(email)).toBeNull();

    const cases: [Record<string, unknown>, string, string][] = [
      [{ payment: { amount: 500, method: "cash" } }, "payment.amount", "amount_needs_class"],
      [{ course_ids: [cls.id], enrolled_on: "2999-01-01" }, "enrolled_on", "date_in_future"],
      [{ course_ids: [cls.id], enrolled_on: "1999-01-01" }, "enrolled_on", "date_too_old"],
      [{ course_ids: [cls.id], payment: { amount: 500, method: "cash", paid_on: "2999-01-01" } }, "payment.paid_on", "date_in_future"],
      [{ course_ids: [cls.id, 99999999] }, "course_ids", "invalid"],
      [{ course_ids: [cls.id], payment: { amount: -5, method: "cash" } }, "payment.amount", "invalid_amount"],
      [{ course_ids: [cls.id], payment: { amount: 5_000_000, method: "cash" } }, "payment.amount", "invalid_amount"],
    ];
    for (const [extra, field, code] of cases) {
      const e = uniqueEmail("bad");
      const res = await admin.post("/api/admin/students", { name: "Not Saved", email: e, ...extra });
      expect(res.status, `${field} ${code}`).toBe(422);
      expect((await json(res)).error.fields[field], `${field} ${code}`).toBe(code);
      expect(await rowOf(e), `${field} ${code}`).toBeNull();
    }
  });
});

describe("changing a student's details", () => {
  it("changes name, phone, language, note and the offers tick; an unknown field is ignored", async () => {
    const admin = await as();
    const s = await registerStudent();
    const res = await admin.patch(`/api/admin/students/${s.id}`, { name: "Renamed Student", phone: "+8801812345678", locale: "en", notes: "Called on Friday", marketing_opt_in: true, blocked: 1 });
    expect(res.status).toBe(200);
    expect(await rowOf(s.email)).toMatchObject({ name: "Renamed Student", phone: "01812345678", locale: "en", notes: "Called on Friday", marketing_opt_in: 1, blocked: 0 });
    expect((await (await as("support")).patch(`/api/admin/students/${s.id}`, { notes: "Support was here" })).status).toBe(200);
    expect((await (await as("viewer")).patch(`/api/admin/students/${s.id}`, { notes: "No" })).status).toBe(403);
    expect((await admin.patch("/api/admin/students/99999999", { notes: "x" })).status).toBe(404);
  });

  it("moves the sign-in to a new address, with a trail of from and to; the old address stops working", async () => {
    const admin = await as();
    const s = await registerStudent();
    const to = uniqueEmail("moved").toUpperCase();
    expect((await admin.patch(`/api/admin/students/${s.id}`, { email: to })).status).toBe(200);
    const row = await rowOf(to.toLowerCase());
    expect(row.id).toBe(s.id);
    expect(row.email_verified_at).toBeNull();

    expect((await new Client().post("/api/auth/login", { email: to.toLowerCase(), password: "correct-horse-battery" })).status).toBe(200);
    expect((await new Client().post("/api/auth/login", { email: s.email, password: "correct-horse-battery" })).status).toBe(401);

    const log = await env.DB.prepare("SELECT meta FROM activity_log WHERE action = 'student.updated' AND entity_id = ? ORDER BY id DESC").bind(String(s.id)).first<{ meta: string }>();
    expect(JSON.parse(log!.meta)).toMatchObject({ fields: ["email"], email_from: s.email, email_to: to.toLowerCase() });
  });

  it("refuses an address another student already has, and does not touch the other fields in that request", async () => {
    const admin = await as();
    const [a, b] = [await registerStudent(), await registerStudent()];
    const res = await admin.patch(`/api/admin/students/${a.id}`, { email: b.email, name: "Should Not Stick" });
    expect(res.status).toBe(409);
    expect((await json(res)).error.fields.email).toBe("email_taken");
    expect((await rowOf(a.email)).name).toBe("Test Student");
    // saving the same address again is not a clash with itself
    expect((await admin.patch(`/api/admin/students/${a.id}`, { email: a.email.toUpperCase(), name: "Same Address" })).status).toBe(200);
    expect((await rowOf(a.email)).name).toBe("Same Address");
  });
});

describe("giving a class to a student that already exists", () => {
  it("still accepts the old single-class request", async () => {
    const admin = await as();
    const s = await registerStudent();
    const cls = await newClass();
    const res = await admin.post(`/api/admin/students/${s.id}/enroll`, { course_id: cls.id });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ granted: 1, already_had: 0, invoice_no: null });
    expect((await enrolments(s.id)).map((e) => [e.course_id, e.source, e.status])).toEqual([[cls.id, "admin", "active"]]);
    expect((await admin.post(`/api/admin/students/${s.id}/enroll`, {})).status).toBe(422);
    expect((await admin.post(`/api/admin/students/${s.id}/enroll`, { course_id: 99999999 })).status).toBe(422);
    expect((await admin.post("/api/admin/students/99999999/enroll", { course_id: cls.id })).status).toBe(404);
  });

  it("several classes at once from a date, with the payment; classes they already have are left as they are and not paid for twice", async () => {
    const admin = await as();
    const s = await registerStudent();
    const [a, b, c] = [await newClass(600), await newClass(600), await newClass(600)];
    await admin.post(`/api/admin/students/${s.id}/enroll`, { course_id: a.id }); // already theirs
    const before = await orderCount();
    const res = await admin.post(`/api/admin/students/${s.id}/enroll`, { course_ids: [a.id, b.id, c.id], enrolled_on: "2021-02-03", payment: { amount: 1000, method: "nagad", txn_id: "NG12345678", paid_on: "2021-02-04" } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ granted: 2, already_had: 1, invoice_no: invoice("20210204", 1) });
    expect(await orderCount()).toBe(before + 1);
    const rows = await enrolments(s.id);
    expect(rows.find((e) => e.course_id === a.id)).toMatchObject({ source: "admin", order_id: null }); // the earlier grant stays as it was
    expect(rows.find((e) => e.course_id === b.id)).toMatchObject({ source: "purchase", enrolled_at: "2021-02-03T06:00:00Z" });
    const [order] = await ordersOf(s.id);
    expect((await itemsOf(order.id)).map((i) => i.course_id)).toEqual([b.id, c.id]);
    expect(order).toMatchObject({ total: 1000, method: "nagad", paid_at: "2021-02-04T06:00:00Z" });
  });

  it("when they already have every class there is nothing to pay for: no order is made", async () => {
    const admin = await as();
    const s = await registerStudent();
    const cls = await newClass();
    await admin.post(`/api/admin/students/${s.id}/enroll`, { course_id: cls.id });
    const res = await admin.post(`/api/admin/students/${s.id}/enroll`, { course_ids: [cls.id], payment: { amount: 700, method: "cash" } });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ granted: 0, already_had: 1, invoice_no: null });
    expect(await ordersOf(s.id)).toEqual([]);
  });

  it("brings back a class that was taken away, from the new date; refunding a recorded payment takes its classes away again", async () => {
    const admin = await as();
    const s = await registerStudent();
    const cls = await newClass(500);
    await admin.post(`/api/admin/students/${s.id}/enroll`, { course_id: cls.id });
    expect((await admin.post(`/api/admin/students/${s.id}/revoke`, { course_id: cls.id })).status).toBe(200);
    expect((await enrolments(s.id))[0].status).toBe("revoked");
    await admin.post(`/api/admin/students/${s.id}/enroll`, { course_ids: [cls.id], enrolled_on: "2020-01-15", payment: { amount: 500, method: "bank" } });
    const back = (await enrolments(s.id))[0];
    expect(back).toMatchObject({ status: "active", revoked_at: null, source: "purchase", enrolled_at: "2020-01-15T06:00:00Z" });

    const [order] = await ordersOf(s.id);
    expect((await admin.post(`/api/admin/orders/${order.id}/refund`, { reason: "Refunded in cash" })).status).toBe(200);
    expect((await enrolments(s.id))[0].status).toBe("revoked");
  });
});

describe("a way in for a student who has no password", () => {
  it("a link valid for three days lets them choose a password and see their classes and their payment", async () => {
    const admin = await as();
    const cls = await newClass(800);
    const email = uniqueEmail("invite");
    const { id } = await json(await admin.post("/api/admin/students", { name: "Invited Student", email, course_ids: [cls.id], enrolled_on: "2024-01-10", payment: { amount: 800, method: "bkash" } }));

    const res = await admin.post(`/api/admin/students/${id}/invite`, { mode: "link" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { link, days } = await json(res);
    expect(days).toBe(3);
    expect(link).toMatch(/\/app\/reset\/[A-Za-z0-9_-]{20,}$/);
    const token = await env.DB.prepare("SELECT expires_at FROM auth_tokens WHERE subject_type = 'student' AND subject_id = ? AND used_at IS NULL").bind(id).first<{ expires_at: string }>();
    const left = Date.parse(token!.expires_at) - Date.now();
    expect(left).toBeGreaterThan(2.9 * 86_400_000);
    expect(left).toBeLessThan(3.1 * 86_400_000);

    const student = new Client();
    expect((await student.post("/api/auth/reset", { token: link.split("/").pop(), password: "my-new-password-1" })).status).toBe(200);
    expect((await student.post("/api/auth/login", { email, password: "my-new-password-1" })).status).toBe(200);
    const mine = await json(await student.get("/api/student/courses"));
    expect(mine.courses.map((c: any) => c.course.slug)).toEqual([cls.slug]);
    const orders = await json(await student.get("/api/student/orders"));
    expect(orders.orders[0]).toMatchObject({ status: "paid", total: 800, invoice_no: invoice("20240110", 1) });
    // the link works once
    expect((await new Client().post("/api/auth/reset", { token: link.split("/").pop(), password: "another-password-2" })).status).toBe(400);
  });

  it("a newer link voids the older one", async () => {
    const admin = await as();
    const email = uniqueEmail("invite");
    const { id } = await json(await admin.post("/api/admin/students", { name: "Two Links", email }));
    const first = (await json(await admin.post(`/api/admin/students/${id}/invite`, { mode: "link" }))).link as string;
    const second = (await json(await admin.post(`/api/admin/students/${id}/invite`, { mode: "link" }))).link as string;
    expect((await new Client().post("/api/auth/reset", { token: first.split("/").pop(), password: "my-new-password-1" })).status).toBe(400);
    expect((await new Client().post("/api/auth/reset", { token: second.split("/").pop(), password: "my-new-password-1" })).status).toBe(200);
  });

  it("can be sent to them by e-mail in their language; the link in the e-mail is the one that works", async () => {
    const admin = await as();
    const email = uniqueEmail("invite");
    const { id } = await json(await admin.post("/api/admin/students", { name: "Mail Student", email, locale: "en" }));
    const res = await admin.post(`/api/admin/students/${id}/invite`, { mode: "email" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ sent: true, days: 3 });
    expect(body.link).toBeUndefined(); // when it is e-mailed, staff do not get to see it
    const [mail] = await outbox(email);
    expect(mail.subject).toContain("Your account is ready");
    const token = mail.text.match(/\/app\/reset\/([A-Za-z0-9_-]+)/)![1];
    expect((await new Client().post("/api/auth/reset", { token, password: "my-new-password-1" })).status).toBe(200);
  });

  it("is refused for a blocked student and for one that does not exist, and is on the trail", async () => {
    const admin = await as();
    const s = await registerStudent();
    await admin.post(`/api/admin/students/${s.id}/block`, { reason: "chargeback" });
    expect((await admin.post(`/api/admin/students/${s.id}/invite`, { mode: "link" })).status).toBe(409);
    expect((await admin.post("/api/admin/students/99999999/invite", { mode: "link" })).status).toBe(404);
    expect((await admin.post(`/api/admin/students/${s.id}/invite`, { mode: "carrier-pigeon" })).status).toBe(422);
    await admin.post(`/api/admin/students/${s.id}/unblock`, {});
    await admin.post(`/api/admin/students/${s.id}/invite`, { mode: "link" });
    const log = await env.DB.prepare("SELECT action FROM activity_log WHERE entity = 'student' AND entity_id = ? AND action LIKE 'student.invite%'").bind(String(s.id)).all<{ action: string }>();
    expect(log.results.map((r) => r.action)).toEqual(["student.invite_link"]);
  });
});

/* =================================================================================================== lists */
describe("checking a list before it is saved", () => {
  it("says for each line whether the person is new, already registered, or has a problem — and writes nothing", async () => {
    const admin = await as();
    const [a, b] = [await newClass(1000), await newClass(500)];
    const known = await registerStudent();
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'purchase')").bind(known.id, a.id).run();
    const fresh = uniqueEmail("fresh");

    const rows = [
      { name: "New Person", email: fresh, classes: a.slug },
      { name: "Test Student", email: known.email, classes: `${a.slug}; ${b.slug}`, amount: "800", method: "bKash" },
      { name: "Bad Mail", email: "nope", classes: a.slug },
      { name: "No Such Class", email: uniqueEmail("x"), classes: "Totally Unknown Class" },
      { name: "Bad Date", email: uniqueEmail("x"), classes: a.slug, enrolled_on: "31/02/2024" },
      { name: "Future Date", email: uniqueEmail("x"), classes: a.slug, enrolled_on: "2999-01-01" },
      { name: "Money No Class", email: uniqueEmail("x"), amount: "500" },
      { name: "Bad Amount", email: uniqueEmail("x"), classes: a.slug, amount: "five hundred" },
      { name: "Bad Phone", email: uniqueEmail("x"), phone: "123" },
      { name: "Bad Language", email: uniqueEmail("x"), language: "Klingon" },
      { name: "", email: uniqueEmail("x") },
      { name: "Same As First", email: fresh.toUpperCase(), classes: b.slug },
    ];
    const students = await studentCount();
    const orders = await orderCount();
    const res = await admin.post("/api/admin/students/import/preview", { rows });
    expect(res.status).toBe(200);
    const { results, summary } = await json(res);

    const code = (i: number) => results[i].problems.map((p: any) => `${p.field}:${p.code}`);
    expect(results.map((r: any) => r.status)).toEqual(["new", "existing", "problem", "problem", "problem", "problem", "problem", "problem", "problem", "problem", "problem", "existing"]);
    expect(code(2)).toEqual(["email:invalid_email"]);
    expect(code(3)).toEqual(["classes:class_not_found"]);
    expect(results[3].problems[0].value).toBe("Totally Unknown Class");
    expect(code(4)).toEqual(["enrolled_on:invalid_date"]);
    expect(code(5)).toEqual(["enrolled_on:date_in_future"]);
    expect(code(6)).toEqual(["amount:amount_needs_class"]);
    expect(code(7)).toEqual(["amount:invalid_amount"]);
    expect(code(8)).toEqual(["phone:invalid_phone"]);
    expect(code(9)).toEqual(["language:invalid_language"]);
    expect(code(10)).toEqual(["name:required"]);

    // the known student already has class A, so only B is new and the 800 pays for B alone
    expect(results[1].classes.map((c: any) => [c.id, c.already])).toEqual([[a.id, true], [b.id, false]]);
    expect(results[1].payment).toMatchObject({ amount: 800, method: "bkash" });
    // a line with the same address as an earlier line is joined to it
    expect(results[11].warnings).toEqual([{ code: "merged_with_row", value: "1" }]);
    expect(summary).toMatchObject({ new_students: 1, existing_students: 2, problem_rows: 9, classes_added: 3, payments: 1, amount: 800 });

    expect(await studentCount()).toBe(students);
    expect(await orderCount()).toBe(orders);
  });

  it("finds a class by its web name, its English or Bangla title (capitals and punctuation do not matter), or a link to its page; names with commas are fine", async () => {
    const admin = await as();
    const plain = await newClass(100, { title_en: `Beginner's Baking, Level 1 ${Date.now()}`, title_bn: `শুরুর বেকিং ${Date.now()}` });
    const other = await newClass(100);
    const rows = [
      { name: "By Slug", email: uniqueEmail("m"), classes: plain.slug.toUpperCase() },
      { name: "By English", email: uniqueEmail("m"), classes: plain.title_en.toLowerCase().replace("'", "") },
      { name: "By Bangla", email: uniqueEmail("m"), classes: plain.title_bn },
      { name: "By Link", email: uniqueEmail("m"), classes: `https://mawahacademy.com/en/courses/${plain.slug}?ref=x` },
      { name: "Two Classes", email: uniqueEmail("m"), classes: `${plain.title_en}; ${other.slug}` },
      { name: "Comma Names", email: uniqueEmail("m"), classes: `${plain.slug}, ${other.slug}` },
    ];
    const { results } = await json(await admin.post("/api/admin/students/import/preview", { rows }));
    expect(results.map((r: any) => r.problems)).toEqual([[], [], [], [], [], []]);
    expect(results.map((r: any) => r.classes.map((c: any) => c.id))).toEqual([[plain.id], [plain.id], [plain.id], [plain.id], [plain.id, other.id], [plain.id, other.id]]);
  });

  it("says when two classes share a title, instead of guessing", async () => {
    const admin = await as();
    const title = `Twin Class ${Date.now()}`;
    await newClass(100, { title_en: title });
    await newClass(100, { title_en: title });
    const { results } = await json(await admin.post("/api/admin/students/import/preview", { rows: [{ name: "Twin Fan", email: uniqueEmail("t"), classes: title }] }));
    expect(results[0].problems).toEqual([{ field: "classes", code: "class_ambiguous", value: title }]);
  });

  it("refuses an empty list, a list longer than a thousand lines, and a save of more than fifty", async () => {
    const admin = await as();
    expect((await admin.post("/api/admin/students/import/preview", { rows: [] })).status).toBe(422);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Person ${i}`, email: `bulk${i}@example.test` }));
    expect((await admin.post("/api/admin/students/import/preview", { rows: many(1001) })).status).toBe(422);
    expect((await admin.post("/api/admin/students/import/preview", { rows: many(1000) })).status).toBe(200);
    expect((await admin.post("/api/admin/students/import", { rows: many(51) })).status).toBe(422);
    expect((await admin.post("/api/admin/students/import", { rows: [{ name: "Short", email: "x".repeat(300) }] })).status).toBe(200); // an address that long is a problem line, not a crash
  });
});

describe("saving a list", () => {
  it("adds the new people with their classes, dates and payments, and the saved result is what the check said", async () => {
    const admin = await as();
    const [a, b] = [await newClass(1000), await newClass(2000)];
    const [e1, e2] = [uniqueEmail("imp"), uniqueEmail("imp")];
    const rows = [
      { name: "রিনা আক্তার", email: e1, phone: "০১৭১২৩৪৫৬৭৮", language: "বাংলা", notes: "Old WhatsApp group", classes: `${a.slug}; ${b.slug}`, enrolled_on: "১৫/০৩/২০২৪", amount: "৳১,৫০০", method: "বিকাশ", txn_id: "9z8y7x6w5v" },
      { name: "Karim Hossain", email: e2, language: "en", classes: a.slug, enrolled_on: "2023-12-01" },
    ];
    const checked = await json(await admin.post("/api/admin/students/import/preview", { rows }));
    const res = await admin.post("/api/admin/students/import", { rows });
    expect(res.status).toBe(200);
    const saved = await json(res);
    expect(saved.results).toEqual(checked.results);
    expect(saved.summary).toEqual({ new_students: 2, existing_students: 0, problem_rows: 0, classes_added: 3, payments: 1, amount: 1500 });

    const rina = await rowOf(e1);
    expect(rina).toMatchObject({ name: "রিনা আক্তার", phone: "01712345678", locale: "bn", notes: "Old WhatsApp group", source: "import", created_at: "2024-03-15T06:00:00Z" });
    expect(rina.password_hash).toBeNull();
    const [order] = await ordersOf(rina.id);
    expect(order).toMatchObject({ status: "paid", total: 1500, method: "bkash", gateway_txn: "9Z8Y7X6W5V", paid_at: "2024-03-15T06:00:00Z", invoice_no: invoice("20240315", 1) });
    expect((await itemsOf(order.id)).map((i) => i.price)).toEqual([500, 1000]);
    expect((await enrolments(rina.id)).map((e) => [e.course_id, e.source, e.order_id])).toEqual([[a.id, "purchase", order.id], [b.id, "purchase", order.id]]);
    const karim = await rowOf(e2);
    expect(karim).toMatchObject({ locale: "en", source: "import", created_at: "2023-12-01T06:00:00Z" });
    expect(await ordersOf(karim.id)).toEqual([]);
    expect((await enrolments(karim.id))[0]).toMatchObject({ course_id: a.id, source: "admin", enrolled_at: "2023-12-01T06:00:00Z" });
    expect(await outbox(e1)).toEqual([]); // saving a list never sends anyone an e-mail
    expect(await outbox(e2)).toEqual([]);

    const list = await json(await admin.get(`/api/admin/students?source=import&q=${encodeURIComponent(e1)}`));
    expect(list.items.map((s: any) => s.id)).toEqual([rina.id]);
  });

  it("can be saved again safely: nobody is added twice and the same payment is not recorded twice", async () => {
    const admin = await as();
    const cls = await newClass(700);
    const email = uniqueEmail("again");
    const rows = [{ name: "Twice Saved", email, classes: cls.slug, amount: "700", enrolled_on: "2022-08-09", txn_id: "AGAIN123456" }];
    await admin.post("/api/admin/students/import", { rows });
    const students = await studentCount();
    const orders = await orderCount();
    const again = await json(await admin.post("/api/admin/students/import", { rows }));
    expect(again.results[0]).toMatchObject({ status: "existing", payment: null });
    expect(again.results[0].warnings).toEqual([{ code: "payment_skipped" }]);
    expect(again.summary).toMatchObject({ new_students: 0, existing_students: 1, classes_added: 0, payments: 0 });
    expect(await studentCount()).toBe(students);
    expect(await orderCount()).toBe(orders);
  });

  it("an existing student gets the classes and any blank phone or note, but their own name, phone and password are never changed", async () => {
    const admin = await as();
    const cls = await newClass(300);
    const s = await registerStudent(undefined, { name: "Real Name", phone: undefined });
    await env.DB.prepare("UPDATE students SET phone = NULL WHERE id = ?").bind(s.id).run();
    const res = await json(await admin.post("/api/admin/students/import", { rows: [{ name: "Name In Old Sheet", email: s.email, phone: "01911223344", notes: "from the old sheet", classes: cls.slug }] }));
    expect(res.results[0]).toMatchObject({ status: "existing" });
    expect(res.results[0].warnings).toEqual([{ code: "kept_details" }]);
    const row = await rowOf(s.email);
    expect(row).toMatchObject({ name: "Real Name", phone: "01911223344", notes: "from the old sheet", source: "signup" });
    expect(row.password_hash).toMatch(/^pbkdf2/);
    expect((await enrolments(s.id)).map((e) => e.course_id)).toEqual([cls.id]);

    // a phone they already have stays
    await admin.post("/api/admin/students/import", { rows: [{ name: "Real Name", email: s.email, phone: "01600000000", notes: "another note" }] });
    expect(await rowOf(s.email)).toMatchObject({ phone: "01911223344", notes: "from the old sheet" });
  });

  it("joins two lines with the same address, even when they are saved in different parts", async () => {
    const admin = await as();
    const [a, b, c] = [await newClass(), await newClass(), await newClass()];
    const email = uniqueEmail("join");
    const together = await json(await admin.post("/api/admin/students/import", { rows: [{ name: "Joined Person", email, classes: a.slug }, { name: "Joined Person", email: email.toUpperCase(), classes: `${a.slug}; ${b.slug}` }] }));
    expect(together.results.map((r: any) => r.status)).toEqual(["new", "existing"]);
    expect(together.results[1].classes.map((x: any) => [x.id, x.already])).toEqual([[a.id, true], [b.id, false]]);
    const laterPart = await json(await admin.post("/api/admin/students/import", { rows: [{ name: "Joined Person", email, classes: c.slug }] }));
    expect(laterPart.results[0].status).toBe("existing");
    const row = await rowOf(email);
    expect((await enrolments(row.id)).map((e) => e.course_id)).toEqual([a.id, b.id, c.id]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM students WHERE email = ?").bind(email).first<{ n: number }>())!.n).toBe(1);
  });

  it("does not let one transaction id pay for two lines, in the same list or in a later part", async () => {
    const admin = await as();
    const cls = await newClass(400);
    const rows = [
      { name: "Pays First", email: uniqueEmail("trx"), classes: cls.slug, amount: "400", txn_id: "SAMETRX1234" },
      { name: "Pays Second", email: uniqueEmail("trx"), classes: cls.slug, amount: "400", txn_id: "sametrx1234" },
    ];
    const first = await json(await admin.post("/api/admin/students/import", { rows }));
    expect(first.results.map((r: any) => r.status)).toEqual(["new", "problem"]);
    expect(first.results[1].problems).toEqual([{ field: "txn_id", code: "trx_used", value: "SAMETRX1234" }]);
    expect(await rowOf(rows[1].email)).toBeNull();
    const later = await json(await admin.post("/api/admin/students/import", { rows: [{ name: "Pays Third", email: uniqueEmail("trx"), classes: cls.slug, amount: "400", txn_id: "SAMETRX1234" }] }));
    expect(later.results[0].problems[0].code).toBe("trx_used");
  });

  it("keeps a reference that is not a real transaction id in the note instead of rejecting the line", async () => {
    const admin = await as();
    const cls = await newClass(250);
    const email = uniqueEmail("ref");
    await admin.post("/api/admin/students/import", { rows: [{ name: "Old Receipt", email, classes: cls.slug, amount: "250", method: "cash in hand", txn_id: "receipt 12" }] });
    const [order] = await ordersOf((await rowOf(email)).id);
    expect(order).toMatchObject({ gateway_txn: null, method: "manual" });
    expect(order.note).toContain("cash");
    expect(order.note).toContain("reference: receipt 12");
  });

  it("is on the trail, once per saved part, with the counts", async () => {
    const admin = await as();
    await admin.post("/api/admin/students/import", { rows: [{ name: "Trail One", email: uniqueEmail("trail") }, { name: "Trail Two", email: "bad" }] });
    const log = await env.DB.prepare("SELECT summary, meta FROM activity_log WHERE action = 'students.imported' ORDER BY id DESC").first<{ summary: string; meta: string }>();
    expect(log!.summary).toBe("1 new, 0 existing, 1 skipped");
    expect(JSON.parse(log!.meta)).toMatchObject({ new_students: 1, problem_rows: 1 });
  });
});

describe("the student list and its spreadsheet", () => {
  it("shows how each person joined and the note, and a name that looks like a spreadsheet formula cannot run when the file is opened", async () => {
    const admin = await as();
    const email = uniqueEmail("csv");
    await admin.post("/api/admin/students", { name: '=HYPERLINK("http://evil.test","click")', email, notes: "+SUM(1)" });
    const res = await admin.get(`/api/admin/students/export.csv?source=admin&q=${encodeURIComponent(email)}`);
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("How they joined");
    expect(csv).toContain("Note");
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
    expect(csv).toContain("'+SUM(1)");
    expect(csv).toContain(",admin,");
  });
});

describe("students who came through checkout", () => {
  it("are listed only once they have a class, are found by their student ID, and say how they joined", async () => {
    const admin = await as();
    const cls = await newClass(500);
    const email = uniqueEmail("buyer");
    const out = await json(await new Client().post("/api/checkout/guest", { name: "Buyer One", email, phone: "01711000111", address: "House 3, Road 4, Gulshan, Dhaka", lang: "en", courses: [cls.slug], channel: "mock" }));
    const code = out.student.code as string;
    expect(code).toMatch(/^STU-\d{6,}$/);
    // started, not paid: not a student yet — not even when searched for by ID
    expect((await json(await admin.get(`/api/admin/students?q=${code}`))).items).toEqual([]);

    const sig = await mockSignature(env, out.order.public_id, "paid");
    await new Client().fetch("/api/payments/mock/webhook", { method: "POST", form: { order: out.order.public_id, status: "paid", sig } });
    const byCode = (await json(await admin.get(`/api/admin/students?q=${code.toLowerCase()}`))).items as { email: string; source: string; enrollments: number }[];
    expect(byCode.map((x) => x.email)).toEqual([email]);
    expect(byCode[0]).toMatchObject({ source: "checkout", enrollments: 1 });
    expect((await json(await admin.get(`/api/admin/students?source=checkout&q=${encodeURIComponent(email)}`))).items).toHaveLength(1);
    expect((await json(await admin.get(`/api/admin/students?source=signup&q=${encodeURIComponent(email)}`))).items).toHaveLength(0);

    // the spreadsheet carries the ID and how they joined
    const csv = await (await admin.get(`/api/admin/students/export.csv?q=${encodeURIComponent(email)}`)).text();
    expect(csv.split("\n")[0]).toContain("Student ID");
    expect(csv).toContain(code);
    expect(csv).toContain("checkout");
  });
});
