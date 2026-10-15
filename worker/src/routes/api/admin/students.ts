import { Hono } from "hono";
import { z } from "zod";
import { IMPORT_FIELDS, IMPORT_MAX_ROWS, MAX_PAST_AMOUNT, PAST_METHODS, STUDENT_SOURCES } from "@mawah/shared";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { csvResponse, toCsv } from "../../../lib/csv";
import { all, first, likeEscape, nowIso, pageInfo, pageParams, run } from "../../../lib/db";
import { conflict, HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { passwordResetMail, sendMail } from "../../../lib/mailer";
import { emailSchema, idSchema, langSchema, nameSchema, phoneSchema, textSchema } from "../../../lib/schemas";
import { requirePerm } from "../../../middleware/auth";
import { createPasswordResetLink } from "../../../services/auth";
import { analyzeRows, commitRows, createStudent, grantAccess, inviteStudent, summarize } from "../../../services/students";

export const students = new Hono<AppEnv>();

const LIST_COLS = `s.id, s.name, s.email, s.phone, s.locale, s.blocked, s.source, s.notes, s.created_at, s.last_login_at,
  (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = s.id AND e.status = 'active') AS enrollments,
  (SELECT COUNT(*) FROM orders o WHERE o.student_id = s.id AND o.status = 'paid') AS orders,
  (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.student_id = s.id AND o.status = 'paid') AS spent`;

function filters(q: Record<string, string>) {
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (q.blocked === "1") where.push("s.blocked = 1");
  if ((STUDENT_SOURCES as readonly string[]).includes(q.source ?? "")) {
    where.push("s.source = ?");
    params.push(q.source!);
  }
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
      { key: "source", label: "How they joined" },
      { key: "enrollments", label: "Active classes" },
      { key: "orders", label: "Paid orders" },
      { key: "spent", label: "Spent (BDT)" },
      { key: "blocked", label: "Blocked" },
      { key: "notes", label: "Note" },
      { key: "created_at", label: "Joined (UTC)" },
      { key: "last_login_at", label: "Last login (UTC)" },
    ]),
  );
});

students.get("/students/:id", requirePerm("students:read"), async (c) => {
  const id = intParam(c, "id");
  const student = await first(
    c.env.DB,
    "SELECT id, name, email, phone, locale, blocked, blocked_reason, email_verified_at, marketing_opt_in, source, notes, created_at, last_login_at FROM students WHERE id = ?",
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

const editable = z
  .object({ name: nameSchema, email: emailSchema, phone: phoneSchema, locale: langSchema, notes: textSchema(500), marketing_opt_in: z.boolean() })
  .partial();

students.patch("/students/:id", requirePerm("students:write"), async (c) => {
  const id = intParam(c, "id");
  const current = await first<{ email: string }>(c.env.DB, "SELECT email FROM students WHERE id = ?", id);
  if (!current) throw notFound();
  const body = await parseBody(c, editable);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const changedEmail = body.email !== undefined && body.email !== current.email.toLowerCase();
  if (changedEmail && (await first(c.env.DB, "SELECT id FROM students WHERE email = ? AND id != ?", body.email!, id))) throw conflict("email_taken", { email: "email_taken" });
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(typeof v === "boolean" ? (v ? 1 : 0) : (v as string | null));
  }
  // a new sign-in address has not been confirmed by its owner yet
  if (changedEmail) sets.push("email_verified_at = NULL");
  if (sets.length) {
    try {
      await run(c.env.DB, `UPDATE students SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...params, nowIso(), id);
    } catch (err) {
      if (/students\.email/.test(String(err))) throw conflict("email_taken", { email: "email_taken" });
      throw err;
    }
  }
  // an address change decides who can sign in to the account, so the trail says from what to what
  await audit(c, { action: "student.updated", entity: "student", entityId: id, meta: { fields: Object.keys(body), ...(changedEmail ? { email_from: current.email, email_to: body.email } : {}) } });
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

const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date");
const paymentSchema = z.object({
  amount: z.number({ error: "required" }).int("invalid_amount").min(0, "invalid_amount").max(MAX_PAST_AMOUNT, "invalid_amount"),
  method: z.enum(PAST_METHODS).default("other"),
  txn_id: z.string().trim().max(40, "too_long").default(""),
  paid_on: day.optional(),
});
/** Classes to give, from which day, and — optionally — the payment that was made for them. */
const access = {
  course_ids: z.array(idSchema).max(12, "too_long").default([]),
  enrolled_on: day.optional(),
  payment: paymentSchema.nullable().optional(),
};
type AccessBody = { course_ids: number[]; enrolled_on?: string | undefined; payment?: z.output<typeof paymentSchema> | null | undefined };
const accessInput = (b: AccessBody, extra: number[] = []) => ({
  courseIds: [...new Set([...extra, ...b.course_ids])],
  enrolledOn: b.enrolled_on,
  payment: b.payment ? { amount: b.payment.amount, method: b.payment.method, txn: b.payment.txn_id, paidOn: b.payment.paid_on } : null,
});

const createSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  locale: langSchema.default("bn"),
  notes: textSchema(500).default(""),
  marketing_opt_in: z.boolean().default(false),
  ...access,
});

/** A student the owner adds by hand (someone who studied before the website, or paid in cash), optionally with classes and the payment already made. */
students.post("/students", requirePerm("students:write"), async (c) => {
  const b = await parseBody(c, createSchema);
  const made = await createStudent(c.env, { name: b.name, email: b.email, phone: b.phone ?? null, locale: b.locale, notes: b.notes, marketing: b.marketing_opt_in }, accessInput(b));
  await audit(c, { action: "student.created", entity: "student", entityId: made.id, meta: { classes: made.granted, paid: !!b.payment?.amount } });
  return ok(c, { id: made.id, granted: made.granted }, 201);
});

const enrolSchema = z.object({ course_id: courseRef.shape.course_id.optional(), ...access });

/** Giving classes by hand (scholarships, cash taken in person, an old student, fixing a failed webhook) — with a date, and the payment if there was one. */
students.post("/students/:id/enroll", requirePerm("students:write"), async (c) => {
  const id = intParam(c, "id");
  const b = await parseBody(c, enrolSchema);
  const input = accessInput(b, b.course_id ? [b.course_id] : []);
  if (input.courseIds.length === 0) throw new HttpError(422, "validation", "validation", { course_ids: "required" });
  const done = await grantAccess(c.env, id, input);
  await audit(c, {
    action: "enrollment.granted",
    entity: "student",
    entityId: id,
    meta: { course_ids: done.granted.map((g) => g.id), already_had: done.skipped.map((g) => g.id), ...(input.enrolledOn ? { enrolled_on: input.enrolledOn } : {}), ...(done.invoice_no ? { invoice_no: done.invoice_no } : {}) },
  });
  return ok(c, { granted: done.granted.length, already_had: done.skipped.length, invoice_no: done.invoice_no });
});

/** Gives the student a way in: an e-mail with a link to choose a password, or the link itself for staff to pass on (valid for three days). */
students.post("/students/:id/invite", requirePerm("students:write"), async (c) => {
  const id = intParam(c, "id");
  const b = await parseBody(c, z.object({ mode: z.enum(["email", "link"]) }));
  const r = await inviteStudent(c.env, id, b.mode);
  await audit(c, { action: b.mode === "link" ? "student.invite_link" : "student.invite_mail", entity: "student", entityId: id, meta: { sent: r.sent ?? null } });
  c.header("Cache-Control", "no-store");
  return ok(c, r);
});

/* ---------------------------------------------------------------------------- a list of students from a spreadsheet */
const importRow = z.object(Object.fromEntries(IMPORT_FIELDS.map((f) => [f, z.string().max(2000, "too_long").optional()])) as Record<(typeof IMPORT_FIELDS)[number], z.ZodOptional<z.ZodString>>);
/** The browser sends the list in small parts when it saves; checking may send up to a whole file. */
const SAVE_MAX_ROWS = 50;

/** What saving this list would do, line by line — nothing is written. */
students.post("/students/import/preview", requirePerm("students:write"), async (c) => {
  const b = await parseBody(c, z.object({ rows: z.array(importRow).min(1, "required").max(IMPORT_MAX_ROWS, "too_long") }));
  const list = await analyzeRows(c.env, b.rows);
  return ok(c, { results: list.map((a) => a.result), summary: summarize(list) });
});

/** Saves the lines without a problem (the Worker reads every line again; it does not trust the browser's idea of which are fine). */
students.post("/students/import", requirePerm("students:write"), async (c) => {
  const b = await parseBody(c, z.object({ rows: z.array(importRow).min(1, "required").max(SAVE_MAX_ROWS, "too_long") }));
  const list = await analyzeRows(c.env, b.rows);
  await commitRows(c.env, list);
  const summary = summarize(list);
  await audit(c, { action: "students.imported", entity: "student", summary: `${summary.new_students} new, ${summary.existing_students} existing, ${summary.problem_rows} skipped`, meta: { ...summary } });
  return ok(c, { results: list.map((a) => a.result), summary });
});

students.post("/students/:id/revoke", requirePerm("students:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, courseRef);
  const res = await run(c.env.DB, "UPDATE enrollments SET status = 'revoked', revoked_at = ? WHERE student_id = ? AND course_id = ? AND status = 'active'", nowIso(), id, body.course_id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await audit(c, { action: "enrollment.revoked", entity: "student", entityId: id, meta: { course_id: body.course_id } });
  return ok(c);
});
