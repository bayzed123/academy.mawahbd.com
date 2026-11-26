import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiSend, useLang } from "./helpers";

/*
 * The academy's own ads, in a real browser: the owner makes one in Admin → Banners ("Ad on class pages & blog") — a wide picture, a phone
 * picture, the page it opens, the kinds of page — and every class page and every blog post shows it by itself, whole, as a link; a phone
 * gets the phone picture. With two ads, a long post shows both, never the same one twice. Set SHOTS_DIR to keep pictures.
 * Runs after the admin spec; its ads and its post are deleted again at the end.
 */
test.describe.configure({ mode: "serial" });

const CLASS = "beginners-baking-class";
// a new post each run (a deleted post keeps its address, and a retry would find it taken)
const POST = `ads-e2e-${Date.now().toString(36)}`;
const shots = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string, sel: string) => {
  if (!shots) return;
  await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/${name}.png` });
};

/** A banner picture like one the owner would make (drawn here, so the test needs no file): dark, an orange edge, a headline and a button. */
async function picture(page: Page, w: number, h: number, head: string, sub: string): Promise<Buffer> {
  const data = await page.evaluate(
    ([w, h, head, sub]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.fillStyle = "#151515";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#ff6b00";
      g.fillRect(0, 0, Math.round(w * 0.015), h);
      g.fillStyle = "#ffffff";
      g.font = `700 ${Math.round(h * 0.17)}px sans-serif`;
      g.fillText(head, w * 0.05, h * 0.4);
      g.fillStyle = "#ffa47a";
      g.font = `600 ${Math.round(h * 0.1)}px sans-serif`;
      g.fillText(sub, w * 0.05, h * 0.62);
      g.fillStyle = "#ff6b00";
      g.fillRect(w * 0.05, h * 0.72, w * 0.26, h * 0.17);
      g.fillStyle = "#000000";
      g.font = `700 ${Math.round(h * 0.08)}px sans-serif`;
      g.fillText("Enroll now →", w * 0.07, h * 0.835);
      return c.toDataURL("image/png").split(",")[1];
    },
    [w, h, head, sub] as const,
  );
  return Buffer.from(data, "base64");
}

let admin: Page;
const drawer = () => admin.getByRole("dialog");
const removeAds = async () => {
  const left = await apiGet<{ items: { id: number }[] }>(admin, "/admin/banners?per_page=100&placement=ad");
  for (const b of left.items) await admin.evaluate((id) => fetch(`/api/admin/banners/${id}`, { method: "DELETE" }), b.id);
};
const removePost = async () => {
  const posts = await apiGet<{ items: { id: number; slug: string }[] }>(admin, "/admin/blog?per_page=100");
  for (const p of posts.items.filter((x) => x.slug.startsWith("ads-e2e-"))) await admin.evaluate((id) => fetch(`/api/admin/blog/${id}`, { method: "DELETE" }), p.id);
};

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  await removeAds();
  await removePost();
  // a long post: nine paragraphs and a heading — written once; every post gets the ads by itself
  const body = Array.from({ length: 9 }, (_, i) => (i === 3 ? "## The oven" : `Paragraph ${i + 1}: soft sponge, step by step, the way we teach it in class.`)).join("\n\n");
  const res = await apiSend(admin, "POST", "/admin/blog", {
    slug: POST, title_bn: "নরম স্পঞ্জ কেক", title_en: "A soft sponge cake", excerpt_bn: "", excerpt_en: "", body_bn: body, body_en: body, cover_key: null, tags: "",
    status: "published", seo_title_bn: "", seo_title_en: "", seo_desc_bn: "", seo_desc_en: "", published_at: null,
  });
  expect(res.status).toBe(201);
});
test.afterAll(async () => {
  await removeAds();
  await removePost();
  await admin.context().close();
});

test("the owner makes an ad: a wide picture, a phone picture, the page it opens and where it shows — nothing else to fill in", async () => {
  await admin.goto("/admin/banners");
  await admin.getByRole("button", { name: "+ Add" }).click();
  await drawer().getByLabel("Where it shows").selectOption({ label: "Ad on class pages & blog" });
  // only what an ad needs: no headline, no button, no design
  await expect(drawer().getByLabel("Headline (English)", { exact: true })).toHaveCount(0);
  await expect(drawer().getByLabel("Button label (English)", { exact: true })).toHaveCount(0);
  await expect(drawer().getByText("Best size 1200 × 300 px")).toBeVisible();
  await expect(drawer().getByText("Best size 800 × 400 px")).toBeVisible();
  // every kind of page is ticked to begin with
  const spots = drawer().getByRole("group", { name: "Show it on" });
  for (const name of ["Every class page", "Every blog post", "The blog’s list of posts", "The lists of classes"]) await expect(spots.getByRole("checkbox", { name: new RegExp(name) })).toBeChecked();

  await drawer().getByLabel("Picture *", { exact: true }).setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: await picture(admin, 1200, 300, "Eid offer: 20% off baking", "Every baking class, this week only") });
  await drawer().getByLabel("Phone picture (optional)").setInputFiles({ name: "phone.png", mimeType: "image/png", buffer: await picture(admin, 800, 400, "Eid: 20% off", "Baking classes") });
  await expect(drawer().locator(".thumb img")).toHaveCount(2);
  await drawer().getByLabel("What the picture shows (English)").fill("Eid offer: 20% off every baking class");
  // the preview shows the picture as the class page will: whole, wide
  const pv = drawer().frameLocator(".bn-frame").locator(".pv-ad img");
  await expect(pv).toHaveAttribute("alt", "Eid offer: 20% off every baking class");
  await expect.poll(() => pv.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1200);
  if (shots) {
    await drawer().locator(".bn-preview").scrollIntoViewIfNeeded();
    await drawer().locator(".bn-preview").screenshot({ path: `${shots}/ads-admin-preview.png` });
  }
  // the page it opens is needed
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(drawer().getByText("This field is required.")).toBeVisible();
  await drawer().getByLabel("Page the ad opens *").fill("/free-classes");
  if (shots) await drawer().screenshot({ path: `${shots}/ads-admin.png` });
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  const row = admin.getByRole("row").filter({ hasText: "/free-classes" });
  await expect(row).toContainText("Ad on class pages & blog");
  await expect(row).toContainText("Live");
});

test("every class page shows it under “About this class”, whole, as a link to the page it opens; a phone gets the phone picture", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto(`/en/courses/${CLASS}`);
  const ad = page.locator(".ad-slot .ad:visible");
  await ad.scrollIntoViewIfNeeded();
  await expect(ad).toBeVisible();
  await expect(ad.getByRole("img", { name: "Eid offer: 20% off every baking class" })).toBeVisible();
  // the whole picture, in its own shape (4:1), not cut
  const box = (await ad.locator("img").boundingBox())!;
  expect(Math.round(box.width / box.height)).toBe(4);
  expect(await ad.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200);
  const axe = await new AxeBuilder({ page }).include(".ad-slot").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await shot(page, "ads-class-page", ".ad-slot");
  await ad.click();
  await expect(page).toHaveURL(/\/en\/free-classes$/);
  // and the lists of classes have it too
  await expect(page.locator(".ad-slot .ad:visible")).toHaveCount(1);
  await ctx.close();

  const phone = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  await useLang(phone, "bn");
  const p = await phone.newPage();
  await p.goto(`/courses/${CLASS}`);
  const img = p.locator(".ad-slot .ad:visible img");
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.currentSrc && i.naturalWidth)).toBe(800); // the phone picture
  const pb = (await img.boundingBox())!;
  expect(Math.round(pb.width / pb.height)).toBe(2);
  expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await shot(p, "ads-class-phone", ".ad-slot");
  await phone.close();
});

test("every blog post shows it by itself — in the middle of a long post — and the blog's list too", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto(`/en/blog/${POST}`);
  const slots = page.locator(".ad-slot");
  await expect(slots).toHaveCount(1);
  // after paragraph 3, before the heading that follows it
  const order = await page.evaluate(() => {
    const at = (el: Element | null) => (el ? Array.from(document.querySelectorAll("p, h3, aside.ad-slot")).indexOf(el) : -1);
    const p3 = Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.startsWith("Paragraph 3:")) ?? null;
    return { p3: at(p3), ad: at(document.querySelector("aside.ad-slot")), h: at(Array.from(document.querySelectorAll("h3")).find((h) => h.textContent === "The oven") ?? null) };
  });
  expect(order.p3).toBeLessThan(order.ad);
  expect(order.ad).toBeLessThan(order.h);
  await shot(page, "ads-blog-post", ".ad-slot");

  await page.goto("/en/blog");
  await expect(page.locator(".ad-slot .ad:visible")).toHaveCount(1);
  await ctx.close();
});

test("with two ads, a long post shows both — one in the middle, the other at the end — never the same one twice", async ({ browser }) => {
  const first = await apiGet<{ items: { image_key: string }[] }>(admin, "/admin/banners?per_page=100&placement=ad");
  const res = await apiSend(admin, "POST", "/admin/banners", {
    placement: "ad", title_bn: "", title_en: "", text_bn: "", text_en: "", image_key: first.items[0].image_key, mobile_image_key: null, alt_bn: "", alt_en: "All our classes",
    button_bn: "", button_en: "", link_url: "/courses", new_tab: false, active: true, starts_at: null, ends_at: null, sort: 200, popup_delay_sec: 6, popup_repeat_days: 1,
    popup_pages: "home", ad_spots: ["blog"],
  });
  expect(res.status).toBe(201);
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  for (let n = 0; n < 3; n++) {
    await page.goto(`/en/blog/${POST}`);
    await expect(page.locator(".ad-slot")).toHaveCount(2);
    const shown = await page.locator(".ad-slot .ad:visible").evaluateAll((els) => els.map((e) => e.getAttribute("data-ad")));
    expect(shown).toHaveLength(2);
    expect(new Set(shown).size).toBe(2);
  }
  await ctx.close();
});
