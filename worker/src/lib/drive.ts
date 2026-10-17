import type { Env } from "../env";
import { HttpError } from "./http";
import { DRIVE_SCOPE, endpoints, forgetPass, googleToken, parseServiceAccount, scrub, serviceAccountEmail } from "./ga4";

/*
 * Videos that live in the owner's Google Drive, played inside the student portal.
 *
 * The problem this solves: a class video kept in Drive is private, and a student sent to its Drive address sees "You need permission".
 * Instead, the owner shares the video (or its folder) with the website's own Google account — the e-mail address of the service account whose
 * key is already on the Worker for Analytics (GOOGLE_SERVICE_ACCOUNT) — and the Worker hands the video to the student's player itself:
 *
 *   1. a lesson holds a Drive link; the file's id is read from it (driveRef) — it is never taken from anything the student sends;
 *   2. the lesson page says "play it here" only when that account can really read the file (driveReadable, remembered a few minutes);
 *   3. the player asks the Worker for the video, the Worker checks that this student owns the class (or that the lesson is a free preview),
 *      asks Google for the file with the account's read-only pass, and passes the bytes on — including the "give me this part" requests a
 *      browser makes to start playing at once and to skip around (driveMedia). Nothing is stored; the file's address never reaches the student.
 *
 * What it is not: Drive hands over the file as it was uploaded (it does not convert it, as its own player does), so only formats a browser can
 * play work (MP4 with H.264 is the safe one); and Google limits how much one file may be downloaded in a day, so a very popular video can be
 * refused for a while. For many students at once, Cloudflare Stream is the right home for a video (see docs/owner-guide.md).
 *
 * Like lib/ga4.ts, nothing here ever puts the key — or any part of it — in an answer or a log line: what Google said is shown, with anything
 * shaped like a key cut out.
 */

/** What a Drive link is: a file (the id), a folder, or something else of Google's (a document, a sheet …). null = not a Google Drive address at all. */
export type DriveRef = { kind: "file"; id: string } | { kind: "folder" } | { kind: "other" };

const ID = /^[A-Za-z0-9_-]{20,100}$/;
const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com", "drive.usercontent.google.com"]);

/** Reads a pasted Drive link of any of its shapes (…/file/d/ID/view, …/open?id=ID, …/uc?id=ID&export=download, a folder, a Google Doc). */
export function driveRef(url: string): DriveRef | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !DRIVE_HOSTS.has(u.hostname.toLowerCase())) return null;
  const path = u.pathname;
  if (/\/folders\//.test(path)) return { kind: "folder" };
  // Google Docs, Sheets, Slides and Forms have no video in them
  if (/^\/(document|spreadsheets|presentation|forms)\//.test(path)) return { kind: "other" };
  const inPath = /\/file\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/.exec(path)?.[1];
  const id = inPath ?? (/^\/(?:open|uc|download)$/.test(path) ? u.searchParams.get("id") : null);
  return id && ID.test(id) ? { kind: "file", id } : { kind: "other" };
}

/* ---------------------------------------------------------------------------------------------------- problems */

export type DriveProblem =
  | "not_configured" // there is no Google key on the Worker
  | "key_invalid" // the secret is not a service-account key file
  | "key_rejected" // Google refused the key
  | "api_disabled" // the Google Drive API is switched off in the Google Cloud project
  | "not_drive_file" // the address is not a link to a file in Google Drive
  | "folder" // it is a folder, not a video
  | "no_access" // the account cannot see the file: it was not shared with it, or the link is wrong
  | "not_video" // it is a file, but not a video (a document, a picture, a PDF …)
  | "not_downloadable" // the file's owner stopped viewers from downloading it, so Google will not give it to a "Viewer"
  | "quota" // Google limits how much of one file may be fetched in a day, or how often
  | "network" // Google could not be reached
  | "google_error" // Google had a problem of its own
  | "other";

export type DriveFailure = { ok: false; problem: DriveProblem; detail?: string; status?: number };
export type DriveAnswer<T> = { ok: true; data: T } | DriveFailure;

/** What a refusal from the Drive API means, from its status and its own words (the reason codes Google attaches, or the text). (Exported for the tests.) */
export function classifyDrive(status: number, said: string): DriveProblem {
  const s = said.toLowerCase();
  if (/has not been used in project|is disabled|service_disabled|accessnotconfigured|api has not been enabled/.test(s)) return "api_disabled";
  if (/cannotdownloadfile|cannot download|download.{0,30}(disabled|restricted|not allowed)|copyrequireswriterpermission/.test(s)) return "not_downloadable";
  if (/filenotdownloadable|only files with binary content|export with docs editors/.test(s)) return "not_video";
  if (/downloadquotaexceeded|ratelimitexceeded|userratelimitexceeded|dailylimitexceeded|quotaexceeded|resource_exhausted|too many users|quota/.test(s) || status === 429) return "quota";
  if (status === 401) return "key_rejected";
  if (status === 404 || /notfound|not found|insufficientfilepermissions|does not have permission|forbidden|permission_denied/.test(s) || status === 403) return "no_access";
  if (status >= 500) return "google_error";
  return "other";
}

/** The problems signing in can have are the same words here; anything else Google might say at that step is "other". */
const SIGN_IN_PROBLEMS: readonly string[] = ["not_configured", "key_invalid", "key_rejected", "network", "google_error"];
const signInProblem = (p: string): DriveProblem => (SIGN_IN_PROBLEMS.includes(p) ? (p as DriveProblem) : "other");

/** What Google said, shortened, with anything shaped like a key cut out. */
function said(text: string): string {
  try {
    const e = (JSON.parse(text) as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } }).error;
    if (e) return scrub(`${e.errors?.[0]?.reason ?? e.status ?? ""} ${e.message ?? ""}`);
  } catch {
    /* not JSON: use the text as it is */
  }
  return scrub(text);
}

/** Google answers in well under a second; a call that has not come back in 15 seconds is given up. (The video itself is not timed: it streams for as long as someone watches.) */
const TIMEOUT_MS = 15_000;

async function ask(url: string, token: string, headers: Record<string, string> = {}): Promise<{ res: Response } | { network: string }> {
  const ctl = new AbortController();
  // only the wait for Google's first answer is timed: once the video has started it must be allowed to run
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return { res: await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...headers }, signal: ctl.signal }) };
  } catch (e) {
    return { network: scrub(e instanceof Error ? e.message : "no answer") };
  } finally {
    clearTimeout(timer);
  }
}

/** The address the owner must share the video (or its folder) with. It is not a secret. */
export const driveShareEmail = (env: Env): string | null => serviceAccountEmail(env);
export const driveConfigured = (env: Env): boolean => parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT).ok;

/* ---------------------------------------------------------------------------------------------------- looking at a file */

export interface DriveFile {
  name: string;
  mime: string;
  /** bytes, when Google says */
  size: number | null;
  /** false = the file's owner switched off downloading for viewers (null = Google did not say) */
  can_download: boolean | null;
}

export const isMedia = (mime: string) => /^(video|audio)\//i.test(mime);

/** What the account can see of one file: its name, kind, size and whether it may be downloaded. One call; the pass is kept an hour. */
export async function driveInfo(env: Env, id: string, retried = false): Promise<DriveAnswer<DriveFile>> {
  const signed = await googleToken(env, DRIVE_SCOPE);
  if (!signed.ok) return { ok: false, problem: signInProblem(signed.problem), ...(signed.detail ? { detail: signed.detail } : {}), ...(signed.status ? { status: signed.status } : {}) };
  const fields = "id,name,mimeType,size,capabilities(canDownload),copyRequiresWriterPermission";
  const got = await ask(`${endpoints(env).drive}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`, signed.data, { Accept: "application/json" });
  if ("network" in got) return { ok: false, problem: "network", detail: got.network };
  const text = await got.res.text().catch(() => "");
  if (got.res.ok) {
    try {
      const f = JSON.parse(text) as { name?: string; mimeType?: string; size?: string; capabilities?: { canDownload?: boolean }; copyRequiresWriterPermission?: boolean };
      const can = typeof f.capabilities?.canDownload === "boolean" ? f.capabilities.canDownload : f.copyRequiresWriterPermission === true ? false : null;
      return { ok: true, data: { name: scrub(f.name ?? ""), mime: f.mimeType ?? "", size: f.size !== undefined && Number.isFinite(Number(f.size)) ? Number(f.size) : null, can_download: can } };
    } catch {
      return { ok: false, problem: "other", detail: "Google's answer could not be read.", status: got.res.status };
    }
  }
  // a pass that Google no longer accepts: sign in again, once
  if (got.res.status === 401 && !retried) {
    forgetPass();
    return driveInfo(env, id, true);
  }
  const detail = said(text);
  return { ok: false, problem: classifyDrive(got.res.status, `${detail} ${text}`), detail, status: got.res.status };
}

/** The checks behind "Check access": the link, then what the account can see of the file. */
export async function driveCheck(env: Env, url: string): Promise<DriveAnswer<DriveFile & { playable: "likely" | "unsure" }>> {
  const ref = driveRef(url);
  if (!ref) return { ok: false, problem: "not_drive_file" };
  if (ref.kind === "folder") return { ok: false, problem: "folder" };
  if (ref.kind !== "file") return { ok: false, problem: "not_drive_file" };
  const info = await driveInfo(env, ref.id);
  if (!info.ok) return info;
  if (!isMedia(info.data.mime)) return { ok: false, problem: "not_video", detail: info.data.mime ? scrub(info.data.mime) : undefined };
  if (info.data.can_download === false) return { ok: false, problem: "not_downloadable" };
  // Drive hands over the file as it was uploaded: MP4 (H.264) and WebM play in every browser, other containers (MOV, MKV, AVI …) may not
  return { ok: true, data: { ...info.data, playable: /^(video\/mp4|video\/webm|audio\/mpeg|audio\/mp4|audio\/aac|audio\/webm)$/i.test(info.data.mime) ? "likely" : "unsure" } };
}

/* ---------------------------------------------------------------------------------------------------- "can this account play it?" (remembered) */

const READABLE_YES_S = 600;
const READABLE_NO_S = 90;
const readableKey = (id: string) => `drive:readable:${id}`;

/**
 * Whether the lesson page may say "play it here" for this file: the account can read it, it is a video, and viewers may download it. Remembered
 * ten minutes (a "no" for a minute and a half, so a fix is felt quickly); never throws. With no key on the Worker it is false and Google is not asked.
 */
export async function driveReadable(env: Env, id: string): Promise<boolean> {
  if (!driveConfigured(env)) return false;
  try {
    const kept = await env.KV.get(readableKey(id));
    if (kept === "1") return true;
    if (kept === "0") return false;
    const info = await driveInfo(env, id);
    const yes = info.ok && isMedia(info.data.mime) && info.data.can_download !== false;
    // a problem that is Google's or the network's, not the file's, is not remembered: the next look asks again
    const settled = info.ok || ["no_access", "not_downloadable", "not_video"].includes(info.problem);
    if (settled) await env.KV.put(readableKey(id), yes ? "1" : "0", { expirationTtl: yes ? READABLE_YES_S : READABLE_NO_S });
    return yes;
  } catch {
    return false;
  }
}

/** Forget what was remembered about a file (the owner just pressed "Check access", perhaps after sharing it). */
export const forgetReadable = (env: Env, id: string) => env.KV.delete(readableKey(id));

/* ---------------------------------------------------------------------------------------------------- the video itself */

/** Where the last failure to fetch a student's video is kept (KV), so the owner can see it in the lesson editor. */
export const DRIVE_LAST_KEY = "drive:last";
export interface DriveLast {
  at: string;
  problem: DriveProblem;
  status: number | null;
}

async function rememberFailure(env: Env, problem: DriveProblem, status: number | null): Promise<void> {
  try {
    const before = await env.KV.get<DriveLast>(DRIVE_LAST_KEY, "json");
    // one note a minute at most: a video that fails makes the player ask again and again
    if (before && before.problem === problem && Date.now() - Date.parse(before.at) < 60_000) return;
    await env.KV.put(DRIVE_LAST_KEY, JSON.stringify({ at: new Date().toISOString(), problem, status } satisfies DriveLast));
  } catch {
    /* a note that cannot be kept must never break playback */
  }
}

/** A browser asks for a part of a video with `Range: bytes=START-END`, `bytes=START-` or `bytes=-LAST`. One range only; anything else is refused. */
export function parseRange(header: string | null): { ok: true; range: string | null } | { ok: false } {
  if (header === null || header.trim() === "") return { ok: true, range: null };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return { ok: false };
  if (m[1] !== "" && m[2] !== "" && Number(m[1]) > Number(m[2])) return { ok: false };
  return { ok: true, range: `bytes=${m[1]}-${m[2]}` };
}

const unavailable = (status: number) => new HttpError(status, "video_unavailable");

/**
 * The video, for the student's player: the whole file or the part asked for, streamed from Google with the account's read-only pass. The caller has
 * already checked that this person may watch this lesson. Only video and audio is ever handed on (a file of any other kind never leaves under this
 * address), and the answer is never kept by a cache. A video that cannot be fetched is a plain 404 (permanent) or 503 (try again), nothing more.
 */
export async function driveMedia(env: Env, id: string, rangeHeader: string | null, retried = false): Promise<Response> {
  const range = parseRange(rangeHeader);
  if (!range.ok) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */*", "Cache-Control": "private, no-store" } });
  const signed = await googleToken(env, DRIVE_SCOPE);
  if (!signed.ok) {
    console.warn("drive_media_no_pass", signed.problem);
    await rememberFailure(env, signInProblem(signed.problem), signed.status ?? null);
    throw unavailable(503);
  }
  const got = await ask(`${endpoints(env).drive}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, signed.data, { ...(range.range ? { Range: range.range } : {}), Accept: "*/*" });
  if ("network" in got) {
    console.warn("drive_media_network", got.network);
    await rememberFailure(env, "network", null);
    throw unavailable(503);
  }
  const res = got.res;

  if (res.status === 401 && !retried) {
    forgetPass();
    await res.body?.cancel().catch(() => undefined);
    return driveMedia(env, id, rangeHeader, true);
  }
  if (res.status === 416) {
    await res.body?.cancel().catch(() => undefined);
    return new Response(null, { status: 416, headers: { "Content-Range": res.headers.get("content-range") ?? "bytes */*", "Cache-Control": "private, no-store" } });
  }
  if (res.status !== 200 && res.status !== 206) {
    const text = await res.text().catch(() => "");
    const problem = classifyDrive(res.status, `${said(text)} ${text}`);
    console.warn("drive_media_refused", problem, res.status);
    await rememberFailure(env, problem, res.status);
    // the file is not there for this account / not a video / not downloadable: that will not change by asking again; anything else might
    throw unavailable(problem === "no_access" || problem === "not_video" || problem === "not_downloadable" || problem === "folder" ? 404 : 503);
  }

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const generic = type === "" || type === "application/octet-stream" || type === "binary/octet-stream";
  if (!generic && !isMedia(type)) {
    // a page, a PDF, a picture … must never be handed on under the website's own address
    await res.body?.cancel().catch(() => undefined);
    await rememberFailure(env, "not_video", res.status);
    throw unavailable(404);
  }
  const out = new Headers({
    "Content-Type": generic ? "video/mp4" : type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  });
  for (const h of ["Content-Length", "Content-Range"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}
