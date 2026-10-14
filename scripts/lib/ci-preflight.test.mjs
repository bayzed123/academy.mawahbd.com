import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readCustomDomains, readSiteUrl, readWorkerName } from "./toml-patch.mjs";

/*
 * scripts/ci-preflight.mjs is the plain-words look at the Cloudflare access that opens the Deploy workflow. Here it talks to a
 * pretend Cloudflare API on localhost, so every way a first-time setup can go wrong can be checked without an account.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));
const toml = readFileSync(new URL("../../worker/wrangler.toml", import.meta.url), "utf8");
const NAME = readWorkerName(toml);
// the account subdomain that the committed SITE_URL expects (a custom domain has none, then any subdomain will do)
const siteHost = new URL(readSiteUrl(toml)).host;
const SUBDOMAIN = siteHost.endsWith(".workers.dev") ? siteHost.slice(NAME.length + 1, -".workers.dev".length) : "someaccount";

const ACCOUNT = "c02054195033b1976cf0e4826382ce74";
const json = (status, body) => ({ status, body });
const good = (result) => json(200, { success: true, errors: [], result });
const refuse = json(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null });

/** a pretend Cloudflare API: routes maps a path to a response; anything else is 404 */
async function cloudflare(routes) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.url);
    // like the real API, asking for a zone that is not there is a normal answer with an empty list, not an error
    const r = routes[req.url] ?? (req.url.startsWith("/zones?") ? good([]) : json(404, { success: false, errors: [{ code: 7003, message: "No route" }] }));
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

// the custom domains the real wrangler.toml asks for, and a healthy zone that owns them
const DOMAINS = readCustomDomains(toml);
const ZONE = { id: "zone-1", name: (DOMAINS[0] ?? "example.com").split(".").slice(-2).join("."), status: "active", paused: false };
const zoneUrl = (name) => `/zones?name=${encodeURIComponent(name)}&account.id=${ACCOUNT}`;
const dnsUrl = (host) => `/zones/${ZONE.id}/dns_records?name=${encodeURIComponent(host)}`;
const domainsOk = () => ({
  [zoneUrl(ZONE.name)]: good([ZONE]),
  [`/zones/${ZONE.id}/workers/routes`]: good([]),
  [`/accounts/${ACCOUNT}/workers/domains`]: good([]),
  ...Object.fromEntries(DOMAINS.map((d) => [dnsUrl(d), good([])])),
});

const all = (over = {}) => ({
  [`/accounts/${ACCOUNT}/workers/scripts`]: good([{ id: NAME }]),
  [`/accounts/${ACCOUNT}/d1/database`]: good([]),
  [`/accounts/${ACCOUNT}/storage/kv/namespaces`]: good([]),
  [`/accounts/${ACCOUNT}/r2/buckets`]: good({ buckets: [] }),
  [`/accounts/${ACCOUNT}/workers/subdomain`]: good({ subdomain: SUBDOMAIN }),
  ...domainsOk(),
  ...over,
});

/** runs the script from a private copy of the repository files it needs, so a test can bring its own wrangler.toml */
function workspace(tomlText) {
  const dir = mkdtempSync(join(tmpdir(), "mawah-preflight-"));
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  mkdirSync(join(dir, "worker"));
  copyFileSync(`${root}scripts/ci-preflight.mjs`, join(dir, "scripts/ci-preflight.mjs"));
  copyFileSync(`${root}scripts/lib/toml-patch.mjs`, join(dir, "scripts/lib/toml-patch.mjs"));
  writeFileSync(join(dir, "worker/wrangler.toml"), tomlText);
  return dir;
}

async function preflight(routes, env = {}, tomlText = toml) {
  const api = await cloudflare(routes);
  const dir = workspace(tomlText);
  try {
    const { stdout, code } = await promisify(execFile)(process.execPath, [join(dir, "scripts/ci-preflight.mjs")], {
      env: { PATH: process.env.PATH, CLOUDFLARE_API_BASE: api.url, CLOUDFLARE_API_TOKEN: "t".repeat(40), CLOUDFLARE_ACCOUNT_ID: ACCOUNT, ...env },
    }).then((r) => ({ ...r, code: 0 }), (e) => ({ stdout: e.stdout, code: e.code }));
    return { stdout, code, seen: api.seen };
  } finally {
    api.close();
  }
}

test("everything in order: passes and says the Worker will be replaced", async () => {
  const r = await preflight(all());
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /D1 — the database: allowed/);
  assert.match(r.stdout, new RegExp(`Worker “${NAME}” already exists`));
});

test("a first deploy on an account with no such Worker yet is fine", async () => {
  const r = await preflight(all({ [`/accounts/${ACCOUNT}/workers/scripts`]: good([{ id: "someone-elses-worker" }]) }));
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /first deploy creates it/);
});

test("R2 not switched on: says where to switch it on", async () => {
  const r = await preflight(all({ [`/accounts/${ACCOUNT}/r2/buckets`]: json(403, { success: false, errors: [{ code: 10042, message: "Please enable R2 through the Cloudflare Dashboard." }] }) }));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /R2 → Overview/);
});

test("a token without D1: names the permission to add", async () => {
  const r = await preflight(all({ [`/accounts/${ACCOUNT}/d1/database`]: refuse }));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /Account → D1 → Edit/);
});

test("a token or account ID that Cloudflare refuses everywhere gets one clear message", async () => {
  const refusedAll = Object.fromEntries(Object.keys(all()).map((p) => [p, refuse]));
  const r = await preflight(refusedAll);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /did not accept the token for this account/);
  assert.doesNotMatch(r.stdout, /Account → D1 → Edit/);
});

test("a token pasted with a trailing space or newline is caught before anything is sent", async () => {
  const r = await preflight(all(), { CLOUDFLARE_API_TOKEN: `${"t".repeat(40)}\n` });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /space or a line break/);
  assert.deepEqual(r.seen, [], "no request left the machine");
});

test("an account ID of the wrong shape is caught", async () => {
  const r = await preflight(all(), { CLOUDFLARE_ACCOUNT_ID: "my-account" });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /32 letters and digits/);
});

test("an account whose workers.dev address differs from SITE_URL is refused (wrong Cloudflare account)", async () => {
  if (!siteHost.endsWith(".workers.dev")) return; // SITE_URL is a custom domain: nothing to compare
  const r = await preflight(all({ [`/accounts/${ACCOUNT}/workers/subdomain`]: good({ subdomain: "another-agency" }) }));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /belongs to a different Cloudflare account/);
  assert.match(r.stdout, /nothing has been created there/);
});

test("the token never appears in the output", async () => {
  const token = "SECRET-token-value-0123456789-abcdef";
  const r = await preflight(all({ [`/accounts/${ACCOUNT}/d1/database`]: refuse }), { CLOUDFLARE_API_TOKEN: token });
  assert.ok(!r.stdout.includes(token));
});

/* ------------------------------------------------------------------------------------------------ custom domains */
const withDomains = DOMAINS.length ? test : test.skip; // only meaningful when the TOML has custom domains
const HOST = DOMAINS[0];

withDomains("custom domains in order: the zone is active, the token may attach, nothing is in the way", async () => {
  const r = await preflight(all());
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, new RegExp(`${HOST}: its DNS zone “${ZONE.name}” is on this account and active`));
  assert.match(r.stdout, new RegExp(`${HOST}: the token may attach a Worker to it`));
  assert.match(r.stdout, /not attached yet — this deploy attaches it/);
});

withDomains("a domain that is already attached to this Worker is simply noted (a normal later deploy)", async () => {
  const attached = DOMAINS.map((hostname) => ({ hostname, service: NAME, environment: "production" }));
  const r = await preflight(all({ [`/accounts/${ACCOUNT}/workers/domains`]: good(attached) }));
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /already attached to this Worker/);
  assert.ok(!r.seen.some((u) => u.includes("dns_records")), "no need to look at DNS for a name that is already ours");
});

withDomains("a domain whose zone is not on this account (or not visible to the token) stops the run with the way out", async () => {
  const r = await preflight(all({ [zoneUrl(ZONE.name)]: good([]) }));
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /its DNS zone was not found/);
  assert.match(r.stdout, /Websites/);
  assert.match(r.stdout, /Zone → Workers Routes → Edit/);
});

withDomains("a zone that is not active yet is explained, not attempted", async () => {
  const r = await preflight(all({ [zoneUrl(ZONE.name)]: good([{ ...ZONE, status: "pending" }]) }));
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /is not active on Cloudflare yet \(status “pending”\)/);
});

withDomains("a token that may not touch Workers routes for the zone names the permission", async () => {
  const r = await preflight(all({ [`/zones/${ZONE.id}/workers/routes`]: refuse }));
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /Zone → Workers Routes → Edit/);
});

withDomains("a name that another Worker already uses is not taken over", async () => {
  const r = await preflight(all({ [`/accounts/${ACCOUNT}/workers/domains`]: good([{ hostname: HOST, service: "someone-elses-worker" }]) }));
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /already attached to a different Worker \(“someone-elses-worker”\)/);
});

withDomains("an address or CNAME record on the name is caught before the deploy, with what to delete", async () => {
  for (const record of [{ type: "CNAME", content: "old.example.net" }, { type: "A", content: "192.0.2.10" }]) {
    const r = await preflight(all({ [dnsUrl(HOST)]: good([record]) }));
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, new RegExp(`${HOST} already has a DNS record \\(${record.type} → `));
    assert.match(r.stdout, /DNS → Records/);
  }
  // e-mail records (MX, TXT) on the same name do not block a custom domain
  const ok = await preflight(all({ [dnsUrl(HOST)]: good([{ type: "TXT", content: "v=spf1 ~all" }, { type: "MX", content: "mx.example.net" }]) }));
  assert.equal(ok.code, 0, ok.stdout);
});

withDomains("a token that cannot read zones or DNS only gets a note; the deploy itself will say if attaching fails", async () => {
  const noZones = await preflight(all({ [zoneUrl(ZONE.name)]: refuse }));
  assert.equal(noZones.code, 0, noZones.stdout);
  assert.match(noZones.stdout, /no Zone → Zone → Read permission/);
  const noDns = await preflight(all({ [dnsUrl(HOST)]: refuse }));
  assert.equal(noDns.code, 0, noDns.stdout);
  assert.match(noDns.stdout, /token has no DNS Read/);
});

test("SITE_URL must be a name the Worker is attached to (or the free workers.dev address)", async () => {
  const wrongSite = toml.replace(/^SITE_URL = "[^"]*"/m, 'SITE_URL = "https://learn.example.org"');
  const r = await preflight(all(), {}, wrongSite);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /learn\.example\.org.*not in the `routes` list/);

  const onlyFree = toml.replace(/^routes\s*=.*$/m, "").replace(/^SITE_URL = "[^"]*"/m, `SITE_URL = "https://${NAME}.${SUBDOMAIN}.workers.dev"`);
  const free = await preflight(all(), {}, onlyFree);
  assert.equal(free.code, 0, free.stdout);
  assert.ok(!free.seen.some((u) => u.startsWith("/zones")), "without custom domains no zone is looked up");
});

test("the real wrangler.toml is consistent: SITE_URL is one of its custom domains and every route is a custom domain", () => {
  const site = new URL(readSiteUrl(toml)).hostname;
  if (!site.endsWith(".workers.dev")) assert.ok(DOMAINS.includes(site), `SITE_URL (${site}) must be one of the routes: ${DOMAINS.join(", ")}`);
  const patterns = [...toml.split(/^\s*\[/m)[0].replace(/^\s*#.*$/gm, "").matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(patterns, DOMAINS, "a route without custom_domain = true would need a DNS record of its own");
  for (const d of DOMAINS) assert.match(d, /^[a-z0-9.-]+$/, "plain host names only: no path, no wildcard");
});
