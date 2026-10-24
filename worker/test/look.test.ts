import { afterEach, describe, expect, it } from "vitest";
import { dhakaMinuteMs, formatDateTime, timeLeft } from "@mawah/shared";
import { COURSE_CSS, DOC_CSS } from "../src/generated/assets";
import { SETTING_DEFAULTS, setSetting } from "../src/lib/settings";
import { styleHash } from "../src/middleware/security";
import { messengerHref } from "../src/views/topbar";
import { Client, env, firstCourse, freshState, json, loginStaff } from "./helpers";

/*
 * The working parts of the dark look that are more than colours. The announcement bar's countdown is always the owner's own end of the
 * offer: it shows only until then, and its end time and button are checked before they are stored. The Messenger button is for the owner's
 * Facebook page only. The class page and the documents send their own styles, so every other page stays as light as before.
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

describe("the announcement bar's countdown", () => {
  it("counts down to the owner's end time, in both languages, with a button, and stays at the top with the header", async () => {
    const end = dhakaLocal(Date.now() + ((3 * 24 + 2) * 60 + 30) * 60_000); // 3 days 2 h 30 min from now (to the minute)
    await setBar({ bn: "ঈদ অফার চলছে", en: "Eid offer is on", ends_at: end, link: "/courses" });
    const iso = new Date(dhakaMinuteMs(end)!).toISOString();

    const en = await text("/en");
    expect(en).toContain('<html lang="en" class="has-topbar">');
    const bar = topOf(en);
    expect(bar, "the bar sits in the sticky top, before the header").not.toBeNull();
    expect(bar![1]).toBe(iso);
    expect(bar![2]).toContain('<p class="topbar-text">Eid offer is on</p>');
    // the timer's name is the end time itself (screen readers, and anyone without the script)
    expect(bar![2]).toContain(`role="timer" aria-label="The offer ends ${formatDateTime(iso, "en")}"`);
    expect(bar![2]).toMatch(/<b data-cd="d">03<\/b><small>Days<\/small>/);
    expect(bar![2]).toMatch(/<b data-cd="h">02<\/b><small>Hours<\/small>/);
    expect(bar![2]).toMatch(/<b data-cd="m">\d\d<\/b><small>Mins<\/small>/);
    expect(bar![2]).toMatch(/<b data-cd="s">\d\d<\/b><small>Secs<\/small>/);
    // no words for the button: the usual "Join now", to the page in the visitor's language
    expect(bar![2]).toContain('<a class="btn btn-primary btn-sm" href="/en/courses">Join now</a>');

    const bn = await text("/");
    const bnBar = topOf(bn);
    expect(bnBar![2]).toContain('<p class="topbar-text">ঈদ অফার চলছে</p>');
    expect(bnBar![2]).toContain(`aria-label="অফার শেষ হবে ${formatDateTime(iso, "bn")}"`);
    expect(bnBar![2]).toMatch(/<b data-cd="d">০৩<\/b><small>দিন<\/small>/);
    expect(bnBar![2]).toContain('<a class="btn btn-primary btn-sm" href="/courses">এখনই ভর্তি হোন</a>');

    // the owner's own words for the button
    await setBar({ en: "Eid offer is on", ends_at: end, link: "/courses", button_en: "Grab the offer" });
    expect(topOf(await text("/en"))![2]).toContain('href="/en/courses">Grab the offer</a>');
    // every public page has it, and a certificate check too (with its own styles)
    expect(topOf(await text("/en/faq"))).not.toBeNull();
    expect(topOf(await text("/en/verify"))).not.toBeNull();
  });

  it("is gone once the end time has passed; without an end time the words scroll away as before; with nothing set there is no bar", async () => {
    await setBar({ en: "Eid offer is on", ends_at: dhakaLocal(Date.now() - 2 * 60_000), link: "/courses" });
    expect(await text("/en")).toContain('<html lang="en">');
    const over = await body("/en");
    for (const trace of ["topbar", 'class="announce"', "data-countdown", "Eid offer is on"]) expect(over, trace).not.toContain(trace);

    await setBar({ en: "New classes every month", link: "/courses", button_en: "See them" });
    const plain = await text("/en");
    expect(plain).toContain('<div class="announce">New classes every month <a href="/en/courses">See them</a></div><div class="top"><header class="site-header">');
    expect(plain).not.toContain("data-countdown");
    expect(plain).toContain('<html lang="en">');

    await setBar({});
    const none = await body("/en");
    for (const trace of ["topbar", 'class="announce"']) expect(none, trace).not.toContain(trace);
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

  it("floats with WhatsApp on every page once the Facebook page is set, opening in a new tab, in both languages", async () => {
    expect(await body("/en")).not.toContain("fab-ms");
    await setFacebook("https://www.facebook.com/mawahacademy");
    expect(await text("/en")).toContain('<a class="fab fab-ms" href="https://m.me/mawahacademy" rel="noopener noreferrer" target="_blank" aria-label="Chat on Messenger" title="Chat on Messenger">');
    expect(await text("/")).toContain('aria-label="মেসেঞ্জারে কথা বলুন"');
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
