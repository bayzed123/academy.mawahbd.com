import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Client, json, loginStaff, registerStudent, uniqueEmail } from "./helpers";

describe("security headers", () => {
  it("adds hardening headers and no-store to API responses", async () => {
    const res = await new Client().get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("student registration & login", () => {
  it("registers, sets an HttpOnly session cookie and returns the profile", async () => {
    const { res, body, client } = await registerStudent();
    expect(res.status).toBe(201);
    expect(body.student.email).toMatch(/@example\.test$/);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/mawah_sid=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const me = await json(await client.get("/api/auth/me"));
    expect(me.student.name).toBe("Test Student");
  });

  it("never stores a plain password and never returns the hash", async () => {
    const { email, body } = await registerStudent(undefined, { password: "my-secret-password" });
    expect(JSON.stringify(body)).not.toContain("password");
    const row = await env.DB.prepare("SELECT password_hash FROM students WHERE email = ?").bind(email).first<{ password_hash: string }>();
    expect(row!.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(row!.password_hash).not.toContain("my-secret-password");
  });

  it("rejects duplicate e-mail (case-insensitive) with a field error", async () => {
    const { email } = await registerStudent();
    const again = await new Client().post("/api/auth/register", { name: "Other", email: email.toUpperCase(), password: "another-pass-1" });
    expect(again.status).toBe(409);
    const body = await json(again);
    expect(body.error.code).toBe("email_taken");
    expect(body.error.fields.email).toBe("email_taken");
  });

  it("validates input with per-field codes", async () => {
    const res = await new Client().post("/api/auth/register", { name: "A", email: "nope", password: "123", phone: "12345" });
    expect(res.status).toBe(422);
    const { error } = await json(res);
    expect(error.fields).toMatchObject({ name: "required", email: "invalid_email", password: "weak_password", phone: "invalid_phone" });
  });

  it("logs in with the right password and rejects the wrong one without leaking which part was wrong", async () => {
    const { email } = await registerStudent(undefined, { password: "right-password-1" });
    const bad = await new Client().post("/api/auth/login", { email, password: "wrong-password-1" });
    expect(bad.status).toBe(401);
    expect((await json(bad)).error.code).toBe("invalid_credentials");

    const unknown = await new Client().post("/api/auth/login", { email: uniqueEmail("ghost"), password: "whatever-123" });
    expect(unknown.status).toBe(401);
    expect((await json(unknown)).error.code).toBe("invalid_credentials");

    const client = new Client();
    const good = await client.post("/api/auth/login", { email, password: "right-password-1" });
    expect(good.status).toBe(200);
    expect((await json(await client.get("/api/auth/me"))).student.email).toBe(email);
  });

  it("locks the account for 15 minutes after 8 wrong passwords", async () => {
    const { email } = await registerStudent(undefined, { password: "right-password-1" });
    let last = 0;
    for (let i = 0; i < 8; i++) {
      // a new client (new IP) each time so the per-IP limiter is not what we're testing
      last = (await new Client().post("/api/auth/login", { email, password: "nope-nope-nope" })).status;
    }
    expect(last).toBe(401);
    const locked = await new Client().post("/api/auth/login", { email, password: "right-password-1" });
    expect(locked.status).toBe(429);
    expect((await json(locked)).error.code).toBe("account_locked");
  });

  it("logout clears the session", async () => {
    const { client } = await registerStudent();
    await client.post("/api/auth/logout");
    const me = await json(await client.get("/api/auth/me"));
    expect(me.student).toBeNull();
  });

  it("blocked students cannot use an existing session and cannot log in", async () => {
    const { client, email, id } = await registerStudent(undefined, { password: "right-password-1" });
    await env.DB.prepare("UPDATE students SET blocked = 1 WHERE id = ?").bind(id).run();
    expect((await json(await client.get("/api/auth/me"))).student).toBeNull();
    const res = await new Client().post("/api/auth/login", { email, password: "right-password-1" });
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("account_blocked");
  });
});

describe("password reset", () => {
  it("emails a one-time link, accepts it once, and signs out other sessions", async () => {
    const { client: oldDevice, email } = await registerStudent(undefined, { password: "old-password-123" });

    const forgot = await new Client().post("/api/auth/forgot", { email });
    expect(forgot.status).toBe(200);

    const outbox = await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(email)}`));
    const mail = outbox.messages.at(-1);
    expect(mail.subject).toMatch(/password|পাসওয়ার্ড/i);
    const token = /\/app\/reset\/([\w-]+)/.exec(mail.text)![1];

    const reset = await new Client().post("/api/auth/reset", { token, password: "brand-new-password-9" });
    expect(reset.status).toBe(200);
    // token is single-use
    expect((await new Client().post("/api/auth/reset", { token, password: "another-password-9" })).status).toBe(400);

    // the old device's session was invalidated by the reset
    expect((await json(await oldDevice.get("/api/auth/me"))).student).toBeNull();
    expect((await new Client().post("/api/auth/login", { email, password: "old-password-123" })).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { email, password: "brand-new-password-9" })).status).toBe(200);
  });

  it("answers identically for unknown e-mail addresses (no account enumeration)", async () => {
    const res = await new Client().post("/api/auth/forgot", { email: uniqueEmail("nobody") });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });
});

describe("CSRF origin guard", () => {
  it("rejects cross-site state-changing requests, allows same-origin", async () => {
    const c = new Client();
    const evil = await c.fetch("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
    expect(evil.status).toBe(403);
    expect((await json(evil)).error.code).toBe("csrf");

    const same = await c.fetch("/api/auth/logout", { method: "POST", headers: { origin: "https://academy.test", "sec-fetch-site": "same-origin" } });
    expect(same.status).toBe(200);
  });
});

describe("staff bootstrap & sessions", () => {
  it("creates the first super admin only with the setup token, exactly once", async () => {
    const status = await json(await new Client().get("/api/admin/auth/setup-status"));
    expect(status.needs_setup).toBe(true);

    const wrong = await new Client().post("/api/admin/auth/setup", { setup_token: "nope", name: "Owner", email: "owner@example.test", password: "owner-password-1" });
    expect(wrong.status).toBe(403);

    const client = new Client();
    const good = await client.post("/api/admin/auth/setup", { setup_token: "test-setup-token", name: "Owner", email: "owner@example.test", password: "owner-password-1" });
    expect(good.status).toBe(201);
    expect((await json(good)).staff.role).toBe("super_admin");
    expect((await json(await client.get("/api/admin/auth/me"))).staff.email).toBe("owner@example.test");

    const again = await new Client().post("/api/admin/auth/setup", { setup_token: "test-setup-token", name: "Eve", email: "eve@example.test", password: "eve-password-123" });
    expect(again.status).toBe(409);
    expect((await json(await new Client().get("/api/admin/auth/setup-status"))).needs_setup).toBe(false);
  });

  it("staff sessions use a Strict cookie and a student cookie grants no staff access", async () => {
    const { client } = await loginStaff("support");
    const login = await new Client().post("/api/admin/auth/login", { email: (await json(await client.get("/api/admin/auth/me"))).staff.email, password: "staff-password-123" });
    expect(login.headers.getSetCookie().join("\n")).toMatch(/SameSite=Strict/i);

    const { client: student } = await registerStudent();
    expect((await json(await student.get("/api/admin/auth/me"))).staff).toBeNull();
  });
});
