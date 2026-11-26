import { LESSON_VIDEO_PART_BYTES, MAX_LESSON_VIDEO_BYTES } from "@mawah/shared";
import type { Env } from "../env";
import { randomToken } from "../lib/crypto";
import { first, nowIso, run } from "../lib/db";
import { safeFilename, sniffMaterial } from "../lib/files";
import { HttpError, notFound } from "../lib/http";
import { partLength } from "./lessonVideos";
import { uploadNoteKey, type UploadNote } from "./materials";

/*
 * A class material's video sent in parts (Admin → Materials → a video file): R2 joins the parts into one file, as for a lesson's video
 * (services/lessonVideos.ts), so a long recording is not held to the 95 MB one request can carry. Once joined, its first bytes say what it
 * really is (only MP4, MOV or WebM video is kept), and it waits — like a file sent in one piece — for the owner to save the material
 * (the same upload note, read by routes/api/admin/materials.ts).
 */

interface MaterialUploadRow {
  upload_id: string;
  r2_key: string;
  course_id: number;
  size_bytes: number;
  part_bytes: number;
  filename: string;
  staff_id: number | null;
}

const partsOf = (u: Pick<MaterialUploadRow, "size_bytes" | "part_bytes">) => Math.ceil(u.size_bytes / u.part_bytes);

export async function startMaterialUpload(env: Env, courseId: number, size: number, name: string, staffId: number) {
  if (!(await first(env.DB, "SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL", courseId))) throw notFound();
  if (!Number.isInteger(size) || size <= 0) throw new HttpError(422, "validation", "validation", { size: "invalid" });
  if (size > MAX_LESSON_VIDEO_BYTES) throw new HttpError(413, "file_too_large");
  const key = `materials/${courseId}/${randomToken(18)}`;
  const mpu = await env.R2.createMultipartUpload(key, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { staff: String(staffId) } });
  await run(
    env.DB,
    "INSERT INTO material_uploads (upload_id, r2_key, course_id, size_bytes, part_bytes, filename, staff_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    mpu.uploadId,
    key,
    courseId,
    size,
    LESSON_VIDEO_PART_BYTES,
    safeFilename(name, "video"),
    staffId,
    nowIso(),
  );
  return { upload_id: mpu.uploadId, part_bytes: LESSON_VIDEO_PART_BYTES, parts: partsOf({ size_bytes: size, part_bytes: LESSON_VIDEO_PART_BYTES }) };
}

/** An upload belongs to the person who started it. */
async function uploadRow(env: Env, uploadId: string, staffId: number): Promise<MaterialUploadRow> {
  const row = await first<MaterialUploadRow>(env.DB, "SELECT upload_id, r2_key, course_id, size_bytes, part_bytes, filename, staff_id FROM material_uploads WHERE upload_id = ?", uploadId);
  if (!row || row.staff_id !== staffId) throw notFound();
  return row;
}

export async function putMaterialPart(env: Env, uploadId: string, staffId: number, n: number, body: ReadableStream | null, announced: number): Promise<{ etag: string }> {
  const u = await uploadRow(env, uploadId, staffId);
  if (!Number.isInteger(n) || n < 1 || n > partsOf(u)) throw new HttpError(422, "validation", "validation", { part: "invalid" });
  if (!body || announced !== partLength(u, n)) throw new HttpError(422, "validation", "validation", { part: "wrong_length" });
  try {
    const part = await env.R2.resumeMultipartUpload(u.r2_key, u.upload_id).uploadPart(n, body);
    return { etag: part.etag };
  } catch (err) {
    console.warn("material_part_failed", err instanceof Error ? err.message : String(err));
    throw new HttpError(502, "upload_failed");
  }
}

/** Joins the parts, keeps the file only if it is a video, and leaves the note the material's save reads. */
export async function finishMaterialUpload(env: Env, uploadId: string, staffId: number, parts: { n: number; etag: string }[]) {
  const u = await uploadRow(env, uploadId, staffId);
  const sorted = [...parts].sort((a, b) => a.n - b.n);
  if (sorted.length !== partsOf(u) || sorted.some((p, i) => p.n !== i + 1)) throw new HttpError(422, "validation", "validation", { parts: "incomplete" });
  try {
    await env.R2.resumeMultipartUpload(u.r2_key, u.upload_id).complete(sorted.map((p) => ({ partNumber: p.n, etag: p.etag })));
  } catch (err) {
    console.warn("material_complete_failed", err instanceof Error ? err.message : String(err));
    throw new HttpError(502, "upload_failed");
  }
  await run(env.DB, "DELETE FROM material_uploads WHERE upload_id = ?", uploadId);
  const [head, stored] = await Promise.all([env.R2.get(u.r2_key, { range: { offset: 0, length: 4096 } }), env.R2.head(u.r2_key)]);
  const sniffed = head ? sniffMaterial(new Uint8Array(await head.arrayBuffer()), u.filename) : null;
  if (!sniffed || !sniffed.mime.startsWith("video/") || !stored || stored.size !== u.size_bytes) {
    await env.R2.delete(u.r2_key);
    throw new HttpError(415, "unsupported_file_type");
  }
  const stem = u.filename.replace(/\.[^./]*$/, "") || "video";
  const note: UploadNote = { filename: `${stem}.${sniffed.ext}`.slice(0, 120), mime: sniffed.mime, size: stored.size, staff: staffId, course_id: u.course_id };
  await env.KV.put(uploadNoteKey(u.r2_key), JSON.stringify(note), { expirationTtl: 3 * 86400 });
  return { key: u.r2_key, filename: note.filename, mime: note.mime, size_bytes: note.size };
}

export async function abortMaterialUpload(env: Env, uploadId: string, staffId: number): Promise<void> {
  const u = await uploadRow(env, uploadId, staffId);
  await env.R2.resumeMultipartUpload(u.r2_key, u.upload_id)
    .abort()
    .catch(() => undefined);
  await run(env.DB, "DELETE FROM material_uploads WHERE upload_id = ?", uploadId);
}
