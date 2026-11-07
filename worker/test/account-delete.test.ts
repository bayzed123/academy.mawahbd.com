import { describe, expect, it } from "vitest";
import { PROOF_RETENTION_DAYS, studentCode } from "@mawah/shared";
import { ACCOUNT_DELETION_TEXT, PRIVACY_APP_TEXT } from "../src/content/pageTexts";
import { renderMarkdown } from "../src/lib/markdown";
import { GUEST_KEEP_DAYS } from "../src/services/guests";
import { SETTING_DEFAULTS, setSetting } from "../src/lib/settings";
import { Client, env, firstCourse, json, loginStaff, registerStudent } from "./helpers";

/*
 * Deleting an account (Google Play requires it: inside the app, and on a web page): the student does it on the website or in the app, or
 * staff do it on request. Everything personal goes, every session ends, and the orders and payments stay for the tax records.
 */

const count = async (sql: string, ...params: (string | number)[]) => (await env.DB.prepare(sql).bind(...params).first<{ n: number }>())!.n;
const bearer = (token: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}`, "content-type": "application/json" } });
const mailsTo = async (to: string) => (await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(to)}`))).messages as { subject: string; text: string }[];
async function until<T>(fn: () => Promise<T | null | false | undefined>, ms = 1500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A student with a bit of everything: a class with progress, a question, an approved review, a certificate, a paid order, sign-ups and codes. */
async function busyStudent(password = "delete-me-123") {
  const phone = `017${String(Date.now() % 100_000_000).padStart(8, "0")}`;
  const made = await registerStudent(undefined, { password, phone });
  const id = made.id;
  const course = await firstCourse();
  const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort) VALUES (?, 'ম', 'M', 1)").bind(course.id).run();
  const lesson = await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, body_en, sort) VALUES (?, ?, 'ল', 'L', 'text', 'x', 1)").bind(course.id, mod.meta.last_row_id).run();
  const lessonId = lesson.meta.last_row_id as number;
  const order = await env.DB.prepare(
    "INSERT INTO orders (public_id, invoice_no, student_id, status, subtotal, total, method, gateway, customer_name, customer_email, customer_phone, paid_at) VALUES (?, ?, ?, 'paid', 1500, 1500, 'bkash', 'manual', 'Test Student', ?, ?, '2026-10-30T10:00:00Z')",
  )
    .bind(`del-${id}-${Date.now()}`, `INV-DEL-${id}`, id, made.email, phone)
    .run();
  const enrol = await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, order_id, status, source) VALUES (?, ?, ?, 'active', 'purchase')").bind(id, course.id, order.meta.last_row_id).run();
  await env.DB.prepare("INSERT INTO lesson_progress (student_id, lesson_id, course_id) VALUES (?, ?, ?)").bind(id, lessonId, course.id).run();
  await env.DB.prepare("INSERT INTO lesson_questions (course_id, lesson_id, student_id, body) VALUES (?, ?, ?, 'How long do I bake it?')").bind(course.id, lessonId, id).run();
  await env.DB.prepare("INSERT INTO reviews (course_id, student_id, enrollment_id, rating, body, status) VALUES (?, ?, ?, 5, 'Lovely class', 'approved')").bind(course.id, id, enrol.meta.last_row_id).run();
  await env.DB.prepare("INSERT INTO certificates (code, student_id, course_id, enrollment_id, student_name, course_title_bn, course_title_en) VALUES (?, ?, ?, ?, 'Test Student', 'ক', 'C')")
    .bind(`MWH-DEL-${id}`, id, course.id, enrol.meta.last_row_id)
    .run();
  await env.DB.prepare("INSERT INTO subscribers (email) VALUES (?)").bind(made.email).run();
  await env.DB.prepare("INSERT INTO notify_signups (course_id, email, phone) VALUES (?, ?, ?)").bind(course.id, `someone-${id}@example.test`, phone).run();
  await env.DB.prepare("INSERT INTO reset_codes (student_id, code_hash, expires_at) VALUES (?, 'x', '2099-01-01T00:00:00Z')").bind(id).run();
  await env.DB.prepare("INSERT INTO auth_tokens (kind, subject_type, subject_id, token_hash, expires_at) VALUES ('password_reset', 'student', ?, ?, '2099-01-01T00:00:00Z')").bind(id, `h-${id}-${Date.now()}`).run();
  await env.DB.prepare("INSERT INTO chat_escalations (student_id, question) VALUES (?, 'my phone number is ...')").bind(id).run();
  await env.DB.prepare("UPDATE courses SET rating_count = rating_count WHERE id = ?").bind(course.id).run();
  return { ...made, id, phone, course, password };
}

describe("a student deletes their own account", () => {
  it("on the website: the password and the tick are needed; then everything personal goes, the orders stay, every session ends", async () => {
    const s = await busyStudent();
    const elsewhere = new Client();
    expect((await elsewhere.post("/api/auth/login", { identifier: s.email, password: s.password })).status).toBe(200);
    // a wrong one, failed once on the sign-in page, keeps what was typed in the activity log
    await new Client().post("/api/auth/login", { identifier: s.email, password: "not-it" });

    expect((await s.client.post("/api/auth/delete-account", { password: s.password })).status).toBe(422); // no tick
    const noPw = await s.client.post("/api/auth/delete-account", { confirm: true });
    expect(noPw.status).toBe(422);
    expect((await json(noPw)).error.fields).toEqual({ password: "required" });
    const wrong = await s.client.post("/api/auth/delete-account", { confirm: true, password: "wrong-password" });
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).error).toMatchObject({ code: "invalid_credentials", fields: { password: "wrong_password" } });
    expect(await count("SELECT COUNT(*) AS n FROM students WHERE id = ? AND deleted_at IS NULL", s.id)).toBe(1);

    const res = await s.client.post("/api/auth/delete-account", { confirm: true, password: s.password });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ deleted: true });
    // the failed sign-in from before no longer says what was typed (a new attempt after this is a new security record)
    expect(await count("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'student.login_failed' AND meta LIKE ?", `%${s.email}%`)).toBe(0);

    const row = await env.DB.prepare("SELECT * FROM students WHERE id = ?").bind(s.id).first<any>();
    expect(row).toMatchObject({ name: "Deleted account", email: `deleted-${s.id}@no-email.invalid`, phone: null, address: "", notes: "", password_hash: null, google_sub: null, blocked: 1, blocked_reason: "account_deleted", marketing_opt_in: 0 });
    expect(row.deleted_at).toMatch(/^\d{4}-/);
    for (const [table, col] of [["lesson_progress", "student_id"], ["lesson_questions", "student_id"], ["reviews", "student_id"], ["reset_codes", "student_id"], ["chat_escalations", "student_id"]] as const) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, s.id), table).toBe(0);
    }
    expect(await count("SELECT COUNT(*) AS n FROM auth_tokens WHERE subject_type = 'student' AND subject_id = ?", s.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM subscribers WHERE email = ?", s.email)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM notify_signups WHERE phone = ?", s.phone)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM enrollments WHERE student_id = ? AND status = 'active'", s.id)).toBe(0);
    const cert = await env.DB.prepare("SELECT student_name, revoked_at, revoked_reason FROM certificates WHERE student_id = ?").bind(s.id).first<any>();
    expect(cert).toMatchObject({ student_name: "", revoked_reason: "account_deleted" });
    expect(cert.revoked_at).toBeTruthy();
    // the order and its receipt stay (tax and accounting records)
    expect(await env.DB.prepare("SELECT status, total, customer_name, customer_phone, invoice_no FROM orders WHERE student_id = ?").bind(s.id).first()).toMatchObject({ status: "paid", total: 1500, customer_name: "Test Student", customer_phone: s.phone, invoice_no: `INV-DEL-${s.id}` });
    // the class's rating no longer counts the review
    expect(await count("SELECT rating_count AS n FROM courses WHERE id = ?", s.course.id)).toBe(await count("SELECT COUNT(*) AS n FROM reviews WHERE course_id = ? AND status = 'approved'", s.course.id));

    // signed out here and on the other device; the old e-mail and password open nothing; the certificate check says it is not valid
    expect((await json(await s.client.get("/api/auth/me"))).student).toBeNull();
    expect((await json(await elsewhere.get("/api/auth/me"))).student).toBeNull();
    expect((await new Client().post("/api/auth/login", { identifier: s.email, password: s.password })).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { identifier: studentCode(s.id), password: s.password })).status).toBe(401);

    // the activity log keeps the account number, never the name or what was typed to sign in
    const log = await env.DB.prepare("SELECT actor_name, meta FROM activity_log WHERE action = 'student.account_deleted' AND entity_id = ?").bind(String(s.id)).first<any>();
    expect(log.actor_name).toBe("");
    expect(JSON.parse(log.meta)).toMatchObject({ by: "self", via: "web", classes: 1, certificates: 1 });
    expect(await count("SELECT COUNT(*) AS n FROM activity_log WHERE actor_type = 'student' AND actor_id = ? AND actor_name <> ''", s.id)).toBe(0);

    // the owner hears of it by the student ID only
    const note = await until(async () => (await mailsTo("mawahacademy@gmail.com")).find((m) => m.subject.includes(studentCode(s.id))));
    expect(note.subject).toContain("deleted");
    expect(note.text).not.toContain(s.email);
    expect(note.text).not.toContain(s.phone);
  });

  it("in the app, with its token; an account that has no password (made at checkout) needs only the tick", async () => {
    const s = await busyStudent("app-delete-123");
    const login = await json(await new Client().post("/api/auth/login", { identifier: s.email, password: s.password, client: "app" }));
    const app = new Client();
    const res = await app.fetch("/api/auth/delete-account", bearer(login.token, { method: "POST", body: JSON.stringify({ confirm: true, password: s.password }) }));
    expect(res.status).toBe(200);
    expect((await json(await app.fetch("/api/auth/me", bearer(login.token)))).student).toBeNull();
    const log = await env.DB.prepare("SELECT meta FROM activity_log WHERE action = 'student.account_deleted' AND entity_id = ?").bind(String(s.id)).first<any>();
    expect(JSON.parse(log.meta)).toMatchObject({ by: "self", via: "app" });

    // no password on the account (bought without one, never chose one): being signed in is the proof
    const guest = await registerStudent();
    await env.DB.prepare("UPDATE students SET password_hash = NULL, source = 'checkout' WHERE id = ?").bind(guest.id).run();
    expect((await guest.client.post("/api/auth/delete-account", { confirm: false })).status).toBe(422);
    expect((await guest.client.post("/api/auth/delete-account", { confirm: true })).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM students WHERE id = ? AND deleted_at IS NOT NULL", guest.id)).toBe(1);
    // and nobody signed out can
    expect((await new Client().post("/api/auth/delete-account", { confirm: true })).status).toBe(401);
  });
});

describe("staff delete an account on request (Admin → Students)", () => {
  it("needs the reason; afterwards the account is out of the lists and nothing more can be done with it", async () => {
    const s = await busyStudent("staff-delete-123");
    const admin = (await loginStaff("super_admin")).client;
    expect((await (await loginStaff("viewer")).client.post(`/api/admin/students/${s.id}/delete-account`, { reason: "asked" })).status).toBe(403);
    expect((await admin.post(`/api/admin/students/${s.id}/delete-account`, { reason: "" })).status).toBe(422);
    const res = await admin.post(`/api/admin/students/${s.id}/delete-account`, { reason: "WhatsApp message, 1 Nov" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ classes: 1, certificates: 1 });
    expect((await json(await s.client.get("/api/auth/me"))).student).toBeNull();

    const detail = await json(await admin.get(`/api/admin/students/${s.id}`));
    expect(detail.student).toMatchObject({ name: "Deleted account", email: "", phone: null });
    expect(detail.student.deleted_at).toBeTruthy();
    expect(detail.orders).toHaveLength(1); // the order stays, for the records
    const listed = await json(await admin.get(`/api/admin/students?q=${encodeURIComponent(studentCode(s.id))}`));
    expect(listed.items.map((x: { id: number }) => x.id)).not.toContain(s.id);

    for (const [method, path, body] of [
      ["PATCH", `/api/admin/students/${s.id}`, { name: "Back again" }],
      ["POST", `/api/admin/students/${s.id}/unblock`, {}],
      ["POST", `/api/admin/students/${s.id}/enroll`, { course_ids: [s.course.id] }],
      ["POST", `/api/admin/students/${s.id}/invite`, { mode: "link" }],
      ["POST", `/api/admin/students/${s.id}/delete-account`, { reason: "again" }],
    ] as const) {
      const r = await admin.fetch(path, { method, json: body });
      expect(r.status, path).toBe(409);
      expect((await json(r)).error.code, path).toBe("account_deleted");
    }
    const log = await env.DB.prepare("SELECT actor_type, summary, meta FROM activity_log WHERE action = 'student.account_deleted' AND entity_id = ?").bind(String(s.id)).first<any>();
    expect(log).toMatchObject({ actor_type: "staff", summary: "WhatsApp message, 1 Nov" });
    expect(JSON.parse(log.meta)).toMatchObject({ by: "staff" });
    expect((await admin.post("/api/admin/students/999999/delete-account", { reason: "x" })).status).toBe(404);
  });
});

describe("the web pages Google Play is given", () => {
  it("/account/delete explains it in both languages, with a button to the profile and the contact details", async () => {
    await setSetting(env, "contact", { ...SETTING_DEFAULTS.contact, whatsapp: "+880 13 0405 0584", phone: "09613-754321", email: "info@mawahbd.com" }, null);
    for (const [url, lang, title] of [["/account/delete", "bn", "অ্যাকাউন্ট ডিলিট করুন"], ["/en/account/delete", "en", "Delete your account"]] as const) {
      const res = await new Client().get(url);
      expect(res.status, url).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html).toContain(renderMarkdown(ACCOUNT_DELETION_TEXT[lang]));
      expect(html).toContain('href="/app/profile?delete=1"');
      expect(html).toContain('href="mailto:info@mawahbd.com"');
    }
    // the footer of every page links it, and the sitemap lists it
    expect(await (await new Client().get("/en")).text()).toContain('href="/en/account/delete"');
    expect(await (await new Client().get("/sitemap.xml")).text()).toContain("/account/delete</loc>");
  });

  it("the privacy page always covers the Android app and deleting, unless the owner's own text already links the deletion page", async () => {
    for (const [url, lang] of [["/policies/privacy", "bn"], ["/en/policies/privacy", "en"]] as const) {
      const html = await (await new Client().get(url)).text();
      expect(html, url).toContain(renderMarkdown(PRIVACY_APP_TEXT[lang]));
    }
    // the live site keeps its own privacy text (saved in Admin): the app section is added under it
    await setSetting(env, "policies", { ...SETTING_DEFAULTS.policies, privacy_en: "Privacy Policy\nOur own short text." }, null);
    const own = await (await new Client().get("/en/policies/privacy")).text();
    expect(own).toContain("Privacy Policy<br>Our own short text."); // typed line by line in Admin: the lines stay lines
    expect(own).toContain("The MAWAH Academy app for Android");
    // an owner who wrote it all themselves (with the link) gets no second copy
    await setSetting(env, "policies", { ...SETTING_DEFAULTS.policies, privacy_en: "Everything, including [deleting](/en/account/delete)." }, null);
    expect(await (await new Client().get("/en/policies/privacy")).text()).not.toContain("The MAWAH Academy app for Android");
    await setSetting(env, "policies", SETTING_DEFAULTS.policies, null);
  });

  it("the app section answers what Google Play's User Data policy asks a privacy page, in both languages", async () => {
    // who gets what (couriers for shop orders, the website's analytics and Meta Pixel), how long it is kept, where, children, who to ask, and when
    const needs = {
      en: ["## Who receives information", "Couriers (Steadfast or Pathao)", "Meta Pixel", "Firebase Cloud Messaging", "## How long we keep information", "30 days without use", "90 days after the order is settled", "## Where it is stored", "## Children", "children under 13", "## Privacy questions", "last updated on 7 November 2026", "no health or fitness information", "(/en/account/delete)"],
      bn: ["## কারা তথ্য পায়", "কুরিয়ার (স্টেডফাস্ট বা পাঠাও)", "Meta Pixel", "Firebase Cloud Messaging", "## কতদিন তথ্য রাখা হয়", "৩০ দিন ব্যবহার না হলে", "নিষ্পত্তির ৯০ দিন পর", "## তথ্য কোথায় থাকে", "## শিশুরা", "১৩ বছরের কম", "## গোপনীয়তা নিয়ে প্রশ্ন", "৭ নভেম্বর, ২০২৬", "স্বাস্থ্য বা ফিটনেসের তথ্য নেয় না", "(/account/delete)"],
    } as const;
    for (const lang of ["bn", "en"] as const) for (const n of needs[lang]) expect(PRIVACY_APP_TEXT[lang], `${lang}: ${n}`).toContain(n);
    // the two languages say the same things: the same sections, the same bullets
    const shape = (s: string) => [s.match(/^## /gm)?.length, s.match(/^- /gm)?.length];
    expect(shape(PRIVACY_APP_TEXT.bn)).toEqual(shape(PRIVACY_APP_TEXT.en));
    // the numbers it states are the ones the code uses
    expect(PROOF_RETENTION_DAYS).toBe(90);
    expect(GUEST_KEEP_DAYS).toBe(30);
  });
});
