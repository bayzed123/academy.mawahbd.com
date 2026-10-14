import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { LESSON_TYPES, MAX_UPLOAD_RESOURCE_BYTES } from "@mawah/shared";
import type { AppEnv, Ctx } from "../../../env";
import { audit } from "../../../lib/audit";
import { randomToken } from "../../../lib/crypto";
import { all, first, nowIso, run } from "../../../lib/db";
import { safeFilename, sniffResource } from "../../../lib/files";
import { HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { optionalUrl, textSchema } from "../../../lib/schemas";
import { bumpContentVersion } from "../../../lib/settings";
import { requirePerm } from "../../../middleware/auth";
import { refreshCourseStats } from "../../../services/catalog";

/**
 * Curriculum builder API: modules -> lessons -> downloadable resources.
 * Every change keeps the class's denormalised counters in sync and bumps the public-page cache version.
 */
export const curriculum = new Hono<AppEnv>();

const MAX_RESOURCES_PER_LESSON = 10;

const moduleSchema = z.object({
  title_bn: textSchema(160, 1),
  title_en: textSchema(160, 1),
  drip_days: z.number().int().min(0).max(730),
});

const lessonSchema = z.object({
  module_id: z.number().int().positive(),
  title_bn: textSchema(200, 1),
  title_en: textSchema(200, 1),
  type: z.enum(LESSON_TYPES),
  stream_uid: z.union([z.string().trim().regex(/^[a-f0-9]{32}$/i, "invalid_video_id"), z.literal(""), z.null()]).transform((v) => (v ? v.toLowerCase() : null)),
  external_url: optionalUrl,
  body_bn: z.string().max(40000),
  body_en: z.string().max(40000),
  duration_sec: z.number().int().min(0).max(86400),
  is_preview: z.boolean(),
});

const reorderSchema = z.object({
  modules: z.array(z.number().int().positive()).max(200).optional(),
  lessons: z.array(z.object({ module_id: z.number().int().positive(), ids: z.array(z.number().int().positive()).max(500) })).max(200).optional(),
});

async function requireCourse(c: Ctx, id: number) {
  const course = await first<{ id: number; slug: string; title_en: string; title_bn: string; status: string }>(
    c.env.DB,
    "SELECT id, slug, title_en, title_bn, status FROM courses WHERE id = ? AND deleted_at IS NULL",
    id,
  );
  if (!course) throw notFound();
  return course;
}

async function touched(c: Ctx, courseId: number) {
  await refreshCourseStats(c.env, courseId);
  await bumpContentVersion(c.env);
}

const requireTypeFields = (data: { type?: string; external_url?: string | null | undefined }, existing?: { type: string; external_url: string | null }) => {
  const type = data.type ?? existing?.type;
  const url = data.external_url !== undefined ? data.external_url : existing?.external_url;
  if (type === "external" && !url) throw new HttpError(422, "validation", "validation", { external_url: "required" });
};

/* ----------------------------------------------------------------------------------------------- read tree */
curriculum.get("/courses/:id/curriculum", requirePerm("courses:read"), async (c) => {
  const course = await requireCourse(c, intParam(c, "id"));
  const [modules, lessons, resources] = await Promise.all([
    all(c.env.DB, "SELECT id, title_bn, title_en, sort, drip_days FROM modules WHERE course_id = ? ORDER BY sort, id", course.id),
    all<Record<string, unknown>>(
      c.env.DB,
      `SELECT id, module_id, title_bn, title_en, type, stream_uid, external_url, duration_sec, is_preview, sort,
              (length(body_bn) > 0 OR length(body_en) > 0) AS has_body
       FROM lessons WHERE course_id = ? ORDER BY sort, id`,
      course.id,
    ),
    all<Record<string, unknown>>(c.env.DB, "SELECT id, lesson_id, title_bn, title_en, filename, mime, size_bytes FROM lesson_resources WHERE course_id = ? ORDER BY id", course.id),
  ]);
  return ok(c, {
    course,
    modules: (modules as Record<string, unknown>[]).map((m) => ({
      ...m,
      lessons: lessons.filter((l) => l.module_id === m.id).map((l) => ({ ...l, resources: resources.filter((r) => r.lesson_id === l.id) })),
    })),
  });
});

curriculum.get("/lessons/:id", requirePerm("courses:read"), async (c) => {
  const lesson = await first(c.env.DB, "SELECT * FROM lessons WHERE id = ?", intParam(c, "id"));
  if (!lesson) throw notFound();
  const resources = await all(c.env.DB, "SELECT id, title_bn, title_en, filename, mime, size_bytes FROM lesson_resources WHERE lesson_id = ? ORDER BY id", (lesson as { id: number }).id);
  return ok(c, { lesson, resources });
});

/* ---------------------------------------------------------------------------------------------- modules */
curriculum.post("/courses/:id/modules", requirePerm("courses:write"), async (c) => {
  const course = await requireCourse(c, intParam(c, "id"));
  const body = await parseBody(c, moduleSchema.partial({ drip_days: true }));
  const next = await first<{ n: number }>(c.env.DB, "SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM modules WHERE course_id = ?", course.id);
  const res = await run(
    c.env.DB,
    "INSERT INTO modules (course_id, title_bn, title_en, sort, drip_days, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    course.id,
    body.title_bn,
    body.title_en,
    next?.n ?? 1,
    body.drip_days ?? 0,
    nowIso(),
  );
  const id = res.meta.last_row_id as number;
  await touched(c, course.id);
  await audit(c, { action: "module.created", entity: "module", entityId: id, summary: body.title_en, meta: { course: course.slug } });
  return ok(c, { module: await first(c.env.DB, "SELECT id, title_bn, title_en, sort, drip_days FROM modules WHERE id = ?", id) }, 201);
});

curriculum.patch("/modules/:id", requirePerm("courses:write"), async (c) => {
  const id = intParam(c, "id");
  const mod = await first<{ id: number; course_id: number }>(c.env.DB, "SELECT id, course_id FROM modules WHERE id = ?", id);
  if (!mod) throw notFound();
  const body = await parseBody(c, moduleSchema.partial());
  const keys = (Object.keys(body) as (keyof typeof body)[]).filter((k) => body[k] !== undefined);
  if (keys.length) {
    await run(c.env.DB, `UPDATE modules SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => body[k] as string | number), id);
  }
  await bumpContentVersion(c.env);
  await audit(c, { action: "module.updated", entity: "module", entityId: id, meta: { fields: keys } });
  return ok(c, { module: await first(c.env.DB, "SELECT id, title_bn, title_en, sort, drip_days FROM modules WHERE id = ?", id) });
});

curriculum.delete("/modules/:id", requirePerm("courses:write"), async (c) => {
  const id = intParam(c, "id");
  const mod = await first<{ id: number; course_id: number; title_en: string }>(c.env.DB, "SELECT id, course_id, title_en FROM modules WHERE id = ?", id);
  if (!mod) throw notFound();
  const files = await all<{ r2_key: string }>(
    c.env.DB,
    "SELECT r2_key FROM lesson_resources WHERE lesson_id IN (SELECT id FROM lessons WHERE module_id = ?)",
    id,
  );
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM lesson_progress WHERE lesson_id IN (SELECT id FROM lessons WHERE module_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM lesson_questions WHERE lesson_id IN (SELECT id FROM lessons WHERE module_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM lesson_resources WHERE lesson_id IN (SELECT id FROM lessons WHERE module_id = ?)").bind(id),
    c.env.DB.prepare("DELETE FROM lessons WHERE module_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM modules WHERE id = ?").bind(id),
  ]);
  if (files.length) c.executionCtx.waitUntil(c.env.R2.delete(files.map((f) => f.r2_key)));
  await touched(c, mod.course_id);
  await audit(c, { action: "module.deleted", entity: "module", entityId: id, summary: mod.title_en });
  return ok(c);
});

/* ---------------------------------------------------------------------------------------------- lessons */
curriculum.post("/courses/:id/lessons", requirePerm("courses:write"), async (c) => {
  const course = await requireCourse(c, intParam(c, "id"));
  const body = await parseBody(c, lessonSchema.partial({ type: true, stream_uid: true, external_url: true, body_bn: true, body_en: true, duration_sec: true, is_preview: true }));
  const mod = await first<{ id: number }>(c.env.DB, "SELECT id FROM modules WHERE id = ? AND course_id = ?", body.module_id, course.id);
  if (!mod) throw new HttpError(422, "validation", "validation", { module_id: "invalid" });
  requireTypeFields(body);
  const next = await first<{ n: number }>(c.env.DB, "SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM lessons WHERE module_id = ?", mod.id);
  const now = nowIso();
  const res = await run(
    c.env.DB,
    `INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, stream_uid, external_url, body_bn, body_en, duration_sec, is_preview, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    course.id,
    mod.id,
    body.title_bn,
    body.title_en,
    body.type ?? "video",
    body.stream_uid ?? null,
    body.external_url ?? null,
    body.body_bn ?? "",
    body.body_en ?? "",
    body.duration_sec ?? 0,
    body.is_preview ? 1 : 0,
    next?.n ?? 1,
    now,
    now,
  );
  const id = res.meta.last_row_id as number;
  await touched(c, course.id);
  await audit(c, { action: "lesson.created", entity: "lesson", entityId: id, summary: body.title_en, meta: { course: course.slug } });
  return ok(c, { lesson: await first(c.env.DB, "SELECT * FROM lessons WHERE id = ?", id) }, 201);
});

curriculum.patch("/lessons/:id", requirePerm("courses:write"), async (c) => {
  const id = intParam(c, "id");
  const existing = await first<{ id: number; course_id: number; module_id: number; type: string; external_url: string | null }>(
    c.env.DB,
    "SELECT id, course_id, module_id, type, external_url FROM lessons WHERE id = ?",
    id,
  );
  if (!existing) throw notFound();
  const body = await parseBody(c, lessonSchema.partial());
  if (body.module_id !== undefined) {
    const mod = await first(c.env.DB, "SELECT id FROM modules WHERE id = ? AND course_id = ?", body.module_id, existing.course_id);
    if (!mod) throw new HttpError(422, "validation", "validation", { module_id: "invalid" });
  }
  requireTypeFields(body, existing);
  const keys = (Object.keys(body) as (keyof typeof body)[]).filter((k) => body[k] !== undefined);
  if (keys.length) {
    const value = (k: (typeof keys)[number]) => {
      const v = body[k];
      return typeof v === "boolean" ? (v ? 1 : 0) : (v as string | number | null);
    };
    await run(c.env.DB, `UPDATE lessons SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, ...keys.map(value), nowIso(), id);
  }
  await touched(c, existing.course_id);
  await audit(c, { action: "lesson.updated", entity: "lesson", entityId: id, meta: { fields: keys } });
  return ok(c, { lesson: await first(c.env.DB, "SELECT * FROM lessons WHERE id = ?", id) });
});

curriculum.delete("/lessons/:id", requirePerm("courses:write"), async (c) => {
  const id = intParam(c, "id");
  const lesson = await first<{ id: number; course_id: number; title_en: string }>(c.env.DB, "SELECT id, course_id, title_en FROM lessons WHERE id = ?", id);
  if (!lesson) throw notFound();
  const files = await all<{ r2_key: string }>(c.env.DB, "SELECT r2_key FROM lesson_resources WHERE lesson_id = ?", id);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM lesson_progress WHERE lesson_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM lesson_questions WHERE lesson_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM lesson_resources WHERE lesson_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM lessons WHERE id = ?").bind(id),
  ]);
  if (files.length) c.executionCtx.waitUntil(c.env.R2.delete(files.map((f) => f.r2_key)));
  await touched(c, lesson.course_id);
  await audit(c, { action: "lesson.deleted", entity: "lesson", entityId: id, summary: lesson.title_en });
  return ok(c);
});

/** Drag-and-drop persistence: the new module order and/or the lesson order inside each module (lessons can change module). */
curriculum.post("/courses/:id/reorder", requirePerm("courses:write"), async (c) => {
  const course = await requireCourse(c, intParam(c, "id"));
  const body = await parseBody(c, reorderSchema);
  const db = c.env.DB;
  const moduleIds = new Set((await all<{ id: number }>(db, "SELECT id FROM modules WHERE course_id = ?", course.id)).map((m) => m.id));
  const lessonIds = new Set((await all<{ id: number }>(db, "SELECT id FROM lessons WHERE course_id = ?", course.id)).map((l) => l.id));
  const statements: D1PreparedStatement[] = [];

  if (body.modules) {
    if (body.modules.some((id) => !moduleIds.has(id)) || new Set(body.modules).size !== body.modules.length) throw new HttpError(422, "validation", "validation", { modules: "invalid" });
    body.modules.forEach((id, i) => statements.push(db.prepare("UPDATE modules SET sort = ? WHERE id = ? AND course_id = ?").bind(i + 1, id, course.id)));
  }
  if (body.lessons) {
    const seen = new Set<number>();
    for (const group of body.lessons) {
      if (!moduleIds.has(group.module_id)) throw new HttpError(422, "validation", "validation", { lessons: "invalid" });
      group.ids.forEach((id, i) => {
        if (!lessonIds.has(id) || seen.has(id)) throw new HttpError(422, "validation", "validation", { lessons: "invalid" });
        seen.add(id);
        statements.push(db.prepare("UPDATE lessons SET sort = ?, module_id = ? WHERE id = ? AND course_id = ?").bind(i + 1, group.module_id, id, course.id));
      });
    }
  }
  if (statements.length) await db.batch(statements);
  await touched(c, course.id);
  await audit(c, { action: "curriculum.reordered", entity: "course", entityId: course.id, summary: course.title_en });
  return ok(c);
});

/* -------------------------------------------------------------------------------------------- resources */
/**
 * Raw-body upload (POST bytes, ?name=recipe.pdf): no multipart parsing, a hard size cap, magic-byte type check.
 * Files live under a private R2 prefix that the public /media route refuses to serve — students reach them only
 * through the authorised download endpoint.
 */
curriculum.post(
  "/lessons/:id/resources",
  requirePerm("courses:write"),
  bodyLimit({
    maxSize: MAX_UPLOAD_RESOURCE_BYTES + 4096,
    onError: () => {
      throw new HttpError(413, "file_too_large");
    },
  }),
  async (c) => {
    const lessonId = intParam(c, "id");
    const lesson = await first<{ id: number; course_id: number }>(c.env.DB, "SELECT id, course_id FROM lessons WHERE id = ?", lessonId);
    if (!lesson) throw notFound();
    const count = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM lesson_resources WHERE lesson_id = ?", lessonId);
    if ((count?.n ?? 0) >= MAX_RESOURCES_PER_LESSON) throw new HttpError(409, "too_many_files");

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) throw new HttpError(400, "empty_file");
    if (bytes.length > MAX_UPLOAD_RESOURCE_BYTES) throw new HttpError(413, "file_too_large");
    const filename = safeFilename(c.req.query("name") ?? "file");
    const kind = sniffResource(bytes, filename);
    if (!kind) throw new HttpError(415, "unsupported_file_type");

    const titles = z.object({ title_bn: textSchema(160), title_en: textSchema(160) }).safeParse({ title_bn: c.req.query("title_bn") ?? "", title_en: c.req.query("title_en") ?? "" });
    const key = `resources/${lesson.course_id}/${lessonId}/${randomToken(9)}.${kind.ext}`;
    await c.env.R2.put(key, bytes, { httpMetadata: { contentType: kind.mime }, customMetadata: { staff: String(c.get("staff")!.id) } });
    const res = await run(
      c.env.DB,
      "INSERT INTO lesson_resources (lesson_id, course_id, title_bn, title_en, r2_key, filename, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      lessonId,
      lesson.course_id,
      titles.success ? titles.data.title_bn : "",
      titles.success ? titles.data.title_en : "",
      key,
      filename,
      kind.mime,
      bytes.length,
      nowIso(),
    );
    const id = res.meta.last_row_id as number;
    await audit(c, { action: "resource.uploaded", entity: "resource", entityId: id, summary: filename, meta: { size: bytes.length, mime: kind.mime } });
    return ok(c, { resource: await first(c.env.DB, "SELECT id, lesson_id, title_bn, title_en, filename, mime, size_bytes FROM lesson_resources WHERE id = ?", id) }, 201);
  },
);

curriculum.get("/resources/:id/file", requirePerm("courses:read"), async (c) => {
  const row = await first<{ r2_key: string; filename: string; mime: string }>(c.env.DB, "SELECT r2_key, filename, mime FROM lesson_resources WHERE id = ?", intParam(c, "id"));
  if (!row) throw notFound();
  const obj = await c.env.R2.get(row.r2_key);
  if (!obj) throw notFound();
  const ascii = row.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

curriculum.delete("/resources/:id", requirePerm("courses:write"), async (c) => {
  const id = intParam(c, "id");
  const row = await first<{ r2_key: string; filename: string }>(c.env.DB, "SELECT r2_key, filename FROM lesson_resources WHERE id = ?", id);
  if (!row) throw notFound();
  await run(c.env.DB, "DELETE FROM lesson_resources WHERE id = ?", id);
  c.executionCtx.waitUntil(c.env.R2.delete(row.r2_key));
  await audit(c, { action: "resource.deleted", entity: "resource", entityId: id, summary: row.filename });
  return ok(c);
});

