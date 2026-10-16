import { waNumber } from "@mawah/shared";
import { isDev, type Env } from "../env";

/*
 * Text messages (SMS) through the Bangladeshi SMS company the shop uses (msg.mram.com.bd). Two secrets, both set by the owner in Cloudflare
 * (or as GitHub secrets, which the deploy copies there): SMS_API_KEY — the key from the company's panel — and SMS_API_URL — the company's
 * address. The sender name (the "sender ID" the company approved for the shop) is a setting in Admin → Settings → SMS.
 *
 * Nothing here ever puts the key in an error, a log line or an answer: the company's own words are shown, with the key cut out.
 * A message that cannot be sent never breaks what the visitor was doing — callers send it after the page has been answered.
 */

export interface SmsMessage {
  /** the student's number as stored (01XXXXXXXXX, or +country code for a number abroad) */
  to: string;
  text: string;
}

export type SmsProblem = "not_configured" | "url_invalid" | "key_rejected" | "sender_rejected" | "masking_bangla" | "no_balance" | "number_rejected" | "ip_blocked" | "network" | "provider_error" | "other";

export interface SmsResult {
  ok: boolean;
  provider: "sms" | "dev-outbox" | "none";
  /** the company's own reference for the message, when it gave one */
  id?: string;
  problem?: SmsProblem;
  /** what the company answered, shortened, with the key cut out (shown to the owner in Settings → SMS) */
  detail?: string;
  status?: number;
}

export const smsConfigured = (env: Env): boolean => !!(env.SMS_API_KEY?.trim() && env.SMS_API_URL?.trim());

/**
 * Where the company's addresses are. The owner may have saved the company's website address, its sending address, or one of its example
 * links — with or without the leading "https://" (a bare name like msg.example.com is taken as https). Plain http is refused.
 */
export function smsEndpoints(raw: string | undefined): { origin: string; send: string } | null {
  let url: URL;
  try {
    const text = (raw ?? "").trim();
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  // the key travels with every request: only over https
  if (url.protocol !== "https:" || !url.hostname.includes(".")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  const sendingAddress = path !== "" && !/^\/miscapi(\/|$)/i.test(path);
  return { origin: url.origin, send: sendingAddress ? `${url.origin}${path}` : `${url.origin}/smsapi` };
}

/** What the company said, shortened, and with the key (or anything shaped like it) cut out. */
function scrub(env: Env, s: string): string {
  let out = s;
  const key = env.SMS_API_KEY?.trim();
  // the key as written, and as it looks inside a web address (an error message may quote the address the request went to)
  if (key) for (const form of new Set([key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)])) out = out.split(form).join("…");
  return out.replace(/\s+/g, " ").trim().slice(0, 300);
}

const FAILED = /invalid|incorrect|unauthori[sz]ed|forbidden|denied|insufficient|not enough|low balance|expired|blocked|suspended|disabled|not found|missing|required|fail|error|reject|refus|whitelist|not allowed|wrong/i;
const WORKED = /success|submitted|accepted|queued|\bsent\b|delivered|\b202\b/i;

/** Read the company's answer. Different companies answer differently: a number in `response_code`, a word in `status`, or plain text. */
function readReply(status: number, raw: string): { ok: boolean; id?: string } {
  if (status < 200 || status >= 300) return { ok: false };
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
  } catch {
    json = null;
  }
  const idOf = (j: Record<string, unknown> | null) => {
    for (const k of ["message_id", "messageId", "sms_id", "smsid", "shoot_id", "sms_shoot_id", "id"]) {
      const v = j?.[k];
      if (typeof v === "string" || typeof v === "number") return String(v).slice(0, 60);
    }
    return undefined;
  };
  if (json && "response_code" in json) return { ok: Number(json.response_code) === 202, id: idOf(json) };
  if (json && typeof json.success === "boolean") return { ok: json.success, id: idOf(json) };
  if (json && typeof json.status === "string") return { ok: /^(ok|success|sent|submitted|accepted|queued)/i.test(json.status), id: idOf(json) };
  // {"error": 0, ...} is "no error"; anything else in that field is one
  if (json && "error" in json) return { ok: [0, "0", "", false, null].includes(json.error as never), id: idOf(json) };
  if (FAILED.test(raw) && !WORKED.test(raw)) return { ok: false };
  return { ok: true, id: idOf(json) };
}

/** What a refusal means, from the company's words — the admin screen explains each in plain words with the steps. */
export function smsProblem(status: number | undefined, said: string): SmsProblem {
  if (status === undefined) return "network";
  const s = said.toLowerCase();
  if (/whitelist|ip (address )?(is )?(not|blocked)|1032/.test(s)) return "ip_blocked";
  if (/balance|insufficient|credit|1006|1007/.test(s)) return "no_balance";
  // a masking (brand-name) sender may only send Bangla text
  if (/bengali|bangla|1012/.test(s)) return "masking_bangla";
  // 1003 = a required field is missing: the only one the shop may leave out is the sender ID
  if (/sender ?id|senderid|masking|1002|1003|1013|1014/.test(s)) return "sender_rejected";
  if (/api.?key|unauthori|authenticat|invalid user|user not found|1011|1018|1031/.test(s) || status === 401 || status === 403) return "key_rejected";
  if (/number|contact|mobile|phone|1001/.test(s)) return "number_rejected";
  if (status >= 500) return "provider_error";
  return "other";
}

const isUnicode = (text: string) => /[^\u0000-\u007f]/.test(text);

/** Dev and tests: with no secrets, messages are kept in the same outbox as e-mails (read at /api/dev/outbox?to=<number>), so flows can be checked without sending. */
async function toOutbox(env: Env, msg: SmsMessage): Promise<SmsResult> {
  const key = `outbox:${String(Date.now()).padStart(14, "0")}:${Math.random().toString(36).slice(2, 8)}`;
  await env.KV.put(key, JSON.stringify({ to: msg.to, subject: "SMS", html: "", text: msg.text, sms: true, at: new Date().toISOString() }), { expirationTtl: 3600 });
  return { ok: true, provider: "dev-outbox" };
}

/** Where the result of the last real message is kept, so Settings → SMS can show whether the messages students get are really going out. */
export const SMS_LAST_KEY = "sms:last";
export interface SmsLast {
  at: string;
  ok: boolean;
  problem: SmsProblem | null;
  detail: string | null;
}

async function remember(env: Env, r: SmsResult): Promise<void> {
  const last: SmsLast = { at: new Date().toISOString(), ok: r.ok, problem: r.problem ?? null, detail: r.ok ? null : (r.detail ?? null) };
  await env.KV.put(SMS_LAST_KEY, JSON.stringify(last)).catch(() => undefined);
}

/**
 * Send one text message. Never throws. `sender` is the sender ID from Settings → SMS (empty = the company's default).
 * One request in the company's JSON format; if the address does not take that, once more as a plain web address with the same details.
 */
export async function sendSms(env: Env, msg: SmsMessage, opts: { sender?: string; remember?: boolean } = {}): Promise<SmsResult> {
  const text = msg.text.slice(0, 480);
  if (!smsConfigured(env)) {
    if (isDev(env)) return toOutbox(env, { ...msg, text });
    console.warn("sms_not_configured");
    return { ok: false, provider: "none", problem: "not_configured", detail: "SMS_API_KEY / SMS_API_URL missing" };
  }
  const where = smsEndpoints(env.SMS_API_URL);
  if (!where) return { ok: false, provider: "sms", problem: "url_invalid", detail: "SMS_API_URL is not an https address" };

  const fields: Record<string, string> = {
    api_key: env.SMS_API_KEY!.trim(),
    type: isUnicode(text) ? "unicode" : "text",
    contacts: waNumber(msg.to),
    ...(opts.sender?.trim() ? { senderid: opts.sender.trim() } : {}),
    msg: text,
    label: "transactional",
  };

  const asPost = () => fetch(where.send, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(fields), signal: AbortSignal.timeout(10_000) });
  const asWebAddress = () => fetch(`${where.send}?${new URLSearchParams(fields)}`, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });

  let result: SmsResult;
  try {
    let res = await asPost();
    let raw = await res.text().catch(() => "");
    // the address does not take JSON (not found / not allowed / unsupported / bad request), or it answers "a required field is missing"
    // because it never read the body: once more as a plain web address with the same details
    if ([400, 404, 405, 415, 422].includes(res.status) || Number(asObject(raw)?.response_code) === 1003) {
      res = await asWebAddress();
      raw = await res.text().catch(() => "");
    }
    const said = scrub(env, raw);
    const read = readReply(res.status, raw);
    result = read.ok ? { ok: true, provider: "sms", id: read.id, status: res.status } : { ok: false, provider: "sms", problem: smsProblem(res.status, said), detail: said || `HTTP ${res.status}`, status: res.status };
  } catch (err) {
    result = { ok: false, provider: "sms", problem: "network", detail: scrub(env, err instanceof Error ? err.message : "network") };
  }
  if (opts.remember !== false) await remember(env, result);
  if (!result.ok) console.warn("sms_failed", result.problem, result.detail);
  return result;
}

export interface BalanceResult {
  ok: boolean;
  balance: number | null;
  problem?: SmsProblem;
  detail?: string;
  status?: number;
}

function asObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The number in a "balance" answer: a field named like balance / credit / remaining (also one level down), or — for a plain-text answer — the first number in it. */
function balanceFrom(raw: string): number | null {
  const asNumber = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const m = /-?\d+(?:\.\d+)?/.exec(v.replace(/[,৳\s]/g, ""));
      return m ? Number(m[0]) : null;
    }
    return null;
  };
  const json = asObject(raw);
  if (json) {
    const named = (o: Record<string, unknown>): number | null => {
      for (const [k, v] of Object.entries(o)) if (/bal|credit|remain|available|amount/i.test(k) && !/code/i.test(k)) return asNumber(v);
      return null;
    };
    const direct = named(json);
    if (direct !== null) return direct;
    for (const v of Object.values(json)) {
      const inner = v && typeof v === "object" && !Array.isArray(v) ? named(v as Record<string, unknown>) : null;
      if (inner !== null) return inner;
    }
    return null; // an answer in JSON with no balance in it: not something to guess a number from
  }
  return asNumber(raw);
}

/** The SMS credit left at the company (its "getBalance" address). The number is whatever the company reports, in its own unit. */
export async function smsBalance(env: Env): Promise<BalanceResult> {
  if (!smsConfigured(env)) return { ok: false, balance: null, problem: "not_configured", detail: "SMS_API_KEY / SMS_API_URL missing" };
  const where = smsEndpoints(env.SMS_API_URL);
  if (!where) return { ok: false, balance: null, problem: "url_invalid", detail: "SMS_API_URL is not an https address" };
  try {
    const res = await fetch(`${where.origin}/miscapi/${encodeURIComponent(env.SMS_API_KEY!.trim())}/getBalance`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    const raw = await res.text().catch(() => "");
    const said = scrub(env, raw);
    const code = asObject(raw)?.response_code;
    const refused = res.status < 200 || res.status >= 300 || (code !== undefined && Number(code) !== 202);
    const balance = refused ? null : balanceFrom(raw);
    if (refused || balance === null || (FAILED.test(said) && !/\d/.test(said))) return { ok: false, balance: null, problem: smsProblem(res.status, said), detail: said || `HTTP ${res.status}`, status: res.status };
    return { ok: true, balance, detail: said, status: res.status };
  } catch (err) {
    return { ok: false, balance: null, problem: "network", detail: scrub(env, err instanceof Error ? err.message : "network") };
  }
}

/* ------------------------------------------------------------------------------------------------ what a visitor may set off */

const VISITOR_PER_NUMBER_PER_HOUR = 3;
const VISITOR_PER_DAY = 300;

/**
 * A text message a visitor can set off (a sign-in link for "I forgot my password"): a few per number per hour and a cap for the whole site per
 * day, so nobody can run up the SMS bill. Counts the message when it says yes.
 */
export async function allowVisitorSms(env: Env, phone: string): Promise<boolean> {
  const hour = Math.floor(Date.now() / 3_600_000);
  const day = new Date().toISOString().slice(0, 10);
  const mine = `sms:v:${phone}:${hour}`;
  const all = `sms:v:all:${day}`;
  const [a, b] = await Promise.all([env.KV.get(mine), env.KV.get(all)]);
  if (Number(a ?? 0) >= VISITOR_PER_NUMBER_PER_HOUR || Number(b ?? 0) >= VISITOR_PER_DAY) return false;
  await Promise.all([env.KV.put(mine, String(Number(a ?? 0) + 1), { expirationTtl: 3700 }), env.KV.put(all, String(Number(b ?? 0) + 1), { expirationTtl: 2 * 86_400 })]);
  return true;
}
