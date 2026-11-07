import assert from "node:assert/strict";
import { test } from "node:test";
import { screenOf, tappedPath } from "./pushPath.ts";

const tap = (data: unknown, remote?: Record<string, unknown>) => ({
  notification: { request: { content: { data }, trigger: remote ? { type: "push", remoteMessage: { data: remote } } : null } },
});

test("a tap opens only the app's own screens: Home, a free class, a demo, one of my classes", () => {
  for (const ok of ["/", "/free/cake-basics", "/course/beginners-baking-class", "/demo/eid-sweets-2026"]) assert.equal(screenOf(ok), ok);
  for (const bad of ["", "free/cake", "/free/", "/free/Cake", "/free/cake/../../login", "https://evil.example/free/x", "/delete-account", "/lesson/12", "/free/cake?x=1", `/free/${"a".repeat(140)}`, 42, null]) {
    assert.equal(screenOf(bad), null, String(bad));
  }
});

test("the path is read from the app's own data, or from Firebase's message when the phone showed it with the app closed", () => {
  assert.equal(tappedPath(tap({ path: "/course/cake", kind: "new_lessons" })), "/course/cake");
  assert.equal(tappedPath(tap({}, { path: "/free/cake", kind: "new_class" })), "/free/cake");
  assert.equal(tappedPath(tap(undefined, { path: "/free/cake" })), "/free/cake");
  assert.equal(tappedPath(tap({ path: "javascript:alert(1)" }, { path: "/free/cake" })), "/free/cake");
  assert.equal(tappedPath(tap({ path: "/somewhere-else" })), null);
  assert.equal(tappedPath(tap(null)), null);
});
