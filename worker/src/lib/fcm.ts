import type { Env } from "../env";
import { endpoints, forgetPass, googleToken, parseServiceAccount, scrub } from "./ga4";

/*
 * Notifications on the Android app, through Google's Firebase Cloud Messaging (FCM). The owner makes a Firebase project, adds the Android app
 * to it (its google-services.json goes into the app's build), and gives the Worker the project's service-account key (the secret
 * FIREBASE_SERVICE_ACCOUNT; or the shop's GOOGLE_SERVICE_ACCOUNT when its Google Cloud project is the Firebase project). Then:
 *   - a phone that allowed notifications gets an address from Google (a "registration token"); the app hands it to the Worker, which adds it
 *     to "topics": lang-bn / lang-en (news for everyone, in the phone's language) and class-<id> for each class its student studies;
 *   - one message to a topic (or to "this class AND this language") reaches every phone in it, whether the app is open, in the background or
 *     closed. A phone that is offline gets it when it is back online (within the message's time to live).
 * Signing in to Google is the same as for Analytics and Drive (lib/ga4.ts), with the kind of access that sends messages. Nothing here ever puts
 * the key in an answer, a log line or an error; what Google said is shown with anything shaped like a key cut out.
 */

/** One pass serves both jobs: sending (firebase.messaging) and adding phones to topics (the Instance ID service, which wants cloud-platform). */
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/cloud-platform";

/** The channel the app files its notifications under (mobile/src/push.ts makes it, with this id): the phone's settings show it by name. */
export const ANDROID_CHANNEL = "classes";
/** The app's accent colour: the small icon in the status bar is tinted with it. */
const ACCENT = "#FF5722";
/** Google answers in well under a second; a call that has not come back in 15 seconds is given up. */
const TIMEOUT_MS = 15_000;

export type PushProblem =
  | "not_configured" // there is no key on the Worker yet
  | "key_invalid" // the secret is not a service-account key file
  | "no_project" // the key file does not name its Google Cloud project
  | "key_rejected" // Google refused the key: deleted or disabled, or not the key of this account
  | "api_disabled" // the Firebase Cloud Messaging API is switched off in the project
  | "no_permission" // the account may not send this project's notifications (it lacks the role)
  | "project_missing" // Google knows no Firebase project of that name (Firebase was never added to the Google Cloud project)
  | "bad_message" // Google refused the message itself — a bug in this code, not the owner's setup
  | "quota" // too many at once
  | "network" // Google could not be reached
  | "google_error" // Google had a problem of its own
  | "other";

export type PushFailure = { ok: false; problem: PushProblem; detail?: string; status?: number };

export interface PushSetup {
  /** the key file the notifications are signed with */
  key: unknown;
  /** the Firebase project they go out from */
  project: string;
  /** the account's address (not a secret): the one to give a role in Google Cloud when Google says it may not send */
  email: string;
}

/** Which key the notifications are sent with, and from which project. It reads the secrets only: whether Google agrees is checkConnection's job. */
export function pushSetup(env: Env): { ok: true; setup: PushSetup } | PushFailure {
  const own = env.FIREBASE_SERVICE_ACCOUNT;
  // the Firebase project's own key when there is one (even a broken one: it is named so, rather than silently using another)
  const key = own !== undefined && own !== "" ? own : env.GOOGLE_SERVICE_ACCOUNT;
  const parsed = parseServiceAccount(key);
  if (!parsed.ok) return { ok: false, problem: parsed.problem };
  if (!parsed.account.project_id) return { ok: false, problem: "no_project" };
  return { ok: true, setup: { key, project: parsed.account.project_id, email: parsed.account.client_email } };
}

async function pass(env: Env): Promise<{ ok: true; token: string; setup: PushSetup } | PushFailure> {
  const s = pushSetup(env);
  if (!s.ok) return s;
  const t = await googleToken(env, FCM_SCOPE, s.setup.key);
  if (!t.ok) {
    // the sign-in's own problems are a subset of this list (not_configured, key_invalid, key_rejected, network, google_error)
    return { ok: false, problem: t.problem as PushProblem, ...(t.detail ? { detail: t.detail } : {}), ...(t.status ? { status: t.status } : {}) };
  }
  return { ok: true, token: t.data, setup: s.setup };
}

interface GoogleError {
  error?: { code?: number; message?: string; status?: string; details?: { reason?: string; errorCode?: string }[] } | string;
  error_description?: string;
}

/** What went wrong, from Google's answer to a send or a topic change. (Exported for the tests.) */
export function classifyPush(status: number, body: GoogleError, text: string): PushFailure {
  const e = typeof body.error === "object" && body.error ? body.error : null;
  const reasons = (e?.details ?? []).flatMap((d) => [d.reason, d.errorCode]).filter((r): r is string => !!r);
  const said = scrub(`${e?.status ?? (typeof body.error === "string" ? body.error : "")} ${e?.message ?? body.error_description ?? text}`);
  const message = e?.message ?? "";
  const of = (problem: PushProblem): PushFailure => ({ ok: false, problem, detail: said, status });
  if (status === 401) return of("key_rejected");
  if (status === 403) {
    if (reasons.includes("SERVICE_DISABLED") || /has not been used in project|is disabled|API has not been used/i.test(message)) return of("api_disabled");
    return of("no_permission");
  }
  if (status === 404) return of("project_missing");
  if (status === 429) return of("quota");
  if (status === 400) return of("bad_message");
  if (status >= 500) return of("google_error");
  return of("other");
}

async function call(url: string, token: string, body: unknown, extra: Record<string, string> = {}): Promise<{ ok: true; json: unknown } | PushFailure> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", ...extra },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, problem: "network", detail: scrub(e instanceof Error ? e.message : "no answer") };
  }
  const text = await res.text().catch(() => "");
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (res.ok) return { ok: true, json };
  // a pass Google no longer takes is forgotten, so the next try signs in afresh
  if (res.status === 401) forgetPass();
  return classifyPush(res.status, (json ?? {}) as GoogleError, text);
}

/* ---------------------------------------------------------------------------------------------------- sending */

export interface PushMessage {
  /** everyone in a topic ("lang-bn"), or the phones in several at once ("'class-3' in topics && 'lang-bn' in topics") */
  to: { topic: string } | { condition: string };
  title: string;
  body: string;
  /** what a tap opens: one of the app's own screens ("/", "/free/<slug>", "/course/<slug>") */
  path: string;
  /** more words for the app (all text): what kind of notification it is, and the send's number */
  data?: Record<string, string>;
  /** a phone that is offline longer than this never shows it (seconds; Google keeps a message at most 28 days) */
  ttlSeconds?: number;
  /** a later notification with the same tag replaces this one in the phone's list, instead of piling up */
  tag?: string;
}

/** The message as Firebase Cloud Messaging (HTTP v1) wants it. (Exported for the tests.) */
export function fcmBody(m: PushMessage, validateOnly = false): Record<string, unknown> {
  return {
    ...(validateOnly ? { validate_only: true } : {}),
    message: {
      ...m.to,
      notification: { title: m.title, body: m.body },
      data: { ...m.data, path: m.path },
      android: {
        // shown at once, even on a phone saving its battery; every one of these is a notification the person sees
        priority: "HIGH",
        ttl: `${Math.max(0, Math.min(m.ttlSeconds ?? 7 * 86_400, 28 * 86_400))}s`,
        notification: { channel_id: ANDROID_CHANNEL, color: ACCENT, ...(m.tag ? { tag: m.tag } : {}) },
      },
    },
  };
}

/** Send one message. `validateOnly`: Google checks everything (the key, the project, the right to send, the message) and delivers nothing. */
export async function fcmSend(env: Env, m: PushMessage, opts: { validateOnly?: boolean } = {}): Promise<{ ok: true; id: string } | PushFailure> {
  const p = await pass(env);
  if (!p.ok) return p;
  const r = await call(`${endpoints(env).fcm}/projects/${encodeURIComponent(p.setup.project)}/messages:send`, p.token, fcmBody(m, opts.validateOnly));
  if (!r.ok) return r;
  const name = (r.json as { name?: unknown }).name;
  return { ok: true, id: typeof name === "string" ? name : "" };
}

/** The check behind Admin → Android app → Check the connection: a message Google checks in full and delivers to no one. */
export async function checkConnection(env: Env): Promise<{ ok: true; project: string; email: string } | PushFailure> {
  const s = pushSetup(env);
  if (!s.ok) return s;
  const r = await fcmSend(env, { to: { topic: "lang-bn" }, title: "MAWAH Academy", body: "check", path: "/" }, { validateOnly: true });
  return r.ok ? { ok: true, project: s.setup.project, email: s.setup.email } : r;
}

/* ---------------------------------------------------------------------------------------------------- topics */

/** A phone address Google says it does not know (the app was removed, or the address was replaced): its row can go. */
const GONE = new Set(["NOT_FOUND", "INVALID_ARGUMENT"]);

/**
 * Add phones to a topic, or take them off (at most 1,000 at once). Google answers for each phone; `gone` lists the ones it does not know.
 * Taking a phone off a topic it was never in is not an error.
 */
export async function topicChange(env: Env, op: "add" | "remove", topic: string, tokens: string[]): Promise<{ ok: true; gone: string[] } | PushFailure> {
  if (!tokens.length) return { ok: true, gone: [] };
  const p = await pass(env);
  if (!p.ok) return p;
  const r = await call(`${endpoints(env).iid}:${op === "add" ? "batchAdd" : "batchRemove"}`, p.token, { to: `/topics/${topic}`, registration_tokens: tokens.slice(0, 1000) }, { access_token_auth: "true" });
  if (!r.ok) return r;
  const results = (r.json as { results?: { error?: string }[] }).results ?? [];
  const gone = tokens.filter((_, i) => {
    const error = results[i]?.error;
    return !!error && GONE.has(error) && op === "add";
  });
  return { ok: true, gone };
}
