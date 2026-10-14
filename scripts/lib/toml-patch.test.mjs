import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { findPlaceholders, patchToml } from "./toml-patch.mjs";

const real = readFileSync(new URL("../../worker/wrangler.toml", import.meta.url), "utf8");

test("the shipped wrangler.toml still has both placeholders and the setup script fills exactly those", () => {
  assert.deepEqual(findPlaceholders(real).sort(), ["REPLACE_WITH_D1_ID", "REPLACE_WITH_KV_ID"]);
  const { text, changes } = patchToml(real, { d1Id: "11111111-2222-3333-4444-555555555555", kvId: "abcdef0123456789abcdef0123456789" });
  assert.equal(changes.length, 2);
  assert.deepEqual(findPlaceholders(text), []);
  assert.match(text, /database_id = "11111111-2222-3333-4444-555555555555"/);
  assert.match(text, /^id = "abcdef0123456789abcdef0123456789"/m);
});

test("re-running never overwrites IDs that are already real", () => {
  const first = patchToml(real, { d1Id: "aaaa", kvId: "bbbb" }).text;
  const again = patchToml(first, { d1Id: "cccc", kvId: "dddd" });
  assert.equal(again.changes.length, 0);
  assert.equal(again.text, first);
});

test("a custom domain enables the route and points SITE_URL at it", () => {
  const { text } = patchToml(real, { domain: "learn.example.com" });
  assert.match(text, /^routes = \[\{ pattern = "learn\.example\.com", custom_domain = true \}\]$/m);
  assert.match(text, /^SITE_URL = "https:\/\/learn\.example\.com"/m);
  // idempotent: a second run replaces the route line instead of adding another
  const again = patchToml(text, { domain: "other.example.org" }).text;
  assert.equal((again.match(/^routes\s*=/gm) ?? []).length, 1);
  assert.match(again, /other\.example\.org/);
});

test("rejects things that are not host names", () => {
  for (const bad of ["https://x.com", "x", "a b.com", "evil.com/path", '"; rm -rf /; "']) assert.throws(() => patchToml(real, { domain: bad }));
});

test("never touches secrets or other settings", () => {
  const { text } = patchToml(real, { d1Id: "x1", kvId: "y1", domain: "a.example.com" });
  const strip = (t) => t.split("\n").filter((l) => !/database_id|^id =|^routes|SITE_URL|^#\s*routes/.test(l)).join("\n");
  assert.equal(strip(text), strip(real));
});
