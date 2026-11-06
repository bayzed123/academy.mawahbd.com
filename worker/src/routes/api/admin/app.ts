import { Hono } from "hono";
import { NO_EMAIL_DOMAIN, studentCode } from "@mawah/shared";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { hashPassword, randomString } from "../../../lib/crypto";
import { all, first, nowIso, run } from "../../../lib/db";
import { ok } from "../../../lib/http";
import { getSettings } from "../../../lib/settings";
import { requirePerm } from "../../../middleware/auth";
import { rateLimit } from "../../../middleware/ratelimit";

/*
 * Admin → Android app: the app's free classes, how much the app is used, its notice (Admin → Settings key `app`, saved with the usual
 * PUT /settings/app), and the test account Google Play's reviewers sign in with (Play Console → App content → App access).
 */
export const appAdmin = new Hono<AppEnv>();

/** The made-up address the Google Play test account is kept under: never mailed, never shown (isNoEmail). The reviewer signs in with its student ID. */
export const REVIEW_EMAIL = `google-play-review@${NO_EMAIL_DOMAIN}`;
export const REVIEW_NAME = "Google Play reviewer";
/** how far back the app's numbers go */
const DAYS = 30;
/** letters and digits that cannot be mistaken for one another when copied into Play Console */
const READABLE = "abcdefghjkmnpqrstuvwxyz23456789";

/** A new password for the test account: three groups of four (about 60 bits), easy to copy without a mistake. */
export const reviewPassword = (): string => [0, 1, 2].map(() => randomString(4, READABLE)).join("-");

/** SQL: an activity entry made by the Android app (sign-in and sign-up write `via: "app"`); CASE keeps a clipped, not valid JSON, meta harmless. */
const BY_APP = "(CASE WHEN json_valid(meta) THEN json_extract(meta, '$.via') END) = 'app'";

appAdmin.get("/app", requirePerm("courses:read"), async (c) => {
  const since = nowIso(new Date(Date.now() - DAYS * 86_400_000));
  const [classes, review, numbers, s] = await Promise.all([
    all<{ id: number; slug: string; title_bn: string; title_en: string; status: string; lesson_count: number; banner_key: string | null; icon: string | null; students: number }>(
      c.env.DB,
      `SELECT c.id, c.slug, c.title_bn, c.title_en, c.status, c.lesson_count, c.banner_key, c.icon,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS students
       FROM courses c WHERE c.channel = 'app' AND c.deleted_at IS NULL ORDER BY c.sort, c.id`,
    ),
    first<{ id: number; blocked: number; last_login_at: string | null; updated_at: string; classes: number }>(
      c.env.DB,
      `SELECT s.id, s.blocked, s.last_login_at, s.updated_at, (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = s.id AND e.status = 'active') AS classes
       FROM students s WHERE s.email = ?`,
      REVIEW_EMAIL,
    ),
    first<{ sign_ins: number; sign_ups: number; joins: number; learners: number }>(
      c.env.DB,
      `SELECT (SELECT COUNT(*) FROM activity_log WHERE action = 'student.login' AND created_at >= ?1 AND ${BY_APP}) AS sign_ins,
              (SELECT COUNT(*) FROM activity_log WHERE action = 'student.register' AND created_at >= ?1 AND ${BY_APP}) AS sign_ups,
              (SELECT COUNT(*) FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.channel = 'app' AND e.source = 'free' AND e.enrolled_at >= ?1) AS joins,
              (SELECT COUNT(DISTINCT e.student_id) FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.channel = 'app' AND e.status = 'active') AS learners`,
      since,
    ),
    getSettings(c.env, { fresh: true }),
  ]);
  return ok(c, {
    classes,
    numbers: { days: DAYS, sign_ins: numbers?.sign_ins ?? 0, sign_ups: numbers?.sign_ups ?? 0, joins: numbers?.joins ?? 0, learners: numbers?.learners ?? 0 },
    notice: s.app,
    // the password is never stored readable, so it is never shown here: only right after it is made (POST below)
    review_account: review
      ? { id: review.id, code: studentCode(review.id), blocked: !!review.blocked, last_login_at: review.last_login_at, password_set_at: review.updated_at, classes: review.classes }
      : null,
  });
});

/**
 * Make the Google Play test account, or give it a new password. The password is in this answer only — it is stored as a hash like every
 * other — so staff copy it into Play Console at once. A new password ends every earlier sign-in of the account (website and app), and
 * unlocks and unblocks it, so the reviewer can always get in.
 */
appAdmin.post("/app/review-account", requirePerm("settings:write"), rateLimit("RL_FORM"), async (c) => {
  const password = reviewPassword();
  const hash = await hashPassword(password, c.env.APP_SECRET);
  const now = nowIso();
  const existing = await first<{ id: number }>(c.env.DB, "SELECT id FROM students WHERE email = ?", REVIEW_EMAIL);
  let id: number;
  if (existing) {
    id = existing.id;
    await run(
      c.env.DB,
      `UPDATE students SET password_hash = ?, failed_logins = 0, locked_until = NULL, blocked = 0, blocked_reason = NULL, sessions_valid_after = ?, updated_at = ?
       WHERE id = ?`,
      hash,
      new Date().toISOString(),
      now,
      id,
    );
  } else {
    const res = await run(
      c.env.DB,
      `INSERT INTO students (email, name, phone, password_hash, locale, source, marketing_opt_in, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'en', 'admin', 0, ?, ?)`,
      REVIEW_EMAIL,
      REVIEW_NAME,
      hash,
      now,
      now,
    );
    id = res.meta.last_row_id as number;
  }
  // the activity log names the account, never the password
  await audit(c, { action: existing ? "app.review_account_reset" : "app.review_account_created", entity: "student", entityId: id, summary: studentCode(id) });
  return ok(c, { code: studentCode(id), password, created: !existing });
});
