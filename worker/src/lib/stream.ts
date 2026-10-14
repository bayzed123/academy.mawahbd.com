import type { Env } from "../env";
import { HttpError } from "./http";

/**
 * Cloudflare Stream wrapper.
 *  - Videos are uploaded with requireSignedURLs=true, so a raw video id is useless on its own.
 *  - Playback URLs embed a short-lived signed token minted per request, only for enrolled students.
 *  - Stream does transcoding + adaptive-bitrate delivery (a slow phone still gets a playable video).
 */
export function streamConfigured(env: Env): boolean {
  return !!env.STREAM;
}

async function customerCode(env: Env, uid: string): Promise<string | null> {
  if (env.STREAM_CUSTOMER_CODE) return env.STREAM_CUSTOMER_CODE;
  const cached = await env.KV.get("stream:customer_code");
  if (cached) return cached;
  try {
    const details = await env.STREAM!.video(uid).details();
    const m = /customer-([a-z0-9]+)\.cloudflarestream\.com/i.exec(details.preview ?? details.thumbnail ?? "");
    if (m) {
      await env.KV.put("stream:customer_code", m[1], { expirationTtl: 30 * 86400 });
      return m[1];
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Signed iframe URL for one video, or null when Stream is not configured (UI shows a friendly message). */
export async function streamEmbedUrl(env: Env, uid: string): Promise<string | null> {
  if (!env.STREAM || !/^[a-f0-9]{32}$/i.test(uid)) return null;
  const [token, code] = await Promise.all([env.STREAM.video(uid).generateToken(), customerCode(env, uid)]);
  if (!code) return null;
  return `https://customer-${code}.cloudflarestream.com/${token}/iframe?preload=metadata`;
}

export async function createDirectUpload(env: Env): Promise<{ uploadURL: string; uid: string }> {
  if (!env.STREAM) throw new HttpError(503, "stream_not_configured");
  const res = await env.STREAM.createDirectUpload({ maxDurationSeconds: 4 * 3600, requireSignedURLs: true });
  return { uploadURL: res.uploadURL, uid: res.id };
}

export interface VideoStatus {
  ready: boolean;
  state: string;
  duration: number;
  pct: number;
  error: string | null;
}

export async function videoStatus(env: Env, uid: string): Promise<VideoStatus> {
  if (!env.STREAM) throw new HttpError(503, "stream_not_configured");
  if (!/^[a-f0-9]{32}$/i.test(uid)) throw new HttpError(400, "invalid_video_id");
  const v = await env.STREAM.video(uid).details();
  return {
    ready: v.readyToStream,
    state: v.status.state,
    duration: v.duration > 0 ? Math.round(v.duration) : 0,
    pct: Number(v.status.pctComplete ?? 0) || 0,
    error: (v.status as { errorReasonText?: string }).errorReasonText || null,
  };
}

/** YouTube / Vimeo links become privacy-friendly embeds; anything else just opens as a link. */
export function externalEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = /^\/(?:embed|shorts|live)\/([\w-]{11})/.exec(u.pathname);
        if (m) id = m[1];
      }
    }
    if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (host === "vimeo.com") {
      const m = /^\/(\d{6,12})/.exec(u.pathname);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }
  } catch {
    /* not a URL */
  }
  return null;
}
