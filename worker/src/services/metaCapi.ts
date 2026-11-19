import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { isNoEmail } from "@mawah/shared";
import type { AppEnv, Env } from "../env";
import { decryptSecret, sha256Hex } from "../lib/crypto";
import { all, first, nowIso, run } from "../lib/db";
import { getSettings } from "../lib/settings";
import { measuringAllowed, regionOf } from "../lib/tracking";

/**
 * Meta Conversions API: the purchase, told to Meta by this server.
 *
 * The browser's Meta Pixel reports a purchase when the buyer sees their paid order — but an ad blocker, a closed tab, or a send-money
 * payment that staff approve hours later all lose it. So when an order is paid, the server reports the same purchase too, with the same
 * event ID ("purchase." + the order's code): Meta keeps one of the two (deduplication) and still hears it when the browser could not tell.
 *
 * Who is reported: only a buyer who may be counted — not with "Do Not Track" or Global Privacy Control, not after the footer's "stop
 * counting", and in Europe/UK only after a yes (the same rules as the browser's script, marketing/analytics.js). What is sent: the order
 * (the classes, the amount), Meta's own first-party cookies (_fbp, _fbc), the browser and its address as they were at checkout, and the
 * e-mail, mobile number, name and student number SCRAMBLED (SHA-256) as Meta requires — never in plain text. Nothing is sent from a test
 * or development copy of the site, nor without the owner's Pixel ID and access token.
 */
/**
 * The Graph API version the server sends to when the owner has not chosen one (Admin → Settings → Analytics). Meta keeps each version for
 * about two years; when it refuses the chosen one, this one is tried at once, so a stale or mistyped version never loses a purchase.
 */
export const DEFAULT_GRAPH_VERSION = "v24.0";
const TIMEOUT_MS = 8_000;
/** Where the access token pasted in Admin → Settings → Analytics is kept (encrypted; never read back to the screen). */
export const TOKEN_KEY = "meta_capi_token";
/** The latest answer from Meta, for the owner's screen ("is it really working?"). */
export const LAST_KEY = "meta_capi_last";

export interface AdTrack {
  /** may this buyer be counted (and so reported)? */
  ok: boolean;
  fbp?: string;
  fbc?: string;
  ip?: string;
  ua?: string;
  url?: string;
}

/** The token: the one pasted in the admin (encrypted at rest), else the Worker secret META_CAPI_TOKEN. */
export async function capiToken(env: Env): Promise<{ token: string | null; source: "admin" | "secret" | "none"; hint: string | null }> {
  const row = await first<{ value: string }>(env.DB, "SELECT value FROM settings WHERE key = ?", TOKEN_KEY);
  if (row) {
    try {
      const v = JSON.parse(row.value) as { enc?: string; hint?: string };
      const plain = v.enc ? await decryptSecret(v.enc, [env.APP_SECRET, env.APP_SECRET_PREVIOUS].filter((s): s is string => !!s)) : null;
      if (plain) return { token: plain, source: "admin", hint: v.hint ?? null };
    } catch {
      /* a broken row is treated as none */
    }
  }
  if (env.META_CAPI_TOKEN) return { token: env.META_CAPI_TOKEN, source: "secret", hint: `••••${env.META_CAPI_TOKEN.slice(-4)}` };
  return { token: null, source: "none", hint: null };
}

/** The owner's Pixel (dataset) ID, the token and the test code — or null when the Conversions API is not set up. */
export async function capiConfig(env: Env): Promise<{ pixel: string; token: string; testCode: string; version: string } | null> {
  const s = await getSettings(env);
  const pixel = s.analytics.meta_pixel.trim();
  if (!/^\d{8,20}$/.test(pixel)) return null;
  const { token } = await capiToken(env);
  if (!token) return null;
  return { pixel, token, testCode: s.analytics.meta_capi_test.trim(), version: graphVersion(s.analytics.meta_graph_version) };
}

/** The owner's chosen Graph API version when it looks like one ("v27.0"), else the built-in one. */
export const graphVersion = (v: string | undefined) => (v && /^v\d{2,3}\.0$/.test(v.trim()) ? v.trim() : DEFAULT_GRAPH_VERSION);

/* ------------------------------------------------------------------------------------- at checkout: who is buying */
const COOKIE_VALUE = /^[A-Za-z0-9._-]{8,500}$/;

/**
 * What the buyer's browser says about this visit, read at checkout: kept with the order, so the purchase can be reported however late it is
 * paid. Nothing at all is kept when the buyer may not be counted, or when this copy of the site does not measure (a test or developer copy).
 */
export function adTrackFrom(c: Context<AppEnv>): AdTrack {
  if (!measuringAllowed(c.env, c.req.url)) return { ok: false };
  const h = (n: string) => c.req.header(n) ?? "";
  const said = h("dnt") === "1" || h("sec-gpc") === "1" || getCookie(c, "mawah_measure") === "off";
  // Europe and the UK: only after a yes (the browser's script says "on" once the visitor accepted)
  const country = h("cf-ipcountry") || ((c.req.raw as { cf?: { country?: string } }).cf?.country ?? "");
  const askFirst = regionOf(country, "row") === "eu" && getCookie(c, "mawah_measure") !== "on";
  if (said || askFirst) return { ok: false };
  const fbp = getCookie(c, "_fbp");
  const fbc = getCookie(c, "_fbc");
  const site = c.env.SITE_URL.replace(/\/$/, "");
  const ref = h("referer");
  return {
    ok: true,
    fbp: fbp && COOKIE_VALUE.test(fbp) ? fbp : undefined,
    fbc: fbc && COOKIE_VALUE.test(fbc) ? fbc : undefined,
    ip: c.get("ip") && c.get("ip") !== "unknown" ? c.get("ip") : undefined,
    ua: h("user-agent").slice(0, 500) || undefined,
    // the page the purchase was made on (the checkout), only when it is this site's own
    url: ref.startsWith(`${site}/`) ? ref.split("#")[0].slice(0, 500) : `${site}/app/checkout`,
  };
}

export async function rememberAdTrack(c: Context<AppEnv>, orderId: number): Promise<void> {
  const t = adTrackFrom(c);
  if (t.ok) await run(c.env.DB, "UPDATE orders SET ad_track = ? WHERE id = ?", JSON.stringify(t), orderId);
}

/* ------------------------------------------------------------------------------------------------ scrambling */
const norm = {
  email: (e: string) => e.trim().toLowerCase(),
  /** Bangladesh mobile numbers with the country code, digits only (01712345678 → 8801712345678) */
  phone: (p: string) => {
    const d = p.replace(/\D/g, "");
    if (/^01\d{9}$/.test(d)) return `88${d}`;
    if (/^8801\d{9}$/.test(d)) return d;
    return d.length >= 8 ? d : "";
  },
  name: (n: string) => n.trim().toLowerCase().replace(/[^\p{L}\p{M}]/gu, ""),
};
const hash = async (v: string) => (v ? sha256Hex(v) : undefined);

/** The buyer, as Meta wants them: everything that identifies a person scrambled (SHA-256), Meta's own cookies and the browser as they are. */
export async function userData(p: { email: string | null; phone: string | null; name: string | null; studentId: number }, t: AdTrack): Promise<Record<string, unknown>> {
  const [first, ...rest] = (p.name ?? "").trim().split(/\s+/);
  const email = p.email && !isNoEmail(p.email) ? norm.email(p.email) : "";
  const out: Record<string, unknown> = {
    em: email ? [await hash(email)] : undefined,
    ph: p.phone && norm.phone(p.phone) ? [await hash(norm.phone(p.phone))] : undefined,
    fn: first ? [await hash(norm.name(first))] : undefined,
    ln: rest.length ? [await hash(norm.name(rest[rest.length - 1]))] : undefined,
    country: [await hash("bd")],
    external_id: [await hash(`student-${p.studentId}`)],
    fbp: t.fbp,
    fbc: t.fbc,
    client_ip_address: t.ip,
    client_user_agent: t.ua,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined || (Array.isArray(out[k]) && (out[k] as unknown[]).some((x) => x === undefined))) delete out[k];
  return out;
}

/* --------------------------------------------------------------------------------------------------- sending */
export interface CapiResult {
  ok: boolean;
  received?: number;
  detail: string;
  trace?: string;
}

/** Send events to Meta. The token travels in the request body, never in the address, so it cannot end up in any log. */
export async function sendEvents(env: Env, cfg: { pixel: string; token: string; testCode?: string; version?: string }, events: Record<string, unknown>[]): Promise<CapiResult> {
  const version = graphVersion(cfg.version);
  const r = await post(cfg, version, events);
  // a version Meta does not know or no longer serves: tried once more with the built-in one
  if (!r.ok && version !== DEFAULT_GRAPH_VERSION && /version|unknown path|unsupported/i.test(r.detail)) {
    const again = await post(cfg, DEFAULT_GRAPH_VERSION, events);
    return again.ok ? { ...again, detail: `${again.detail} (sent with ${DEFAULT_GRAPH_VERSION}: Meta refused ${version})` } : again;
  }
  return r;
}

async function post(cfg: { pixel: string; token: string; testCode?: string }, version: string, events: Record<string, unknown>[]): Promise<CapiResult> {
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${version}/${cfg.pixel}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ data: events, access_token: cfg.token, ...(cfg.testCode ? { test_event_code: cfg.testCode } : {}) }),
    });
  } catch (err) {
    return { ok: false, detail: err instanceof DOMException && err.name === "TimeoutError" ? "timeout" : "network" };
  }
  const body = (await res.json().catch(() => ({}))) as { events_received?: number; fbtrace_id?: string; error?: { message?: string; code?: number; error_user_msg?: string } };
  if (!res.ok || body.error) {
    // Meta's own words (the token is never in them), shortened
    const said = (body.error?.error_user_msg || body.error?.message || `HTTP ${res.status}`).replace(/EAA[A-Za-z0-9]{10,}/g, "••••").slice(0, 240);
    return { ok: false, detail: `${body.error?.code ? `#${body.error.code} ` : ""}${said}`, trace: body.fbtrace_id };
  }
  return { ok: true, received: body.events_received ?? 0, detail: `events_received: ${body.events_received ?? 0}`, trace: body.fbtrace_id };
}

async function remember(env: Env, r: CapiResult, event: string, test: boolean): Promise<void> {
  try {
    await env.KV.put(LAST_KEY, JSON.stringify({ at: nowIso(), event, test, ok: r.ok, detail: r.detail, trace: r.trace ?? null }));
  } catch {
    /* only a status for the screen */
  }
}

export async function lastResult(env: Env): Promise<{ at: string; event: string; test: boolean; ok: boolean; detail: string; trace: string | null } | null> {
  try {
    return (await env.KV.get(LAST_KEY, "json")) as never;
  } catch {
    return null;
  }
}

/**
 * A paid order, reported to Meta as a Purchase — once. Called when the order is paid (markOrderPaid), whoever paid it: SSLCommerz's
 * confirmation, or staff approving a send-money or Bangla QR payment. Does nothing for a free class, an order made by staff, a buyer who
 * may not be counted, or when the Conversions API is not set up. Never throws.
 */
export async function reportPurchase(env: Env, orderId: number): Promise<void> {
  try {
    const cfg = await capiConfig(env);
    if (!cfg) return;
    // claim it first, so a repeated payment confirmation never reports it twice
    const claim = await run(env.DB, "UPDATE orders SET capi_sent_at = ? WHERE id = ? AND capi_sent_at IS NULL AND ad_track IS NOT NULL AND total > 0 AND status = 'paid'", nowIso(), orderId);
    if ((claim.meta.changes ?? 0) === 0) return;
    const o = await first<{ public_id: string; total: number; paid_at: string; ad_track: string; student_id: number; customer_email: string | null; customer_phone: string | null; customer_name: string | null }>(
      env.DB,
      "SELECT public_id, total, paid_at, ad_track, student_id, customer_email, customer_phone, customer_name FROM orders WHERE id = ?",
      orderId,
    );
    if (!o) return;
    const t = JSON.parse(o.ad_track) as AdTrack;
    if (!t.ok) return;
    const items = await all<{ slug: string | null; course_id: number; price: number }>(
      env.DB,
      "SELECT c.slug, oi.course_id, oi.price FROM order_items oi LEFT JOIN courses c ON c.id = oi.course_id WHERE oi.order_id = ? ORDER BY oi.id",
      orderId,
    );
    // the same ids the browser uses for a class (its address name), so both reports describe the same purchase
    const ids = items.map((i) => i.slug ?? String(i.course_id));
    const event = {
      event_name: "Purchase",
      event_time: Math.floor(Date.parse(o.paid_at) / 1000),
      event_id: `purchase.${o.public_id}`,
      action_source: "website",
      event_source_url: t.url,
      user_data: await userData({ email: o.customer_email, phone: o.customer_phone, name: o.customer_name, studentId: o.student_id }, t),
      custom_data: {
        currency: "BDT",
        value: o.total,
        order_id: o.public_id,
        content_type: "product",
        content_ids: ids,
        contents: items.map((i, n) => ({ id: ids[n], quantity: 1, item_price: i.price })),
        num_items: items.length,
      },
    };
    const r = await sendEvents(env, { ...cfg, testCode: cfg.testCode || undefined }, [event]);
    await remember(env, r, "Purchase", !!cfg.testCode);
    if (r.ok) await run(env.DB, "UPDATE orders SET ad_track = NULL WHERE id = ?", orderId); // reported: nothing more is kept
    else {
      await run(env.DB, "UPDATE orders SET capi_sent_at = NULL WHERE id = ?", orderId); // not taken: it may be tried again
      console.warn("meta_capi_failed", orderId, r.detail);
    }
  } catch (err) {
    console.error("meta_capi_error", orderId, err instanceof Error ? err.message : err);
  }
}

/** Purchases Meta did not take (it was down, or the token was being changed): tried again by the hourly job, within Meta's 7 days. */
export async function retryPurchases(env: Env): Promise<number> {
  if (!(await capiConfig(env))) return 0;
  const rows = await all<{ id: number }>(
    env.DB,
    "SELECT id FROM orders WHERE status = 'paid' AND ad_track IS NOT NULL AND capi_sent_at IS NULL AND total > 0 AND paid_at > ? ORDER BY paid_at LIMIT 25",
    nowIso(new Date(Date.now() - 6 * 86400 * 1000)),
  );
  for (const r of rows) await reportPurchase(env, r.id);
  return rows.length;
}

/** The owner's "Send a test event": a Purchase marked with the test code, so it shows only in Events Manager → Test events. */
export async function sendTestEvent(env: Env, testCode: string, site: string): Promise<CapiResult> {
  const s = await getSettings(env);
  const pixel = s.analytics.meta_pixel.trim();
  const { token } = await capiToken(env);
  if (!/^\d{8,20}$/.test(pixel)) return { ok: false, detail: "no_pixel" };
  if (!token) return { ok: false, detail: "no_token" };
  const now = Math.floor(Date.now() / 1000);
  const r = await sendEvents(env, { pixel, token, testCode, version: s.analytics.meta_graph_version }, [
    {
      event_name: "Purchase",
      event_time: now,
      event_id: `test.${now}`,
      action_source: "website",
      event_source_url: `${site.replace(/\/$/, "")}/app/checkout`,
      user_data: { country: [await sha256Hex("bd")], client_user_agent: "MAWAH Academy server test", external_id: [await sha256Hex("test")] },
      custom_data: { currency: "BDT", value: 1, content_type: "product", content_ids: ["test"], num_items: 1 },
    },
  ]);
  await remember(env, r, "Purchase (test)", true);
  return r;
}
