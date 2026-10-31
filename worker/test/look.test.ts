import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { dhakaMinuteMs, formatDateTime, timeLeft } from "@mawah/shared";
import { COURSE_CSS, CSS, DOC_CSS, FONTS_CSS, SITE_FONTS_BN_CSS, SITE_FONTS_EN_CSS } from "../src/generated/assets";
import { SETTING_DEFAULTS, setSetting } from "../src/lib/settings";
import { styleHash } from "../src/middleware/security";
import { messengerHref } from "../src/views/topbar";
import { Client, env, firstCourse, freshState, json, loginStaff } from "./helpers";

/*
 * The working parts of the dark look that are more than colours. The announcement bar is for the landing pages only, and its countdown
 * is always the owner's own end of the offer: it shows only until then, the owner can switch it off and on, and its end time and button
 * are checked before they are stored. The Messenger button is for the owner's Facebook page only. The class page and the documents send their own styles, so every other page stays as light as before, and the
 * site's text never jumps when a font comes late.
 */
const text = async (path: string) => (await new Client().get(path)).text();
/** What a page shows (its <body>): the inlined styles name every class too. */
const body = async (path: string) => {
  const page = await text(path);
  return page.slice(page.indexOf("<body"));
};
/** A minute of Bangladesh time, as the admin's date-and-time box gives it. */
const dhakaLocal = (ms: number) => new Date(ms + 6 * 3600_000).toISOString().slice(0, 16);

async function setBar(over: Partial<typeof SETTING_DEFAULTS.announcement>) {
  await setSetting(env, "announcement", { ...SETTING_DEFAULTS.announcement, ...over }, null);
  freshState();
}
async function setFacebook(facebook: string) {
  await setSetting(env, "contact", { ...SETTING_DEFAULTS.contact, facebook }, null);
  freshState();
}
afterEach(async () => {
  await setBar({});
  await setFacebook("");
});

/** The countdown bar of a page: what is inside the sticky top, before the header. */
const topOf = (page: string) => /<div class="top"><div class="topbar has-cd" data-countdown="([^"]+)">([\s\S]*?)<header class="site-header">/.exec(page);

/** A published landing page (Admin → Landing pages), in English and in Bangla: the only pages the bar is for. */
let lpEn = "";
let lpBn = "";
beforeAll(async () => {
  const { client: admin } = await loginStaff();
  const made = await admin.post("/api/admin/landing", { title_bn: "ঈদের অফারের পাতা", title_en: `Eid offer page ${Date.now().toString(36)}`, description_bn: "", description_en: "", status: "draft" });
  const { id, slug } = (await json(made)).item as { id: number; slug: string };
  const block = { type: "text", heading_bn: "অফার", heading_en: "The offer", body_bn: "তিনটি ক্লাস", body_en: "Three classes" };
  expect((await admin.put(`/api/admin/landing/${id}/blocks`, { blocks: [block] })).status).toBe(200);
  expect((await admin.patch(`/api/admin/landing/${id}`, { status: "published" })).status).toBe(200);
  lpEn = `/en/l/${slug}`;
  lpBn = `/l/${slug}`;
});

describe("the announcement bar's countdown", () => {
  it("counts down to the owner's end time on the landing pages, in both languages, with a button, and stays at the top with the header", async () => {
    const end = dhakaLocal(Date.now() + ((3 * 24 + 2) * 60 + 30) * 60_000); // 3 days 2 h 30 min from now (to the minute)
    await setBar({ bn: "ঈদ অফার চলছে", en: "Eid offer is on", ends_at: end, link: "/courses" });
    const iso = new Date(dhakaMinuteMs(end)!).toISOString();

    const en = await text(lpEn);
    expect(en).toContain('<html lang="en" class="has-topbar">');
    const bar = topOf(en);
    expect(bar, "the bar sits in the sticky top, before the header").not.toBeNull();
    expect(bar![1]).toBe(iso);
    // the owner's words after a small clock, then the time and the button side by side (centred together: marketing/site.css)
    expect(bar![2]).toContain('<p class="topbar-text"><svg class="icon" aria-hidden="true" focusable="false"><use href="/sprite.svg#i-clock"></use></svg>Eid offer is on</p><div class="cd-row"><div class="cd" role="timer"');
    // the timer's name is the end time itself (screen readers, and anyone without the script)
    expect(bar![2]).toContain(`role="timer" aria-label="The offer ends ${formatDateTime(iso, "en")}"`);
    expect(bar![2]).toMatch(/<b data-cd="d">03<\/b><small>Days<\/small>/);
    expect(bar![2]).toMatch(/<b data-cd="h">02<\/b><small>Hours<\/small>/);
    expect(bar![2]).toMatch(/<b data-cd="m">\d\d<\/b><small>Mins<\/small>/);
    expect(bar![2]).toMatch(/<b data-cd="s">\d\d<\/b><small>Secs<\/small>/);
    // no words for the button: the usual "Join now", to the page in the visitor's language
    expect(bar![2]).toMatch(/<\/div><a class="btn btn-primary btn-sm" href="\/en\/courses">Join now<\/a><\/div><\/div><\/div>$/);

    const bn = await text(lpBn);
    const bnBar = topOf(bn);
    expect(bnBar![2]).toContain('<p class="topbar-text"><svg class="icon" aria-hidden="true" focusable="false"><use href="/sprite.svg#i-clock"></use></svg>ঈদ অফার চলছে</p>');
    expect(bnBar![2]).toContain(`aria-label="অফার শেষ হবে ${formatDateTime(iso, "bn")}"`);
    expect(bnBar![2]).toMatch(/<b data-cd="d">০৩<\/b><small>দিন<\/small>/);
    expect(bnBar![2]).toContain('<a class="btn btn-primary btn-sm" href="/courses">এখনই ভর্তি হোন</a>');

    // the owner's own words for the button
    await setBar({ en: "Eid offer is on", ends_at: end, link: "/courses", button_en: "Grab the offer" });
    expect(topOf(await text(lpEn))![2]).toContain('href="/en/courses">Grab the offer</a>');
    // only the landing pages: the home page, the class list, a class, the FAQ and a certificate check stay without it
    const course = await firstCourse();
    for (const path of ["/en", "/", "/en/courses", `/en/courses/${course.slug}`, "/en/faq", "/en/verify"]) {
      const page = await text(path);
      expect(page, path).not.toContain('class="has-topbar"');
      const shown = page.slice(page.indexOf("<body"));
      for (const trace of ["topbar", "data-countdown", "Eid offer is on"]) expect(shown, `${path}: ${trace}`).not.toContain(trace);
    }
  });

  it("is gone once the end time has passed; without an end time the words scroll away as before; with nothing set there is no bar", async () => {
    await setBar({ en: "Eid offer is on", ends_at: dhakaLocal(Date.now() - 2 * 60_000), link: "/courses" });
    expect(await text(lpEn)).toContain('<html lang="en">');
    const over = await body(lpEn);
    for (const trace of ["topbar", 'class="announce"', "data-countdown", "Eid offer is on"]) expect(over, trace).not.toContain(trace);

    await setBar({ en: "New classes every month", link: "/courses", button_en: "See them" });
    const plain = await text(lpEn);
    expect(plain).toContain('<div class="announce">New classes every month <a href="/en/courses">See them</a></div><div class="top"><header class="site-header">');
    expect(plain).not.toContain("data-countdown");
    expect(plain).toContain('<html lang="en">');
    // the words alone are for the landing pages only too
    expect(await body("/en")).not.toContain('class="announce"');

    await setBar({});
    const none = await body(lpEn);
    for (const trace of ["topbar", 'class="announce"']) expect(none, trace).not.toContain(trace);
  });

  it("the owner can switch the bar off and on again (Active / Inactive) without losing its words, time or button", async () => {
    const end = dhakaLocal(Date.now() + 2 * 24 * 3600_000);
    const { client: admin } = await loginStaff();
    const put = (body: Record<string, unknown>) => admin.put("/api/admin/settings/announcement", body);
    const offer = { bn: "ঈদ অফার চলছে", en: "Eid offer is on", ends_at: end, button_bn: "", button_en: "Grab it", link: "/courses" };

    const off = await put({ ...offer, enabled: false });
    expect(off.status).toBe(200);
    expect((await json(off)).settings.announcement).toEqual({ ...offer, enabled: false });
    freshState();
    expect(await text(lpEn)).toContain('<html lang="en">');
    for (const path of [lpEn, lpBn, "/en"]) {
      const page = await body(path);
      for (const trace of ["topbar", "data-countdown", 'class="announce"', "Eid offer is on", "ঈদ অফার চলছে"]) expect(page, `${path}: ${trace}`).not.toContain(trace);
    }
    // a bar without a countdown (the words alone) goes too
    await setBar({ enabled: false, en: "New classes every month" });
    expect(await body(lpEn)).not.toContain('class="announce"');

    // on again: everything as it was
    const on = await put({ ...offer, enabled: true });
    expect((await json(on)).settings.announcement).toEqual({ ...offer, enabled: true });
    freshState();
    expect(topOf(await text(lpEn))![2]).toContain('href="/en/courses">Grab it</a>');
    // a screen from before the switch sends none: the bar stays on, and so does one stored before the switch existed
    expect((await json(await put(offer))).settings.announcement.enabled).toBe(true);
    await setSetting(env, "announcement", offer, null);
    freshState();
    expect(topOf(await text(lpEn))).not.toBeNull();
    // anything but true or false is refused
    const bad = await put({ ...offer, enabled: "no" });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields).toMatchObject({ enabled: expect.any(String) });
  });

  it("an end time and a button are checked before they are stored; the old form (words only) still saves", async () => {
    const { client: admin } = await loginStaff();
    const put = (body: Record<string, unknown>) => admin.put("/api/admin/settings/announcement", body);
    const cases: [Record<string, unknown>, string, string][] = [
      [{ ends_at: "2026-02-31T10:00" }, "ends_at", "invalid_date"], // a day February does not have
      [{ ends_at: "tomorrow" }, "ends_at", "invalid_date"],
      [{ button_en: "Join" }, "link", "required"], // a button needs somewhere to go
      [{ link: "javascript:alert(1)" }, "link", "invalid_url"],
      [{ link: "//elsewhere.example/offer" }, "link", "invalid_url"],
    ];
    for (const [patch, field, code] of cases) {
      const res = await put({ bn: "", en: "Offer", ...patch });
      expect(res.status, JSON.stringify(patch)).toBe(422);
      expect((await json(res)).error.fields, JSON.stringify(patch)).toMatchObject({ [field]: code });
    }
    expect((await put({ bn: "অফার", en: "Offer" })).status).toBe(200);
    const good = await put({ bn: "", en: "Offer", ends_at: "2030-01-15T23:59", button_en: "Join", link: "/l/eid-offer" });
    expect(good.status).toBe(200);
    expect((await json(good)).settings.announcement).toMatchObject({ ends_at: "2030-01-15T23:59", button_en: "Join", link: "/l/eid-offer" });
  });

  it("reads Bangladesh time to the minute, refuses days a month does not have, and counts whole days, hours, minutes and seconds", () => {
    expect(dhakaMinuteMs("2026-10-31T23:59")).toBe(Date.parse("2026-10-31T17:59:00Z"));
    for (const bad of ["2026-02-31T10:00", "2026-13-01T10:00", "2026-10-31 23:59", "2026-10-31T24:00", "", "soon"]) expect(dhakaMinuteMs(bad), bad).toBeNull();
    const now = Date.parse("2026-10-01T00:00:00Z");
    expect(timeLeft(now + ((2 * 24 + 5) * 3600 + 7 * 60 + 9) * 1000, now)).toEqual({ d: 2, h: 5, m: 7, s: 9 });
    expect(timeLeft(now - 1000, now)).toEqual({ d: 0, h: 0, m: 0, s: 0 });
  });
});

describe("the Messenger button", () => {
  it("opens the chat of the owner's Facebook page — a page's name or number, never a group, an event or a post", () => {
    const cases: [string, string | null][] = [
      ["https://www.facebook.com/mawahacademy", "https://m.me/mawahacademy"],
      ["https://facebook.com/mawahacademy/", "https://m.me/mawahacademy"],
      ["https://m.facebook.com/mawah.academy?ref=bookmarks", "https://m.me/mawah.academy"],
      ["https://www.facebook.com/profile.php?id=100089123456789", "https://m.me/100089123456789"],
      ["https://www.facebook.com/p/MAWAH-Academy-100089123456789/", "https://m.me/100089123456789"],
      ["https://www.facebook.com/groups/mawahbakers", null],
      ["https://www.facebook.com/events/123456789", null],
      ["https://www.facebook.com/mawahacademy/posts/123", null],
      ["https://www.facebook.com/share/abc123", null],
      ["https://example.com/mawahacademy", null],
      ["javascript:alert(1)", null],
      ["not a link", null],
    ];
    for (const [url, want] of cases) expect(messengerHref(url), url).toBe(want);
  });

  it("is one of the ways in the talk-to-us card on every page once the Facebook page is set, opening in a new tab, in both languages", async () => {
    expect(await body("/en")).not.toContain("help-ms");
    await setFacebook("https://www.facebook.com/mawahacademy");
    // the assistant is on too (its default), so the corner button opens the card with both ways (worker/test/help.test.ts has the rest)
    const en = await body("/en");
    expect(en).toContain('<a class="help-opt help-ms" href="https://m.me/mawahacademy" rel="noopener noreferrer" target="_blank">');
    expect(en).toContain('<b>Messenger<span class="vh"> (opens in a new tab)</span></b>');
    expect(await body("/")).toContain('<b>মেসেঞ্জার<span class="vh"> (নতুন ট্যাবে খুলবে)</span></b>');
  });
});

describe("the class page's and the documents' own styles", () => {
  it("come only with their pages, each allowed by its own hash; the home page stays as light as before", async () => {
    const course = await firstCourse();
    const classRes = await new Client().get(`/en/courses/${course.slug}`);
    expect(await classRes.text()).toContain(`<style>${COURSE_CSS}</style>`);
    expect(classRes.headers.get("content-security-policy")).toContain(await styleHash(COURSE_CSS));

    const verifyRes = await new Client().get("/en/verify");
    expect(await verifyRes.text()).toContain(`<style>${DOC_CSS}</style>`);
    expect(verifyRes.headers.get("content-security-policy")).toContain(await styleHash(DOC_CSS));

    for (const path of ["/", "/en", "/en/courses", "/en/faq"]) {
      const page = await text(path);
      expect(page, path).not.toContain(COURSE_CSS);
      expect(page, path).not.toContain(DOC_CSS);
      // the pages use Hind Siliguri with bold headings: its two weights are fetched first
      const font = path.startsWith("/en") ? "latin" : "bn";
      expect(page, path).toContain(`<link rel="preload" href="/fonts/hind-${font}-700.woff2" as="font" type="font/woff2" crossorigin="anonymous"/>`);
    }
  });

  it("never let a late font make the site's text jump, while certificates and invoices wait for every real font", async () => {
    // how each font file is shown: "optional" = only if it is in by the first drawing, "swap" = drawn in the moment it comes
    const display = (css: string) => Object.fromEntries([...css.matchAll(/font-display:(\w+);src:url\(\/fonts\/([\w-]+)\.woff2\)/g)].map((m) => [m[2], m[1]]));
    // the Bangla regular and bold (the big files every Bangla page preloads: its text and headings) never swap in late; the small Latin
    // files and the semi-bold labels still may — on the site's pages in both languages
    const site = {
      "hind-bn-400": "optional",
      "hind-bn-600": "swap",
      "hind-bn-700": "optional",
      "hind-latin-400": "swap",
      "hind-latin-600": "swap",
      "hind-latin-700": "swap",
      "tiro-bn-400": "swap",
      "playfair-latin-600": "swap",
    };
    expect(display(SITE_FONTS_BN_CSS)).toEqual(site);
    expect(display(SITE_FONTS_EN_CSS)).toEqual(site);
    expect(Object.values(display(FONTS_CSS))).toEqual(Array(8).fill("swap"));
    // which file draws a space: on a Bangla page the Bangla ones (the last rule covering a letter wins, so they come after the Latin ones),
    // so a space never waits for the Latin file; an English page keeps the Latin ones and never fetches a Bangla file for a space
    const spaceFrom = (css: string) => [...css.matchAll(/src:url\(\/fonts\/([\w-]+)\.woff2\)[^;]*;unicode-range:([^}]*)\}/g)].filter((m) => /(^|,)U\+(0000-00FF|0020|20)(,|$)/i.test(m[2])).map((m) => m[1]);
    expect(spaceFrom(SITE_FONTS_BN_CSS).slice(-3)).toEqual(["hind-bn-400", "hind-bn-600", "hind-bn-700"]);
    expect(spaceFrom(SITE_FONTS_EN_CSS).filter((f) => f.startsWith("hind-bn"))).toEqual([]);
    // a <style> of their own, before the site's styles (which carry no fonts), allowed by its own hash
    expect(CSS).not.toContain("@font-face");
    const course = await firstCourse();
    for (const [path, fonts] of [
      ["/", SITE_FONTS_BN_CSS],
      [`/courses/${course.slug}`, SITE_FONTS_BN_CSS],
      [`/en/courses/${course.slug}`, SITE_FONTS_EN_CSS],
    ] as const) {
      const res = await new Client().get(path);
      const html = await res.text();
      expect(html, path).toContain(`<style>${fonts}</style><style>${CSS}</style>`);
      expect(res.headers.get("content-security-policy"), path).toContain(await styleHash(fonts));
    }
    const sample = await new Client().get(`/certificate/sample?class=${course.slug}`);
    const doc = await sample.text();
    expect(doc).toContain(`<style>${FONTS_CSS}</style><style>${CSS}</style>`);
    expect(sample.headers.get("content-security-policy")).toContain(await styleHash(FONTS_CSS));
  });
});

describe("the home page, after the owner's CraftSkills reference", () => {
  it("draws the key words of its headings in orange, and sets 'why learn with us' and 'how it works' in light sections, in both languages", async () => {
    const en = await body("/en");
    expect(en).toContain('<h1>Learn <span class="hl">cooking &amp; baking</span> step by step, from home.</h1>');
    const why = /<section class="section band-light" id="why">([\s\S]*?)<\/section>/.exec(en);
    expect(why, "'why learn with us' is a light section").not.toBeNull();
    expect(why![1]).toContain('<h2>Why learn with <span class="hl">MAWAH</span></h2>');
    expect(why![1].match(/<div class="trust-item"><span class="trust-ico">/g)).toHaveLength(4);
    expect(why![1]).toContain("<h3>Verified certificate</h3>"); // under the section's heading, not beside it
    expect(en).toContain('<h2>Our <span class="hl">classes</span></h2>');
    expect(en).toContain('<section class="section band-light"><div class="wrap"><header class="sec-head center"><h2>How <span class="hl">it works</span></h2>');
    expect(en).toContain('<h2 id="faq-h">Questions <span class="hl">before you join</span></h2>');

    const bn = await body("/");
    expect(bn).toContain('<h1>ঘরে বসেই ধাপে ধাপে শিখুন <span class="hl">রান্না ও বেকিং</span>।</h1>');
    expect(bn).toContain('<h2>কেন <span class="hl">মাওয়াহ একাডেমিতে</span> শিখবেন</h2>');
    expect(bn).toContain('<h2>আমাদের <span class="hl">ক্লাসসমূহ</span></h2>');
    // a heading with no words to colour stays one plain heading (an instructor's page)
    const chef = await env.DB.prepare("SELECT slug FROM instructors WHERE active = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1").first<{ slug: string }>();
    const page = await body(`/en/instructors/${chef!.slug}`);
    expect(page).toContain('<header class="sec-head"><h2>Classes by ');
    expect(page).not.toContain('class="hl"');
  });

  it("has a 'back to the top' button above WhatsApp on every page, in both languages", async () => {
    for (const path of ["/en", "/en/courses", "/en/faq"]) {
      expect(await body(path), path).toContain('<div class="floats"><a class="fab fab-top" href="#top" data-to-top="true" aria-label="Back to the top" title="Back to the top">');
    }
    expect(await body("/")).toContain('<a class="fab fab-top" href="#top" data-to-top="true" aria-label="উপরে ফিরে যান" title="উপরে ফিরে যান">');
  });
});
