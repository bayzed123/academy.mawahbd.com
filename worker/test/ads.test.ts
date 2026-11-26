import { beforeEach, describe, expect, it } from "vitest";
import { AD_SPOTS } from "@mawah/shared";
import { markdownBlocks, renderMarkdown } from "../src/lib/markdown";
import { dhakaToday, resetBannerCache, type BannerDTO } from "../src/services/banners";
import { adBreak, adsForPage } from "../src/views/ads";
import type { PageCtx } from "../src/views/ctx";
import { Client, env, firstCourse, json, loginStaff } from "./helpers";

/*
 * The academy's own ads (Admin → Banners → "Ad on class pages & blog"): the owner uploads a picture, says which page it opens and ticks the
 * kinds of page; every page of those kinds then shows it by itself — every class page under "About this class", every blog post (in the
 * middle of a long one, at the end of a short one), the blog's list and the lists of classes. Nothing is added to a page or a post by hand.
 */

const WIDE = `banners/${"c3".repeat(16)}.webp`;
const PHONE = `banners/${"d4".repeat(16)}.webp`;
const OTHER = `banners/${"e5".repeat(16)}.webp`;
const dayOffset = (n: number) => new Date(Date.parse(`${dhakaToday()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const page = async (path: string) => (await new Client().get(path)).text();
/** the ads of a page, in order: [id, shown?] */
const adsOn = (html: string) => [...html.matchAll(/<a class="ad" href="[^"]*" data-ad="(\d+)"[^>]*>/g)].map((m) => [Number(m[1]), !/\bhidden\b/.test(m[0])] as const);
const slots = (html: string) => (html.match(/<aside class="ad-slot/g) ?? []).length;
const AD_STYLE = ".ad-slot{";

const ad = {
  placement: "ad",
  title_bn: "",
  title_en: "",
  text_bn: "",
  text_en: "",
  image_key: WIDE,
  mobile_image_key: null,
  alt_bn: "ঈদ অফার: সব বেকিং ক্লাসে ছাড়",
  alt_en: "Eid offer: every baking class for less",
  button_bn: "",
  button_en: "",
  link_url: "/courses/x",
  new_tab: false,
  active: true,
  starts_at: null,
  ends_at: null,
  sort: 100,
  popup_delay_sec: 6,
  popup_repeat_days: 1,
  popup_pages: "home",
  ad_spots: [...AD_SPOTS],
};

let admin: Client;
async function create(over: Record<string, unknown> = {}) {
  const res = await admin.post("/api/admin/banners", { ...ad, ...over });
  if (res.status !== 201) throw new Error(`create ad failed: ${res.status} ${await res.text()}`);
  return (await json(res)).item as { id: number; ad_spots: string };
}

const LONG = Array.from({ length: 9 }, (_, i) => (i === 3 ? "## How to start" : `Paragraph ${i + 1} of the post.`)).join("\n\n");
async function post(slug: string, body: string) {
  await env.DB.prepare("INSERT INTO blog_posts (slug, title_bn, title_en, body_bn, body_en, status, published_at) VALUES (?, ?, ?, ?, ?, 'published', '2026-11-01T00:00:00Z')")
    .bind(slug, `পোস্ট ${slug}`, `Post ${slug}`, body, body)
    .run();
}

let classSlug = "";
let otherSlug = "";
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM banners").run();
  await env.DB.prepare("DELETE FROM blog_posts WHERE slug LIKE 'ads-%'").run();
  resetBannerCache();
  admin = (await loginStaff("super_admin")).client;
  classSlug = (await firstCourse()).slug;
  otherSlug = (await env.DB.prepare("SELECT slug FROM courses WHERE status = 'published' AND channel = 'website' AND slug <> ? ORDER BY id LIMIT 1").bind(classSlug).first<{ slug: string }>())!.slug;
});

describe("the owner makes an ad in Admin → Banners", () => {
  it("an ad needs its picture, the page it opens and at least one kind of page — each missing one is pointed out", async () => {
    const res = await admin.post("/api/admin/banners", { ...ad, image_key: null, link_url: "", ad_spots: [] });
    expect(res.status).toBe(422);
    expect((await json(res)).error.fields).toEqual({ image_key: "required", link_url: "required", ad_spots: "required" });
    // a kind of page that does not exist is refused
    expect((await admin.post("/api/admin/banners", { ...ad, ad_spots: ["home"] })).status).toBe(422);
  });

  it("keeps the ticked kinds of page as a list in a fixed order; a banner that is not an ad keeps none", async () => {
    const a = await create({ ad_spots: ["blog", "course", "blog"] });
    expect(a.ad_spots).toBe("course,blog");
    const slide = await create({ placement: "hero" });
    expect(slide.ad_spots).toBe("");
    // the quick on/off switch changes nothing else
    expect((await admin.patch(`/api/admin/banners/${a.id}`, { active: false })).status).toBe(200);
    expect((await env.DB.prepare("SELECT ad_spots FROM banners WHERE id = ?").bind(a.id).first<{ ad_spots: string }>())!.ad_spots).toBe("course,blog");
    // a content manager can make one too
    expect((await (await loginStaff("content_manager")).client.post("/api/admin/banners", ad)).status).toBe(201);
  });
});

describe("every page of a ticked kind shows the ad by itself", () => {
  it("every class page, under “About this class”: the wide picture, the phone picture on a phone, a link in the visitor's language", async () => {
    const a = await create({ link_url: `/courses/${otherSlug}`, mobile_image_key: PHONE });
    const en = await page(`/en/courses/${classSlug}`);
    expect(adsOn(en)).toEqual([[a.id, true]]);
    expect(en).toContain(`href="/en/courses/${otherSlug}" data-ad="${a.id}" data-ad-spot="course"`);
    expect(en).toContain(`<source media="(max-width: 720px)" srcset="/media/${PHONE}" width="800" height="400"`);
    expect(en).toContain(`src="/media/${WIDE}" alt="Eid offer: every baking class for less" width="1200" height="300" loading="lazy"`);
    expect(en).toContain('aria-label="From MAWAH Academy"');
    expect(en).toContain(AD_STYLE); // its look comes with it
    // below the description, before "What's included"
    expect(en.indexOf('id="about-h"')).toBeLessThan(en.indexOf("data-ad-slot"));
    expect(en.indexOf("data-ad-slot")).toBeLessThan(en.indexOf('id="inc-h"'));
    const bn = await page(`/courses/${classSlug}`);
    expect(bn).toContain(`href="/courses/${otherSlug}" data-ad="${a.id}"`);
    expect(bn).toContain('alt="ঈদ অফার: সব বেকিং ক্লাসে ছাড়"');
  });

  it("an ad is never shown on the page it opens (whatever way its address is written), but is on the other classes", async () => {
    await create({ link_url: `/en/courses/${classSlug}?utm_source=ad`, ad_spots: ["course"] });
    expect(slots(await page(`/courses/${classSlug}`))).toBe(0);
    expect(slots(await page(`/courses/${otherSlug}`))).toBe(1);
    await env.DB.prepare("DELETE FROM banners").run();
    await create({ link_url: `/courses/${classSlug}/`, ad_spots: ["course"] });
    expect(slots(await page(`/en/courses/${classSlug}`))).toBe(0);
    expect(slots(await page(`/en/courses/${otherSlug}`))).toBe(1);
    // the site's own full address counts as the same page; another site's page of the same name does not
    const ctx = { path: "/courses/cake", abs: (p: string) => `https://mawahacademy.com${p}` } as PageCtx;
    const links = ["https://mawahacademy.com/en/courses/cake#top", "https://mawahacademy.com/courses/cake", "https://example.com/courses/cake", "/courses/cake-2", "/en"];
    expect(adsForPage(ctx, links.map((link_url) => ({ link_url }) as BannerDTO)).map((b) => b.link_url)).toEqual(["https://example.com/courses/cake", "/courses/cake-2", "/en"]);
  });

  it("every blog post: in the middle of a long post (never straight after a heading), at the end of a short one", async () => {
    await post("ads-long", LONG);
    await post("ads-short", "Just one paragraph.");
    const a = await create({ link_url: `/courses/${otherSlug}` });
    const long = await page("/en/blog/ads-long");
    expect(adsOn(long)).toEqual([[a.id, true]]);
    // the post is split around it: the paragraphs before it, then the ad, then the rest (the heading stays with its paragraph)
    const at = long.indexOf("<aside class=\"ad-slot\"");
    expect(long.indexOf("Paragraph 3 of the post.")).toBeLessThan(at);
    expect(long.indexOf("<h3>How to start")).toBeGreaterThan(at);
    expect(long.indexOf("Paragraph 9 of the post.")).toBeGreaterThan(at);
    expect(long).toContain(AD_STYLE);
    const short = await page("/en/blog/ads-short");
    expect(slots(short)).toBe(1);
    expect(short.indexOf("Just one paragraph.")).toBeLessThan(short.indexOf("<aside class=\"ad-slot\""));
  });

  it("with two ads, a long post shows both — one in the middle, the other at its end, never the same one twice", async () => {
    await post("ads-long", LONG);
    const a = await create({ link_url: `/courses/${otherSlug}`, sort: 1 });
    const b = await create({ link_url: "/free-classes", image_key: OTHER, sort: 2 });
    const html = await page("/blog/ads-long");
    expect(slots(html)).toBe(2);
    // both places hold both ads in the owner's order; the first place shows the first, the second the other (the page's script then
    // picks the pair for each visit, still two different ones)
    expect(adsOn(html)).toEqual([
      [a.id, true],
      [b.id, false],
      [a.id, false],
      [b.id, true],
    ]);
    expect(html).toContain('data-ad-slot="0"');
    expect(html).toContain('data-ad-slot="1"');
  });

  it("the blog's list, all classes and the free classes", async () => {
    await post("ads-short", "Just one paragraph.");
    const a = await create({ link_url: `/courses/${otherSlug}` });
    for (const [path, spot] of [
      ["/en/blog", "blog_list"],
      ["/en/courses", "courses"],
      ["/en/free-classes", "courses"],
    ] as const) {
      const html = await page(path);
      expect(adsOn(html), path).toEqual([[a.id, true]]);
      expect(html, path).toContain(`data-ad-spot="${spot}"`);
    }
  });

  it("only on the kinds of page ticked, only while it is on and inside its dates; a page without an ad carries none of it", async () => {
    await post("ads-short", "Just one paragraph.");
    const a = await create({ link_url: `/courses/${otherSlug}`, ad_spots: ["blog"] });
    expect(slots(await page("/en/blog/ads-short"))).toBe(1);
    const plain = await page(`/en/courses/${classSlug}`);
    expect(slots(plain)).toBe(0);
    expect(plain).not.toContain(AD_STYLE);
    expect(slots(await page("/en/courses"))).toBe(0);
    expect(slots(await page("/en/blog"))).toBe(0);

    expect((await admin.patch(`/api/admin/banners/${a.id}`, { active: false })).status).toBe(200);
    expect(slots(await page("/en/blog/ads-short"))).toBe(0);
    expect((await admin.patch(`/api/admin/banners/${a.id}`, { active: true, starts_at: dayOffset(1) })).status).toBe(200);
    expect(slots(await page("/en/blog/ads-short"))).toBe(0);
    expect((await admin.patch(`/api/admin/banners/${a.id}`, { starts_at: dayOffset(-3), ends_at: dayOffset(-1) })).status).toBe(200);
    expect(slots(await page("/en/blog/ads-short"))).toBe(0);
    expect((await admin.patch(`/api/admin/banners/${a.id}`, { ends_at: dayOffset(0) })).status).toBe(200);
    expect(slots(await page("/en/blog/ads-short"))).toBe(1); // the last day counts
    expect((await admin.del(`/api/admin/banners/${a.id}`)).status).toBe(200);
    expect(slots(await page("/en/blog/ads-short"))).toBe(0);
  });

  it("an ad that opens another site opens it in a new tab, and says so", async () => {
    await post("ads-short", "Just one paragraph.");
    await create({ link_url: "https://www.facebook.com/mawahacademy", new_tab: true, ad_spots: ["blog"] });
    const html = await page("/en/blog/ads-short");
    expect(html).toContain('href="https://www.facebook.com/mawahacademy" data-ad=');
    expect(html).toMatch(/data-ad-spot="blog" target="_blank" rel="noopener noreferrer"/);
    expect(html).toContain("(opens in a new tab)");
  });

  it("the home page and the shop are left as they were", async () => {
    await create({ link_url: `/courses/${otherSlug}` });
    const home = await page("/en");
    expect(slots(home)).toBe(0);
    expect(home).not.toContain(AD_STYLE);
  });
});

describe("where the ad goes inside a post", () => {
  it("a third of the way in, never straight after a heading; nowhere inside a short post", () => {
    expect(adBreak(markdownBlocks("One.\n\nTwo."))).toBe(-1);
    expect(adBreak(markdownBlocks(Array.from({ length: 6 }, (_, i) => `P${i}`).join("\n\n")))).toBe(2);
    const blocks = markdownBlocks(LONG);
    expect(blocks).toHaveLength(9);
    expect(adBreak(blocks)).toBe(3); // after paragraph 3, before the heading
    expect(markdownBlocks("## Title\n\nText\n\n## Next\n\nMore\n\nA\n\nB").length).toBe(6);
    expect(adBreak(markdownBlocks("A\n\n## Title\n\nText\n\nB\n\nC\n\nD"))).toBe(1); // "## Title" would come right before it: moved up
    // the blocks are the post as before, joined
    expect(markdownBlocks(LONG).join("\n")).toBe(renderMarkdown(LONG));
  });
});
