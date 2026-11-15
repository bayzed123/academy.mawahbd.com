/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { badgeText, FRESH_DAYS, newestId, unreadOf } from "./inbox.ts";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

test("only notifications newer than the last one seen, and not old ones, count as new", () => {
  const items = [
    { id: 9, created_at: ago(0) },
    { id: 8, created_at: ago(2) },
    { id: 5, created_at: ago(FRESH_DAYS + 1) },
  ];
  assert.equal(unreadOf(items, 0, NOW), 2); // a new install: last month's news is not "new"
  assert.equal(unreadOf(items, 8, NOW), 1);
  assert.equal(unreadOf(items, 9, NOW), 0);
  assert.equal(unreadOf([], 0, NOW), 0);
});

test("the badge says the number, or 9+ for more", () => {
  const bn = (v: number) => String(v).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]!);
  assert.equal(badgeText(3, String), "3");
  assert.equal(badgeText(12, String), "9+");
  assert.equal(badgeText(4, bn), "৪");
  assert.equal(badgeText(10, bn), "৯+");
});

test("the newest id is what is remembered as seen", () => {
  assert.equal(newestId([{ id: 3 }, { id: 11 }, { id: 7 }]), 11);
  assert.equal(newestId([]), 0);
});
