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
    // a certificate is never measured (its address is the key to it): there is nothing for the cookie to decide
    if (/^(\/en)?\/certificate\//.test(path)) return;
    const ids = trackingFor(c.env, c.req.url, await getSettings(c.env));
    if (!isTracking(ids)) return;
    // the header Cloudflare adds; on the real site, if it is missing, the country Workers itself knows from the connection; a country nobody knows is asked first
    const country = c.req.header("cf-ipcountry") ?? (isProd(c.env) ? (c.req.raw as { cf?: { country?: string } }).cf?.country : undefined);
    const want = regionOf(country, isProd(c.env) ? "eu" : "row");
    const secure = isProd(c.env) ? "; Secure" : "";
    const cookies: string[] = [];
    if (getCookie(c, REGION_COOKIE) !== want) cookies.push(`${REGION_COOKIE}=${want}; Path=/; Max-Age=86400; SameSite=Lax${secure}`);
    const fbc = adClick(c, ids.pixel, want);
    if (fbc) cookies.push(`_fbc=${fbc}; Path=/; Max-Age=7776000; SameSite=Lax${secure}`);
    if (!cookies.length) return;
    const headers = new Headers(res.headers);
    for (const k of cookies) headers.append("Set-Cookie", k);
    c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch (err) {
    console.warn("region_hint_failed", err instanceof Error ? err.message : "unknown");
  }
};

/**
 * A visitor who arrived from a Facebook or Instagram ad has `fbclid` in the address. Meta's Pixel keeps it as the `_fbc` cookie — but not
 * when the Pixel's script is blocked. The server keeps it the same way (Meta's own format, fb.1.<time>.<fbclid>), on this site only, so a
 * purchase reported from the server (services/metaCapi.ts) still says which ad it came from. Only with a Pixel set, only for a visitor
 * who may be counted (not with Do Not Track or Global Privacy Control, not after "stop counting", in Europe/UK only after a yes), and never
 * over a `_fbc` the visitor already has.
 */
function adClick(c: Parameters<MiddlewareHandler<AppEnv>>[0], pixel: string, region: "eu" | "row"): string | null {
  if (!pixel || getCookie(c, "_fbc")) return null;
  const fbclid = new URL(c.req.url).searchParams.get("fbclid") ?? "";
  if (!/^[A-Za-z0-9_-]{10,400}$/.test(fbclid)) return null;
  const measure = getCookie(c, "mawah_measure");
  if (c.req.header("dnt") === "1" || c.req.header("sec-gpc") === "1" || measure === "off") return null;
  if (region === "eu" && measure !== "on") return null;
  return `fb.1.${Date.now()}.${fbclid}`;
}
