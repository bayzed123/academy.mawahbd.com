import { isProd, type Env } from "../env";

/*
 * Reading the shop's Google Analytics 4 numbers (Admin → Analytics). The owner makes a "service account" in Google Cloud, adds its e-mail
 * address as a Viewer of the Analytics property, and puts the account's key file in the secret GA4_SERVICE_ACCOUNT_JSON (or as the GitHub secret
 * of that name, which the deploy copies there). Nothing here ever puts the key — or any part of it — in an answer, a log line or an error:
 * what Google said is shown, with anything shaped like a key cut out.
 *
 * How it talks to Google, in plain steps:
 *   1. the key file is read (the file itself, or that text in base64);
 *   2. a short note is signed with the account's private key (RS256, with the browser's own crypto) and sent to Google's sign-in address;
 *   3. Google answers with a pass that works for an hour; the pass is kept in memory until shortly before it runs out;
 *   4. the pass is shown to the Analytics Data API with a question ("how many page views did each class page get?"), and the answer is read.
 * Every failure is named in words the owner can act on (see Ga4Problem) — "the API is switched off in your Google project" is
 * a different job from "the account has not been added to the property".
 */

/** Where the outcome of the last look at Google is kept (KV): the Analytics screen and the dashboard's health strip both read it. */
export const GA4_LAST_KEY = "ga4:last";

export type Ga4Problem =
  | "not_configured" // there is no key on the Worker yet
  | "key_invalid" // the secret is not a service-account key file
  | "key_rejected" // Google refused the key: it was deleted or disabled, or is not the key of this account
  | "api_disabled" // the Google Analytics Data API is switched off in the Google Cloud project
  | "no_access" // the account has not been added to the property (or with a role that cannot read)
  | "property_missing" // the property number is wrong
  | "bad_request" // Google refused the question itself (a field it does not know) — a bug in this code, not the owner's setup
  | "quota" // too many questions at once
  | "network" // Google could not be reached
  | "google_error" // Google had a problem of its own
  | "other";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export type Failure = { ok: false; problem: Ga4Problem; detail?: string; status?: number };
export type Answer<T> = { ok: true; data: T } | Failure;

/** Google answers in well under a second; a call that has not come back in 15 seconds is given up, so the screen can say so instead of waiting. */
const TIMEOUT_MS = 15_000;
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_DATA = "https://analyticsdata.googleapis.com/v1beta";

/** Google's addresses. Only a development or test machine may point them at a stand-in (the dev Worker itself); the real site never can. */
function endpoints(env: Env): { token: string; data: string } {
  const base = !isProd(env) ? (env.GOOGLE_API_BASE ?? "").trim().replace(/\/+$/, "") : "";
  return base ? { token: `${base}/token`, data: `${base}/v1beta` } : { token: GOOGLE_TOKEN, data: GOOGLE_DATA };
}

export const propertyId = (env: Env): string => (env.GA_PROPERTY_ID ?? "").replace(/\D/g, "");

/* ---------------------------------------------------------------------------------------------------- the key file */

const decodeUtf8Base64 = (b64: string): string => {
  const bin = atob(b64.replace(/\s+/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
};

/**
 * Reads the secret: the key file as Google gives it, or that file's text in base64 (some places cannot hold a multi-line value), or the file as an
 * object (what the Worker receives when the owner adds it in the Cloudflare dashboard as a "JSON" variable instead of a secret). Never throws.
 */
export function parseServiceAccount(raw: unknown): { ok: true; account: ServiceAccount } | { ok: false; problem: "not_configured" | "key_invalid" } {
  let json: unknown;
  if (raw && typeof raw === "object") json = raw;
  else {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return { ok: false, problem: "not_configured" };
    try {
      json = JSON.parse(text.startsWith("{") ? text : decodeUtf8Base64(text));
    } catch {
      return { ok: false, problem: "key_invalid" };
    }
  }
  const j = json as Record<string, unknown> | null;
  const email = typeof j?.client_email === "string" ? j.client_email.trim() : "";
  // a key pasted through some forms has its line breaks written out as backslash-n: put them back
  const key = typeof j?.private_key === "string" ? j.private_key.replace(/\\n/g, "\n").trim() : "";
  if (!j || (j.type !== undefined && j.type !== "service_account") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(key)) {
    return { ok: false, problem: "key_invalid" };
  }
  return { ok: true, account: { client_email: email, private_key: key, ...(typeof j.private_key_id === "string" ? { private_key_id: j.private_key_id } : {}) } };
}

/** The address the owner must add to Google Analytics → Admin → Property access management. It is not a secret. */
export function serviceAccountEmail(env: Env): string | null {
  const parsed = parseServiceAccount(env.GA4_SERVICE_ACCOUNT_JSON);
  return parsed.ok ? parsed.account.client_email : null;
}

/** What Google (or the network) said, shortened, with anything shaped like a key cut out. */
export function scrub(s: string): string {
  return s
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "…")
    .replace(/[A-Za-z0-9_-]{40,}/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/* ---------------------------------------------------------------------------------------------------- sign-in */

const b64url = (data: string | ArrayBuffer): string => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const pemToDer = (pem: string): ArrayBuffer => {
  const body = pem.replace(/-----BEGIN [A-Z ]+-----/, "").replace(/-----END [A-Z ]+-----/, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

/** The signed note that asks Google for a pass: who we are, what we want to read, until when. (Exported for the tests.) */
export async function signedNote(account: ServiceAccount, audience: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", ...(account.private_key_id ? { kid: account.private_key_id } : {}) }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: audience, iat: nowSec, exp: nowSec + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(signature)}`;
}

let pass: { token: string; until: number; who: string } | null = null;

/** Forget the pass (tests, and when Google says it no longer works). */
export function forgetPass(): void {
  pass = null;
}

async function signIn(env: Env): Promise<Answer<string>> {
  const parsed = parseServiceAccount(env.GA4_SERVICE_ACCOUNT_JSON);
  if (!parsed.ok) return { ok: false, problem: parsed.problem };
  const { account } = parsed;
  if (pass && pass.who === account.client_email && pass.until - Date.now() > 5 * 60_000) return { ok: true, data: pass.token };

  const audience = endpoints(env).token;
  let note: string;
  try {
    note = await signedNote(account, audience);
  } catch {
    // the text looked like a key but the browser's crypto cannot read it: it was damaged on the way (cut off, edited)
    return { ok: false, problem: "key_invalid", detail: "The private key in the key file cannot be read." };
  }
  let res: Response;
  try {
    res = await fetch(audience, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: note }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, problem: "network", detail: scrub(e instanceof Error ? e.message : "no answer") };
  }
  const text = await res.text().catch(() => "");
  let body: { access_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = {};
  }
  if (res.ok && typeof body.access_token === "string") {
    const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
    pass = { token: body.access_token, until: Date.now() + seconds * 1000, who: account.client_email };
    return { ok: true, data: body.access_token };
  }
  const said = scrub(`${typeof body.error === "string" ? body.error : ""} ${typeof body.error_description === "string" ? body.error_description : text}`);
  if (res.status >= 500) return { ok: false, problem: "google_error", detail: said, status: res.status };
  // invalid_grant = the signature does not match a key Google knows (deleted, disabled, or another account's); invalid_scope / unauthorized_client likewise
  return { ok: false, problem: "key_rejected", detail: said, status: res.status };
}

/* ---------------------------------------------------------------------------------------------------- the questions */

export interface Cell {
  dimensions: string[];
  metrics: number[];
}
export interface Table {
  dimensionNames: string[];
  metricNames: string[];
  rows: Cell[];
  /** the totals row GA4 adds when asked (metricAggregations TOTAL), if any */
  totals: number[] | null;
}

interface RawReport {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  totals?: { metricValues?: { value?: string }[] }[];
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** GA4 answers in strings; the screens want numbers. (Exported for the tests.) */
export function toTable(raw: RawReport): Table {
  return {
    dimensionNames: (raw.dimensionHeaders ?? []).map((h) => h.name),
    metricNames: (raw.metricHeaders ?? []).map((h) => h.name),
    rows: (raw.rows ?? []).map((r) => ({ dimensions: (r.dimensionValues ?? []).map((d) => d.value ?? ""), metrics: (r.metricValues ?? []).map((m) => num(m.value)) })),
    totals: raw.totals?.[0]?.metricValues ? raw.totals[0].metricValues.map((m) => num(m.value)) : null,
  };
}

/** What a refusal from the Analytics Data API means, from its status and its own words. (Exported for the tests.) */
export function classify(status: number, said: string): Ga4Problem {
  const s = said.toLowerCase();
  if (/has not been used in project|is disabled|service_disabled|accessnotconfigured|api has not been enabled/.test(s)) return "api_disabled";
  if (status === 401) return "key_rejected";
  if (status === 403 || /permission_denied|does not have sufficient permissions|user does not have/.test(s)) return "no_access";
  if (status === 404 || (/propert/.test(s) && /not found|invalid|does not exist/.test(s))) return "property_missing";
  if (status === 429 || /resource_exhausted|quota/.test(s)) return "quota";
  if (status === 400) return "bad_request";
  if (status >= 500) return "google_error";
  return "other";
}

async function ask(env: Env, kind: "runReport" | "runRealtimeReport", body: unknown, retried = false): Promise<Answer<Table>> {
  const property = propertyId(env);
  if (!property) return { ok: false, problem: "property_missing", detail: "GA_PROPERTY_ID is not set." };
  const signed = await signIn(env);
  if (!signed.ok) return signed;
  let res: Response;
  try {
    res = await fetch(`${endpoints(env).data}/properties/${property}:${kind}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${signed.data}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, problem: "network", detail: scrub(e instanceof Error ? e.message : "no answer") };
  }
  const text = await res.text().catch(() => "");
  if (res.ok) {
    try {
      return { ok: true, data: toTable(JSON.parse(text) as RawReport) };
    } catch {
      return { ok: false, problem: "other", detail: "Google's answer could not be read.", status: res.status };
    }
  }
  // a pass that Google no longer accepts: sign in again, once
  if (res.status === 401 && !retried) {
    forgetPass();
    return ask(env, kind, body, true);
  }
  let said = text;
  try {
    const e = (JSON.parse(text) as { error?: { message?: string; status?: string } }).error;
    said = `${e?.status ?? ""} ${e?.message ?? ""}`;
  } catch {
    /* not JSON: use the text as it is */
  }
  const detail = scrub(said);
  return { ok: false, problem: classify(res.status, detail), detail, status: res.status };
}

export const runReport = (env: Env, body: unknown) => ask(env, "runReport", body);
export const runRealtime = (env: Env, body: unknown) => ask(env, "runRealtimeReport", body);

/** The smallest question there is: used by "Check the connection". */
export const checkConnection = (env: Env) => runReport(env, { dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }] });
