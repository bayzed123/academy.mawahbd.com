import type { MiddlewareHandler } from "hono";
import { isProd, type AppEnv } from "../env";
import { sha256Hex } from "../lib/crypto";
import { isOtherAddress } from "./host";

/**
 * Baseline hardening for every response (HTML, JSON and static): MIME sniffing off, no framing,
 * strict referrer policy, powerful browser features disabled, HSTS in production.
 * Content-Security-Policy is attached per surface (marketing page / React app / API).
 */
export const baseSecurity: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const res = c.res;
  const headers = new Headers(res.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  // a page may ask for "no referrer" (the password link: its address is a secret); nothing may ask for less than the default
  headers.set("Referrer-Policy", res.headers.get("Referrer-Policy") === "no-referrer" ? "no-referrer" : "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self), interest-cohort=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("X-Request-Id", c.get("reqId"));
  if (isProd(c.env)) headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  // the free workers.dev address (and any other that is not the public one) works, but search engines must only list the real address
  if (isOtherAddress(c.env, c.req.url)) headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.delete("X-Powered-By");
  c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

export interface CspOptions {
  /** `'sha256-…'` entries for inline <style> blocks */
  styleHashes?: string[];
  turnstile?: boolean;
  analytics?: { ga4?: boolean; clarity?: boolean; pixel?: boolean };
  /** React apps talk to Stream for playback and upload.videodelivery.net for admin video uploads */
  spa?: boolean;
}

const STREAM = "https://*.cloudflarestream.com";

export function buildCsp(opts: CspOptions = {}): string {
  const script = ["'self'"];
  const connect = ["'self'"];
  // SSLCommerz's own logo (Admin → Settings → Payments) is shown from SSLCommerz's server, as SSLCommerz asks
  const img = ["'self'", "data:", STREAM, "https://sslcommerz.com", "https://*.sslcommerz.com"];
  // the video players a lesson or a material may show: Cloudflare Stream, YouTube (privacy-enhanced), Vimeo, Facebook's video plugin
  const frame = [STREAM, "https://www.youtube-nocookie.com", "https://player.vimeo.com", "https://www.facebook.com"];
  const style = ["'self'", ...(opts.styleHashes ?? [])];

  if (opts.turnstile) {
    script.push("https://challenges.cloudflare.com");
    connect.push("https://challenges.cloudflare.com");
    frame.push("https://challenges.cloudflare.com");
  }
  if (opts.analytics?.ga4) {
    script.push("https://www.googletagmanager.com");
    // the hosts Google lists for GA4 (developers.google.com/tag-platform/security/guides/csp); a wildcard does not cover the bare analytics.google.com
    connect.push("https://*.google-analytics.com", "https://analytics.google.com", "https://*.analytics.google.com", "https://*.googletagmanager.com");
    img.push("https://*.google-analytics.com", "https://*.googletagmanager.com");
  }
  if (opts.analytics?.clarity) {
    script.push("https://www.clarity.ms", "https://scripts.clarity.ms");
    connect.push("https://*.clarity.ms", "https://c.bing.com");
    img.push("https://*.clarity.ms", "https://c.bing.com");
  }
  if (opts.analytics?.pixel) {
    script.push("https://connect.facebook.net");
    connect.push("https://www.facebook.com", "https://connect.facebook.net");
    img.push("https://www.facebook.com");
  }
  if (opts.spa) {
    connect.push(STREAM, "https://upload.videodelivery.net");
    img.push("blob:");
  }

  return [
    "default-src 'none'",
    `script-src ${script.join(" ")}`,
    `style-src ${style.join(" ")}`,
    `img-src ${img.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    `frame-src ${frame.join(" ")}`,
    `media-src 'self' blob: ${STREAM}`,
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const hashCache = new Map<string, string>();

/** CSP source expression for an inline <style> block, so pages need no 'unsafe-inline'. */
export async function styleHash(css: string): Promise<string> {
  const cached = hashCache.get(css);
  if (cached) return cached;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(css));
  let bin = "";
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  const value = `'sha256-${btoa(bin)}'`;
  hashCache.set(css, value);
  return value;
}

export { sha256Hex };

/** JSON API responses: never cached, never framed, no scripts. */
export const apiHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  // JSON never needs scripts or styles; a route that serves its own HTML (dev mock gateway) may set a tailored CSP
  if (!c.res.headers.has("Content-Security-Policy")) {
    c.res.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  }
};
