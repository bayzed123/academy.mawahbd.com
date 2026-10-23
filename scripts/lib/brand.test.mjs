import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { jpegComments, shareImageHost, shareImageStamp, withJpegComment } from "./share-image.mjs";
import { readSiteUrl } from "./toml-patch.mjs";

/*
 * Guards the brand: the colours measured from the owner's logo, enough contrast between the palette's text and background
 * pairs (so a future colour tweak cannot quietly make the site hard to read), and that every logo/icon file the pages
 * point at really exists. Pure file checks — no browser, no network.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const baseCss = read("shared/styles/base.css");
const rootBlock = baseCss.slice(baseCss.indexOf(":root{"), baseCss.indexOf("}", baseCss.indexOf(":root{")));
const tokens = Object.fromEntries([...rootBlock.matchAll(/--([a-z0-9-]+):(#[0-9a-f]{6})\b/gi)].map(([, name, hex]) => [name, hex.toLowerCase()]));

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("the three logo colours are the brand tokens", () => {
  assert.equal(tokens["k-950"], "#070304", "logo black");
  assert.equal(tokens["red-600"], "#db1718", "logo red");
  assert.equal(tokens["g-400"], "#d9cd69", "logo gold");
});

test("text and background pairs keep WCAG AA contrast", () => {
  const T = tokens;
  const pairs = [
    // text on the light surfaces (4.5:1 for normal text)
    ["ink", "ivory", 4.5], ["ink", "paper", 4.5], ["ink-2", "ivory-2", 4.5], ["ink-3", "ivory", 4.5], ["ink-3", "paper", 4.5], ["ink-3", "ivory-2", 4.5],
    ["red-700", "ivory", 4.5], ["red-700", "paper", 4.5], ["red-800", "red-50", 4.5],
    ["g-800", "ivory", 4.5], ["g-800", "paper", 4.5], ["g-800", "g-100", 4.5],
    ["ok-800", "ok-50", 4.5], ["ok-700", "paper", 4.5],
    // buttons
    ["k-950", "g-400", 4.5], ["k-950", "g-300", 4.5],
    // text on the dark surfaces
    ["g-300", "k-950", 4.5], ["g-400", "k-950", 4.5], ["red-500", "k-950", 4.5], ["g-300", "k-900", 4.5],
    // graphics that carry meaning (3:1): icons, stars, focus rings
    ["g-600", "paper", 3], ["g-600", "g-100", 3], ["red-700", "ivory", 3],
  ];
  const failures = [];
  for (const [fg, bg, min] of pairs) {
    const a = T[fg], b = T[bg];
    assert.ok(a && b, `unknown token in pair ${fg} / ${bg}`);
    const r = ratio(a, b);
    if (r < min) failures.push(`${fg} ${a} on ${bg} ${b}: ${r.toFixed(2)} < ${min}`);
  }
  // white text on the red and black buttons (white is not a token)
  for (const bg of ["red-600", "red-700", "k-900", "k-700"]) {
    const r = ratio("#ffffff", T[bg]);
    if (r < 4.5) failures.push(`white on ${bg}: ${r.toFixed(2)} < 4.5`);
  }
  assert.deepEqual(failures, []);
});

function* files(dir, exts) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".wrangler", "generated", "test-results", ".lighthouseci"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full, exts);
    else if (exts.some((e) => name.endsWith(e))) yield full;
  }
}

test("every CSS variable a stylesheet or component uses is defined, and the old green scale is gone", () => {
  const sources = [...files(join(root, "shared"), [".css"]), ...files(join(root, "marketing"), [".css"]), ...files(join(root, "app/src"), [".css", ".tsx", ".ts"]), ...files(join(root, "admin/src"), [".css", ".tsx", ".ts"]), ...files(join(root, "worker/src"), [".tsx", ".ts"])];
  const defined = new Set(["--p"]); // --p (a progress bar's width) is set while the page runs
  const used = new Map();
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const [, name] of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(name);
    for (const [, name] of text.matchAll(/var\((--[a-z0-9-]+)/gi)) used.set(name, file.replace(root, ""));
  }
  const dangling = [...used].filter(([name]) => !defined.has(name)).map(([name, file]) => `${name} (in ${file})`);
  assert.deepEqual(dangling, []);
  assert.ok(![...defined].some((n) => /^--e-\d+$/.test(n)), "the old emerald tokens (--e-*) must not come back");
});

/** Reads width/height from a PNG header. */
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

test("the logo and icon files the pages point at exist and are the right kind of image", () => {
  const pub = (f) => join(root, "marketing/public", f);
  for (const [file, size] of [["icon-512.png", 512], ["icon-192.png", 192], ["apple-touch-icon.png", 180], ["icon-maskable-512.png", 512], ["favicon-32.png", 32]]) {
    assert.ok(existsSync(pub(file)), `${file} is missing`);
    const buf = readFileSync(pub(file));
    assert.equal(buf.subarray(1, 4).toString(), "PNG", `${file} is not a PNG`);
    assert.deepEqual(pngSize(buf), { w: size, h: size }, `${file} has the wrong size`);
  }
  for (const file of ["logo.webp", "logo-sm.webp"]) {
    const buf = readFileSync(pub(file));
    assert.equal(buf.subarray(0, 4).toString(), "RIFF", file);
    assert.equal(buf.subarray(8, 12).toString(), "WEBP", file);
    assert.ok(buf.length < 30 * 1024, `${file} should stay small (it is on every page)`);
  }
  const ico = readFileSync(pub("favicon.ico"));
  assert.equal(ico.readUInt16LE(2), 1, "favicon.ico type");
  assert.ok(ico.readUInt16LE(4) >= 1, "favicon.ico has no images");
  const og = readFileSync(pub("og-default.jpg"));
  assert.equal(og[0], 0xff); assert.equal(og[1], 0xd8);
  assert.ok(og.length < 100 * 1024, "the share image must stay under 100 KB (WhatsApp skips big previews)");
  assert.ok(existsSync(join(root, "brand/mawah-logo.jpg")), "the original logo (source of the generated files) must stay in the repository");
});

test("the SSLCommerz picture the site serves is the one the owner sent, at exactly the size the pages keep room for", () => {
  const sent = readFileSync(join(root, "brand/pay/payment.png"));
  const served = readFileSync(join(root, "marketing/public/pay/sslcommerz.png"));
  assert.ok(served.equals(sent), "marketing/public/pay/sslcommerz.png differs from brand/pay/payment.png: run node scripts/gen-pay-logos.mjs");
  assert.equal(served.subarray(1, 4).toString("latin1"), "PNG");
  const size = /SSL_BANNER = \{ src: "\/pay\/sslcommerz\.png", width: (\d+), height: (\d+) \}/.exec(read("shared/src/payLogos.ts"));
  assert.ok(size, "SSL_BANNER in shared/src/payLogos.ts");
  // a PNG's own width and height sit right after its signature and the IHDR header
  assert.deepEqual([served.readUInt32BE(16), served.readUInt32BE(20)], [Number(size[1]), Number(size[2])]);
});

test("the share image shows the site's own address (SITE_URL), so a change of domain cannot leave the old one on it", () => {
  const site = readSiteUrl(read("worker/wrangler.toml"));
  const og = readFileSync(join(root, "marketing/public/og-default.jpg"));
  assert.deepEqual(jpegComments(og), [shareImageStamp(site)], `the share image was made for another address than ${site}: run npm run og:image and commit the picture`);
  // the address is never written into the generator by hand — that is how the old domain stayed on the picture after the move
  assert.doesNotMatch(read("scripts/gen-og-image.mjs"), /\b[a-z0-9-]+\.(?:com|net|org|bd)\b/i);
});

test("the share image's address is SITE_URL's host without www., and the comment that records it reads back", () => {
  assert.equal(shareImageHost("https://mawahacademy.com"), "mawahacademy.com");
  assert.equal(shareImageHost("https://www.Example.com/path"), "example.com");
  // a JPEG's start marker, a JFIF header, the image data, the end
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
  assert.deepEqual(jpegComments(jpeg), []);
  const stamped = withJpegComment(jpeg, "site=example.com");
  assert.deepEqual(jpegComments(stamped), ["site=example.com"]);
  assert.deepEqual([...stamped.subarray(0, 8)], [...jpeg.subarray(0, 8)], "the JFIF header stays straight after the start marker");
  assert.deepEqual([...stamped.subarray(-6)], [...jpeg.subarray(-6)], "the image itself is untouched");
});

test("the web manifest and the page heads only reference files that exist", () => {
  const manifest = JSON.parse(read("marketing/public/manifest.webmanifest"));
  assert.equal(manifest.theme_color, "#070304");
  for (const icon of manifest.icons) assert.ok(existsSync(join(root, "marketing/public", icon.src.replace(/^\//, ""))), `manifest icon ${icon.src} is missing`);
  for (const html of ["worker/src/views/layout.tsx", "app/index.html", "admin/index.html"]) {
    const text = read(html);
    for (const [, href] of text.matchAll(/href="(\/(?:favicon|apple-touch-icon|icon)[^"]*)"/g)) assert.ok(existsSync(join(root, "marketing/public", href.replace(/^\//, ""))), `${html} links ${href}, which does not exist`);
    assert.match(text, /content="#070304"/, `${html} theme-color`);
  }
});
