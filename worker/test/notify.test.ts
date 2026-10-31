import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFY_KINDS } from "@mawah/shared";
import { MAIL_DOMAIN_REFUSED_KEY, SANDBOX_FROM, sendMail } from "../src/lib/mailer";
import { getSettings, setSetting } from "../src/lib/settings";
import { mockSignature } from "../src/services/payments";
import { notices, notificationRecipients, notifyOwner } from "../src/services/notify";
import { Client, env, json, loginStaff, registerStudent, uniqueEmail } from "./helpers";

/*
 * The owner is told by e-mail the moment something happens: a payment (received, or waiting to be approved), a message, a new student,
 * a question, a review, a chatbot hand-off, a request to join a private group, someone waiting for a class to open, a newsletter sign-up.
 * What the owner cannot see, and these tests protect: every one of those events really sends a note to the right address, a kind that
 * is switched off stays quiet, a burst cannot flood the inbox, a failing e-mail service never breaks what the visitor was doing, the
 * note shows what was written without letting it become markup, and while the sending domain is not verified at Resend the owner's
 * own notes still arrive (through Resend's test sender) but students' e-mails are honestly reported as undeliverable.
 */

const FAKE_KEY = `re${"_"}${"x".repeat(32)}`;
const e = env as { RESEND_API_KEY?: string; NOTIFY_EMAIL?: string; MAIL_REPLY_TO?: string; MAIL_FROM: string };
const OWNER_DEFAULT = e.NOTIFY_EMAIL;
const OFF_ALL: never[] = [];

let seq = 0;
async function makeCourse(price = 1500, status = "published") {
  const n = ++seq;
  const slug = `notify-test-${Date.now().toString(36)}-${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `নোটিফাই ক্লাস ${n}`, `Notify Course ${n}`, price, status)
    .run();
  const courseId = res.meta.last_row_id as number;
  const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort) VALUES (?, 'মডিউল', 'Module', 1)").bind(courseId).run();
  const lesson = await env.DB.prepare(
    "INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, sort) VALUES (?, ?, 'লেসন', 'Lesson One', 'external', 'https://youtu.be/dQw4w9WgXcQ', 1)",
  )
    .bind(courseId, mod.meta.last_row_id)
    .run();
  return { id: courseId, slug, title: `Notify Course ${n}`, lessonId: lesson.meta.last_row_id as number };
}

/** The owner address of one test: nobody else's notes land in it. */
async function ownerBox() {
  const to = uniqueEmail("owner");
  await setSetting(env, "notifications", { emails: [to], off: [] }, null);
  return to;
}
const mailsTo = async (to: string) => (await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(to)}`))).messages as { subject: string; text: string; html: string; to: string }[];
/** waitUntil work finishes just after the answer: look until the mail is there (or it is clear none comes) */
async function until<T>(fn: () => Promise<T | null | false>, ms = 1500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const noteTo = (to: string, about: RegExp) => until(async () => (await mailsTo(to)).find((m) => about.test(m.subject)) ?? false);
/** true when no note about this has come to the address (after giving the after-the-answer work a moment) */
const quiet = async (to: string, about: RegExp = /./, ms = 200) => {
  await new Promise((r) => setTimeout(r, ms));
  return !(await mailsTo(to)).some((m) => about.test(m.subject));
};

beforeEach(async () => {
  await setSetting(env, "notifications", { emails: [], off: OFF_ALL }, null);
});
afterEach(() => {
  e.RESEND_API_KEY = undefined;
  e.NOTIFY_EMAIL = OWNER_DEFAULT;
  vi.restoreAllMocks();
});

describe("who is told", () => {
  it("by default the address in NOTIFY_EMAIL; the list chosen in Settings replaces it; with neither, the contact e-mail; with nothing, nobody", async () => {
    expect(OWNER_DEFAULT).toBe("mawahacademy@gmail.com");
    expect(notificationRecipients(env, await getSettings(env, { fresh: true }))).toEqual({ to: ["mawahacademy@gmail.com"], custom: false });

    await setSetting(env, "notifications", { emails: ["A@Example.test", "b@example.test", "a@example.test"], off: [] }, null);
    expect(notificationRecipients(env, await getSettings(env, { fresh: true }))).toEqual({ to: ["a@example.test", "b@example.test"], custom: true });

    await setSetting(env, "notifications", { emails: [], off: [] }, null);
    e.NOTIFY_EMAIL = "";
    await setSetting(env, "contact", { whatsapp: "", phone: "", email: "Contact@Example.test", facebook: "", youtube: "", instagram: "" }, null);
    expect(notificationRecipients(env, await getSettings(env, { fresh: true })).to).toEqual(["contact@example.test"]);
    await setSetting(env, "contact", { whatsapp: "", phone: "", email: "", facebook: "", youtube: "", instagram: "" }, null);
    expect(notificationRecipients(env, await getSettings(env, { fresh: true })).to).toEqual([]);
  });
});

describe("what tells the owner", () => {
  it("a payment arriving: the student, the class, the amount, how it was paid and the invoice", async () => {
    const to = await ownerBox();
    const course = await makeCourse(1500);
    const { client } = await registerStudent(new Client(), { name: "Rina Akter", phone: "01711223344" });
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "mock" });
    const publicId = (await json(res)).order.public_id as string;
    expect(await quiet(to, /payment/i, 100)).toBe(true); // nothing is paid yet
    const sig = await mockSignature(env, publicId, "paid");
    expect((await new Client().fetch("/api/payments/mock/webhook", { method: "POST", form: { order: publicId, status: "paid", sig } })).status).toBe(200);

    const note = await noteTo(to, /New payment received/);
    expect(note.subject).toContain("৳1,500");
    expect(note.subject).toContain("Rina Akter");
    expect(note.text).toContain(course.title);
    expect(note.text).toContain("01711223344");
    expect(note.text).toMatch(/INV-\w+-\d{8}-\d{4}/);
    expect(note.text).toContain("/admin/orders");
    expect(note.html).toContain("নতুন পেমেন্ট এসেছে"); // in Bangla as well
    // the same payment arriving twice (the gateway retries) is one note
    await new Client().fetch("/api/payments/mock/webhook", { method: "POST", form: { order: publicId, status: "paid", sig } });
    await new Promise((r) => setTimeout(r, 150));
    expect((await mailsTo(to)).filter((m) => /New payment received/.test(m.subject))).toHaveLength(1);
  });

  it("a payment that needs the owner's check: the TrxID, the number it came from, and the way to the order", async () => {
    const to = await ownerBox();
    await setSetting(env, "payments", { sslcommerz: true, bkash_direct: false, manual: true, manual_numbers: { bkash: "01711111111", nagad: "", rocket: "" }, manual_note_bn: "", manual_note_en: "", manual_window_min: 20 }, null);
    const course = await makeCourse(900);
    const { client } = await registerStudent(new Client(), { name: "Karim Hossain" });
    const started = await json(await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "manual", manual: { method: "bkash", payer_number: "01766554433" } }));
    expect(await quiet(to, /payment/i, 100)).toBe(true); // started, nothing sent yet: the owner is not bothered
    await client.post(`/api/checkout/${started.order.public_id}/proof`, { trx_id: "NOTIFYTRX99" });

    const note = await noteTo(to, /waiting for you to verify/);
    expect(note.text).toContain("NOTIFYTRX99");
    expect(note.text).toContain("01766554433");
    expect(note.text).toContain("Karim Hossain");
    expect(note.text).toContain("bKash");
    expect(note.text).toContain("/admin/orders?status=awaiting_verification");
  });

  it("a contact message: what was written, who wrote it — and nothing the sender typed becomes markup", async () => {
    const to = await ownerBox();
    const who = uniqueEmail("visitor");
    const res = await new Client().post("/api/contact", { name: "Nasrin", email: who, phone: "01911000000", message: "Is the class good for beginners? <script>alert(1)</script>" });
    expect(res.status).toBe(200);
    const note = await noteTo(to, /New message from the website/);
    expect(note.text).toContain("Is the class good for beginners?");
    expect(note.text).toContain(who);
    expect(note.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(note.html).not.toContain("<script>");
    expect(note.text).toContain("/admin/messages");
  });

  it("a new student signing up", async () => {
    const to = await ownerBox();
    const { email } = await registerStudent(new Client(), { name: "Sumaiya Rahman" });
    const note = await noteTo(to, /new student signed up/);
    expect(note.text).toContain("Sumaiya Rahman");
    expect(note.text).toContain(email);
  });

  it("a question under a lesson and a review of a class, from a student who owns it", async () => {
    const to = await ownerBox();
    const course = await makeCourse();
    const { client, id } = await registerStudent(new Client(), { name: "Farhana" });
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'purchase')").bind(id, course.id).run();
    expect((await client.post("/api/student/questions", { lesson_id: course.lessonId, body: "How long do I bake it?" })).status).toBe(201);
    const q = await noteTo(to, /asked a question/);
    expect(q.text).toContain("How long do I bake it?");
    expect(q.text).toContain("Lesson One");
    expect(q.text).toContain(course.title);

    expect((await client.post("/api/student/reviews", { course_id: course.id, rating: 5, body: "Loved every minute of it." })).status).toBe(201);
    const r = await noteTo(to, /review is waiting for your approval/);
    expect(r.subject).toContain("★★★★★");
    expect(r.text).toContain("Loved every minute of it.");
    expect(r.text).toContain("/admin/reviews");
  });

  it("the chatbot passing a question to a person — once for the same open question", async () => {
    const to = await ownerBox();
    const question = `Can I pay in two parts? ${Date.now()}`;
    const ask = () => new Client().post("/api/chat", { messages: [{ role: "user", content: question }], lang: "en" });
    expect((await ask()).status).toBe(200);
    const note = await noteTo(to, /chatbot needs a person/);
    expect(note.text).toContain("Can I pay in two parts?");
    await ask();
    await new Promise((r) => setTimeout(r, 150));
    expect((await mailsTo(to)).filter((m) => /chatbot needs a person/.test(m.subject))).toHaveLength(1);
  });

  it("someone leaving their e-mail for a class that is not open yet — and the same person again is not news", async () => {
    const to = await ownerBox();
    const soon = await makeCourse(1000, "coming_soon");
    const who = uniqueEmail("waiting");
    expect((await new Client().post("/api/notify", { course: soon.slug, email: who })).status).toBe(200);
    const note = await noteTo(to, /waiting for a class to open/);
    expect(note.text).toContain(who);
    expect(note.text).toContain(soon.title);
    await new Client().post("/api/notify", { course: soon.slug, email: who });
    await new Promise((r) => setTimeout(r, 150));
    expect((await mailsTo(to)).filter((m) => /waiting for a class to open/.test(m.subject))).toHaveLength(1);
  });

  it("a newsletter sign-up is news once; signing up again while subscribed is not, and coming back after leaving is", async () => {
    const to = await ownerBox();
    const who = uniqueEmail("reader");
    const join = () => new Client().post("/api/newsletter", { email: who, lang: "en" });
    expect((await join()).status).toBe(200);
    const note = await noteTo(to, /newsletter subscriber/);
    expect(note.text).toContain(who);
    await join();
    await new Promise((r) => setTimeout(r, 150));
    expect((await mailsTo(to)).filter((m) => /newsletter subscriber/.test(m.subject))).toHaveLength(1);

    await env.DB.prepare("UPDATE subscribers SET unsubscribed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE email = ?").bind(who).run();
    await join();
    await until(async () => (await mailsTo(to)).filter((m) => /newsletter subscriber/.test(m.subject)).length === 2);
    const row = await env.DB.prepare("SELECT unsubscribed_at FROM subscribers WHERE email = ?").bind(who).first<{ unsubscribed_at: string | null }>();
    expect(row?.unsubscribed_at).toBeNull();
  });

  it("a student asking to join a private group, with their profile link", async () => {
    const to = await ownerBox();
    const course = await makeCourse();
    const { client, id } = await registerStudent(new Client(), { name: "Tania" });
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'purchase')").bind(id, course.id).run();
    const m = await env.DB.prepare(
      "INSERT INTO materials (course_id, kind, title_en, title_bn, url, platform, ask_profile, active) VALUES (?, 'group', 'Baking circle', 'বেকিং সার্কেল', 'https://www.facebook.com/groups/bakingcircle', 'facebook', 1, 1)",
    )
      .bind(course.id)
      .run();
    const res = await client.post(`/api/student/materials/${m.meta.last_row_id}/join`, { profile_url: "https://www.facebook.com/tania.baker" });
    expect(res.status).toBe(200);
    const note = await noteTo(to, /asked to join a private group/);
    expect(note.text).toContain("Baking circle");
    expect(note.text).toContain("https://www.facebook.com/tania.baker");
    expect(note.text).toContain("/admin/materials/requests");
  });
});

describe("switches and limits", () => {
  it("a kind that is switched off stays quiet while the others still come", async () => {
    const to = uniqueEmail("owner");
    await setSetting(env, "notifications", { emails: [to], off: ["contact_message"] }, null);
    await new Client().post("/api/contact", { name: "Quiet One", email: uniqueEmail("v"), message: "Please do not tell the owner." });
    expect(await quiet(to, /New message/, 250)).toBe(true);
    await registerStudent(new Client(), { name: "Loud One" });
    await noteTo(to, /new student signed up/);
  });

  it("a kind is told at most so many times an hour — the admin pages still show everything", async () => {
    const to = await ownerBox();
    const spam = (i: number) => notices.contactMessage({ name: `Sender ${i}`, email: `s${i}@example.test`, phone: null, message: "hello" });
    const counter = `notify:contact_message:${Math.floor(Date.now() / 3_600_000)}`;
    await env.KV.delete(counter); // other tests of this file have already sent one this hour
    for (let i = 0; i < 50; i++) await notifyOwner(env, spam(i)); // one after the other, as separate requests would come
    const n = (await mailsTo(to)).filter((m) => /New message from the website/.test(m.subject)).length;
    expect(n).toBe(40);
    await env.KV.delete(counter);
  });

  it("a failing e-mail service never breaks what the visitor was doing", async () => {
    await ownerBox();
    e.RESEND_API_KEY = FAKE_KEY;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://api.resend.com/")) throw new Error("network down");
      return fetch.call(globalThis, input as RequestInfo, init);
    });
    expect((await new Client().post("/api/contact", { name: "Still Works", email: uniqueEmail("v"), message: "Hello there, anyone home?" })).status).toBe(200);
    expect((await registerStudent(new Client())).res.status).toBe(201);
  });
});

describe("the mailer: reply-to and the test sender", () => {
  /** Pretend Resend is at the other end; `answer(from)` decides what each message gets. */
  function resend(answer: (payload: Record<string, any>) => { status: number; body: unknown }) {
    const calls: Record<string, any>[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("https://api.resend.com/")) return real(input as RequestInfo, init);
      const payload = JSON.parse(String(init?.body ?? "{}"));
      calls.push(payload);
      const a = answer(payload);
      return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
    });
    return calls;
  }
  const NOT_VERIFIED = { status: 403, body: { name: "validation_error", message: "The mawahacademy.com domain is not verified. Please, add and verify your domain on https://resend.com/domains" } };
  const message = (to: string, over: Record<string, unknown> = {}) => ({ to, subject: "Hello", html: "<p>Hi</p>", text: "Hi", ...over });

  beforeEach(async () => {
    e.RESEND_API_KEY = FAKE_KEY;
    await env.KV.delete(MAIL_DOMAIN_REFUSED_KEY);
  });

  it("every message asks that replies go to MAIL_REPLY_TO — except one addressed to that inbox itself", async () => {
    const calls = resend(() => ({ status: 200, body: { id: "1" } }));
    expect(e.MAIL_REPLY_TO).toBe("mawahacademy@gmail.com");
    await sendMail(env, message("student@example.test"));
    await sendMail(env, message("MAWAHACADEMY@gmail.com"));
    await sendMail(env, message("student@example.test", { replyTo: "help@example.test" }));
    expect(calls[0]).toMatchObject({ from: e.MAIL_FROM, to: ["student@example.test"], reply_to: ["mawahacademy@gmail.com"] });
    expect(calls[1].reply_to).toBeUndefined();
    expect(calls[2].reply_to).toEqual(["help@example.test"]);
  });

  it("while the domain is not verified a note to the owner still goes out, through Resend's test sender; a student's mail is honestly refused", async () => {
    const calls = resend(({ from }) => (from === SANDBOX_FROM ? { status: 200, body: { id: "ok" } } : NOT_VERIFIED));

    const ownerMail = await sendMail(env, message("mawahacademy@gmail.com", { owner: true }));
    expect(ownerMail).toMatchObject({ ok: true, provider: "resend", viaSandbox: true });
    expect(calls.map((c) => c.from)).toEqual([e.MAIL_FROM, SANDBOX_FROM]);
    expect(calls[1].to).toEqual(["mawahacademy@gmail.com"]);
    expect(await env.KV.get(MAIL_DOMAIN_REFUSED_KEY)).toBeTruthy(); // the dashboard will say students' e-mails are not arriving

    calls.length = 0;
    const studentMail = await sendMail(env, message("student@example.test"));
    expect(studentMail).toMatchObject({ ok: false, status: 403, code: "validation_error" });
    expect(calls).toHaveLength(1); // no second try: Resend would only deliver the test sender to the owner's own address
    // not even an owner-flagged message goes through the test sender to somebody else's inbox
    calls.length = 0;
    expect((await sendMail(env, message("someone.else@example.test", { owner: true }))).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("when the domain is verified there is no detour, and a different refusal is not mistaken for 'not verified'", async () => {
    const ok = resend(() => ({ status: 200, body: { id: "1" } }));
    expect(await sendMail(env, message("mawahacademy@gmail.com", { owner: true }))).toEqual({ ok: true, provider: "resend" });
    expect(ok).toHaveLength(1);
    expect(await env.KV.get(MAIL_DOMAIN_REFUSED_KEY)).toBeNull();

    vi.restoreAllMocks();
    const bad = resend(() => ({ status: 401, body: { name: "invalid_api_key", message: "API key is invalid" } }));
    expect(await sendMail(env, message("mawahacademy@gmail.com", { owner: true }))).toMatchObject({ ok: false, status: 401 });
    expect(bad).toHaveLength(1);
    expect(await env.KV.get(MAIL_DOMAIN_REFUSED_KEY)).toBeNull();
  });
});

describe("Settings → E-mail: who is told and what about", () => {
  const owner = async () => (await loginStaff("super_admin")).client;

  it("shows the recipients, the reply-to address and the switches; only the owner can change them", async () => {
    const admin = await owner();
    const view = await json(await admin.get("/api/admin/settings/email"));
    expect(view).toMatchObject({ reply_to: "mawahacademy@gmail.com", notify: { to: ["mawahacademy@gmail.com"], custom: false, default_to: "mawahacademy@gmail.com", off: [] }, domain_refused_at: null });

    expect((await (await loginStaff("support")).client.put("/api/admin/settings/notifications", { emails: [], off: [] })).status).toBe(403);
    const res = await admin.put("/api/admin/settings/notifications", { emails: ["Boss@Example.test", "boss@example.test", "second@example.test"], off: ["new_student", "new_student", "notify_me"] });
    expect(res.status).toBe(200);
    expect((await json(await admin.get("/api/admin/settings/email"))).notify).toMatchObject({ to: ["boss@example.test", "second@example.test"], custom: true, off: ["new_student", "notify_me"] });
  });

  it("refuses an address that is not an address, more than five of them, and a kind that does not exist", async () => {
    const admin = await owner();
    expect((await admin.put("/api/admin/settings/notifications", { emails: ["not-an-address"], off: [] })).status).toBe(422);
    expect((await admin.put("/api/admin/settings/notifications", { emails: Array.from({ length: 6 }, (_, i) => `a${i}@example.test`), off: [] })).status).toBe(422);
    expect((await admin.put("/api/admin/settings/notifications", { emails: [], off: ["everything"] })).status).toBe(422);
    expect(NOTIFY_KINDS.length).toBe(14);
  });

  it("'send a test notification' sends one sample to every address and says what became of it; a few an hour", async () => {
    const a = uniqueEmail("one");
    const b = uniqueEmail("two");
    const admin = await owner();
    await admin.put("/api/admin/settings/notifications", { emails: [a, b], off: [] });
    const res = await json(await admin.post("/api/admin/settings/email/notify-test", {}));
    expect(res.results.map((r: any) => [r.to, r.sent, r.via_sandbox, r.problem])).toEqual([[a, true, false, null], [b, true, false, null]]);
    expect((await mailsTo(a))[0].text).toContain("This is only a test");

    for (let i = 0; i < 5; i++) await admin.post("/api/admin/settings/email/notify-test", {});
    expect((await admin.post("/api/admin/settings/email/notify-test", {})).status).toBe(429);
    expect((await (await loginStaff("viewer")).client.post("/api/admin/settings/email/notify-test", {})).status).toBe(403);
  });

  it("the test e-mail says when it only got through Resend's test sender, and the dashboard says students' e-mails are not arriving until a real one goes through", async () => {
    e.RESEND_API_KEY = FAKE_KEY;
    const admin = await owner();
    const { client: me, email } = await loginStaff("super_admin");
    e.NOTIFY_EMAIL = email; // the account's own address: the one the test sender may reach
    let verified = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("https://api.resend.com/")) return fetch.call(globalThis, input as RequestInfo, init);
      const from = JSON.parse(String(init?.body ?? "{}")).from;
      const ok = verified || from === SANDBOX_FROM;
      return new Response(JSON.stringify(ok ? { id: "1" } : { name: "validation_error", message: "The mawahacademy.com domain is not verified." }), { status: ok ? 200 : 403 });
    });

    const first = await json(await me.post("/api/admin/settings/email/test", { lang: "en" }));
    expect(first).toMatchObject({ sent: true, viaSandbox: true, problem: "domain_not_verified" });
    const health = async () => (await json(await admin.get("/api/admin/health"))).checks.find((c: any) => c.key === "email");
    expect(await health()).toMatchObject({ status: "warn", issues: ["email_domain_unverified"] });

    verified = true; // the DNS records went in
    const second = await json(await me.post("/api/admin/settings/email/test", { lang: "en" }));
    expect(second).toMatchObject({ sent: true, problem: null });
    expect(second.viaSandbox).toBeUndefined();
    expect(await health()).toMatchObject({ status: "ok", issues: [] });
    await env.KV.delete("mail:last-test");
  });
});
