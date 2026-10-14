import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { csvResponse, toCsv } from "../../../lib/csv";
import { all, first, likeEscape, nowIso, pageInfo, pageParams, run } from "../../../lib/db";
import { HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { passwordResetMail, sendMail } from "../../../lib/mailer";
import { langSchema, nameSchema, phoneSchema, textSchema } from "../../../lib/schemas";
import { requirePerm } from "../../../middleware/auth";
import { createPasswordResetLink } from "../../../services/auth";

export const students = new Hono<AppEnv>();

const LIST_COLS = `s.id, s.name, s.email, s.phone, s.locale, s.blocked, s.created_at, s.last_login_at,
  (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = s.id AND e.status = 'active') AS enrollments,
  (SELECT COUNT(*) FROM orders o WHERE o.student_id = s.id AND o.status = 'paid') AS orders,
  (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.student_id = s.id AND o.status = 'paid') AS spent`;

function filters(q: Record<string, string>) {
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (q.blocked === "1") where.push("s.blocked = 1");
  if (q.course_id && /^\d+$/.test(q.course_id)) {
    where.push("EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.course_id = ? AND e.status = 'active')");
    params.push(Number(q.course_id));
  }
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    where.push("(s.name LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const sorts: Record<string, string> = { created_at: "s.created_at", name: "s.name", last_login_at: "s.last_login_at", spent: "spent" };
  const key = (q.sort ?? "-created_at").replace(/^-/, "");
  const order = `${sorts[key] ?? "s.created_at"} ${(q.sort ?? "-created_at").startsWith("-") ? "DESC" : "ASC"}, s.id DESC`;
  return { where: where.join(" AND "), params, order };
}

students.get("/students", requirePerm("students:read"), async (c) => {
  const f = filters(c.req.query());
  const { page, per_page, offset } = pageParams(c.req.query());
  const [rows, total] = await Promise.all([
    all(c.env.DB, `SELECT ${LIST_COLS} FROM students s WHERE ${f.where} ORDER BY ${f.order} LIMIT ? OFFSET ?`, ...f.params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM students s WHERE ${f.where}`, ...f.params),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0) });
});

students.get("/students/export.csv", requirePerm("students:read"), async (c) => {
  const f = filters(c.req.query());
  const rows = await all<Record<string, unknown>>(c.env.DB, `SELECT ${LIST_COLS} FROM students s WHERE ${f.where} ORDER BY ${f.order} LIMIT 5000`, ...f.params);
  return csvResponse(
    "students",
    toCsv(rows, [
      { key: "id", label: "ID" },
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "locale", label: "Language" },
      { key: "enrollments", label: "Active classes" },
      { key: "orders", label: "Paid orders" },
      { key: "spent", label: "Spent (BDT)" },
      { key: "blocked", label: "Blocked" },
      { key: "created_at", label: "Joined (UTC)" },
      { key: "last_login_at", label: "Last login (UTC)" },
    ]),
  );
});

students.get("/students/:id", requirePerm("students:read"), async (c) => {
  const id = intParam(c, "id");
  const student = await first(
    c.env.DB,
    "SELECT id, name, email, phone, locale, blocked, blocked_reason, email_verified_at, marketing_opt_in, created_at, last_login_at FROM students WHERE id = ?",
    id,
  );
  if (!student) throw notFound();
  const [enrollments, orders, reviews, questions] = await Promise.all([
    all(
      c.env.DB,
      `SELECT e.id, e.course_id, e.status, e.source, e.enrolled_at, e.revoked_at, c.slug, c.title_en, c.title_bn,
              (SELECT COUNT(*) FROM lessons l WHERE l.course_id = e.course_id) AS total,
              (SELECT COUNT(*) FROM lesson_progress lp WHERE lp.student_id = e.student_id AND lp.course_id = e.course_id) AS done,
              (SELECT ce.code FROM certificates ce WHERE ce.student_id = e.student_id AND ce.course_id = e.course_id AND ce.revoked_at IS NULL) AS certificate_code
       FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.student_id = ? ORDER BY e.enrolled_at DESC`,
      id,
    ),
    all(
      c.env.DB,
      `SELECT id, public_id, invoice_no, status, total, method, gateway, created_at, paid_at FROM orders WHERE student_id = ? ORDER BY created_at DESC LIMIT 30`,
      id,
    ),
    first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM reviews WHERE student_id = ?", id),
    first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM lesson_questions WHERE student_id = ?", id),
  ]);
  return ok(c, { student, enrollments, orders, review_count: reviews?.n ?? 0, question_count: questions?.n ?? 0 });
});

students.patch("/students/:id", requirePerm("students:write"), async (c) => {
  const id = intParam(c, "id");
  if (!(await first(c.env.DB, "SELECT id FROM students WHERE id = ?", id))) throw notFound();
  const body = await parseBody(c, z.object({ name: nameSchema, phone: phoneSchema, locale: langSchema }).partial());
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(v as string | null);
  }
  if (sets.length) await run(c.env.DB, `UPDATE students SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...params, nowIso(), id);
  await audit(c, { action: "student.updated", entity: "student", entityId: id, meta: { fields: Object.keys(body) } });
  return ok(c);
});

/** Blocking signs the student out everywhere at once (sessions_valid_after, millisecond precision). */
students.post("/students/:id/block", requirePerm("students:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ reason: textSchema(300) }));
  const res = await run(c.env.DB, "UPDATE students SET blocked = 1, blocked_reason = ?, sessions_valid_after = ?, updated_at = ? WHERE id = ?", body.reason, new Date().toISOString(), nowIso(), id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await audit(c, { action: "student.blocked", entity: "student", entityId: id, summary: body.reason });
  return ok(c);
});

students.post("/students/:id/unblock", requirePerm("students:write"), async (c) => {
  const id = intParam(c, "id");
  const res = await run(c.env.DB, "UPDATE students SET blocked = 0, blocked_reason = NULL, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?", nowIso(), id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await audit(c, { action: "student.unblocked", entity: "student", entityId: id });
  return ok(c);
});

/** Support tool: e-mails the student a fresh 1-hour reset link (the admin never sees or sets their password). */
students.post("/students/:id/send-reset", requirePerm("students:write"), async (c) => {
  const id = intParam(c, "id");
  const student = await first<{ id: number; email: string; locale: "bn" | "en"; blocked: number }>(c.env.DB, "SELECT id, email, locale, blocked FROM students WHERE id = ?", id);
  if (!student) throw notFound();
  if (student.blocked) throw new HttpError(409, "account_blocked");
  const link = await createPasswordResetLink(c.env, id);
  const sent = await sendMail(c.env, { to: student.email, ...passwordResetMail(student.locale, link) });
  await audit(c, { action: "student.reset_sent", entity: "student", entityId: id, meta: { ok: sent.ok } });
  return ok(c, { sent: sent.ok });
});

const courseRef = z.object({ course_id: z.number().int().positive() });

/** Complimentary / manual enrollment (scholarships, cash payments taken in person, fixing a failed webhook). */
students.post("/students/:id/enroll", requirePerm("students:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, courseRef);
  const [student, course] = await Promise.all([
    first(c.env.DB, "SELECT id FROM students WHERE id = ?", id),
    first(c.env.DB, "SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL", body.course_id),
  ]);
  if (!student) throw notFound();
  if (!course) throw new HttpError(422, "validation", "validation", { course_id: "invalid" });
  await run(
    c.env.DB,
    `INSERT INTO enrollments (student_id, course_id, order_id, status, source, enrolled_at) VALUES (?, ?, NULL, 'active', 'admin', ?)
     ON CONFLICT(student_id, course_id) DO UPDATE SET status = 'active', revoked_at = NULL,
       enrolled_at = CASE WHEN enrollments.status = 'revoked' THEN excluded.enrolled_at ELSE enrollments.enrolled_at END`,
    id,
    body.course_id,
    nowIso(),
  );
  await audit(c, { action: "enrollment.granted", entity: "student", entityId: id, meta: { course_id: body.course_id } });
  return ok(c);
});

students.post("/students/:id/revoke", requirePerm("students:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, courseRef);
  const res = await run(c.env.DB, "UPDATE enrollments SET status = 'revoked', revoked_at = ? WHERE student_id = ? AND course_id = ? AND status = 'active'", nowIso(), id, body.course_id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await audit(c, { action: "enrollment.revoked", entity: "student", entityId: id, meta: { course_id: body.course_id } });
  return ok(c);
});
