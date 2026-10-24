import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiPost, PNG, useLang } from "./helpers";

/*
 * Admin → Banners. The owner could not upload a hero banner, a slider or an offer pop-up and give its button a link — there was
 * nowhere to do it. These tests do it the way the owner does (typing, uploading a picture, saving) and then look at the
 * website the way a visitor does: the slider moves and can be stopped, the pop-up comes after its pause, closes in every way
 * a person might try, stays closed, and comes back only when the owner edits it. Runs after the admin and student specs.
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
const drawer = () => admin.getByRole("dialog");

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  // When one test of this group fails, Playwright runs the whole group again from the top — with the banners of the first
  // attempt still in the database (the first test then found its row twice). So every attempt starts from an empty list.
  const left = await apiGet<{ items: { id: number }[] }>(admin, "/admin/banners?per_page=100");
  for (const b of left.items) await admin.evaluate((id) => fetch(`/api/admin/banners/${id}`, { method: "DELETE" }), b.id);
});
test.afterAll(async () => admin.context().close());

test("the owner adds a slider banner with a picture and a button — typing, uploading, saving — and sees it in the list", async () => {
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Banners", exact: true }).click();
  await expect(admin.getByRole("heading", { level: 1, name: "Banners" })).toBeVisible();
  await admin.getByRole("button", { name: "+ Add" }).click();

  // the pop-up settings are for pop-ups only
  await expect(drawer().getByLabel("Appears after (seconds)")).toHaveCount(0);

  await drawer().getByLabel("Picture", { exact: true }).setInputFiles({ name: "eid.png", mimeType: "image/png", buffer: PNG });
  await expect(drawer().locator(".thumb img").first()).toBeVisible();
  const typeInto = async (label: string, value: string) => {
    const field = drawer().getByLabel(label, { exact: true });
    await field.click();
    await field.pressSequentially(value, { delay: 15 });
    await expect(field).toHaveValue(value);
    await expect(field).toBeFocused();
  };
  await typeInto("Headline (বাংলা)", "ঈদ অফার: সব ক্লাসে ছাড়");
  await typeInto("Headline (English)", "Eid offer: save on every class");
  await typeInto("Short line (English)", "Learn baking at home — ends Friday");
  await typeInto("What the picture shows (English)", "Eid offer on all baking classes");
  await typeInto("Button label (English)", "See the classes");
  await typeInto("Button label (বাংলা)", "ক্লাসগুলো দেখুন");
  await typeInto("Where the button goes", "/courses/beginners-baking-class");
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();

  const row = admin.getByRole("row").filter({ hasText: "Eid offer: save on every class" });
  await expect(row).toContainText("Home page slider");
  await expect(row).toContainText("Live");
  await expect(row.locator("img")).toBeVisible();
  await expect(row).toContainText("See the classes → /courses/beginners-baking-class");

  // a second, words-only banner (the offer pop-up is created later, in its own test: it would cover the slider)
  await apiPost(admin, "/admin/banners", {
    placement: "hero", title_bn: "প্রথমবার বেকিং?", title_en: "New to baking? Start here", text_bn: "", text_en: "A free lesson, no sign-up", image_key: null, mobile_image_key: null,
    alt_bn: "", alt_en: "", button_bn: "", button_en: "Watch a free lesson", link_url: "/courses?level=beginner", new_tab: false, active: true, starts_at: null, ends_at: null, sort: 200,
    popup_delay_sec: 6, popup_repeat_days: 1, popup_pages: "home",
  });
});

test("choosing 'Offer pop-up' reveals the pop-up settings", async () => {
  await admin.goto("/admin/banners");
  await admin.getByRole("button", { name: "+ Add" }).click();
  await drawer().getByLabel("Where it shows").selectOption("popup");
  await expect(drawer().getByLabel("Appears after (seconds)")).toBeVisible();
  await expect(drawer().getByLabel("Ask again after (days)")).toBeVisible();
  await expect(drawer().getByLabel("Show on")).toBeVisible();
  await admin.keyboard.press("Escape");
});

test("a visitor sees the slider: arrows, dots and a pause button work, nothing moves for people who asked for less motion", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", reducedMotion: "reduce" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en");
  const slider = page.getByRole("region", { name: "Offers and announcements" });
  await expect(slider).toBeVisible();
  await expect(slider.getByRole("group")).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // the page keeps its own headline
  await expect(slider.getByText("Eid offer: save on every class")).toBeVisible();
  await expect(slider.getByRole("link", { name: "See the classes" })).toHaveAttribute("href", "/en/courses/beginners-baking-class");

  const dots = slider.getByRole("button", { name: /^Show banner/ });
  await expect(dots).toHaveCount(2);
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");
  await slider.getByRole("button", { name: "Next banner" }).click();
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(slider.getByText("New to baking? Start here")).toBeInViewport();
  await slider.getByRole("button", { name: "Previous banner" }).click();
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");
  await dots.nth(1).click();
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");

  // reduced motion: the slider does not move by itself, even after a long wait
  await page.waitForTimeout(7000);
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");

  // the button leads to the page the owner chose
  await slider.getByRole("link", { name: "Watch a free lesson" }).click();
  await expect(page).toHaveURL(/\/en\/courses\?level=beginner/);
  await ctx.close();
});

test("the slider moves by itself every few seconds and the pause button stops it", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", reducedMotion: "no-preference" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  // Time that moves only when this test moves it. (After install() alone the fake clock also follows the real one, so on a
  // busy machine the slider could move one extra time between two steps below and the test would see the wrong banner.)
  await page.clock.install({ time: new Date("2026-03-01T10:00:00+06:00") });
  await page.goto("/en");
  await page.clock.pauseAt(new Date("2026-03-01T10:00:05+06:00")); // still before the slider's first move
  const slider = page.getByRole("region", { name: "Offers and announcements" });
  const dots = slider.getByRole("button", { name: /^Show banner/ });
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");
  await page.clock.runFor(6200);
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
  await page.clock.runFor(6200);
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true"); // and round again
  const pause = slider.getByRole("button", { name: "Pause the slideshow" });
  await pause.click();
  await expect(slider.getByRole("button", { name: "Play the slideshow" })).toHaveAttribute("aria-pressed", "true");
  await page.clock.runFor(20_000);
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true"); // stopped
  await ctx.close();
});

test("the offer pop-up appears after its pause, closes every way a person tries, stays closed — and returns when the owner edits it", async ({ browser }) => {
  // an offer pop-up that appears one second after arrival (created now: while it exists it covers the page, as it should)
  const popup = await apiPost(admin, "/admin/banners", {
    placement: "popup", title_bn: "বিশেষ অফার", title_en: "Special offer", text_bn: "", text_en: "Use code WELCOME10 at checkout", image_key: null, mobile_image_key: null,
    alt_bn: "", alt_en: "", button_bn: "", button_en: "Take the offer", link_url: "/courses", new_tab: false, active: true, starts_at: null, ends_at: null, sort: 100,
    popup_delay_sec: 1, popup_repeat_days: 1, popup_pages: "home",
  });
  expect(popup.status).toBe(201);
  const ctx = await browser.newContext({ locale: "en-US", reducedMotion: "reduce" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en");
  const offer = page.getByRole("dialog", { name: "Special offer" });
  await expect(offer).toBeHidden(); // not at the first instant: visitors get a moment to look first
  await expect(offer).toBeVisible({ timeout: 6000 });
  await expect(offer.getByText("Use code WELCOME10 at checkout")).toBeVisible();
  await expect(offer.getByRole("link", { name: "Take the offer" })).toHaveAttribute("href", "/en/courses");
  await expect(offer.getByRole("button", { name: "Close" })).toBeFocused(); // the keyboard moves into the card

  // Escape closes it; reloading does not bring it back (it remembers for the owner's number of days)
  await page.keyboard.press("Escape");
  await expect(offer).toBeHidden();
  await page.reload();
  await page.waitForTimeout(2500);
  await expect(offer).toBeHidden();

  // the owner edits it: people who closed the old one see the new one
  const list = await apiGet<{ items: { id: number; placement: string }[] }>(admin, "/admin/banners?placement=popup");
  const id = list.items[0].id;
  const patched = await admin.evaluate(async (bid) => (await fetch(`/api/admin/banners/${bid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text_en: "Now 15% off — use code WELCOME10" }) })).status, id);
  expect(patched).toBe(200);
  await page.reload();
  await expect(offer).toBeVisible({ timeout: 6000 });
  await expect(offer.getByText("Now 15% off")).toBeVisible();

  // "No, thanks" and the dark area around the card also close it
  await offer.getByRole("button", { name: "No, thanks" }).click();
  await expect(offer).toBeHidden();

  // it is only for the home page (the owner chose that), never for a class page
  await page.goto("/en/courses/beginners-baking-class");
  await page.waitForTimeout(2500);
  await expect(page.getByRole("dialog", { name: "Special offer" })).toHaveCount(0);
  await ctx.close();
});

test("the offer pop-up passes the accessibility audit while open and keeps a phone page from scrolling sideways", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", reducedMotion: "reduce", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en");
  const offer = page.getByRole("dialog", { name: "Special offer" });
  await expect(offer).toBeVisible({ timeout: 6000 });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  await offer.getByRole("button", { name: "No, thanks" }).click();
  await expect(offer).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const axe2 = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe2.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  await ctx.close();
});

test("the on/off switch in the list takes a banner off the website at once, and putting it back works", async ({ browser }) => {
  await admin.goto("/admin/banners");
  const row = admin.getByRole("row").filter({ hasText: "Special offer" });
  const toggle = row.getByRole("switch");
  await expect(toggle).toBeChecked();
  await row.locator("label.switch").click();
  await expect(toggle).not.toBeChecked();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await expect(row).toContainText("Switched off");

  const ctx = await browser.newContext({ locale: "en-US", reducedMotion: "reduce" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en");
  await page.waitForTimeout(2500);
  await expect(page.getByRole("dialog", { name: "Special offer" })).toHaveCount(0);
  await ctx.close();

  await row.locator("label.switch").click();
  await expect(toggle).toBeChecked();
});
