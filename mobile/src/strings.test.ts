/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    if (key.startsWith("fc.") || key.startsWith("err.fc_")) continue; // FoodCost's prices are ingredients' and a cook's own (checked below)
    assert.doesNotMatch(text, /\b(buy|purchase|enrol(l)?( now)?|price)\b|কিনুন|ক্রয়|ভর্তি হোন|দাম/i, key);
  }
});

test("FoodCost never offers to buy, upgrade or unlock anything, nor points to the website (not even its address, the PDF's footer included) or a class: its limit is said plainly (Google Play)", () => {
  const fc = [...Object.entries(en), ...Object.entries(bn)].filter(([key]) => key.startsWith("fc.") || key.startsWith("err.fc_"));
  assert.ok(fc.length > 200, "the FoodCost words were found");
  for (const [key, text] of fc) {
    assert.doesNotMatch(text, /\b(buy|purchase|enrol(l)?|upgrade|subscribe|subscription|premium|unlock|website|class(es)?)\b|mawahacademy\.com|https?:|www\.|কিনুন|ক্রয়|ভর্তি|আপগ্রেড|সাবস্ক্রাইব|ওয়েবসাইট|ক্লাস/i, key);
  }
  assert.equal(translate("en", "fc.limitReached", { limit: 3 }), "Free accounts keep 3 recipes. Delete one to save a new one.");
});

test("the notifications' words offer nothing to buy, and say how to turn them off (Google Play: the person stays in control)", () => {
  const push = [...Object.entries(en), ...Object.entries(bn)].filter(([key]) => key.startsWith("push."));
  assert.ok(push.length >= 20, "the notification words were found");
  for (const [key, text] of push) assert.doesNotMatch(text, /\b(buy|purchase|price|pay|offer|discount|upgrade|subscribe|premium|unlock)\b|কিনুন|ক্রয়|দাম|অফার|ছাড়/i, key);
  assert.match(en["push.card.body"], /turn it off any time in Profile/);
  assert.match(bn["push.card.body"], /প্রোফাইল থেকে যেকোনো সময় বন্ধ/);
});

test("every problem FoodCost's engine can report, every kind of cost and what a cost is counted for has words in the app", () => {
  // read from the shared engine's source (the website and the server read the same lists), so a new one cannot be forgotten
  const source = readFileSync(new URL("../../shared/src/foodcost.ts", import.meta.url), "utf8");
  const list = (re: RegExp) => [...(re.exec(source)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const problems = list(/export type FcProblemCode =([\s\S]*?);/);
  const kinds = list(/export const FC_COST_KINDS[^=]*= \[([^\]]+)\]/);
  const pers = list(/export const FC_COST_PERS = \[([^\]]+)\]/);
  assert.ok(problems.length >= 10 && kinds.length === 4 && pers.length === 3, "the lists were found");
  const food = list(/export type FcNutritionProblemCode =([\s\S]*?);/);
  assert.ok(food.length >= 6, "the nutrition problems were found");
  for (const key of [...problems.map((p) => `fc.p.${p}`), ...food.map((p) => `fc.fp.${p}`), ...kinds.map((k) => `fc.kind.${k}`), ...pers.map((p) => `fc.per.${p}`)]) assert.ok(key in en, key);
});
