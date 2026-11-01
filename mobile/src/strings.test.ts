/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { bn, en, errorKey, translate } from "./strings.ts";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("Bangla and English have the same keys and the same {placeholders}", () => {
  assert.deepEqual(Object.keys(bn).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    assert.deepEqual(placeholders(bn[key]), placeholders(en[key]), key);
    assert.ok(bn[key].trim().length > 0, `${key} is empty in Bangla`);
  }
});

test("t() fills placeholders and keeps unknown ones visible", () => {
  assert.equal(translate("en", "learning.progress", { done: 3, total: 8 }), "3 of 8 lessons");
  assert.equal(translate("bn", "learning.progress", { done: "৩", total: "৮" }), "৮টির মধ্যে ৩টি লেসন");
  assert.equal(translate("en", "home.hello", {}), "Assalamu alaikum, {name}!");
});

test("server error codes map to words, unknown ones to the general message", () => {
  assert.equal(errorKey("invalid_credentials"), "err.invalid_credentials");
  assert.equal(errorKey("something_new"), "err.server");
  assert.equal(errorKey(undefined), "err.server");
});

test("no class price or buy wording anywhere in the app (Google Play: classes are bought on the website)", () => {
  for (const [key, text] of [...Object.entries(en), ...Object.entries(bn)]) {
    if (key.startsWith("shop.")) continue; // the equipment shop sells physical goods
    assert.doesNotMatch(text, /\b(buy|purchase|enrol(l)?( now)?|price)\b|কিনুন|ক্রয়|ভর্তি হোন|দাম/i, key);
  }
});
