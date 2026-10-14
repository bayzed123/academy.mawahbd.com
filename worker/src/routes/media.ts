import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/http";

/**
 * Public images (class banners, instructor photos, blog covers) from the R2 bucket.
 * Keys are content-hashed on upload, so responses are immutable and cacheable for a year.
 * Private lesson files are NOT served here — they only come out of the authorised student endpoint.
 */
export const mediaRoutes = new Hono<AppEnv>();

const PUBLIC_PREFIXES = ["banners/", "photos/", "blog/", "site/"];

mediaRoutes.get("/*", async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/media\//, ""));
  if (!key || key.includes("..") || !PUBLIC_PREFIXES.some((p) => key.startsWith(p))) throw new HttpError(404, "not_found");

  const obj = await c.env.R2.get(key);
  if (!obj) throw new HttpError(404, "not_found");
  const etag = obj.httpEtag;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  const type = obj.httpMetadata?.contentType ?? "application/octet-stream";
  // never let an uploaded file be interpreted as anything but an image
  if (!type.startsWith("image/") || type === "image/svg+xml") throw new HttpError(404, "not_found");
  return new Response(obj.body, {
    headers: {
      "Content-Type": type,
      ETag: etag,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
