import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiPost, registerStudent, useLang } from "./helpers";

/* Phones first: most students in Bangladesh arrive on a ~360px-wide Android. Nothing may scroll sideways or hide behind other UI. */
test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

const noSidewaysScroll = async (page: import("@playwright/test").Page, label: string) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
};

test("public pages fit a 360px phone, in both languages", async ({ page }) => {
  for (const path of ["/", "/en", "/courses", "/en/courses", "/courses/beginners-baking-class", "/contact", "/about", "/blog", "/verify"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBeLessThan(400);
    await noSidewaysScroll(page, path);
  }
});

test("class list: category chips stay on one scrollable row and every card keeps a 44px tap target", async ({ page }) => {
  await page.goto("/courses");
  const pills = page.locator(".pills");
  const box = await pills.boundingBox();
  expect(box!.height).toBeLessThan(80); // one row, not a wrapped block that jumps when fonts load
  for (const sel of [".card .btn", ".pill", ".lang-toggle", ".menu-btn"]) {
    for (const el of await page.locator(sel).all()) {
      if (!(await el.isVisible())) continue;
      const b = await el.boundingBox();
      expect(b!.height, `${sel} is too short to tap`).toBeGreaterThanOrEqual(40);
    }
  }
});

test("class page: the buy bar is reachable, the price is real, and axe finds nothing serious", async ({ page }) => {
  await useLang(page.context(), "en");
  await page.goto("/en/courses/beginners-baking-class");
  await expect(page.getByRole("link", { name: /Enroll Now/ }).first()).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("student app on a phone: bottom tab bar, no overlap with the chat button, no sideways scroll", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  await expect(page.locator(".tabbar")).toBeVisible();
  await noSidewaysScroll(page, "/app/");
  const bar = (await page.locator(".tabbar").boundingBox())!;
  const launcher = await page.locator(".mc-launch").boundingBox();
  if (launcher) expect(launcher.y + launcher.height, "chat launcher overlaps the tab bar").toBeLessThanOrEqual(bar.y + 1);
  for (const path of ["/app/orders", "/app/profile", "/app/certificates", "/app/checkout?c=beginners-baking-class"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await noSidewaysScroll(page, path);
  }
  await ctx.close();
});

test("manual payment on a phone: the pay screen and the waiting screen fit in both languages, with nothing serious for axe", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  const started = await apiPost(page, "/checkout", { agree: true, courses: ["beginners-baking-class"], channel: "manual", manual: { method: "bkash", payer_number: "01712345678" } });
  expect(started.status).toBe(201);
  const id: string = started.body.order.public_id;
  for (const lang of ["en", "bn"]) {
    await page.evaluate((l) => localStorage.setItem("mawah_lang", l), lang);
    await page.goto(`/app/orders/${id}`);
    await expect(page.getByRole("timer")).toBeVisible();
    await noSidewaysScroll(page, `the pay screen (${lang})`);
    // the long Bangla buttons must wrap, not push the page sideways
    for (const button of await page.locator(".pay-panel .btn").all()) {
      const box = await button.boundingBox();
      if (box) expect(box.x + box.width, `a button runs off the right edge (${lang})`).toBeLessThanOrEqual(360);
    }
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  }
  // after the TrxID is sent, the waiting screen
  const sent = await apiPost(page, `/checkout/${id}/proof`, { trx_id: "PHONE12345" });
  expect(sent.status).toBe(200);
  for (const lang of ["en", "bn"]) {
    await page.evaluate((l) => localStorage.setItem("mawah_lang", l), lang);
    await page.goto(`/app/orders/${id}`);
    await expect(page.locator(".sent-list")).toBeVisible();
    await noSidewaysScroll(page, `the waiting screen (${lang})`);
  }
  await ctx.close();
});

test("admin on a phone: login and the dashboard are usable", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await adminLogin(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(", Owner");
  await noSidewaysScroll(page, "/admin/");
  for (const path of ["/admin/courses", "/admin/orders", "/admin/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await noSidewaysScroll(page, path);
  }
  await ctx.close();
});
