#!/usr/bin/env node
/**
 * Builds the small payment logos for the footer's "We accept" row from the pictures the owner sent (kept in brand/pay/):
 *
 *   brand/pay/bkash.jpg  nagad.png  rocket.png   ->   marketing/public/pay/bkash.webp  nagad.webp  rocket.webp
 *
 * Visa and Mastercard are drawn as vector files (marketing/public/pay/visa.svg, mastercard.svg) and need no build.
 *
 * SSLCommerz's own picture of the ways to pay ("Pay with … Verified by SSLCommerz"), as the owner sent it, is served unchanged:
 *
 *   brand/pay/payment.png   ->   marketing/public/pay/sslcommerz.png      (its size is SSL_BANNER in shared/src/payLogos.ts)
 *
 * The owner's pictures have white margins of different sizes (and the JPEG has faint noise in its white). For each one this
 * script trims the margin, turns the near-white background into pure white (so it melts into the white badge the footer puts
 * every logo on), and scales it to HEIGHT_PX — three times the 24px height it is shown at, so it stays sharp on phones.
 * The footer’s <img> width/height come from PAY_LOGOS in worker/src/views/footer-data.ts; worker/test/footer.test.ts keeps them in step with these files.
 *
 * To change a logo: replace the file in brand/pay/ and run   node scripts/gen-pay-logos.mjs
 * (CHROMIUM_PATH=/path/to/chrome if Playwright's browser is not installed)
 */
import { chromium } from "@playwright/test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.env.PAY_SRC ?? resolve(root, "brand/pay");
const OUT = process.env.PAY_OUT ?? resolve(root, "marketing/public/pay");
mkdirSync(OUT, { recursive: true });

const HEIGHT_PX = 72;
const LOGOS = [
  { file: "bkash.jpg", out: "bkash.webp", mime: "image/jpeg" },
  { file: "nagad.png", out: "nagad.webp", mime: "image/png" },
  { file: "rocket.png", out: "rocket.webp", mime: "image/png" },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setContent("<!doctype html><title>pay</title>");

for (const logo of LOGOS) {
  const b64 = readFileSync(resolve(SRC, logo.file)).toString("base64");
  const r = await page.evaluate(
    async ({ b64, mime, height }) => {
      const img = new Image();
      img.src = `data:${mime};base64,${b64}`;
      await img.decode();
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.fillStyle = "#fff";
      x.fillRect(0, 0, w, h);
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, w, h);
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const i = (py * w + px) * 4;
          const lo = Math.min(d.data[i], d.data[i + 1], d.data[i + 2]);
          if (lo >= 246) {
            d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; // faint JPEG noise in the white becomes pure white
          }
          if (lo < 225) {
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }
      x.putImageData(d, 0, 0);
      const cw = maxX - minX + 1;
      const ch = maxY - minY + 1;
      const o = document.createElement("canvas");
      o.height = height;
      o.width = Math.round((cw * height) / ch);
      const ox = o.getContext("2d");
      ox.fillStyle = "#fff";
      ox.fillRect(0, 0, o.width, o.height);
      ox.imageSmoothingEnabled = true;
      ox.imageSmoothingQuality = "high";
      ox.drawImage(c, minX, minY, cw, ch, 0, 0, o.width, o.height);
      return { width: o.width, height: o.height, source: { w, h, box: [minX, minY, cw, ch] }, webp: o.toDataURL("image/webp", 0.94).split(",")[1] };
    },
    { b64, mime: logo.mime, height: HEIGHT_PX },
  );
  writeFileSync(resolve(OUT, logo.out), Buffer.from(r.webp, "base64"));
  console.log(`${logo.out}: ${r.width}x${r.height}  (from ${r.source.w}x${r.source.h}, artwork ${r.source.box.join(",")})  ${(Buffer.from(r.webp, "base64").length / 1024).toFixed(1)} KB`);
}
await browser.close();

// SSLCommerz's picture, byte for byte (scripts/lib/brand.test.mjs checks the copy and its size)
copyFileSync(resolve(SRC, "payment.png"), resolve(OUT, "sslcommerz.png"));
console.log("sslcommerz.png: copied from payment.png");
