import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { all, first } from "../../../lib/db";
import { driveRef } from "../../../lib/drive";
import { HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { bumpContentVersion } from "../../../lib/settings";
import { requirePerm } from "../../../middleware/auth";
import { refreshCourseStats } from "../../../services/catalog";
import { abortVideoUpload, finishVideoUpload, putVideoPart, r2VideoMedia, removeLessonVideo, startVideoUpload } from "../../../services/lessonVideos";

/*
 * A lesson's video in the website's own storage (services/lessonVideos.ts). The admin's browser makes the video smaller first, then sends it
 * here in parts: start → each part → finish (or cancel). Admin → Video speed lists the Google Drive lessons and moves them over the same way.
 */
export const lessonVideosAdmin = new Hono<AppEnv>();

/** An upload id is R2's own, long and opaque: anything odd is refused before it reaches storage. */
const uploadParam = (c: { req: { param: (k: "upload") => string } }) => {
  const v = c.req.param("upload");
  if (!/^[A-Za-z0-9._~+/=-]{8,1024}$/.test(v)) throw new HttpError(400, "bad_request");
  return v;
};

const startSchema = z.object({ size: z.number().int().positive() });
const finishSchema = z.object({
  parts: z.array(z.object({ n: z.number().int().min(1).max(10000), etag: z.string().min(1).max(200) })).min(1).max(10000),
  duration_sec: z.number().min(0).max(86400).nullable().optional(),
});

lessonVideosAdmin.post("/lessons/:id/video-uploads", requirePerm("courses:write"), async (c) => {
  const body = await parseBody(c, startSchema);
  return ok(c, await startVideoUpload(c.env, intParam(c, "id"), body.size, c.get("staff")!.id), 201);
});

/** One part's bytes (the body), streamed into storage: it must be exactly the length that part has to be. */
lessonVideosAdmin.put("/video-uploads/:upload/parts/:n", requirePerm("courses:write"), async (c) => {
  const announced = Number(c.req.header("content-length") ?? NaN);
  return ok(c, await putVideoPart(c.env, uploadParam(c), Number(c.req.param("n")), c.req.raw.body, announced));
});

lessonVideosAdmin.post("/video-uploads/:upload/complete", requirePerm("courses:write"), async (c) => {
  const body = await parseBody(c, finishSchema);
  const done = await finishVideoUpload(c.env, uploadParam(c), body.parts, body.duration_sec ?? null);
  await refreshCourseStats(c.env, done.course_id);
  await bumpContentVersion(c.env);
  await audit(c, { action: "lesson.video_uploaded", entity: "lesson", entityId: done.lesson_id, meta: { bytes: done.video_bytes } });
  return ok(c, done);
});

lessonVideosAdmin.delete("/video-uploads/:upload", requirePerm("courses:write"), async (c) => {
  await abortVideoUpload(c.env, uploadParam(c));
  return ok(c);
});

/** Takes the lesson's copy off our storage: it plays its link again. */
lessonVideosAdmin.delete("/lessons/:id/video", requirePerm("courses:write"), async (c) => {
  const id = intParam(c, "id");
  const gone = await removeLessonVideo(c.env, id);
  if (gone) {
    await bumpContentVersion(c.env);
    await audit(c, { action: "lesson.video_removed", entity: "lesson", entityId: id });
  }
  return ok(c);
});

/** "Play here": the owner watches the lesson's copy inside the admin, exactly as a student gets it. */
lessonVideosAdmin.get("/lessons/:id/video/media", requirePerm("courses:read"), async (c) => {
  const lesson = await first<{ video_key: string | null }>(c.env.DB, "SELECT video_key FROM lessons WHERE id = ?", intParam(c, "id"));
  if (!lesson?.video_key) throw notFound();
  return r2VideoMedia(c.env, lesson.video_key, c.req.header("range") ?? null);
});

export interface StoredLesson {
  id: number;
  course_id: number;
  course_bn: string;
  course_en: string;
  title_bn: string;
  title_en: string;
  /** the lesson's Google Drive link, when its video is (or was) a Drive file: the admin's browser reads it through /api/admin/drive/media */
  drive_url: string | null;
  /** in our storage: its size (0 when not) */
  video_bytes: number;
  stored: boolean;
  duration_sec: number;
}

/**
 * Admin → Video speed, "Our storage": every video or link lesson that is in our storage or could be (its link is a Google Drive file), with
 * what our storage holds in all.
 */
lessonVideosAdmin.get("/video-storage", requirePerm("courses:read"), async (c) => {
  const rows = await all<{ id: number; course_id: number; course_bn: string; course_en: string; title_bn: string; title_en: string; external_url: string | null; video_key: string | null; video_bytes: number; duration_sec: number }>(
    c.env.DB,
    `SELECT l.id, l.course_id, c.title_bn AS course_bn, c.title_en AS course_en, l.title_bn, l.title_en, l.external_url, l.video_key, l.video_bytes, l.duration_sec
     FROM lessons l JOIN courses c ON c.id = l.course_id
     WHERE c.deleted_at IS NULL AND l.type IN ('video','external') AND (l.video_key IS NOT NULL OR l.external_url IS NOT NULL)
     ORDER BY c.sort, c.id, l.sort, l.id`,
  );
  const lessons: StoredLesson[] = [];
  for (const r of rows) {
    const drive = r.external_url ? driveRef(r.external_url) : null;
    const driveUrl = drive?.kind === "file" ? r.external_url : null;
    if (!r.video_key && !driveUrl) continue;
    lessons.push({ id: r.id, course_id: r.course_id, course_bn: r.course_bn, course_en: r.course_en, title_bn: r.title_bn, title_en: r.title_en, drive_url: driveUrl, video_bytes: r.video_key ? r.video_bytes : 0, stored: !!r.video_key, duration_sec: r.duration_sec });
  }
  const stored = lessons.filter((l) => l.stored);
  return ok(c, { lessons, stored: stored.length, bytes: stored.reduce((s, l) => s + l.video_bytes, 0) });
});
