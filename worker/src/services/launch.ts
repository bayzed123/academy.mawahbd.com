import type { Env } from "../env";
import { auditAs } from "../lib/audit";
import { all, first, nowIso, qs, run } from "../lib/db";
import { classLaunchMail, sendBatch, type MailMessage } from "../lib/mailer";
import { loc } from "@mawah/shared";

/**
 * "Notify me when it opens" -> the e-mail that goes out when a Coming Soon class is published.
 * Idempotent: only signups with notified_at IS NULL are touched, and a row is only stamped after its mail was accepted,
 * so a half-failed run is simply finished by the next call (the 6-hourly cron retries leftovers).
 * `limit` caps one run so a big list can never exceed the Worker's per-invocation subrequest budget.
 */
export async function notifyLaunch(env: Env, courseId: number, limit = 400): Promise<number> {
  const course = await first<{ slug: string; title_bn: string; title_en: string; status: string; deleted_at: string | null }>(
    env.DB,
    "SELECT slug, title_bn, title_en, status, deleted_at FROM courses WHERE id = ?",
    courseId,
  );
  if (!course || course.deleted_at || course.status !== "published") return 0;

  const waiting = await all<{ id: number; email: string; lang: "bn" | "en" }>(
    env.DB,
    "SELECT id, email, lang FROM notify_signups WHERE course_id = ? AND notified_at IS NULL ORDER BY id LIMIT ?",
    courseId,
    limit,
  );
  if (waiting.length === 0) return 0;

  const messages: MailMessage[] = waiting.map((w) => {
    const lang = w.lang === "en" ? "en" : "bn";
    const url = `${env.SITE_URL}${lang === "en" ? "/en" : ""}/courses/${course.slug}`;
    return { to: w.email, ...classLaunchMail(lang, { title: loc(course, "title", lang), url }) };
  });
  const sent = await sendBatch(env, messages);
  const okIds = waiting.filter((_, i) => sent[i]).map((w) => w.id);
  if (okIds.length) {
    await run(env.DB, `UPDATE notify_signups SET notified_at = ? WHERE id IN (${qs(okIds.length)})`, nowIso(), ...okIds);
    await auditAs(env, { type: "system", id: null, name: "" }, { action: "launch.notified", entity: "course", entityId: courseId, summary: `${okIds.length} e-mails`, meta: { failed: waiting.length - okIds.length } });
  }
  return okIds.length;
}

/** Cron safety net: finish any launch announcements that were interrupted or partly failed. */
export async function retryPendingLaunches(env: Env): Promise<void> {
  const courses = await all<{ course_id: number }>(
    env.DB,
    `SELECT DISTINCT n.course_id FROM notify_signups n JOIN courses c ON c.id = n.course_id
     WHERE n.notified_at IS NULL AND c.status = 'published' AND c.deleted_at IS NULL LIMIT 5`,
  );
  for (const c of courses) await notifyLaunch(env, c.course_id);
}
