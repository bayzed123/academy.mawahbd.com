import type { LoginId } from "@mawah/shared";
import type { Env } from "../env";
import { DUMMY_HASH, hmacHex, needsRehash, hashPassword, randomDigits, randomToken, sha256Hex, timingSafeEqual, verifyPassword } from "../lib/crypto";
import { addSeconds, all, first, nowIso, run } from "../lib/db";

export type AccountTable = "students" | "staff";

export const MAX_FAILED_LOGINS = 8;
export const LOCK_SECONDS = 15 * 60;

interface AccountRow {
  id: number;
  email: string;
  name: string;
  password_hash: string | null;
  failed_logins: number;
  locked_until: string | null;
  blocked?: number;
  active?: number;
  [key: string]: unknown;
}

export type AuthResult =
  | { ok: true; row: AccountRow }
  | { ok: false; reason: "invalid_credentials" | "account_locked" | "account_blocked" };

export const peppers = (env: Env): string[] =>
  [env.APP_SECRET, env.APP_SECRET_PREVIOUS].filter((s): s is string => !!s);

/**
 * The e-mail an account is stored under, for what someone typed in the sign-in box: an e-mail, a student ID, or a mobile number.
 * A number counts only for accounts that have a password (a number shared by several is "ambiguous": they sign in with their ID or e-mail).
 * null = no such account (or nothing usable was typed).
 */
export async function studentLoginFor(env: Env, id: LoginId | null): Promise<string | "ambiguous" | null> {
  if (!id) return null;
  if (id.kind === "email") return id.value;
  if (id.kind === "code") return (await first<{ email: string }>(env.DB, "SELECT email FROM students WHERE id = ?", id.id))?.email ?? null;
  const rows = await all<{ email: string }>(env.DB, "SELECT email FROM students WHERE phone = ? AND password_hash IS NOT NULL AND blocked = 0 LIMIT 3", id.value);
  return rows.length === 0 ? null : rows.length === 1 ? rows[0].email : "ambiguous";
}

/**
 * Verify e-mail + password with brute-force protection:
 *  - unknown accounts still pay for a hash comparison (no timing oracle for "does this e-mail exist")
 *  - 8 wrong passwords lock the account for 15 minutes
 *  - blocked/inactive accounts are only revealed to someone who knows the password
 */
export async function authenticate(env: Env, table: AccountTable, email: string, password: string): Promise<AuthResult> {
  const row = await first<AccountRow>(env.DB, `SELECT * FROM ${table} WHERE email = ?`, email);
  const keys = peppers(env);

  if (!row || !row.password_hash) {
    await verifyPassword(password, DUMMY_HASH, keys);
    return { ok: false, reason: "invalid_credentials" };
  }
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) {
    return { ok: false, reason: "account_locked" };
  }

  const good = await verifyPassword(password, row.password_hash, keys);
  if (!good) {
    const failed = row.failed_logins + 1;
    if (failed >= MAX_FAILED_LOGINS) {
      await run(env.DB, `UPDATE ${table} SET failed_logins = 0, locked_until = ? WHERE id = ?`, addSeconds(nowIso(), LOCK_SECONDS), row.id);
    } else {
      await run(env.DB, `UPDATE ${table} SET failed_logins = ? WHERE id = ?`, failed, row.id);
    }
    return { ok: false, reason: "invalid_credentials" };
  }

  const disabled = table === "students" ? !!row.blocked : !row.active;
  if (disabled) return { ok: false, reason: "account_blocked" };

  await run(env.DB, `UPDATE ${table} SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`, nowIso(), row.id);
  if (needsRehash(row.password_hash) || keys.length > 1) {
    // transparently upgrade old parameters / move to the current pepper
    await run(env.DB, `UPDATE ${table} SET password_hash = ? WHERE id = ?`, await hashPassword(password, keys[0]), row.id);
  }
  return { ok: true, row };
}

/** Set a new password and sign the user out everywhere (all older sessions become invalid). */
export async function setPassword(env: Env, table: AccountTable, id: number, newPassword: string): Promise<void> {
  const hash = await hashPassword(newPassword, env.APP_SECRET);
  // millisecond precision on purpose: sessions carry ms timestamps, whole seconds would leave a gap
  const exact = new Date().toISOString();
  const extra = table === "staff" ? ", must_change_password = 0" : "";
  await run(
    env.DB,
    `UPDATE ${table} SET password_hash = ?, sessions_valid_after = ?, failed_logins = 0, locked_until = NULL, updated_at = ?${extra} WHERE id = ?`,
    hash,
    exact,
    nowIso(),
    id,
  );
}

/**
 * "Forgot password" by code: 6 digits that live 15 minutes and may be tried 5 times. A student is sent at most 3 codes an hour and 10 a day,
 * so guessing stays hopeless (at most 15 tries an hour, 50 a day, against a million possible codes). Only a keyed hash of a code is stored.
 */
export const RESET_CODE_SECONDS = 15 * 60;
export const RESET_CODE_TRIES = 5;
const RESET_CODES_PER_HOUR = 3;
const RESET_CODES_PER_DAY = 10;
const resetCodeHash = (env: Env, studentId: number, code: string) => hmacHex(env.APP_SECRET, `reset-code:${studentId}:${code}`);

/** A new code for the student (their earlier unused ones stop working) — or null when they have been sent enough codes for now. */
export async function createResetCode(env: Env, studentId: number): Promise<string | null> {
  const now = nowIso();
  const sent = await first<{ hour: number | null; day: number }>(
    env.DB,
    "SELECT SUM(created_at > ?) AS hour, COUNT(*) AS day FROM reset_codes WHERE student_id = ? AND created_at > ?",
    addSeconds(now, -3600),
    studentId,
    addSeconds(now, -86400),
  );
  if ((sent?.hour ?? 0) >= RESET_CODES_PER_HOUR || (sent?.day ?? 0) >= RESET_CODES_PER_DAY) return null;
  const code = randomDigits(6);
  await run(env.DB, "UPDATE reset_codes SET used_at = ? WHERE student_id = ? AND used_at IS NULL", now, studentId);
  await run(env.DB, "INSERT INTO reset_codes (student_id, code_hash, expires_at) VALUES (?, ?, ?)", studentId, await resetCodeHash(env, studentId, code), addSeconds(now, RESET_CODE_SECONDS));
  return code;
}

/**
 * Try a code for a student: true uses it up. Each try is counted before the code is compared, in one step, so even many tries sent at
 * the same moment get no more than 5 comparisons; the 5th wrong one ends the code.
 */
export async function useResetCode(env: Env, studentId: number, code: string): Promise<boolean> {
  const now = nowIso();
  const row = await first<{ id: number; code_hash: string; attempts: number }>(
    env.DB,
    "UPDATE reset_codes SET attempts = attempts + 1 WHERE id = (SELECT id FROM reset_codes WHERE student_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1) AND attempts < ? RETURNING id, code_hash, attempts",
    studentId,
    now,
    RESET_CODE_TRIES,
  );
  if (!row) return false;
  if (!timingSafeEqual(await resetCodeHash(env, studentId, code), row.code_hash)) {
    if (row.attempts >= RESET_CODE_TRIES) await run(env.DB, "UPDATE reset_codes SET used_at = ? WHERE id = ?", now, row.id);
    return false;
  }
  const done = await run(env.DB, "UPDATE reset_codes SET used_at = ? WHERE id = ? AND used_at IS NULL", now, row.id);
  return (done.meta.changes ?? 0) === 1;
}

/** Single-use password-reset link for a student, one hour by default (previous links are voided). Only the token's SHA-256 is stored. */
export async function createPasswordResetLink(env: Env, studentId: number, ttlSeconds = 3600): Promise<string> {
  const token = randomToken(32);
  await run(env.DB, "DELETE FROM auth_tokens WHERE subject_type = 'student' AND subject_id = ? AND kind = 'password_reset'", studentId);
  await run(
    env.DB,
    "INSERT INTO auth_tokens (kind, subject_type, subject_id, token_hash, expires_at) VALUES ('password_reset', 'student', ?, ?, ?)",
    studentId,
    await sha256Hex(token),
    addSeconds(nowIso(), ttlSeconds),
  );
  return `${env.SITE_URL}/app/reset/${token}`;
}
