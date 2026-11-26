import { LESSON_VIDEO_PART_BYTES, MAX_LESSON_VIDEO_BYTES } from "@mawah/shared";
import type { Env } from "../env";
import { randomToken } from "../lib/crypto";
import { all, first, nowIso, run } from "../lib/db";
import { parseRange } from "../lib/drive";
import { HttpError, notFound } from "../lib/http";

/*
 * Lesson videos in the website's own storage (Cloudflare R2). The owner's browser makes a video smaller (720p, about 2 Mbit/s — see
 * admin/src/lib/lessonVideo.ts) and sends it here in parts of LESSON_VIDEO_PART_BYTES; R2 joins them into one MP4 whose index is at its
 * start, so a player starts at once and jumps anywhere. A student's player then asks for it through the lesson's own address
 * (/api/student/lessons/<id>/media — the one a Drive video already used, so the website and the Android app play it unchanged), which
 * checks that this person may watch the lesson and hands on the part of the file asked for. Storage costs about 2 taka a GB a month after
 * the first 10 GB, and handing it to students costs nothing.
 */

export interface VideoUploadRow {
  upload_id: string;
  r2_key: string;
  lesson_id: number;
  size_bytes: number;
  part_bytes: number;
}

const partsOf = (u: Pick<VideoUploadRow, "size_bytes" | "part_bytes">) => Math.ceil(u.size_bytes / u.part_bytes);
/** How long part n (1-based) must be: every part is the same size but the last (R2 needs that). */
export const partLength = (u: Pick<VideoUploadRow, "size_bytes" | "part_bytes">, n: number) => (n < partsOf(u) ? u.part_bytes : u.size_bytes - u.part_bytes * (partsOf(u) - 1));

/** The lessons a video can belong to: a video or a link lesson, of a class that still exists. */
async function videoLesson(env: Env, lessonId: number) {
  const lesson = await first<{ id: number; course_id: number; type: string; video_key: string | null; duration_sec: number }>(
    env.DB,
    "SELECT l.id, l.course_id, l.type, l.video_key, l.duration_sec FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND c.deleted_at IS NULL",
    lessonId,
  );
  if (!lesson) throw notFound();
  if (lesson.type !== "video" && lesson.type !== "external") throw new HttpError(422, "lesson_not_video");
  return lesson;
}

/** Starts an upload of `size` bytes for a lesson: the storage key is made here, never taken from the browser. */
export async function startVideoUpload(env: Env, lessonId: number, size: number, staffId: number | null): Promise<{ upload_id: string; part_bytes: number; parts: number }> {
  await videoLesson(env, lessonId);
  if (!Number.isInteger(size) || size <= 0) throw new HttpError(422, "validation", "validation", { size: "invalid" });
  if (size > MAX_LESSON_VIDEO_BYTES) throw new HttpError(413, "file_too_large");
  const key = `videos/lesson-${lessonId}/${randomToken(12)}.mp4`;
  const mpu = await env.R2.createMultipartUpload(key, { httpMetadata: { contentType: "video/mp4" }, customMetadata: { lesson: String(lessonId), staff: String(staffId ?? "") } });
  await run(
    env.DB,
    "INSERT INTO video_uploads (upload_id, r2_key, lesson_id, size_bytes, part_bytes, staff_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    mpu.uploadId,
    key,
    lessonId,
    size,
    LESSON_VIDEO_PART_BYTES,
    staffId,
    nowIso(),
  );
  return { upload_id: mpu.uploadId, part_bytes: LESSON_VIDEO_PART_BYTES, parts: partsOf({ size_bytes: size, part_bytes: LESSON_VIDEO_PART_BYTES }) };
}

async function uploadRow(env: Env, uploadId: string): Promise<VideoUploadRow> {
  const row = await first<VideoUploadRow>(env.DB, "SELECT upload_id, r2_key, lesson_id, size_bytes, part_bytes FROM video_uploads WHERE upload_id = ?", uploadId);
  if (!row) throw notFound();
  return row;
}

/**
 * One part of an upload, streamed straight into storage. It must be exactly as long as that part has to be (the browser says how long it
 * is), so a part cut short by a dropped connection is refused here rather than spoiling the video; the browser then sends it again.
 */
export async function putVideoPart(env: Env, uploadId: string, n: number, body: ReadableStream | null, announced: number): Promise<{ etag: string }> {
  const u = await uploadRow(env, uploadId);
  if (!Number.isInteger(n) || n < 1 || n > partsOf(u)) throw new HttpError(422, "validation", "validation", { part: "invalid" });
  if (!body || announced !== partLength(u, n)) throw new HttpError(422, "validation", "validation", { part: "wrong_length" });
  try {
    const part = await env.R2.resumeMultipartUpload(u.r2_key, u.upload_id).uploadPart(n, body);
    return { etag: part.etag };
  } catch (err) {
    console.warn("video_part_failed", err instanceof Error ? err.message : String(err));
    throw new HttpError(502, "upload_failed");
  }
}

/**
 * Joins the parts into the video and gives it to the lesson. The lesson's earlier copy (if any) is deleted; its link (Drive, YouTube,
 * Stream) stays, so taking this copy off later plays that again. The length the browser read from the video fills the lesson's minutes
 * when the owner has not set them.
 */
export async function finishVideoUpload(env: Env, uploadId: string, parts: { n: number; etag: string }[], durationSec: number | null) {
  const u = await uploadRow(env, uploadId);
  const count = partsOf(u);
  const sorted = [...parts].sort((a, b) => a.n - b.n);
  if (sorted.length !== count || sorted.some((p, i) => p.n !== i + 1)) throw new HttpError(422, "validation", "validation", { parts: "incomplete" });
  const lesson = await videoLesson(env, u.lesson_id);
  try {
    await env.R2.resumeMultipartUpload(u.r2_key, u.upload_id).complete(sorted.map((p) => ({ partNumber: p.n, etag: p.etag })));
  } catch (err) {
    console.warn("video_complete_failed", err instanceof Error ? err.message : String(err));
    throw new HttpError(502, "upload_failed");
  }
  const stored = await env.R2.head(u.r2_key);
  if (!stored || stored.size !== u.size_bytes) {
    await env.R2.delete(u.r2_key);
    await run(env.DB, "DELETE FROM video_uploads WHERE upload_id = ?", uploadId);
    throw new HttpError(422, "upload_incomplete");
  }
  const minutes = durationSec && durationSec > 0 && durationSec < 86400 ? Math.round(durationSec) : null;
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE lessons SET video_key = ?, video_bytes = ?, duration_sec = CASE WHEN duration_sec > 0 OR ? IS NULL THEN duration_sec ELSE ? END, updated_at = ? WHERE id = ?",
    ).bind(u.r2_key, stored.size, minutes, minutes, nowIso(), u.lesson_id),
    env.DB.prepare("DELETE FROM video_uploads WHERE upload_id = ?").bind(uploadId),
  ]);
  if (lesson.video_key && lesson.video_key !== u.r2_key) await env.R2.delete(lesson.video_key);
  return { lesson_id: u.lesson_id, course_id: lesson.course_id, video_key: u.r2_key, video_bytes: stored.size };
}

/** Gives up an upload (the owner pressed Cancel, or picked another file): its parts are dropped. */
export async function abortVideoUpload(env: Env, uploadId: string): Promise<void> {
  const u = await uploadRow(env, uploadId);
  await env.R2.resumeMultipartUpload(u.r2_key, u.upload_id)
    .abort()
    .catch(() => undefined);
  await run(env.DB, "DELETE FROM video_uploads WHERE upload_id = ?", uploadId);
}

/** Takes a lesson's copy off our storage: the lesson plays its link again (or says it has no video). */
export async function removeLessonVideo(env: Env, lessonId: number): Promise<{ course_id: number } | null> {
  const lesson = await first<{ course_id: number; video_key: string | null }>(env.DB, "SELECT course_id, video_key FROM lessons WHERE id = ?", lessonId);
  if (!lesson) throw notFound();
  if (!lesson.video_key) return null;
  await run(env.DB, "UPDATE lessons SET video_key = NULL, video_bytes = 0, updated_at = ? WHERE id = ?", nowIso(), lessonId);
  await env.R2.delete(lesson.video_key);
  return { course_id: lesson.course_id };
}

/** Everything a deleted lesson kept in our storage: its video and any upload still open. */
export async function forgetLessonVideos(env: Env, lessonId: number): Promise<string[]> {
  const [lesson, open] = await Promise.all([
    first<{ video_key: string | null }>(env.DB, "SELECT video_key FROM lessons WHERE id = ?", lessonId),
    all<VideoUploadRow>(env.DB, "SELECT upload_id, r2_key FROM video_uploads WHERE lesson_id = ?", lessonId),
  ]);
  for (const u of open) await env.R2.resumeMultipartUpload(u.r2_key, u.upload_id).abort().catch(() => undefined);
  return lesson?.video_key ? [lesson.video_key] : [];
}

/** The part of the address that changes with each new copy ("…/media?v=<it>"), so a player never mixes an old copy's bytes with a new one's. */
export const videoVersion = (key: string) => /\/([A-Za-z0-9_-]+)\.mp4$/.exec(key)?.[1] ?? "1";

/**
 * The video for a player, from our storage: the whole file, or the part asked for (playing at once, jumping around). The caller has
 * already checked that this person may watch it. A copy is never changed in place (a new one gets a new key and a new ?v=), so the
 * phone may keep what it fetched.
 */
export async function r2VideoMedia(env: Env, key: string, rangeHeader: string | null, contentType = "video/mp4"): Promise<Response> {
  const parsed = parseRange(rangeHeader);
  const refuse = (size: number | null) => new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size ?? "*"}`, "Cache-Control": "private, no-store" } });
  if (!parsed.ok) return refuse(null);
  const size = (await env.R2.head(key))?.size;
  if (size === undefined) throw new HttpError(404, "video_unavailable");
  // the part asked for: "bytes=a-b", "bytes=a-" (to the end) or "bytes=-n" (the last n); one that runs past the end is cut at it
  let want: { start: number; end: number } | null = null;
  const m = parsed.range ? /^bytes=(\d*)-(\d*)$/.exec(parsed.range) : null;
  if (m) {
    const a = m[1] === "" ? null : Number(m[1]);
    const b = m[2] === "" ? null : Number(m[2]);
    if (a === null) {
      if (!b) return refuse(size);
      want = { start: Math.max(0, size - b), end: size - 1 };
    } else {
      if (a >= size) return refuse(size);
      want = { start: a, end: b === null ? size - 1 : Math.min(b, size - 1) };
    }
  }
  const obj = await env.R2.get(key, want ? { range: { offset: want.start, length: want.end - want.start + 1 } } : {});
  if (!obj || !("body" in obj)) throw new HttpError(404, "video_unavailable");
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    ETag: obj.httpEtag,
  });
  if (!want) {
    headers.set("Content-Length", String(size));
    return new Response(obj.body, { status: 200, headers });
  }
  headers.set("Content-Range", `bytes ${want.start}-${want.end}/${size}`);
  headers.set("Content-Length", String(want.end - want.start + 1));
  return new Response(obj.body, { status: 206, headers });
}
