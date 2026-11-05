import { isNoEmail, NO_EMAIL_DOMAIN, studentCode } from "@mawah/shared";
import type { Env } from "../env";
import { all, first, nowIso } from "../lib/db";
import { courseRatingStatement } from "./catalog";

/** What a deleted account is called from then on (Admin → Orders still shows the order, with the name written on its receipt). */
export const DELETED_NAME = "Deleted account";

/** The made-up address a deleted account keeps (the column is required and unique): never mailed, never shown (isNoEmail). */
export const deletedEmail = (id: number): string => `deleted-${id}@${NO_EMAIL_DOMAIN}`;

export interface DeletionResult {
  /** classes the account could open */
  classes: number;
  certificates: number;
}

/**
 * Deletes a student's account — Google Play's "account deletion", and anyone's right to have their information deleted — in one D1 batch
 * (all of it or nothing):
 *  - removed: name, mobile number, e-mail, address, password, staff notes; lesson progress, questions under lessons, class reviews, material
 *    downloads, private-group requests, password codes and links, the chat assistant's hand-offs, and newsletter and "tell me when it opens"
 *    sign-ups with the same e-mail or number; the name in the activity log
 *  - ended: every sign-in (website and app), access to the classes, the certificates (the check page says the certificate is no longer valid)
 *  - kept, because tax and accounting law needs them: orders and payments (order and invoice number, class, amount, date, how it was paid,
 *    the transaction ID, and the name and number written on the receipt), and the security record of actions (time, action, IP address)
 * The emptied row stays because orders, enrolments and certificates point at it. Returns null when there is no such account, or it was
 * deleted already.
 */
export async function deleteStudentAccount(env: Env, id: number): Promise<DeletionResult | null> {
  const s = await first<{ email: string; phone: string | null; deleted_at: string | null }>(env.DB, "SELECT email, phone, deleted_at FROM students WHERE id = ?", id);
  if (!s || s.deleted_at) return null;
  const db = env.DB;
  const now = nowIso();
  const email = isNoEmail(s.email) ? null : s.email.toLowerCase();
  const phone = s.phone?.trim() || null;
  const reviewed = await all<{ course_id: number }>(db, "SELECT DISTINCT course_id FROM reviews WHERE student_id = ?", id);
  // what someone may have typed to sign in, kept with a failed attempt (the activity log's "who"): their e-mail, number or student ID
  const typed = [email, phone, phone ? `+88${phone}` : null, phone ? `88${phone}` : null, studentCode(id).toLowerCase()].filter((v): v is string => !!v);

  const statements: D1PreparedStatement[] = [
    // sessions_valid_after with milliseconds, like blocking: every session made before this moment stops at once (website and app)
    db
      .prepare(
        `UPDATE students SET name = ?, email = ?, phone = NULL, address = '', notes = '', password_hash = NULL, google_sub = NULL,
           email_verified_at = NULL, marketing_opt_in = 0, blocked = 1, blocked_reason = 'account_deleted', failed_logins = 0,
           locked_until = NULL, last_login_at = NULL, sessions_valid_after = ?, deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(DELETED_NAME, deletedEmail(id), new Date().toISOString(), now, now, id),
    db.prepare("UPDATE enrollments SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?) WHERE student_id = ? AND status = 'active'").bind(now, id),
    db
      .prepare("UPDATE certificates SET student_name = '', revoked_at = COALESCE(revoked_at, ?), revoked_reason = COALESCE(revoked_reason, 'account_deleted') WHERE student_id = ?")
      .bind(now, id),
    db.prepare("DELETE FROM lesson_progress WHERE student_id = ?").bind(id),
    db.prepare("DELETE FROM lesson_questions WHERE student_id = ?").bind(id),
    db.prepare("DELETE FROM reviews WHERE student_id = ?").bind(id),
    // the classes they had reviewed get their rating worked out again without them
    ...reviewed.map((r) => courseRatingStatement(db, r.course_id)),
    db.prepare("DELETE FROM material_downloads WHERE student_id = ?").bind(id),
    db.prepare("DELETE FROM group_requests WHERE student_id = ?").bind(id),
    db.prepare("DELETE FROM reset_codes WHERE student_id = ?").bind(id),
    db.prepare("DELETE FROM auth_tokens WHERE subject_type = 'student' AND subject_id = ?").bind(id),
    db.prepare("DELETE FROM chat_escalations WHERE student_id = ?").bind(id),
    db.prepare("UPDATE activity_log SET actor_name = '' WHERE actor_type = 'student' AND actor_id = ?").bind(id),
    // CASE keeps a clipped (not valid JSON) meta from failing the whole batch
    db
      .prepare(
        `UPDATE activity_log SET meta = json_remove(meta, '$.who')
         WHERE action = 'student.login_failed' AND (CASE WHEN json_valid(meta) THEN lower(json_extract(meta, '$.who')) END) IN (${typed.map(() => "?").join(", ")})`,
      )
      .bind(...typed),
  ];
  if (email) {
    statements.push(db.prepare("DELETE FROM subscribers WHERE email = ?").bind(email));
    statements.push(db.prepare("DELETE FROM notify_signups WHERE email = ?").bind(email));
  }
  if (phone) statements.push(db.prepare("DELETE FROM notify_signups WHERE phone = ?").bind(phone));

  const results = await db.batch(statements);
  // another request deleted it a moment earlier: nothing more was changed by this one that matters (the rest were no-ops on an emptied account)
  if ((results[0].meta.changes ?? 0) === 0) return null;
  return { classes: results[1].meta.changes ?? 0, certificates: results[2].meta.changes ?? 0 };
}
