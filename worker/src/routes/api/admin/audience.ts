import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { csvResponse, toCsv } from "../../../lib/csv";
import { all, first, likeEscape, pageInfo, pageParams, run } from "../../../lib/db";
import { intParam, notFound, ok, parseBody } from "../../../lib/http";
import { requirePerm } from "../../../middleware/auth";
import { notifyLaunch } from "../../../services/launch";

/** Everyone who raised a hand: "notify me" sign-ups, newsletter subscribers, contact messages and chatbot hand-offs. */
export const audience = new Hono<AppEnv>();

const digits = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

/* ----------------------------------------------------------------------------------------- notify sign-ups */
const SIGNUP_SQL = `SELECT n.id, n.course_id, n.email, n.phone, n.lang, n.created_at, n.notified_at, c.title_en AS course_title_en, c.title_bn AS course_title_bn, c.status AS course_status
  FROM notify_signups n JOIN courses c ON c.id = n.course_id`;

function signupFilters(q: Record<string, string>) {
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  const course = digits(q.course_id);
  if (course) {
    where.push("n.course_id = ?");
    params.push(course);
  }
  if (q.pending === "1") where.push("n.notified_at IS NULL");
  if (q.q?.trim()) {
    where.push("(n.email LIKE ? ESCAPE '\\' OR n.phone LIKE ? ESCAPE '\\')");
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    params.push(like, like);
  }
  return { where: where.join(" AND "), params };
}

audience.get("/signups", requirePerm("signups:read"), async (c) => {
  const f = signupFilters(c.req.query());
  const { page, per_page, offset } = pageParams(c.req.query());
  const [rows, total, byCourse] = await Promise.all([
    all(c.env.DB, `${SIGNUP_SQL} WHERE ${f.where} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`, ...f.params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM notify_signups n WHERE ${f.where}`, ...f.params),
    all(c.env.DB, `SELECT c.id, c.title_en, c.title_bn, c.status, COUNT(*) AS waiting FROM notify_signups n JOIN courses c ON c.id = n.course_id WHERE n.notified_at IS NULL GROUP BY c.id ORDER BY waiting DESC LIMIT 30`),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0), waiting_by_course: byCourse });
});

audience.get("/signups/export.csv", requirePerm("signups:read"), async (c) => {
  const f = signupFilters(c.req.query());
  const rows = await all<Record<string, unknown>>(c.env.DB, `${SIGNUP_SQL} WHERE ${f.where} ORDER BY n.created_at DESC LIMIT 5000`, ...f.params);
  return csvResponse(
    "notify-signups",
    toCsv(rows, [
      { key: "created_at", label: "Date (UTC)" },
      { key: "course_title_en", label: "Class" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "lang", label: "Language" },
      { key: "notified_at", label: "Notified (UTC)" },
    ]),
  );
});

audience.delete("/signups/:id", requirePerm("signups:write"), async (c) => {
  const id = intParam(c, "id");
  const res = await run(c.env.DB, "DELETE FROM notify_signups WHERE id = ?", id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await audit(c, { action: "signup.deleted", entity: "signup", entityId: id });
  return ok(c);
});

/** Manually (re)send the "it is open now" e-mail for an already published class. */
audience.post("/signups/notify/:courseId", requirePerm("signups:write"), async (c) => {
  const courseId = intParam(c, "courseId");
  if (!(await first(c.env.DB, "SELECT id FROM courses WHERE id = ?", courseId))) throw notFound();
  const sent = await notifyLaunch(c.env, courseId);
  await audit(c, { action: "signup.notify_sent", entity: "course", entityId: courseId, summary: `${sent} e-mails` });
  return ok(c, { sent });
});

/* -------------------------------------------------------------------------------------------- subscribers */
audience.get("/subscribers", requirePerm("signups:read"), async (c) => {
  const q = c.req.query();
  const where = q.q?.trim() ? "email LIKE ? ESCAPE '\\'" : "1=1";
  const params = q.q?.trim() ? [`%${likeEscape(q.q.trim().slice(0, 80))}%`] : [];
  const { page, per_page, offset } = pageParams(q);
  const [rows, total] = await Promise.all([
    all(c.env.DB, `SELECT id, email, lang, source, created_at, unsubscribed_at FROM subscribers WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM subscribers WHERE ${where}`, ...params),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0) });
});

audience.get("/subscribers/export.csv", requirePerm("signups:read"), async (c) => {
  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT email, lang, source, created_at, unsubscribed_at FROM subscribers ORDER BY created_at DESC LIMIT 20000");
  return csvResponse(
    "subscribers",
    toCsv(rows, [
      { key: "email", label: "Email" },
      { key: "lang", label: "Language" },
      { key: "source", label: "Source" },
      { key: "created_at", label: "Subscribed (UTC)" },
      { key: "unsubscribed_at", label: "Unsubscribed (UTC)" },
    ]),
  );
});

/* ----------------------------------------------------------------------------------------------- messages */
audience.get("/messages", requirePerm("messages:read"), async (c) => {
  const q = c.req.query();
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (q.status === "new" || q.status === "handled") {
    where.push("status = ?");
    params.push(q.status);
  }
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const { page, per_page, offset } = pageParams(q);
  const [rows, total] = await Promise.all([
    all(c.env.DB, `SELECT * FROM contact_messages WHERE ${where.join(" AND ")} ORDER BY (status = 'new') DESC, created_at DESC LIMIT ? OFFSET ?`, ...params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM contact_messages WHERE ${where.join(" AND ")}`, ...params),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0) });
});

audience.get("/messages/export.csv", requirePerm("messages:read"), async (c) => {
  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 5000");
  return csvResponse(
    "messages",
    toCsv(rows, [
      { key: "created_at", label: "Date (UTC)" },
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "status", label: "Status" },
      { key: "message", label: "Message" },
    ]),
  );
});

audience.post("/messages/:id/status", requirePerm("messages:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ status: z.enum(["new", "handled"]) }));
  const res = await run(c.env.DB, "UPDATE contact_messages SET status = ? WHERE id = ?", body.status, id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await audit(c, { action: `message.${body.status}`, entity: "message", entityId: id });
  return ok(c);
});

/* ------------------------------------------------------------------------------- chatbot hand-offs ("ask a human") */
audience.get("/escalations", requirePerm("messages:read"), async (c) => {
  const q = c.req.query();
  const status = q.status === "open" || q.status === "handled" ? q.status : null;
  const { page, per_page, offset } = pageParams(q);
  const where = status ? "e.status = ?" : "1=1";
  const params = status ? [status] : [];
  const [rows, total] = await Promise.all([
    all(
      c.env.DB,
      `SELECT e.id, e.question, e.reason, e.lang, e.status, e.created_at, c.title_en AS course_title_en, c.title_bn AS course_title_bn, s.name AS student_name, s.email AS student_email
       FROM chat_escalations e LEFT JOIN courses c ON c.id = e.course_id LEFT JOIN students s ON s.id = e.student_id
       WHERE ${where} ORDER BY (e.status = 'open') DESC, e.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      per_page,
      offset,
    ),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM chat_escalations e WHERE ${where}`, ...params),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0) });
});

audience.post("/escalations/:id/status", requirePerm("messages:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ status: z.enum(["open", "handled"]) }));
  const res = await run(c.env.DB, "UPDATE chat_escalations SET status = ? WHERE id = ?", body.status, id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await audit(c, { action: `escalation.${body.status}`, entity: "escalation", entityId: id });
  return ok(c);
});
