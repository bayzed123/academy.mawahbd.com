import { describe, expect, it } from "vitest";
import { studentCode } from "@mawah/shared";
import { REVIEW_EMAIL } from "../src/routes/api/admin/app";
import { Client, env, firstCourse, json, loginStaff, registerStudent } from "./helpers";

/*
 * The Android app's free classes (courses.channel = 'app', migration 0023). Staff choose "Android app only — free" in a class's editor; the
 * class is then free in the app for anyone with an account, and the website never lists, shows or sells it. The app also has its own
 * sign-up (mobile number required, e-mail optional), a notice, and a test account for Google Play's reviewers (Admin → Android app).
 */

const bearer = (token: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}`, "content-type": "application/json" } });
const count = async (sql: string, ...params: (string | number)[]) => (await env.DB.prepare(sql).bind(...params).first<{ n: number }>())!.n;
let n = 0;
const phone = () => `018${String((Date.now() + n++) % 100_000_000).padStart(8, "0")}`;

const classBody = (over: Record<string, unknown> = {}) => ({
  title_bn: "ফ্রি অ্যাপ ক্লাস",
  title_en: `Free App Class ${n++}`,
  short_bn: "",
  short_en: "Learn the basics free in the app",
  long_bn: "",
  long_en: "**All** you need to start",
  banner_key: null,
  icon: "cake",
  category_id: 1,
  instructor_id: 1,
  level: "beginner",
  price: 900,
  status: "published",
  channel: "app",
  details_url: null,
  featured: true,
  cert_enabled: true,
  seo_title_bn: "",
  seo_title_en: "",
  seo_desc_bn: "",
  seo_desc_en: "",
  sort: 1,
  launch_at: null,
  ...over,
});

/** A live free class made the way staff make one (Admin → Classes → new, "Android app only — free"), with one lesson. */
async function appClass(over: Record<string, unknown> = {}) {
  const { client } = await loginStaff("content_manager");
  const res = await client.post("/api/admin/courses", classBody(over));
  expect(res.status).toBe(201);
  const { item } = await json(res);
  const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort) VALUES (?, 'ম', 'Start here', 1)").bind(item.id).run();
  await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, body_en, sort) VALUES (?, ?, 'ল', 'Your first cake', 'text', 'Mix and bake.', 1)")
    .bind(item.id, mod.meta.last_row_id)
    .run();
  // (the lesson editor keeps this count; a lesson put straight into the table needs it set by hand)
  await env.DB.prepare("UPDATE courses SET lesson_count = 1 WHERE id = ?").bind(item.id).run();
  return { ...(item as { id: number; slug: string; price: number; channel: string; title_en: string }), staff: client };
}

/** A student signed in the way the app signs in (a token, no cookie). */
async function appStudent() {
  const { email } = await registerStudent(undefined, { password: "app-student-pass" });
  const res = await new Client().post("/api/auth/login", { identifier: email, password: "app-student-pass", client: "app" });
  const body = await json(res);
  return { email, id: body.student.id as number, token: body.token as string, client: new Client() };
}

describe("staff make a class free in the Android app", () => {
  it("an app class never has a price; the channel can be filtered and is in the CSV", async () => {
    const c = await appClass();
    expect(c).toMatchObject({ channel: "app", price: 0 });
    // a price sent later is ignored too
    const patched = await json(await c.staff.patch(`/api/admin/courses/${c.id}`, { price: 1500 }));
    expect(patched.item.price).toBe(0);
    // the class editor's list can show only the app's classes
    const listed = await json(await c.staff.get("/api/admin/courses?channel=app&per_page=100"));
    expect(listed.items.map((r: { id: number }) => r.id)).toContain(c.id);
    expect(listed.items.every((r: { channel: string }) => r.channel === "app")).toBe(true);
    // a class staff never touched stays a website class
    expect((await firstCourse()) as unknown).toMatchObject({ channel: "website" });
  });

  it("a class in a bundle cannot become an app class, and an app class cannot go in a bundle", async () => {
    const { client } = await loginStaff("content_manager");
    const site = await json(await client.post("/api/admin/courses", classBody({ channel: "website", title_en: `Bundled ${n++}` })));
    const bundle = await client.post("/api/admin/bundles", { title_bn: "ব", title_en: `Pair ${n++}`, desc_bn: "", desc_en: "", price: 1000, status: "published", banner_key: null, sort: 1, course_ids: [site.item.id] });
    expect(bundle.status).toBe(201);
    const moved = await client.patch(`/api/admin/courses/${site.item.id}`, { channel: "app" });
    expect(moved.status).toBe(409);
    expect((await json(moved)).error).toMatchObject({ code: "in_bundle", fields: { channel: "in_bundle" } });

    const app = await appClass();
    const refused = await client.post("/api/admin/bundles", { title_bn: "ব", title_en: `With app ${n++}`, desc_bn: "", desc_en: "", price: 1000, status: "published", banner_key: null, sort: 1, course_ids: [app.id] });
    expect(refused.status).toBe(422);
    expect((await json(refused)).error.fields).toEqual({ course_ids: "app_class" });
  });
});

describe("the website never shows or sells an app class", () => {
  it("not on the home page, the class list, search, its own address, the API or the sitemap", async () => {
    const c = await appClass({ title_en: "Secret Free Sponge" });
    const visitor = new Client();
    for (const path of ["/", "/en", "/courses", "/en/courses", `/en/courses?q=${encodeURIComponent("Secret Free Sponge")}`]) {
      const html = await (await visitor.get(path)).text();
      // (the search page repeats what was typed, so the class's own address is what must not be there)
      if (!path.includes("?q=")) expect(html, path).not.toContain("Secret Free Sponge");
      expect(html, path).not.toContain(c.slug);
    }
    expect((await visitor.get(`/courses/${c.slug}`)).status).toBe(404);
    expect((await visitor.get(`/en/courses/${c.slug}`)).status).toBe(404);
    expect((await visitor.get(`/api/courses/${c.slug}`)).status).toBe(404);
    const api = await json(await visitor.get("/api/courses?per_page=60"));
    expect(api.courses.map((x: { slug: string }) => x.slug)).not.toContain(c.slug);
    const search = await json(await visitor.get(`/api/courses?q=${encodeURIComponent("Secret Free")}`));
    expect(search.total).toBe(0);
    expect(await (await visitor.get("/sitemap.xml")).text()).not.toContain(c.slug);
  });

  it("checkout refuses it, alone or with a website class", async () => {
    const c = await appClass();
    const site = await firstCourse();
    const { client } = await registerStudent();
    for (const courses of [[c.slug], [site.slug, c.slug]]) {
      const quote = await client.post("/api/checkout/quote", { courses });
      expect(quote.status, courses.join("+")).toBe(422);
      expect((await json(quote)).error.code).toBe("course_unavailable");
      const buy = await client.post("/api/checkout", { agree: true, courses, channel: "mock" });
      expect(buy.status).toBe(422);
    }
    expect(await count("SELECT COUNT(*) AS n FROM order_items WHERE course_id = ?", c.id)).toBe(0);
  });
});

describe("the app lists its free classes and a student starts one with a tap", () => {
  it("lists live app classes only (no website class, no draft)", async () => {
    const live = await appClass({ title_en: "Live Free One" });
    const draft = await appClass({ title_en: "Draft Free One", status: "draft" });
    const res = await new Client().get("/api/app/courses");
    expect(res.status).toBe(200);
    const body = await json(res);
    const slugs = body.courses.map((x: { slug: string }) => x.slug);
    expect(slugs).toContain(live.slug);
    expect(slugs).not.toContain(draft.slug);
    expect(slugs).not.toContain((await firstCourse()).slug);
    expect(body.courses.find((x: { slug: string }) => x.slug === live.slug)).toMatchObject({ price: 0, lesson_count: 1 });
    // a website class or a draft is "not found" behind the app's address
    expect((await new Client().get(`/api/app/courses/${(await firstCourse()).slug}`)).status).toBe(404);
    expect((await new Client().get(`/api/app/courses/${draft.slug}`)).status).toBe(404);
  });

  it("shows the class and its lessons to anyone; joining needs an account, makes no order, and opens every lesson", async () => {
    const c = await appClass();
    const anyone = await json(await new Client().get(`/api/app/courses/${c.slug}`));
    expect(anyone).toMatchObject({ joined: false, revoked: false, course: { slug: c.slug, price: 0, channel: "app" } });
    expect(anyone.curriculum[0].lessons[0]).toMatchObject({ title_en: "Your first cake" });
    expect((await new Client().post(`/api/app/courses/${c.slug}/join`)).status).toBe(401);

    const s = await appStudent();
    const before = await count("SELECT COUNT(*) AS n FROM orders");
    const joined = await s.client.fetch(`/api/app/courses/${c.slug}/join`, bearer(s.token, { method: "POST", body: "{}" }));
    expect(joined.status).toBe(200);
    expect(await json(joined)).toMatchObject({ joined: true, slug: c.slug });
    // again: nothing changes
    expect((await s.client.fetch(`/api/app/courses/${c.slug}/join`, bearer(s.token, { method: "POST", body: "{}" }))).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM enrollments WHERE student_id = ? AND course_id = ? AND status = 'active' AND source = 'free' AND order_id IS NULL", s.id, c.id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM orders")).toBe(before);
    expect(await count("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'enrollment.joined_free' AND actor_id = ?", s.id)).toBe(1);

    // the class is theirs: in "My classes", its page and its lesson
    const view = await json(await s.client.fetch(`/api/app/courses/${c.slug}`, bearer(s.token)));
    expect(view.joined).toBe(true);
    const mine = await json(await s.client.fetch("/api/student/courses", bearer(s.token)));
    expect(mine.courses.map((m: { course: { slug: string } }) => m.course.slug)).toContain(c.slug);
    const course = await json(await s.client.fetch(`/api/student/courses/${c.slug}`, bearer(s.token)));
    expect(course.course).toMatchObject({ slug: c.slug, channel: "app" });
    const lessonId = course.curriculum[0].lessons[0].id;
    expect((await s.client.fetch(`/api/student/lessons/${lessonId}`, bearer(s.token))).status).toBe(200);
    expect((await s.client.fetch(`/api/student/lessons/${lessonId}/complete`, bearer(s.token, { method: "POST", body: "{}" }))).status).toBe(200);
  });

  it("a class staff took back stays taken back: joining again is refused", async () => {
    const c = await appClass();
    const s = await appStudent();
    await s.client.fetch(`/api/app/courses/${c.slug}/join`, bearer(s.token, { method: "POST", body: "{}" }));
    await env.DB.prepare("UPDATE enrollments SET status = 'revoked', revoked_at = '2026-11-01T00:00:00Z' WHERE student_id = ? AND course_id = ?").bind(s.id, c.id).run();
    const again = await s.client.fetch(`/api/app/courses/${c.slug}/join`, bearer(s.token, { method: "POST", body: "{}" }));
    expect(again.status).toBe(403);
    expect((await json(again)).error.code).toBe("enrollment_revoked");
    expect(await json(await s.client.fetch(`/api/app/courses/${c.slug}`, bearer(s.token)))).toMatchObject({ joined: false, revoked: true });
  });
});

describe("making an account in the app", () => {
  it("a mobile number and a password are enough: the app is signed in with a token, and logs in with the number later", async () => {
    const num = phone();
    const res = await new Client().post("/api/auth/app-register", { name: "  Rina   Akter ", phone: num, password: "free-class-pass", lang: "bn" });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.student).toMatchObject({ name: "Rina Akter", email: "", phone: num, has_password: true });
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.headers.getSetCookie().join("\n")).not.toMatch(/mawah_sid/);
    const me = await json(await new Client().fetch("/api/auth/me", bearer(body.token)));
    expect(me.student.id).toBe(body.student.id);
    const row = await env.DB.prepare("SELECT email, source, password_hash FROM students WHERE id = ?").bind(body.student.id).first<{ email: string; source: string; password_hash: string }>();
    expect(row).toMatchObject({ email: `p${num}@no-email.invalid`, source: "signup" });
    expect(row!.password_hash).toMatch(/^pbkdf2-sha256\$/);
    expect(await count("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'student.register' AND entity_id = ? AND meta LIKE '%\"via\":\"app\"%'", String(body.student.id))).toBe(1);

    // later: the number signs in (and so does the student ID)
    expect((await new Client().post("/api/auth/login", { identifier: num, password: "free-class-pass", client: "app" })).status).toBe(200);
    expect((await new Client().post("/api/auth/login", { identifier: studentCode(body.student.id), password: "free-class-pass", client: "app" })).status).toBe(200);
  });

  it("with an e-mail the account is kept under it; a number or an e-mail that has an account already is refused", async () => {
    const num = phone();
    const email = `app-${Date.now()}@example.test`;
    const made = await new Client().post("/api/auth/app-register", { name: "Sumi", phone: num, email, password: "free-class-pass" });
    expect(made.status).toBe(201);
    expect((await json(made)).student.email).toBe(email);

    const sameEmail = await new Client().post("/api/auth/app-register", { name: "Sumi", phone: phone(), email, password: "free-class-pass" });
    expect(sameEmail.status).toBe(409);
    expect((await json(sameEmail)).error).toMatchObject({ code: "email_taken", fields: { email: "email_taken" } });
    // without an e-mail the number is who they are: one that has an account already (here, the one just made) is not a second one
    const sameNumber = await new Client().post("/api/auth/app-register", { name: "Sumi", phone: num, password: "free-class-pass" });
    expect(sameNumber.status).toBe(409);
    expect((await json(sameNumber)).error).toMatchObject({ code: "phone_taken", fields: { phone: "phone_taken" } });
  });

  it("checks what is typed", async () => {
    const bad = await new Client().post("/api/auth/app-register", { name: "A", phone: "12", email: "not-an-email", password: "short" });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields).toMatchObject({ name: "required", phone: "invalid_phone", email: "invalid_email", password: "weak_password" });
    const noPhone = await new Client().post("/api/auth/app-register", { name: "Asha", password: "free-class-pass" });
    expect((await json(noPhone)).error.fields).toMatchObject({ phone: "required" });
  });
});

describe("Admin → Android app", () => {
  it("lists the app's classes and its numbers; anyone on staff may look", async () => {
    const c = await appClass({ title_en: "Counted Free Class" });
    const s = await appStudent();
    await s.client.fetch(`/api/app/courses/${c.slug}/join`, bearer(s.token, { method: "POST", body: "{}" }));
    await new Client().post("/api/auth/app-register", { name: "Counted", phone: phone(), password: "free-class-pass" });

    const viewer = (await loginStaff("viewer")).client;
    const res = await viewer.get("/api/admin/app");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.classes.find((x: { id: number }) => x.id === c.id)).toMatchObject({ title_en: "Counted Free Class", status: "published", students: 1, lesson_count: 1 });
    expect(body.classes.map((x: { id: number }) => x.id)).not.toContain((await firstCourse()).id);
    expect(body.numbers.days).toBe(30);
    expect(body.numbers.sign_ins).toBeGreaterThanOrEqual(1);
    expect(body.numbers.sign_ups).toBeGreaterThanOrEqual(1);
    expect(body.numbers.joins).toBeGreaterThanOrEqual(1);
    expect(body.numbers.learners).toBeGreaterThanOrEqual(1);
    expect(body.notice).toEqual({ notice_on: false, notice_bn: "", notice_en: "" });
    expect((await new Client().get("/api/admin/app")).status).toBe(401);
  });

  it("the notice: saved by a super admin, needs both languages to be on, and reaches the app through /api/site", async () => {
    const { client } = await loginStaff("super_admin");
    expect((await json(await new Client().get("/api/site"))).site.app_notice).toBeNull();
    const half = await client.put("/api/admin/settings/app", { notice_on: true, notice_bn: "নতুন ক্লাস এসেছে", notice_en: "" });
    expect(half.status).toBe(422);
    expect((await json(half)).error.fields).toEqual({ notice_en: "required" });
    expect((await (await loginStaff("content_manager")).client.put("/api/admin/settings/app", { notice_on: true, notice_bn: "x", notice_en: "x" })).status).toBe(403);

    expect((await client.put("/api/admin/settings/app", { notice_on: true, notice_bn: "নতুন ক্লাস এসেছে", notice_en: "A new class is here" })).status).toBe(200);
    expect((await json(await new Client().get("/api/site"))).site.app_notice).toEqual({ bn: "নতুন ক্লাস এসেছে", en: "A new class is here" });
    // switched off: gone from the app, the words kept for next time
    await client.put("/api/admin/settings/app", { notice_on: false, notice_bn: "নতুন ক্লাস এসেছে", notice_en: "A new class is here" });
    expect((await json(await new Client().get("/api/site"))).site.app_notice).toBeNull();
    expect((await json(await client.get("/api/admin/app"))).notice).toMatchObject({ notice_on: false, notice_en: "A new class is here" });
  });

  it("the Google Play test account: made once, its password shown once, a new one ends every old sign-in", async () => {
    const { client } = await loginStaff("super_admin");
    expect((await json(await client.get("/api/admin/app"))).review_account).toBeNull();
    // only a super admin makes it
    expect((await (await loginStaff("content_manager")).client.post("/api/admin/app/review-account")).status).toBe(403);

    const made = await json(await client.post("/api/admin/app/review-account"));
    expect(made).toMatchObject({ created: true, code: expect.stringMatching(/^STU-\d{6}$/) });
    expect(made.password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    const row = await env.DB.prepare("SELECT id, name, source, phone FROM students WHERE email = ?").bind(REVIEW_EMAIL).first<{ id: number; name: string; source: string; phone: string | null }>();
    expect(row).toMatchObject({ name: "Google Play reviewer", source: "admin", phone: null });
    expect(studentCode(row!.id)).toBe(made.code);
    // the reviewer signs in to the app with the student ID
    const signIn = await new Client().post("/api/auth/login", { identifier: made.code, password: made.password, client: "app" });
    expect(signIn.status).toBe(200);
    const token = (await json(signIn)).token as string;
    // the overview never shows the password again
    const overview = await json(await client.get("/api/admin/app"));
    expect(overview.review_account).toMatchObject({ code: made.code, blocked: false });
    expect(JSON.stringify(overview)).not.toContain(made.password);
    // nor does the activity log
    expect(await count("SELECT COUNT(*) AS n FROM activity_log WHERE action LIKE 'app.review_account%' AND (meta LIKE ? OR summary LIKE ?)", `%${made.password}%`, `%${made.password}%`)).toBe(0);

    // a new password: the same account, the old password and the old sign-in stop working
    const again = await json(await client.post("/api/admin/app/review-account"));
    expect(again).toMatchObject({ created: false, code: made.code });
    expect(again.password).not.toBe(made.password);
    expect((await new Client().post("/api/auth/login", { identifier: made.code, password: made.password, client: "app" })).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { identifier: made.code, password: again.password, client: "app" })).status).toBe(200);
    expect((await json(await new Client().fetch("/api/auth/me", bearer(token)))).student).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM students WHERE email = ?", REVIEW_EMAIL)).toBe(1);
  });
});
