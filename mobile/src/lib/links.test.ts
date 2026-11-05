/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { safeWebUrl, siteLinks, telLink, whatsappLink } from "./links.ts";

const BASE = "https://mawahacademy.com";

test("website addresses follow the language", () => {
  assert.equal(siteLinks(BASE, "bn").product("cake-mould"), "https://mawahacademy.com/shop/p/cake-mould");
  assert.equal(siteLinks(BASE, "en").product("cake-mould"), "https://mawahacademy.com/en/shop/p/cake-mould");
  assert.equal(siteLinks(BASE, "en").policy("privacy"), "https://mawahacademy.com/en/policies/privacy");
  assert.equal(siteLinks(BASE, "bn").accountDelete, "https://mawahacademy.com/account/delete");
  assert.equal(siteLinks(BASE, "en").accountDelete, "https://mawahacademy.com/en/account/delete");
  assert.equal(siteLinks(BASE, "bn").certificate("AB12-CD34"), "https://mawahacademy.com/certificate/AB12-CD34");
  assert.equal(siteLinks(BASE, "bn").media("course/banner one.webp"), "https://mawahacademy.com/media/course/banner%20one.webp");
});

test("WhatsApp and phone links", () => {
  assert.equal(whatsappLink("+880 1712-345678"), "https://wa.me/8801712345678");
  assert.equal(whatsappLink("8801712345678", "আসসালামু আলাইকুম"), "https://wa.me/8801712345678?text=%E0%A6%86%E0%A6%B8%E0%A6%B8%E0%A6%BE%E0%A6%B2%E0%A6%BE%E0%A6%AE%E0%A7%81%20%E0%A6%86%E0%A6%B2%E0%A6%BE%E0%A6%87%E0%A6%95%E0%A7%81%E0%A6%AE");
  assert.equal(whatsappLink(""), null);
  assert.equal(telLink("+880 1712-345678"), "tel:+8801712345678");
  assert.equal(telLink("call us"), null);
});

test("only web pages may be opened from a server link", () => {
  assert.equal(safeWebUrl("https://facebook.com/groups/x"), "https://facebook.com/groups/x");
  assert.equal(safeWebUrl("javascript:alert(1)"), null);
  assert.equal(safeWebUrl("intent://scan/#Intent;scheme=zxing;end"), null);
  assert.equal(safeWebUrl("not a url"), null);
  assert.equal(safeWebUrl(null), null);
});
