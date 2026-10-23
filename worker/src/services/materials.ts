import { externalEmbed, MATERIAL_KINDS, type MaterialKind } from "@mawah/shared";
import type { Env } from "../env";
import { all, first, run } from "../lib/db";
import { driveReadable, driveRef, type DriveRef } from "../lib/drive";

/**
 * Class materials (Admin → Materials): files to download, links, live classes and private groups.
 *
 * What a STUDENT gets is a list without any address: a file is fetched through the authorised download endpoint, a link through
 * the "open" endpoint (both check the enrolment and are recorded). A video kept in Google Drive is neither: the website plays it itself,
 * inside the class page (lib/drive.ts), and its Drive address is never handed out. What a VISITOR gets on the public class page is only
 * what is included — a count per kind and the titles — never a link, a file name or a key.
 */

/** Hosts a Facebook group or profile link may have. */
const FACEBOOK_HOSTS = /^(www\.|m\.|web\.|mbasic\.|l\.)?(facebook\.com|fb\.com|fb\.me|fb\.watch)$/i;

/** Where the details of an upload wait between "uploaded" and "saved" (the browser's own words about the file are never trusted). */
export const uploadNoteKey = (key: string) => `matupload:${key}`;
export interface UploadNote {
  filename: string;
  mime: string;
  size: number;
  staff: number;
  course_id: number;
}

/** A link on facebook.com / fb.com / fb.me — for a group, or for a student's profile. Returns the cleaned address or null. */
export function facebookUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !FACEBOOK_HOSTS.test(u.hostname) || u.username || u.password) return null;
  // a profile or group has something after the slash: profile.php?id=…, a name, /groups/…, /people/…
  const hasTarget = u.pathname.replace(/\//g, "").length >= 2 || u.searchParams.has("id");
  return hasTarget ? u.toString().slice(0, 300) : null;
}

export interface StudentMaterial {
  id: number;
  kind: MaterialKind;
  title_bn: string;
  title_en: string;
  note_bn: string;
  note_en: string;
  /**
   * "file" = downloaded through the authorised endpoint; "link" = opened through the authorised "open" endpoint; "play" = a Google Drive video the
   * website plays itself, inside the class page (media_url); "pending" = a Google Drive video the website cannot play yet (not shared with its
   * Google account, a folder, not a video …) — said plainly, with no link: a student is never sent to the owner's Drive; "embed" = a video on
   * YouTube or Vimeo: it plays inside the class page, in that site's player (its address comes from "open", which records it), never in a new tab
   */
  delivery: "file" | "link" | "play" | "pending" | "embed";
  /** "play" only: where the player gets the video — for an enrolled student, checked on every request */
  media_url: string | null;
  filename: string | null;
  size_bytes: number | null;
  platform: string | null;
  starts_at: string | null;
  duration_min: number | null;
  ask_profile: boolean;
  /** private group only: this student's request to join, if they made one */
  request: { status: "pending" | "approved" | "rejected" } | null;
}

interface Row {
  id: number;
  kind: MaterialKind;
  title_bn: string;
  title_en: string;
  note_bn: string;
  note_en: string;
  r2_key: string | null;
  url: string | null;
  filename: string | null;
  size_bytes: number | null;
  platform: string | null;
  starts_at: string | null;
  duration_min: number | null;
  ask_profile: number;
  request_status: "pending" | "approved" | "rejected" | null;
}

/**
 * A Google Drive file or folder in a material's link (not a group's): the website plays it itself, or says it is being prepared — the address is
 * never handed to a student, who would only meet Drive's "You need permission" and see where the owner keeps the class videos. Google Docs and
 * every other address stay ordinary links.
 */
export function materialDrive(m: { kind: MaterialKind; url: string | null; r2_key: string | null }): Exclude<DriveRef, { kind: "other" }> | null {
  if (m.r2_key || !m.url || m.kind === "group") return null;
  const ref = driveRef(m.url);
  return ref && ref.kind !== "other" ? ref : null;
}

/** Everything that is switched on for a class, for a student who is enrolled in it (the caller checks that). */
export async function materialsForStudent(env: Env, studentId: number, courseId: number): Promise<StudentMaterial[]> {
  const rows = await all<Row>(
    env.DB,
    `SELECT m.id, m.kind, m.title_bn, m.title_en, m.note_bn, m.note_en, m.r2_key, m.url, m.filename, m.size_bytes, m.platform, m.starts_at,
            m.duration_min, m.ask_profile, g.status AS request_status
       FROM materials m
       LEFT JOIN group_requests g ON g.material_id = m.id AND g.student_id = ?
      WHERE m.course_id = ? AND m.active = 1 AND m.deleted_at IS NULL
      ORDER BY m.sort, m.id`,
    studentId,
    courseId,
  );
  // whether the website can play each Drive video (remembered a few minutes, so a page that opens again does not ask Google again)
  const playable = await Promise.all(
    rows.map(async (r) => {
      const drive = materialDrive(r);
      return drive ? drive.kind === "file" && (await driveReadable(env, drive.id)) : null;
    }),
  );
  return rows.map((r, i) => ({
    id: r.id,
    kind: r.kind,
    title_bn: r.title_bn,
    title_en: r.title_en,
    note_bn: r.note_bn,
    note_en: r.note_en,
    delivery: r.r2_key ? "file" : playable[i] !== null ? (playable[i] ? "play" : "pending") : r.kind === "video" && r.url && externalEmbed(r.url) ? "embed" : "link",
    media_url: playable[i] ? `/api/student/materials/${r.id}/media` : null,
    filename: r.r2_key ? r.filename : null,
    size_bytes: r.r2_key ? r.size_bytes : null,
    platform: r.platform,
    starts_at: r.starts_at,
    duration_min: r.duration_min,
    ask_profile: !!r.ask_profile,
    request: r.kind === "group" && r.request_status ? { status: r.request_status } : null,
  }));
}

/** One material the student may use right now: it exists, is switched on, and they are enrolled in its class. */
export interface UsableMaterial {
  id: number;
  course_id: number;
  kind: MaterialKind;
  r2_key: string | null;
  filename: string | null;
  mime: string | null;
  url: string | null;
  ask_profile: number;
  platform: string | null;
}
export async function usableMaterial(env: Env, materialId: number, studentId: number): Promise<UsableMaterial | null> {
  return first<UsableMaterial>(
    env.DB,
    `SELECT m.id, m.course_id, m.kind, m.r2_key, m.filename, m.mime, m.url, m.ask_profile, m.platform
       FROM materials m
       JOIN enrollments e ON e.course_id = m.course_id AND e.student_id = ? AND e.status = 'active'
      WHERE m.id = ? AND m.active = 1 AND m.deleted_at IS NULL`,
    studentId,
    materialId,
  );
}

export async function recordUse(env: Env, m: { id: number; course_id: number }, studentId: number, action: "download" | "open") {
  await run(env.DB, "INSERT INTO material_downloads (material_id, course_id, student_id, action) VALUES (?, ?, ?, ?)", m.id, m.course_id, studentId, action);
}

/** What a class includes, for its public page: a count per kind and the titles. Nothing that could be used (no link, no file). */
export interface Included {
  counts: Partial<Record<MaterialKind, number>>;
  titles: { kind: MaterialKind; title_bn: string; title_en: string }[];
  total: number;
}
export async function includedIn(env: Env, courseId: number): Promise<Included> {
  const rows = await all<{ kind: MaterialKind; title_bn: string; title_en: string }>(
    env.DB,
    "SELECT kind, title_bn, title_en FROM materials WHERE course_id = ? AND active = 1 AND deleted_at IS NULL ORDER BY sort, id LIMIT 60",
    courseId,
  );
  const counts: Partial<Record<MaterialKind, number>> = {};
  for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  return { counts, titles: rows.slice(0, 12), total: rows.length };
}

/** A file somebody uploaded but never attached to a material is removed after this long. */
const ORPHAN_AFTER_MS = 2 * 86400 * 1000;

/**
 * Housekeeping: an upload that was never saved into a material (the owner closed the form) would sit in the bucket forever.
 * Files under materials/ that no material points to, and that are older than two days, are deleted.
 */
export async function cleanupOrphanUploads(env: Env, now = Date.now()): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await env.R2.list({ prefix: "materials/", cursor, limit: 500 });
    const old = page.objects.filter((o) => now - o.uploaded.getTime() > ORPHAN_AFTER_MS);
    // D1 allows ~100 bound values per statement: check the keys in small groups
    for (let i = 0; i < old.length; i += 80) {
      const group = old.slice(i, i + 80);
      const used = new Set(
        (await all<{ r2_key: string }>(env.DB, `SELECT r2_key FROM materials WHERE r2_key IN (${group.map(() => "?").join(",")})`, ...group.map((o) => o.key))).map((r) => r.r2_key),
      );
      for (const o of group) {
        if (used.has(o.key)) continue;
        await env.R2.delete(o.key);
        await env.KV.delete(uploadNoteKey(o.key));
        deleted++;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

export const isMaterialKind = (v: unknown): v is MaterialKind => (MATERIAL_KINDS as readonly unknown[]).includes(v);
