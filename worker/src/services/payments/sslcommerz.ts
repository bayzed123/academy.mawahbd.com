import { PAY_VIA, sslcommerzUrl, viaOf, type PayMethodDTO, type PaymentMethod, type PayVia } from "@mawah/shared";
import type { Env } from "../../env";

/**
 * SSLCommerz — the Bangladeshi aggregator behind one hosted page for bKash, Nagad, Rocket and cards.
 * Flow: init session -> customer pays on the gateway page -> gateway calls our IPN (server to server)
 * -> we re-validate with SSLCommerz's validator API (never trusting the posted fields) -> enroll.
 * Credentials: SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD are Wrangler secrets.
 *
 * When SSLCommerz says no to a new session it says why (`failedreason`). That sentence is the only way anyone can tell "wrong keys" from
 * "this website is not the one the store was registered for" from "the gateway turned the server away", so it is kept — shortened, with the
 * keys cut out — and shown to the owner (Admin → Settings → Payments → Check the connection), never to the student.
 */
const BASE = { live: "https://securepay.sslcommerz.com", sandbox: "https://sandbox.sslcommerz.com" };

/** SSLCommerz answers in a second or two; a call that has not come back in 15 seconds is given up, so the checkout can say so instead of hanging. */
const TIMEOUT_MS = 15_000;

export const sslConfigured = (env: Env) => !!(env.SSLCOMMERZ_STORE_ID && env.SSLCOMMERZ_STORE_PASSWORD);
export const sslMode = (env: Env): "live" | "sandbox" => (env.PAYMENT_MODE === "live" ? "live" : "sandbox");
const base = (env: Env) => BASE[sslMode(env)];
export const sslHost = (env: Env) => new URL(base(env)).host;

/** The addresses the gateway sends the buyer and its own messages back to — the owner may have to tell SSLCommerz about them. */
export const sslReturnUrls = (env: Env) => ({
  success: `${env.SITE_URL}/api/payments/sslcommerz/success`,
  fail: `${env.SITE_URL}/api/payments/sslcommerz/fail`,
  cancel: `${env.SITE_URL}/api/payments/sslcommerz/cancel`,
  ipn: `${env.SITE_URL}/api/payments/sslcommerz/ipn`,
});

/** What went wrong with a new session, in the groups the admin screen explains in plain words (see adm.pay.p.* in the admin texts). */
export type SslProblem =
  | "not_configured" // the store ID / password are not on the Worker
  | "credentials" // SSLCommerz does not accept them: wrong, test keys on the live gateway (or the other way round), or the store is not active yet
  | "domain" // the store is registered for another website, or this address is not allowed
  | "blocked" // the gateway's firewall turned the request away (an address list, or a plain 403)
  | "amount_limit" // the store may not take this amount: SSLCommerz's own admin set a limit on how much one payment may be (only SSLCommerz can lift it)
  | "bad_details" // it refused the order's details (an amount, a name, a number …)
  | "network" // it could not be reached
  | "gateway_down" // it had an error of its own (5xx)
  | "other";

export type SslSession = { ok: true; redirectUrl: string; sessionKey: string; methods: PayMethodDTO[] } | { ok: false; problem: SslProblem; detail: string; status?: number };

const GROUPS: readonly PayMethodDTO["group"][] = ["mobile", "card", "bank", "other"];
/** SSLCommerz's own kind of a way of paying ("mobilebanking", "internetbanking", "visa", "master", "amex", "othercards" …) in four groups. */
function methodGroup(type: string): PayMethodDTO["group"] {
  const t = type.toLowerCase();
  if (t.includes("mobile")) return "mobile";
  if (t.includes("internet")) return "bank";
  if (/visa|master|amex|card/.test(t)) return "card";
  return "other";
}

/**
 * The ways of paying SSLCommerz offers this store, from its answer to a new session (`desc`: name, type, logo, gw, redirectGatewayURL): what the
 * buyer chooses from on the website after "Pay" — tapping bKash opens bKash's payment at once, without SSLCommerz's own list. Taken as SSLCommerz
 * sends it, so only what the store really has switched on is offered; an entry without an https address on sslcommerz.com is left out (and a
 * logo from anywhere else is not shown). Mobile wallets first — what most buyers here use — then cards, banks and the rest, each in SSLCommerz's
 * own order. (Exported for the tests.)
 */
export function sslMethods(desc: unknown): PayMethodDTO[] {
  if (!Array.isArray(desc)) return [];
  const found: PayMethodDTO[] = [];
  const seen = new Set<string>();
  for (const item of desc.slice(0, 120)) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const url = typeof d.redirectGatewayURL === "string" ? sslcommerzUrl(d.redirectGatewayURL) : null;
    const name = typeof d.name === "string" ? d.name.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (!url || !name || seen.has(url)) continue;
    seen.add(url);
    found.push({ name, via: viaOf(d), group: methodGroup(typeof d.type === "string" ? d.type : ""), logo: typeof d.logo === "string" ? sslcommerzUrl(d.logo) : null, url });
  }
  return GROUPS.flatMap((g) => found.filter((m) => m.group === g));
}

/** What SSLCommerz offered the shop last time (KV): the checkout's buttons under the online payment. Never an address to pay at — those are per payment. */
export const SSL_WAYS_KEY = "ssl:ways";
export type SslWays = { via: PayVia; logo: string | null }[];

/** Which of the checkout's buttons (PAY_VIA, in that order) SSLCommerz's list has, each with SSLCommerz's logo for it when it sent one. */
export function sslWays(methods: PayMethodDTO[]): SslWays {
  return PAY_VIA.filter((v) => methods.some((m) => m.via === v)).map((via) => ({ via, logo: methods.find((m) => m.via === via && m.logo)?.logo ?? null }));
}

/**
 * Keep what SSLCommerz just offered, for the next buyer's checkout. A session that came without a list says nothing about what is offered,
 * so it changes nothing; the same list as before is not written again.
 */
export async function rememberWays(env: Env, methods: PayMethodDTO[]): Promise<void> {
  if (!methods.length) return;
  const ways = JSON.stringify(sslWays(methods));
  if ((await env.KV.get(SSL_WAYS_KEY).catch(() => null)) === ways) return;
  await env.KV.put(SSL_WAYS_KEY, ways).catch(() => undefined);
}

/** The buttons for the checkout: what SSLCommerz offered last time, or null when it has not been asked yet. */
export async function offeredWays(env: Env): Promise<SslWays | null> {
  const ways = await env.KV.get<SslWays>(SSL_WAYS_KEY, "json").catch(() => null);
  return Array.isArray(ways) ? ways.filter((w) => w && (PAY_VIA as readonly string[]).includes(w.via)).map((w) => ({ via: w.via, logo: typeof w.logo === "string" ? sslcommerzUrl(w.logo) : null })) : null;
}

/** Where the outcome of the last attempt is kept (KV): Settings → Payments and the dashboard's health strip read it. */
export const SSL_LAST_KEY = "ssl:last";
export interface SslLast {
  at: string;
  ok: boolean;
  problem: SslProblem | null;
  detail: string | null;
  mode: "live" | "sandbox";
  /** a student's checkout, or the owner's "Check the connection" */
  by: "checkout" | "check";
}

export async function rememberSsl(env: Env, r: SslSession, by: SslLast["by"]): Promise<void> {
  const last: SslLast = { at: new Date().toISOString(), ok: r.ok, problem: r.ok ? null : r.problem, detail: r.ok ? null : r.detail, mode: sslMode(env), by };
  await env.KV.put(SSL_LAST_KEY, JSON.stringify(last)).catch(() => undefined);
}

/**
 * SSLCommerz refused a payment because of the store's limit per payment (KV). From that amount up the checkout says plainly that online payment
 * is not open for it yet and offers send-money instead, so buyers stop running into the refusal. The note is forgotten after a few hours (a
 * buyer then tries again, and a refusal sets it again), at once when a payment of that size or more is accepted, and by "Check the connection".
 */
export const SSL_CAP_KEY = "ssl:amount_cap";
export interface SslCap {
  /** the smallest amount SSLCommerz refused */
  from: number;
  at: string;
  detail: string;
}
const CAP_HOURS = 6;

export async function rememberCap(env: Env, total: number, detail: string): Promise<void> {
  const now = await amountCap(env);
  const cap: SslCap = { from: now ? Math.min(now.from, total) : total, at: new Date().toISOString(), detail };
  await env.KV.put(SSL_CAP_KEY, JSON.stringify(cap), { expirationTtl: CAP_HOURS * 3600 }).catch(() => undefined);
}

/** SSLCommerz accepted a payment of `total`: a limit noted at that amount or below no longer holds. */
export async function clearCap(env: Env, total: number): Promise<void> {
  const now = await amountCap(env);
  if (now && total >= now.from) await env.KV.delete(SSL_CAP_KEY).catch(() => undefined);
}

/** The limit SSLCommerz showed lately, or null. */
export async function amountCap(env: Env): Promise<SslCap | null> {
  const cap = await env.KV.get<SslCap>(SSL_CAP_KEY, "json").catch(() => null);
  if (!cap || typeof cap.from !== "number" || typeof cap.at !== "string") return null;
  return Date.now() - Date.parse(cap.at) < CAP_HOURS * 3600_000 ? cap : null;
}

/** What SSLCommerz (or the network) said, shortened: no markup, the store's keys cut out, and anything shaped like a token or a key too. */
export function scrubSsl(env: Env, s: string): string {
  let out = s.replace(/<[^>]*>/g, " ");
  for (const secret of [env.SSLCOMMERZ_STORE_ID, env.SSLCOMMERZ_STORE_PASSWORD]) {
    const v = secret?.trim();
    if (v) for (const form of new Set([v, encodeURIComponent(v)])) out = out.split(form).join("…");
  }
  return out
    .replace(/[A-Za-z0-9_-]{40,}/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * What a refusal means, from its status and its own words. The words are SSLCommerz's, not ours, so this reads them loosely; anything it does not
 * recognise is "other" and the screen shows the words as they are.
 */
export function sslProblem(status: number | undefined, said: string): SslProblem {
  if (status === undefined) return "network";
  const s = said.toLowerCase();
  if (/\bip\b.{0,40}(not|block|whitelist|allow|restrict|denied)|(not|block|whitelist|restrict|denied).{0,40}\bip\b|firewall/.test(s)) return "blocked";
  // "Transaction amount is not allowed as per admin configuration!": the store's own limit per payment, set at SSLCommerz — not the order's fault
  if (/admin configuration|amount.{0,40}(not allowed|not permitted|exceed|limit)|(exceed|above|over).{0,30}(limit|maximum)|transaction limit/.test(s)) return "amount_limit";
  if (/domain|web ?site|host ?name|referr?er|origin|(url|link).{0,30}(not|mismatch|differ|register|allow)|not (registered|whitelisted|allowed) for/.test(s)) return "domain";
  if (/credential|de-?activ|in-?activ|not active|suspend|store.{0,15}(id|passw)|invalid store|authenticat|unauthori[sz]ed/.test(s)) return "credentials";
  if (status >= 500) return "gateway_down";
  if (/amount|currency|tran_?id|transaction id|duplicate|customer|phone|e-?mail|cus_|product|param|mandatory|required|invalid (info|input|request|value|data)/.test(s)) return "bad_details";
  if (status === 401) return "credentials";
  if (status === 403 || status === 406 || status === 429) return "blocked";
  return "other";
}

export interface SslValidation {
  status: string; // VALID | VALIDATED | INVALID_TRANSACTION
  tran_id: string;
  val_id: string;
  amount: string;
  currency: string;
  bank_tran_id?: string;
  card_type?: string;
  risk_level?: string;
  risk_title?: string;
}

interface Buyer {
  name: string;
  email: string;
  phone: string;
  address?: string;
}

function sessionForm(env: Env, order: { public_id: string; total: number }, customer: Buyer, productName: string): URLSearchParams {
  const back = sslReturnUrls(env);
  return new URLSearchParams({
    store_id: env.SSLCOMMERZ_STORE_ID as string,
    store_passwd: env.SSLCOMMERZ_STORE_PASSWORD as string,
    total_amount: order.total.toFixed(2),
    currency: "BDT",
    tran_id: order.public_id,
    success_url: back.success,
    fail_url: back.fail,
    cancel_url: back.cancel,
    ipn_url: back.ipn,
    // one payment, never in instalments (the gateway lists this field as required)
    emi_option: "0",
    cus_name: customer.name.slice(0, 50),
    cus_email: customer.email,
    cus_add1: (customer.address || "Dhaka").replace(/\s+/g, " ").slice(0, 50),
    cus_city: "Dhaka",
    cus_postcode: "1000",
    cus_country: "Bangladesh",
    cus_phone: customer.phone || "01700000000",
    shipping_method: "NO",
    num_of_item: "1",
    product_name: productName.slice(0, 200),
    product_category: "Online Course",
    product_profile: "non-physical-goods",
  });
}

/** Ask SSLCommerz for a new payment session. Never throws: what went wrong comes back as words (see SslProblem). */
async function openSession(env: Env, form: URLSearchParams): Promise<SslSession> {
  let res: Response;
  try {
    res = await fetch(`${base(env)}/gwprocess/v4/api.php`, {
      method: "POST",
      headers: { Accept: "application/json", "User-Agent": "MAWAH-Academy/1.0 (+https://mawahacademy.com)" },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, problem: "network", detail: scrubSsl(env, e instanceof Error ? e.message : "no answer") };
  }
  const text = await res.text().catch(() => "");
  let json: { status?: unknown; GatewayPageURL?: unknown; sessionkey?: unknown; failedreason?: unknown; desc?: unknown } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    json = {};
  }
  if (res.ok && json.status === "SUCCESS" && typeof json.GatewayPageURL === "string" && json.GatewayPageURL) {
    return { ok: true, redirectUrl: json.GatewayPageURL, sessionKey: typeof json.sessionkey === "string" ? json.sessionkey : "", methods: sslMethods(json.desc) };
  }
  const said = scrubSsl(env, typeof json.failedreason === "string" && json.failedreason ? json.failedreason : text) || `HTTP ${res.status}`;
  return { ok: false, problem: sslProblem(res.status, said), detail: said, status: res.status };
}

export function sslInit(env: Env, order: { public_id: string; total: number }, customer: Buyer, productName: string): Promise<SslSession> {
  return openSession(env, sessionForm(env, order, customer, productName));
}

export type SslCheck =
  | {
      connected: true;
      mode: "live" | "sandbox";
      host: string;
      methods: string[];
      /** the connection works, but SSLCommerz refuses a payment as large as the shop's dearest class: what it said, and for which amount */
      limited?: { amount: number; detail: string };
    }
  | { connected: false; mode: "live" | "sandbox"; host: string; problem: SslProblem; detail?: string; status?: number };

/**
 * "Check the connection": open a session for a made-up 10-taka order, exactly as a purchase would, and read what SSLCommerz says. Nothing is
 * charged and nobody is sent to the gateway page (its address is thrown away); SSLCommerz only lists one unpaid test entry. When it works, the
 * names of the ways of paying SSLCommerz offers the store are kept (what buyers will choose from) — never their addresses.
 * Then the same for the shop's dearest class or bundle: a store can be connected and still have every real payment refused because SSLCommerz
 * limits how much one payment may be — a check of 10 taka alone said "Connected" while every sale was turned away.
 */
export async function sslCheck(env: Env): Promise<SslCheck> {
  const mode = sslMode(env);
  const host = sslHost(env);
  if (!sslConfigured(env)) return { connected: false, mode, host, problem: "not_configured" };
  const mail = (env.NOTIFY_EMAIL ?? "").trim() || "customer@mawahacademy.com";
  const ask = (total: number) => {
    const tran = `CHECK${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase().slice(0, 30);
    return openSession(env, sessionForm(env, { public_id: tran, total }, { name: "Connection check", email: mail, phone: "01700000000", address: "Dhaka" }, "Connection check"));
  };
  const failed = (r: Extract<SslSession, { ok: false }>): SslCheck => ({ connected: false, mode, host, problem: r.problem, detail: r.detail, ...(r.status ? { status: r.status } : {}) });

  const r = await ask(10);
  if (!r.ok) {
    await rememberSsl(env, r, "check");
    return failed(r);
  }
  await rememberWays(env, r.methods);
  const methods = r.methods.map((m) => m.name).slice(0, 60);
  const top = await dearestPrice(env);
  if (top > 10) {
    const big = await ask(top);
    if (!big.ok) {
      await rememberSsl(env, big, "check");
      if (big.problem !== "amount_limit") return failed(big);
      await rememberCap(env, top, big.detail);
      return { connected: true, mode, host, methods, limited: { amount: top, detail: big.detail } };
    }
    await clearCap(env, top);
  }
  await rememberSsl(env, r, "check");
  return { connected: true, mode, host, methods };
}

/** The highest price a buyer can be asked for: the dearest published class or bundle (SSLCommerz takes at most 500,000 taka in one payment). */
export async function dearestPrice(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT MAX(p) AS top FROM (SELECT MAX(price) AS p FROM courses WHERE status = 'published' UNION ALL SELECT MAX(price) FROM bundles WHERE status = 'published')",
  )
    .first<{ top: number | null }>()
    .catch(() => null);
  return Math.min(Math.max(0, Math.round(row?.top ?? 0)), 500_000);
}

/** Ask SSLCommerz whether `valId` is a genuine, completed payment. Returns null on any transport problem. */
export async function sslValidate(env: Env, valId: string): Promise<SslValidation | null> {
  const url = new URL(`${base(env)}/validator/api/validationserverAPI.php`);
  url.searchParams.set("val_id", valId);
  url.searchParams.set("store_id", env.SSLCOMMERZ_STORE_ID as string);
  url.searchParams.set("store_passwd", env.SSLCOMMERZ_STORE_PASSWORD as string);
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as SslValidation;
  } catch {
    return null;
  }
}

/** Decide whether a validation result is an acceptable payment for an order of `expectedTotal` BDT. */
export function sslAcceptable(v: SslValidation, publicId: string, expectedTotal: number): "ok" | "risky" | "reject" {
  if (v.status !== "VALID" && v.status !== "VALIDATED") return "reject";
  if (v.tran_id !== publicId || v.currency !== "BDT") return "reject";
  if (Math.abs(Number(v.amount) - expectedTotal) > 0.009) return "reject";
  // SSLCommerz flags risky payments (risk_level 1): hold them for a human instead of auto-enrolling
  if (v.risk_level && v.risk_level !== "0") return "risky";
  return "ok";
}

export function sslMethod(cardType: string | undefined): PaymentMethod {
  const t = (cardType ?? "").toLowerCase();
  if (t.includes("bkash")) return "bkash";
  if (t.includes("nagad")) return "nagad";
  if (t.includes("rocket") || t.includes("dbbl mobile")) return "rocket";
  return "card";
}
