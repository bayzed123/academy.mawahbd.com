import { Hono } from "hono";
import { z } from "zod";
import { GROUP_PLATFORMS, LIVE_PLATFORMS, MATERIAL_KINDS, MAX_UPLOAD_MATERIAL_BYTES, type MaterialKind } from "@mawah/shared";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { randomToken } from "../../../lib/crypto";
import { csvResponse, toCsv } from "../../../lib/csv";
import { crudRoutes, type ResourceDef } from "../../../lib/crud";
import { all, first, likeEscape, nowIso, pageInfo, pageParams, qs, run } from "../../../lib/db";
import { safeFilename, sniffMaterial } from "../../../lib/files";
import { HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { textSchema } from "../../../lib/schemas";
import { requirePerm } from "../../../middleware/auth";
import { rateLimit } from "../../../middleware/ratelimit";
import { facebookUrl, uploadNoteKey, type UploadNote } from "../../../services/materials";

/**
 * Admin → Materials: what a class gives its students beyond the lessons — files to download (video, PDF, ZIP, book), a live class
 * (link and time), a plain link, a private group. Files live in the PRIVATE bucket under materials/ (the public /media route never
 * serves that folder); students reach them only through the enrolment-checked download endpoint.
 *
 * Saving a file-based material is two steps, like the picture fields elsewhere: the upload (below) stores the bytes and returns a
 * key; the form then saves the key. What the browser says about the file (its name, its type, its size) is never believed — the
 * upload records what it measured and sniffed, and the save reads that record.
 */

const SIZE_CAP_NO_LENGTH = 25 * 1024 * 1024; // a request that does not say how long it is is read into memory: keep that small

/** An https address with a host, no password in it. Empty becomes null. */
const httpsUrl = z
  .string()
  .trim()
  .max(600, "too_long")
  .refine((v) => v === "" || (/^https:\/\/[^\s/@]+(?::\d+)?(?:[/?#]\S*)?$/i.test(v) && !/^https:\/\/[^/]*@/.test(v)), "invalid_url")
  .transform((v) => (v === "" ? null : v))
  .nullable();

const schema = z.object({
  course_id: z.number().int().positive(),
  kind: z.enum(MATERIAL_KINDS),
  title_bn: textSchema(160),
  title_en: textSchema(160),
  note_bn: textSchema(300),
  note_en: textSchema(300),
  r2_key: z
    .string()
    .regex(/^materials\/\d+\/[A-Za-z0-9_-]{16,64}$/, "invalid")
    .nullable(),
  url: httpsUrl,
  platform: z.string().trim().max(20).nullable(),
  starts_at: z.string().trim().max(40).nullable(),
  duration_min: z.number().int().min(5).max(720).nullable(),
  active: z.boolean(),
  sort: z.number().int().min(0).max(99999),
});

const ZIP_FAMILY = ["application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"];
/** Which kinds of file each kind of material may be. */
const FILE_OK: Partial<Record<MaterialKind, (mime: string) => boolean>> = {
  pdf: (m) => m === "application/pdf",
  zip: (m) => ZIP_FAMILY.includes(m),
  book: (m) => m === "application/pdf" || m === "application/epub+zip",
  video: (m) => m.startsWith("video/"),
};
/** Hosts a private group's address may have, per platform. */
const GROUP_HOSTS: Record<string, RegExp> = {
  whatsapp: /^(chat\.whatsapp\.com|wa\.me|whatsapp\.com)$/i,
  telegram: /^(t\.me|telegram\.me|telegram\.dog)$/i,
};

const bad = (field: string, code: string) => new HttpError(422, "validation", "validation", { [field]: code });

const crud = crudRoutes({
  name: "materials",
  table: "materials",
  perms: { read: "materials:read", write: "materials:write" },
  schema,
  searchCols: ["title_bn", "title_en", "note_bn", "note_en", "filename", "url"],
  sortCols: ["id", "sort", "kind", "course_id", "created_at", "updated_at", "size_bytes"],
  defaultSort: "-id",
  filters: { course_id: "course_id", kind: "kind", active: "active" },
  softDelete: true,
  publicContent: true, // the public class page lists what is included
  serverColumns: ["filename", "mime", "size_bytes", "ask_profile"],
  label: (r) => String(r.title_en || r.title_bn || `#${r.id}`),
  async beforeSave(c, data, existing) {
    const get = (k: string) => (k in data ? data[k] : existing?.[k]);
    const staff = c.get("staff")!;

    const courseId = get("course_id") as number;
    if ("course_id" in data) {
      const found = await first(c.env.DB, "SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL", courseId);
      if (!found) throw bad("course_id", "invalid_id");
    }
    if (!String(get("title_bn") ?? "").trim() && !String(get("title_en") ?? "").trim()) throw bad("title_en", "required");

    const kind = get("kind") as MaterialKind;
    const url = (get("url") as string | null) ?? null;
    let key = (get("r2_key") as string | null) ?? null;

    if (kind === "link" || kind === "live" || kind === "group") {
      // these are always an address
      if (!url) throw bad("url", "required");
      data.r2_key = null;
      data.filename = data.mime = data.size_bytes = null;
      key = null;
    } else if (url && key) {
      throw bad("url", "choose_one"); // a file or a link, not both
    } else if (!url && !key) {
      throw bad("r2_key", "required");
    }

    // a file: it must be one this person just uploaded (or the one already saved), and the right kind of file for this material
    if (FILE_OK[kind] && key) {
      if (!existing || key !== existing.r2_key) {
        const note = await c.env.KV.get<UploadNote>(uploadNoteKey(key), "json");
        if (!note || note.staff !== staff.id || note.course_id !== courseId) throw bad("r2_key", "upload_expired");
        if (!FILE_OK[kind]!(note.mime)) throw bad("r2_key", "wrong_file_type");
        data.filename = note.filename;
        data.mime = note.mime;
        data.size_bytes = note.size;
      } else if (!FILE_OK[kind]!(String(existing.mime ?? ""))) {
        throw bad("r2_key", "wrong_file_type"); // the kind was changed to one this file does not fit
      }
    }
    if (FILE_OK[kind] && url) {
      data.r2_key = null;
      data.filename = data.mime = data.size_bytes = null;
    }

    // live class: where and when
    if (kind === "live") {
      const when = String(get("starts_at") ?? "");
      if (!when || Number.isNaN(Date.parse(when))) throw bad("starts_at", "required");
      data.starts_at = new Date(when).toISOString();
      const platform = String(get("platform") ?? "other");
      if (!(LIVE_PLATFORMS as readonly string[]).includes(platform)) throw bad("platform", "invalid");
      data.platform = platform;
    } else if (kind !== "group") {
      data.starts_at = null;
      data.duration_min = null;
      data.platform = null;
    }
    if (kind !== "live") data.duration_min = null;

    // private group: the platform, an address that really is on that platform, and the profile question for Facebook
    if (kind === "group") {
      const platform = String(get("platform") ?? "facebook");
      if (!(GROUP_PLATFORMS as readonly string[]).includes(platform)) throw bad("platform", "invalid");
      data.platform = platform;
      data.starts_at = null;
      if (platform === "facebook") {
        const fb = facebookUrl(url ?? "");
        if (!fb) throw bad("url", "must_be_facebook");
        data.url = fb;
      } else if (platform in GROUP_HOSTS) {
        const host = (() => {
          try {
            return new URL(url ?? "").hostname;
          } catch {
            return "";
          }
        })();
        if (!GROUP_HOSTS[platform].test(host)) throw bad("url", platform === "whatsapp" ? "must_be_whatsapp" : "must_be_telegram");
      }
      // Facebook private groups are joined by approval: the student sends their profile link first, so the owner can find them
      data.ask_profile = platform === "facebook" ? 1 : 0;
    } else {
      data.ask_profile = 0;
    }
    return data;
  },
  /** A replaced or removed file is deleted from the bucket; the note about a saved upload is no longer needed. */
  async afterSave(c, row, _data, _kind, existing) {
    const key = row.r2_key as string | null;
    if (existing?.r2_key && existing.r2_key !== key) c.executionCtx.waitUntil(c.env.R2.delete(String(existing.r2_key)));
    if (key) c.executionCtx.waitUntil(c.env.KV.delete(uploadNoteKey(key)));
  },
  /** The list shows which class, how many times it was fetched, and for groups how many are waiting for an answer. */
  async decorate(c, rows) {
    if (!rows.length) return rows;
    const ids = rows.map((r) => r.id);
    const courseIds = [...new Set(rows.map((r) => r.course_id as number))];
    const [courses, downloads, pending] = await Promise.all([
      all<{ id: number; title_bn: string; title_en: string }>(c.env.DB, `SELECT id, title_bn, title_en FROM courses WHERE id IN (${qs(courseIds.length)})`, ...courseIds),
      all<{ material_id: number; n: number }>(c.env.DB, `SELECT material_id, COUNT(*) AS n FROM material_downloads WHERE material_id IN (${qs(ids.length)}) GROUP BY material_id`, ...ids),
      all<{ material_id: number; n: number }>(c.env.DB, `SELECT material_id, COUNT(*) AS n FROM group_requests WHERE status = 'pending' AND material_id IN (${qs(ids.length)}) GROUP BY material_id`, ...ids),
    ]);
    return rows.map((r) => {
      const course = courses.find((x) => x.id === r.course_id);
      return {
        ...r,
        course_title_bn: course?.title_bn ?? "",
        course_title_en: course?.title_en ?? "",
        downloads: downloads.find((x) => x.material_id === r.id)?.n ?? 0,
        pending_requests: pending.find((x) => x.material_id === r.id)?.n ?? 0,
      };
    });
  },
} satisfies ResourceDef<typeof schema>);

export const materials = new Hono<AppEnv>();

/* ------------------------------------------------------------------------------------------------- upload */
/**
 * Raw-body upload (POST the file's bytes, ?course_id=…&name=recipes.pdf). The bytes go straight into the private bucket without
 * being held in memory, then the first few KB are read back and the real type is decided from them; anything that is not a PDF,
 * ZIP / Office file, EPUB or MP4 / MOV / WebM video is deleted again. The file name keeps its stem but takes the real extension.
 */
materials.post("/materials/upload", requirePerm("materials:write"), rateLimit("RL_API"), async (c) => {
  const staff = c.get("staff")!;
  const courseId = Number(c.req.query("course_id"));
  if (!Number.isInteger(courseId) || courseId <= 0) throw new HttpError(400, "bad_request", "bad_request", { course_id: "required" });
  if (!(await first(c.env.DB, "SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL", courseId))) throw new HttpError(404, "not_found");

  const body = c.req.raw.body;
  if (!body) throw new HttpError(400, "empty_file");
  const announced = Number(c.req.header("content-length") ?? NaN);
  let payload: ReadableStream | Uint8Array;
  let size: number;
  if (Number.isInteger(announced) && announced > 0) {
    if (announced > MAX_UPLOAD_MATERIAL_BYTES) throw new HttpError(413, "file_too_large");
    payload = body;
    size = announced;
  } else {
    // the browser did not say how long the file is: read it (up to a small limit) so its length is known
    const buffered = new Uint8Array(await new Response(body).arrayBuffer());
    if (buffered.length === 0) throw new HttpError(400, "empty_file");
    if (buffered.length > SIZE_CAP_NO_LENGTH) throw new HttpError(413, "file_too_large");
    payload = buffered;
    size = buffered.length;
  }

  const name = safeFilename(c.req.query("name") ?? "file");
  const key = `materials/${courseId}/${randomToken(18)}`;
  try {
    await c.env.R2.put(key, payload, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { staff: String(staff.id) } });
  } catch {
    throw new HttpError(502, "upload_failed");
  }
  const head = await c.env.R2.get(key, { range: { offset: 0, length: 4096 } });
  const sniffed = head ? sniffMaterial(new Uint8Array(await head.arrayBuffer()), name) : null;
  const stored = await c.env.R2.head(key);
  if (!sniffed || !stored || stored.size === 0) {
    await c.env.R2.delete(key);
    throw new HttpError(415, "unsupported_file_type");
  }
  const stem = name.replace(/\.[^./]*$/, "") || "file";
  const note: UploadNote = { filename: `${stem}.${sniffed.ext}`.slice(0, 120), mime: sniffed.mime, size: stored.size, staff: staff.id, course_id: courseId };
  await c.env.KV.put(uploadNoteKey(key), JSON.stringify(note), { expirationTtl: 3 * 86400 });
  await audit(c, { action: "materials.uploaded", entity: "materials", entityId: key, summary: note.filename, meta: { size: stored.size, mime: sniffed.mime, announced: size } });
  return ok(c, { key, filename: note.filename, mime: note.mime, size_bytes: note.size }, 201);
});

/** The owner can fetch a file to check it (the same headers as a student's download; not counted as a student's download). */
materials.get("/materials/:id/file", requirePerm("materials:read"), async (c) => {
  const row = await first<{ r2_key: string | null; filename: string | null; mime: string | null }>(c.env.DB, "SELECT r2_key, filename, mime FROM materials WHERE id = ?", intParam(c, "id"));
  if (!row?.r2_key) throw notFound();
  const obj = await c.env.R2.get(row.r2_key);
  if (!obj) throw notFound();
  const name = row.filename ?? "file";
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.mime ?? "application/octet-stream",
      "Content-Length": String(obj.size),
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w.\- ]+/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

materials.route("/materials", crud);

/* ----------------------------------------------------------------------------------- who asked to join a group */
const REQUEST_COLS = `r.id, r.status, r.profile_url, r.note, r.created_at, r.handled_at, r.material_id, r.course_id,
  s.id AS student_id, s.name AS student_name, s.email AS student_email, s.phone AS student_phone,
  m.title_bn AS material_title_bn, m.title_en AS material_title_en, m.platform, m.url AS group_url,
  c.title_bn AS course_title_bn, c.title_en AS course_title_en,
  (SELECT name FROM staff WHERE id = r.handled_by) AS handled_by_name`;
const REQUEST_FROM = "FROM group_requests r JOIN students s ON s.id = r.student_id JOIN materials m ON m.id = r.material_id JOIN courses c ON c.id = r.course_id";

function requestFilter(q: Record<string, string>) {
  const where = ["1=1"];
  const params: (string | number)[] = [];
  if (["pending", "approved", "rejected"].includes(q.status ?? "")) {
    where.push("r.status = ?");
    params.push(q.status);
  }
  for (const [param, column] of [["course_id", "r.course_id"], ["material_id", "r.material_id"]] as const) {
    if (/^\d+$/.test(q[param] ?? "")) {
      where.push(`${column} = ?`);
      params.push(Number(q[param]));
    }
  }
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    where.push("(s.name LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\' OR r.profile_url LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  return { where: where.join(" AND "), params };
}

materials.get("/group-requests", requirePerm("materials:read"), async (c) => {
  const f = requestFilter(c.req.query());
  const { page, per_page, offset } = pageParams(c.req.query());
  const [items, total] = await Promise.all([
    all(c.env.DB, `SELECT ${REQUEST_COLS} ${REQUEST_FROM} WHERE ${f.where} ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`, ...f.params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n ${REQUEST_FROM} WHERE ${f.where}`, ...f.params),
  ]);
  return ok(c, { items, page: pageInfo(page, per_page, total?.n ?? 0) });
});

materials.get("/group-requests/export.csv", requirePerm("materials:read"), async (c) => {
  const f = requestFilter(c.req.query());
  const rows = await all<Record<string, unknown>>(c.env.DB, `SELECT ${REQUEST_COLS} ${REQUEST_FROM} WHERE ${f.where} ORDER BY r.created_at DESC, r.id DESC LIMIT 5000`, ...f.params);
  return csvResponse(
    "group-requests",
    toCsv(rows, [
      { key: "created_at", label: "Asked at" },
      { key: "student_name", label: "Student" },
      { key: "student_email", label: "Email" },
      { key: "student_phone", label: "Phone" },
      { key: "profile_url", label: "Profile link" },
      { key: "course_title_en", label: "Class" },
      { key: "material_title_en", label: "Group" },
      { key: "status", label: "Status" },
      { key: "handled_by_name", label: "Answered by" },
      { key: "note", label: "Note" },
    ]),
  );
});

const requestAnswer = z.object({ status: z.enum(["pending", "approved", "rejected"]), note: textSchema(300) });
materials.patch("/group-requests/:id", requirePerm("materials:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, requestAnswer);
  const row = await first<{ id: number }>(c.env.DB, "SELECT id FROM group_requests WHERE id = ?", id);
  if (!row) throw notFound();
  const staff = c.get("staff")!;
  await run(c.env.DB, "UPDATE group_requests SET status = ?, note = ?, handled_by = ?, handled_at = ?, updated_at = ? WHERE id = ?", body.status, body.note, body.status === "pending" ? null : staff.id, body.status === "pending" ? null : nowIso(), nowIso(), id);
  await audit(c, { action: "group_request.answered", entity: "group_request", entityId: id, meta: { status: body.status } });
  return ok(c, { item: await first(c.env.DB, `SELECT ${REQUEST_COLS} ${REQUEST_FROM} WHERE r.id = ?`, id) });
});

/* ----------------------------------------------------------------------------------- who downloaded what */
function downloadFilter(q: Record<string, string>) {
  const where = ["1=1"];
  const params: (string | number)[] = [];
  for (const [param, column] of [["course_id", "d.course_id"], ["material_id", "d.material_id"], ["student_id", "d.student_id"]] as const) {
    if (/^\d+$/.test(q[param] ?? "")) {
      where.push(`${column} = ?`);
      params.push(Number(q[param]));
    }
  }
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    where.push("(s.name LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\' OR m.title_en LIKE ? ESCAPE '\\' OR m.title_bn LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  return { where: where.join(" AND "), params };
}
const DOWNLOAD_COLS = `d.id, d.action, d.created_at, d.material_id, d.course_id, d.student_id, s.name AS student_name, s.email AS student_email,
  m.kind, m.title_bn AS material_title_bn, m.title_en AS material_title_en, c.title_bn AS course_title_bn, c.title_en AS course_title_en`;
const DOWNLOAD_FROM = "FROM material_downloads d JOIN students s ON s.id = d.student_id JOIN materials m ON m.id = d.material_id JOIN courses c ON c.id = d.course_id";

materials.get("/material-downloads", requirePerm("materials:read"), async (c) => {
  const f = downloadFilter(c.req.query());
  const { page, per_page, offset } = pageParams(c.req.query());
  const [items, total] = await Promise.all([
    all(c.env.DB, `SELECT ${DOWNLOAD_COLS} ${DOWNLOAD_FROM} WHERE ${f.where} ORDER BY d.created_at DESC, d.id DESC LIMIT ? OFFSET ?`, ...f.params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n ${DOWNLOAD_FROM} WHERE ${f.where}`, ...f.params),
  ]);
  return ok(c, { items, page: pageInfo(page, per_page, total?.n ?? 0) });
});

materials.get("/material-downloads/export.csv", requirePerm("materials:read"), async (c) => {
  const f = downloadFilter(c.req.query());
  const rows = await all<Record<string, unknown>>(c.env.DB, `SELECT ${DOWNLOAD_COLS} ${DOWNLOAD_FROM} WHERE ${f.where} ORDER BY d.created_at DESC, d.id DESC LIMIT 5000`, ...f.params);
  return csvResponse(
    "material-downloads",
    toCsv(rows, [
      { key: "created_at", label: "When" },
      { key: "student_name", label: "Student" },
      { key: "student_email", label: "Email" },
      { key: "course_title_en", label: "Class" },
      { key: "material_title_en", label: "Material" },
      { key: "kind", label: "Type" },
      { key: "action", label: "Action" },
    ]),
  );
});
