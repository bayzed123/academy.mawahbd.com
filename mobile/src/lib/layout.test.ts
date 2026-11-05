/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT_MAX, contentWidth, gridColumns, tileWidth } from "./layout.ts";

test("phones use their full width, tablets a centred column", () => {
  assert.equal(contentWidth(360), 328); // a common Android phone
  assert.equal(contentWidth(412), 380);
  assert.equal(contentWidth(600), 568); // a 7-inch tablet, upright
  assert.equal(contentWidth(800), CONTENT_MAX); // a 10-inch tablet, upright
  assert.equal(contentWidth(1280), CONTENT_MAX); // and on its side
  assert.equal(contentWidth(10), 0);
});

test("the shop shows 2 products in a row on a phone, 3 on a 7-inch tablet, 4 on a 10-inch one", () => {
  assert.equal(gridColumns(contentWidth(360)), 2);
  assert.equal(gridColumns(contentWidth(600)), 3);
  assert.equal(gridColumns(contentWidth(800)), 4);
  assert.equal(tileWidth(328, 2), 158);
  assert.equal(tileWidth(CONTENT_MAX, 4), 181);
});
