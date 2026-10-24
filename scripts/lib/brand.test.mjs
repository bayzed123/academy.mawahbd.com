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

/*
 * The dark look of the public site and the student app (shared/styles/dark.css): its own tokens, read the same way. The colours the owner
 * asked for are the tokens, and every text/background pair it uses keeps AA contrast. Text on orange is near-black: white on #FF5722 is
 * only 3.2:1.
 */
const darkCss = read("shared/styles/dark.css");
const darkBlock = darkCss.slice(darkCss.indexOf(":root{"), darkCss.indexOf("}", darkCss.indexOf(":root{")));
const full = (hex) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex).toLowerCase();
const dark = Object.fromEntries([...darkBlock.matchAll(/--([a-z0-9-]+):(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)].map(([, name, hex]) => [name, full(hex)]));

test("the dark look: a pitch-black page, flat dark-grey cards and fields with thin see-through edges, one orange, white headings, #CCCCCC paragraphs", () => {
  assert.equal(dark["ivory"], "#000000", "the page is pitch black");
  assert.equal(dark["paper"], "#121212", "cards and panels are a flat dark grey, so they stand out from the page");
  assert.equal(dark["card"], "#121212");
  assert.equal(dark["field"], "#121212", "so are form fields");
  assert.match(darkBlock, /--line:rgba\(255,255,255,\.09\)/, "a card's edge is a thin see-through white line");
  assert.match(darkBlock, /--edge-a:rgba\(255,255,255,\.4\)/, "a field's edge too, strong enough to see (3:1)");
  assert.equal(dark["o-500"], "#ff5722", "the orange accent");
  assert.equal(dark["heading"], "#ffffff", "white headings");
  assert.equal(dark["ink-2"], "#cccccc", "paragraphs");
});

test("the dark look keeps WCAG AA contrast: text, buttons, form fields and the graphics that carry meaning", () => {
  const T = dark;
  const pairs = [
    // text on the black page, the bands and the cards (4.5:1)
    ["ink", "ivory", 4.5], ["ink", "paper", 4.5], ["ink-2", "ivory", 4.5], ["ink-2", "ivory-2", 4.5], ["ink-2", "paper", 4.5],
    ["ink-3", "ivory", 4.5], ["ink-3", "paper", 4.5], ["ink-3", "field", 4.5], ["ink-3", "raised", 4.5], ["heading", "paper", 4.5], ["ink", "field", 4.5],
    // links and orange words, on black, on cards and on orange-tinted panels
    ["o-300", "ivory", 4.5], ["o-300", "paper", 4.5], ["o-200", "paper", 4.5], ["red-700", "red-50", 4.5], ["g-800", "g-100", 4.5], ["g-900", "g-100", 4.5],
    // problems stay red, "paid / ok" green
    ["bad-700", "ivory", 4.5], ["bad-700", "paper", 4.5], ["bad-800", "bad-50", 4.5], ["ok-700", "paper", 4.5], ["ok-800", "ok-50", 4.5],
    // the orange buttons and chips carry near-black words
    ["on-accent", "o-500", 4.5], ["on-accent", "o-400", 4.5],
    // form-field edges, icons, the focus ring (o-300, above) (3:1)
    ["edge", "field", 3], ["edge", "paper", 3], ["o-500", "paper", 3], ["o-500", "ivory", 3], ["g-300", "ivory", 3],
  ];
  const failures = [];
  for (const [fg, bg, min] of pairs) {
    const a = T[fg], b = T[bg];
    assert.ok(a && b, `unknown token in pair ${fg} / ${bg}`);
    const r = ratio(a, b);
    if (r < min) failures.push(`${fg} ${a} on ${bg} ${b}: ${r.toFixed(2)} < ${min}`);
  }
  // white is too pale on the orange: the buttons do not use it
  assert.ok(ratio("#ffffff", T["o-500"]) < 4.5);
  assert.match(darkCss, /\.btn-primary,\.btn-gold\{[^}]*color:var\(--on-accent\)/);
  assert.deepEqual(failures, []);
});

/*
 * The owner's second round: "a flat, muddy brown theme" is not wanted. Every grey of the dark look is a true grey (red = green = blue),
 * and no stylesheet of the dark look uses a brown (a dull warm colour — dark orange, tan, cream). Orange is a light there: buttons, icons,
 * lines and glows. (Problems stay red, and the owner's own banner designs and the paper certificates keep their colours: not checked.)
 */
const DARK_SHEETS = ["shared/styles/dark.css", "marketing/site.css", "marketing/course.css", "marketing/shop.css", "marketing/landing.css", "marketing/chat.css", "app/src/styles/app.css"];
const brownish = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return false;
  const sat = l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  const hue = max === r ? (60 * ((g - b) / (max - min)) + 360) % 360 : max === g ? 60 * ((b - r) / (max - min)) + 120 : 60 * ((r - g) / (max - min)) + 240;
  if (hue < 10 || hue > 45 || sat <= 0.04) return false; // not an orange-brown hue, or a true grey
  return l < 0.6 ? !(sat > 0.5 && l > 0.35) : sat < 0.35; // dark and dull (brown), or light and dull (cream); a vivid orange is fine
};

/*
 * The owner's third round: minimal and flat. The page is one solid colour; no radial gradients, background patterns, blur, glows or
 * floating decoration; buttons are one solid orange with a small crisp shadow only under the pointer. (A form field's focus ring and a
 * chosen option's 3px ring are outlines, not glows. A picture's text scrim and the loading shimmer are the only linear gradients.)
 */
test("the dark look is flat: one solid page colour, no radial gradients, patterns, blur, glows or gradient fills", () => {
  const found = [];
  for (const file of DARK_SHEETS) {
    const css = read(file);
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+\{[^{}]*\}/g) ?? [];
    for (const rule of rules) {
      const sel = rule.slice(0, rule.indexOf("{")).trim();
      if (/radial-gradient/.test(rule)) found.push(`${file}: ${sel} has a radial gradient`);
      if (/var\(--pattern\)/.test(rule)) found.push(`${file}: ${sel} draws the background pattern`);
      if (/(?:^|[;{])\s*(?:-webkit-)?(?:backdrop-)?filter:[^;}]*(?:blur|drop-shadow)/.test(rule)) found.push(`${file}: ${sel} blurs or glows`);
      if (/text-shadow/.test(rule)) found.push(`${file}: ${sel} has a text glow`);
      // a glow: a shadow with no offset and a blur, in orange
      if (/box-shadow:(?:[^;}]*,)?\s*0 0 [1-9]\d*px[^;}]*(?:249,115,22|255,87,34|255,107,0|var\(--o-)/.test(rule)) found.push(`${file}: ${sel} glows`);
      if (/background(?:-image)?:[^;}]*linear-gradient/.test(rule) && !/^\.lp-hero\.has-img::after$|^\.skeleton$/.test(sel)) found.push(`${file}: ${sel} has a gradient fill`);
    }
  }
  assert.deepEqual(found, []);
  // the page, the hero, the bands and the footer are the one flat page colour
  const site = read("marketing/site.css");
  for (const sel of [".hero", ".page-hero", ".band", ".band-dark", ".site-footer", ".site-header"]) {
    const rule = new RegExp(`(?:^|\\n)${sel.replace(/\./g, "\\.")}\\{([^}]*)\\}`).exec(site);
    assert.ok(rule, `${sel} is styled`);
    assert.match(rule[1], /background:#000[;}]?/, `${sel} is flat black`);
  }
  // no floating decoration in the hero, no pulsing or bouncing
  assert.doesNotMatch(read("worker/src/views/pages/home.tsx"), /hero-fx/);
  for (const file of DARK_SHEETS) assert.doesNotMatch(read(file), /hero-fx|@keyframes (?:cta-|pulse-|fab-bounce|drift|float|badge-float)/, file);
});

test("the dark look has no brown: its greys are true greys, and none of its stylesheets uses a dull warm colour", () => {
  for (const name of ["ivory", "ivory-2", "paper", "field", "raised", "k-950", "k-900", "k-800", "k-700", "k-600", "red-50", "red-100", "g-100"]) {
    const hex = dark[name];
    assert.ok(hex, `--${name} is defined`);
    assert.ok(hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7), `--${name} ${hex} is a true grey`);
  }
  const found = [];
  for (const file of DARK_SHEETS) {
    const css = read(file);
    for (const [hex] of css.matchAll(/#[0-9a-f]{6}\b/gi)) if (brownish(hex.toLowerCase())) found.push(`${file}: ${hex}`);
    for (const [rgb] of css.matchAll(/rgba?\((\d+),(\d+),(\d+)/g)) {
      const hex = `#${rgb.match(/\d+/g).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
      if (brownish(hex)) found.push(`${file}: ${rgb})`);
    }
  }
  assert.deepEqual(found, []);
  // the check itself tells brown from orange
  assert.ok(brownish("#1b1512") && brownish("#2a1d16") && brownish("#e9e4e0"));
  assert.ok(!brownish("#ff5722") && !brownish("#ff6b00") && !brownish("#151515") && !brownish("#ffa47a"));
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
