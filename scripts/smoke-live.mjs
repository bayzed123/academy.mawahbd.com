#!/usr/bin/env node
/**
 * A look at the LIVE site the way a visitor — and a search engine — meets it, run by the Deploy workflow after a release:
 *
 *   node scripts/smoke-live.mjs <public address> [options]
 *
 *   --free <address>   the free workers.dev address: it must still work and must be marked "noindex"
 *   --www <address>    the www address: it must send visitors on to the public address (same path and query)
 *   --http <address>   the plain-http address: it must send visitors on to https (default: http://<host>/ for an https site)
 *   --wait <seconds>   how long to wait for the public address to answer at all (default 600): a brand-new domain needs a few
 *                      minutes for its DNS record and certificate (default interval --every 10 seconds)
 *
 * It first waits for GET /api/health to answer {"ok":true}, then checks one thing after the other and says in plain words
 * what it saw. Exit code 1 means at least one ✗. Everything it does is a plain GET: nothing on the site is changed.
 * The result is also written to the run's summary page (GITHUB_STEP_SUMMARY).
 */
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const clean = (u) => (u ? u.replace(/\/+$/, "") : u);
const SITE = clean(positional[0]);
if (!SITE) {
  console.error("usage: node scripts/smoke-live.mjs <public address> [--free <address>] [--www <address>] [--http <address>] [--wait <seconds>]");
  process.exit(2);
}
const FREE = clean(flag("--free"));
const WWW = clean(flag("--www"));
const WAIT_MS = Number(flag("--wait") ?? 600) * 1000;
const EVERY_MS = Number(flag("--every") ?? 10) * 1000;
const site = new URL(SITE);
const HTTP = clean(flag("--http") ?? (site.protocol === "https:" ? `http://${site.host}` : undefined));

const rows = [];
const row = (ok, text) => {
  rows.push({ ok, text });
  console.log(`  ${ok === true ? "✓" : ok === false ? "✗" : "•"} ${text}`);
};

async function get(url, { redirect = "follow" } = {}) {
  try {
    const res = await fetch(url, { redirect, headers: { "user-agent": "mawah-deploy-check/1", accept: "text/html,application/json,*/*" }, signal: AbortSignal.timeout(20_000) });
    const body = redirect === "manual" ? "" : await res.text();
    return { ok: true, status: res.status, headers: res.headers, body };
  } catch (e) {
    const code = e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(e);
    return { ok: false, status: 0, headers: new Headers(), body: "", error: String(code) };
  }
}

/** Does the redirect in `res` (to a location that may be relative to `from`) lead to exactly `expected`? */
const sameLocation = (res, expected, from) => {
  const loc = res.headers.get("location");
  if (!loc) return false;
  try {
    return new URL(loc, from).href === new URL(expected).href;
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------------------------------------ 1. wait for the address */
console.log(`Checking the live site: ${SITE}`);
console.log(`  waiting for ${SITE}/api/health (a new domain needs a few minutes for its DNS record and certificate; up to ${WAIT_MS >= 60_000 ? `${Math.round(WAIT_MS / 60_000)} min` : `${Math.round(WAIT_MS / 1000)} s`})`);
const started = Date.now();
let attempt = 0;
let last = "";
let healthy = null;
for (;;) {
  attempt++;
  const r = await get(`${SITE}/api/health`);
  let json = null;
  try {
    json = JSON.parse(r.body);
  } catch {
    /* not JSON */
  }
  if (r.status === 200 && json?.ok === true) {
    healthy = { r, json };
    break;
  }
  last = r.ok ? `HTTP ${r.status}${json ? "" : " (not the site's answer)"}` : `no connection (${r.error})`;
  if (Date.now() - started + EVERY_MS > WAIT_MS) break;
  console.log(`  not ready yet (attempt ${attempt}): ${last}`);
  await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
}

if (!healthy) {
  row(false, `${SITE} did not answer after ${Math.round((Date.now() - started) / 1000)} s (last: ${last}). The code is deployed and the free address keeps working; this usually means the domain's DNS record or certificate is not ready, or something else is using the name. In Cloudflare: Workers & Pages → the Worker → Settings → Domains & Routes should list the name as active. If the name was looked up before it existed, some networks remember “no such name” for up to 30 minutes: run Deploy again then.`);
} else {
  row(true, `${SITE} answers (after ${Math.max(1, Math.round((Date.now() - started) / 1000))} s, ${attempt} ${attempt === 1 ? "try" : "tries"}); environment: ${healthy.json.env ?? "?"}`);

  /* ---------------------------------------------------------------------------------------------- 2. the pages themselves */
  const secure = site.protocol === "https:";
  const page = async (label, path, expectCanonical) => {
    const r = await get(`${SITE}${path}`);
    if (r.status !== 200) return row(false, `${label} (${path}): HTTP ${r.status || r.error}`);
    const problems = [];
    if (!/text\/html/i.test(r.headers.get("content-type") ?? "")) problems.push("not an HTML page");
    if (expectCanonical && !r.body.includes(`<link rel="canonical" href="${expectCanonical}"`)) problems.push(`the canonical link is not ${expectCanonical}`);
    if (/\.workers\.dev/.test(r.body)) problems.push("the page mentions the workers.dev address");
    if (r.headers.get("x-robots-tag")) problems.push(`it is marked “${r.headers.get("x-robots-tag")}” for search engines`);
    if (secure && !/max-age=\d{7,}/.test(r.headers.get("strict-transport-security") ?? "")) problems.push("no long Strict-Transport-Security header");
    if (!/default-src 'none'/.test(r.headers.get("content-security-policy") ?? "")) problems.push("no strict Content-Security-Policy");
    if (r.headers.get("x-content-type-options") !== "nosniff") problems.push("no X-Content-Type-Options: nosniff");
    if (/rocket-loader|data-cf-settings/i.test(r.body)) problems.push("Cloudflare Rocket Loader rewrote the page (switch it off in the zone: Speed → Optimization), it breaks the strict Content-Security-Policy");
    problems.length ? row(false, `${label} (${path}): ${problems.join("; ")}`) : row(true, `${label} (${path}): 200, canonical address correct, security headers present`);
    return r;
  };

  const home = await page("Home page, Bangla", "/", `${SITE}/`);
  await page("Home page, English", "/en", `${SITE}/en`);
  if (home && /\/cdn-cgi\/scripts\//.test(home.body)) row(null, "Cloudflare added its e-mail-protection script to the home page (zone setting Scrape Shield → Email Address Obfuscation). It is harmless; switch the setting off if you want the pages exactly as the Worker writes them.");

  const classes = await get(`${SITE}/courses`);
  row(classes.status === 200 && /href="\/courses\/[a-z0-9-]+"/.test(classes.body), `Class list (/courses): ${classes.status === 200 ? (/href="\/courses\/[a-z0-9-]+"/.test(classes.body) ? "200, classes are listed" : "200 but no class is listed") : `HTTP ${classes.status || classes.error}`}`);

  const api = await get(`${SITE}/api/courses?per_page=1`);
  let apiJson = null;
  try {
    apiJson = JSON.parse(api.body);
  } catch {
    /* not JSON */
  }
  row(api.status === 200 && apiJson?.ok === true && (apiJson.courses?.length ?? 0) >= 1, `Class data (/api/courses): ${api.status === 200 && apiJson?.ok ? `database answers, ${apiJson.courses?.length ?? 0} class returned` : `HTTP ${api.status || api.error}`}`);

  for (const [label, path] of [["Student app", "/app/"], ["Admin", "/admin/"]]) {
    const r = await get(`${SITE}${path}`);
    row(r.status === 200 && /<div id="root"/.test(r.body), `${label} (${path}): ${r.status === 200 ? (/<div id="root"/.test(r.body) ? "200, the app loads" : "200 but the app shell is missing") : `HTTP ${r.status || r.error}`}`);
  }

  /* ------------------------------------------------------------------------------------------------ 3. search engines */
  const robots = await get(`${SITE}/robots.txt`);
  const openRobots = robots.status === 200 && robots.body.includes(`Sitemap: ${SITE}/sitemap.xml`) && !/^Disallow:\s*\/\s*$/m.test(robots.body);
  row(openRobots, `robots.txt: ${openRobots ? `open to search engines, points to ${SITE}/sitemap.xml` : robots.status === 200 ? "it does not point to the sitemap of this address, or it closes the whole site" : `HTTP ${robots.status || robots.error}`}`);
  const sitemap = await get(`${SITE}/sitemap.xml`);
  const mapOk = sitemap.status === 200 && sitemap.body.includes(`<loc>${SITE}/`) && !/\.workers\.dev/.test(sitemap.body);
  row(mapOk, `sitemap.xml: ${mapOk ? "lists addresses on this domain only" : sitemap.status === 200 ? "it does not list this domain's addresses, or it mentions workers.dev" : `HTTP ${sitemap.status || sitemap.error}`}`);

  /* ------------------------------------------------------------------------------------------------ 4. the other names */
  if (HTTP) {
    const r = await get(`${HTTP}/`, { redirect: "manual" });
    row([301, 308].includes(r.status) && sameLocation(r, `${SITE}/`, `${HTTP}/`), `Plain http: ${[301, 308].includes(r.status) ? `sent on to ${r.headers.get("location")}` : `HTTP ${r.status || r.error} — it should be a redirect to ${SITE}/`}`);
  }
  if (WWW) {
    const r = await get(`${WWW}/en/courses?x=1`, { redirect: "manual" });
    row(r.status === 301 && sameLocation(r, `${SITE}/en/courses?x=1`, `${WWW}/en/courses?x=1`), `www name (${WWW}): ${r.status === 301 ? `sent on to ${r.headers.get("location")}` : `HTTP ${r.status || r.error} — it should be a permanent redirect to ${SITE}/en/courses?x=1`}`);
  }
  if (FREE && FREE !== SITE) {
    const h = await get(`${FREE}/api/health`);
    row(h.status === 200 && /noindex/i.test(h.headers.get("x-robots-tag") ?? ""), `Free address (${FREE}): ${h.status === 200 ? (/noindex/i.test(h.headers.get("x-robots-tag") ?? "") ? "still works and is marked noindex" : "works but is NOT marked noindex, search engines could list it twice") : `HTTP ${h.status || h.error}`}`);
    const fr = await get(`${FREE}/robots.txt`);
    row(fr.status === 200 && /^Disallow:\s*\/\s*$/m.test(fr.body), `Free address robots.txt: ${fr.status === 200 ? (/^Disallow:\s*\/\s*$/m.test(fr.body) ? "asks crawlers to stay out" : "does not ask crawlers to stay out") : `HTTP ${fr.status || fr.error}`}`);
  }
}

/* ---------------------------------------------------------------------------------------------------------------- report */
const failed = rows.filter((r) => r.ok === false);
if (process.env.GITHUB_STEP_SUMMARY) {
  const md = rows.map((r) => `- ${r.ok === true ? "✅" : r.ok === false ? "❌" : "ℹ️"} ${r.text}`).join("\n");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### The public address: ${SITE}\n\n${md}\n\n${failed.length ? `**${failed.length} thing${failed.length === 1 ? "" : "s"} to fix** — the release itself is published; fix the ❌ lines and run Deploy again.\n\n` : "Everything a visitor and a search engine meet is in order.\n\n"}`);
}
console.log(failed.length ? `\n${failed.length} check${failed.length === 1 ? "" : "s"} failed.` : "\nAll checks passed.");
process.exit(failed.length ? 1 : 0);
