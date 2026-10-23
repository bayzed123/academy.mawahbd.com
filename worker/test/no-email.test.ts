import { afterEach, describe, expect, it, vi } from "vitest";
import { noEmailAddress } from "@mawah/shared";
import { mockSignature } from "../src/services/payments";
import { setSetting } from "../src/lib/settings";
import { notices } from "../src/services/notify";
import { Client, env, json, loginStaff, registerStudent, uniqueEmail } from "./helpers";

/*
 * Buying with a name, a mobile number and an address — and an e-mail only if the buyer wants to give one. A buyer who gives none is known
 * by the mobile number: kept under a made-up address that is never shown, never mailed, and never used to sign in; told by text message;
 * and signed in by the number or the student ID. What the owner cannot see, and these tests protect:
 *  - the made-up address never appears on any screen, list, file or message;
 *  - a number that belongs to a student (a password, a class, a payment, an account staff added) is never opened by typing it;
 *  - a stranger cannot read or change an account by knowing its number, and cannot run up the SMS bill by asking for links;
 *  - the shop keeps working when texts are off or cannot be sent: nothing throws, the payment and the class go through.
 */

afterEach(() => vi.restoreAllMocks());

const ADDRESS = "House 12, Road 5, Dhanmondi, Dhaka";
let phoneSeq = Math.floor(Math.random() * 8_000_000) + 1_000_000;
/** a mobile number nobody else in the tests has */
const uniquePhone = () => `0171${String(phoneSeq++).padStart(7, "0")}`;

let seq = 0;
async function makeCourse(price = 1500) {
  const n = ++seq;
  const slug = `noemail-test-${Date.now().toString(36)}-${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, 'published', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `ফোন ক্লাস ${n}`, `Phone Course ${n}`, price)
    .run();
  const courseId = res.meta.last_row_id as number;
  const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort) VALUES (?, 'মডিউল', 'Module', 1)").bind(courseId).run();
  await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, sort) VALUES (?, ?, 'লেসন', 'Lesson One', 'external', 'https://youtu.be/dQw4w9WgXcQ', 1)")
    .bind(courseId, mod.meta.last_row_id)
    .run();
  return { id: courseId, slug };
}

/** what a buyer who gave no e-mail sends */
const guestBody = (course: { slug: string }, over: Record<string, unknown> = {}): Record<string, unknown> => ({ name: "Rina Akter", phone: uniquePhone(), address: ADDRESS, lang: "en", courses: [course.slug], channel: "mock", ...over });
const buy = (client: Client, body: Record<string, unknown>) => client.post("/api/checkout/guest", { agree: true, ...body });

async function pay(publicId: string) {
  const sig = await mockSignature(env, publicId, "paid");
  const res = await new Client().fetch("/api/payments/mock/webhook", { method: "POST", form: { order: publicId, status: "paid", sig } });
  expect(res.status).toBe(200);
}

interface Note {
  to: string;
  subject: string;
  text: string;
  html: string;
  sms?: boolean;
}
const outbox = async (to: string) => (await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(to)}`))).messages as Note[];
const smsTo = async (phone: string) => (await outbox(phone)).filter((m) => m.sms);
async function until<T>(fn: () => Promise<T | null | false | undefined>, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const tokenIn = (text: string) => /\/app\/reset\/([A-Za-z0-9_-]{20,})/.exec(text)?.[1];
const row = (id: number) => env.DB.prepare("SELECT email, name, phone, address, source, password_hash FROM students WHERE id = ?").bind(id).first<{ email: string; name: string; phone: string; address: string; source: string; password_hash: string | null }>();

/** a buyer with no e-mail who has paid */
async function paidBuyer(over: Record<string, unknown> = {}) {
  const course = await makeCourse();
  const body = guestBody(course, over);
  const visitor = new Client();
  const out = await json(await buy(visitor, body));
  await pay(out.order.public_id);
  return { body, out, visitor, course, phone: body.phone as string, code: out.student.code as string, id: out.student.id as number, publicId: out.order.public_id as string };
}

describe("buying with a mobile number and no e-mail", () => {
  it("is allowed: the buyer is known by the number and shown without any e-mail; the made-up address stays out of every list, file and screen", async () => {
    const course = await makeCourse(1500);
    const body = guestBody(course);
    const visitor = new Client();
    const res = await buy(visitor, body);
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out.student).toMatchObject({ name: "Rina Akter", email: "", phone: body.phone, address: ADDRESS, has_password: false });
    expect(out.student.code).toMatch(/^STU-\d{6,}$/);

    // kept under a made-up address in the reserved .invalid domain, which can never receive mail
    const stored = await row(out.student.id);
    expect(stored).toMatchObject({ email: noEmailAddress(body.phone as string), source: "checkout", password_hash: null, address: ADDRESS });
    expect(stored!.email).toMatch(/^p\d+@no-email\.invalid$/);

    // signed in on this phone, and told so without the made-up address
    const me = await json(await visitor.get("/api/auth/me"));
    expect(me.student).toMatchObject({ email: "", phone: body.phone, address: ADDRESS, code: out.student.code });

    await pay(out.order.public_id);
    const admin = (await loginStaff()).client;
    const found = (await json(await admin.get(`/api/admin/students?q=${out.student.code}`))).items as Record<string, unknown>[];
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "Rina Akter", email: "", phone: body.phone, address: ADDRESS, enrollments: 1 });
    expect((await json(await admin.get(`/api/admin/students?q=${body.phone}`))).items).toHaveLength(1); // found by the number, too
    const detail = await json(await admin.get(`/api/admin/students/${out.student.id}`));
    expect(detail.student).toMatchObject({ email: "", address: ADDRESS, has_password: 0 });

    const orders = (await json(await admin.get(`/api/admin/orders?q=${body.phone}`))).items as Record<string, unknown>[];
    expect(orders[0]).toMatchObject({ customer_email: "", customer_phone: body.phone, customer_address: ADDRESS, status: "paid" });
    const one = await json(await admin.get(`/api/admin/orders/${orders[0].id}`));
    expect(one.student).toMatchObject({ id: out.student.id, email: "" });

    for (const file of ["students", "orders"]) {
      const csv = await (await admin.get(`/api/admin/${file}/export.csv`)).text();
      expect(csv, file).toContain(ADDRESS);
      expect(csv, file).not.toContain("no-email.invalid");
    }
  });

  it("is told by text message, not by e-mail: the receipt has the student ID, the link to the class and a link to choose a password", async () => {
    const { phone, code, out } = await paidBuyer();
    const receipt = await until(async () => (await smsTo(phone)).find((m) => /payment received/.test(m.text)));
    expect(receipt.text).toContain(code);
    expect(receipt.text).toContain("Tk 1500");
    expect(receipt.text).toMatch(/https?:\/\/[^\s]+\/app\//);
    expect(tokenIn(receipt.text)).toBeTruthy();
    expect(receipt.text.length).toBeLessThanOrEqual(480);

    // nothing is mailed to the made-up address
    expect(await outbox(noEmailAddress(phone))).toHaveLength(0);
    // the owner's note names the buyer, the number and the address, and says no e-mail was given
    const note = await until(async () => (await outbox("mawahacademy@gmail.com")).find((m) => /New payment received/.test(m.subject) && m.text.includes(phone)));
    expect(note.text).toContain(code);
    expect(note.text).toContain(ADDRESS);
    expect(note.text).toMatch(/gave none/);
    expect(JSON.stringify(note)).not.toContain("no-email.invalid");
    expect(out.student.email).toBe("");
  });

  it("a text can be sent in Bangla, as one message (the buyer's language is kept)", async () => {
    const { phone } = await paidBuyer({ lang: "bn" });
    const receipt = await until(async () => (await smsTo(phone)).find((m) => /মাওয়াহ একাডেমি/.test(m.text)));
    expect(receipt.text).toContain("৳১,৫০০");
    expect(tokenIn(receipt.text)).toBeTruthy();
  });

  it("the owner can switch texts off, and can keep them for buyers with no e-mail only", async () => {
    const course = await makeCourse(900);
    const reset = () => setSetting(env, "sms", { enabled: true, sender_id: "", with_email: true }, null);
    try {
      // everyone with an e-mail gets both by default
      const email = uniqueEmail("both");
      const both = guestBody(course, { email });
      await pay((await json(await buy(new Client(), both))).order.public_id);
      await until(async () => (await outbox(email)).find((m) => /enrollment is confirmed/.test(m.subject)));
      await until(async () => (await smsTo(both.phone as string)).find((m) => /payment received/.test(m.text)));

      // "only buyers with no e-mail": a buyer with an e-mail gets the mail alone
      await setSetting(env, "sms", { enabled: true, sender_id: "", with_email: false }, null);
      const mailOnly = guestBody(course, { email: uniqueEmail("mailonly") });
      await pay((await json(await buy(new Client(), mailOnly))).order.public_id);
      await until(async () => (await outbox(mailOnly.email as string)).find((m) => /enrollment is confirmed/.test(m.subject)));
      // …while a buyer with no e-mail still gets the text: it is the only way to reach them
      const textOnly = guestBody(course);
      await pay((await json(await buy(new Client(), textOnly))).order.public_id);
      await until(async () => (await smsTo(textOnly.phone as string)).find((m) => /payment received/.test(m.text)));
      expect(await smsTo(mailOnly.phone as string)).toHaveLength(0);

      // switched off altogether: no text for anyone, and the payment still goes through
      await setSetting(env, "sms", { enabled: false, sender_id: "", with_email: true }, null);
      const quiet = guestBody(course);
      const out = await json(await buy(new Client(), quiet));
      await pay(out.order.public_id);
      const status = await env.DB.prepare("SELECT status FROM orders WHERE public_id = ?").bind(out.order.public_id).first<{ status: string }>();
      expect(status!.status).toBe("paid");
      await new Promise((r) => setTimeout(r, 150));
      expect(await smsTo(quiet.phone as string)).toHaveLength(0);
    } finally {
      await reset();
    }
  });

  it("a text that cannot be sent never breaks the payment or the class", async () => {
    const e = env as { SMS_API_KEY?: string; SMS_API_URL?: string };
    e.SMS_API_KEY = `sms${"-"}${"z".repeat(24)}`;
    e.SMS_API_URL = "https://sms.example.test";
    try {
      const real = globalThis.fetch;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://sms.example.test/")) throw new Error("connection refused");
        return real(input as RequestInfo, init);
      });
      const { visitor, course } = await paidBuyer();
      const mine = await json(await visitor.get("/api/student/courses"));
      expect(JSON.stringify(mine)).toContain(course.slug);
    } finally {
      e.SMS_API_KEY = undefined;
      e.SMS_API_URL = undefined;
      await env.KV.delete("sms:last");
    }
  });

  it("the invoice shows the address and leaves out an e-mail that was not given", async () => {
    const { visitor, publicId } = await paidBuyer();
    const res = await visitor.get(`/api/student/orders/${publicId}/invoice`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Dhanmondi");
    expect(html).not.toContain("no-email.invalid");
  });
});

describe("what a visitor can make the shop text", () => {
  const manual = (phone: string, i: number) => ({ phone, channel: "manual", manual: { method: "bkash", payer_number: phone, trx_id: `FAKE${Date.now()}${i}` } });

  it("sending payment details texts the number once — repeating it for the same number is refused — and when the site-wide daily limit is used up, no more texts go (the order still does)", async () => {
    const course = await makeCourse(700);
    const before = (await json(await (await loginStaff()).client.get("/api/admin/settings"))).settings.payments;
    await setSetting(env, "payments", { ...before, manual: true, manual_numbers: { bkash: "01711111111", nagad: "", rocket: "" } }, null);
    const day = new Date().toISOString().slice(0, 10);
    try {
      const victim = uniquePhone();
      expect((await buy(new Client(), guestBody(course, manual(victim, 1)))).status).toBe(201);
      // a second go at the same number is not an empty account any more: it is refused, and sends nothing
      expect((await buy(new Client(), guestBody(course, manual(victim, 2)))).status).toBe(409);
      await new Promise((r) => setTimeout(r, 300));
      expect((await smsTo(victim)).filter((m) => /payment details/.test(m.text))).toHaveLength(1);

      // the whole site may send only so many of these a day: past that the order is taken, and nobody is texted
      await env.KV.put(`sms:v:all:${day}`, "300", { expirationTtl: 600 });
      const other = uniquePhone();
      expect((await buy(new Client(), guestBody(course, manual(other, 3)))).status).toBe(201);
      await new Promise((r) => setTimeout(r, 300));
      expect(await smsTo(other)).toHaveLength(0);
    } finally {
      await env.KV.delete(`sms:v:all:${day}`);
      await setSetting(env, "payments", before, null);
    }
  });
});

describe("what is asked for", () => {
  it("name, a mobile number and an address are required; the e-mail is up to the buyer but must be real when given", async () => {
    const course = await makeCourse();
    const bad = await buy(new Client(), { courses: [course.slug], channel: "mock", name: "A", phone: "", address: "", email: "nope" });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields).toMatchObject({ name: "required", phone: "required", address: "required", email: "invalid_email" });
    const short = await buy(new Client(), guestBody(course, { address: "abc" }));
    expect((await json(short)).error.fields.address).toBe("required");
    const long = await buy(new Client(), guestBody(course, { address: "x".repeat(301) }));
    expect((await json(long)).error.fields.address).toBe("too_long");

    // blank, spaces and a missing field all mean "no e-mail"
    for (const email of [undefined, "", "   ", null]) {
      const res = await buy(new Client(), guestBody(course, { email }));
      expect(res.status, String(email)).toBe(201);
    }
  });

  it("an address with line breaks is kept tidy, and control characters are removed", async () => {
    const course = await makeCourse();
    const body = guestBody(course, { address: "  Flat 4B,\n\n   Road 7 \u0007\n Dhaka  " });
    const out = await json(await buy(new Client(), body));
    expect((await row(out.student.id))!.address).toBe("Flat 4B,\nRoad 7\nDhaka");
  });
});

describe("a number that belongs to someone is never opened by typing it", () => {
  it("a buyer with no e-mail who typed the number of a student already there is told to sign in, or sent a text — and gets no session and no order", async () => {
    const first = await paidBuyer();
    const course = await makeCourse();
    const stranger = new Client();
    const res = await buy(stranger, guestBody(course, { phone: first.phone, name: "Someone Else" }));
    expect(res.status).toBe(409);
    const { error } = await json(res);
    expect(error.code).toBe("account_exists");
    expect(error.fields).toEqual({ phone: "account_exists_link" }); // no password yet: they are offered a link by text
    expect(res.headers.getSetCookie().some((c) => c.startsWith("mawah_sid="))).toBe(false);
    expect((await json(await stranger.get("/api/auth/me"))).student).toBeNull();
    expect((await row(first.id))!.name).toBe("Rina Akter");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE student_id = ?").bind(first.id).first<{ n: number }>())!.n).toBe(1);

    // once that student has chosen a password, the answer is "sign in"
    const link = tokenIn((await smsTo(first.phone)).find((m) => /payment received/.test(m.text))!.text)!;
    expect((await new Client().post("/api/auth/reset", { token: link, password: "correct-horse-battery" })).status).toBe(200);
    const again = await buy(new Client(), guestBody(course, { phone: first.phone }));
    expect(again.status).toBe(409);
    expect((await json(again)).error.fields).toEqual({ phone: "account_exists" });
  });

  it("the number of a registered student (who has an e-mail) is not a way into their account either — unless the buyer gives their own e-mail", async () => {
    const phone = uniquePhone();
    const owner = await registerStudent(new Client(), { phone });
    const course = await makeCourse();
    const res = await buy(new Client(), guestBody(course, { phone }));
    expect(res.status).toBe(409);
    expect((await json(res)).error.fields).toEqual({ phone: "account_exists" });

    // a family can share a number: with an e-mail of their own, the e-mail is who they are
    const family = guestBody(course, { phone, email: uniqueEmail("family") });
    const ok = await buy(new Client(), family);
    expect(ok.status).toBe(201);
    expect((await json(ok)).student.id).not.toBe(owner.id);
  });

  it("an account staff added or imported by number is not opened either — the buyer is offered a text with a link", async () => {
    const phone = uniquePhone();
    await env.DB.prepare("INSERT INTO students (email, name, phone, password_hash, source) VALUES (?, 'Old Student', ?, NULL, 'import')").bind(noEmailAddress(phone), phone).run();
    const course = await makeCourse();
    const res = await buy(new Client(), guestBody(course, { phone }));
    expect(res.status).toBe(409);
    expect((await json(res)).error.fields).toEqual({ phone: "account_exists_link" });
  });

  it("the same visitor coming back unpaid — maybe from another phone — gets the same account with the details typed now", async () => {
    const course = await makeCourse();
    const phone = uniquePhone();
    const first = await json(await buy(new Client(), guestBody(course, { phone, name: "First Typed", address: "First address, Dhaka" })));
    const second = await buy(new Client(), guestBody(course, { phone, name: "Second Typed", address: "Second address, Chattogram" }));
    expect(second.status).toBe(201);
    const out = await json(second);
    expect(out.student.id).toBe(first.student.id);
    expect(await row(first.student.id)).toMatchObject({ name: "Second Typed", address: "Second address, Chattogram", source: "checkout" });
  });
});

describe("a signed-in student buys", () => {
  it("is asked for the mobile number and the address only when the profile lacks them, and what they give is kept for next time", async () => {
    const course = await makeCourse();
    const other = await makeCourse(800);
    const { client, id } = await registerStudent(new Client(), { phone: "", address: "" });
    const none = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "mock" });
    expect(none.status).toBe(422);
    expect((await json(none)).error.fields).toMatchObject({ phone: "required", address: "required" });

    const phone = uniquePhone();
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "mock", details: { phone, address: ADDRESS } });
    expect(res.status).toBe(201);
    expect(await row(id)).toMatchObject({ phone, address: ADDRESS });
    const order = await env.DB.prepare("SELECT customer_phone, customer_address FROM orders WHERE public_id = ?").bind((await json(res)).order.public_id).first();
    expect(order).toMatchObject({ customer_phone: phone, customer_address: ADDRESS });

    // not asked again
    expect((await client.post("/api/checkout", { agree: true, courses: [other.slug], channel: "mock" })).status).toBe(201);
  });

  it("a short or invalid address, or number, typed at checkout is refused", async () => {
    const course = await makeCourse();
    const { client } = await registerStudent(new Client(), { phone: "", address: "" });
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "mock", details: { phone: "123", address: "abc" } });
    expect(res.status).toBe(422);
    // the boxes are "details" of the order: the app takes that prefix off
    expect((await json(res)).error.fields).toMatchObject({ "details.phone": "invalid_phone", "details.address": "required" });
  });
});

describe("signing in with the mobile number or the student ID", () => {
  it("a buyer with no e-mail chooses a password from the text message — which also signs this phone in — and then signs in with the number or the ID", async () => {
    const { phone, code } = await paidBuyer();
    const receipt = await until(async () => (await smsTo(phone)).find((m) => /payment received/.test(m.text)));
    const phoneOnTheLink = new Client();
    const set = await phoneOnTheLink.post("/api/auth/reset", { token: tokenIn(receipt.text), password: "correct-horse-battery" });
    expect(set.status).toBe(200);
    expect((await json(set)).student).toMatchObject({ email: "", phone, has_password: true });
    expect((await json(await phoneOnTheLink.get("/api/auth/me"))).student).toMatchObject({ code });

    for (const identifier of [phone, `+88${phone}`, code, code.toLowerCase(), code.replace("-", "").toLowerCase(), ` ${phone} `]) {
      const res = await new Client().post("/api/auth/login", { identifier, password: "correct-horse-battery" });
      expect(res.status, identifier).toBe(200);
      expect((await json(res)).student).toMatchObject({ email: "", phone, code });
    }
    // wrong password, an unknown number and an unknown ID all look the same
    for (const identifier of [phone, uniquePhone(), "STU-999999"]) {
      const res = await new Client().post("/api/auth/login", { identifier, password: "not-the-password" });
      expect(res.status, identifier).toBe(401);
      expect((await json(res)).error.code).toBe("invalid_credentials");
    }
  });

  it("the link in a text works once", async () => {
    const { phone } = await paidBuyer();
    const receipt = await until(async () => (await smsTo(phone)).find((m) => /payment received/.test(m.text)));
    const token = tokenIn(receipt.text);
    expect((await new Client().post("/api/auth/reset", { token, password: "correct-horse-battery" })).status).toBe(200);
    expect((await new Client().post("/api/auth/reset", { token, password: "another-password-1" })).status).toBe(400);
  });

  it("the e-mail still works as before (also under the old field name); a number shared by two accounts asks for the ID or the e-mail instead", async () => {
    const phone = uniquePhone();
    const a = await registerStudent(new Client(), { phone, email: uniqueEmail("sharea") });
    const b = await registerStudent(new Client(), { phone, email: uniqueEmail("shareb") });
    expect((await new Client().post("/api/auth/login", { email: a.email, password: "correct-horse-battery" })).status).toBe(200);
    expect((await new Client().post("/api/auth/login", { identifier: b.email.toUpperCase(), password: "correct-horse-battery" })).status).toBe(200);

    const both = await new Client().post("/api/auth/login", { identifier: phone, password: "correct-horse-battery" });
    expect(both.status).toBe(409);
    expect((await json(both)).error.code).toBe("ambiguous_login");
    const code = (await json(await new Client().post("/api/auth/login", { identifier: a.email, password: "correct-horse-battery" }))).student.code;
    expect((await new Client().post("/api/auth/login", { identifier: code, password: "correct-horse-battery" })).status).toBe(200);
  });

  it("a number that belongs to someone with no password yet cannot be tried as a way in", async () => {
    const { phone } = await paidBuyer();
    const res = await new Client().post("/api/auth/login", { identifier: phone, password: "anything-at-all-1" });
    expect(res.status).toBe(401);
  });
});

describe("forgot my password, by number", () => {
  const codeIn = (text: string) => /\b(\d{6})\b/.exec(text)?.[1];
  const codeTexts = async (phone: string) => (await smsTo(phone)).filter((m) => /password code|পাসওয়ার্ড বদলানোর কোড/.test(m.text));

  it("texts a 6-digit code with no link in it; the code and a new password change it and sign this phone in; a number nobody has looks exactly the same and sends nothing", async () => {
    const { phone, id } = await paidBuyer();
    const before = (await codeTexts(phone)).length;
    const res = await new Client().post("/api/auth/forgot", { identifier: phone, lang: "en" });
    expect(res.status).toBe(200);
    const text = await until(async () => (await codeTexts(phone)).slice(before).at(-1));
    expect(text.text).not.toMatch(/https?:|\/app\/|www\./); // texts with a link in them were not arriving
    const code = codeIn(text.text)!;
    expect(code).toMatch(/^\d{6}$/);
    // only a keyed hash of the code is kept
    const stored = await env.DB.prepare("SELECT code_hash FROM reset_codes WHERE student_id = ? ORDER BY id DESC").bind(id).first<{ code_hash: string }>();
    expect(stored!.code_hash).not.toContain(code);
    expect(stored!.code_hash).toMatch(/^[0-9a-f]{64}$/);

    const phoneNow = new Client();
    const done = await phoneNow.post("/api/auth/reset-code", { identifier: phone, code, password: "a-brand-new-password-1" });
    expect(done.status).toBe(200);
    expect((await json(done)).student.id).toBe(id);
    expect((await phoneNow.get("/api/student/courses")).status).toBe(200); // signed in on this phone
    expect((await new Client().post("/api/auth/login", { identifier: phone, password: "a-brand-new-password-1" })).status).toBe(200);
    // a code works once
    expect((await new Client().post("/api/auth/reset-code", { identifier: phone, code, password: "another-password-12" })).status).toBe(422);

    const stranger = uniquePhone();
    const none = await new Client().post("/api/auth/forgot", { identifier: stranger, lang: "en" });
    expect(none.status).toBe(200);
    expect(await json(none)).toEqual(await json(res));
    await new Promise((r) => setTimeout(r, 150));
    expect(await smsTo(stranger)).toHaveLength(0);
    // and a made-up code for a number nobody has is answered like a wrong one
    const nobody = await new Client().post("/api/auth/reset-code", { identifier: stranger, code: "123456", password: "a-brand-new-password-1" });
    expect(nobody.status).toBe(422);
    expect((await json(nobody)).error.fields).toEqual({ code: "invalid_code" });
  });

  it("a student ID works too; an e-mail gets the code and the link by e-mail, and the code by text as well", async () => {
    const phone = uniquePhone();
    const email = uniqueEmail("forgot");
    const { id } = await registerStudent(new Client(), { phone, email });
    const code = `STU-${String(id).padStart(6, "0")}`;
    await new Client().post("/api/auth/forgot", { identifier: email, lang: "en" });
    const mail = await until(async () => (await outbox(email)).find((m) => tokenIn(m.text)));
    const mailed = /: (\d{6}) \(/.exec(mail.text)?.[1]; // "… this code on the “Forgot password” page: 123456 (it works for 15 minutes)"
    expect(mailed).toMatch(/^\d{6}$/);
    const texted = await until(async () => (await codeTexts(phone)).at(-1));
    expect(codeIn(texted.text)).toBe(mailed); // the same code both ways

    await new Client().post("/api/auth/forgot", { identifier: code, lang: "en" });
    await until(async () => (await outbox(email)).filter((m) => tokenIn(m.text)).length === 2);
    await until(async () => (await codeTexts(phone)).length === 2);
    // the newest code works; the one before it no longer does
    const latest = codeIn((await codeTexts(phone)).at(-1)!.text)!;
    if (latest !== mailed) expect((await new Client().post("/api/auth/reset-code", { identifier: email, code: mailed!, password: "a-brand-new-password-1" })).status).toBe(422);
    expect((await new Client().post("/api/auth/reset-code", { identifier: code, code: latest, password: "a-brand-new-password-1" })).status).toBe(200);
    // the link e-mailed with it is no longer needed, and no longer works
    const link = tokenIn((await outbox(email)).filter((m) => tokenIn(m.text)).at(-1)!.text)!;
    expect((await new Client().post("/api/auth/reset", { token: link, password: "yet-another-password-1" })).status).toBe(400);
  });

  it("5 wrong tries end a code — the right one too, after that — and a new code works; tries sent all at once get no more than 5 looks", async () => {
    const { phone, id } = await paidBuyer();
    await new Client().post("/api/auth/forgot", { identifier: phone, lang: "en" });
    const code = codeIn((await until(async () => (await codeTexts(phone)).at(-1))).text)!;
    const wrong = code === "000000" ? "111111" : "000000";
    // ten at the same moment
    const all = await Promise.all(Array.from({ length: 10 }, () => new Client().post("/api/auth/reset-code", { identifier: phone, code: wrong, password: "a-brand-new-password-1" })));
    expect(all.map((r) => r.status)).toEqual(Array(10).fill(422));
    const left = await env.DB.prepare("SELECT attempts, used_at FROM reset_codes WHERE student_id = ? ORDER BY id DESC").bind(id).first<{ attempts: number; used_at: string | null }>();
    expect(left!.attempts).toBe(5);
    expect(left!.used_at).not.toBeNull();
    expect((await new Client().post("/api/auth/reset-code", { identifier: phone, code, password: "a-brand-new-password-1" })).status).toBe(422);

    await new Client().post("/api/auth/forgot", { identifier: phone, lang: "en" });
    const fresh = codeIn((await until(async () => (await codeTexts(phone)).length >= 2 && (await codeTexts(phone)).at(-1))).text)!;
    expect((await new Client().post("/api/auth/reset-code", { identifier: phone, code: fresh, password: "a-brand-new-password-1" })).status).toBe(200);
  });

  it("a code works for 15 minutes, and only for the account it was sent to", async () => {
    const a = await paidBuyer();
    const b = await paidBuyer();
    await new Client().post("/api/auth/forgot", { identifier: a.phone, lang: "en" });
    const code = codeIn((await until(async () => (await codeTexts(a.phone)).at(-1))).text)!;
    // someone else's number with this code: no
    expect((await new Client().post("/api/auth/reset-code", { identifier: b.phone, code, password: "a-brand-new-password-1" })).status).toBe(422);
    // 16 minutes later: no
    await env.DB.prepare("UPDATE reset_codes SET expires_at = ? WHERE student_id = ?").bind(new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"), a.id).run();
    expect((await new Client().post("/api/auth/reset-code", { identifier: a.phone, code, password: "a-brand-new-password-1" })).status).toBe(422);
    // a code must be 6 digits
    const short = await new Client().post("/api/auth/reset-code", { identifier: a.phone, code: "12345", password: "a-brand-new-password-1" });
    expect(short.status).toBe(422);
    expect((await json(short)).error.fields.code).toBe("invalid_code");
  });

  it("a few codes per number per hour, then no more — and the answer stays the same, so nobody learns anything", async () => {
    const { phone } = await paidBuyer();
    const base = (await codeTexts(phone)).length;
    for (let i = 0; i < 5; i++) {
      // a different client each time: the caps under test are the account's and the number's, not the visitor's address
      expect((await new Client().post("/api/auth/forgot", { identifier: phone, lang: "en" })).status).toBe(200);
    }
    await new Promise((r) => setTimeout(r, 250));
    expect((await codeTexts(phone)).slice(base).length).toBe(3);
  });

  it("a blocked account is sent nothing", async () => {
    const { phone, id } = await paidBuyer();
    await env.DB.prepare("UPDATE students SET blocked = 1 WHERE id = ?").bind(id).run();
    const base = (await smsTo(phone)).length;
    expect((await new Client().post("/api/auth/forgot", { identifier: phone, lang: "en" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect((await smsTo(phone)).length).toBe(base);
  });

  it("the owner sees in the activity log whether the code went out, and how", async () => {
    const { phone, id } = await paidBuyer();
    await new Client().post("/api/auth/forgot", { identifier: phone, lang: "en" });
    const sent = await until(async () =>
      env.DB.prepare("SELECT meta FROM activity_log WHERE action = 'student.password_code_sent' AND entity_id = ? ORDER BY id DESC").bind(String(id)).first<{ meta: string }>(),
    );
    expect(JSON.parse(sent.meta)).toEqual({ sms: "sent", email: "not_sent" });
    // never the code
    const code = codeIn((await codeTexts(phone)).at(-1)!.text)!;
    const logged = await env.DB.prepare("SELECT GROUP_CONCAT(meta, ' ') AS all_meta FROM activity_log WHERE entity_id = ?").bind(String(id)).first<{ all_meta: string }>();
    expect(logged!.all_meta).not.toContain(code);
  });
});

describe("the profile of a student with no e-mail", () => {
  it("keeps the mobile number (it is who they are), takes an address, and lets them add an e-mail — once, and only one nobody has", async () => {
    const { visitor, phone, id } = await paidBuyer();
    const keep = { name: "Rina Akter", phone, locale: "en" as const };

    // the number cannot be taken away
    const noPhone = await visitor.patch("/api/auth/profile", { ...keep, phone: "" });
    expect(noPhone.status).toBe(422);
    expect((await json(noPhone)).error.fields).toMatchObject({ phone: "required" });

    // the address can be changed
    const moved = await visitor.patch("/api/auth/profile", { ...keep, address: "New home, Road 9, Sylhet" });
    expect(moved.status).toBe(200);
    expect((await row(id))!.address).toBe("New home, Road 9, Sylhet");

    // an e-mail somebody else uses is refused, and nothing changes
    const taken = (await registerStudent()).email;
    const clash = await visitor.patch("/api/auth/profile", { ...keep, email: taken });
    expect(clash.status).toBe(409);
    expect((await row(id))!.email).toBe(noEmailAddress(phone));

    // their own e-mail is added: from now on it is who they are
    const mine = uniqueEmail("added");
    const added = await visitor.patch("/api/auth/profile", { ...keep, email: mine });
    expect(added.status).toBe(200);
    expect((await json(added)).student).toMatchObject({ email: mine });
    expect((await row(id))!.email).toBe(mine);

    // …and it cannot be swapped here for another (that would change who can sign in)
    const swap = await visitor.patch("/api/auth/profile", { ...keep, email: uniqueEmail("swap") });
    expect(swap.status).toBe(200);
    expect((await row(id))!.email).toBe(mine);
  });
});

describe("staff add and change students known by number", () => {
  const admin = async () => (await loginStaff("super_admin")).client;

  it("a student can be added with a mobile number and no e-mail; a second one on the same number is refused, and one with neither is too", async () => {
    const a = await admin();
    const phone = uniquePhone();
    const res = await a.post("/api/admin/students", { name: "Old Student", phone, address: ADDRESS, locale: "bn" });
    expect(res.status).toBe(201);
    const { id } = await json(res);
    expect(await row(id)).toMatchObject({ email: noEmailAddress(phone), phone, address: ADDRESS, source: "admin" });

    const detail = await json(await a.get(`/api/admin/students/${id}`));
    expect(detail.student).toMatchObject({ email: "", phone, address: ADDRESS });
    const list = (await json(await a.get(`/api/admin/students?q=${phone}`))).items as { email: string }[];
    expect(list.map((s) => s.email)).toEqual([""]);

    const again = await a.post("/api/admin/students", { name: "Same Number", phone });
    expect(again.status).toBe(409);
    expect((await json(again)).error.fields).toEqual({ phone: "phone_taken" });

    const neither = await a.post("/api/admin/students", { name: "Nobody" });
    expect(neither.status).toBe(422);
    expect((await json(neither)).error.fields).toMatchObject({ email: "needs_contact" });
    const badEmail = await a.post("/api/admin/students", { name: "Typo", email: "nope", phone });
    expect(badEmail.status).toBe(422);
    expect((await json(badEmail)).error.fields).toMatchObject({ email: "invalid_email" });
  });

  it("gives such a student a way in by text message, never by e-mail; the link can also be handed over", async () => {
    const a = await admin();
    const phone = uniquePhone();
    const { id } = await json(await a.post("/api/admin/students", { name: "Old Student", phone, locale: "en" }));

    const viaMail = await json(await a.post(`/api/admin/students/${id}/invite`, { mode: "email" }));
    expect(viaMail.sent).toBe(false); // there is no e-mail to send to
    expect(await smsTo(phone)).toHaveLength(0);

    const viaText = await json(await a.post(`/api/admin/students/${id}/invite`, { mode: "sms" }));
    expect(viaText.sent).toBe(true);
    const text = await until(async () => (await smsTo(phone)).find((m) => /Choose a password/.test(m.text)));
    expect(tokenIn(text.text)).toBeTruthy();

    const link = await json(await a.post(`/api/admin/students/${id}/invite`, { mode: "link" }));
    expect(link.link).toMatch(/\/app\/reset\//);
    expect(JSON.stringify(link)).not.toContain("no-email.invalid");

    const reset = await json(await a.post(`/api/admin/students/${id}/send-reset`, {}));
    expect(reset.sent).toBe(true);
    // the text carries the code for the "Forgot password" page, and no link
    const code = await until(async () => (await smsTo(phone)).find((m) => /password code is \d{6}/.test(m.text)));
    expect(code.text).not.toMatch(/https?:|\/app\//);
  });

  it("an e-mail can be added later (it is then who they are), and the address can be changed", async () => {
    const a = await admin();
    const phone = uniquePhone();
    const { id } = await json(await a.post("/api/admin/students", { name: "Old Student", phone }));
    expect((await a.patch(`/api/admin/students/${id}`, { address: "Changed address, Khulna" })).status).toBe(200);
    expect((await row(id))!.address).toBe("Changed address, Khulna");

    const mine = uniqueEmail("later");
    expect((await a.patch(`/api/admin/students/${id}`, { email: mine })).status).toBe(200);
    expect((await row(id))!.email).toBe(mine);
    expect((await json(await a.get(`/api/admin/students/${id}`))).student.email).toBe(mine);
    const trail = await env.DB.prepare("SELECT meta FROM activity_log WHERE action = 'student.updated' AND entity_id = ? ORDER BY id DESC LIMIT 1").bind(String(id)).first<{ meta: string }>();
    expect(JSON.parse(trail!.meta)).toMatchObject({ email_from: "(none)", email_to: mine });
  });

  it("a list with a mobile number and no e-mail is read, checked and saved; a line with neither is a problem; an address column is kept", async () => {
    const a = await admin();
    const course = await makeCourse(1200);
    const phone = uniquePhone();
    const rows = [
      { name: "Phone Only", phone, address: ADDRESS, classes: course.slug, amount: "1200", method: "bkash" },
      { name: "Nothing Given" },
      { name: "Mail Only", email: uniqueEmail("sheet") },
    ];
    const checked = await json(await a.post("/api/admin/students/import/preview", { rows }));
    const results = checked.results as { name: string; status: string; email: string; problems: { field: string; code: string }[] }[];
    expect(results.map((r) => r.status)).toEqual(["new", "problem", "new"]);
    expect(results[0].email).toBe(""); // the made-up address is not shown
    expect(results[1].problems).toEqual([{ field: "email", code: "needs_contact" }]);

    const saved = await a.post("/api/admin/students/import", { rows });
    expect(saved.status).toBe(200);
    const made = await env.DB.prepare("SELECT id, email, address, source FROM students WHERE phone = ?").bind(phone).first<{ id: number; email: string; address: string; source: string }>();
    expect(made).toMatchObject({ email: noEmailAddress(phone), address: ADDRESS, source: "import" });
    const classes = await env.DB.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE student_id = ?").bind(made!.id).first<{ n: number }>();
    expect(classes!.n).toBe(1);

    // the same list again: the same person, no second account, no second class; a blank address on file is filled in
    await env.DB.prepare("UPDATE students SET address = '' WHERE id = ?").bind(made!.id).run();
    const again = await json(await a.post("/api/admin/students/import/preview", { rows: [rows[0]] }));
    expect(again.results[0].status).toBe("existing");
    await a.post("/api/admin/students/import", { rows: [rows[0]] });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM students WHERE phone = ?").bind(phone).first<{ n: number }>())!.n).toBe(1);
    expect((await row(made!.id))!.address).toBe(ADDRESS);
  });
});

describe("the made-up address never reaches anyone", () => {
  it("a note to the owner about a private-group request says the student gave no e-mail, and gives the number", () => {
    const note = notices.groupRequest({ student: "Tania", email: "", phone: "01711000123", group: "Baking group", course: "Baking", profile: "https://facebook.com/tania" });
    const facts = note.facts.map((f) => `${f.en}: ${f.value}`).join("\n");
    expect(facts).toContain("E-mail: — (gave none");
    expect(facts).toContain("Phone: 01711000123");
  });

  it("after a whole journey — buying, paying, forgetting, being invited — not one message in the box carries it", async () => {
    const { phone } = await paidBuyer();
    await new Client().post("/api/auth/forgot", { identifier: phone, lang: "en" });
    const everything = (await json(await new Client().get("/api/dev/outbox"))).messages as Note[];
    expect(everything.length).toBeGreaterThan(5); // the whole file's traffic is there
    for (const m of everything) expect(`${m.to} ${m.subject} ${m.text} ${m.html}`, m.subject).not.toContain("no-email.invalid");
  });
});
