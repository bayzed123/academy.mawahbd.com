#!/usr/bin/env node
/**
 * Renders marketing/public/og-default.jpg (1200x630, a JPEG so it stays under ~100 KB: WhatsApp skips big preview images) — the picture shown when a page without its own image is
 * shared on Facebook / WhatsApp / Google. It is built from the brand's own fonts and colours, so re-run this after
 * a rebrand:   node scripts/gen-og-image.mjs      (CHROMIUM_PATH=/path/to/chrome if Playwright's browser is not installed)
 * Nothing here is a claim about the business: no counts, no ratings, no prices.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const font = (name) => `data:font/woff2;base64,${readFileSync(resolve(root, "marketing/public/fonts", name)).toString("base64")}`;

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Playfair;font-weight:600;src:url(${font("playfair-latin-600.woff2")}) format("woff2")}
@font-face{font-family:Tiro;src:url(${font("tiro-bn-400.woff2")}) format("woff2")}
@font-face{font-family:Hind;font-weight:400;src:url(${font("hind-latin-400.woff2")}) format("woff2");unicode-range:U+0000-00FF}
@font-face{font-family:Hind;font-weight:400;src:url(${font("hind-bn-400.woff2")}) format("woff2");unicode-range:U+0980-09FE}
@font-face{font-family:Hind;font-weight:600;src:url(${font("hind-latin-600.woff2")}) format("woff2");unicode-range:U+0000-00FF}
@font-face{font-family:Hind;font-weight:600;src:url(${font("hind-bn-600.woff2")}) format("woff2");unicode-range:U+0980-09FE}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;font-family:Hind,sans-serif;color:#fbf7ee;position:relative;
  background:radial-gradient(900px 520px at 85% 15%,#157a5b 0%,rgba(21,122,91,0) 70%),linear-gradient(135deg,#04261c 0%,#073b2c 55%,#0b4d3a 100%)}
.frame{position:absolute;inset:26px;border:2px solid rgba(201,162,75,.55);border-radius:26px}
.frame::after{content:"";position:absolute;inset:10px;border:1px solid rgba(201,162,75,.25);border-radius:18px}
.mark{position:absolute;right:90px;top:120px;width:330px;height:330px;opacity:.95}
.copy{position:absolute;left:92px;top:118px;width:640px}
.eyebrow{display:flex;align-items:center;gap:14px;font-weight:600;font-size:24px;letter-spacing:.34em;color:#e8d09a}
.eyebrow i{display:block;width:58px;height:2px;background:#c9a24b}
h1{font-family:Playfair,serif;font-weight:600;font-size:104px;line-height:1.04;margin:26px 0 6px;letter-spacing:.01em}
.bn{font-family:Tiro,Hind,serif;font-size:66px;color:#e8cf94;line-height:1.3}
.tag{margin-top:34px;font-size:32px;line-height:1.45;color:#dcefe6;max-width:600px}
.tag b{color:#e8d09a;font-weight:600}
.foot{position:absolute;left:92px;bottom:70px;font-size:26px;color:#e8d09a;font-weight:600;letter-spacing:.04em}
</style>
<div class="frame"></div>
<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
  <path d="M32 6c-11.6 0-20 8.4-20 19.6V58h40V25.6C52 14.4 43.600 6 32 6z" fill="#0b4d3a" stroke="#c9a24b" stroke-width="1.8"/>
  <path d="M32 11c-8.600 0-15 6.200-15 14.600V53h30V25.600C47 17.200 40.600 11 32 11z" fill="none" stroke="#c9a24b" stroke-width=".6" opacity=".6"/>
  <path d="M20.500 47V28.500L32 41l11.500-12.500V47" fill="none" stroke="#e8cf94" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="18" r="2.400" fill="#c9a24b"/>
</svg>
<div class="copy">
  <div class="eyebrow"><i></i>ACADEMY</div>
  <h1>MAWAH</h1>
  <div class="bn">মাওয়াহ একাডেমি</div>
  <p class="tag"><b>Cooking &amp; baking classes</b> you can learn at home — in Bangla.</p>
</div>
<div class="foot">academy.mawahbd.com</div>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const img = await page.screenshot({ type: "jpeg", quality: 84 });
await browser.close();
const out = resolve(root, "marketing/public/og-default.jpg");
writeFileSync(out, img);
console.log(`wrote ${out.replace(root + "/", "")} (${(img.length / 1024).toFixed(0)} KB)`);
