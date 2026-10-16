import { Hono } from "hono";
import { z } from "zod";
import { isNoEmail, parseLoginId } from "@mawah/shared";
import type { AppEnv, Ctx } from "../../env";
import { audit } from "../../lib/audit";
import { randomToken, sha256Hex } from "../../lib/crypto";
import { addSeconds, all, first, nowIso, run } from "../../lib/db";
import { HttpError, ok, parseBody } from "../../lib/http";
import { toMe } from "../../lib/me";
import { passwordResetMail } from "../../lib/mailer";
import { allowVisitorSms } from "../../lib/sms";
import { resetSms } from "../../lib/smsText";
import { addressSchema, emailSchema, langSchema, nameSchema, optionalEmailSchema, passwordSchema, phoneSchema, turnstileField } from "../../lib/schemas";
import { createSession, destroySession } from "../../lib/session";
import { verifyTurnstile } from "../../lib/turnstile";
import { hashPassword } from "../../lib/crypto";
import { loadStudent, requireStudent } from "../../middleware/auth";
import { checkRateLimit, rateLimit } from "../../middleware/ratelimit";
import { authenticate, createPasswordResetLink, setPassword, studentLoginFor } from "../../services/auth";
import { notices, notifyOwner } from "../../services/notify";
import { tellStudent } from "../../services/studentMessages";

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

/**
 * What someone types to sign in: their e-mail, their mobile number, or their student ID (STU-000123). `email` is the older name of the same
 * field, still accepted.
 */
const whoSchema = z.string().trim().min(1, "required").max(254, "too_long");
const loginSchema = z
  .object({ identifier: whoSchema.optional(), email: whoSchema.optional(), password: z.string().min(1, "required").max(128), turnstile: turnstileField })
  .refine((d) => !!(d.identifier ?? d.email), { message: "required", path: ["identifier"] });

authRoutes.post("/login", rateLimit("RL_AUTH"), async (c) => {
  const body = await parseBody(c, loginSchema);
  const typed = (body.identifier ?? body.email)!;
  // second limiter keyed by target account so one attacker IP cannot hammer a single account from many requests
  if (!(await checkRateLimit(c.env, "RL_AUTH", `RL_AUTH:acct:${typed.toLowerCase().replace(/\s+/g, "")}`))) throw new HttpError(429, "rate_limited");
  await guardBots(c, body.turnstile);

  const who = await studentLoginFor(c.env, parseLoginId(typed));
  if (who === "ambiguous") throw new HttpError(409, "ambiguous_login");
  // something that is no account at all still pays for a password check, so the answer cannot be told apart by its speed
  const result = await authenticate(c.env, "students", who ?? `nobody@${"no-email.invalid"}`, body.password);
  if (!result.ok) {
    await audit(c, { action: "student.login_failed", entity: "student", summary: result.reason, meta: { who: typed.slice(0, 60) } });
    throw new HttpError(result.reason === "invalid_credentials" ? 401 : result.reason === "account_locked" ? 429 : 403, result.reason);
  }
  const row = result.row as unknown as { id: number; name: string; email: string; phone: string | null; address: string; locale: "bn" | "en" };
  await createSession(c, "student", row.id);
  c.set("student", { id: row.id, name: row.name, email: row.email, phone: row.phone, address: row.address, locale: row.locale });
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
const forgotSchema = z
  .object({ identifier: whoSchema.optional(), email: whoSchema.optional(), lang: langSchema.optional().default("bn"), turnstile: turnstileField })
  .refine((d) => !!(d.identifier ?? d.email), { message: "required", path: ["identifier"] });

interface Reachable {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  locale: "bn" | "en";
}

/** Who a "forgot my password" request is about: the account behind an e-mail, a student ID, or a mobile number — null when it is none, or cannot be told which. */
async function forgotTarget(c: Ctx, typed: string): Promise<Reachable | null> {
  const id = parseLoginId(typed);
  if (!id) return null;
  const columns = "SELECT id, name, email, phone, locale FROM students WHERE blocked = 0 AND";
  if (id.kind === "email") return first<Reachable>(c.env.DB, `${columns} email = ?`, id.value);
  if (id.kind === "code") return first<Reachable>(c.env.DB, `${columns} id = ?`, id.id);
  // a mobile number: the one account on it — or, when a few share it, the one that has no e-mail (the number is all it has)
  const rows = await all<Reachable>(c.env.DB, `${columns} phone = ? LIMIT 5`, id.value);
  if (rows.length === 1) return rows[0];
  const numberOnly = rows.filter((r) => isNoEmail(r.email));
  return numberOnly.length === 1 ? numberOnly[0] : null;
}

authRoutes.post("/forgot", rateLimit("RL_AUTH"), async (c) => {
  const body = await parseBody(c, forgotSchema);
  const typed = (body.identifier ?? body.email)!;
  if (!(await checkRateLimit(c.env, "RL_AUTH", `RL_AUTH:forgot:${typed.toLowerCase().replace(/\s+/g, "")}`))) return ok(c); // silent: no enumeration signal
  await guardBots(c, body.turnstile);

  const student = await forgotTarget(c, typed);
  if (student) {
    const lang = student.locale ?? body.lang;
    const hasEmail = !isNoEmail(student.email);
    // an e-mail typed (or an ID, for someone who has one): e-mail. A mobile number, or an account with no e-mail: a text message to the number
    // — and a text can cost the shop money, so only a few per number per hour and per day for the whole site.
    const bySms = !hasEmail || parseLoginId(typed)?.kind === "phone";
    if (!bySms || (student.phone && (await allowVisitorSms(c.env, student.phone)))) {
      const link = await createPasswordResetLink(c.env, student.id);
      c.executionCtx.waitUntil(
        tellStudent(c.env, bySms ? { email: null, phone: student.phone } : { email: student.email, phone: null }, bySms ? { sms: resetSms(lang, { link }) } : { mail: passwordResetMail(lang, link) }, { smsAlso: true }).then(() => undefined),
      );
      await audit(c, { action: "student.password_reset_requested", entity: "student", entityId: student.id, meta: { by: bySms ? "sms" : "email" } });
    }
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
    const me = await first<{ id: number; name: string; email: string; phone: string | null; address: string; locale: "bn" | "en" }>(c.env.DB, "SELECT id, name, email, phone, address, locale FROM students WHERE id = ?", row.subject_id);
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

// `address` and `email` may be left out: the address stays as it is, and an e-mail can only be ADDED (by someone who gave none), never swapped here
const profileSchema = z.object({ name: nameSchema, phone: phoneSchema, address: addressSchema.optional(), email: optionalEmailSchema, locale: langSchema });

authRoutes.patch("/profile", requireStudent, async (c) => {
  const body = await parseBody(c, profileSchema);
  const me = c.get("student")!;
  const address = body.address ?? me.address ?? "";
  let email = me.email;
  if (body.email && isNoEmail(me.email) && body.email !== me.email) {
    try {
      await run(c.env.DB, "UPDATE students SET email = ? WHERE id = ?", body.email, me.id);
      email = body.email;
    } catch (err) {
      if (String(err).includes("UNIQUE")) throw new HttpError(409, "email_taken", "email_taken", { email: "email_taken" });
      throw err;
    }
  }
  // an account with no e-mail is its mobile number: it cannot be taken away
  if (isNoEmail(email) && !body.phone) throw new HttpError(422, "validation", "validation", { phone: "required" });
  await run(c.env.DB, "UPDATE students SET name = ?, phone = ?, address = ?, locale = ?, updated_at = ? WHERE id = ?", body.name, body.phone, address, body.locale, nowIso(), me.id);
  await audit(c, { action: "student.profile_updated", entity: "student", entityId: me.id });
  return ok(c, { student: toMe({ ...me, email, name: body.name, phone: body.phone, address, locale: body.locale }) });
});
