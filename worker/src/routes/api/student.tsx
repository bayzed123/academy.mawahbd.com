import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { all, first, nowIso, run } from "../../lib/db";
import { forbidden, HttpError, intParam, notFound, ok, parseBody } from "../../lib/http";
import { textSchema } from "../../lib/schemas";
import { getSettings } from "../../lib/settings";
import { pageCtxFor } from "../../lib/pagectx";
import { renderHtml } from "../../lib/render";
import { requireStudent } from "../../middleware/auth";
import { rateLimit } from "../../middleware/ratelimit";
import { getCourseBySlug, refreshCourseRating, shortName } from "../../services/catalog";
import {
  activeEnrollment,
  certificatesFor,
  courseForStudent,
  lessonContent,
  myCourses,
  resourceForDownload,
  setLessonComplete,
} from "../../services/learning";
import { facebookUrl, materialsForStudent, recordUse, usableMaterial } from "../../services/materials";
import { orderForStudent, ordersForStudent } from "../../services/orders";
import { manualPayInfo } from "../../services/payments";
import { InvoicePage } from "../../views/pages/misc";

export const studentRoutes = new Hono<AppEnv>();
studentRoutes.use("*", requireStudent);

studentRoutes.get("/courses", async (c) => ok(c, { courses: await myCourses(c.env, c.get("student")!.id) }));

studentRoutes.get("/courses/:slug", async (c) => ok(c, { ...(await courseForStudent(c.env, c.get("student")!.id, c.req.param("slug"))) }));

studentRoutes.get("/lessons/:id", async (c) => ok(c, { lesson: await lessonContent(c.env, intParam(c, "id"), c.get("student")!.id) }));

studentRoutes.post("/lessons/:id/complete", async (c) => {
  const result = await setLessonComplete(c.env, c.get("student")!.id, intParam(c, "id"), true);
  return ok(c, result);
});

studentRoutes.delete("/lessons/:id/complete", async (c) => {
  const result = await setLessonComplete(c.env, c.get("student")!.id, intParam(c, "id"), false);
  return ok(c, result);
});

/** Files live in a private R2 bucket: only reachable through this authorised, never-cached endpoint. */
studentRoutes.get("/resources/:id/download", async (c) => {
  const resource = await resourceForDownload(c.env, intParam(c, "id"), c.get("student")!.id);
  const object = await c.env.R2.get(resource.r2_key);
  if (!object) throw notFound();
  const safeName = resource.filename.replace(/[^\w.\- ]+/g, "_");
  return new Response(object.body, {
    headers: {
      "Content-Type": resource.mime || "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(resource.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/* ------------------------------------------- class materials: enrolled students only ------------------------------------------- */
/**
 * What the owner added to a class under Admin → Materials. The list carries no address and no file key: a file is fetched through
 * /download and a link through /open — both check the enrolment, both are recorded, and a file is never reachable any other way.
 */
studentRoutes.get("/courses/:slug/materials", async (c) => {
  const me = c.get("student")!;
  const course = await getCourseBySlug(c.env, c.req.param("slug"), { includeHidden: true });
  if (!course) throw notFound();
  if (!(await activeEnrollment(c.env, me.id, course.id))) throw forbidden("not_enrolled");
  return ok(c, { materials: await materialsForStudent(c.env, me.id, course.id) });
});

/** Not enrolled (403) and no such material (404) are told apart only for a material that is really on offer. */
async function materialFor(c: import("../../env").Ctx) {
  const id = intParam(c, "id");
  const me = c.get("student")!;
  const m = await usableMaterial(c.env, id, me.id);
  if (m) return { m, me };
  const exists = await first(c.env.DB, "SELECT id FROM materials WHERE id = ? AND active = 1 AND deleted_at IS NULL", id);
  throw exists ? forbidden("not_enrolled") : notFound();
}

/** "bytes=0-99" → where to start and how long; null when it is not a single simple range inside the file. */
function simpleRange(header: string | undefined, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  start = Math.max(0, start);
  return start <= end && start < size ? { start, end } : null;
}

studentRoutes.get("/materials/:id/download", async (c) => {
  const { m, me } = await materialFor(c);
  if (!m.r2_key) throw notFound(); // a link is opened, not downloaded
  // a student downloads a handful of files, not thousands: a generous hourly limit keeps a scraper from emptying the bucket
  const hour = `matdl:${me.id}:${Math.floor(Date.now() / 3_600_000)}`;
  const used = Number((await c.env.KV.get(hour)) ?? 0);
  if (used >= 80) throw new HttpError(429, "rate_limited");
  await c.env.KV.put(hour, String(used + 1), { expirationTtl: 3700 });

  const head = await c.env.R2.head(m.r2_key);
  if (!head) throw notFound();
  const range = simpleRange(c.req.header("range"), head.size);
  const object = await c.env.R2.get(m.r2_key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!object) throw notFound();
  // a resumed or partial fetch of a big file is one download, not many
  if (!range || range.start === 0) c.executionCtx.waitUntil(recordUse(c.env, m, me.id, "download"));
  const name = m.filename || "file";
  return new Response(object.body, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": m.mime || "application/octet-stream",
      "Content-Length": String(range ? range.end - range.start + 1 : head.size),
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${head.size}` } : {}),
      "Accept-Ranges": "bytes",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w.\- ]+/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

/** The address of a link, a live class or a group — given only to an enrolled student, and recorded. */
studentRoutes.post("/materials/:id/open", async (c) => {
  const { m, me } = await materialFor(c);
  if (!m.url) throw notFound();
  if (m.kind === "group" && m.ask_profile) {
    // a private group with a profile question: the link comes after the student has answered it
    const asked = await first(c.env.DB, "SELECT id FROM group_requests WHERE material_id = ? AND student_id = ?", m.id, me.id);
    if (!asked) throw new HttpError(409, "profile_required");
  }
  c.executionCtx.waitUntil(recordUse(c.env, m, me.id, "open"));
  return ok(c, { url: m.url });
});

const joinSchema = z.object({ profile_url: z.string().trim().max(300).default("") });
/** Ask to join a private group: the student's Facebook profile link goes to the owner, who approves them in the group. */
studentRoutes.post("/materials/:id/join", rateLimit("RL_FORM"), async (c) => {
  const { m, me } = await materialFor(c);
  if (m.kind !== "group" || !m.url) throw notFound();
  const body = await parseBody(c, joinSchema);
  let profile = "";
  if (m.ask_profile) {
    const typed = body.profile_url.replace(/^http:\/\//i, "https://");
    const profileUrl = facebookUrl(/^https:\/\//i.test(typed) ? typed : `https://${typed}`);
    if (!body.profile_url || !profileUrl) throw new HttpError(422, "validation", "validation", { profile_url: body.profile_url ? "must_be_facebook_profile" : "required" });
    profile = profileUrl;
  }
  const now = nowIso();
  // one request per student per group; a different profile link starts a new question for the owner, the same one changes nothing
  await run(
    c.env.DB,
    `INSERT INTO group_requests (material_id, course_id, student_id, profile_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(material_id, student_id) DO UPDATE SET
       status = CASE WHEN group_requests.profile_url = excluded.profile_url THEN group_requests.status ELSE 'pending' END,
       profile_url = excluded.profile_url, updated_at = excluded.updated_at`,
    m.id,
    m.course_id,
    me.id,
    profile,
    now,
    now,
  );
  const request = await first<{ status: "pending" | "approved" | "rejected" }>(c.env.DB, "SELECT status FROM group_requests WHERE material_id = ? AND student_id = ?", m.id, me.id);
  c.executionCtx.waitUntil(recordUse(c.env, m, me.id, "open"));
  return ok(c, { request: request ?? { status: "pending" }, url: m.url });
});

studentRoutes.get("/orders", async (c) => ok(c, { orders: await ordersForStudent(c.env, c.get("student")!.id) }));
studentRoutes.get("/orders/:publicId", async (c) => {
  const order = await orderForStudent(c.env, c.get("student")!.id, c.req.param("publicId"));
  // while a manual order is open, its page has to say where to send the money
  const open = order.gateway === "manual" && (order.status === "pending" || order.status === "awaiting_verification");
  return ok(c, { order: open ? { ...order, manual: manualPayInfo(await getSettings(c.env)) } : order, now: new Date().toISOString() });
});

/** Printable invoice (HTML styled for A4 — "Save as PDF" from the browser's print dialog). Only the buyer can open it. */
studentRoutes.get("/orders/:publicId/invoice", async (c) => {
  const me = c.get("student")!;
  const order = await orderForStudent(c.env, me.id, c.req.param("publicId"));
  const customer = await first<{ customer_name: string; customer_email: string; customer_phone: string }>(
    c.env.DB,
    "SELECT customer_name, customer_email, customer_phone FROM orders WHERE public_id = ?",
    order.public_id,
  );
  const lang = c.req.query("lang") === "en" ? "en" : c.req.query("lang") === "bn" ? "bn" : me.locale;
  const ctx = await pageCtxFor(c, lang, `/invoice/${order.public_id}`);
  return renderHtml(
    c,
    ctx,
    <InvoicePage ctx={ctx} order={order} customer={{ name: customer?.customer_name ?? me.name, email: customer?.customer_email ?? me.email, phone: customer?.customer_phone ?? "" }} />,
    { cache: "private, no-store" },
  );
});

studentRoutes.get("/certificates", async (c) => ok(c, { certificates: await certificatesFor(c.env, c.get("student")!.id) }));

/* ------------------------------------------- reviews: enrolled students only ------------------------------------------- */
const reviewSchema = z.object({
  course_id: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1, "required").max(5, "required"),
  body: textSchema(1000),
});

studentRoutes.post("/reviews", rateLimit("RL_FORM"), async (c) => {
  const body = await parseBody(c, reviewSchema);
  const me = c.get("student")!;
  const enrollment = await activeEnrollment(c.env, me.id, body.course_id);
  if (!enrollment) throw forbidden("not_enrolled"); // the hard rule: no purchase, no review
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO reviews (course_id, student_id, enrollment_id, rating, body, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(course_id, student_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, status = 'pending',
       enrollment_id = excluded.enrollment_id, updated_at = excluded.updated_at`,
    body.course_id,
    me.id,
    enrollment.id,
    body.rating,
    body.body,
    now,
    now,
  );
  await refreshCourseRating(c.env, body.course_id); // an edited, previously approved review leaves the public average until re-approved
  await audit(c, { action: "review.submitted", entity: "course", entityId: body.course_id, meta: { rating: body.rating } });
  return ok(c, { status: "pending" }, 201);
});

/* ------------------------------------------------- lesson Q&A ------------------------------------------------- */
const questionSchema = z.object({ lesson_id: z.coerce.number().int().positive(), body: textSchema(1000, 3) });

studentRoutes.get("/questions", async (c) => {
  const lessonId = Number(c.req.query("lesson_id"));
  if (!Number.isInteger(lessonId) || lessonId <= 0) throw notFound();
  const me = c.get("student")!;
  const lesson = await first<{ course_id: number }>(c.env.DB, "SELECT course_id FROM lessons WHERE id = ?", lessonId);
  if (!lesson) throw notFound();
  if (!(await activeEnrollment(c.env, me.id, lesson.course_id))) throw forbidden("not_enrolled");
  const rows = await all<{ id: number; body: string; answer: string | null; answered_at: string | null; created_at: string; student_id: number; name: string }>(
    c.env.DB,
    `SELECT q.id, q.body, q.answer, q.answered_at, q.created_at, q.student_id, s.name
     FROM lesson_questions q JOIN students s ON s.id = q.student_id
     WHERE q.lesson_id = ? AND q.status != 'hidden' AND (q.status = 'answered' OR q.student_id = ?)
     ORDER BY q.created_at DESC LIMIT 50`,
    lessonId,
    me.id,
  );
  return ok(c, {
    questions: rows.map((r) => ({ id: r.id, body: r.body, answer: r.answer, answered_at: r.answered_at, created_at: r.created_at, author: shortName(r.name), mine: r.student_id === me.id })),
  });
});

studentRoutes.post("/questions", rateLimit("RL_FORM"), async (c) => {
  const body = await parseBody(c, questionSchema);
  const me = c.get("student")!;
  const lesson = await first<{ course_id: number }>(c.env.DB, "SELECT course_id FROM lessons WHERE id = ?", body.lesson_id);
  if (!lesson) throw notFound();
  if (!(await activeEnrollment(c.env, me.id, lesson.course_id))) throw forbidden("not_enrolled");
  const res = await run(
    c.env.DB,
    "INSERT INTO lesson_questions (course_id, lesson_id, student_id, body) VALUES (?, ?, ?, ?)",
    lesson.course_id,
    body.lesson_id,
    me.id,
    body.body,
  );
  await audit(c, { action: "question.asked", entity: "lesson", entityId: body.lesson_id });
  return ok(c, { id: res.meta.last_row_id }, 201);
});

// kept so the route table is explicit about what happens to unknown student endpoints
studentRoutes.all("*", () => {
  throw new HttpError(404, "not_found");
});
