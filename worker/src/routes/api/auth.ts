import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Ctx } from "../../env";
import { audit } from "../../lib/audit";
import { randomToken, sha256Hex } from "../../lib/crypto";
import { addSeconds, first, nowIso, run } from "../../lib/db";
import { HttpError, ok, parseBody } from "../../lib/http";
import { toMe } from "../../lib/me";
import { passwordResetMail, sendMail } from "../../lib/mailer";
import { emailSchema, langSchema, nameSchema, passwordSchema, phoneSchema, turnstileField } from "../../lib/schemas";
import { createSession, destroySession } from "../../lib/session";
import { verifyTurnstile } from "../../lib/turnstile";
import { hashPassword } from "../../lib/crypto";
import { loadStudent, requireStudent } from "../../middleware/auth";
import { checkRateLimit, rateLimit } from "../../middleware/ratelimit";
import { authenticate, createPasswordResetLink, setPassword } from "../../services/auth";
import { notices, notifyOwner } from "../../services/notify";

export const authRoutes = new Hono<AppEnv>();

async function guardBots(c: Ctx, token: string | undefined) {
  if (!(await verifyTurnstile(c.env, token, c.get("ip")))) throw new HttpError(400, "captcha");
}

const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  lang: langSchema.optional().default("bn"),
  marketing: z.coerce.boolean().optional().default(false),
  turnstile: turnstileField,
});

authRoutes.post("/register", rateLimit("RL_AUTH"), async (c) => {
  const body = await parseBody(c, registerSchema);
  await guardBots(c, body.turnstile);

  const exists = await first(c.env.DB, "SELECT id FROM students WHERE email = ?", body.email);
  if (exists) throw new HttpError(409, "email_taken", "email_taken", { email: "email_taken" });

  const hash = await hashPassword(body.password, c.env.APP_SECRET);
  const now = nowIso();
  let id: number;
  try {
    const res = await run(
      c.env.DB,
      `INSERT INTO students (email, name, phone, password_hash, locale, marketing_opt_in, last_login_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      body.email,
      body.name,
      body.phone,
      hash,
      body.lang,
      body.marketing ? 1 : 0,
      now,
      now,
      now,
    );
    id = res.meta.last_row_id as number;
  } catch (err) {
    // a concurrent signup with the same e-mail loses the UNIQUE race
    if (String(err).includes("UNIQUE")) throw new HttpError(409, "email_taken", "email_taken", { email: "email_taken" });
    throw err;
  }

  await createSession(c, "student", id);
  c.set("student", { id, name: body.name, email: body.email, phone: body.phone, locale: body.lang });
  await audit(c, { action: "student.register", entity: "student", entityId: id });
  c.executionCtx.waitUntil(notifyOwner(c.env, notices.newStudent({ name: body.name, email: body.email, phone: body.phone })));
  return ok(c, { student: toMe({ id, name: body.name, email: body.email, phone: body.phone, locale: body.lang }) }, 201);
});

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "required").max(128), turnstile: turnstileField });

authRoutes.post("/login", rateLimit("RL_AUTH"), async (c) => {
  const body = await parseBody(c, loginSchema);
  // second limiter keyed by target account so one attacker IP cannot hammer a single e-mail from many requests
  if (!(await checkRateLimit(c.env, "RL_AUTH", `RL_AUTH:acct:${body.email}`))) throw new HttpError(429, "rate_limited");
  await guardBots(c, body.turnstile);

  const result = await authenticate(c.env, "students", body.email, body.password);
  if (!result.ok) {
    await audit(c, { action: "student.login_failed", entity: "student", summary: result.reason, meta: { email: body.email } });
    throw new HttpError(result.reason === "invalid_credentials" ? 401 : result.reason === "account_locked" ? 429 : 403, result.reason);
  }
  const row = result.row as unknown as { id: number; name: string; email: string; phone: string | null; locale: "bn" | "en" };
  await createSession(c, "student", row.id);
  c.set("student", { id: row.id, name: row.name, email: row.email, phone: row.phone, locale: row.locale });
  await audit(c, { action: "student.login", entity: "student", entityId: row.id });
  return ok(c, { student: toMe(row) });
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c, "student");
  return ok(c);
});

authRoutes.get("/me", loadStudent, (c) => {
  const s = c.get("student");
  return ok(c, { student: s ? toMe(s) : null });
});

/* ---------------------------------- forgot / reset password ---------------------------------- */
const forgotSchema = z.object({ email: emailSchema, lang: langSchema.optional().default("bn"), turnstile: turnstileField });

authRoutes.post("/forgot", rateLimit("RL_AUTH"), async (c) => {
  const body = await parseBody(c, forgotSchema);
  if (!(await checkRateLimit(c.env, "RL_AUTH", `RL_AUTH:forgot:${body.email}`))) return ok(c); // silent: no enumeration signal
  await guardBots(c, body.turnstile);

  const student = await first<{ id: number; name: string; locale: "bn" | "en" }>(
    c.env.DB,
    "SELECT id, name, locale FROM students WHERE email = ? AND blocked = 0",
    body.email,
  );
  if (student) {
    const link = await createPasswordResetLink(c.env, student.id);
    const mail = passwordResetMail(student.locale ?? body.lang, link);
    c.executionCtx.waitUntil(sendMail(c.env, { to: body.email, ...mail }));
    await audit(c, { action: "student.password_reset_requested", entity: "student", entityId: student.id });
  }
  // identical response whether or not the account exists
  return ok(c);
});

const resetSchema = z.object({ token: z.string().min(20).max(100), password: passwordSchema });

authRoutes.post("/reset", rateLimit("RL_AUTH"), async (c) => {
  const body = await parseBody(c, resetSchema);
  const row = await first<{ id: number; subject_id: number; expires_at: string; used_at: string | null }>(
    c.env.DB,
    "SELECT id, subject_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND kind = 'password_reset' AND subject_type = 'student'",
    await sha256Hex(body.token),
  );
  if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, "invalid_token");

  // an account made at checkout has no password yet: choosing its first one (the link in the receipt) also signs this phone in
  const before = await first<{ first_password: number; blocked: number }>(
    c.env.DB,
    "SELECT (password_hash IS NULL AND google_sub IS NULL) AS first_password, blocked FROM students WHERE id = ?",
    row.subject_id,
  );
  await run(c.env.DB, "UPDATE auth_tokens SET used_at = ? WHERE id = ?", nowIso(), row.id);
  await setPassword(c.env, "students", row.subject_id, body.password);
  await audit(c, { action: before?.first_password ? "student.password_set" : "student.password_reset", entity: "student", entityId: row.subject_id });
  if (before?.first_password && !before.blocked) {
    const me = await first<{ id: number; name: string; email: string; phone: string | null; locale: "bn" | "en" }>(c.env.DB, "SELECT id, name, email, phone, locale FROM students WHERE id = ?", row.subject_id);
    if (me) {
      await createSession(c, "student", me.id);
      return ok(c, { student: toMe({ ...me, has_password: true }) });
    }
  }
  return ok(c);
});

/* -------------------------------------- account settings -------------------------------------- */
const changePasswordSchema = z.object({ current: z.string().min(1, "required").max(128), next: passwordSchema });

authRoutes.post("/change-password", requireStudent, rateLimit("RL_AUTH"), async (c) => {
  const body = await parseBody(c, changePasswordSchema);
  const me = c.get("student")!;
  const check = await authenticate(c.env, "students", me.email, body.current);
  if (!check.ok) throw new HttpError(400, "invalid_credentials", "invalid_credentials", { current: "invalid_credentials" });
  await setPassword(c.env, "students", me.id, body.next);
  // the current device stays signed in with a fresh session
  await createSession(c, "student", me.id);
  await audit(c, { action: "student.password_changed", entity: "student", entityId: me.id });
  return ok(c);
});

const setPasswordSchema = z.object({ password: passwordSchema });

/**
 * An account made at checkout has no password: its owner, signed in on the phone that bought, chooses one here (the receipt e-mail has a link
 * for other devices). Accounts that already have a password use "change password", which asks for the current one.
 */
authRoutes.post("/set-password", requireStudent, rateLimit("RL_AUTH"), async (c) => {
  const body = await parseBody(c, setPasswordSchema);
  const me = c.get("student")!;
  const row = await first<{ has_password: number }>(c.env.DB, "SELECT (password_hash IS NOT NULL OR google_sub IS NOT NULL) AS has_password FROM students WHERE id = ?", me.id);
  if (!row || row.has_password) throw new HttpError(409, "password_already_set");
  await setPassword(c.env, "students", me.id, body.password);
  // the current device stays signed in with a fresh session
  await createSession(c, "student", me.id);
  await audit(c, { action: "student.password_set", entity: "student", entityId: me.id });
  return ok(c, { student: toMe({ ...me, has_password: true }) });
});

const profileSchema = z.object({ name: nameSchema, phone: phoneSchema, locale: langSchema });

authRoutes.patch("/profile", requireStudent, async (c) => {
  const body = await parseBody(c, profileSchema);
  const me = c.get("student")!;
  await run(c.env.DB, "UPDATE students SET name = ?, phone = ?, locale = ?, updated_at = ? WHERE id = ?", body.name, body.phone, body.locale, nowIso(), me.id);
  await audit(c, { action: "student.profile_updated", entity: "student", entityId: me.id });
  return ok(c, { student: toMe({ ...me, name: body.name, phone: body.phone, locale: body.locale }) });
});
