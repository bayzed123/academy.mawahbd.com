import type { Env } from "./env";
import { auditAs } from "./lib/audit";
import { nowIso, run } from "./lib/db";
import { retryPendingLaunches } from "./services/launch";

/**
 * Housekeeping on the 6-hourly cron trigger. Every step is independent and idempotent, so a failed run is simply repeated.
 *  - checkout attempts that were never paid are closed after 48 h (manual-verification orders are never auto-closed)
 *  - expired login / reset tokens and old rate-limit counters are removed
 *  - launch announcements that were interrupted are finished
 */
export async function runScheduled(env: Env, _cron: string): Promise<void> {
  const now = new Date();
  const cutoff = nowIso(new Date(now.getTime() - 48 * 3600 * 1000));
  const steps: [string, () => Promise<unknown>][] = [
    ["stale_orders", () => run(env.DB, "UPDATE orders SET status = 'cancelled', note = 'expired', updated_at = ? WHERE status = 'pending' AND created_at < ?", nowIso(now), cutoff)],
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
