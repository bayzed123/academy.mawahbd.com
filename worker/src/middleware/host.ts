import type { MiddlewareHandler } from "hono";
import { isProd, type AppEnv, type Env } from "../env";

/**
 * One public address, in production only (the address is SITE_URL):
 *  - plain http goes to https — Cloudflare answers a custom domain over http too unless the zone's "Always Use HTTPS" is switched
 *    on, and that setting is not something a deploy can rely on;
 *  - www.<address> goes to <address> with a permanent redirect (the www name is attached to this Worker only to send people on);
 *  - any other address that reaches the Worker — the free workers.dev one, which the deploy checks use and which stays as a
 *    fallback — keeps working, but is marked "noindex" (see isOtherAddress), so only the real address shows up in search results.
 * In development (and for a SITE_URL that is not a proper URL) nothing here does anything.
 */
const siteOf = (siteUrl: string): URL | null => {
  try {
    const u = new URL(siteUrl);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
};

/** True in production when the request came in on an address other than the public one (SITE_URL) — and is not its www twin. */
export function isOtherAddress(env: Env, requestUrl: string): boolean {
  if (!isProd(env)) return false;
  const site = siteOf(env.SITE_URL);
  if (!site) return false;
  return new URL(requestUrl).host !== site.host;
}

export const publicAddress: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isProd(c.env)) return next();
  const site = siteOf(c.env.SITE_URL);
  if (!site) return next();
  const url = new URL(c.req.url);
  const fromWww = url.hostname === `www.${site.hostname}`;
  const fromHttp = url.protocol === "http:" && site.protocol === "https:";
  if (!fromWww && !fromHttp) return next();
  const target = `${site.protocol}//${fromWww ? site.host : url.host}${url.pathname}${url.search}`;
  const res = c.redirect(target, c.req.method === "GET" || c.req.method === "HEAD" ? 301 : 308);
  res.headers.set("Cache-Control", "public, max-age=3600");
  return res;
};
