import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { isProd, type AppEnv } from "../env";
import { getSettings } from "../lib/settings";
import { isTracking, regionOf, trackingFor } from "../lib/tracking";

export const REGION_COOKIE = "mawah_geo";

/**
 * Pages are cached and identical for everybody, so a page cannot say "this visitor is in Europe". Cloudflare knows the visitor's country
 * (the CF-IPCountry header), so every page that carries the analytics tag also leaves one small, harmless cookie — `mawah_geo=eu` or
 * `mawah_geo=row` — that the analytics script reads to decide whether to ask before measuring. It holds no personal data, expires in a day,
 * and is only set when measuring is on for the request. If anything goes wrong here the page is served as it is.
 */
export const regionHint: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  try {
    if (c.req.method !== "GET") return;
    const res = c.res;
    if (!(res.headers.get("Content-Type") ?? "").startsWith("text/html")) return;
    const path = new URL(c.req.url).pathname;
    if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/")) return;
    if (!isTracking(trackingFor(c.env, c.req.url, await getSettings(c.env)))) return;
    // the header Cloudflare adds; on the real site, if it is missing, the country Workers itself knows from the connection; a country nobody knows is asked first
    const country = c.req.header("cf-ipcountry") ?? (isProd(c.env) ? (c.req.raw as { cf?: { country?: string } }).cf?.country : undefined);
    const want = regionOf(country, isProd(c.env) ? "eu" : "row");
    if (getCookie(c, REGION_COOKIE) === want) return;
    const headers = new Headers(res.headers);
    headers.append("Set-Cookie", `${REGION_COOKIE}=${want}; Path=/; Max-Age=86400; SameSite=Lax${isProd(c.env) ? "; Secure" : ""}`);
    c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch (err) {
    console.warn("region_hint_failed", err instanceof Error ? err.message : "unknown");
  }
};
