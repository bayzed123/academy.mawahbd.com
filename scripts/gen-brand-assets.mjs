#!/usr/bin/env node
/**
 * Builds every logo file the site uses from the owner's ONE original logo (brand/mawah-logo.jpg):
 *
 *   marketing/public/logo-sm.webp          header (shown ~52px tall; 3x for sharp phones)
 *   marketing/public/logo.webp             footer, sign-in screens, certificate, invoice
 *   marketing/public/icon-512.png          app icon / structured-data logo      icon-192.png · apple-touch-icon.png
 *   marketing/public/icon-maskable-512.png Android "maskable" icon (extra safe margin)
 *   marketing/public/favicon-32.png · favicon.ico
 *
 * The original has a near-black background with tiny JPEG variations. Every dark pixel is lifted to the exact brand
 * black (#070304, the --k-950 colour of the site) so the logo melts into the black header and footer with no visible box.
 *
 * To change the logo: replace brand/mawah-logo.jpg (any size, same layout rules), update LOGO_BOX below if the artwork
 * moved, then run   node scripts/gen-brand-assets.mjs      (CHROMIUM_PATH=/path/to/chrome if Playwright's browser is not installed)
 * and   node scripts/gen-og-image.mjs   for the social-share picture.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "marketing/public");
mkdirSync(out, { recursive: true });

const BLACK = [7, 3, 4]; // #070304 — keep in sync with --k-950 in shared/styles/base.css
/** The artwork inside the 972x972 original (measured: everything outside is background). */
const LOGO_BOX = { x: 40, y: 246, w: 867, h: 451 };
const PAD_X = 14;
const PAD_Y = 18;
/** The square crop used for icons: the wordmark, the tagline and the red banner. */
const ICON_BOX = { x: 173, y: 170, w: 600, h: 600 };

/** Each job crops a region of the cleaned original and scales it to w x h (optionally centred inside a bigger square). */
const jobs = [
  { file: "logo-sm.webp", type: "image/webp", quality: 0.92, crop: { x: LOGO_BOX.x - PAD_X, y: LOGO_BOX.y - PAD_Y, w: LOGO_BOX.w + 2 * PAD_X, h: LOGO_BOX.h + 2 * PAD_Y }, w: 300 },
  { file: "logo.webp", type: "image/webp", quality: 0.92, crop: { x: LOGO_BOX.x - PAD_X, y: LOGO_BOX.y - PAD_Y, w: LOGO_BOX.w + 2 * PAD_X, h: LOGO_BOX.h + 2 * PAD_Y }, w: 520 },
  { file: "icon-512.png", type: "image/png", crop: ICON_BOX, w: 512, h: 512 },
  { file: "icon-192.png", type: "image/png", crop: ICON_BOX, w: 192, h: 192 },
  { file: "apple-touch-icon.png", type: "image/png", crop: ICON_BOX, w: 180, h: 180 },
  { file: "icon-maskable-512.png", type: "image/png", crop: ICON_BOX, w: 512, h: 512, inset: 0.8 },
  { file: "favicon-32.png", type: "image/png", crop: ICON_BOX, w: 32, h: 32 },
  { file: "favicon-16.png", type: "image/png", crop: ICON_BOX, w: 16, h: 16, tmp: true },
  { file: "favicon-48.png", type: "image/png", crop: ICON_BOX, w: 48, h: 48, tmp: true },
];

const source = `data:image/jpeg;base64,${readFileSync(resolve(root, "brand/mawah-logo.jpg")).toString("base64")}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setContent("<!doctype html><meta charset=utf-8>");
const results = await page.evaluate(
  async ({ source, jobs, BLACK }) => {
    const img = new Image();
    img.src = source;
    await img.decode();
    const clean = document.createElement("canvas");
    clean.width = img.width;
    clean.height = img.height;
    const cctx = clean.getContext("2d", { willReadFrequently: true });
    cctx.drawImage(img, 0, 0);
    const px = cctx.getImageData(0, 0, clean.width, clean.height);
    for (let i = 0; i < px.data.length; i += 4) {
      px.data[i] = Math.max(px.data[i], BLACK[0]);
      px.data[i + 1] = Math.max(px.data[i + 1], BLACK[1]);
      px.data[i + 2] = Math.max(px.data[i + 2], BLACK[2]);
    }
    cctx.putImageData(px, 0, 0);

    /** Halve repeatedly (box-filter quality), then one last smooth draw — much sharper than a single big reduction. */
    function scaleTo(srcCanvas, sx, sy, sw, sh, dw, dh) {
      let cur = document.createElement("canvas");
      cur.width = sw;
      cur.height = sh;
      cur.getContext("2d").drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
      while (cur.width / 2 >= dw * 1.0001 && cur.height / 2 >= dh) {
        const next = document.createElement("canvas");
        next.width = Math.round(cur.width / 2);
        next.height = Math.round(cur.height / 2);
        const c = next.getContext("2d");
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = "high";
        c.drawImage(cur, 0, 0, next.width, next.height);
        cur = next;
      }
      const fin = document.createElement("canvas");
      fin.width = dw;
      fin.height = dh;
      const f = fin.getContext("2d");
      f.imageSmoothingEnabled = true;
      f.imageSmoothingQuality = "high";
      f.drawImage(cur, 0, 0, dw, dh);
      return fin;
    }

    const res = {};
    for (const j of jobs) {
      const w = j.w;
      const h = j.h ?? Math.round((j.w * j.crop.h) / j.crop.w);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = `rgb(${BLACK.join(",")})`;
      ctx.fillRect(0, 0, w, h);
      const inset = j.inset ?? 1;
      const dw = Math.round(w * inset);
      const dh = Math.round(h * inset);
      const scaled = scaleTo(clean, j.crop.x, j.crop.y, j.crop.w, j.crop.h, dw, dh);
      ctx.drawImage(scaled, Math.round((w - dw) / 2), Math.round((h - dh) / 2));
      res[j.file] = { dataUrl: canvas.toDataURL(j.type, j.quality), w, h };
    }
    return res;
  },
  { source, jobs, BLACK },
);
await browser.close();

const buf = (file) => Buffer.from(results[file].dataUrl.split(",")[1], "base64");

/** A .ico that wraps PNG images (supported by every browser since IE9). */
function ico(files) {
  const imgs = files.map(buf);
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(imgs.length, 4);
  let offset = head.length;
  imgs.forEach((data, i) => {
    const size = results[files[i]].w;
    const at = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, at);
    head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...imgs]);
}

for (const j of jobs) {
  if (j.tmp) continue;
  writeFileSync(resolve(out, j.file), buf(j.file));
  console.log(`wrote marketing/public/${j.file}  ${results[j.file].w}x${results[j.file].h}  ${(buf(j.file).length / 1024).toFixed(1)} KB`);
}
writeFileSync(resolve(out, "favicon.ico"), ico(["favicon-16.png", "favicon-32.png", "favicon-48.png"]));
console.log("wrote marketing/public/favicon.ico  16+32+48");
