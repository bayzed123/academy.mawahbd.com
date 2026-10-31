import type { Env } from "../env";
import { isDev } from "../env";
import { all, first, nowIso, run } from "../lib/db";

/*
 * The couriers the Equipment Shop sends its parcels with: Steadfast (its API lives at portal.packzy.com) and Pathao. Staff press "Send
 * to Steadfast" or "Send to Pathao" on a confirmed order (Admin → Shop → Orders): the Worker books the parcel with the courier's own API,
 * keeps the courier's numbers for it, and the order is on its way. Afterwards each courier tells the site what happens to the parcel
 * through its webhook (routes/api/courier.ts); a delivered parcel closes the order, a parcel that comes back or is cancelled is put in
 * front of the owner. The keys are the Worker's secrets — never in the code, never shown, never logged — and a courier without its keys
 * is simply not offered.
 */

export type Courier = "steadfast" | "pathao";
export const COURIERS: readonly Courier[] = ["steadfast", "pathao"];

const ADDRESS: Record<Courier, string> = { steadfast: "https://portal.packzy.com/api/v1", pathao: "https://api-hermes.pathao.com" };

/** The courier's API: its own address, or another one set for it (Pathao's sandbox for a trial; a stand-in in local development). */
function base(env: Env, c: Courier): string {
  const set = (c === "steadfast" ? env.STEADFAST_BASE_URL : env.PATHAO_BASE_URL)?.trim().replace(/\/+$/, "");
  return set && (/^https:\/\/[^\s/]+/.test(set) || isDev(env)) ? set : ADDRESS[c];
}

/** The courier's keys are on the Worker. */
export function hasKeys(env: Env, c: Courier): boolean {
  return c === "steadfast" ? !!(env.STEADFAST_API_KEY?.trim() && env.STEADFAST_SECRET_KEY?.trim()) : !!(env.PATHAO_CLIENT_ID?.trim() && env.PATHAO_CLIENT_SECRET?.trim());
}

/** What a courier answered: its data, or why not — in a word for the screen, with the courier's own sentence when it gave one. */
export type CourierReply<T> = { ok: true; data: T } | { ok: false; problem: "no_keys" | "no_store" | "refused" | "unreachable"; status?: number; detail?: string };

/** The courier's own words out of an answer: its message, or its list of what was wrong with the fields — short, never a key. */
export function courierSaid(body: unknown): string {
  if (typeof body === "string") return body.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof b.message === "string") parts.push(b.message);
  for (const errs of [b.errors, (b.data as Record<string, unknown> | undefined)?.errors]) {
    if (errs && typeof errs === "object") {
      for (const [k, v] of Object.entries(errs as Record<string, unknown>)) parts.push(`${k}: ${Array.isArray(v) ? v.join(" ") : String(v)}`);
    }
  }
  return parts.join(" · ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** One request: the answer's status and body (JSON when it is JSON), or null when the courier could not be reached in time. */
async function call(url: string, init: RequestInit): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let body: unknown = text.slice(0, 2000);
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON: kept as text */
    }
    return { status: res.status, body };
  } catch {
    return null;
  }
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

/** What a parcel needs, whichever courier carries it. */
export interface Parcel {
  /** the shop's order code: Steadfast's "invoice", Pathao's "merchant_order_id" */
  code: string;
  name: string;
  phone: string;
  /** the whole address in one line: house and road, union, upazila, district, division */
  address: string;
  /** the cash the courier collects (0 = paid online already) */
  cod: number;
  /** how many things are in it */
  items: number;
  /** what is in it, for the courier's label */
  description: string;
  /** for the rider (the buyer's note and the shop's) */
  note: string;
  /** kilograms (Pathao asks; Steadfast does not) */
  weight: number;
}

/** A parcel the courier took: its own number for it, the code the buyer can track it by, its first word on it, and its fee if it said. */
export interface Booked {
  cid: string;
  tracking: string;
  status: string;
  fee: number | null;
}

/* ------------------------------------------------------------------------------------------------------------------ Steadfast */

const steadfastHeaders = (env: Env) => ({ ...JSON_HEADERS, "Api-Key": env.STEADFAST_API_KEY!.trim(), "Secret-Key": env.STEADFAST_SECRET_KEY!.trim() });

/** The money in the shop's Steadfast account — also the check that the keys work. */
export async function steadfastBalance(env: Env): Promise<CourierReply<{ balance: number }>> {
  if (!hasKeys(env, "steadfast")) return { ok: false, problem: "no_keys" };
  const r = await call(`${base(env, "steadfast")}/get_balance`, { headers: steadfastHeaders(env) });
  if (!r) return { ok: false, problem: "unreachable" };
  const b = r.body as { status?: number; current_balance?: number | string } | null;
  if (r.status === 200 && b && Number(b.status) === 200) return { ok: true, data: { balance: Number(b.current_balance ?? 0) || 0 } };
  return { ok: false, problem: "refused", status: r.status, detail: courierSaid(r.body) };
}

export async function steadfastBook(env: Env, p: Parcel): Promise<CourierReply<Booked>> {
  if (!hasKeys(env, "steadfast")) return { ok: false, problem: "no_keys" };
  const r = await call(`${base(env, "steadfast")}/create_order`, {
    method: "POST",
    headers: steadfastHeaders(env),
    body: JSON.stringify({
      invoice: p.code,
      recipient_name: p.name.slice(0, 100),
      recipient_phone: p.phone,
      recipient_address: p.address.slice(0, 250),
      cod_amount: p.cod,
      note: p.note.slice(0, 250),
      item_description: p.description.slice(0, 250),
      total_lot: p.items,
      delivery_type: 0,
    }),
  });
  if (!r) return { ok: false, problem: "unreachable" };
  const b = r.body as { status?: number; consignment?: { consignment_id?: number | string; tracking_code?: string; status?: string } } | null;
  const c = b?.consignment;
  if (r.status === 200 && Number(b?.status) === 200 && c?.consignment_id) {
    return { ok: true, data: { cid: String(c.consignment_id), tracking: String(c.tracking_code ?? ""), status: String(c.status ?? "in_review"), fee: null } };
  }
  return { ok: false, problem: "refused", status: r.status, detail: courierSaid(r.body) };
}

/* --------------------------------------------------------------------------------------------------------------------- Pathao */

const PATHAO_TOKEN = "courier:pathao:token";

/**
 * A Pathao access token, kept (in KV, until shortly before it runs out) so a booking does not log in each time. Pathao has two ways in:
 * the client id and secret with the merchant's login e-mail and password (the older "issue-token"), or the client id and secret alone
 * ("external/login"); the first is used when the login is given.
 */
async function pathaoToken(env: Env, fresh: boolean): Promise<CourierReply<string>> {
  if (!hasKeys(env, "pathao")) return { ok: false, problem: "no_keys" };
  if (!fresh) {
    const kept = await env.KV.get(PATHAO_TOKEN);
    if (kept) return { ok: true, data: kept };
  }
  const id = env.PATHAO_CLIENT_ID!.trim();
  const secret = env.PATHAO_CLIENT_SECRET!.trim();
  const login = env.PATHAO_USERNAME?.trim() && env.PATHAO_PASSWORD ? { username: env.PATHAO_USERNAME.trim(), password: env.PATHAO_PASSWORD } : null;
  const r = await call(`${base(env, "pathao")}/aladdin/api/v1/${login ? "issue-token" : "external/login"}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(login ? { client_id: id, client_secret: secret, ...login, grant_type: "password" } : { client_id: id, client_secret: secret }),
  });
  if (!r) return { ok: false, problem: "unreachable" };
  // issue-token answers at the top level, external/login inside "data"
  const b = (r.body ?? {}) as Record<string, unknown>;
  const d = (typeof b.access_token === "string" ? b : ((b.data ?? {}) as Record<string, unknown>)) as { access_token?: unknown; expires_in?: unknown };
  if (r.status >= 200 && r.status < 300 && typeof d.access_token === "string" && d.access_token) {
    const life = Number(d.expires_in) || 3600;
    await env.KV.put(PATHAO_TOKEN, d.access_token, { expirationTtl: Math.max(60, Math.min(life, 30 * 86_400) - 600) });
    return { ok: true, data: d.access_token };
  }
  return { ok: false, problem: "refused", status: r.status, detail: courierSaid(r.body) };
}

/** A request to Pathao with the token; a token Pathao no longer takes is replaced once. */
async function pathao(env: Env, path: string, init: RequestInit = {}): Promise<CourierReply<{ status: number; body: unknown }>> {
  for (const fresh of [false, true]) {
    const t = await pathaoToken(env, fresh);
    if (!t.ok) return t;
    const r = await call(`${base(env, "pathao")}${path}`, { ...init, headers: { ...JSON_HEADERS, Authorization: `Bearer ${t.data}` } });
    if (!r) return { ok: false, problem: "unreachable" };
    if (r.status === 401 && !fresh) {
      await env.KV.delete(PATHAO_TOKEN);
      continue;
    }
    return { ok: true, data: r };
  }
  return { ok: false, problem: "refused", status: 401 };
}

export interface PathaoStore {
  id: number;
  name: string;
  address: string;
  active: boolean;
}

/** The shop's stores in Pathao (where a parcel is picked up) — also the check that the keys work. */
export async function pathaoStores(env: Env): Promise<CourierReply<PathaoStore[]>> {
  const r = await pathao(env, "/aladdin/api/v1/stores");
  if (!r.ok) return r;
  const b = r.data.body as { data?: { data?: unknown } } | null;
  const list = Array.isArray(b?.data?.data) ? (b!.data!.data as Record<string, unknown>[]) : null;
  if (r.data.status !== 200 || !list) return { ok: false, problem: "refused", status: r.data.status, detail: courierSaid(r.data.body) };
  return {
    ok: true,
    data: list
      .map((s) => ({ id: Number(s.store_id), name: String(s.store_name ?? ""), address: String(s.store_address ?? ""), active: s.is_active === undefined ? true : !!Number(s.is_active) }))
      .filter((s) => Number.isInteger(s.id) && s.id > 0),
  };
}

export async function pathaoBook(env: Env, p: Parcel, o: { store: number; delivery: 48 | 12 }): Promise<CourierReply<Booked>> {
  if (!hasKeys(env, "pathao")) return { ok: false, problem: "no_keys" };
  if (!o.store) return { ok: false, problem: "no_store" };
  const r = await pathao(env, "/aladdin/api/v1/orders", {
    method: "POST",
    body: JSON.stringify({
      store_id: o.store,
      merchant_order_id: p.code,
      recipient_name: p.name.slice(0, 100),
      recipient_phone: p.phone,
      recipient_address: p.address.slice(0, 220),
      delivery_type: o.delivery,
      item_type: 2,
      special_instruction: p.note.slice(0, 250),
      item_quantity: p.items,
      item_weight: p.weight,
      amount_to_collect: p.cod,
      item_description: p.description.slice(0, 250),
    }),
  });
  if (!r.ok) return r;
  const b = r.data.body as { data?: { consignment_id?: string; order_status?: string; delivery_fee?: number | string } } | null;
  const d = b?.data;
  if (r.data.status >= 200 && r.data.status < 300 && d?.consignment_id) {
    const fee = Number(d.delivery_fee);
    return { ok: true, data: { cid: String(d.consignment_id), tracking: String(d.consignment_id), status: String(d.order_status ?? "Pending"), fee: Number.isFinite(fee) ? fee : null } };
  }
  return { ok: false, problem: "refused", status: r.data.status, detail: courierSaid(r.data.body) };
}

/* ------------------------------------------------------------------------------------------------------- what the couriers say */

/**
 * What a courier's word about a parcel means for the order: delivered (the order is done); attention (it came back, was cancelled, could
 * not be delivered, is on hold, or only part of it was delivered — the owner is told, and decides); or just news (picked up, at the hub,
 * on the way …). Steadfast says "delivered", "partial_delivered", "cancelled", "pending", "hold" …; Pathao names events
 * ("order.delivered", "order.returned", "order.delivery-failed" …). Unknown words are news: they are kept and shown, never acted on.
 */
export type CourierMeaning = "delivered" | "attention" | "news";
export function courierMeaning(word: string): CourierMeaning {
  const w = word.toLowerCase();
  if (/partial|return|cancel|fail|lost|damage|hold/.test(w)) return "attention";
  if (/(^|[._-])delivered$/.test(w)) return "delivered";
  return "news";
}

/** The order a courier's message is about: by its own number for the parcel, or by the shop's order code it was given. */
export async function orderForCourier(env: Env, c: Courier, cid: string, code: string): Promise<{ id: number; public_id: string; status: string; name: string; phone: string; total: number; payment: string } | null> {
  const cols = "id, public_id, status, name, phone, total, payment";
  if (cid) {
    const byCid = await first<{ id: number; public_id: string; status: string; name: string; phone: string; total: number; payment: string }>(env.DB, `SELECT ${cols} FROM shop_orders WHERE courier = ? AND courier_cid = ?`, c, cid);
    if (byCid) return byCid;
  }
  if (code) return first(env.DB, `SELECT ${cols} FROM shop_orders WHERE public_id = ? AND courier = ?`, code, c);
  return null;
}

/**
 * Keep a courier's word about an order: in its history, as the order's latest, and — when it says the parcel was delivered — the
 * order is marked delivered (only from "shipped": an order staff already closed is never reopened by a courier).
 */
export async function recordCourierWord(env: Env, order: { id: number; status: string }, c: Courier, w: { event: string; status: string; message: string }): Promise<CourierMeaning> {
  const now = nowIso();
  const meaning = courierMeaning(w.status || w.event);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO courier_events (order_id, courier, event, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(order.id, c, w.event.slice(0, 60), w.status.slice(0, 60), w.message.slice(0, 500), now),
    // a sentence with no status (Steadfast's "tracking_update") leaves the last status as it was
    env.DB.prepare("UPDATE shop_orders SET courier_status = COALESCE(NULLIF(?, ''), courier_status), courier_at = ?, updated_at = ? WHERE id = ?").bind(w.status.slice(0, 60), now, now, order.id),
  ]);
  if (meaning === "delivered") {
    await run(env.DB, "UPDATE shop_orders SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ? AND status = 'shipped'", now, now, order.id);
  }
  return meaning;
}

/** An order's parcel history, oldest first (Admin → Shop → Orders). */
export async function courierEvents(env: Env, orderId: number) {
  return all<{ courier: Courier; event: string; status: string; message: string; created_at: string }>(
    env.DB,
    "SELECT courier, event, status, message, created_at FROM courier_events WHERE order_id = ? ORDER BY id",
    orderId,
  );
}
