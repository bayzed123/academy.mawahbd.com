import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readSiteUrl, readWorkerName } from "./toml-patch.mjs";

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
    const r = routes[req.url] ?? json(404, { success: false, errors: [{ code: 7003, message: "No route" }] });
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

const all = (over = {}) => ({
  [`/accounts/${ACCOUNT}/workers/scripts`]: good([{ id: NAME }]),
  [`/accounts/${ACCOUNT}/d1/database`]: good([]),
  [`/accounts/${ACCOUNT}/storage/kv/namespaces`]: good([]),
  [`/accounts/${ACCOUNT}/r2/buckets`]: good({ buckets: [] }),
  [`/accounts/${ACCOUNT}/workers/subdomain`]: good({ subdomain: SUBDOMAIN }),
  ...over,
});

async function preflight(routes, env = {}) {
  const api = await cloudflare(routes);
  try {
    const { stdout, code } = await promisify(execFile)(process.execPath, [`${root}scripts/ci-preflight.mjs`], {
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
