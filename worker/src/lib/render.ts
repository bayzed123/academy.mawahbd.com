import type { Context } from "hono";
import { CSS } from "../generated/assets";
import { isProd, type AppEnv, type Ctx } from "../env";
import type { PageCtx } from "../views/ctx";
import { buildCsp, styleHash } from "../middleware/security";
import { contentVersion } from "./settings";
import { turnstileEnabled } from "./turnstile";

type Node = { toString(): string | Promise<string> };

/**
 * Turn a JSX tree into a full HTML response with a strict, hash-based CSP:
 * the single inline <style> block is allowed by its SHA-256, nothing else inline is (no 'unsafe-inline').
 */
export async function renderHtml(
  c: Context<AppEnv>,
  ctx: PageCtx,
  node: Node,
  opts: { status?: number; cache?: string; noReferrer?: boolean } = {},
): Promise<Response> {
  const body = `<!doctype html>${await node.toString()}`;
  const ids = ctx.track;
  const csp = buildCsp({
    styleHashes: [await styleHash(CSS)],
    turnstile: turnstileEnabled(c.env),
    analytics: { ga4: !!ids.ga4, clarity: !!ids.clarity, pixel: !!ids.pixel },
  });
  return new Response(body, {
    status: opts.status ?? 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "Cache-Control": opts.cache ?? "no-store",
      "Content-Language": ctx.lang === "bn" ? "bn-BD" : "en",
      // a page whose address is a secret (a certificate or password link, an order) must not name that address as "where I came from" on the next page
      ...(opts.noReferrer ? { "Referrer-Policy": "no-referrer" } : {}),
    },
  });
}

/* --------------------------------------------------------------------------------------------------
 * Edge page cache. Public pages are identical for every visitor, so they are rendered once per colo
 * and served from Cloudflare's cache (Cache API). The cache key contains
 *   - only the query params that change the page (so ?fbclid=… / ?utm_… never fragment the cache)
 *   - a "content version" number that any admin edit bumps (immediate in the colo that made the edit, ~1 minute elsewhere: KV is eventually consistent)
 * ------------------------------------------------------------------------------------------------ */
export interface CacheOptions {
  /** seconds the edge may serve the same HTML */
  ttl: number;
  /** query params that are part of the page identity */
  keep?: string[];
  /** skip the cache for this request (flash messages, unknown params…) */
  bypass?: boolean;
}

/**
 * What the visitor's own browser may keep. The edge cache above is refreshed the moment the owner changes something (the
 * content version in its key), so the browser must not hold a page much longer than that: a returning visitor — the owner
 * checking an edit, a student looking for the review just approved — would otherwise be shown an old page first.
 */
const browserCache = (ttl: number) => `public, max-age=${Math.min(30, ttl)}, stale-while-revalidate=${Math.min(30, ttl)}`;

export async function cachedPage(c: Ctx, opts: CacheOptions, render: () => Promise<Response>): Promise<Response> {
  const cacheable = c.req.method === "GET" && !opts.bypass && isProd(c.env);
  if (!cacheable) {
    const res = await render();
    return res;
  }
  const url = new URL(c.req.url);
  const key = new URL(url.origin + url.pathname);
  for (const name of [...(opts.keep ?? [])].sort()) {
    const v = url.searchParams.get(name);
    if (v) key.searchParams.set(name, v);
  }
  key.searchParams.set("__cv", await contentVersion(c.env));
  const cacheKey = new Request(key.toString(), { method: "GET" });
  const cache = (caches as unknown as { default: Cache }).default;

  const hit = await cache.match(cacheKey);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set("X-Page-Cache", "HIT");
    res.headers.set("Cache-Control", browserCache(opts.ttl));
    return res;
  }

  const res = await render();
  if (res.status === 200) {
    const stored = new Response(res.clone().body, res);
    stored.headers.set("Cache-Control", `public, max-age=${opts.ttl}`);
    stored.headers.delete("Set-Cookie");
    c.executionCtx.waitUntil(cache.put(cacheKey, stored));
    res.headers.set("Cache-Control", browserCache(opts.ttl));
  }
  res.headers.set("X-Page-Cache", "MISS");
  return res;
}
