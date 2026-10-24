import { beforeEach, describe, expect, it } from "vitest";
import { common } from "@mawah/shared";
import { resetBannerCache } from "../src/services/banners";
import { firstSentence, STARTER_COUNT } from "../src/services/bannerStarter";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * How a banner looks (Admin → Banners): colour theme, where the words go, a large line drawing, which part of a photo stays in view, and
 * a small line above the title — and "Create starter banners", which makes the first slider from the published classes in one click.
 * These tests protect what the owner cannot see by eye: that a banner with no design chosen is exactly what it was, that only the known
 * choices can be stored or drawn, that the words of the starters are the class's own (never a price, a discount or markup), that
 * pressing the button twice adds nothing, and who may press it.
 */

const text = (res: Response) => res.text();
const PICTURE = `banners/${"a1".repeat(16)}.webp`;
const CLASS_PICTURE = `banners/${"c3".repeat(16)}.webp`;
let seq = 0;

const base = {
  placement: "hero",
  title_bn: "",
  title_en: "",
  text_bn: "",
  text_en: "",
  image_key: null as string | null,
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
  const res = await admin.post("/api/admin/banners", { ...base, title_en: "A banner", ...over });
  if (res.status !== 201) throw new Error(`create banner failed: ${res.status} ${await res.text()}`);
  return (await json(res)).item as Record<string, unknown> & { id: number };
}

interface ClassOver {
  title_en?: string;
  title_bn?: string;
  short_en?: string;
  short_bn?: string;
  price?: number;
  status?: string;
  banner_key?: string | null;
  icon?: string | null;
  featured?: number;
  sort?: number;
  category_id?: number | null;
  deleted?: boolean;
}
/** A class made for these tests (the seeded ones are set aside in `beforeEach`). */
async function makeClass(over: ClassOver = {}) {
  const n = ++seq;
  const slug = `starter-class-${Date.now().toString(36)}-${n}`;
  await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, price, status, banner_key, icon, featured, sort, category_id, instructor_id, published_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?)`,
  )
    .bind(
      slug,
      over.title_bn ?? `স্টার্টার ক্লাস ${n}`,
      over.title_en ?? `Starter Class ${n}`,
      over.short_bn ?? `ক্লাস ${n} এর ছোট বিবরণ। দ্বিতীয় বাক্য।`,
      over.short_en ?? `Short blurb of class ${n}. A second sentence.`,
      over.price ?? 7777,
      over.status ?? "published",
      over.banner_key ?? null,
      over.icon === undefined ? "cake" : over.icon,
      over.featured ?? 0,
      over.sort ?? 100 + n,
      over.category_id === undefined ? 1 : over.category_id,
      over.deleted ? "2026-01-01T00:00:00Z" : null,
    )
    .run();
  return slug;
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM banners").run();
  await env.DB.prepare("UPDATE courses SET status = 'draft'").run(); // only the classes a test makes are published
  resetBannerCache();
});

const home = async (path = "/en") => text(await new Client().get(path));
/** The slider and what follows it (the page's own stylesheet is above it, so class names in the stylesheet are not mistaken for the markup). */
const sliderOf = (html: string) => {
  const start = html.indexOf('class="bn-band"');
  return start < 0 ? "" : html.slice(start, start + 12_000);
};

describe("what may be chosen, and that choosing nothing changes nothing", () => {
  it("a banner with no design is stored with empty choices and drawn exactly as before; an older screen that sends none changes nothing", async () => {
    const admin = await owner();
    const b = await create(admin, { title_en: "Plain banner" });
    expect(b).toMatchObject({ layout: null, theme: null, icon: null, focus: null, kicker_bn: "", kicker_en: "" });
    const html = sliderOf(await home());
    expect(html).toContain('class="bn-slide bn-plain"'); // no theme, layout or focus class: the dark look it always had
    expect(html).not.toMatch(/bn-t-|bn-l-|bn-f-|class="bn-art"|bn-kicker/);

    // a design is chosen, then the switch is flipped by a screen that knows nothing of designs: the design stays
    expect((await admin.patch(`/api/admin/banners/${b.id}`, { theme: "gold", layout: "center", kicker_en: "New class" })).status).toBe(200);
    expect((await admin.patch(`/api/admin/banners/${b.id}`, { active: false })).status).toBe(200);
    expect((await admin.patch(`/api/admin/banners/${b.id}`, { active: true })).status).toBe(200);
    const row = (await json(await admin.get(`/api/admin/banners/${b.id}`))).item;
    expect(row).toMatchObject({ theme: "gold", layout: "center", kicker_en: "New class" });
    // and a design can be taken back to "automatic"
    expect((await admin.patch(`/api/admin/banners/${b.id}`, { theme: null, layout: null })).status).toBe(200);
    expect((await json(await admin.get(`/api/admin/banners/${b.id}`))).item).toMatchObject({ theme: null, layout: null });
  });

  it("only the known colours, layouts, focus and drawings are accepted, and the small line is short", async () => {
    const admin = await owner();
    for (const bad of [{ theme: "neon" }, { theme: "DARK" }, { layout: "right" }, { focus: "middle" }, { icon: "burger" }, { icon: "../sprite" }, { kicker_en: "x".repeat(41) }, { kicker_bn: "x".repeat(41) }]) {
      const res = await admin.post("/api/admin/banners", { ...base, title_en: "t", ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    for (const good of [{ theme: "dark" }, { theme: "ruby" }, { theme: "gold" }, { theme: "ivory" }, { layout: "left" }, { layout: "center" }, { layout: "split" }, { focus: "top" }, { focus: "center" }, { focus: "bottom" }, { icon: "cake" }, { icon: "mango" }, { icon: null }, { kicker_en: "x".repeat(40) }]) {
      expect((await admin.post("/api/admin/banners", { ...base, title_en: "t", ...good })).status, JSON.stringify(good)).toBe(201);
    }
  });

  it("who may change the look is who may change banners", async () => {
    const content = (await loginStaff("content_manager")).client;
    const viewer = (await loginStaff("viewer")).client;
    const b = await create(await owner());
    expect((await content.patch(`/api/admin/banners/${b.id}`, { theme: "ruby" })).status).toBe(200);
    expect((await viewer.patch(`/api/admin/banners/${b.id}`, { theme: "gold" })).status).toBe(403);
    expect((await new Client().patch(`/api/admin/banners/${b.id}`, { theme: "gold" })).status).toBe(401);
  });
});

describe("the look on the page", () => {
  it("a banner with no picture takes its colour, layout, picture focus, kicker and drawing — in either language", async () => {
    const admin = await owner();
    await create(admin, { title_en: "Eid Special", title_bn: "ঈদ বিশেষ", kicker_en: "New class", kicker_bn: "নতুন ক্লাস", theme: "ruby", layout: "split", focus: "top", icon: "cake" });
    const en = sliderOf(await home("/en"));
    expect(en).toContain('class="bn-slide bn-plain bn-t-ruby bn-l-split bn-f-top"');
    expect(en).toContain('<p class="bn-kicker">New class</p>');
    expect(en).toMatch(/<div class="bn-art" aria-hidden="true"><svg class="icon" aria-hidden="true" focusable="false"><use href="\/sprite\.svg#i-cake"/);
    const bn = sliderOf(await home("/"));
    expect(bn).toContain('<p class="bn-kicker">নতুন ক্লাস</p>');
    expect(bn).toContain("ঈদ বিশেষ");
  });

  it("a picture is the art: the drawing is not added over it, but the focus and the other choices still apply", async () => {
    const admin = await owner();
    await create(admin, { image_key: PICTURE, theme: "ivory", layout: "left", focus: "bottom", icon: "cake", alt_en: "Cakes on a table" });
    const html = sliderOf(await home());
    expect(html).toContain('class="bn-slide bn-cap bn-t-ivory bn-l-left bn-f-bottom"'); // a picture: its words in a caption under it
    expect(html).not.toContain("bn-plain");
    expect(html).not.toContain('class="bn-art"');
    expect(html).toContain(`src="/media/${PICTURE}" alt="Cakes on a table"`);
  });

  it("the pop-up takes the colour, the focus and the small line, but never a layout or a drawing", async () => {
    const admin = await owner();
    await create(admin, { placement: "popup", title_en: "Offer", image_key: PICTURE, theme: "gold", layout: "split", focus: "top", icon: "cake", kicker_en: "This week" });
    const html = await home();
    expect(html).toContain('class="offer-card bn-t-gold bn-f-top"');
    expect(html).not.toMatch(/offer-card[^"]*bn-l-/);
    expect(html).toContain('<p class="offer-kicker bn-kicker">This week</p>');
  });

  it("the owner's words and choices can never become markup: only known names reach a class, and nothing is drawn inline", async () => {
    const admin = await owner();
    await create(admin, { title_en: "<b>Hi</b>", kicker_en: `<script>alert(1)</script>"`, theme: "dark", icon: "cake" });
    // a drawing name that is not one of the class drawings (written straight into the database, which has no list for it) is never drawn
    await env.DB.prepare("UPDATE banners SET icon = ? WHERE deleted_at IS NULL").bind(`cake"/><script>alert(2)</script>`).run();
    resetBannerCache();
    const html = sliderOf(await home());
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain('class="bn-art"');
    expect(html).not.toMatch(/\sstyle="/); // the strict policy allows no inline style, so the look is classes only
  });
});

describe("starter banners", () => {
  const starter = (admin: Client) => admin.post("/api/admin/banners/starter", {});
  const banners = async (admin: Client) => (await json(await admin.get("/api/admin/banners?per_page=50&sort=sort"))).items as Record<string, any>[];

  it("makes five banners from the published classes — featured ones first — with the class's own words, an Enroll Now button to it, and no price", async () => {
    const admin = await owner();
    const slugs: string[] = [];
    slugs.push(await makeClass({ title_en: "Plain Seven", sort: 70 }));
    slugs.push(await makeClass({ title_en: "Plain Eight", sort: 80 }));
    slugs.push(await makeClass({ title_en: "Featured Late", featured: 1, sort: 999, icon: "mango" }));
    slugs.push(await makeClass({ title_en: "Plain One", sort: 10 }));
    slugs.push(await makeClass({ title_en: "Plain Two", sort: 20, banner_key: CLASS_PICTURE }));
    slugs.push(await makeClass({ title_en: "Plain Three", sort: 30 }));
    slugs.push(await makeClass({ title_en: "Plain Four", sort: 40 }));
    const res = await starter(admin);
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ created: STARTER_COUNT, existing: 0, available: 7 });

    const rows = await banners(admin);
    expect(rows).toHaveLength(5);
    // featured first, then by the owner's class order
    expect(rows.map((r) => r.title_en)).toEqual(["Featured Late", "Plain One", "Plain Two", "Plain Three", "Plain Four"]);
    expect(rows.map((r) => r.theme)).toEqual(["dark", "ruby", "gold", "ivory", "dark"]); // five that do not look alike
    expect(new Set(rows.map((r) => r.layout)).size).toBeGreaterThan(1);
    for (const r of rows) {
      expect(r).toMatchObject({ placement: "hero", active: 1, button_en: common.en["btn.enrollNow"], button_bn: common.bn["btn.enrollNow"], new_tab: 0 });
      expect(r.link_url).toMatch(/^\/courses\/starter-class-/);
      expect(r.kicker_en).not.toBe(""); // the category's name
    }
    expect(rows[0]).toMatchObject({ icon: "mango", link_url: `/courses/${slugs[2]}` });
    expect(rows[2]).toMatchObject({ image_key: CLASS_PICTURE, alt_en: "Plain Two" }); // the class's own picture is used, and described
    expect(rows[1].image_key).toBeNull();
    // first sentence only; no price, no discount, no number nobody gave
    expect(rows[1].text_en).toMatch(/^Short blurb of class \d+\.$/);
    const everything = JSON.stringify(rows.map((r) => [r.title_bn, r.title_en, r.text_bn, r.text_en, r.button_bn, r.button_en, r.kicker_bn, r.kicker_en]));
    expect(everything).not.toMatch(/7777|7,777|৳|Tk|%|off\b|discount|ছাড়/i);

    // live on the home page at once, in both languages
    const html = sliderOf(await home("/en"));
    expect(html).toContain("Featured Late");
    expect(html).toContain('aria-label="1 of 5"');
    expect(html).toContain('aria-label="5 of 5"');
    expect(sliderOf(await home("/"))).toContain("স্টার্টার ক্লাস");
    const log = await json(await admin.get("/api/admin/activity?action=banners.starter"));
    expect(log.items.length).toBeGreaterThan(0);
  });

  it("pressing it again adds nothing, and never goes past five class banners in all", async () => {
    const admin = await owner();
    for (let i = 0; i < 8; i++) await makeClass();
    expect((await starter(admin)).status).toBe(201);
    const again = await starter(admin);
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ created: 0, existing: 5, available: 3 });
    expect(await banners(admin)).toHaveLength(5);
  });

  it("classes that already have a banner are skipped (even a switched-off one), a deleted banner does not count, and only the missing ones are made", async () => {
    const admin = await owner();
    const slugs: string[] = [];
    for (let i = 0; i < 6; i++) slugs.push(await makeClass({ sort: 10 * (i + 1) }));
    await create(admin, { title_en: "Mine, off", link_url: `/courses/${slugs[0]}`, button_en: "Go", active: false });
    const gone = await create(admin, { title_en: "Mine, deleted", link_url: `/courses/${slugs[1]}`, button_en: "Go" });
    await admin.del(`/api/admin/banners/${gone.id}`);
    await create(admin, { title_en: "Not a class banner", link_url: "https://mawahbd.com/offers", button_en: "Go" }); // does not count towards the five

    const res = await json(await starter(admin));
    expect(res).toMatchObject({ created: 4, existing: 1, available: 5 }); // five classes lacked a banner (the first has one), room for four more
    const rows = (await banners(admin)).filter((r) => r.kicker_en);
    expect(rows.map((r) => r.link_url).sort()).toEqual([slugs[1], slugs[2], slugs[3], slugs[4]].map((s) => `/courses/${s}`).sort());
    expect(rows.map((r) => r.theme)).toEqual(["ruby", "gold", "ivory", "dark"]); // the colours go on from where the banners already there stopped
  });

  it("only live classes get one: not drafts, coming soon, archived, or deleted — and with none it says so", async () => {
    const admin = await owner();
    await makeClass({ status: "draft" });
    await makeClass({ status: "coming_soon" });
    await makeClass({ status: "archived" });
    await makeClass({ deleted: true });
    const none = await starter(admin);
    expect(none.status).toBe(200);
    expect(await json(none)).toMatchObject({ created: 0, existing: 0, available: 0 });
    const live = await makeClass({ title_en: "The only live one" });
    expect(await json(await starter(admin))).toMatchObject({ created: 1, available: 1 });
    expect((await banners(admin))[0]).toMatchObject({ title_en: "The only live one", link_url: `/courses/${live}` });
  });

  it("a class's description becomes one plain line (markup, links and line breaks removed), and a class with none gets no line", async () => {
    const admin = await owner();
    await makeClass({ short_en: "**Bake** a [lovely cake](https://x.example)\nat home. More follows.", short_bn: "ঘরে বসে **কেক** বানান। আরও বিস্তারিত।" });
    await makeClass({ short_en: "", short_bn: "" });
    await starter(admin);
    const rows = await banners(admin);
    expect(rows[0].text_en).toBe("Bake a lovely cake at home.");
    expect(rows[0].text_bn).toBe("ঘরে বসে কেক বানান।");
    expect(rows[1]).toMatchObject({ text_en: "", text_bn: "" });
  });

  it("only those who may change banners can press it", async () => {
    await makeClass();
    const content = (await loginStaff("content_manager")).client;
    const viewer = (await loginStaff("viewer")).client;
    expect((await starter(viewer)).status).toBe(403);
    expect((await starter(new Client())).status).toBe(401);
    expect((await starter(content)).status).toBe(201);
  });

  it("each starter is an ordinary banner: it can be edited, switched off and deleted like any other", async () => {
    const admin = await owner();
    await makeClass({ title_en: "Edit me" });
    await starter(admin);
    const [b] = await banners(admin);
    expect((await admin.patch(`/api/admin/banners/${b.id}`, { title_en: "Edited", theme: "ivory", active: false })).status).toBe(200);
    expect(sliderOf(await home())).not.toContain("Edited");
    expect((await admin.del(`/api/admin/banners/${b.id}`)).status).toBe(200);
    expect(await banners(admin)).toHaveLength(0);
    // a deleted one no longer counts: pressing again brings the class back
    expect(await json(await starter(admin))).toMatchObject({ created: 1 });
  });
});

describe("the first sentence of a description", () => {
  it("stops at the end of the sentence, in English or Bangla, flattens markup, and cuts a long one at a word with a mark", () => {
    expect(firstSentence("Learn baking. Then sell it.", 180)).toBe("Learn baking.");
    expect(firstSentence("ঘরে বসে শিখুন। তারপর বিক্রি করুন।", 180)).toBe("ঘরে বসে শিখুন।");
    expect(firstSentence("Is it **easy**? Yes.", 180)).toBe("Is it easy?");
    expect(firstSentence("No end mark here", 180)).toBe("No end mark here");
    expect(firstSentence("  \n ", 180)).toBe("");
    const long = firstSentence("word ".repeat(80).trim(), 60);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
    expect(long.slice(0, -1)).not.toMatch(/\s$/);
    expect(firstSentence("Version 2.5 is out. Next.", 180)).toBe("Version 2.5 is out."); // a full stop inside a number is not the end
  });
});
