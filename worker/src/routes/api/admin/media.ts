import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAX_UPLOAD_IMAGE_BYTES } from "@mawah/shared";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { sha256Hex } from "../../../lib/crypto";
import { sniffImage } from "../../../lib/files";
import { HttpError, ok } from "../../../lib/http";
import { streamConfigured, createDirectUpload, videoStatus } from "../../../lib/stream";
import { requirePerm } from "../../../middleware/auth";

export const media = new Hono<AppEnv>();

const FOLDERS = ["banners", "photos", "blog"] as const;

/**
 * Image upload (class banners, instructor photos, blog covers).
 *  - raw body (the admin UI compresses to WebP in the browser first), 5 MB hard cap
 *  - the file type comes from its magic bytes: only JPEG / PNG / WebP / AVIF are accepted, never SVG or anything else
 *  - the R2 key is the content hash, so the same picture is stored once and served with an immutable cache header
 */
media.post(
  "/media/image",
  requirePerm("media:write"),
  bodyLimit({
    maxSize: MAX_UPLOAD_IMAGE_BYTES + 4096,
    onError: () => {
      throw new HttpError(413, "file_too_large");
    },
  }),
  async (c) => {
    const folder = c.req.query("folder") ?? "";
    if (!(FOLDERS as readonly string[]).includes(folder)) throw new HttpError(400, "bad_request", "bad_request", { folder: "invalid" });
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) throw new HttpError(400, "empty_file");
    if (bytes.length > MAX_UPLOAD_IMAGE_BYTES) throw new HttpError(413, "file_too_large");
    const kind = sniffImage(bytes);
    if (!kind) throw new HttpError(415, "unsupported_file_type");

    const key = `${folder}/${(await sha256Hex(bytes)).slice(0, 32)}.${kind.ext}`;
    const exists = await c.env.R2.head(key);
    if (!exists) await c.env.R2.put(key, bytes, { httpMetadata: { contentType: kind.mime }, customMetadata: { staff: String(c.get("staff")!.id) } });
    await audit(c, { action: "media.uploaded", entity: "media", entityId: key, meta: { size: bytes.length } });
    return ok(c, { key, url: `/media/${key}`, size: bytes.length, mime: kind.mime }, 201);
  },
);

/* ------------------------------------------------------------------------------------ Cloudflare Stream */
media.get("/media/video/status", requirePerm("media:write"), (c) => ok(c, { configured: streamConfigured(c.env) }));

/** Hands the browser a one-time upload URL: the video bytes go straight to Stream, never through the Worker. */
media.post("/media/video/upload", requirePerm("media:write"), async (c) => {
  const upload = await createDirectUpload(c.env);
  await audit(c, { action: "media.video_upload_started", entity: "video", entityId: upload.uid });
  return ok(c, upload, 201);
});

media.get("/media/video/:uid", requirePerm("media:write"), async (c) => ok(c, { video: await videoStatus(c.env, c.req.param("uid")) }));
