import { LESSON_VIDEO_TARGET } from "@mawah/shared";
import { adm, ApiError } from "./api";

/*
 * A lesson's video into the website's own storage (worker/src/services/lessonVideos.ts), from the owner's browser:
 *  1. shrink — the video is made 720p (never larger than it was), H.264 at about 2 Mbit/s, sound kept as it is, with its index at the start
 *     so a player starts at once: a 1 GB phone recording becomes about 150 MB and plays without stopping on a phone's internet. The browser
 *     does it with the computer's own video chip (WebCodecs, through Mediabunny — loaded only here); a video that is small already is only
 *     tidied (nothing re-made). A browser that cannot do it says so, and the original is sent only when it already plays on the web.
 *  2. upload — in parts, a few at once; a part that fails (the internet dropped) is sent again, after waiting for the connection to come
 *     back, so a long upload carries on from where it stopped instead of starting again.
 */

export type VideoStep = { phase: "reading" } | { phase: "shrinking"; pct: number } | { phase: "uploading"; pct: number } | { phase: "saving" };

export interface Prepared {
  blob: Blob;
  /** seconds, when the video says */
  duration: number | null;
  /** what was done: re-made smaller, only tidied (already small), or sent as it was (this browser cannot shrink videos) */
  done: "shrunk" | "tidied" | "original";
  width: number;
  height: number;
  /** the size before, in bytes (null when read from an address) */
  before: number | null;
}

/** Why a video cannot go up: not a video, or a kind the website's players cannot play and this browser cannot remake. */
export class VideoError extends Error {}

const isCancel = (e: unknown) => (e instanceof DOMException && e.name === "AbortError") || (e instanceof Error && /cancel/i.test(e.name + e.message));

/**
 * Makes a video ready for the website: from a file the owner picked, or from an address on this site that hands on a video (a Drive
 * lesson, through /api/admin/drive/media). Progress is 0–100.
 */
export async function prepareVideo(source: File | string, onStep: (s: VideoStep) => void, signal?: AbortSignal): Promise<Prepared> {
  onStep({ phase: "reading" });
  const mb = await import("mediabunny");
  const input = new mb.Input({
    source: typeof source === "string" ? new mb.UrlSource(source, { requestInit: { credentials: "same-origin" } }) : new mb.BlobSource(source),
    formats: mb.ALL_FORMATS,
  });
  try {
    let video;
    try {
      video = await input.getPrimaryVideoTrack();
    } catch {
      throw new VideoError("not_video");
    }
    if (!video) throw new VideoError("not_video");
    const [duration, audio, mime] = await Promise.all([input.computeDuration().catch(() => null), input.getPrimaryAudioTrack(), input.getMimeType().catch(() => "")]);
    const width = video.displayWidth;
    const height = video.displayHeight;
    const shortSide = Math.min(width, height);
    const stats = await video.computePacketStats(120).catch(() => null);
    const bitrate = stats?.averageBitrate ?? 0;
    const big = shortSide > LESSON_VIDEO_TARGET.height + 8 || bitrate > LESSON_VIDEO_TARGET.bitrate * 1.6;
    const webVideo = video.codec === "avc";
    const webAudio = !audio || audio.codec === "aac" || audio.codec === "mp3";
    // the size it will be: the short side 720 (portrait or landscape), never made larger
    const scale = shortSide > LESSON_VIDEO_TARGET.height ? LESSON_VIDEO_TARGET.height / shortSide : 1;
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    const out = { width: even(width * scale), height: even(height * scale) };
    const remake = big || !webVideo;
    const canRemake = remake && (await mb.canEncodeVideo("avc", { width: out.width, height: out.height, bitrate: LESSON_VIDEO_TARGET.bitrate }).catch(() => false));
    if (remake && !canRemake) {
      // this browser cannot make videos: the original goes up only when it is a file that plays on the web as it is
      if (typeof source !== "string" && webVideo && webAudio && /mp4/.test(mime || source.type)) {
        return { blob: source, duration, done: "original", width, height, before: source.size };
      }
      throw new VideoError("cannot_shrink");
    }
    const aacOk = webAudio || (await mb.canEncodeAudio("aac").catch(() => false));

    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: remake
        ? { codec: "avc", width: out.width, height: out.height, fit: "contain", quality: new mb.Quality({ bitrate: Math.min(LESSON_VIDEO_TARGET.bitrate, bitrate > 0 ? Math.max(bitrate, 800_000) : LESSON_VIDEO_TARGET.bitrate) }), keyFrameInterval: 3, forceTranscode: true }
        : {},
      // the sound is copied as it is (phones record AAC); other sound is made AAC where the browser can, else the best it can
      audio: webAudio ? {} : aacOk ? { codec: "aac", quality: new mb.Quality({ bitrate: 128_000 }) } : {},
      showWarnings: false,
    });
    if (!conversion.isValid) throw new VideoError("not_video");
    const stop = () => void conversion.cancel();
    signal?.addEventListener("abort", stop, { once: true });
    onStep({ phase: "shrinking", pct: 0 });
    conversion.onProgress = (p) => onStep({ phase: "shrinking", pct: Math.min(100, Math.round(p * 100)) });
    try {
      await conversion.execute();
    } catch (e) {
      if (signal?.aborted || isCancel(e)) throw new DOMException("cancelled", "AbortError");
      throw e instanceof VideoError ? e : new VideoError(remake ? "shrink_failed" : "not_video");
    } finally {
      signal?.removeEventListener("abort", stop);
    }
    if (!target.buffer) throw new VideoError("shrink_failed");
    const blob = new Blob([target.buffer], { type: "video/mp4" });
    return { blob, duration, done: remake ? "shrunk" : "tidied", width: remake ? out.width : width, height: remake ? out.height : height, before: typeof source === "string" ? null : source.size };
  } finally {
    input.dispose();
  }
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(t);
      reject(new DOMException("cancelled", "AbortError"));
    });
  });
const online = (signal?: AbortSignal) =>
  navigator.onLine
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        window.addEventListener("online", () => resolve(), { once: true });
        signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
      });

/** One part: PUT with its exact length; resolves with R2's tag for it. `onSent` reports the bytes gone so far. */
function sendPart(uploadId: string, n: number, chunk: Blob, onSent: (bytes: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/admin/video-uploads/${encodeURIComponent(uploadId)}/parts/${n}`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onSent(e.loaded);
    xhr.onload = () => {
      const body = xhr.response as { etag?: string; error?: { code?: string } } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.etag) resolve(body.etag);
      else reject(new ApiError(xhr.status, body?.error?.code ?? (xhr.status === 429 ? "rate_limited" : "generic")));
    };
    xhr.onerror = () => reject(new ApiError(0, "network"));
    xhr.ontimeout = () => reject(new ApiError(0, "network"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.onabort = () => reject(new DOMException("cancelled", "AbortError"));
    xhr.send(chunk);
  });
}

/** A failure worth trying again: the connection, a busy moment, the server's own trouble — not a refusal of the request itself. */
const passing = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500);

/**
 * Sends a ready video to a lesson. Three parts travel at once; a part that fails is sent again (after the connection is back), up to 8
 * times, so the upload carries on from where it stopped. Cancelling drops what was sent.
 */
export async function uploadLessonVideo(lessonId: number, prepared: Prepared, onStep: (s: VideoStep) => void, signal?: AbortSignal): Promise<{ video_bytes: number; video_key: string }> {
  const { blob } = prepared;
  // one stop for every part in flight: the owner's Cancel, or a part that cannot go (then the others stop too)
  const ctl = new AbortController();
  signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  const start = await adm<{ upload_id: string; part_bytes: number; parts: number }>(`/lessons/${lessonId}/video-uploads`, { json: { size: blob.size } });
  const sent = new Array<number>(start.parts).fill(0);
  const report = () => onStep({ phase: "uploading", pct: Math.min(100, Math.floor((sent.reduce((s, x) => s + x, 0) / blob.size) * 100)) });
  const tags: { n: number; etag: string }[] = [];
  let next = 1;
  const worker = async () => {
    while (next <= start.parts) {
      const n = next++;
      const chunk = blob.slice((n - 1) * start.part_bytes, Math.min(blob.size, n * start.part_bytes));
      for (let attempt = 1; ; attempt++) {
        try {
          const etag = await sendPart(start.upload_id, n, chunk, (b) => ((sent[n - 1] = b), report()), ctl.signal);
          sent[n - 1] = chunk.size;
          report();
          tags.push({ n, etag });
          break;
        } catch (e) {
          sent[n - 1] = 0;
          if (ctl.signal.aborted || !passing(e) || attempt >= 8) throw e;
          await online(ctl.signal);
          await wait(Math.min(30_000, 1500 * 2 ** (attempt - 1)), ctl.signal);
        }
      }
    }
  };
  try {
    onStep({ phase: "uploading", pct: 0 });
    await Promise.all([worker(), worker(), worker()]);
    onStep({ phase: "saving" });
    return await adm<{ video_bytes: number; video_key: string }>(`/video-uploads/${encodeURIComponent(start.upload_id)}/complete`, {
      json: { parts: tags.sort((a, b) => a.n - b.n), duration_sec: prepared.duration ? Math.round(prepared.duration) : null },
    });
  } catch (e) {
    ctl.abort();
    void adm(`/video-uploads/${encodeURIComponent(start.upload_id)}`, { method: "DELETE" }).catch(() => undefined);
    throw signal?.aborted ? new DOMException("cancelled", "AbortError") : e;
  }
}

/** "152 MB", "1.2 GB" */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
