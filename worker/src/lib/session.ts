import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isProd, type Ctx } from "../env";
import { randomToken, sha256Hex } from "./crypto";

/**
 * Opaque server-side sessions.
 *  - the cookie holds 256 random bits; KV stores only SHA-256(token) -> session data, so a KV dump is useless
 *  - __Host- prefixed, HttpOnly, Secure, SameSite cookies in production
 *  - students: 30-day sliding window (90 days max). staff: 12 h sliding window (24 h max), SameSite=Strict
 *  - password change / block sets users.sessions_valid_after, which invalidates every older session
 */
export type SessionKind = "student" | "staff";

interface SessionData {
  kind: SessionKind;
  id: number;
  created: number;
  seen: number;
  abs: number;
}

const CFG = {
  student: { cookie: "mawah_sid", ttl: 30 * 86400, abs: 90 * 86400, sameSite: "Lax" as const },
  staff: { cookie: "mawah_asid", ttl: 12 * 3600, abs: 24 * 3600, sameSite: "Strict" as const },
};

/** Non-secret hint cookie so cached marketing pages can show "My Learning" instead of "Log in". */
export const HINT_COOKIE = "mawah_in";

const cookieName = (c: Ctx, kind: SessionKind) => (isProd(c.env) ? `__Host-${CFG[kind].cookie}` : CFG[kind].cookie);
const kvKey = async (token: string) => `sess:${await sha256Hex(token)}`;

export async function createSession(c: Ctx, kind: SessionKind, id: number): Promise<void> {
  const cfg = CFG[kind];
  const token = randomToken(32);
  const now = Date.now();
  const data: SessionData = { kind, id, created: now, seen: now, abs: now + cfg.abs * 1000 };
  await c.env.KV.put(await kvKey(token), JSON.stringify(data), { expirationTtl: cfg.ttl });
  setCookie(c, cookieName(c, kind), token, {
    httpOnly: true,
    secure: isProd(c.env),
    sameSite: cfg.sameSite,
    path: "/",
    maxAge: cfg.ttl,
  });
  if (kind === "student") {
    setCookie(c, HINT_COOKIE, "1", { httpOnly: false, secure: isProd(c.env), sameSite: "Lax", path: "/", maxAge: cfg.ttl });
  }
}

export async function readSession(c: Ctx, kind: SessionKind): Promise<SessionData | null> {
  const token = getCookie(c, cookieName(c, kind));
  if (!token || token.length > 128) return null;
  const key = await kvKey(token);
  const data = await c.env.KV.get<SessionData>(key, "json");
  if (!data || data.kind !== kind) return null;
  const now = Date.now();
  if (now > data.abs) {
    await c.env.KV.delete(key);
    return null;
  }
  // sliding refresh, at most once per hour per session to keep KV writes low
  if (now - data.seen > 3600 * 1000) {
    const ttl = Math.max(60, Math.min(CFG[kind].ttl, Math.floor((data.abs - now) / 1000)));
    c.executionCtx.waitUntil(c.env.KV.put(key, JSON.stringify({ ...data, seen: now }), { expirationTtl: ttl }));
  }
  return data;
}

export async function destroySession(c: Ctx, kind: SessionKind): Promise<void> {
  const name = cookieName(c, kind);
  const token = getCookie(c, name);
  if (token) await c.env.KV.delete(await kvKey(token));
  deleteCookie(c, name, { path: "/", secure: isProd(c.env) });
  if (kind === "student") deleteCookie(c, HINT_COOKIE, { path: "/", secure: isProd(c.env) });
}
