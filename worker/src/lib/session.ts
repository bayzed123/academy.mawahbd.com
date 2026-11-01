import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isProd, type Ctx } from "../env";
import { randomToken, sha256Hex } from "./crypto";

/**
 * Opaque server-side sessions.
 *  - the cookie holds 256 random bits; KV stores only SHA-256(token) -> session data, so a KV dump is useless
 *  - __Host- prefixed, HttpOnly, Secure, SameSite cookies in production
 *  - students: 30-day sliding window (90 days max). staff: 12 h sliding window (24 h max), SameSite=Strict
 *  - password change / block sets users.sessions_valid_after, which invalidates every older session
 *  - the Android app keeps its token itself and sends it as `Authorization: Bearer <token>` (students only, see bearerToken)
 */
export type SessionKind = "student" | "staff";

interface SessionData {
  kind: SessionKind;
  id: number;
  created: number;
  seen: number;
  abs: number;
  /** started by the Android app (its token comes as a Bearer header, never as a cookie) */
  app?: true;
}

const CFG = {
  student: { cookie: "mawah_sid", ttl: 30 * 86400, abs: 90 * 86400, sameSite: "Lax" as const },
  staff: { cookie: "mawah_asid", ttl: 12 * 3600, abs: 24 * 3600, sameSite: "Strict" as const },
};

/** Non-secret hint cookie so cached marketing pages can show "My Learning" instead of "Log in". */
export const HINT_COOKIE = "mawah_in";

const cookieName = (c: Ctx, kind: SessionKind) => (isProd(c.env) ? `__Host-${CFG[kind].cookie}` : CFG[kind].cookie);
const kvKey = async (token: string) => `sess:${await sha256Hex(token)}`;

/**
 * The token the Android app sends, from `Authorization: Bearer <token>`. Only a student's session is ever read from it: staff sessions stay
 * cookie-only, so no one can reach Admin with a header. A browser never sends this header by itself, so another website cannot make a
 * signed-in request with it (the cookie's CSRF guard is not needed for it).
 */
const BEARER = /^Bearer ([A-Za-z0-9_-]{20,128})$/;
function bearerToken(c: Ctx): string | null {
  const m = BEARER.exec(c.req.header("authorization")?.trim() ?? "");
  return m ? m[1] : null;
}

/** True when this request was signed in by the app's token (a password change on the app must hand the app its new token, not a cookie). */
export const viaApp = (c: Ctx): boolean => bearerToken(c) !== null;

/**
 * Starts a session and returns its token. A browser gets it in an HttpOnly cookie. The app (`app: true`, students only) gets no cookie: the
 * caller returns the token in the JSON answer, the app keeps it in the phone's encrypted storage and sends it back as a Bearer header.
 * Both last the same: 30 days from the last use, at most 90 days.
 */
export async function createSession(c: Ctx, kind: SessionKind, id: number, opts: { app?: boolean } = {}): Promise<string> {
  const cfg = CFG[kind];
  const token = randomToken(32);
  const now = Date.now();
  const app = !!opts.app && kind === "student";
  const data: SessionData = { kind, id, created: now, seen: now, abs: now + cfg.abs * 1000, ...(app ? { app: true } : {}) };
  await c.env.KV.put(await kvKey(token), JSON.stringify(data), { expirationTtl: cfg.ttl });
  if (app) return token;
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
  return token;
}

export async function readSession(c: Ctx, kind: SessionKind): Promise<SessionData | null> {
  const token = (kind === "student" ? bearerToken(c) : null) ?? getCookie(c, cookieName(c, kind));
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
  const bearer = kind === "student" ? bearerToken(c) : null;
  if (bearer) {
    // the app signing out: its token stops working at once (the app forgets it too)
    await c.env.KV.delete(await kvKey(bearer));
    return;
  }
  const name = cookieName(c, kind);
  const token = getCookie(c, name);
  if (token) await c.env.KV.delete(await kvKey(token));
  deleteCookie(c, name, { path: "/", secure: isProd(c.env) });
  if (kind === "student") deleteCookie(c, HINT_COOKIE, { path: "/", secure: isProd(c.env) });
}
