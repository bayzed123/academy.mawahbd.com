import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Client, firstCourse, json, loginStaff, registerStudent } from "./helpers";

/**
 * The Android app signs in with the same accounts, but keeps its session token itself: login with `client: "app"` returns the token (no
 * cookie), and the app sends it back as `Authorization: Bearer …`. Students only — staff sessions are never read from a header.
 */
async function appLogin(identifier: string, password: string) {
  const client = new Client();
  const res = await client.post("/api/auth/login", { identifier, password, client: "app" });
  return { res, client, body: await json(res) };
}

const bearer = (token: string, extra: RequestInit = {}) => ({ ...extra, headers: { ...(extra.headers as Record<string, string>), authorization: `Bearer ${token}` } });

describe("Android app sign-in (Bearer token)", () => {
  it("returns a token instead of a cookie, and the token signs the app in", async () => {
    const { email } = await registerStudent(undefined, { password: "app-password-1" });
    const { res, body, client } = await appLogin(email, "app-password-1");
    expect(res.status).toBe(200);
    expect(body.student.email).toBe(email);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // no session cookie and no "signed in" hint cookie: the app keeps the token itself
    expect(res.headers.getSetCookie().join("\n")).not.toMatch(/mawah_sid|mawah_in/);
    expect(client.jar.size).toBe(0);

    // a fresh client with only the header is signed in
    const app = new Client();
    const me = await json(await app.fetch("/api/auth/me", bearer(body.token)));
    expect(me.student.email).toBe(email);
    expect((await app.fetch("/api/student/courses", bearer(body.token))).status).toBe(200);
    // without the header it is not
    expect((await json(await app.get("/api/auth/me"))).student).toBeNull();
    expect((await app.get("/api/student/courses")).status).toBe(401);
  });

  it("reads the enrolled class, its lessons and marks one done through the token (no Origin header, like the app)", async () => {
    const { email } = await registerStudent(undefined, { password: "app-password-2" });
    const student = await env.DB.prepare("SELECT id FROM students WHERE email = ?").bind(email).first<{ id: number }>();
    const course = await firstCourse();
    const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort) VALUES (?, 'ম', 'M', 1)").bind(course.id).run();
    await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, body_en, sort) VALUES (?, ?, 'ল', 'L', 'text', 'x', 1)")
      .bind(course.id, mod.meta.last_row_id)
      .run();
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'admin')").bind(student!.id, course.id).run();
    const { body } = await appLogin(email, "app-password-2");
    const app = new Client();

    const mine = await json(await app.fetch("/api/student/courses", bearer(body.token)));
    expect(mine.courses.map((m: { course: { slug: string } }) => m.course.slug)).toContain(course.slug);
    const view = await json(await app.fetch(`/api/student/courses/${course.slug}`, bearer(body.token)));
    expect(view.course.slug).toBe(course.slug);
    const lesson = view.curriculum.flatMap((m: { lessons: { id: number }[] }) => m.lessons)[0];
    expect(lesson).toBeTruthy();
    expect((await app.fetch(`/api/student/lessons/${lesson.id}`, bearer(body.token))).status).toBe(200);
    const done = await app.fetch(`/api/student/lessons/${lesson.id}/complete`, bearer(body.token, { method: "POST" }));
    expect(done.status).toBe(200);
  });

  it("logging out on the app ends that token only", async () => {
    const { email } = await registerStudent(undefined, { password: "app-password-3" });
    const first = (await appLogin(email, "app-password-3")).body.token as string;
    const second = (await appLogin(email, "app-password-3")).body.token as string;
    const app = new Client();
    expect((await app.fetch("/api/auth/logout", bearer(first, { method: "POST" }))).status).toBe(200);
    expect((await json(await app.fetch("/api/auth/me", bearer(first)))).student).toBeNull();
    // the other phone stays signed in
    expect((await json(await app.fetch("/api/auth/me", bearer(second)))).student.email).toBe(email);
  });

  it("a password changed on the app hands the app a new token, and every older session stops working", async () => {
    const { email, client: browser } = await registerStudent(undefined, { password: "app-password-4" });
    const { body } = await appLogin(email, "app-password-4");
    const app = new Client();
    const res = await app.fetch("/api/auth/change-password", bearer(body.token, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current: "app-password-4", next: "app-password-4b" }) }));
    expect(res.status).toBe(200);
    const changed = await json(res);
    expect(changed.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(changed.token).not.toBe(body.token);
    expect(res.headers.getSetCookie().join("\n")).not.toMatch(/mawah_sid/);
    expect((await json(await app.fetch("/api/auth/me", bearer(changed.token)))).student.email).toBe(email);
    // the old token was made before the new password, so it is refused
    expect((await json(await app.fetch("/api/auth/me", bearer(body.token)))).student).toBeNull();
    // the website session from before the change is signed out too
    expect((await json(await browser.get("/api/auth/me"))).student).toBeNull();
  });

  it("a blocked student's app token stops working", async () => {
    const { email } = await registerStudent(undefined, { password: "app-password-5" });
    const { body } = await appLogin(email, "app-password-5");
    await env.DB.prepare("UPDATE students SET blocked = 1 WHERE email = ?").bind(email).run();
    expect((await new Client().fetch("/api/student/courses", bearer(body.token))).status).toBe(401);
  });

  it("refuses made-up, malformed and staff tokens", async () => {
    const app = new Client();
    for (const header of ["Bearer nope", "Bearer " + "A".repeat(43), "Basic Zm9vOmJhcg==", "Bearer a b c"]) {
      expect((await app.fetch("/api/student/courses", { headers: { authorization: header } })).status).toBe(401);
    }
    // a staff member's session token, sent as a header, signs in neither Admin nor the student side
    const { client: staff } = await loginStaff();
    const staffToken = [...staff.jar].find(([name]) => /mawah_asid$/.test(name))?.[1];
    expect(staffToken).toBeTruthy();
    expect((await app.fetch("/api/admin/dashboard", bearer(staffToken!))).status).toBe(401);
    expect((await json(await app.fetch("/api/auth/me", bearer(staffToken!)))).student).toBeNull();
  });

  it("the website login is unchanged: a cookie, and no token in the answer", async () => {
    const { email } = await registerStudent(undefined, { password: "web-password-1" });
    const client = new Client();
    const res = await client.post("/api/auth/login", { identifier: email, password: "web-password-1" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.token).toBeUndefined();
    expect(res.headers.getSetCookie().join("\n")).toMatch(/mawah_sid=/);
    // anything but "app" is refused rather than ignored
    expect((await client.post("/api/auth/login", { identifier: email, password: "web-password-1", client: "ios" })).status).toBe(422);
  });

  it("a wrong password on the app gets the same answer as on the website", async () => {
    const { email } = await registerStudent(undefined, { password: "app-password-6" });
    const { res, body } = await appLogin(email, "wrong-password");
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("invalid_credentials");
    expect(body.token).toBeUndefined();
  });
});
