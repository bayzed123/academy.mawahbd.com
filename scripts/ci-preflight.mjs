#!/usr/bin/env node
/**
 * A read-only look at the Cloudflare access the Deploy workflow was given, reported in plain words (and written to the
 * run's summary page, which is easy to read on a phone). It changes nothing on Cloudflare.
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Exit code 1 means something has to be fixed before a deploy can work.
 * It catches the usual first-time slips early: a token pasted with a space, a token without D1 or R2, R2 not switched on,
 * and — most importantly — an account ID that belongs to a different Cloudflare account than the one the site is meant for
 * (the deploy would otherwise quietly create its database and storage there). When the site has custom domains it also
 * looks at each one: is its DNS zone on this account and active, may the token attach a Worker to it, is the name already
 * taken by another Worker or by a DNS record that would block Cloudflare — so a domain problem stops the run here, before
 * anything is published, instead of half way through a deploy.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readCustomDomains, readSiteUrl, readWorkerName } from "./lib/toml-patch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toml = readFileSync(resolve(root, "worker/wrangler.toml"), "utf8");
const name = readWorkerName(toml) ?? "(no name in wrangler.toml)";
const siteUrl = readSiteUrl(toml);

const base = (process.env.CLOUDFLARE_API_BASE ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";

/** rows of the report: ok = true (✓) / false (✗, blocks the deploy) / null (just a note) */
const rows = [];
const row = (ok, text) => rows.push({ ok, text });

async function get(path) {
  try {
    const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const body = await res.json().catch(() => null);
    const err = body?.errors?.[0];
    return { status: res.status, ok: res.ok && body?.success !== false, message: err?.message ?? "", code: err?.code, result: body?.result };
  } catch (e) {
    return { status: 0, ok: false, message: String(e?.message ?? e), code: undefined, result: undefined };
  }
}

function finish() {
  const icon = (r) => (r.ok === true ? "✓" : r.ok === false ? "✗" : "•");
  console.log("Cloudflare access check (changes nothing)");
  for (const r of rows) console.log(`  ${icon(r)} ${r.text}`);
  const blocked = rows.some((r) => r.ok === false);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = rows.map((r) => `- ${r.ok === true ? "✅" : r.ok === false ? "❌" : "ℹ️"} ${r.text}`).join("\n");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Cloudflare access check\n\n${md}\n\n`);
  }
  if (blocked) console.log("\nFix the ✗ lines above, then run Deploy again (Actions → Deploy → Run workflow).");
  process.exit(blocked ? 1 : 0);
}

// 1. things that can be seen without asking Cloudflare anything
if (/\s/.test(token)) row(false, "CLOUDFLARE_API_TOKEN contains a space or a line break. Delete the secret and paste the token again, with nothing before or after it.");
if (!token) row(false, "CLOUDFLARE_API_TOKEN is empty.");
if (!/^[0-9a-f]{32}$/i.test(account)) row(false, "CLOUDFLARE_ACCOUNT_ID should be 32 letters and digits. It is in the Cloudflare dashboard address: dash.cloudflare.com/<account id>/…");
if (rows.some((r) => r.ok === false)) finish();

// 2. what the token is allowed to do on this account
const needs = [
  { label: "Workers — publish the site", path: `/accounts/${account}/workers/scripts`, give: "Account → Workers Scripts → Edit" },
  { label: "D1 — the database", path: `/accounts/${account}/d1/database`, give: "Account → D1 → Edit" },
  { label: "KV — fast key-value storage", path: `/accounts/${account}/storage/kv/namespaces`, give: "Account → Workers KV Storage → Edit" },
  { label: "R2 — file storage", path: `/accounts/${account}/r2/buckets`, give: "Account → Workers R2 Storage → Edit" },
];
const answers = await Promise.all(needs.map((n) => get(n.path)));

const refused = (a) => a.status === 401 || a.status === 403;
if (answers.every(refused)) {
  row(false, "Cloudflare did not accept the token for this account. Check that CLOUDFLARE_API_TOKEN was copied completely and is still active, and that CLOUDFLARE_ACCOUNT_ID is the account the token was made for.");
} else {
  needs.forEach((n, i) => {
    const a = answers[i];
    if (a.ok) row(true, `${n.label}: allowed`);
    else if (n.label.startsWith("R2") && (a.code === 10042 || /enable R2/i.test(a.message))) row(false, "R2 (file storage) is not switched on for this account yet. In the Cloudflare dashboard open R2 → Overview and enable it once (it asks for a payment method; the free allowance is generous).");
    else if (refused(a)) row(false, `${n.label}: Cloudflare refused. Give the token this permission: ${n.give}.`);
    else if (a.status === 0) row(false, `${n.label}: could not reach Cloudflare (${a.message}). Run Deploy again in a few minutes.`);
    else row(false, `${n.label}: Cloudflare answered ${a.status}${a.message ? ` “${a.message}”` : ""}.`);
  });
}

// 3. is this the account the site is meant for?
const scripts = answers[0];
if (scripts.ok && Array.isArray(scripts.result)) {
  const exists = scripts.result.some((s) => s?.id === name || s?.name === name);
  row(null, exists ? `The Worker “${name}” already exists on this account; this deploy replaces what it serves.` : `There is no Worker called “${name}” on this account yet; the first deploy creates it.`);
}
const sub = await get(`/accounts/${account}/workers/subdomain`);
const subdomain = sub.ok ? sub.result?.subdomain : undefined;
if (subdomain) {
  const expected = `${name}.${subdomain}.workers.dev`;
  row(null, `This account’s free address for the site is https://${expected}`);
  let host = "";
  try {
    host = new URL(siteUrl ?? "").host;
  } catch {
    /* SITE_URL missing or not a URL: nothing to compare */
  }
  if (host.endsWith(".workers.dev") && host !== expected) {
    row(false, `worker/wrangler.toml says the site lives at https://${host}, but on this Cloudflare account it would be https://${expected}. Either CLOUDFLARE_ACCOUNT_ID belongs to a different Cloudflare account than you expect (nothing has been created there), or SITE_URL in worker/wrangler.toml needs to be updated.`);
  }
}

// 4. the custom domains: is everything in place for Cloudflare to attach this Worker to them?
const domains = readCustomDomains(toml);
let siteHostName = "";
try {
  siteHostName = new URL(siteUrl ?? "").hostname;
} catch {
  /* SITE_URL missing or not a URL */
}
const onWorkersDev = siteHostName.endsWith(".workers.dev");
if (siteHostName && !onWorkersDev && !domains.includes(siteHostName)) {
  row(false, `worker/wrangler.toml says the site lives at https://${siteHostName}, but that name is not in the \`routes\` list as a custom domain, so the Worker would never answer there. Add { pattern = "${siteHostName}", custom_domain = true } to \`routes\` (or point SITE_URL at the free workers.dev address).`);
}
if (domains.length) await checkDomains();

async function checkDomains() {
  const refused = (a) => a.status === 401 || a.status === 403;
  // which zone owns a name: try the name itself, then its parents (www.example.com → example.com)
  const looked = new Map();
  async function findZone(host) {
    const labels = host.split(".");
    for (let i = 0; i <= labels.length - 2; i++) {
      const zoneName = labels.slice(i).join(".");
      if (!looked.has(zoneName)) {
        const a = await get(`/zones?name=${encodeURIComponent(zoneName)}&account.id=${account}`);
        looked.set(zoneName, { a, zone: a.ok && Array.isArray(a.result) ? a.result.find((z) => z?.name === zoneName) : undefined });
      }
      const hit = looked.get(zoneName);
      if (!hit.a.ok) return { failed: hit.a };
      if (hit.zone) return { zone: hit.zone };
    }
    return {};
  }

  const listed = await get(`/accounts/${account}/workers/domains`);
  const attached = listed.ok && Array.isArray(listed.result) ? listed.result : [];

  for (const host of domains) {
    const { zone, failed } = await findZone(host);
    if (failed) {
      row(null, refused(failed) ? `${host}: could not look up its DNS zone because the token has no Zone → Zone → Read permission. Skipped here; if attaching the domain fails, add that permission.` : `${host}: could not look up its DNS zone (Cloudflare answered ${failed.status || failed.message}). Skipped here.`);
      continue;
    }
    if (!zone) {
      row(false, `The domain ${host} cannot be used by this deploy: its DNS zone was not found. Check that the domain is listed under “Websites” in THIS Cloudflare account, and that the token's Zone Resources include it (edit the token: Zone Resources → Include → All zones), with the permissions Zone → Zone → Read and Zone → Workers Routes → Edit.`);
      continue;
    }
    if (zone.status !== "active" || zone.paused) {
      row(false, `The domain ${zone.name} is not active on Cloudflare yet (status “${zone.status}”${zone.paused ? ", paused" : ""}). Wait until the dashboard shows it as Active (a new domain's name servers can take a while), then run Deploy again.`);
      continue;
    }
    row(true, `${host}: its DNS zone “${zone.name}” is on this account and active`);

    const routes = await get(`/zones/${zone.id}/workers/routes`);
    if (refused(routes)) {
      row(false, `${host}: Cloudflare refused to let this token change Workers routes and custom domains for ${zone.name}. Give the token: Zone → Workers Routes → Edit (and make its Zone Resources include ${zone.name}).`);
      continue;
    }
    if (routes.ok) row(true, `${host}: the token may attach a Worker to it`);

    const taken = attached.find((d) => d?.hostname === host);
    if (taken) {
      if (taken.service === name) row(null, `${host}: already attached to this Worker.`);
      else row(false, `${host} is already attached to a different Worker (“${taken.service}”) on this account. Remove it there first (Workers & Pages → that Worker → Settings → Domains & Routes), or choose another name.`);
      continue;
    }
    // not attached yet: Cloudflare creates the DNS record itself, and refuses when the name already has an address record
    const dns = await get(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(host)}`);
    if (refused(dns)) {
      row(null, `${host}: not attached yet. Could not look for a DNS record that would block it (the token has no DNS Read); the deploy will say if there is one.`);
      continue;
    }
    const clash = dns.ok && Array.isArray(dns.result) ? dns.result.filter((r) => ["A", "AAAA", "CNAME"].includes(r?.type)) : [];
    if (clash.length) {
      row(false, `${host} already has a DNS record (${clash.map((r) => `${r.type} → ${r.content}`).join(", ")}). Cloudflare can only attach a Worker to a name that has none. In the dashboard open ${zone.name} → DNS → Records, delete that record, then run Deploy again.`);
    } else {
      row(null, `${host}: not attached yet — this deploy attaches it. Cloudflare creates the DNS record and the certificate itself; the first visit can take a few minutes.`);
    }
  }
}

finish();
