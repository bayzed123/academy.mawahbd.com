#!/usr/bin/env node
/**
 * Builds the public-site assets:
 *   shared/styles/base.css + dark.css + banners.css + help.css (the round corner buttons) + theme-toggle.css + marketing/site.css -> minified string inlined into every page (worker/src/generated/assets.ts)
 *   base.css's @font-face rules -> a <style> of their own on every page: SITE_FONTS_CSS on the site's pages, FONTS_CSS on certificates and invoices
 *   shared/styles/theme.css -> dist/static/assets/theme.<hash>.css (the light look: a file of its own, linked by every page — see views/layout.tsx)
 *   marketing/shop.css -> minified string inlined only into the tools shop's pages (SHOP_CSS)
 *   marketing/landing.css -> minified string inlined only into landing pages (LANDING_CSS)
 *   marketing/course.css -> minified string inlined only into the class page (COURSE_CSS)
 *   marketing/video.css -> minified string inlined only into pages that show a video: the home page's, a class's demo (VIDEO_CSS)
 *   marketing/doc.css -> minified string inlined only into certificates, invoices and the certificate check (DOC_CSS)
 *   marketing/site.js       -> dist/static/assets/site.<hash>.js          (immutable, 1 year cache)
 *   marketing/analytics.js  -> dist/static/assets/analytics.<hash>.js     (only on pages that carry a measurement ID; also injected into the student app)
 *   marketing/banners.js    -> dist/static/assets/banners.<hash>.js       (only on pages with a slider or an offer pop-up)
 *   marketing/gallery.js    -> dist/static/assets/gallery.<hash>.js       (only on class pages with more than one picture)
 *   marketing/cert.js       -> dist/static/assets/cert.<hash>.js          (only on certificates: fits their long lines, makes their picture)
 *   marketing/chat.{js,css} -> dist/static/chat.{js,css}                  (small, 1 hour cache)
 *   marketing/theme.js -> dist/static/theme.js                            (first-paint theme state, 1 hour cache)
 *   marketing/public/**     -> dist/static/**                             (fonts, sprite, icons, manifest)
 *   marketing/public/og-default.jpg -> dist/static/assets/og.<hash>.jpg   (the share image, under a name that changes with the picture)
 *   marketing/verification/* -> worker/src/generated/verification.ts      (proof-of-ownership files for Meta / Google / Bing …, answered by the Worker at the root)
 * and writes dist/static/_headers (cache + security headers for assets served straight from Cloudflare's asset layer).
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import { readVerificationFiles } from "./lib/verification-files.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist/static");
const gen = resolve(root, "worker/src/generated");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 10);

for (const dir of ["assets", "fonts"]) rmSync(resolve(out, dir), { recursive: true, force: true });
mkdirSync(resolve(out, "assets"), { recursive: true });
mkdirSync(gen, { recursive: true });

// static public files (fonts, sprite, logo + icons, pattern, manifest, og image …)
cpSync(resolve(root, "marketing/public"), out, { recursive: true });

// The fonts (base.css's @font-face rules) leave the inlined styles for a <style> of their own (views/layout.tsx), in two versions.
// The site's pages: the Bangla regular and bold — the two files every Bangla page preloads, for its text and its headings — are
// "optional": the browser waits a moment for them before it first draws the page, then keeps whichever font it drew with, so the text
// never jumps when one of these big files comes late (it did: Lighthouse measured a layout shift of 0.23 on a class page, the page drawn
// a moment before its bold font). The other files are small or set only labels, and still swap in.
// Certificates and invoices keep every font as written ("swap"): they are printed and turned into pictures, which wait for the real fonts.
const baseCss = read("shared/styles/base.css");
const fontFaces = baseCss.match(/@font-face\{[^}]*\}/g) ?? [];
const banglaRegularOrBold = (face) => /\/fonts\/hind-bn-(400|700)\.woff2/.test(face);
if (fontFaces.filter(banglaRegularOrBold).length !== 2 || !fontFaces.filter(banglaRegularOrBold).every((f) => f.includes("font-display:swap")))
  throw new Error("build-marketing: base.css should hold Hind Siliguri's Bangla regular and bold, each with font-display:swap");
const minifyCss = async (source) => (await transform(source, { loader: "css", minify: true, target: ["chrome100", "safari15", "firefox100"] })).code.trim();
const fontsCss = await minifyCss(fontFaces.join("\n"));
const siteFontsCss = await minifyCss(fontFaces.map((f) => (banglaRegularOrBold(f) ? f.replace("font-display:swap", "font-display:optional") : f)).join("\n"));
const minifiedCss = (await transform(`${baseCss.replace(/@font-face\{[^}]*\}\n?/g, "")}\n${read("shared/styles/dark.css")}\n${read("shared/styles/banners.css")}\n${read("shared/styles/help.css")}\n${read("shared/styles/theme-toggle.css")}\n${read("marketing/site.css")}`, { loader: "css", minify: true, target: ["chrome100", "safari15", "firefox100"] })).code.trim();
// the decorative background pattern is tiny: inline it once (CSS variable) instead of a cached-for-a-day extra request
const patternSvg = read("marketing/public/pattern.svg").replace(/\s+/g, " ").replace(/> </g, "><").replace(/"/g, "'").trim();
const patternUri = `url("data:image/svg+xml,${patternSvg.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}")`;
if (!minifiedCss.includes("--pattern:url(/pattern.svg)")) throw new Error("build-marketing: --pattern variable not found in the CSS");
const css = minifiedCss.replace("--pattern:url(/pattern.svg)", `--pattern:${patternUri}`);
// the landing pages' look: inlined only into a landing page (a second <style>, allowed by its own hash)
const landingCss = (await transform(read("marketing/landing.css"), { loader: "css", minify: true, target: ["chrome100", "safari15", "firefox100"] })).code.trim();
// the class page's look, and the documents' (certificates, invoices, the certificate check): inlined only into those pages, the same way
const videoCss = (await transform(read("marketing/video.css"), { loader: "css", minify: true, target: ["chrome100", "safari15", "firefox100"] })).code.trim();
const courseCss = (await transform(read("marketing/course.css"), { loader: "css", minify: true, target: ["chrome100", "safari15", "firefox100"] })).code.trim();
const docCss = (await transform(read("marketing/doc.css"), { loader: "css", minify: true, target: ["chrome100", "safari15", "firefox100"] })).code.trim();
// site.js is bundled with the parts of Framer Motion it imports (framer-motion, MIT: its notice is kept at the top of the file)
const js = (
  await build({
    entryPoints: [resolve(root, "marketing/site.js")],
    bundle: true,
    format: "iife",
    minify: true,
    target: "es2017",
    write: false,
    legalComments: "none",
    banner: { js: "/*! Framer Motion (framer-motion, motion-dom, motion-utils) (c) Framer B.V. and contributors - MIT License - https://github.com/motiondivision/motion/blob/main/LICENSE.md */" },
  })
).outputFiles[0].text;
// the banner slider and the offer pop-up: loaded only on pages that have one, so every other page stays as light as before
const bannersJs = (await transform(read("marketing/banners.js"), { loader: "js", minify: true, target: "es2017" })).code;
// counting visits (Google Analytics …): referenced only by pages that carry a measurement ID
const analyticsJs = (await transform(read("marketing/analytics.js"), { loader: "js", minify: true, target: "es2017" })).code;
// the class page's picture viewer: loaded only on a class that has more than its main picture
const galleryJs = (await transform(read("marketing/gallery.js"), { loader: "js", minify: true, target: "es2017" })).code;
// a certificate's long lines fitted to the sheet, and its picture (PNG): loaded only on certificates
const certJs = (await transform(read("marketing/cert.js"), { loader: "js", minify: true, target: "es2017" })).code;
// the tools shop's look: inlined only into the shop's pages (a second <style>, allowed by its own hash)
const shopCss = (await transform(read("marketing/shop.css"), { loader: "css", minify: true, target: ["chrome100", "safari15", "firefox100"] })).code.trim();
// the tools shop's cart and wishlist: loaded only on the shop's pages
const shopJs = (await transform(read("marketing/shop.js"), { loader: "js", minify: true, target: "es2017" })).code;
const chatJs = (await transform(read("marketing/chat.js"), { loader: "js", minify: true, target: "es2017" })).code;
const chatCss = (await transform(read("marketing/chat.css"), { loader: "css", minify: true })).code;
const themeJs = (await transform(read("marketing/theme.js"), { loader: "js", minify: true, target: "es2017" })).code;
const themeCss = (await transform(read("shared/styles/theme.css"), { loader: "css", minify: true, target: ["chrome100", "safari15", "firefox100"] })).code;

const siteJsName = `site.${hash(js)}.js`;
writeFileSync(resolve(out, "assets", siteJsName), js);
const bannersJsName = `banners.${hash(bannersJs)}.js`;
writeFileSync(resolve(out, "assets", bannersJsName), bannersJs);
const analyticsJsName = `analytics.${hash(analyticsJs)}.js`;
writeFileSync(resolve(out, "assets", analyticsJsName), analyticsJs);
const galleryJsName = `gallery.${hash(galleryJs)}.js`;
writeFileSync(resolve(out, "assets", galleryJsName), galleryJs);
const certJsName = `cert.${hash(certJs)}.js`;
writeFileSync(resolve(out, "assets", certJsName), certJs);
const shopJsName = `shop.${hash(shopJs)}.js`;
writeFileSync(resolve(out, "assets", shopJsName), shopJs);
writeFileSync(resolve(out, "chat.js"), chatJs);
writeFileSync(resolve(out, "chat.css"), chatCss);
writeFileSync(resolve(out, "theme.js"), themeJs);
const themeCssName = `theme.${hash(themeCss)}.css`;
writeFileSync(resolve(out, "assets", themeCssName), themeCss);

// the share image (the picture Facebook / WhatsApp show for a link) under a name that changes with the picture: they keep a picture they have
// fetched once for a long time, so a new picture at the old address could go unseen for weeks — a new address is fetched at once
const ogFile = resolve(root, "marketing/public/og-default.jpg");
let ogImage = null;
if (existsSync(ogFile)) {
  const og = readFileSync(ogFile);
  ogImage = `/assets/og.${hash(og)}.jpg`;
  writeFileSync(resolve(out, ogImage.slice(1)), og);
}

writeFileSync(
  resolve(gen, "assets.ts"),
  `// AUTO-GENERATED by scripts/build-marketing.mjs — do not edit.\n` +
    `export const CSS = ${JSON.stringify(css)};\n` +
    `export const SITE_FONTS_CSS = ${JSON.stringify(siteFontsCss)};\n` +
    `export const FONTS_CSS = ${JSON.stringify(fontsCss)};\n` +
    `export const SITE_JS = ${JSON.stringify(`/assets/${siteJsName}`)};\n` +
    `export const BANNERS_JS = ${JSON.stringify(`/assets/${bannersJsName}`)};\n` +
    `export const ANALYTICS_JS = ${JSON.stringify(`/assets/${analyticsJsName}`)};\n` +
    `export const GALLERY_JS = ${JSON.stringify(`/assets/${galleryJsName}`)};\n` +
    `export const CERT_JS = ${JSON.stringify(`/assets/${certJsName}`)};\n` +
    `export const LANDING_CSS = ${JSON.stringify(landingCss)};\n` +
    `export const COURSE_CSS = ${JSON.stringify(courseCss)};\n` +
    `export const VIDEO_CSS = ${JSON.stringify(videoCss)};\n` +
    `export const DOC_CSS = ${JSON.stringify(docCss)};\n` +
    `export const SHOP_CSS = ${JSON.stringify(shopCss)};\n` +
    `export const SHOP_JS = ${JSON.stringify(`/assets/${shopJsName}`)};\n` +
    `export const THEME_JS = "/theme.js";\n` +
    `export const THEME_CSS = ${JSON.stringify(`/assets/${themeCssName}`)};\n` +
    `export const OG_IMAGE = ${JSON.stringify(ogImage)};\n`,
);

// proof-of-ownership files that other services ask for (Meta, Google Search Console, Bing …): the Worker answers each at /<name> with a plain 200
const { files: verification, skipped: notTaken } = readVerificationFiles(resolve(root, "marketing/verification"));
for (const name of notTaken) console.warn(`build-marketing: marketing/verification/${name} was NOT taken — a verification file needs a plain name (letters, digits, dot, dash, underscore) ending in .html, .txt or .xml, and at most 4 KB`);
writeFileSync(resolve(gen, "verification.ts"), `// AUTO-GENERATED by scripts/build-marketing.mjs — do not edit.\nexport const VERIFICATION_FILES: Record<string, string> = ${JSON.stringify(verification)};\n`);

writeFileSync(
  resolve(out, "_headers"),
  `/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/app/assets/*
  Cache-Control: public, max-age=31536000, immutable
/admin/assets/*
  Cache-Control: public, max-age=31536000, immutable
/sprite.svg
  Cache-Control: public, max-age=86400
/pay/*
  Cache-Control: public, max-age=86400
/logo.webp
  Cache-Control: public, max-age=86400
/logo-sm.webp
  Cache-Control: public, max-age=86400
/icon-*
  Cache-Control: public, max-age=86400
/apple-touch-icon.png
  Cache-Control: public, max-age=86400
/favicon*
  Cache-Control: public, max-age=86400
/pattern.svg
  Cache-Control: public, max-age=86400
/og-default.jpg
  Cache-Control: public, max-age=86400
/chat.js
  Cache-Control: public, max-age=3600
/chat.css
  Cache-Control: public, max-age=3600
/theme.js
  Cache-Control: public, max-age=3600
/manifest.webmanifest
  Cache-Control: public, max-age=86400
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`,
);

const kb = (n) => (n / 1024).toFixed(1);
console.log(`marketing assets built: css ${kb(css.length)} KB (inline), fonts css ${kb(siteFontsCss.length)} KB (inline), shop css ${kb(shopCss.length)} KB (inline on the shop's pages), landing css ${kb(landingCss.length)} KB (inline on landing pages), class page css ${kb(courseCss.length)} KB, documents css ${kb(docCss.length)} KB, ${siteJsName} ${kb(js.length)} KB, ${bannersJsName} ${kb(bannersJs.length)} KB, ${galleryJsName} ${kb(galleryJs.length)} KB, ${certJsName} ${kb(certJs.length)} KB, ${shopJsName} ${kb(shopJs.length)} KB, ${analyticsJsName} ${kb(analyticsJs.length)} KB, chat.js ${kb(chatJs.length)} KB, ${Object.keys(verification).length} verification file(s)`);
