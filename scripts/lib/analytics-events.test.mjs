import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/*
 * The events the shop sends to Google Analytics are listed once, in shared/src/analytics.ts (GA_EVENTS). The pages that send them, the report that
 * counts them and the documentation that explains them all depend on that list, and nothing in TypeScript can connect a string in a plain
 * browser script to it — so this reads the sources:
 *   - an event a page sends must be in the list (otherwise the Admin → Analytics screen would not count or name it);
 *   - an event in the list must be sent by something (otherwise the screen promises a number nothing can produce) — except the few that
 *     Google sends by itself ("auto"), which the shop must NOT also send (they would be counted twice);
 *   - the names must be ones Google Analytics 4 accepts;
 *   - docs/analytics.md must describe every one.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

function* sources(dir, pattern) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path, pattern);
    else if (pattern.test(name) && !/\.test\./.test(name)) yield path;
  }
}

/** The catalogue, read from its source (the file is TypeScript; the entries are one per line). */
const catalogue = [...read("shared/src/analytics.ts").matchAll(/\{ name: "([a-z_0-9]+)", group: "([a-z]+)"(, auto: true)? \}/g)].map((m) => ({ name: m[1], group: m[2], auto: !!m[3] }));

/** Every event name the code sends, with where. */
function sent() {
  const found = new Map(); // name -> [files]
  const add = (name, file) => found.set(name, [...(found.get(name) ?? []), relative(root, file)]);
  const scan = (file, re) => {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) add(m[1], file);
  };
  scan(join(root, "marketing/analytics.js"), /\bemit\("([a-z_0-9]+)"/g); // the public site's own script
  scan(join(root, "marketing/chat.js"), /\bmawahTrack\("([a-z_0-9]+)"/g);
  for (const file of sources(join(root, "app/src"), /\.(tsx?|jsx?)$/)) {
    if (file.endsWith("lib/analytics.ts")) continue; // the helper itself
    scan(file, /\btrack\("([a-z_0-9]+)"/g);
  }
  // events a server-rendered page asks the script to send when it loads: ga={{ events: [["name", {…}]] }}
  for (const file of sources(join(root, "worker/src/views"), /\.tsx?$/)) scan(file, /\bevents: \[\["([a-z_0-9]+)"/g);
  return found;
}

test("the list of events is well-formed: unique names Google accepts, known groups, five steps of the buying path", () => {
  assert.ok(catalogue.length >= 40, `the catalogue could not be read (${catalogue.length} events)`);
  const names = catalogue.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, "a name is listed twice");
  // names Google Analytics 4 refuses to take as custom events
  const reserved = new Set(["ad_activeview", "ad_click", "ad_exposure", "ad_query", "ad_reward", "adunit_exposure", "app_background", "app_clear_data", "app_exception", "app_remove", "app_store_refund", "app_store_subscription_cancel", "app_store_subscription_convert", "app_store_subscription_renew", "app_update", "app_upgrade", "dynamic_link_app_open", "dynamic_link_app_update", "dynamic_link_first_open", "error", "first_open", "first_visit", "in_app_purchase", "notification_dismiss", "notification_foreground", "notification_open", "notification_receive", "os_update", "screen_view", "session_start", "user_engagement"]);
  for (const n of names) {
    assert.match(n, /^[a-z][a-z0-9_]{1,39}$/, `${n}: letters, digits and underscores only, at most 40 characters`);
    assert.ok(!/^(ga_|google_|firebase_)/.test(n), `${n}: starts with a prefix Google keeps for itself`);
    assert.ok(!reserved.has(n), `${n}: a name Google Analytics reserves`);
  }
  const groups = read("shared/src/analytics.ts").match(/GA_EVENT_GROUPS = \[([^\]]+)\]/)?.[1] ?? "";
  for (const e of catalogue) assert.ok(groups.includes(`"${e.group}"`), `${e.name}: group ${e.group} is not in GA_EVENT_GROUPS`);
  for (const step of ["view_item", "add_to_cart", "begin_checkout", "add_payment_info", "purchase"]) assert.ok(names.includes(step), `${step} is a step of the buying path`);
});

test("every event a page sends is in the list", () => {
  const known = new Set(catalogue.map((e) => e.name));
  const unknown = [...sent()].filter(([name]) => !known.has(name)).map(([name, files]) => `${name} (${[...new Set(files)].join(", ")})`);
  assert.deepEqual(unknown, [], "add these to GA_EVENTS in shared/src/analytics.ts (and give them names in shared/src/i18n/admin.ts and docs/analytics.md)");
  assert.ok(sent().size >= 35, `the sources could not be read (${sent().size} events found)`);
});

test("every event in the list is sent by something — except the ones Google sends by itself, which the shop must not send as well", () => {
  const out = sent();
  const silent = catalogue.filter((e) => !e.auto && !out.has(e.name)).map((e) => e.name);
  assert.deepEqual(silent, [], "listed but never sent: remove them from GA_EVENTS or send them");
  const doubled = catalogue.filter((e) => e.auto && out.has(e.name)).map((e) => e.name);
  assert.deepEqual(doubled, [], "Google's enhanced measurement already sends these; sending them too counts every one twice");
});

test("events carry no personal data: no e-mail, phone, name, address or free text of a person is ever a parameter", () => {
  // the parameter names used next to the calls, read from the sources; none may be a person's own details
  const personal = /\b(email|e_mail|phone|mobile|address|full_name|first_name|last_name|password|token|trxid|trx_id|payer_number|nid|passport)\b\s*:/i;
  const offenders = [];
  const files = [join(root, "marketing/analytics.js"), join(root, "marketing/chat.js"), ...sources(join(root, "app/src"), /\.(tsx?|jsx?)$/)];
  for (const file of files) {
    for (const [i, line] of readFileSync(file, "utf8").split("\n").entries()) {
      if (!/\b(?:track|emit|mawahTrack)\(/.test(line)) continue;
      if (personal.test(line)) offenders.push(`${relative(root, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, [], "an event must not carry who the person is");
});

test("docs/analytics.md describes every event", () => {
  const file = join(root, "docs/analytics.md");
  assert.ok(existsSync(file), "docs/analytics.md is missing");
  const doc = readFileSync(file, "utf8");
  const missing = catalogue.filter((e) => !doc.includes(`\`${e.name}\``)).map((e) => e.name);
  assert.deepEqual(missing, [], "describe these in docs/analytics.md (in backticks)");
});
