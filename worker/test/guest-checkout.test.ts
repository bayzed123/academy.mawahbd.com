import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSignature } from "../src/services/payments";
import { GUEST_KEEP_DAYS, purgeAbandonedGuests } from "../src/services/guests";
import { getSettings, setSetting } from "../src/lib/settings";
import { Client, env, json, loginStaff, registerStudent, uniqueEmail } from "./helpers";

/*
 * Buying without an account. A visitor gives a name, a mobile number and an e-mail and pays; the account is made for them and they are
 * signed in on that phone. What the owner cannot see, and these tests protect:
 *  - nobody is ever signed in to an account that has anything in it (a password, a class, a payment, an account staff added) just because
 *    they typed its e-mail — the only way to such an account is its password or an e-mailed link;
 *  - a visitor who only started to buy is not counted as a student, and is removed after 30 days; anything paid or waiting for staff never is;
 *  - once paid, the receipt carries the student ID and a link to choose a password, and that first password also signs the phone in;
 *  - nothing is created for a basket that cannot be bought, and a flood of new accounts from one address stops.
 */

afterEach(() => vi.restoreAllMocks());

let seq = 0;
async function makeCourse(price = 1500, status = "published") {
  const n = ++seq;
  const slug = `guest-test-${Date.now().toString(36)}-${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `গেস্ট ক্লাস ${n}`, `Guest Course ${n}`, price, status)
    .run();
  const courseId = res.meta.last_row_id as number;
  const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort) VALUES (?, 'মডিউল', 'Module', 1)").bind(courseId).run();
  await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, sort) VALUES (?, ?, 'লেসন', 'Lesson One', 'external', 'https://youtu.be/dQw4w9WgXcQ', 1)")
    .bind(courseId, mod.meta.last_row_id)
    .run();
  return { id: courseId, slug, title: `Guest Course ${n}` };
}

const ADDRESS = "House 12, Road 5, Dhanmondi, Dhaka";
const DETAILS = { name: "Rina Akter", phone: "01711223344", address: ADDRESS, lang: "en" };
const guestBody = (course: { slug: string }, over: Record<string, unknown> = {}) => ({ ...DETAILS, email: uniqueEmail("guest"), courses: [course.slug], channel: "mock", ...over });
const buy = (client: Client, body: Record<string, unknown>) => client.post("/api/checkout/guest", body);

async function pay(publicId: string) {
  const sig = await mockSignature(env, publicId, "paid");
  const res = await new Client().fetch("/api/payments/mock/webhook", { method: "POST", form: { order: publicId, status: "paid", sig } });
  expect(res.status).toBe(200);
}

const studentRow = (email: string) =>
  env.DB.prepare("SELECT id, name, phone, locale, source, password_hash, (SELECT COUNT(*) FROM orders o WHERE o.student_id = students.id) AS orders FROM students WHERE email = ?")
    .bind(email)
    .first<{ id: number; name: string; phone: string; locale: string; source: string; password_hash: string | null; orders: number }>();

const mailsTo = async (to: string) => (await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(to)}`))).messages as { subject: string; text: string; html: string }[];
async function until<T>(fn: () => Promise<T | null | false | undefined>, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const setCookies = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]);
/** the class slugs in the answer of GET /api/student/courses */
const slugs = (res: { courses: { course?: { slug: string }; slug?: string }[] }) => res.courses.map((c) => c.course?.slug ?? c.slug);

describe("seeing the price needs no account", () => {
  it("a visitor can ask for a price, a coupon's effect and the ways to pay", async () => {
    const course = await makeCourse(2000);
    const res = await new Client().post("/api/checkout/quote", { courses: [course.slug] });
    expect(res.status).toBe(200);
    const { quote } = await json(res);
    expect(quote).toMatchObject({ subtotal: 2000, discount: 0, total: 2000 });
    expect(quote.channels).toContain("mock");
    expect((await new Client().post("/api/checkout/quote", { courses: ["no-such-class"] })).status).toBe(422);
  });
});

describe("a visitor buys", () => {
  it("is given an account (no password yet), is signed in on this phone, and is not a student until the payment arrives", async () => {
    const course = await makeCourse(1500);
    const visitor = new Client();
    const body = guestBody(course);
    const res = await buy(visitor, body);
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out.redirect_url).toMatch(/\/api\/payments\/mock\/pay\//);
    expect(out.order).toMatchObject({ status: "pending", total: 1500 });
    expect(out.student).toMatchObject({ name: "Rina Akter", email: body.email, phone: "01711223344", has_password: false });
    expect(out.student.code).toMatch(/^STU-\d{6,}$/);

    // signed in: the very next request knows who they are, and the cookie is the ordinary student one
    expect(setCookies(res).some((c) => c.startsWith("mawah_sid="))).toBe(true);
    const me = await json(await visitor.get("/api/auth/me"));
    expect(me.student).toMatchObject({ email: body.email, has_password: false, code: out.student.code });

    const row = await studentRow(body.email as string);
    expect(row).toMatchObject({ source: "checkout", password_hash: null, locale: "en", orders: 1 });

    // …but the staff do not count or list them yet: nothing was paid
    const admin = (await loginStaff()).client;
    expect((await json(await admin.get(`/api/admin/students?q=${encodeURIComponent(body.email as string)}`))).items).toHaveLength(0);
    const csv = await (await admin.get("/api/admin/students/export.csv")).text();
    expect(csv).not.toContain(body.email as string);
    // the order is there for follow-up, with the details the visitor typed
    const orders = (await json(await admin.get(`/api/admin/orders?q=${encodeURIComponent(body.email as string)}`))).items as { customer_name: string; customer_phone: string; status: string }[];
    expect(orders[0]).toMatchObject({ customer_name: "Rina Akter", customer_phone: "01711223344", status: "pending" });
  });

  it("becomes a real student when the payment arrives: enrolled, listed and counted, with a receipt that has the student ID and a link to choose a password", async () => {
    const course = await makeCourse(1500);
    const admin = (await loginStaff()).client;
    const before = (await json(await admin.get("/api/admin/dashboard"))).kpis.students_total as number;
    const visitor = new Client();
    const body = guestBody(course);
    const out = await json(await buy(visitor, body));
    expect((await json(await admin.get("/api/admin/dashboard"))).kpis.students_total).toBe(before); // an unpaid visitor is not a student
    await pay(out.order.public_id);

    const mine = await json(await visitor.get("/api/student/courses"));
    expect(slugs(mine)).toContain(course.slug);
    expect((await json(await admin.get("/api/admin/dashboard"))).kpis.students_total).toBe(before + 1);
    const listed = (await json(await admin.get(`/api/admin/students?q=${encodeURIComponent(body.email as string)}`))).items as { enrollments: number }[];
    expect(listed).toHaveLength(1);
    expect(listed[0].enrollments).toBe(1);

    const receipt = await until(async () => (await mailsTo(body.email as string)).find((m) => /enrollment is confirmed/.test(m.subject)));
    expect(receipt.text).toContain(out.student.code);
    expect(receipt.text).toMatch(/\/app\/reset\/[A-Za-z0-9_-]{20,}/);
    expect(receipt.html).toContain("Choose a password");
    const link = await env.DB.prepare("SELECT expires_at FROM auth_tokens WHERE subject_type = 'student' AND subject_id = ? AND kind = 'password_reset'").bind(out.student.id).first<{ expires_at: string }>();
    const days = (Date.parse(link!.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThanOrEqual(3);

    // the owner's note says who, with the ID, and that the account is new
    const note = await until(async () => (await mailsTo("mawahacademy@gmail.com")).find((m) => /New payment received/.test(m.subject) && m.text.includes(body.email as string)));
    expect(note.text).toContain(out.student.code);
    expect(note.text).toMatch(/Account[^\n]*New/);
  });

  it("choosing the first password through the receipt link also signs that phone in; later a forgotten password still does not", async () => {
    const course = await makeCourse(900);
    const body = guestBody(course);
    const out = await json(await buy(new Client(), body));
    await pay(out.order.public_id);
    const receipt = await until(async () => (await mailsTo(body.email as string)).find((m) => /enrollment is confirmed/.test(m.subject)));
    const token = receipt.text.match(/\/app\/reset\/([A-Za-z0-9_-]+)/)![1];

    const elsewhere = new Client(); // another phone: no session yet
    expect((await elsewhere.get("/api/student/courses")).status).toBe(401);
    const reset = await elsewhere.post("/api/auth/reset", { token, password: "my-first-password-9" });
    expect(reset.status).toBe(200);
    const done = await json(reset);
    expect(done.student).toMatchObject({ email: body.email, has_password: true });
    expect((await elsewhere.get("/api/student/courses")).status).toBe(200);
    // the link works once
    expect((await new Client().post("/api/auth/reset", { token, password: "another-password-9" })).status).toBe(400);
    // and the password works for an ordinary log-in
    expect((await new Client().post("/api/auth/login", { email: body.email, password: "my-first-password-9" })).status).toBe(200);

    // a student who already had a password and forgot it gets no session from the reset (unchanged behaviour)
    const old = await registerStudent();
    await old.client.post("/api/auth/forgot", { email: old.email });
    const row = await env.DB.prepare("SELECT id FROM students WHERE email = ?").bind(old.email).first<{ id: number }>();
    const { createPasswordResetLink } = await import("../src/services/auth");
    const forgotLink = await createPasswordResetLink(env, row!.id);
    const forgotten = new Client();
    const again = await forgotten.post("/api/auth/reset", { token: forgotLink.split("/").pop(), password: "brand-new-password-9" });
    expect(again.status).toBe(200);
    expect((await json(again)).student).toBeUndefined();
    expect((await forgotten.get("/api/student/courses")).status).toBe(401);
  });

  it("can choose a password right away while signed in (once), and the phone stays signed in", async () => {
    const course = await makeCourse(700);
    const visitor = new Client();
    const body = guestBody(course);
    await buy(visitor, body);
    expect((await visitor.post("/api/auth/set-password", { password: "short" })).status).toBe(422);
    const res = await visitor.post("/api/auth/set-password", { password: "chosen-right-away-7" });
    expect(res.status).toBe(200);
    expect((await json(res)).student.has_password).toBe(true);
    expect((await json(await visitor.get("/api/auth/me"))).student.has_password).toBe(true);
    expect((await visitor.post("/api/auth/set-password", { password: "a-second-password-7" })).status).toBe(409); // from now on: change-password, which asks for the current one
    expect((await new Client().post("/api/auth/login", { email: body.email, password: "chosen-right-away-7" })).status).toBe(200);
    expect((await new Client().post("/api/auth/set-password", { password: "chosen-right-away-7" })).status).toBe(401);
  });

  it("a registered student sees their own ID and has_password true", async () => {
    const { client } = await registerStudent();
    const me = (await json(await client.get("/api/auth/me"))).student;
    expect(me.code).toMatch(/^STU-\d{6,}$/);
    expect(me.has_password).toBe(true);
  });

  it("a class that is free enrols at once, signs them in, and the account is a real student straight away", async () => {
    const course = await makeCourse(0);
    const visitor = new Client();
    const body = guestBody(course, { channel: undefined });
    const res = await buy(visitor, body);
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out.order).toMatchObject({ status: "paid", total: 0 });
    const mine = await json(await visitor.get("/api/student/courses"));
    expect(slugs(mine)).toContain(course.slug);
    const receipt = await until(async () => (await mailsTo(body.email as string)).find((m) => /enrollment is confirmed/.test(m.subject)));
    expect(receipt.text).toMatch(/\/app\/reset\//);
  });

  it("a send-money payment works from the same phone: the order is theirs, proof needs the log-in the visitor now has, staff approve, class opens", async () => {
    const course = await makeCourse(1200);
    const before = (await getSettings(env, { fresh: true })).payments;
    await setSetting(env, "payments", { ...before, manual: true, manual_numbers: { bkash: "01711111111", nagad: "", rocket: "" } }, null);
    try {
      const visitor = new Client();
      const body = guestBody(course, { channel: "manual", manual: { method: "bkash", payer_number: "01711223344" } });
      const res = await buy(visitor, body);
      expect(res.status).toBe(201);
      const out = await json(res);
      expect(out.order.status).toBe("pending");
      expect(out.order.pay_by).toBeTruthy();
      expect(out.student.has_password).toBe(false);

      // proof: not for a stranger, yes for the visitor who is signed in
      expect((await new Client().post(`/api/checkout/${out.order.public_id}/proof`, { trx_id: "ABC123XYZ9" })).status).toBe(401);
      const proof = await visitor.post(`/api/checkout/${out.order.public_id}/proof`, { trx_id: "ABC123XYZ9" });
      expect(proof.status).toBe(200);
      expect((await json(proof)).order.status).toBe("awaiting_verification");

      // staff approve; the class opens for the phone that is still signed in; the account is a real student now
      const admin = (await loginStaff()).client;
      const orderId = (await env.DB.prepare("SELECT id FROM orders WHERE public_id = ?").bind(out.order.public_id).first<{ id: number }>())!.id;
      expect((await admin.post(`/api/admin/orders/${orderId}/approve`, {})).status).toBe(200);
      const mine = await json(await visitor.get("/api/student/courses"));
      expect(slugs(mine)).toContain(course.slug);
      const receipt = await until(async () => (await mailsTo(body.email as string)).find((m) => /enrollment is confirmed/.test(m.subject)));
      expect(receipt.text).toMatch(/\/app\/reset\//);
    } finally {
      await setSetting(env, "payments", before, null);
    }
  });
});

describe("an e-mail that belongs to someone is never opened by typing it", () => {
  it("a registered student: the buyer is told to sign in, gets no session and no order is made", async () => {
    const course = await makeCourse(1500);
    const owner = await registerStudent();
    const stranger = new Client();
    const res = await buy(stranger, guestBody(course, { email: owner.email.toUpperCase(), name: "Someone Else" }));
    expect(res.status).toBe(409);
    const { error } = await json(res);
    expect(error.code).toBe("account_exists");
    expect(error.fields.email).toBe("account_exists");
    expect(setCookies(res).some((c) => c.startsWith("mawah_sid="))).toBe(false);
    expect((await stranger.get("/api/auth/me")).status).toBe(200);
    expect((await json(await stranger.get("/api/auth/me"))).student).toBeNull();
    const row = await studentRow(owner.email);
    expect(row!.orders).toBe(0);
    expect(row!.name).toBe("Test Student"); // not renamed either
  });

  it("an account staff added or imported has no password, and still is not opened — the buyer is offered an e-mailed link instead", async () => {
    const course = await makeCourse(1500);
    const email = uniqueEmail("imported");
    await env.DB.prepare("INSERT INTO students (email, name, phone, password_hash, source) VALUES (?, 'Old Student', '01999999999', NULL, 'import')").bind(email).run();
    const res = await buy(new Client(), guestBody(course, { email }));
    expect(res.status).toBe(409);
    expect((await json(res)).error.fields.email).toBe("account_exists_link");
    expect((await studentRow(email))!.orders).toBe(0);
  });

  it("an account made at checkout that already has a class or a payment waiting is not opened either", async () => {
    const course = await makeCourse(1500);
    const other = await makeCourse(800);
    // …a class
    const first = guestBody(other);
    const out = await json(await buy(new Client(), first));
    await pay(out.order.public_id);
    expect((await buy(new Client(), guestBody(course, { email: first.email }))).status).toBe(409);
    // …a payment sent and waiting for staff
    const second = guestBody(other);
    const waiting = await json(await buy(new Client(), second));
    await env.DB.prepare("UPDATE orders SET status = 'awaiting_verification' WHERE public_id = ?").bind(waiting.order.public_id).run();
    expect((await buy(new Client(), guestBody(course, { email: second.email }))).status).toBe(409);
  });

  it("the same visitor coming back unpaid — maybe on another phone — gets the same account with the details they typed now; an earlier send-money attempt is let go, a gateway attempt is not", async () => {
    const course = await makeCourse(1500);
    const before = (await getSettings(env, { fresh: true })).payments;
    await setSetting(env, "payments", { ...before, manual: true, manual_numbers: { bkash: "01711111111", nagad: "", rocket: "" } }, null);
    try {
      const email = uniqueEmail("again");
      const money = await json(await buy(new Client(), guestBody(course, { email, name: "First Typed", phone: "01711111111", channel: "manual", manual: { method: "bkash", payer_number: "01711111111" } })));
      const gateway = await json(await buy(new Client(), guestBody(course, { email, name: "First Typed", phone: "01711111111" })));
      expect(gateway.student.id).toBe(money.student.id);
      const second = await buy(new Client(), guestBody(course, { email, name: "Second Typed", phone: "01722222222" }));
      expect(second.status).toBe(201);
      const out = await json(second);
      expect(out.student.id).toBe(money.student.id);
      expect(await studentRow(email)).toMatchObject({ name: "Second Typed", phone: "01722222222", source: "checkout" });
      const sent = await env.DB.prepare("SELECT status, note, payer_number FROM orders WHERE public_id = ?").bind(money.order.public_id).first<{ status: string; note: string; payer_number: string | null }>();
      expect(sent).toMatchObject({ status: "cancelled", note: "superseded", payer_number: null });
      const online = await env.DB.prepare("SELECT status FROM orders WHERE public_id = ?").bind(gateway.order.public_id).first<{ status: string }>();
      expect(online!.status).toBe("pending"); // a payment may still arrive for it
    } finally {
      await setSetting(env, "payments", before, null);
    }
  });

  it("two clicks at once make one account", async () => {
    const course = await makeCourse(1500);
    const body = guestBody(course);
    const [a, b] = await Promise.all([buy(new Client(), body), buy(new Client(), body)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await json(a)).student.id).toBe((await json(b)).student.id);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM students WHERE email = ?").bind(body.email).first<{ n: number }>())!.n).toBe(1);
  });

  it("someone already signed in who uses this route buys as themselves; the typed details are ignored", async () => {
    const course = await makeCourse(1500);
    const { client, email } = await registerStudent();
    const res = await buy(client, guestBody(course, { email: uniqueEmail("ignored"), name: "Typed Name" }));
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out.student).toBeUndefined();
    const order = await env.DB.prepare("SELECT customer_email, customer_name FROM orders WHERE public_id = ?").bind(out.order.public_id).first<{ customer_email: string; customer_name: string }>();
    expect(order).toMatchObject({ customer_email: email, customer_name: "Test Student" });
  });
});

describe("what is asked for, and what is checked before an account is made", () => {
  it("name, a phone number and an address are required, and an e-mail is checked when given; Bangla digits and numbers from abroad are accepted", async () => {
    const course = await makeCourse(1500);
    const bad = await buy(new Client(), { courses: [course.slug], channel: "mock", name: "A", email: "nope", phone: "", address: "" });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields).toMatchObject({ name: "required", email: "invalid_email", phone: "required", address: "required" });
    expect((await json(await buy(new Client(), guestBody(course, { phone: "12345" })))).error.fields.phone).toBe("invalid_phone");

    const bn = guestBody(course, { phone: "০১৭১২৩৪৫৬৭৮" });
    expect((await buy(new Client(), bn)).status).toBe(201);
    expect((await studentRow(bn.email as string))!.phone).toBe("01712345678");
    const abroad = guestBody(course, { phone: "+1 (415) 555-2671" });
    expect((await buy(new Client(), abroad)).status).toBe(201);
    expect((await studentRow(abroad.email as string))!.phone).toBe("+14155552671");
  });

  it("a basket that cannot be bought, or a way of paying that is not offered, creates no account at all", async () => {
    const course = await makeCourse(1500);
    const gone = guestBody({ slug: "no-such-class" });
    expect((await buy(new Client(), gone)).status).toBe(422);
    expect(await studentRow(gone.email as string)).toBeNull();

    const noWay = guestBody(course, { channel: "bkash" }); // not set up on this copy of the site
    const res = await buy(new Client(), noWay);
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("payment_unavailable");
    expect(await studentRow(noWay.email as string)).toBeNull();

    const none = guestBody(course, { channel: undefined });
    expect((await buy(new Client(), none)).status).toBe(400);
    expect(await studentRow(none.email as string)).toBeNull();
  });

  it("asks the bot check when it is switched on, before anything is made", async () => {
    const course = await makeCourse(1500);
    const e = env as { TURNSTILE_SECRET?: string; TURNSTILE_SITE_KEY?: string };
    e.TURNSTILE_SECRET = "turnstile-test-secret";
    e.TURNSTILE_SITE_KEY = "turnstile-test-site";
    try {
      const body = guestBody(course);
      const res = await buy(new Client(), body);
      expect(res.status).toBe(400);
      expect((await json(res)).error.code).toBe("captcha");
      expect(await studentRow(body.email as string)).toBeNull();
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        if (String(input).includes("challenges.cloudflare.com")) return new Response(JSON.stringify({ success: true }));
        throw new Error("unexpected fetch");
      });
      expect((await buy(new Client(), { ...body, turnstile: "token-from-the-widget" })).status).toBe(201);
    } finally {
      e.TURNSTILE_SECRET = undefined;
      e.TURNSTILE_SITE_KEY = undefined;
    }
  });

  it("stops a flood of new accounts from one address", async () => {
    const course = await makeCourse(1500);
    const flood = new Client();
    const today = new Date().toISOString().slice(0, 10);
    await env.KV.put(`guest:ip:${flood.ip}:${today}`, "100", { expirationTtl: 600 });
    const body = guestBody(course);
    const res = await buy(flood, body);
    expect(res.status).toBe(429);
    expect(await studentRow(body.email as string)).toBeNull();
    // someone else is not affected
    expect((await buy(new Client(), guestBody(course))).status).toBe(201);
  });
});

describe("housekeeping: a visitor who never paid is forgotten after 30 days — and nobody else is", () => {
  it("removes the hidden account, its unpaid attempts and its screenshot; keeps anything paid, waiting, refunded, enrolled or with a password", async () => {
    const course = await makeCourse(1500);
    const make = async () => {
      const body = guestBody(course);
      const out = await json(await buy(new Client(), body));
      return { email: body.email as string, id: out.student.id as number, publicId: out.order.public_id as string };
    };
    const abandoned = await make();
    await env.R2.put(`proofs/test-${abandoned.id}.png`, new Uint8Array([1, 2, 3]));
    await env.DB.prepare("UPDATE orders SET proof_key = ? WHERE public_id = ?").bind(`proofs/test-${abandoned.id}.png`, abandoned.publicId).run();
    await env.DB.prepare("INSERT INTO payment_events (order_id, provider, event, verified, payload) VALUES ((SELECT id FROM orders WHERE public_id = ?), 'mock', 'x', 0, '{}')").bind(abandoned.publicId).run();

    const paid = await make();
    await pay(paid.publicId);
    const waiting = await make();
    await env.DB.prepare("UPDATE orders SET status = 'awaiting_verification' WHERE public_id = ?").bind(waiting.publicId).run();
    const refunded = await make();
    await env.DB.prepare("UPDATE orders SET status = 'refunded' WHERE public_id = ?").bind(refunded.publicId).run();
    const enrolled = await make();
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'purchase')").bind(enrolled.id, course.id).run();
    const withPassword = await make();
    await env.DB.prepare("UPDATE students SET password_hash = 'x' WHERE id = ?").bind(withPassword.id).run();
    const registered = await registerStudent();

    // 10 days on: too early for anyone
    expect(await purgeAbandonedGuests(env, new Date(Date.now() + 10 * 86_400_000))).toBe(0);
    expect(await studentRow(abandoned.email)).not.toBeNull();

    // 31 days on: only the one who never paid goes
    const removed = await purgeAbandonedGuests(env, new Date(Date.now() + (GUEST_KEEP_DAYS + 1) * 86_400_000));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await studentRow(abandoned.email)).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM orders WHERE public_id = ?").bind(abandoned.publicId).first()).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM order_items WHERE order_id NOT IN (SELECT id FROM orders)").first<{ n: number }>()).toMatchObject({ n: 0 });
    expect(await env.R2.get(`proofs/test-${abandoned.id}.png`)).toBeNull();
    for (const keep of [paid, waiting, refunded, enrolled, withPassword]) expect(await studentRow(keep.email), keep.email).not.toBeNull();
    expect(await studentRow(registered.email)).not.toBeNull();
  });

  it("a visitor who came back recently is kept even when the account is old", async () => {
    const course = await makeCourse(1500);
    const email = uniqueEmail("keeper");
    await buy(new Client(), guestBody(course, { email }));
    await env.DB.prepare("UPDATE students SET created_at = '2020-01-01T00:00:00Z', last_login_at = '2020-01-01T00:00:00Z' WHERE email = ?").bind(email).run();
    await buy(new Client(), guestBody(course, { email })); // back today: the same account, a fresh attempt
    await purgeAbandonedGuests(env, new Date());
    expect(await studentRow(email)).not.toBeNull();
  });
});
