import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/http";

/** Server-to-server callbacks and gateway redirects arrive cross-site by design — they are authenticated
 *  by re-verifying with the gateway (or, for the couriers' webhooks, by the secret the owner gave the courier), never by cookies. */
const EXEMPT_PREFIXES = ["/api/payments/", "/api/courier/"];

/**
 * CSRF defence for cookie-authenticated, state-changing requests (defence in depth on top of SameSite):
 *  - a browser-supplied Sec-Fetch-Site must be same-origin (or none = user typed the URL)
 *  - a browser-supplied Origin must match this site's host
 * Non-browser clients (no Origin / Fetch-Metadata) cannot ride a victim's cookies, so they pass.
 */
export const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  const url = new URL(c.req.url);
  if (EXEMPT_PREFIXES.some((p) => url.pathname.startsWith(p))) return next();

  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw new HttpError(403, "csrf");

  const origin = c.req.header("origin");
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, "csrf");
    }
    const allowed = new Set([url.host]);
    try {
      allowed.add(new URL(c.env.SITE_URL).host);
    } catch {
      /* SITE_URL misconfigured: fall back to request host only */
    }
    if (!allowed.has(host)) throw new HttpError(403, "csrf");
  }
  return next();
};
