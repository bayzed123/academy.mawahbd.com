import type { LessonContentDTO } from "@mawah/shared/types";

/**
 * How the app plays a lesson, from what the server says about it (worker/src/services/learning.ts):
 *  - "native": the phone's own video player (smooth, full screen, no website around it). Cloudflare Stream lessons are played from their
 *    HLS address; a Google Drive video comes through the website's own address, which needs the student's sign-in (`auth`).
 *  - "web": a player page (YouTube, Vimeo, Facebook) shown inside the app.
 *  - "pending": the video is being prepared; "link": a lesson on another website; "none": no video (a text lesson).
 */
export type PlayerSource =
  | { kind: "native"; uri: string; auth: boolean }
  | { kind: "web"; uri: string }
  | { kind: "pending" }
  | { kind: "link"; url: string }
  | { kind: "none" };

const STREAM_IFRAME = /^https:\/\/(customer-[a-z0-9]+\.cloudflarestream\.com)\/([A-Za-z0-9._~-]+)\/iframe(?:\?[^#]*)?$/;

/** A Cloudflare Stream player address (signed) → the same video's HLS address, which the phone's player plays. Null when it is not one. */
export function streamHls(embedUrl: string): string | null {
  const m = STREAM_IFRAME.exec(embedUrl);
  return m ? `https://${m[1]}/${m[2]}/manifest/video.m3u8` : null;
}

/** "/api/student/lessons/7/media" → "https://mawahacademy.com/api/student/lessons/7/media"; full https addresses stay as they are. */
export function absolute(base: string, path: string): string {
  if (/^https:\/\//i.test(path)) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function playerFor(lesson: Pick<LessonContentDTO, "video" | "external">, base: string): PlayerSource {
  if (lesson.video?.embed_url) {
    const hls = streamHls(lesson.video.embed_url);
    return hls ? { kind: "native", uri: hls, auth: false } : { kind: "web", uri: lesson.video.embed_url };
  }
  const ext = lesson.external;
  if (ext) {
    if (ext.media_url) return { kind: "native", uri: absolute(base, ext.media_url), auth: ext.media_url.startsWith("/api/student/") };
    if (ext.pending) return { kind: "pending" };
    if (ext.embed_url) return { kind: "web", uri: ext.embed_url };
    if (/^https?:\/\//i.test(ext.url)) return { kind: "link", url: ext.url };
  }
  return { kind: "none" };
}

/**
 * The page the app shows for a "web" player: the site's player in a frame that fills the box. It is loaded as if from the website
 * (base address), because YouTube refuses to play in a page with no address of its own.
 */
export function embedPage(src: string): string {
  const safe = src.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${safe}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;
}
