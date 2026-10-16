import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiPost, photoPng, useLang } from "./helpers";

/*
 * More than one picture for a class, as the owner and a visitor meet it. The owner uploads several pictures at once on the class's
 * Pictures tab (each is shrunk in the browser into a large and a small copy), writes captions, moves and removes them; a visitor sees
 * the pictures under the main one, opens them large, moves with the arrows, the buttons or a swipe, and gets back to where they were.
 * Without a script the pictures are plain links to the picture itself. Runs after the admin spec (the owner exists).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
let courseId = 0;
let slug = "";
const TITLE_EN = "Gallery Class E2E";
const TITLE_BN = "ছবির ক্লাস";

type Pic = { id: number; image_key: string; thumb_key: string | null; caption_bn: string; caption_en: string };
const pictures = async () => (await apiGet<{ items: Pic[]; max: number }>(admin, `/admin/courses/${courseId}/images`)).items;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  const made = await apiPost(admin, "/admin/courses", {
    title_bn: TITLE_BN,
    title_en: TITLE_EN,
    short_bn: "",
    short_en: "A class with pictures.",
    long_bn: "",
    long_en: "",
    banner_key: null,
    icon: "cake",
    category_id: null,
    instructor_id: null,
    level: null,
    price: 650,
    status: "published",
    details_url: null,
    featured: false,
    cert_enabled: true,
    seo_title_bn: "",
    seo_title_en: "",
    seo_desc_bn: "",
    seo_desc_en: "",
    sort: 100,
    launch_at: null,
  });
  expect(made.status).toBe(201);
  courseId = made.body.item.id;
  slug = made.body.item.slug;
});
test.afterAll(async () => admin.context().close());

test("the owner adds a main picture and three more at once, writes captions, moves one and removes one", async () => {
  await admin.goto(`/admin/courses/${courseId}/edit`);
  await admin.getByLabel("Banner picture").setInputFiles({ name: "main.png", mimeType: "image/png", buffer: photoPng(1280, 800, 9) });
  await expect(admin.locator(".image-field .thumb img")).toBeVisible();
  await admin.getByRole("button", { name: "Save" }).click();
  // a published class with no lessons asks first (this one only needs its pictures)
  await admin.getByRole("alertdialog").getByRole("button", { name: "Publish anyway" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();

  // the Pictures tab: nothing yet, and no Save button for the Details form (every change here saves by itself)
  await admin.getByRole("tab", { name: /Pictures/ }).click();
  await expect(admin.getByRole("heading", { name: "No extra pictures yet" })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(admin.getByText("room for 12 more, 12 at most")).toBeVisible();

  // three pictures chosen at once
  await admin.getByLabel("Add pictures").setInputFiles([1, 2, 3].map((n) => ({ name: `shot-${n}.png`, mimeType: "image/png", buffer: photoPng(1800, 1200, n) })));
  await expect(admin.getByText("3 picture(s) added.")).toBeVisible({ timeout: 45_000 });
  await expect(admin.locator(".pic-row")).toHaveCount(3);
  await expect(admin.getByRole("tab", { name: /Pictures/ })).toContainText("3");

  // each was stored twice — a large copy for the viewer and a small one for the grid — and both are really served
  const first = await pictures();
  expect(first).toHaveLength(3);
  for (const p of first) {
    expect(p.image_key).toMatch(/^gallery\/[a-f0-9]{32}\.webp$/);
    expect(p.thumb_key).toMatch(/^gallery\/[a-f0-9]{32}\.webp$/);
    expect(p.thumb_key).not.toBe(p.image_key);
    const large = await admin.request.get(`/media/${p.image_key}`);
    const small = await admin.request.get(`/media/${p.thumb_key}`);
    expect(large.status()).toBe(200);
    expect(small.status()).toBe(200);
    expect((await small.body()).length).toBeLessThan((await large.body()).length);
  }

  // captions in both languages, typed key by key: the caret never leaves the box, and Save is only on when something changed
  const row = (n: number) => admin.locator(".pic-row").nth(n - 1);
  await expect(row(1).getByRole("button", { name: "Save" })).toBeDisabled();
  await row(1).getByLabel(/^Caption \(Bangla\)/).pressSequentially("আমাদের রান্নাঘর", { delay: 4 });
  await row(1).getByLabel(/^Caption \(English\)/).pressSequentially("Our kitchen", { delay: 4 });
  await expect(row(1).getByLabel(/^Caption \(English\)/)).toHaveValue("Our kitchen");
  await expect(row(1).getByRole("button", { name: "Save" })).toBeEnabled();
  await row(1).getByRole("button", { name: "Save" }).click();
  await expect(row(1).getByRole("button", { name: "Save" })).toBeDisabled(); // saved: nothing left to save
  await row(3).getByLabel(/^Caption \(English\)/).fill("Third one");
  await row(3).getByRole("button", { name: "Save" }).click();
  await expect(row(3).getByRole("button", { name: "Save" })).toBeDisabled();
  expect((await pictures()).map((p) => p.caption_en)).toEqual(["Our kitchen", "", "Third one"]);
  expect((await pictures())[0].caption_bn).toBe("আমাদের রান্নাঘর");

  // the first goes one place down, the third is removed after the owner is asked
  await expect(row(1).getByRole("button", { name: "Move up (1)" })).toBeDisabled();
  await expect(row(3).getByRole("button", { name: "Move down (3)" })).toBeDisabled();
  await row(1).getByRole("button", { name: "Move down (1)" }).click();
  await expect(row(2).getByLabel(/^Caption \(English\)/)).toHaveValue("Our kitchen");
  expect((await pictures()).map((p) => p.caption_en)).toEqual(["", "Our kitchen", "Third one"]);
  await row(3).getByRole("button", { name: "Delete (3)" }).click();
  const ask = admin.getByRole("alertdialog");
  await expect(ask).toContainText("Remove this picture?");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(admin.locator(".pic-row")).toHaveCount(3); // cancelling changes nothing
  await row(3).getByRole("button", { name: "Delete (3)" }).click();
  await ask.getByRole("button", { name: "Delete" }).click();
  await expect(admin.locator(".pic-row")).toHaveCount(2);
  expect((await pictures()).map((p) => p.caption_en)).toEqual(["", "Our kitchen"]);
  await expect(admin.getByRole("tab", { name: /Pictures/ })).toContainText("2");
});

test("a visitor sees the pictures under the main one, opens them large, moves with arrows and buttons, and Escape brings them back where they were", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(`/en/courses/${slug}`);
  const items = page.locator(".gal-grid a");
  await expect(items).toHaveCount(2);
  await expect(page.getByRole("link", { name: "See all 3 pictures of this class" })).toBeVisible();
  const dialog = page.locator("dialog.lb");
  await expect(dialog).toBeHidden();

  // the second picture has a caption: opened large, with the position and the caption, and the large copy (not the small one)
  await items.nth(1).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-lb-count]")).toHaveText("3 of 3");
  await expect(dialog.locator("[data-lb-cap]")).toHaveText("Our kitchen");
  const thumbs = await items.evaluateAll((els) => els.map((a) => a.querySelector("img")?.getAttribute("src")));
  const large = await dialog.locator("[data-lb-img]").getAttribute("src");
  expect(large).toMatch(/^\/media\/gallery\/[a-f0-9]{32}\.webp$/);
  expect(thumbs[1]).not.toBe(large);
  await expect(dialog.locator("[data-lb-img]")).toHaveAttribute("alt", "Our kitchen");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden"); // the page behind does not scroll

  // the arrows go round: after the last comes the main picture (no caption → no empty line), then the others again
  await page.keyboard.press("ArrowRight");
  await expect(dialog.locator("[data-lb-count]")).toHaveText("1 of 3");
  await expect(dialog.locator("[data-lb-cap]")).toBeHidden();
  expect(await dialog.locator("[data-lb-img]").getAttribute("src")).toMatch(/^\/media\/banners\//);
  await page.keyboard.press("ArrowRight");
  await expect(dialog.locator("[data-lb-count]")).toHaveText("2 of 3");
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.locator("[data-lb-count]")).toHaveText("1 of 3");
  await dialog.getByRole("button", { name: "Next picture" }).click();
  await expect(dialog.locator("[data-lb-count]")).toHaveText("2 of 3");
  await dialog.getByRole("button", { name: "Previous picture" }).click();
  await expect(dialog.locator("[data-lb-count]")).toHaveText("1 of 3");

  // the keyboard cannot wander off behind the viewer
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog.lb"))).toBe(true);
  }

  // Escape closes it, the page scrolls again, and the picture that was opened has the focus
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.classList.contains("lb-open"))).toBe(false);
  await expect(items.nth(1)).toBeFocused();

  // the main picture opens the viewer too; the close button and the dark area around the picture close it
  await page.locator(".gal-main").click();
  await expect(dialog.locator("[data-lb-count]")).toHaveText("1 of 3");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await items.nth(0).click();
  await expect(dialog.locator("[data-lb-count]")).toHaveText("2 of 3");
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();

  // "open in a new tab" is left alone: a modified click does not open the viewer
  await items.nth(0).click({ modifiers: ["Shift"] }).catch(() => undefined);
  await expect(dialog).toBeHidden();
  await ctx.close();
});

test("without a script every picture is a plain link to the picture itself", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`/en/courses/${slug}`);
  const hrefs = await page.locator("[data-gallery-item]").evaluateAll((els) => els.map((a) => a.getAttribute("href")));
  expect(hrefs).toHaveLength(3); // the main picture and the two others
  for (const href of hrefs) {
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^image\//);
  }
  await expect(page.locator("dialog.lb")).toBeHidden();
  await page.locator(".gal-grid a").first().click();
  await expect(page).toHaveURL(/\/media\/gallery\/[a-f0-9]{32}\.webp$/);
  await ctx.close();
});

test("in Bangla on a 360 px phone the grid fits, the viewer fits, a swipe turns the page, and nothing fails the accessibility scan", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`/courses/${slug}`);
  const items = page.locator(".gal-grid a");
  await expect(items).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // Bangla digits and words; the caption in Bangla where the owner wrote one, a plain description where not
  await expect(items.nth(0).locator("img")).toHaveAttribute("alt", `${TITLE_BN} — ৩টির মধ্যে ২ নং ছবি`);
  await expect(items.nth(1).locator("img")).toHaveAttribute("alt", "আমাদের রান্নাঘর");
  await expect(page.getByRole("link", { name: "এই ক্লাসের সব ৩টি ছবি দেখুন" })).toBeVisible();

  const scan = async (label: string) => {
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`), label).toEqual([]);
  };
  await scan("the class page with its pictures");

  await items.nth(0).scrollIntoViewIfNeeded();
  await items.nth(0).tap();
  const dialog = page.locator("dialog.lb");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-lb-count]")).toHaveText("৩টির মধ্যে ২");
  // everything of the viewer is inside the screen: the picture, the two arrows and the close button
  for (const part of [dialog.locator("[data-lb-img]"), dialog.locator("[data-lb-prev]"), dialog.locator("[data-lb-next]"), dialog.locator("[data-lb-close]")]) {
    const box = (await part.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360.5);
    expect(box.y + box.height).toBeLessThanOrEqual(740.5);
  }
  await scan("the viewer is open");

  // a swipe to the left shows the next picture, a swipe to the right the one before (a short drag does nothing)
  const swipe = (fromX: number, toX: number) =>
    page.evaluate(
      ([a, b]) => {
        const box = document.querySelector("dialog.lb")!;
        const touch = (x: number) => new Touch({ identifier: 1, target: box, clientX: x, clientY: 300 });
        box.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch(a)], changedTouches: [touch(a)] }));
        box.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [touch(b)] }));
      },
      [fromX, toX],
    );
  await swipe(300, 120);
  await expect(dialog.locator("[data-lb-count]")).toHaveText("৩টির মধ্যে ৩");
  await expect(dialog.locator("[data-lb-cap]")).toHaveText("আমাদের রান্নাঘর");
  await swipe(150, 130);
  await expect(dialog.locator("[data-lb-count]")).toHaveText("৩টির মধ্যে ৩");
  await swipe(100, 280);
  await expect(dialog.locator("[data-lb-count]")).toHaveText("৩টির মধ্যে ২");
  await dialog.getByRole("button", { name: "বন্ধ করুন" }).click();
  await expect(dialog).toBeHidden();
  await ctx.close();
});

test("a class that has no extra pictures is not changed at all", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto("/en/courses/beginners-baking-class");
  await expect(page.locator(".gal-grid")).toHaveCount(0);
  await expect(page.locator("dialog.lb")).toHaveCount(0);
  expect(await page.locator('script[src*="/assets/gallery."]').count()).toBe(0);
  await ctx.close();
});
