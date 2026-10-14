import { PROOF_RETENTION_DAYS } from "@mawah/shared";
import type { Env } from "./env";
import { auditAs } from "./lib/audit";
import { all, nowIso, run } from "./lib/db";
import { retryPendingLaunches } from "./services/launch";

/**
 * Housekeeping on the 6-hourly cron trigger. Every step is independent and idempotent, so a failed run is simply repeated.
 *  - checkout attempts that were never paid are closed after 48 h (an unpaid manual order too; one waiting for staff is never auto-closed)
 *  - payment screenshots (they show wallet balances and phone numbers) are deleted 90 days after their order was settled
 *  - expired login / reset tokens and old rate-limit counters are removed
 *  - launch announcements that were interrupted are finished
 */
export async function runScheduled(env: Env, _cron: string): Promise<void> {
  const now = new Date();
  const cutoff = nowIso(new Date(now.getTime() - 48 * 3600 * 1000));
  const steps: [string, () => Promise<unknown>][] = [
    ["stale_orders", () => run(env.DB, "UPDATE orders SET status = 'cancelled', note = 'expired', updated_at = ? WHERE status = 'pending' AND created_at < ?", nowIso(now), cutoff)],
    ["old_proofs", () => purgeOldProofs(env, new Date(now.getTime() - PROOF_RETENTION_DAYS * 86400 * 1000))],
    ["old_tokens", () => run(env.DB, "DELETE FROM auth_tokens WHERE expires_at < ? OR used_at IS NOT NULL", nowIso(new Date(now.getTime() - 7 * 86400 * 1000)))],
    ["old_events", () => run(env.DB, "DELETE FROM payment_events WHERE created_at < ? AND verified = 0", nowIso(new Date(now.getTime() - 90 * 86400 * 1000)))],
    ["launch_retry", () => retryPendingLaunches(env)],
  ];
  const failed: string[] = [];
  for (const [name, fn] of steps) {
    try {
      await fn();
    } catch (err) {
      failed.push(name);
      console.error("cron_step_failed", name, err);
    }
  }
  await auditAs(env, { type: "system", id: null, name: "cron" }, { action: "cron.ran", summary: failed.length ? `failed: ${failed.join(",")}` : "ok" });
}

/** Deletes the payment screenshots of orders that were settled (paid, refused, cancelled, refunded) before `before`. */
export async function purgeOldProofs(env: Env, before: Date): Promise<number> {
  const rows = await all<{ id: number; proof_key: string }>(
    env.DB,
    "SELECT id, proof_key FROM orders WHERE proof_key IS NOT NULL AND status IN ('paid','failed','cancelled','refunded') AND updated_at < ? LIMIT 200",
    nowIso(before),
  );
  for (const r of rows) {
    await env.R2.delete(r.proof_key);
    await run(env.DB, "UPDATE orders SET proof_key = NULL WHERE id = ?", r.id);
  }
  return rows.length;
}
