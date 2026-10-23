import { afterEach, describe, expect, it } from "vitest";
import { SETTING_DEFAULTS, setSetting } from "../src/lib/settings";
import { DEVELOPER, PAY_LOGOS } from "../src/views/footer-data";
import { Client, env, freshState } from "./helpers";

/*
 * The footer's "We accept" row (the owner's bKash, Nagad and Rocket pictures plus Visa and Mastercard) and the developer credit.
 * What the owner cannot see by eye: that every picture is really there and the page reserves exactly the room it needs (a
 * regenerated or swapped file must not drift from the numbers in the markup), that each one has a spoken name in both
 * languages, and that the credit is a safe, visible link with the "all rights reserved" line next to it. While SSLCommerz takes payments,
 * its own picture stands in for the row (worker/test/ssl-logo.test.ts); the row is checked here with SSLCommerz switched off.
 */
const SITE = env.SITE_URL.replace(/\/$/, "");
const html = async (path: string) => (await new Client().get(path)).text();

/** The <img> tags inside the payment row of a page. */
function payImages(page: string) {
  const row = page.match(/<ul class="pay-logos"[^>]*>(.*?)<\/ul>/s)?.[1] ?? "";
  return [...row.matchAll(/<img ([^>]*)>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    return attrs as Record<string, string>;
  });
}

function webpSize(b: Uint8Array): { w: number; h: number } {
  const tag = String.fromCharCode(...b.slice(12, 16));
  if (tag === "VP8 ") return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
  if (tag === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  if (tag === "VP8L") {
    const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`not a WebP file (${tag})`);
}

async function setPayments(over: Partial<typeof SETTING_DEFAULTS.payments>) {
  await setSetting(env, "payments", { ...SETTING_DEFAULTS.payments, ...over }, null);
  freshState();
}
afterEach(async () => setPayments({}));

describe("the payment logos in the footer", () => {
  it("every public page shows the five marks in order, each with a spoken name in its own language", async () => {
    await setPayments({ sslcommerz: false });
    const names = {
      en: ["bKash", "Nagad", "Rocket", "Visa", "Mastercard"],
      bn: ["বিকাশ", "নগদ", "রকেট", "ভিসা", "মাস্টারকার্ড"],
    };
    for (const [lang, prefix] of [["en", "/en"], ["bn", ""]] as const) {
      for (const path of ["", "/faq", "/courses", "/contact"]) {
        const page = await html(`${prefix}${path}` || "/");
        const imgs = payImages(page);
        expect(imgs.map((i) => i.src), `${lang} ${path}`).toEqual(PAY_LOGOS.map((p) => p.src));
        expect(imgs.map((i) => i.alt), `${lang} ${path}`).toEqual(names[lang]);
        for (const img of imgs) {
          expect(Number(img.width) > 0 && Number(img.height) > 0, "room is kept for the picture").toBe(true);
          expect(img.loading, "below the fold: loaded when scrolled to").toBe("lazy");
        }
        // the row is a list with a visible heading (screen readers announce "We accept, list, 5 items")
        expect(page).toMatch(/<p class="foot-h mt" id="pay-h">[^<]+<\/p>\s*<ul class="pay-logos" aria-labelledby="pay-h">/);
        expect(page, "the old text-only chips are gone").not.toContain('class="pay-list"');
      }
    }
  });

  it("each picture is served, is the kind of file the markup says, and is exactly the size the page reserves", async () => {
    for (const p of PAY_LOGOS) {
      const res = await env.ASSETS.fetch(new Request(`${SITE}${p.src}`));
      expect(res.status, p.src).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length, `${p.src} is small`).toBeLessThan(20 * 1024);
      if (p.src.endsWith(".webp")) {
        expect(res.headers.get("content-type")).toMatch(/image\/webp/);
        // drawn at 3x the size it is shown at, so it stays sharp on phones
        expect(webpSize(bytes), p.src).toEqual({ w: p.width, h: p.height });
        expect(p.height).toBe(72);
      } else {
        expect(res.headers.get("content-type")).toMatch(/image\/svg\+xml/);
        const svg = new TextDecoder().decode(bytes);
        const box = svg.match(/viewBox="([\d.\s-]+)"/)?.[1].trim().split(/\s+/).map(Number);
        expect(box, `${p.src} has a viewBox`).toHaveLength(4);
        // same shape as the numbers in the markup (within a percent)
        expect(Math.abs(box![2] / box![3] / (p.width / p.height) - 1)).toBeLessThan(0.01);
        // a vector logo is a picture, never a script
        expect(svg).not.toMatch(/<script|onload|onclick|href=|xlink/i);
      }
    }
  });
});

describe("the developer credit", () => {
  it("is a safe, visible link next to the rights line — in English and in Bangla", async () => {
    const year = new Date().getUTCFullYear();
    const en = await html("/en");
    expect(en).toContain(`© ${year} MAWAH Academy. All rights reserved.`);
    expect(en).toMatch(
      new RegExp(`<span class="foot-credit">\\s*Developed by\\s*<a href="${DEVELOPER.url.replace(/[.]/g, "\\.")}" rel="noopener noreferrer" target="_blank">\\s*${DEVELOPER.name}\\s*<span class="vh"> \\(opens in a new tab\\)</span></a>`),
    );
    const bn = await html("/");
    expect(bn).toContain("সর্বস্বত্ব সংরক্ষিত");
    expect(bn).toContain("ডেভেলপ করেছেন");
    expect(bn).toContain(`href="${DEVELOPER.url}"`);
  });

  it("is only the one address the owner gave", () => {
    expect(DEVELOPER.url).toBe("https://sayadbayezid.com");
  });
});
