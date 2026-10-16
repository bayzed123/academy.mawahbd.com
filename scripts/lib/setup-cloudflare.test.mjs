import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findPlaceholders } from "./toml-patch.mjs";

/*
 * Runs scripts/setup-cloudflare.mjs — the thing GitHub's Deploy workflow runs before and after every deploy — against a
 * stand-in for Wrangler that keeps a pretend Cloudflare account in a file. It checks what the script does to a fresh
 * account, that a second run changes nothing, that secrets are never printed and never invented, and that a missing
 * R2 subscription ends with a plain explanation. Nothing here talks to Cloudflare.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));

const FAKE_WRANGLER = `#!/usr/bin/env node
const fs = require("node:fs");
const file = process.env.FAKE_STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
const a = process.argv.slice(2);
s.calls.push(a.join(" "));
const done = (code = 0) => { fs.writeFileSync(file, JSON.stringify(s)); process.exit(code); };
const say = (x) => process.stdout.write(typeof x === "string" ? x : JSON.stringify(x, null, 2));
const stdin = () => { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } };
const workerName = (fs.readFileSync("wrangler.toml", "utf8").match(/^name\\s*=\\s*"([^"]+)"/m) || [])[1];
const cmd = a.slice(0, 2).join(" ");

if (a[0] === "whoami") { say("You are logged in with an API Token.\\n"); done(); }
if (cmd === "d1 list") { say(s.d1); done(); }
if (cmd === "d1 create") { s.d1.push({ uuid: "d1-" + (s.d1.length + 1) + "-uuid", name: a[2] }); say("Created\\n"); done(); }
if (a[0] === "kv" && a[2] === "list") { say(s.kv); done(); }
if (a[0] === "kv" && a[2] === "create") {
  // Wrangler 4.151 on the real account titled it just "KV"; older ones used "<worker>-KV" (the tests can ask for either)
  const title = s.kvTitle === "worker-prefixed" ? workerName + "-" + a[3] : s.kvTitle || a[3];
  // like Cloudflare, refuse a second namespace with the same title
  if (s.kv.some((n) => n.title === title)) { process.stderr.write("A namespace with this title already exists [code: 10014]\\n"); done(1); }
  s.kv.push({ id: "kv" + (s.kv.length + 1) + "id", title });
  say("Created\\n");
  done();
}
if (a[0] === "r2" && s.r2Disabled) { process.stderr.write("Please enable R2 through the Cloudflare Dashboard. [code: 10042]\\n"); done(1); }
if (cmd === "r2 bucket" && a[2] === "list") { say(s.r2.map((n) => "name:           " + n + "\\n").join("")); done(); }
if (cmd === "r2 bucket" && a[2] === "create") { s.r2.push(a[3]); say("Created\\n"); done(); }
if (cmd === "secret list") { say(s.secrets.map((name) => ({ name, type: "secret_text" }))); done(); }
if (cmd === "secret put") { s.secretValues[a[2]] = stdin(); s.secrets.push(a[2]); say("Success\\n"); done(); }
process.stderr.write("fake wrangler: unexpected command " + a.join(" ") + "\\n");
done(2);
`;

function sandbox(initial = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mawah-setup-"));
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  mkdirSync(join(dir, "worker"));
  copyFileSync(join(root, "scripts/setup-cloudflare.mjs"), join(dir, "scripts/setup-cloudflare.mjs"));
  copyFileSync(join(root, "scripts/lib/toml-patch.mjs"), join(dir, "scripts/lib/toml-patch.mjs"));
  copyFileSync(join(root, "worker/wrangler.toml"), join(dir, "worker/wrangler.toml"));
  const bin = join(dir, "fake-wrangler.cjs");
  writeFileSync(bin, FAKE_WRANGLER);
  chmodSync(bin, 0o755);
  const state = join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ d1: [], kv: [], r2: [], secrets: [], secretValues: {}, calls: [], ...initial }));
  return {
    toml: () => readFileSync(join(dir, "worker/wrangler.toml"), "utf8"),
    state: () => JSON.parse(readFileSync(state, "utf8")),
    run(args, env = {}) {
      const r = spawnSync(process.execPath, [join(dir, "scripts/setup-cloudflare.mjs"), ...args], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, WRANGLER_BIN: bin, FAKE_STATE: state, ...env },
      });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    },
  };
}

const creates = (calls) => calls.filter((c) => /(^| )(create|put)( |$)/.test(c));

test("a fresh account: creates the database, the KV namespace and the bucket, and fills the IDs in", () => {
  const sb = sandbox();
  const r = sb.run(["--ci"]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(findPlaceholders(sb.toml()), []);
  assert.match(sb.toml(), /database_id = "d1-1-uuid"/);
  assert.match(sb.toml(), /^id = "kv1id"/m);
  assert.deepEqual(creates(sb.state().calls), ["d1 create mawah-academy-db", "kv namespace create KV", "r2 bucket create mawah-academy-media"]);
  assert.doesNotMatch(r.out, /Next steps/, "automation prints no hand-holding text");
  assert.ok(!sb.state().calls.includes("whoami"), "no separate login check in automation: the access check came first and Wrangler reports real errors itself");
});

test("running it again creates nothing and changes nothing", () => {
  const sb = sandbox();
  assert.equal(sb.run(["--ci"]).code, 0);
  const first = sb.toml();
  const callsBefore = sb.state().calls.length;
  const again = sb.run(["--ci"]);
  assert.equal(again.code, 0, again.out);
  assert.deepEqual(creates(sb.state().calls.slice(callsBefore)), []);
  assert.equal(sb.toml(), first);
});

test("the namespace the real Wrangler made on the owner's account (titled just \u201cKV\u201d) is found again on the next deploy", () => {
  const sb = sandbox({ kv: [{ id: "f14a64bf5acd4b95ad631d062dfe7e6d", title: "KV" }] });
  const r = sb.run(["--ci"]);
  assert.equal(r.code, 0, r.out);
  assert.match(sb.toml(), /^id = "f14a64bf5acd4b95ad631d062dfe7e6d"/m);
  assert.equal(sb.state().calls.filter((c) => c.startsWith("kv namespace create")).length, 0, "no second namespace");
});

test("a KV namespace titled \u201c<worker>-KV\u201d (older Wrangler) is found again too, and two runs in a row make exactly one", () => {
  const sb = sandbox({ kvTitle: "worker-prefixed" });
  assert.equal(sb.run(["--ci"]).code, 0);
  assert.equal(sb.state().kv[0].title, "academy-mawahbd-com-KV");
  assert.equal(sb.run(["--ci"]).code, 0);
  assert.equal(sb.state().kv.length, 1);
});

test("a KV namespace made under the Worker's earlier name is reused, not duplicated", () => {
  const sb = sandbox({ kv: [{ id: "oldkv", title: "mawah-academy-KV" }] });
  assert.equal(sb.run(["--ci"]).code, 0);
  assert.match(sb.toml(), /^id = "oldkv"/m);
  assert.equal(sb.state().calls.filter((c) => c.startsWith("kv namespace create")).length, 0);
});

test("a new KV namespace is found even when this Wrangler titles it differently", () => {
  const sb = sandbox({ kvTitle: "some-other-title", kv: [{ id: "someone-elses", title: "unrelated" }] });
  assert.equal(sb.run(["--ci"]).code, 0);
  assert.match(sb.toml(), /^id = "kv2id"/m, "the namespace that appeared, not the unrelated one");
});

test("secrets: APP_SECRET is random, SETUP_TOKEN comes from the environment, and neither is ever printed", () => {
  const sb = sandbox();
  const token = "my-own-long-setup-token-42";
  const r = sb.run(["--ci", "--no-resources", "--secrets"], { SETUP_TOKEN: `${token}\n` });
  assert.equal(r.code, 0, r.out);
  const s = sb.state();
  assert.ok(s.secretValues.APP_SECRET.length >= 48, "a long random APP_SECRET");
  assert.equal(s.secretValues.SETUP_TOKEN, token, "the owner's token, trimmed");
  assert.ok(!r.out.includes(token) && !r.out.includes(s.secretValues.APP_SECRET), "no secret value in the output");
  assert.deepEqual(s.calls.filter((c) => /^(d1|kv|r2) /.test(c)), [], "--no-resources leaves the database, KV and R2 alone");
  assert.equal(sb.toml(), readFileSync(join(root, "worker/wrangler.toml"), "utf8"), "and the file");
});

test("secrets already on the Worker are left alone", () => {
  const sb = sandbox({ secrets: ["APP_SECRET", "SETUP_TOKEN"] });
  const r = sb.run(["--ci", "--no-resources", "--secrets"], { SETUP_TOKEN: "another-long-token-value" });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(creates(sb.state().calls), []);
});

test("no SETUP_TOKEN is ever invented in automation; a too-short one is refused", () => {
  const none = sandbox();
  const r1 = none.run(["--ci", "--no-resources", "--secrets"]);
  assert.equal(r1.code, 0, r1.out);
  assert.deepEqual(Object.keys(none.state().secretValues), ["APP_SECRET"]);
  assert.match(r1.out, /no SETUP_TOKEN yet/);

  const short = sandbox();
  const r2 = short.run(["--ci", "--no-resources", "--secrets"], { SETUP_TOKEN: "short" });
  assert.equal(r2.code, 0, r2.out);
  assert.deepEqual(Object.keys(short.state().secretValues), ["APP_SECRET"]);
  assert.match(r2.out, /shorter than 12/);
});

// A made-up key with the shape of a real one, built here so no key-shaped text sits in the source.
const fakeResendKey = () => `re${"_"}${"Ab3".repeat(12)}`;

test("the e-mail key comes from the GitHub secret RESEND_API_KEY and is never printed", () => {
  const sb = sandbox();
  const key = fakeResendKey();
  const r = sb.run(["--ci", "--no-resources", "--secrets"], { SETUP_TOKEN: "my-own-long-setup-token-42", RESEND_API_KEY: `${key}\n` });
  assert.equal(r.code, 0, r.out);
  assert.equal(sb.state().secretValues.RESEND_API_KEY, key, "the owner's key, trimmed");
  assert.ok(!r.out.includes(key), "the key is not in the output");
  assert.match(r.out, /RESEND_API_KEY created/);
});

test("a new GitHub secret RESEND_API_KEY replaces the one on the Worker at the next deploy (a rotated key or a new Resend account)", () => {
  const sb = sandbox({ secrets: ["APP_SECRET", "SETUP_TOKEN", "RESEND_API_KEY"], secretValues: { RESEND_API_KEY: `re${"_"}${"Zz9".repeat(12)}` } });
  const key = fakeResendKey();
  const r = sb.run(["--ci", "--no-resources", "--secrets"], { RESEND_API_KEY: key });
  assert.equal(r.code, 0, r.out);
  assert.equal(sb.state().secretValues.RESEND_API_KEY, key, "the GitHub secret is the one in force");
  assert.deepEqual(creates(sb.state().calls), ["secret put RESEND_API_KEY"], "only the e-mail key is touched");
  assert.match(r.out, /RESEND_API_KEY updated/);
  assert.ok(!r.out.includes(key), "and still not printed");
});

test("an e-mail key already on the Worker stays when the GitHub secret is missing or is not a Resend key", () => {
  const before = `re${"_"}${"Zz9".repeat(12)}`;
  const sb = sandbox({ secrets: ["APP_SECRET", "SETUP_TOKEN", "RESEND_API_KEY"], secretValues: { RESEND_API_KEY: before } });
  const none = sb.run(["--ci", "--no-resources", "--secrets"]);
  assert.equal(none.code, 0, none.out);
  assert.deepEqual(creates(sb.state().calls), []);
  assert.match(none.out, /RESEND_API_KEY is set on the Worker — left untouched/);

  const wrong = sb.run(["--ci", "--no-resources", "--secrets"], { RESEND_API_KEY: "not-a-resend-key" });
  assert.equal(wrong.code, 0, wrong.out);
  assert.deepEqual(creates(sb.state().calls), []);
  assert.match(wrong.out, /does not look like a Resend key.*already on the Worker stays/);
  assert.equal(sb.state().secretValues.RESEND_API_KEY, before, "the working key is not overwritten by garbage");
});

test("no GitHub secret RESEND_API_KEY: nothing is invented, and the output says what to do; something that is not a Resend key is refused", () => {
  const none = sandbox();
  const r1 = none.run(["--ci", "--no-resources", "--secrets"]);
  assert.equal(r1.code, 0, r1.out);
  assert.ok(!("RESEND_API_KEY" in none.state().secretValues));
  assert.match(r1.out, /no RESEND_API_KEY yet/);

  const wrong = sandbox();
  const r2 = wrong.run(["--ci", "--no-resources", "--secrets"], { RESEND_API_KEY: "not-a-resend-key" });
  assert.equal(r2.code, 0, r2.out);
  assert.ok(!("RESEND_API_KEY" in wrong.state().secretValues));
  assert.match(r2.out, /does not look like a Resend key/);
  assert.ok(!r2.out.includes("not-a-resend-key"), "even a wrong value is not echoed");
});

// Made-up values of the right shape, built here so nothing key-like sits in the source.
const fakeSmsKey = () => ["Ab", "Cd", "Ef", "Gh", "12", "34"].join("") + ".5678";
const SMS_URL = "https://msg.example-sms.test";

test("the SMS key and address come from the GitHub secrets SMS_API_KEY / SMS_API_URL and are never printed", () => {
  const sb = sandbox();
  const key = fakeSmsKey();
  const r = sb.run(["--ci", "--no-resources", "--secrets"], { SETUP_TOKEN: "my-own-long-setup-token-42", SMS_API_KEY: `${key}\n`, SMS_API_URL: `${SMS_URL}\n` });
  assert.equal(r.code, 0, r.out);
  assert.equal(sb.state().secretValues.SMS_API_KEY, key, "the owner's key, trimmed");
  assert.equal(sb.state().secretValues.SMS_API_URL, SMS_URL);
  assert.ok(!r.out.includes(key), "the key is not in the output");
  assert.match(r.out, /SMS_API_KEY created/);
  assert.match(r.out, /SMS_API_URL created/);
});

test("the SSLCommerz store ID and password can come from GitHub secrets too, and replace the ones on the Worker", () => {
  const sb = sandbox({ secrets: ["APP_SECRET", "SETUP_TOKEN", "SSLCOMMERZ_STORE_ID"], secretValues: { SSLCOMMERZ_STORE_ID: "oldstoreid" } });
  const r = sb.run(["--ci", "--no-resources", "--secrets"], { SSLCOMMERZ_STORE_ID: "newstoreid", SSLCOMMERZ_STORE_PASSWORD: "store-password-for-tests" });
  assert.equal(r.code, 0, r.out);
  assert.equal(sb.state().secretValues.SSLCOMMERZ_STORE_ID, "newstoreid");
  assert.equal(sb.state().secretValues.SSLCOMMERZ_STORE_PASSWORD, "store-password-for-tests");
  assert.match(r.out, /SSLCOMMERZ_STORE_ID updated/);
  assert.ok(!r.out.includes("store-password-for-tests"), "the password is not in the output");
});

test("an SMS key set in Cloudflare stays when there is no GitHub secret, and a wrong-looking GitHub secret never replaces it", () => {
  const sb = sandbox({ secrets: ["APP_SECRET", "SETUP_TOKEN", "SMS_API_KEY", "SMS_API_URL"], secretValues: { SMS_API_KEY: "already-on-the-worker", SMS_API_URL: SMS_URL } });
  const none = sb.run(["--ci", "--no-resources", "--secrets"]);
  assert.equal(none.code, 0, none.out);
  assert.deepEqual(creates(sb.state().calls), [], "nothing is touched");
  assert.match(none.out, /SMS_API_KEY is set on the Worker — left untouched/);

  const wrong = sb.run(["--ci", "--no-resources", "--secrets"], { SMS_API_KEY: "has spaces in it", SMS_API_URL: "http://not-https.test" });
  assert.equal(wrong.code, 0, wrong.out);
  assert.deepEqual(creates(sb.state().calls), []);
  assert.match(wrong.out, /SMS_API_URL does not look right.*already on the Worker stays/);
  assert.equal(sb.state().secretValues.SMS_API_KEY, "already-on-the-worker");
  assert.ok(!wrong.out.includes("has spaces in it"), "even a wrong value is not echoed");
});

test("with no SMS or SSLCommerz secrets anywhere the script says nothing about them and invents nothing", () => {
  const sb = sandbox();
  const r = sb.run(["--ci", "--no-resources", "--secrets"]);
  assert.equal(r.code, 0, r.out);
  for (const name of ["SMS_API_KEY", "SMS_API_URL", "SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_STORE_PASSWORD"]) assert.ok(!(name in sb.state().secretValues), name);
});

// A made-up key file of the right shape (the "key" inside is filler: it only has to look like one), built here so nothing key-like sits in the source.
const fakeGoogleKeyFile = (over = {}) =>
  JSON.stringify(
    {
      type: "service_account",
      project_id: "mawah-test",
      private_key_id: "0123456789abcdef",
      private_key: ["-----BEGIN PRIVATE KEY-----", "QUJD".repeat(16), "REVG".repeat(16), "-----END PRIVATE KEY-----", ""].join("\n"),
      client_email: "reader@mawah-test.iam.gserviceaccount.com",
      client_id: "1",
      ...over,
    },
    null,
    2,
  );

test("the Google Analytics key file comes from the GitHub secret GOOGLE_SERVICE_ACCOUNT — the file itself or that file in base64 — and reaches the Worker as one line, never printed", () => {
  const file = fakeGoogleKeyFile();
  for (const [how, value] of [["the file", file], ["the file in base64", Buffer.from(file).toString("base64")], ["the file with a newline after it", `${file}\n`]]) {
    const sb = sandbox();
    const r = sb.run(["--ci", "--no-resources", "--secrets"], { GOOGLE_SERVICE_ACCOUNT: value });
    assert.equal(r.code, 0, `${how}: ${r.out}`);
    const put = sb.state().secretValues.GOOGLE_SERVICE_ACCOUNT;
    assert.ok(put && !put.includes("\n"), `${how}: one line`);
    assert.deepEqual(JSON.parse(put), JSON.parse(file), `${how}: the same file`);
    assert.match(r.out, /GOOGLE_SERVICE_ACCOUNT created/);
    assert.ok(!r.out.includes("QUJD") && !r.out.includes("PRIVATE KEY"), `${how}: no key material in the output`);
    assert.deepEqual(creates(sb.state().calls).filter((c) => c.includes("GOOGLE")), ["secret put GOOGLE_SERVICE_ACCOUNT"]);
  }
});

test("a new Google key in the GitHub secret replaces the one on the Worker at the next deploy; nothing is touched without one", () => {
  const before = fakeGoogleKeyFile({ client_email: "old@mawah-test.iam.gserviceaccount.com" });
  const sb = sandbox({ secrets: ["APP_SECRET", "SETUP_TOKEN", "GOOGLE_SERVICE_ACCOUNT"], secretValues: { GOOGLE_SERVICE_ACCOUNT: before } });
  const none = sb.run(["--ci", "--no-resources", "--secrets"]);
  assert.equal(none.code, 0, none.out);
  assert.deepEqual(creates(sb.state().calls), [], "nothing is touched");
  assert.match(none.out, /GOOGLE_SERVICE_ACCOUNT is set on the Worker — left untouched/);
  assert.equal(sb.state().secretValues.GOOGLE_SERVICE_ACCOUNT, before);

  const next = fakeGoogleKeyFile({ client_email: "new@mawah-test.iam.gserviceaccount.com" });
  const r = sb.run(["--ci", "--no-resources", "--secrets"], { GOOGLE_SERVICE_ACCOUNT: next });
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(sb.state().secretValues.GOOGLE_SERVICE_ACCOUNT).client_email, "new@mawah-test.iam.gserviceaccount.com");
  assert.match(r.out, /GOOGLE_SERVICE_ACCOUNT updated/);
});

test("something that is not a service-account key file (a part of it, the e-mail alone, a login file, a public key, rubbish) never replaces a working key and is never echoed", () => {
  const good = fakeGoogleKeyFile();
  const wrongs = [
    "reader@mawah-test.iam.gserviceaccount.com",
    "not json at all, only words from a chat",
    '{"client_email": "reader@mawah-test.iam.gserviceaccount.com"}',
    fakeGoogleKeyFile({ type: "authorized_user" }),
    fakeGoogleKeyFile({ private_key: "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----\n" }),
    fakeGoogleKeyFile({ client_email: "not-an-address" }),
    good.slice(0, good.length - 40), // cut off on the way
    "e30=", // base64 of {}
  ];
  const sb = sandbox({ secrets: ["APP_SECRET", "SETUP_TOKEN", "GOOGLE_SERVICE_ACCOUNT"], secretValues: { GOOGLE_SERVICE_ACCOUNT: good } });
  for (const wrong of wrongs) {
    const r = sb.run(["--ci", "--no-resources", "--secrets"], { GOOGLE_SERVICE_ACCOUNT: wrong });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /GOOGLE_SERVICE_ACCOUNT does not look right.*already on the Worker stays/s, wrong.slice(0, 30));
    assert.ok(!r.out.includes("QUJD") && !r.out.includes("not json at all"), "not echoed");
  }
  assert.deepEqual(creates(sb.state().calls), []);
  assert.equal(sb.state().secretValues.GOOGLE_SERVICE_ACCOUNT, good);
});

test("with no GOOGLE_SERVICE_ACCOUNT anywhere the script invents nothing", () => {
  const sb = sandbox();
  const r = sb.run(["--ci", "--no-resources", "--secrets"]);
  assert.equal(r.code, 0, r.out);
  assert.ok(!("GOOGLE_SERVICE_ACCOUNT" in sb.state().secretValues));
});

test("R2 not switched on: stops with the plain instruction", () => {
  const sb = sandbox({ r2Disabled: true });
  const r = sb.run(["--ci"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /R2 → Overview/);
});

test("a dry run calls nothing and changes nothing", () => {
  const sb = sandbox();
  const r = sb.run(["--dry-run", "--ci", "--secrets", "--domain", "learn.example.com"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /dry run/);
  assert.deepEqual(sb.state().calls, []);
  assert.equal(sb.toml(), readFileSync(join(root, "worker/wrangler.toml"), "utf8"));
});
