import { beforeEach, describe, expect, it } from "vitest";
import { dhakaToday, resetBannerCache } from "../src/services/banners";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * Admin → Banners: the home-page slider and the offer pop-up. The owner writes the words and uploads the pictures; these tests
 * protect what the owner cannot see by eye: who may edit, what a button may link to, which banners are live today (the days
 * are Bangladesh days and both ends count), that the owner's text can never become markup, and that nothing changes for a
 * site without banners.
 */

const text = (res: Response) => res.text();
const PICTURE = `banners/${"a1".repeat(16)}.webp`;
const PHONE = `banners/${"b2".repeat(16)}.webp`;
const dayOffset = (n: number) => new Date(Date.parse(`${dhakaToday()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const base = {
  placement: "hero",
  title_bn: "",
  title_en: "",
  text_bn: "",
  text_en: "",
  image_key: PICTURE,
  mobile_image_key: null,
  alt_bn: "",
  alt_en: "",
  button_bn: "",
  button_en: "",
  link_url: "",
  new_tab: false,
  active: true,
  starts_at: null,
  ends_at: null,
  sort: 100,
  popup_delay_sec: 6,
  popup_repeat_days: 1,
  popup_pages: "home",
};

async function owner() {
  return (await loginStaff("super_admin")).client;
}
async function create(admin: Client, over: Record<string, unknown> = {}) {
  const res = await admin.post("/api/admin/banners", { ...base, ...over });
  if (res.status !== 201) throw new Error(`create banner failed: ${res.status} ${await res.text()}`);
  return (await json(res)).item as { id: number; updated_at: string };
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM banners").run();
  resetBannerCache();
});

describe("who may edit banners, and what they may enter", () => {
  it("content managers and owners can; viewers can look but not change; strangers cannot even look", async () => {
    const admin = await owner();
    const content = (await loginStaff("content_manager")).client;
    const viewer = (await loginStaff("viewer")).client;
    expect((await content.post("/api/admin/banners", { ...base, title_en: "Eid offer" })).status).toBe(201);
    expect((await viewer.get("/api/admin/banners")).status).toBe(200);
    expect((await viewer.post("/api/admin/banners", { ...base, title_en: "x" })).status).toBe(403);
    expect((await viewer.patch("/api/admin/banners/1", { active: false })).status).toBe(403);
    expect((await new Client().get("/api/admin/banners")).status).toBe(401);
    expect((await admin.get("/api/admin/banners")).status).toBe(200);
  });

  it("needs a picture or a headline, and a button needs somewhere to go", async () => {
    const admin = await owner();
    const nothing = await admin.post("/api/admin/banners", { ...base, image_key: null });
    expect(nothing.status).toBe(422);
    expect((await json(nothing)).error.fields).toMatchObject({ image_key: "required" });
    expect((await admin.post("/api/admin/banners", { ...base, image_key: null, title_en: "Words only is fine" })).status).toBe(201);

    const orphan = await admin.post("/api/admin/banners", { ...base, button_en: "Get the offer", link_url: "" });
    expect(orphan.status).toBe(422);
    expect((await json(orphan)).error.fields).toMatchObject({ link_url: "required" });
  });

  it("a button can lead to a page of this site, an https address, a phone number or an e-mail — nothing that can run code", async () => {
    const admin = await owner();
    for (const ok of ["/courses/beginners-baking-class", "/en/courses", "https://mawahbd.com/offers?x=1", "tel:+8801700000000", "mailto:hello@mawahacademy.com", ""]) {
      expect((await admin.post("/api/admin/banners", { ...base, title_en: "t", button_en: ok ? "Go" : "", link_url: ok })).status, ok).toBe(201);
    }
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "//evil.example/x", "http://mawahbd.com", "ftp://x.test/a", "mawahbd.com", "/has space"]) {
      const res = await admin.post("/api/admin/banners", { ...base, title_en: "t", button_en: "Go", link_url: bad });
      expect(res.status, bad).toBe(422);
    }
  });

  it("only this site's banner pictures are accepted, and the last day cannot be before the first", async () => {
    const admin = await owner();
    for (const bad of ["photos/" + "a".repeat(32) + ".webp", "banners/../secret.webp", "https://evil.example/x.png", `banners/${"a".repeat(32)}.svg`]) {
      expect((await admin.post("/api/admin/banners", { ...base, image_key: bad })).status, bad).toBe(422);
    }
    const res = await admin.post("/api/admin/banners", { ...base, starts_at: "2026-12-10", ends_at: "2026-12-01" });
    expect(res.status).toBe(422);
    expect((await json(res)).error.fields).toMatchObject({ ends_at: "before_start" });
    expect((await admin.post("/api/admin/banners", { ...base, popup_delay_sec: 500 })).status).toBe(422);
  });

  it("the quick on/off switch changes only that, keeps everything else, and is written to the activity log", async () => {
    const admin = await owner();
    const b = await create(admin, { title_en: "Switch me", button_en: "Go", link_url: "/courses" });
    expect((await admin.patch(`/api/admin/banners/${b.id}`, { active: false })).status).toBe(200);
    const row = (await json(await admin.get(`/api/admin/banners/${b.id}`))).item;
    expect(row).toMatchObject({ active: 0, title_en: "Switch me", link_url: "/courses", button_en: "Go" });
    const log = await json(await admin.get("/api/admin/activity?action=banners.updated"));
    expect(log.items.length).toBeGreaterThan(0);
  });
});

describe("the home page slider", () => {
  it("a site without banners opens exactly as before: its own welcome, no slider, no extra script", async () => {
    const html = await text(await new Client().get("/en"));
    expect(html).not.toContain("data-slider");
    expect(html).not.toContain('class="hero has-banners"');
    expect(html).toContain('<section class="hero">');
    expect(html).not.toMatch(/\/assets\/banners\.[a-f0-9]+\.js/);
    expect(html).not.toContain("data-offer");
  });

  it("shows live banners in the owner's order, as a labelled carousel with controls, and keeps the page's own headline", async () => {
    const admin = await owner();
    await create(admin, { title_en: "Second banner", sort: 20, image_key: null });
    await create(admin, { title_en: "First banner", title_bn: "প্রথম ব্যানার", text_en: "Twenty percent off", sort: 10, alt_en: "Eid offer picture", mobile_image_key: PHONE });
    const html = await text(await new Client().get("/en"));
    expect(html.indexOf("First banner")).toBeGreaterThan(-1);
    expect(html.indexOf("First banner")).toBeLessThan(html.indexOf("Second banner"));
    expect(html).toContain('role="region" aria-roledescription="carousel" aria-label="Offers and announcements"');
    expect(html).toContain('aria-roledescription="slide" aria-label="1 of 2"');
    expect(html).toContain('aria-label="2 of 2"');
    expect(html).toContain("data-prev");
    expect(html).toContain("data-next");
    expect(html).toContain('data-toggle');
    expect(html).toMatch(/<source media="\(max-width: 720px\)" srcset="\/media\/banners\/b2b2/);
    expect(html).toContain(`src="/media/${PICTURE}" alt="Eid offer picture"`);
    expect(html).toContain('fetchpriority="high"'); // the first picture is what a visitor waits for
    expect(html).toContain('class="hero has-banners"');
    expect(html).toContain("<h1>"); // the page keeps its own headline for search engines and screen readers
    expect(html).toMatch(/<script src="\/assets\/banners\.[a-f0-9]+\.js" defer="">/);

    const bn = await text(await new Client().get("/"));
    expect(bn).toContain("প্রথম ব্যানার");
    expect(bn).toContain("Second banner"); // no Bangla headline: the English one is used rather than showing nothing
  });

  it("one banner is a still picture without controls", async () => {
    await create(await owner(), { title_en: "Only one" });
    const html = await text(await new Client().get("/en"));
    expect(html).toContain("Only one");
    expect(html).not.toContain("data-prev");
    expect(html).not.toContain("data-autoplay");
  });

  it("shows only banners that are on, not deleted, and inside their dates — both end days count (Bangladesh days)", async () => {
    const admin = await owner();
    await create(admin, { title_en: "SHOWN-NO-DATES" });
    await create(admin, { title_en: "SHOWN-STARTS-TODAY", starts_at: dayOffset(0) });
    await create(admin, { title_en: "SHOWN-ENDS-TODAY", ends_at: dayOffset(0) });
    await create(admin, { title_en: "HIDDEN-SWITCHED-OFF", active: false });
    await create(admin, { title_en: "HIDDEN-NOT-YET", starts_at: dayOffset(1) });
    await create(admin, { title_en: "HIDDEN-ENDED", ends_at: dayOffset(-1) });
    const gone = await create(admin, { title_en: "HIDDEN-DELETED" });
    expect((await admin.del(`/api/admin/banners/${gone.id}`)).status).toBe(200);
    await create(admin, { title_en: "HIDDEN-POPUP", placement: "popup" });

    const html = await text(await new Client().get("/en"));
    for (const shown of ["SHOWN-NO-DATES", "SHOWN-STARTS-TODAY", "SHOWN-ENDS-TODAY"]) expect(html, shown).toContain(shown);
    for (const hidden of ["HIDDEN-SWITCHED-OFF", "HIDDEN-NOT-YET", "HIDDEN-ENDED", "HIDDEN-DELETED"]) expect(html, hidden).not.toContain(hidden);
    expect(html).not.toContain("HIDDEN-POPUP-IN-SLIDER");
  });

  it("the button: a real link in the visitor's language, a new tab only when asked, and the whole picture links when there is no button", async () => {
    const admin = await owner();
    await create(admin, { title_en: "Own page", button_en: "See the class", button_bn: "ক্লাসটি দেখুন", link_url: "/courses/beginners-baking-class", sort: 1 });
    await create(admin, { title_en: "Elsewhere", button_en: "Visit the shop", link_url: "https://mawahbd.com/offers", new_tab: true, sort: 2 });
    await create(admin, { title_en: "", alt_en: "Picture that links", link_url: "/blog", sort: 3 });
    const en = await text(await new Client().get("/en"));
    expect(en).toMatch(/<a class="btn btn-primary btn-lg" href="\/en\/courses\/beginners-baking-class">See the class/);
    expect(en).toMatch(/<a class="btn btn-primary btn-lg" href="https:\/\/mawahbd\.com\/offers" target="_blank" rel="noopener noreferrer">Visit the shop/);
    expect(en).toContain("opens in a new tab");
    expect(en).toMatch(/<a class="bn-media" href="\/en\/blog" aria-label="Picture that links">/);
    const bn = await text(await new Client().get("/"));
    expect(bn).toMatch(/<a class="btn btn-primary btn-lg" href="\/courses\/beginners-baking-class">ক্লাসটি দেখুন/);
    // the database stores "new tab" as 0 or 1: a button that stays in the same tab must not print a stray "0" after its arrow
    expect(en).not.toMatch(/See the class<svg[^>]*>.*?<\/svg>0/s);
    expect(en).toMatch(/See the class<svg[^>]*><use href="\/sprite\.svg#i-arrow"><\/use><\/svg><\/a>/);
  });

  it("the owner's words are text, never markup", async () => {
    await create(await owner(), { title_en: '<script>alert("x")</script><b>Big</b>', text_en: "<img src=x onerror=alert(1)>", alt_en: '"><script>alert(2)</script>' });
    const html = await text(await new Client().get("/en"));
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert");
  });

  it("an edit shows on the next request (no stale slider)", async () => {
    const admin = await owner();
    const b = await create(admin, { title_en: "Before the edit" });
    expect(await text(await new Client().get("/en"))).toContain("Before the edit");
    expect((await admin.patch(`/api/admin/banners/${b.id}`, { title_en: "After the edit" })).status).toBe(200);
    const html = await text(await new Client().get("/en"));
    expect(html).toContain("After the edit");
    expect(html).not.toContain("Before the edit");
  });
});

describe("the offer pop-up", () => {
  it("is on the page, hidden, with its timing — and the script that shows it is loaded only then", async () => {
    const admin = await owner();
    const b = await create(admin, { placement: "popup", title_en: "Eid offer", text_en: "20% off", button_en: "Get it", link_url: "/courses", popup_delay_sec: 9, popup_repeat_days: 3 });
    await env.DB.prepare("UPDATE banners SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ?").bind(b.id).run();
    resetBannerCache();
    const html = await text(await new Client().get("/en"));
    const tag = /<div class="offer"[^>]*>/.exec(html)?.[0] ?? "";
    for (const piece of ['data-delay="9"', 'data-days="3"', 'role="dialog"', 'aria-modal="true"', 'aria-label="Eid offer"', "hidden", `data-id="${b.id}"`]) expect(tag, piece).toContain(piece);
    expect(html).toContain("Eid offer");
    expect(html).toContain('href="/en/courses"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("No, thanks");
    expect(html).toMatch(/<script src="\/assets\/banners\.[a-f0-9]+\.js" defer="">/);
    expect(html).not.toContain("data-slider"); // a pop-up is not a slider

    // editing it changes its version, so people who closed the old one see the new one
    const before = /data-v="([^"]+)"/.exec(html)![1];
    expect(before).toBe("2020-01-01T00:00:00Z");
    expect((await admin.patch(`/api/admin/banners/${b.id}`, { text_en: "25% off" })).status).toBe(200);
    const again = await text(await new Client().get("/en"));
    expect(/data-v="([^"]+)"/.exec(again)![1]).not.toBe(before);
  });

  it("'home only' stays off the other pages; 'all pages' reaches classes and the blog, but never certificates or verification", async () => {
    const admin = await owner();
    const popup = await create(admin, { placement: "popup", title_en: "HOME-ONLY-OFFER", popup_pages: "home" });
    expect(await text(await new Client().get("/en"))).toContain("data-offer");
    for (const path of ["/en/courses", "/en/courses/beginners-baking-class", "/en/about"]) expect(await text(await new Client().get(path)), path).not.toContain("data-offer");

    expect((await admin.patch(`/api/admin/banners/${popup.id}`, { popup_pages: "all" })).status).toBe(200);
    for (const path of ["/en", "/en/courses", "/en/courses/beginners-baking-class", "/en/blog"]) expect(await text(await new Client().get(path)), path).toContain("data-offer");
    expect(await text(await new Client().get("/en/verify/MWH-ZZZZ-ZZZZ-ZZZZ"))).not.toContain("data-offer");
  });

  it("a pop-up that is off, ended or not yet started is not on the page", async () => {
    const admin = await owner();
    await create(admin, { placement: "popup", title_en: "OFF", active: false });
    await create(admin, { placement: "popup", title_en: "ENDED", ends_at: dayOffset(-2) });
    await create(admin, { placement: "popup", title_en: "SOON", starts_at: dayOffset(2) });
    expect(await text(await new Client().get("/en"))).not.toContain("data-offer");
  });
});
