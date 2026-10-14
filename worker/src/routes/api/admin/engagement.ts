import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { csvResponse, toCsv } from "../../../lib/csv";
import { generateCertificateCode } from "../../../lib/crypto";
import { all, first, likeEscape, nowIso, pageInfo, pageParams, run } from "../../../lib/db";
import { HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { textSchema } from "../../../lib/schemas";
import { bumpContentVersion } from "../../../lib/settings";
import { requirePerm } from "../../../middleware/auth";
import { refreshCourseRating } from "../../../services/catalog";
import { CERT_PREFIX } from "../../../services/learning";

/** Reviews, lesson Q&A and certificates — the "after the sale" side of the academy. */
export const engagement = new Hono<AppEnv>();

const digits = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

/* ----------------------------------------------------------------------------------------------- reviews */
function reviewFilters(q: Record<string, string>) {
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (["pending", "approved", "rejected"].includes(q.status ?? "")) {
    where.push("r.status = ?");
    params.push(q.status);
  }
  const course = digits(q.course_id);
  if (course) {
    where.push("r.course_id = ?");
    params.push(course);
  }
  if (digits(q.rating)) {
    where.push("r.rating = ?");
    params.push(Number(q.rating));
  }
  if (q.q?.trim()) {
    where.push("(r.body LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')");
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    params.push(like, like);
  }
  return { where: where.join(" AND "), params };
}

const REVIEW_SQL = `SELECT r.id, r.course_id, r.rating, r.body, r.status, r.reply, r.replied_at, r.created_at,
  s.id AS student_id, s.name AS student_name, c.title_en AS course_title_en, c.title_bn AS course_title_bn
  FROM reviews r JOIN students s ON s.id = r.student_id JOIN courses c ON c.id = r.course_id`;

engagement.get("/reviews", requirePerm("reviews:read"), async (c) => {
  const f = reviewFilters(c.req.query());
  const { page, per_page, offset } = pageParams(c.req.query());
  const [rows, total] = await Promise.all([
    all(c.env.DB, `${REVIEW_SQL} WHERE ${f.where} ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT ? OFFSET ?`, ...f.params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM reviews r JOIN students s ON s.id = r.student_id WHERE ${f.where}`, ...f.params),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0) });
});

engagement.get("/reviews/export.csv", requirePerm("reviews:read"), async (c) => {
  const f = reviewFilters(c.req.query());
  const rows = await all<Record<string, unknown>>(c.env.DB, `${REVIEW_SQL} WHERE ${f.where} ORDER BY r.created_at DESC LIMIT 5000`, ...f.params);
  return csvResponse(
    "reviews",
    toCsv(rows, [
      { key: "created_at", label: "Date (UTC)" },
      { key: "course_title_en", label: "Class" },
      { key: "student_name", label: "Student" },
      { key: "rating", label: "Rating" },
      { key: "status", label: "Status" },
      { key: "body", label: "Review" },
      { key: "reply", label: "Reply" },
    ]),
  );
});

engagement.post("/reviews/:id/moderate", requirePerm("reviews:moderate"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ status: z.enum(["approved", "rejected", "pending"]) }));
  const review = await first<{ course_id: number }>(c.env.DB, "SELECT course_id FROM reviews WHERE id = ?", id);
  if (!review) throw notFound();
  await run(c.env.DB, "UPDATE reviews SET status = ?, updated_at = ? WHERE id = ?", body.status, nowIso(), id);
  await refreshCourseRating(c.env, review.course_id);
  await bumpContentVersion(c.env);
  await audit(c, { action: `review.${body.status}`, entity: "review", entityId: id });
  return ok(c);
});

engagement.post("/reviews/:id/reply", requirePerm("reviews:moderate"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ reply: textSchema(1000) }));
  const res = body.reply
    ? await run(c.env.DB, "UPDATE reviews SET reply = ?, replied_by = ?, replied_at = ?, updated_at = ? WHERE id = ?", body.reply, c.get("staff")!.id, nowIso(), nowIso(), id)
    : await run(c.env.DB, "UPDATE reviews SET reply = NULL, replied_by = NULL, replied_at = NULL, updated_at = ? WHERE id = ?", nowIso(), id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await bumpContentVersion(c.env);
  await audit(c, { action: "review.replied", entity: "review", entityId: id });
  return ok(c);
});

/* ------------------------------------------------------------------------------------------ lesson Q&A */
engagement.get("/questions", requirePerm("questions:read"), async (c) => {
  const q = c.req.query();
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (["open", "answered", "hidden"].includes(q.status ?? "")) {
    where.push("q.status = ?");
    params.push(q.status);
  }
  const course = digits(q.course_id);
  if (course) {
    where.push("q.course_id = ?");
    params.push(course);
  }
  const { page, per_page, offset } = pageParams(q);
  const base = `FROM lesson_questions q JOIN students s ON s.id = q.student_id JOIN lessons l ON l.id = q.lesson_id JOIN courses c ON c.id = q.course_id WHERE ${where.join(" AND ")}`;
  const [rows, total] = await Promise.all([
    all(
      c.env.DB,
      `SELECT q.id, q.body, q.answer, q.status, q.created_at, q.answered_at, q.course_id, q.lesson_id,
              s.name AS student_name, l.title_en AS lesson_title_en, l.title_bn AS lesson_title_bn, c.title_en AS course_title_en, c.title_bn AS course_title_bn
       ${base} ORDER BY (q.status = 'open') DESC, q.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      per_page,
      offset,
    ),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n ${base}`, ...params),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0) });
});

engagement.post("/questions/:id/answer", requirePerm("questions:answer"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ answer: textSchema(3000, 1) }));
  const res = await run(c.env.DB, "UPDATE lesson_questions SET answer = ?, answered_by = ?, answered_at = ?, status = 'answered' WHERE id = ?", body.answer, c.get("staff")!.id, nowIso(), id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await audit(c, { action: "question.answered", entity: "question", entityId: id });
  return ok(c);
});

engagement.post("/questions/:id/visibility", requirePerm("questions:answer"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ hidden: z.boolean() }));
  const row = await first<{ answer: string | null }>(c.env.DB, "SELECT answer FROM lesson_questions WHERE id = ?", id);
  if (!row) throw notFound();
  await run(c.env.DB, "UPDATE lesson_questions SET status = ? WHERE id = ?", body.hidden ? "hidden" : row.answer ? "answered" : "open", id);
  await audit(c, { action: body.hidden ? "question.hidden" : "question.unhidden", entity: "question", entityId: id });
  return ok(c);
});

/* ------------------------------------------------------------------------------------------ certificates */
function certFilters(q: Record<string, string>) {
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (q.revoked === "1") where.push("ce.revoked_at IS NOT NULL");
  else if (q.revoked === "0") where.push("ce.revoked_at IS NULL");
  const course = digits(q.course_id);
  if (course) {
    where.push("ce.course_id = ?");
    params.push(course);
  }
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    where.push("(ce.code LIKE ? ESCAPE '\\' OR ce.student_name LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  return { where: where.join(" AND "), params };
}

const CERT_SQL = `SELECT ce.id, ce.code, ce.student_id, ce.course_id, ce.student_name, ce.course_title_en, ce.course_title_bn, ce.issued_at, ce.revoked_at, ce.revoked_reason, s.email AS student_email
  FROM certificates ce JOIN students s ON s.id = ce.student_id`;

engagement.get("/certificates", requirePerm("certificates:read"), async (c) => {
  const f = certFilters(c.req.query());
  const { page, per_page, offset } = pageParams(c.req.query());
  const [rows, total] = await Promise.all([
    all(c.env.DB, `${CERT_SQL} WHERE ${f.where} ORDER BY ce.issued_at DESC LIMIT ? OFFSET ?`, ...f.params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM certificates ce JOIN students s ON s.id = ce.student_id WHERE ${f.where}`, ...f.params),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0) });
});

engagement.get("/certificates/export.csv", requirePerm("certificates:read"), async (c) => {
  const f = certFilters(c.req.query());
  const rows = await all<Record<string, unknown>>(c.env.DB, `${CERT_SQL} WHERE ${f.where} ORDER BY ce.issued_at DESC LIMIT 5000`, ...f.params);
  return csvResponse(
    "certificates",
    toCsv(rows, [
      { key: "code", label: "Code" },
      { key: "student_name", label: "Student" },
      { key: "student_email", label: "Email" },
      { key: "course_title_en", label: "Class" },
      { key: "issued_at", label: "Issued (UTC)" },
      { key: "revoked_at", label: "Revoked (UTC)" },
      { key: "revoked_reason", label: "Reason" },
    ]),
  );
});

engagement.post("/certificates/:id/revoke", requirePerm("certificates:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ reason: textSchema(300, 1) }));
  const res = await run(c.env.DB, "UPDATE certificates SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL", nowIso(), body.reason, id);
  if ((res.meta.changes ?? 0) === 0) throw new HttpError(409, "not_active");
  await audit(c, { action: "certificate.revoked", entity: "certificate", entityId: id, summary: body.reason });
  return ok(c);
});

engagement.post("/certificates/:id/restore", requirePerm("certificates:write"), async (c) => {
  const id = intParam(c, "id");
  const res = await run(c.env.DB, "UPDATE certificates SET revoked_at = NULL, revoked_reason = NULL WHERE id = ? AND revoked_at IS NOT NULL", id);
  if ((res.meta.changes ?? 0) === 0) throw new HttpError(409, "not_revoked");
  await audit(c, { action: "certificate.restored", entity: "certificate", entityId: id });
  return ok(c);
});

/** Re-issue: new verification code + fresh name/title snapshot (e.g. a misspelt name). The old code stops verifying. */
engagement.post("/certificates/:id/reissue", requirePerm("certificates:write"), async (c) => {
  const id = intParam(c, "id");
  const cert = await first<{ id: number; code: string }>(c.env.DB, "SELECT id, code FROM certificates WHERE id = ?", id);
  if (!cert) throw notFound();
  const code = generateCertificateCode(CERT_PREFIX);
  await run(
    c.env.DB,
    `UPDATE certificates SET code = ?, issued_at = ?, revoked_at = NULL, revoked_reason = NULL,
       student_name = (SELECT name FROM students WHERE id = certificates.student_id),
       course_title_bn = (SELECT title_bn FROM courses WHERE id = certificates.course_id),
       course_title_en = (SELECT title_en FROM courses WHERE id = certificates.course_id)
     WHERE id = ?`,
    code,
    nowIso(),
    id,
  );
  await audit(c, { action: "certificate.reissued", entity: "certificate", entityId: id, summary: `${cert.code} -> ${code}` });
  return ok(c, { code });
});
