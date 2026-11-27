import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { csvResponse, toCsv } from "../../../lib/csv";
import { all, first, likeEscape, pageInfo, pageParams, run } from "../../../lib/db";
import { intParam, notFound, ok, parseBody } from "../../../lib/http";
import { requirePerm } from "../../../middleware/auth";
import { notifyLaunch } from "../../../services/launch";
import { NO_EMAIL_DOMAIN } from "@mawah/shared";

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

/* ---------------------------------------------------------------------- the marketing list: subscribers + students */
/**
 * Everyone the academy can e-mail about classes: the newsletter's subscribers and every student with a real e-mail (a student who signed
 * up with a phone number only has none). Each row says plainly whether that person agreed to offers — a newsletter subscriber did, a
 * student only if they ticked it — so the owner can send news to all and offers only to those who said yes. A student who is also a
 * subscriber is listed once.
 */
const AUDIENCE_SQL = `SELECT * FROM (
  SELECT 'subscriber' AS kind, x.id, x.email, NULL AS name, NULL AS phone, x.lang, x.source, x.created_at, x.unsubscribed_at,
         CASE WHEN x.unsubscribed_at IS NULL THEN 1 ELSE 0 END AS consent
    FROM subscribers x
  UNION ALL
  SELECT 'student' AS kind, s.id, s.email, s.name, s.phone, s.locale AS lang, 'student' AS source, s.created_at, NULL AS unsubscribed_at, s.marketing_opt_in AS consent
    FROM students s
   WHERE s.deleted_at IS NULL AND s.blocked = 0 AND s.email NOT LIKE '%@${NO_EMAIL_DOMAIN}'
     AND NOT EXISTS (SELECT 1 FROM subscribers x WHERE x.email = s.email)
) a`;

function audienceFilters(q: Record<string, string>) {
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (q.kind === "subscriber" || q.kind === "student") {
    where.push("a.kind = ?");
    params.push(q.kind);
  }
  if (q.consent === "1" || q.consent === "0") {
    where.push("a.consent = ?");
    params.push(Number(q.consent));
  }
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    where.push("(a.email LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR a.phone LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  return { where: where.join(" AND "), params };
}

audience.get("/subscribers", requirePerm("signups:read"), async (c) => {
  const q = c.req.query();
  const f = audienceFilters(q);
  const { page, per_page, offset } = pageParams(q);
  const [rows, total, counts] = await Promise.all([
    all(c.env.DB, `${AUDIENCE_SQL} WHERE ${f.where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, ...f.params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM (${AUDIENCE_SQL} WHERE ${f.where})`, ...f.params),
    first<{ subscribers: number; students: number; consent: number }>(
      c.env.DB,
      `SELECT SUM(kind = 'subscriber') AS subscribers, SUM(kind = 'student') AS students, SUM(consent) AS consent FROM (${AUDIENCE_SQL})`,
    ),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0), counts: { subscribers: counts?.subscribers ?? 0, students: counts?.students ?? 0, consent: counts?.consent ?? 0 } });
});

audience.get("/subscribers/export.csv", requirePerm("signups:read"), async (c) => {
  const f = audienceFilters(c.req.query());
  const rows = await all<Record<string, unknown>>(c.env.DB, `${AUDIENCE_SQL} WHERE ${f.where} ORDER BY a.created_at DESC LIMIT 50000`, ...f.params);
  return csvResponse(
    "marketing-list",
    toCsv(
      rows.map((r) => ({ ...r, consent: r.consent ? "yes" : "no" })),
      [
        { key: "email", label: "Email" },
        { key: "name", label: "Name" },
        { key: "phone", label: "Phone" },
        { key: "kind", label: "Type" },
        { key: "consent", label: "Agreed to offers" },
        { key: "lang", label: "Language" },
        { key: "source", label: "Source" },
        { key: "created_at", label: "Joined (UTC)" },
        { key: "unsubscribed_at", label: "Unsubscribed (UTC)" },
      ],
    ),
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
      `SELECT e.id, e.question, e.reason, e.lang, e.status, e.created_at, e.asked, e.last_asked_at, (e.answer IS NOT NULL) AS answered, e.draft_state, e.draft,
              c.title_en AS course_title_en, c.title_bn AS course_title_bn, s.name AS student_name, s.email AS student_email
       FROM chat_escalations e LEFT JOIN courses c ON c.id = e.course_id LEFT JOIN students s ON s.id = e.student_id
       WHERE ${where} ORDER BY (e.status = 'open') DESC, e.asked DESC, e.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      per_page,
      offset,
    ),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM chat_escalations e WHERE ${where}`, ...params),
  ]);
  // how many AI answers wait for approval (services/chatDrafts.ts): the page offers to approve them all
  const ready = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM chat_escalations WHERE status = 'open' AND answer IS NULL AND draft_state = 'ready'");
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0), drafts_ready: ready?.n ?? 0 });
});

audience.post("/escalations/:id/status", requirePerm("messages:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ status: z.enum(["open", "handled"]) }));
  const res = await run(c.env.DB, "UPDATE chat_escalations SET status = ? WHERE id = ?", body.status, id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await audit(c, { action: `escalation.${body.status}`, entity: "escalation", entityId: id });
  return ok(c);
});
