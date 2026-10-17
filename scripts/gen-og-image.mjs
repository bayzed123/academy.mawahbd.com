#!/usr/bin/env node
/**
 * Renders marketing/public/og-default.jpg (1200x630, a JPEG so it stays under ~100 KB: WhatsApp skips big preview images) — the picture shown when a page without its own image is
 * shared on Facebook / WhatsApp / Google. It shows the owner's logo (brand/mawah-logo.jpg) on the brand black, in the brand fonts, and the site's
 * address — taken from SITE_URL in worker/wrangler.toml, never written in here — so re-run this after a rebrand or a change of domain:
 *   npm run og:image      (CHROMIUM_PATH=/path/to/chrome if Playwright's browser is not installed)
 * The picture carries the address it shows as a comment (scripts/lib/share-image.mjs): a test fails when SITE_URL changed and this was not re-run.
 * Nothing here is a claim about the business: no counts, no ratings, no prices.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shareImageHost, shareImageStamp, withJpegComment } from "./lib/share-image.mjs";
import { readSiteUrl } from "./lib/toml-patch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const font = (name) => `data:font/woff2;base64,${readFileSync(resolve(root, "marketing/public/fonts", name)).toString("base64")}`;
const logo = `data:image/jpeg;base64,${readFileSync(resolve(root, "brand/mawah-logo.jpg")).toString("base64")}`;
const site = readSiteUrl(readFileSync(resolve(root, "worker/wrangler.toml"), "utf8"));
if (!site) throw new Error("gen-og-image: SITE_URL is missing from worker/wrangler.toml");

/** The artwork inside the 972x972 original (same numbers as scripts/gen-brand-assets.mjs) and how large it is drawn here. */
const BOX = { x: 40 - 14, y: 246 - 18, w: 867 + 28, h: 451 + 36 };
const LOGO_W = 640;
const k = LOGO_W / BOX.w;
const LOGO_H = Math.round(BOX.h * k);

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Playfair;font-weight:600;src:url(${font("playfair-latin-600.woff2")}) format("woff2")}
@font-face{font-family:Tiro;src:url(${font("tiro-bn-400.woff2")}) format("woff2")}
@font-face{font-family:Hind;font-weight:400;src:url(${font("hind-latin-400.woff2")}) format("woff2");unicode-range:U+0000-00FF}
@font-face{font-family:Hind;font-weight:400;src:url(${font("hind-bn-400.woff2")}) format("woff2");unicode-range:U+0980-09FE}
@font-face{font-family:Hind;font-weight:600;src:url(${font("hind-latin-600.woff2")}) format("woff2");unicode-range:U+0000-00FF}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;font-family:Hind,sans-serif;color:#f3ebe0;position:relative;text-align:center;
  background:radial-gradient(700px 420px at 92% -10%,rgba(219,23,24,.34),transparent 65%),radial-gradient(640px 380px at 4% 112%,rgba(217,205,105,.14),transparent 62%),#070304}
.frame{position:absolute;inset:24px;border:2px solid rgba(217,205,105,.55);border-radius:26px}
.frame::after{content:"";position:absolute;inset:10px;border:1px solid rgba(217,205,105,.25);border-radius:18px}
.logo{position:absolute;left:${(1200 - LOGO_W) / 2}px;top:62px;width:${LOGO_W}px;height:${LOGO_H}px;background:url(${logo}) no-repeat;background-size:${Math.round(972 * k)}px ${Math.round(972 * k)}px;background-position:${Math.round(-BOX.x * k)}px ${Math.round(-BOX.y * k)}px;mix-blend-mode:lighten}
.en{position:absolute;left:0;right:0;top:${62 + LOGO_H + 22}px;font-family:Playfair,serif;font-weight:600;font-size:38px;letter-spacing:.01em;color:#fbf7ee}
.bn{position:absolute;left:0;right:0;top:${62 + LOGO_H + 80}px;font-family:Tiro,Hind,serif;font-size:36px;color:#e6dc8c}
.url{position:absolute;left:0;right:0;bottom:48px;font-size:24px;font-weight:600;letter-spacing:.14em;color:#d9cd69}
</style>
<div class="frame"></div>
<div class="logo" role="img" aria-label="MAWAH"></div>
<div class="en">Cooking &amp; baking classes you can learn at home</div>
<div class="bn">ঘরে বসেই ধাপে ধাপে শিখুন রান্না ও বেকিং</div>
<div class="url">${shareImageHost(site).toUpperCase()}</div>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const img = withJpegComment(await page.screenshot({ type: "jpeg", quality: 84 }), shareImageStamp(site));
await browser.close();
const out = resolve(root, "marketing/public/og-default.jpg");
writeFileSync(out, img);
console.log(`wrote ${out.replace(root + "/", "")} (${(img.length / 1024).toFixed(0)} KB) for ${shareImageHost(site)}`);
