/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyboardOverlap, revealOffset, REVEAL_MARGIN } from "./keyboard.ts";

// a phone 800 points tall; the keyboard's top at 480 (it takes the lower 320)
const KEYBOARD_TOP = 480;

test("the keyboard covers the part of a screen below its top edge — none when the screen already ends above it", () => {
  assert.equal(keyboardOverlap({ top: 0, height: 800 }, KEYBOARD_TOP), 320); // edge to edge: the whole keyboard
  assert.equal(keyboardOverlap({ top: 56, height: 680 }, KEYBOARD_TOP), 256); // a screen with a header and a tab bar
  assert.equal(keyboardOverlap({ top: 0, height: 480 }, KEYBOARD_TOP), 0); // an older Android that shrank the window itself
  assert.equal(keyboardOverlap({ top: 0, height: 0 }, KEYBOARD_TOP), 0); // a screen that is not showing
  assert.equal(keyboardOverlap({ top: 0, height: 800 }, Number.NaN), 0);
});

test("a box behind the keyboard is scrolled up until it and its message are above it", () => {
  // the password box at 560–612 on the screen, the view scrolled 0: it goes up by 612 + 56 − 480 = 188
  assert.equal(revealOffset({ offset: 0, viewTop: 0, viewBottom: KEYBOARD_TOP, fieldTop: 560, fieldBottom: 612 }), 188);
  // already scrolled 100: from there
  assert.equal(revealOffset({ offset: 100, viewTop: 0, viewBottom: KEYBOARD_TOP, fieldTop: 560, fieldBottom: 612 }), 288);
});

test("a box in clear view stays where it is; one above the view is brought down, with its label", () => {
  assert.equal(revealOffset({ offset: 0, viewTop: 0, viewBottom: KEYBOARD_TOP, fieldTop: 200, fieldBottom: 252 }), null);
  // its top at 20 under a header that ends at 56: down until its label shows (56 − (20 − 40) = 76 less)
  assert.equal(revealOffset({ offset: 300, viewTop: 56, viewBottom: KEYBOARD_TOP, fieldTop: 20, fieldBottom: 72 }), 224);
  // never above the very top
  assert.equal(revealOffset({ offset: 10, viewTop: 56, viewBottom: KEYBOARD_TOP, fieldTop: 20, fieldBottom: 72 }), 0);
});

test("a box taller than the room left (a notes box) shows its top, not its bottom", () => {
  const r = revealOffset({ offset: 0, viewTop: 0, viewBottom: 300, fieldTop: 400, fieldBottom: 700 });
  assert.equal(r, 400 - REVEAL_MARGIN.above);
});

test("nothing to do without room or with a box measured wrong", () => {
  assert.equal(revealOffset({ offset: 0, viewTop: 480, viewBottom: 480, fieldTop: 600, fieldBottom: 650 }), null);
  assert.equal(revealOffset({ offset: 0, viewTop: 0, viewBottom: 480, fieldTop: 650, fieldBottom: 600 }), null);
});
