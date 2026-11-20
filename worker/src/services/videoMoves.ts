import type { Env } from "../env";
import { randomString } from "../lib/crypto";
import { all, first, nowIso, run } from "../lib/db";
import { driveInfo, driveMedia, driveRef, isMedia } from "../lib/drive";
import { HttpError } from "../lib/http";

/*
 * Admin → Video speed: lessons whose video lives in Google Drive, moved into Cloudflare Stream.
 *
 * Why: a Drive video is handed to the student exactly as it was uploaded — often a phone recording of 8 Mbit/s or more — through Google,
 * with about a second's wait on every part the player asks for. On a phone's internet in Bangladesh that is a late start and a video that
 * keeps stopping. Stream converts the video once into several qualities and the player picks the one the student's internet can take,
 * stepping down instead of stopping; it is the home lib/stream.ts already plays (website and Android app alike).
 *
 * How, with nothing for the owner to download or upload again:
 *   1. the owner presses "Move" (one lesson, or all): each lesson gets a queued row;
 *   2. at most MAX_AT_ONCE copies run together. For each, the Worker makes a one-time address of its own (/api/video-source/<token>, kept two
 *      days in KV, removed once the copy is done) that hands on that one Drive file (lib/drive.ts), and asks Stream to copy the video from it;
 *   3. the copy is checked (the admin page asks while it is open; the 6-hourly job too). Once Stream can play it, the lesson becomes a Stream
 *      lesson (type "video" with the Stream id). The Drive link stays on the lesson, so "Switch back" is always one press.
 * A failure keeps the lesson playing from Drive and says why in plain words. Stream refusing for lack of storage pauses the queue (and says
 * so) instead of failing every lesson.
 */

export const MAX_AT_ONCE = 5;
/** how long the one-time source address lives (Stream fetches at once; a slow queue must not leave one open for long) */
const SOURCE_TTL_S = 2 * 86400;
/** a copy that has not finished in a day has failed */
const STUCK_MS = 24 * 3600 * 1000;
const sourceKey = (token: string) => `vsrc:${token}`;
const BLOCKED_KEY = "vmoves:blocked";

export type MoveState = "queued" | "copying" | "ready" | "failed" | "undone";
export type MoveProblem =
  | "stream_not_configured"
  | "stream_quota" // Stream's storage is full or was never bought (Cloudflare → Stream)
  | "stream_forbidden" // Stream is not switched on for the account
  | "stream_rate_limited"
  | "stream_too_big"
  | "stream_rejected" // Stream could not use the file (a format it cannot convert, a broken file)
  | "stream_error"
  | "drive_no_access"
  | "drive_not_video"
  | "drive_not_downloadable"
  | "drive_error"
  | "lesson_changed"
  | "stuck";

interface MoveRow {
  id: number;
  lesson_id: number;
  drive_id: string;
  stream_uid: string | null;
  source_token: string | null;
  state: MoveState;
  problem: string | null;
  minutes: number | null;
  created_at: string;
  updated_at: string;
}
interface LessonRow {
  id: number;
  course_id: number;
  title_bn: string;
  title_en: string;
  type: string;
  stream_uid: string | null;
  external_url: string | null;
  duration_sec: number;
  course_bn: string;
  course_en: string;
}

/** The Drive file a lesson's link points at (the link stays on the lesson after the move), or null. */
const driveOf = (url: string | null): string | null => {
  const ref = url ? driveRef(url) : null;
  return ref?.kind === "file" ? ref.id : null;
};

/** What Stream's errors mean (they come with a name: QuotaReachedError …). */
function streamProblem(err: unknown): MoveProblem {
  const name = err instanceof Error ? err.name : "";
  if (name === "QuotaReachedError") return "stream_quota";
  if (name === "ForbiddenError") return "stream_forbidden";
  if (name === "RateLimitedError") return "stream_rate_limited";
  if (name === "MaxFileSizeError") return "stream_too_big";
  if (name === "BadRequestError" || name === "InvalidURLError") return "stream_rejected";
  return "stream_error";
}
/** the problems that stop the whole queue for a while, not the one lesson */
const PAUSES: Partial<Record<MoveProblem, number>> = { stream_quota: 600, stream_forbidden: 600, stream_rate_limited: 120 };

async function setState(env: Env, id: number, state: MoveState, extra: { problem?: string | null; stream_uid?: string | null; minutes?: number | null } = {}) {
  await run(
    env.DB,
    `UPDATE video_moves SET state = ?, problem = ?, stream_uid = COALESCE(?, stream_uid), minutes = COALESCE(?, minutes), updated_at = ? WHERE id = ?`,
    state,
    extra.problem ?? null,
    extra.stream_uid ?? null,
    extra.minutes ?? null,
    nowIso(),
    id,
  );
}

/* ---------------------------------------------------------------------------------------------------- the one-time source address */

/** The Drive file behind a one-time source address, for Stream's fetcher — the token is the only key; anything else is a 404. */
export async function sourceMedia(env: Env, token: string, range: string | null): Promise<Response> {
  if (!/^[a-z0-9]{40}$/.test(token)) throw new HttpError(404, "not_found");
  const driveId = await env.KV.get(sourceKey(token));
  if (!driveId) throw new HttpError(404, "not_found");
  return driveMedia(env, driveId, range);
}

/* ---------------------------------------------------------------------------------------------------- starting, checking, switching */

/** Queue lessons to be moved: the ones named, or every Drive lesson. Lessons already queued, copying or on Stream are left as they are. */
export async function queueMoves(env: Env, which: number[] | "all", staffId: number | null): Promise<number> {
  if (!env.STREAM) throw new HttpError(503, "stream_not_configured");
  const lessons = await driveLessons(env);
  const ids = new Set(which === "all" ? [] : which);
  let queued = 0;
  for (const l of lessons) {
    if (which !== "all" && !ids.has(l.id)) continue;
    if (l.move && (l.move.state === "queued" || l.move.state === "copying")) continue;
    if (l.on_stream || !l.drive_id) continue;
    await run(env.DB, "INSERT INTO video_moves (lesson_id, drive_id, state, started_by, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)", l.id, l.drive_id, staffId, nowIso(), nowIso());
    queued++;
  }
  return queued;
}

/** Ask Stream to copy one queued lesson's video. Returns false when the queue must wait (Stream asked for a pause). */
async function startOne(env: Env, m: MoveRow, origin: string): Promise<boolean> {
  const lesson = await first<LessonRow>(env.DB, "SELECT id, title_bn, title_en, type, external_url FROM lessons WHERE id = ?", m.lesson_id);
  if (!lesson || lesson.type !== "external" || driveOf(lesson.external_url) !== m.drive_id) {
    await setState(env, m.id, "failed", { problem: "lesson_changed" });
    return true;
  }
  const info = await driveInfo(env, m.drive_id);
  if (!info.ok) {
    const p: MoveProblem = info.problem === "no_access" || info.problem === "folder" ? "drive_no_access" : info.problem === "not_downloadable" ? "drive_not_downloadable" : info.problem === "not_video" ? "drive_not_video" : "drive_error";
    await setState(env, m.id, "failed", { problem: p });
    return true;
  }
  if (info.data.mime && !isMedia(info.data.mime) && info.data.mime !== "application/octet-stream") {
    await setState(env, m.id, "failed", { problem: "drive_not_video" });
    return true;
  }
  const token = randomString(40, "abcdefghijklmnopqrstuvwxyz0123456789");
  await env.KV.put(sourceKey(token), m.drive_id, { expirationTtl: SOURCE_TTL_S });
  try {
    const video = await env.STREAM!.upload(`${origin}/api/video-source/${token}`, {
      requireSignedURLs: true,
      meta: { name: (lesson.title_en || lesson.title_bn).slice(0, 200), lesson: String(lesson.id), from: "google-drive" },
    });
    await run(env.DB, "UPDATE video_moves SET state = 'copying', stream_uid = ?, source_token = ?, problem = NULL, updated_at = ? WHERE id = ?", video.id, token, nowIso(), m.id);
    return true;
  } catch (err) {
    await env.KV.delete(sourceKey(token));
    const problem = streamProblem(err);
    console.warn("video_move_start_failed", m.lesson_id, problem);
    const pause = PAUSES[problem];
    if (pause) {
      // the whole queue waits (storage to be bought, Stream to be switched on, a breather): the lesson stays queued
      await env.KV.put(BLOCKED_KEY, JSON.stringify({ problem, at: nowIso() }), { expirationTtl: pause });
      return false;
    }
    await setState(env, m.id, "failed", { problem });
    return true;
  }
}

/** The one-time source address of a copy, removed once the copy is over (Stream has the video; nobody else ever needs it). */
async function closeSource(env: Env, m: MoveRow) {
  if (!m.source_token) return;
  await env.KV.delete(sourceKey(m.source_token));
  await run(env.DB, "UPDATE video_moves SET source_token = NULL WHERE id = ?", m.id);
}

/** Look at the copies in progress (done → the lesson switches to Stream; failed → why), then start queued ones while there is room. */
export async function pumpMoves(env: Env, origin: string): Promise<void> {
  if (!env.STREAM) return;
  const copying = await all<MoveRow>(env.DB, "SELECT * FROM video_moves WHERE state = 'copying' ORDER BY id LIMIT 50");
  let running = copying.length;
  for (const m of copying) {
    try {
      const v = await env.STREAM.video(m.stream_uid!).details();
      if (v.readyToStream) {
        const lesson = await first<LessonRow>(env.DB, "SELECT id, type, external_url, duration_sec FROM lessons WHERE id = ?", m.lesson_id);
        await closeSource(env, m);
        if (!lesson || lesson.type !== "external" || driveOf(lesson.external_url) !== m.drive_id) {
          await setState(env, m.id, "failed", { problem: "lesson_changed" });
        } else {
          const secs = v.duration > 0 ? Math.round(v.duration) : 0;
          await run(
            env.DB,
            "UPDATE lessons SET type = 'video', stream_uid = ?, duration_sec = CASE WHEN duration_sec > 0 THEN duration_sec ELSE ? END, updated_at = ? WHERE id = ? AND type = 'external'",
            v.id,
            secs,
            nowIso(),
            m.lesson_id,
          );
          await setState(env, m.id, "ready", { minutes: secs ? Math.round((secs / 60) * 10) / 10 : null });
        }
        running--;
      } else if (v.status.state === "error") {
        await closeSource(env, m);
        console.warn("video_move_failed", m.lesson_id, v.status.errorReasonCode);
        await setState(env, m.id, "failed", { problem: "stream_rejected" });
        running--;
      } else if (Date.now() - Date.parse(m.updated_at) > STUCK_MS) {
        await closeSource(env, m);
        await setState(env, m.id, "failed", { problem: "stuck" });
        running--;
      }
    } catch (err) {
      // Stream could not be asked this time (or no longer knows the video): tried again on the next look, failed once it is stuck
      if (err instanceof Error && err.name === "NotFoundError") {
        await closeSource(env, m);
        await setState(env, m.id, "failed", { problem: "stream_error" });
        running--;
      }
    }
  }
  if (await env.KV.get(BLOCKED_KEY)) return;
  if (running >= MAX_AT_ONCE) return;
  const queued = await all<MoveRow>(env.DB, "SELECT * FROM video_moves WHERE state = 'queued' ORDER BY id LIMIT ?", MAX_AT_ONCE - running);
  for (const m of queued) if (!(await startOne(env, m, origin))) break;
}

/** Switch a lesson back to its Drive video (the Stream copy is deleted, so it no longer counts against Stream's storage). */
export async function undoMove(env: Env, lessonId: number): Promise<void> {
  const m = await first<MoveRow>(env.DB, "SELECT * FROM video_moves WHERE lesson_id = ? ORDER BY id DESC LIMIT 1", lessonId);
  if (!m || (m.state !== "ready" && m.state !== "copying" && m.state !== "queued")) throw new HttpError(409, "nothing_to_undo");
  if (m.state === "ready") {
    await run(env.DB, "UPDATE lessons SET type = 'external', stream_uid = NULL, updated_at = ? WHERE id = ? AND type = 'video' AND stream_uid = ?", nowIso(), lessonId, m.stream_uid);
  }
  await closeSource(env, m);
  if (m.stream_uid && env.STREAM) await env.STREAM.video(m.stream_uid).delete().catch(() => undefined);
  await setState(env, m.id, "undone");
}

/* ---------------------------------------------------------------------------------------------------- the list */

export interface DriveLesson {
  id: number;
  course_id: number;
  course_bn: string;
  course_en: string;
  title_bn: string;
  title_en: string;
  drive_id: string | null;
  on_stream: boolean;
  move: { state: MoveState; problem: MoveProblem | null; minutes: number | null; updated_at: string } | null;
}

/** Every lesson whose video is a Drive file (or was one, before it moved to Stream), with how its move stands. */
export async function driveLessons(env: Env): Promise<DriveLesson[]> {
  const [lessons, moves] = await Promise.all([
    all<LessonRow>(
      env.DB,
      `SELECT l.id, l.course_id, l.title_bn, l.title_en, l.type, l.stream_uid, l.external_url, l.duration_sec, c.title_bn AS course_bn, c.title_en AS course_en
       FROM lessons l JOIN courses c ON c.id = l.course_id
       WHERE c.deleted_at IS NULL AND l.external_url IS NOT NULL AND l.type IN ('external','video')
       ORDER BY c.sort, c.id, l.sort, l.id`,
    ),
    all<MoveRow>(env.DB, "SELECT * FROM video_moves WHERE id IN (SELECT MAX(id) FROM video_moves GROUP BY lesson_id)"),
  ]);
  const last = new Map(moves.map((m) => [m.lesson_id, m]));
  const out: DriveLesson[] = [];
  for (const l of lessons) {
    const drive = driveOf(l.external_url);
    if (!drive) continue;
    const m = last.get(l.id) ?? null;
    const onStream = l.type === "video" && !!l.stream_uid;
    // a lesson that is a Stream video for another reason (uploaded to Stream by hand, keeping an old Drive link) is not this page's business
    if (l.type === "video" && !(m && m.state === "ready" && m.stream_uid === l.stream_uid)) continue;
    out.push({
      id: l.id,
      course_id: l.course_id,
      course_bn: l.course_bn,
      course_en: l.course_en,
      title_bn: l.title_bn,
      title_en: l.title_en,
      drive_id: drive,
      on_stream: onStream,
      move: m ? { state: m.state, problem: m.state === "failed" ? ((m.problem as MoveProblem) ?? "stream_error") : null, minutes: m.minutes, updated_at: m.updated_at } : null,
    });
  }
  return out;
}

/** What is holding the queue back (Stream's storage, Stream switched off, a breather), if anything. */
export async function movesBlocked(env: Env): Promise<{ problem: MoveProblem; at: string } | null> {
  return env.KV.get<{ problem: MoveProblem; at: string }>(BLOCKED_KEY, "json");
}
