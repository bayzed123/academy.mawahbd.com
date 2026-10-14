import type { Env } from "../env";
import { DUMMY_HASH, needsRehash, hashPassword, randomToken, sha256Hex, verifyPassword } from "../lib/crypto";
import { addSeconds, first, nowIso, run } from "../lib/db";

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

/** One-hour, single-use password-reset link for a student (previous links are voided). Only the token's SHA-256 is stored. */
export async function createPasswordResetLink(env: Env, studentId: number): Promise<string> {
  const token = randomToken(32);
  await run(env.DB, "DELETE FROM auth_tokens WHERE subject_type = 'student' AND subject_id = ? AND kind = 'password_reset'", studentId);
  await run(
    env.DB,
    "INSERT INTO auth_tokens (kind, subject_type, subject_id, token_hash, expires_at) VALUES ('password_reset', 'student', ?, ?, ?)",
    studentId,
    await sha256Hex(token),
    addSeconds(nowIso(), 3600),
  );
  return `${env.SITE_URL}/app/reset/${token}`;
}
