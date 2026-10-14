import { Hono } from "hono";
import type { AppEnv } from "../env";
import { buildCsp } from "../middleware/security";

/**
 * The student app (/app) and admin (/admin) are static React builds. The Worker serves their HTML shell with a
 * strict CSP and `no-cache` (so a new deploy is picked up immediately) while the hashed JS/CSS bundles are served
 * straight from Cloudflare's asset layer with 1-year immutable caching.
 * Any deep link (/app/learn/…, /admin/orders/…) gets the same shell — the router takes over in the browser.
 */
export const spaRoutes = new Hono<AppEnv>();

async function shell(c: { env: AppEnv["Bindings"]; req: { url: string } }, base: "app" | "admin"): Promise<Response> {
  const asset = await c.env.ASSETS.fetch(new Request(new URL(`/${base}/`, c.req.url)));
  if (!asset.ok) {
    return new Response(`${base} build missing — run "npm run build"`, { status: 503, headers: { "Content-Type": "text/plain" } });
  }
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Security-Policy": buildCsp({ spa: true }),
  });
  if (base === "admin") headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(asset.body, { status: 200, headers });
}

spaRoutes.get("/app", (c) => shell(c, "app"));
spaRoutes.get("/app/*", (c) => shell(c, "app"));
spaRoutes.get("/admin", (c) => shell(c, "admin"));
spaRoutes.get("/admin/*", (c) => shell(c, "admin"));
