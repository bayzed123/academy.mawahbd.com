#!/usr/bin/env node
/**
 * One-time Cloudflare setup:   npm run setup:cloudflare -- [options]
 *
 * Creates (only if missing) the D1 database, the KV namespace and the R2 bucket this app needs, writes their IDs
 * into worker/wrangler.toml, and optionally sets the custom domain and the two secrets that must exist before the
 * first deploy. It talks to YOUR Cloudflare account through the Wrangler CLI — log in first (`npx wrangler login`)
 * or export CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
 *
 * Options
 *   --dry-run            print what would happen; touches nothing, calls nothing
 *   --domain <host>      e.g. academy.mawahbd.com — enables the custom-domain route and sets SITE_URL
 *                        (the domain's DNS zone must already be on this Cloudflare account)
 *   --secrets            also create APP_SECRET (random, never printed) and SETUP_TOKEN (random, printed ONCE) if absent
 *
 * Safe to re-run: existing resources and secrets are detected and left alone. Nothing here deletes anything.
 * Cloudflare Stream and Workers AI are switched on per account in the dashboard (see docs/deployment.md).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findPlaceholders, patchToml } from "./lib/toml-patch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worker = resolve(root, "worker");
const tomlPath = resolve(worker, "wrangler.toml");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const DRY = has("--dry-run");
const domain = valueOf("--domain");

const D1_NAME = "mawah-academy-db";
const KV_TITLE = "mawah-academy-KV"; // wrangler names it "<worker name>-<binding>"
const R2_NAME = "mawah-academy-media";

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const step = (s) => console.log(`\n${bold("▸ " + s)}`);
const info = (s) => console.log(`  ${s}`);
const fail = (s) => {
  console.error(`\n\x1b[31m✗ ${s}\x1b[0m`);
  process.exit(1);
};

/** Runs `npx wrangler …` inside worker/. stdin is closed so Wrangler never stops to ask a question. */
function wrangler(args, { input, allowFail = false } = {}) {
  if (DRY) {
    info(`(dry run) npx wrangler ${args.join(" ")}`);
    return { ok: true, stdout: "" };
  }
  const r = spawnSync("npx", ["--no-install", "wrangler", ...args], { cwd: worker, encoding: "utf8", input, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0 && !allowFail) fail(`wrangler ${args.join(" ")} failed:\n${out.trim()}`);
  return { ok: r.status === 0, stdout: r.stdout ?? "", all: out };
}

function jsonOf(text, what) {
  const start = text.search(/[[{]/);
  if (start < 0) fail(`could not read the list of ${what} from Wrangler's output:\n${text}`);
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return fail(`could not parse the list of ${what} from Wrangler's output:\n${text}`);
  }
}

let toml = readFileSync(tomlPath, "utf8");
let d1Id;
let kvId;

console.log(bold("MAWAH Academy — Cloudflare setup") + (DRY ? yellow("  (dry run — nothing will be created or changed)") : ""));

if (!DRY) {
  step("Checking your Cloudflare login");
  const who = wrangler(["whoami"], { allowFail: true });
  if (!who.ok || /not authenticated/i.test(who.all ?? "")) fail("Wrangler is not logged in. Run `npx wrangler login` (or export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID) and try again.");
  info(green("logged in"));
}

step(`D1 database "${D1_NAME}"`);
if (DRY) {
  info(`(dry run) would look for it with "wrangler d1 list" and run: npx wrangler d1 create ${D1_NAME}  — only if it is missing`);
  d1Id = "<D1 id>";
} else {
  const list = jsonOf(wrangler(["d1", "list", "--json"]).stdout, "D1 databases");
  let found = list.find((d) => d.name === D1_NAME);
  if (!found) {
    info("not found — creating it");
    wrangler(["d1", "create", D1_NAME]);
    found = jsonOf(wrangler(["d1", "list", "--json"]).stdout, "D1 databases").find((d) => d.name === D1_NAME);
  } else info("already exists");
  if (!found?.uuid) fail("the D1 database was created but its ID could not be read — check `npx wrangler d1 list`.");
  d1Id = found.uuid;
  info(`id ${d1Id}`);
}

step(`KV namespace "${KV_TITLE}"`);
if (DRY) {
  info(`(dry run) would look for it with "wrangler kv namespace list" and run: npx wrangler kv namespace create KV  — only if it is missing`);
  kvId = "<KV id>";
} else {
  const read = () => jsonOf(wrangler(["kv", "namespace", "list"]).stdout, "KV namespaces");
  let found = read().find((n) => n.title === KV_TITLE);
  if (!found) {
    info("not found — creating it");
    wrangler(["kv", "namespace", "create", "KV"]);
    found = read().find((n) => n.title === KV_TITLE);
  } else info("already exists");
  if (!found?.id) fail("the KV namespace was created but its ID could not be read — check `npx wrangler kv namespace list`.");
  kvId = found.id;
  info(`id ${kvId}`);
}

step(`R2 bucket "${R2_NAME}"`);
if (DRY) info(`(dry run) would run: npx wrangler r2 bucket create ${R2_NAME}  — only if it is missing`);
else {
  const existing = wrangler(["r2", "bucket", "list"], { allowFail: true });
  if (existing.ok && existing.stdout.includes(R2_NAME)) info("already exists");
  else {
    const made = wrangler(["r2", "bucket", "create", R2_NAME], { allowFail: true });
    if (!made.ok && !/already exists/i.test(made.all)) fail(`could not create the R2 bucket. If R2 is not enabled on your account yet, enable it in the Cloudflare dashboard (R2 → Overview) and run this again.\n${made.all}`);
    info("created");
  }
}

step("Writing the IDs into worker/wrangler.toml");
const { text, changes } = patchToml(toml, { d1Id, kvId, domain });
if (changes.length === 0) info("nothing to change — the file already has real IDs");
else {
  for (const c of changes) info(`• ${c}`);
  if (!DRY) writeFileSync(tomlPath, text);
}
const left = findPlaceholders(DRY ? text : readFileSync(tomlPath, "utf8"));
if (left.length && !DRY) fail(`placeholders are still present in wrangler.toml: ${left.join(", ")}`);

let setupToken;
if (has("--secrets")) {
  step("Secrets");
  const present = DRY ? [] : jsonOf(wrangler(["secret", "list", "--format", "json"]).stdout, "secrets").map((s) => s.name);
  if (DRY) {
    info("(dry run) would create APP_SECRET (random, never printed) and SETUP_TOKEN (random, printed once) — each only if it does not exist yet");
  } else if (present.includes("APP_SECRET")) info("APP_SECRET already set — left untouched (changing it would sign everyone out and break stored passwords; see docs/security.md → key rotation)");
  else {
    wrangler(["secret", "put", "APP_SECRET"], { input: randomBytes(48).toString("base64url") });
    info(green("APP_SECRET created") + " (random, not shown)");
  }
  if (DRY) {
    /* nothing */
  } else if (present.includes("SETUP_TOKEN")) info("SETUP_TOKEN already set");
  else {
    setupToken = randomBytes(18).toString("base64url");
    wrangler(["secret", "put", "SETUP_TOKEN"], { input: setupToken });
    info(green("SETUP_TOKEN created"));
  }
}

console.log(`
${bold("Done.")}  Next steps (details in docs/deployment.md):
  1. ${has("--secrets") ? "✓ APP_SECRET / SETUP_TOKEN are set" : "Create the two required secrets:  npx wrangler secret put APP_SECRET   (a long random string)   and   SETUP_TOKEN"}
  2. Enable Cloudflare Stream and Workers AI on your account (dashboard), then put your Stream customer code in wrangler.toml → STREAM_CUSTOMER_CODE
  3. Create the tables:                      npm run db:migrate:remote
  4. Add the payment / e-mail secrets you use: SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASSWORD, RESEND_API_KEY …  (npx wrangler secret put NAME)
  5. Deploy:                                 npm run deploy      (or push to main — GitHub Actions deploys)
  6. Open https://${domain ?? "<your-domain>"}/admin/ and create the first admin with your SETUP_TOKEN, then delete the token:
                                             npx wrangler secret delete SETUP_TOKEN`);
if (setupToken) console.log(`\n  ${yellow("Your SETUP_TOKEN (shown once — copy it now):")} ${bold(setupToken)}`);
