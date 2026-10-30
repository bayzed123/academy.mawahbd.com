import { Hono } from "hono";
import { ANALYTICS_JS } from "../generated/assets";
import type { AppEnv } from "../env";
import { getSettings } from "../lib/settings";
import { isTracking, NO_TRACKING, trackingFor, type TrackIds } from "../lib/tracking";
import { turnstileEnabled } from "../lib/turnstile";
import { buildCsp } from "../middleware/security";

/**
 * The student app (/app) and admin (/admin) are static React builds. The Worker serves their HTML shell with a
 * strict CSP and `no-cache` (so a new deploy is picked up immediately) while the hashed JS/CSS bundles are served
 * straight from Cloudflare's asset layer with 1-year immutable caching.
 * Any deep link (/app/learn/…, /admin/orders/…) gets the same shell — the router takes over in the browser.
 */
export const spaRoutes = new Hono<AppEnv>();

/**
 * The student app is a static page, so the measurement IDs and the analytics script are added to it here, as it is served — and only when
 * the owner has set an ID and this is the real site. The admin is never measured.
 */
function withTracking(html: string, ids: TrackIds): string {
  const tags = [
    ids.ga4 && `<meta name="mawah:ga4" content="${ids.ga4}">`,
    ids.clarity && `<meta name="mawah:clarity" content="${ids.clarity}">`,
    ids.pixel && `<meta name="mawah:pixel" content="${ids.pixel}">`,
    `<script src="${ANALYTICS_JS}" defer></script>`,
  ]
    .filter(Boolean)
    .join("");
  // right after <meta charset>, so the script runs before the app's own (window.mawahTrack must exist when the app starts)
  const charset = /<meta charset[^>]*>/i.exec(html);
  return charset ? html.slice(0, charset.index + charset[0].length) + tags + html.slice(charset.index + charset[0].length) : html.replace("</head>", `${tags}</head>`);
}

async function shell(c: { env: AppEnv["Bindings"]; req: { url: string } }, base: "app" | "admin"): Promise<Response> {
  const asset = await c.env.ASSETS.fetch(new Request(new URL(`/${base}/`, c.req.url)));
  if (!asset.ok) {
    return new Response(`${base} build missing — run "npm run build"`, { status: 503, headers: { "Content-Type": "text/plain" } });
  }
  // The link in a password e-mail or a receipt (/app/reset/<one-time secret>) carries a secret in its address: Google Analytics records the address of every
  // page, so that page is never counted, and it passes no referrer on (a next page loaded from it would otherwise name the address as where the visitor came from).
  const secretAddress = base === "app" && /^\/app\/reset\//.test(new URL(c.req.url).pathname);
  let ids = NO_TRACKING;
  if (base === "app" && !secretAddress) {
    try {
      ids = trackingFor(c.env, c.req.url, await getSettings(c.env));
    } catch {
      /* the settings could not be read: the app opens without counting visits */
    }
  }
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Security-Policy": buildCsp({ spa: true, turnstile: turnstileEnabled(c.env), analytics: { ga4: !!ids.ga4, clarity: !!ids.clarity, pixel: !!ids.pixel } }),
  });
  if (base === "admin") headers.set("X-Robots-Tag", "noindex, nofollow");
  if (secretAddress) headers.set("Referrer-Policy", "no-referrer");
  return new Response(isTracking(ids) ? withTracking(await asset.text(), ids) : asset.body, { status: 200, headers });
}

spaRoutes.get("/app", (c) => shell(c, "app"));
spaRoutes.get("/app/*", (c) => shell(c, "app"));
spaRoutes.get("/admin", (c) => shell(c, "admin"));
spaRoutes.get("/admin/*", (c) => shell(c, "admin"));
