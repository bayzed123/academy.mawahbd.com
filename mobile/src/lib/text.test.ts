/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { plainText } from "./text.ts";

test("a product description loses its Markdown marks but keeps its lines and bullets", () => {
  const md = "## সাইজ\n\n**৮ ইঞ্চি** ছাঁচ, *নন-স্টিক*\n\n- ফুড গ্রেড\n* ওভেন সেফ\n\n\n\nদেখুন [আমাদের ওয়েবসাইট](https://mawahacademy.com) ![ছবি](/media/x.webp)";
  assert.equal(plainText(md), "সাইজ\n\n৮ ইঞ্চি ছাঁচ, নন-স্টিক\n\n• ফুড গ্রেড\n• ওভেন সেফ\n\nদেখুন আমাদের ওয়েবসাইট");
});

test("plain text stays as it is", () => {
  assert.equal(plainText("Whisk 2 eggs (large) at 5:30 — done."), "Whisk 2 eggs (large) at 5:30 — done.");
});
