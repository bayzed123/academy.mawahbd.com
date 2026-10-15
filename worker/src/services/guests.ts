import type { Env, StudentCtx } from "../env";
import { HttpError } from "../lib/http";
import { all, first, nowIso, qs, run } from "../lib/db";

/*
 * Buying without an account. The buyer gives a name, a mobile number and an e-mail; the shop makes the student account for them
 * (no password yet, signed in on that phone) and the account becomes a real student the moment the payment arrives. Someone who only
 * started to buy is kept apart: hidden from the student lists and counts, and removed after GUEST_KEEP_DAYS.
 *
 * The one rule that keeps this safe: a buyer is only ever signed in to an account that has nothing in it. An e-mail that already belongs
 * to a student (a password, a class, a payment, an account staff added) is never opened by typing it — that person signs in, or is
 * e-mailed a link.
 */

/** How long a visitor who started to buy but never paid keeps a (hidden) account. */
export const GUEST_KEEP_DAYS = 30;

/** New accounts one visitor address may start per day, and the whole site per day: a guard against someone filling the database. */
const NEW_PER_ADDRESS_PER_DAY = 30;
const NEW_PER_DAY = 3000;

/** SQL (table alias `s`): a real student — signed up, added or imported by staff, or enrolled in a class. A visitor who only started to buy is not one yet. */
export const REAL_STUDENT = "(s.source <> 'checkout' OR EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id))";

export interface GuestDetails {
  name: string;
  email: string;
  phone: string;
  lang: "bn" | "en";
}

export type GuestAccount =
  /** a new account was made for this buyer */
  | { kind: "new"; student: StudentCtx }
  /** the e-mail belonged to an earlier visitor who never paid and has nothing in the account: the same account, with the details just typed */
  | { kind: "again"; student: StudentCtx }
  /** a real student owns this e-mail: nothing is opened, the buyer must sign in or be sent a link */
  | { kind: "exists"; hasPassword: boolean };

interface Existing {
  id: number;
  source: string;
  blocked: number;
  has_password: number;
  enrolled: number;
  settled: number;
}

const find = (env: Env, email: string) =>
  first<Existing>(
    env.DB,
    `SELECT s.id, s.source, s.blocked, (s.password_hash IS NOT NULL OR s.google_sub IS NOT NULL) AS has_password,
            (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = s.id) AS enrolled,
            (SELECT COUNT(*) FROM orders o WHERE o.student_id = s.id AND o.status IN ('paid','awaiting_verification','refunded')) AS settled
     FROM students s WHERE s.email = ?`,
    email,
  );

/** An account nobody has used: made at checkout, no password, no class, no payment sent or settled. Only such an account may be opened by typing its e-mail. */
const nothingInIt = (r: Existing) => r.source === "checkout" && !r.has_password && !r.blocked && r.enrolled === 0 && r.settled === 0;

const ctx = (id: number, d: GuestDetails): StudentCtx => ({ id, name: d.name, email: d.email, phone: d.phone, locale: d.lang, has_password: false });

const today = () => new Date().toISOString().slice(0, 10);

async function underDailyCap(env: Env, ip: string): Promise<boolean> {
  const [mine, site] = await Promise.all([env.KV.get(`guest:ip:${ip}:${today()}`), env.KV.get(`guest:all:${today()}`)]);
  return Number(mine ?? 0) < NEW_PER_ADDRESS_PER_DAY && Number(site ?? 0) < NEW_PER_DAY;
}

async function countNewAccount(env: Env, ip: string): Promise<void> {
  for (const key of [`guest:ip:${ip}:${today()}`, `guest:all:${today()}`]) {
    const n = Number((await env.KV.get(key)) ?? 0);
    await env.KV.put(key, String(n + 1), { expirationTtl: 2 * 86_400 });
  }
}

/**
 * The account for a buyer who is not signed in. Never throws for "exists": the caller decides what to tell the buyer.
 * `ip` is the visitor's address, for the daily cap on new accounts.
 */
export async function resolveGuestAccount(env: Env, d: GuestDetails, ip: string): Promise<GuestAccount> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await find(env, d.email);
    if (row) {
      if (!nothingInIt(row)) return { kind: "exists", hasPassword: !!row.has_password };
      const now = nowIso();
      // the same visitor coming back (maybe on another phone): take the details they typed now, and let go of the unpaid send-money attempts
      // they left behind, so the number they said they would pay from is not shown to whoever types this e-mail next. (An attempt that is
      // waiting at a payment gateway is left alone: the payment may still arrive, and the housekeeping job closes it after two days.)
      await env.DB.batch([
        env.DB.prepare("UPDATE students SET name = ?, phone = ?, locale = ?, last_login_at = ?, updated_at = ? WHERE id = ?").bind(d.name, d.phone, d.lang, now, now, row.id),
        env.DB.prepare("UPDATE orders SET status = 'cancelled', note = 'superseded', payer_number = NULL, updated_at = ? WHERE student_id = ? AND status = 'pending' AND gateway = 'manual'").bind(now, row.id),
      ]);
      return { kind: "again", student: ctx(row.id, d) };
    }
    if (!(await underDailyCap(env, ip))) throw new HttpError(429, "rate_limited");
    const now = nowIso();
    try {
      const res = await run(
        env.DB,
        `INSERT INTO students (email, name, phone, password_hash, locale, source, marketing_opt_in, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, 'checkout', 0, ?, ?, ?)`,
        d.email,
        d.name,
        d.phone,
        d.lang,
        now,
        now,
        now,
      );
      await countNewAccount(env, ip);
      return { kind: "new", student: ctx(res.meta.last_row_id as number, d) };
    } catch (err) {
      // a double click (or a second tab) made the account a moment earlier: look again
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  throw new HttpError(409, "account_exists", "account_exists", { email: "account_exists" });
}

/**
 * Housekeeping: a visitor who started to buy and never paid, never came back, and has no class or settled payment loses the hidden
 * account and the unpaid attempts after GUEST_KEEP_DAYS. (Anything paid, waiting for staff, refunded or enrolled is never touched.)
 */
export async function purgeAbandonedGuests(env: Env, now: Date = new Date()): Promise<number> {
  const cutoff = nowIso(new Date(now.getTime() - GUEST_KEEP_DAYS * 86_400_000));
  const ids = (
    await all<{ id: number }>(
      env.DB,
      `SELECT s.id FROM students s
       WHERE s.source = 'checkout' AND s.password_hash IS NULL AND s.google_sub IS NULL AND COALESCE(s.last_login_at, s.created_at) < ?1
         AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.student_id = s.id AND (o.status NOT IN ('pending','cancelled','failed') OR o.created_at >= ?1))
       LIMIT 100`,
      cutoff,
    )
  ).map((r) => r.id);
  if (ids.length === 0) return 0;

  // a payment screenshot sent for an attempt that never became a payment goes with it
  const proofs = await all<{ proof_key: string }>(env.DB, `SELECT proof_key FROM orders WHERE proof_key IS NOT NULL AND student_id IN (${qs(ids.length)})`, ...ids);
  for (const p of proofs) await env.R2.delete(p.proof_key);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM payment_events WHERE order_id IN (SELECT id FROM orders WHERE student_id IN (${qs(ids.length)}))`).bind(...ids),
    env.DB.prepare(`DELETE FROM orders WHERE student_id IN (${qs(ids.length)})`).bind(...ids), // order_items go with their order
    env.DB.prepare(`DELETE FROM auth_tokens WHERE subject_type = 'student' AND subject_id IN (${qs(ids.length)})`).bind(...ids),
    env.DB.prepare(`DELETE FROM students WHERE id IN (${qs(ids.length)})`).bind(...ids),
  ]);
  return ids.length;
}
