import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, agree, apiGet, apiPost, registerStudent, useLang } from "./helpers";

/*
 * The owner's request: a "Free class" button in the header beside the day / night switch that shows every free class; after enrolling, the
 * student's page has the paid courses and the free classes under separate buttons; and the lesson page laid out like YouTube — the video,
 * then the way to the next part, then every lesson in one sideways row, the lesson's words folded below. Runs after the admin spec (the
 * owner exists).
 */
const noSidewaysScroll = async (page: Page, label: string) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
};
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => v.id);

test("the Free classes button sits beside night / day on a desktop, a laptop and a 360 px phone, and opens every free class", async ({ browser }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1180, height: 800 }, { width: 360, height: 740 }]) {
    for (const lang of ["bn", "en"] as const) {
      const ctx = await browser.newContext({ viewport, locale: lang === "en" ? "en-US" : "bn-BD" });
      await useLang(ctx, lang);
      const page = await ctx.newPage();
      const where = `${lang} at ${viewport.width}px`;
      await page.goto(lang === "en" ? "/en" : "/");
      const btn = page.locator(".nav-actions .free-btn");
      await expect(btn, where).toBeVisible();
      await expect(btn, where).toContainText(lang === "en" ? "Free classes" : "ফ্রি ক্লাস");
      const b = (await btn.boundingBox())!;
      const theme = (await page.locator(".nav-actions .theme-toggle").boundingBox())!;
      expect(b.height, `${where}: the button is too short to tap`).toBeGreaterThanOrEqual(44);
      // on the same line as the night / day switch, right before it, and the header stays one row
      expect(Math.abs(b.y + b.height / 2 - (theme.y + theme.height / 2)), where).toBeLessThan(3);
      expect(theme.x - (b.x + b.width), where).toBeGreaterThanOrEqual(0);
      expect(theme.x - (b.x + b.width), where).toBeLessThan(16);
      expect((await page.locator(".site-header").boundingBox())!.height, `${where}: the header wraps`).toBeLessThan(90);
      await noSidewaysScroll(page, where);
      // signed in, the header's button says "My Learning" (longer than "Log in", in Bangla especially): it still fits
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>("[data-guest]").forEach((e) => (e.hidden = true));
        document.querySelectorAll<HTMLElement>("[data-user]").forEach((e) => (e.hidden = false));
      });
      await noSidewaysScroll(page, `${where}, signed in`);

      await btn.click();
      await expect(page).toHaveURL(lang === "en" ? /\/en\/free-classes$/ : /\/free-classes$/);
      await expect(page.getByRole("heading", { level: 1, name: lang === "en" ? "Free classes" : "ফ্রি ক্লাস" })).toBeVisible();
      await expect(page.locator("#free")).toContainText(lang === "en" ? "Free Taster Class" : "ফ্রি টেস্টার ক্লাস");
      await noSidewaysScroll(page, `${where} /free-classes`);
      if (viewport.width === 360 && lang === "bn") expect(await serious(page)).toEqual([]);
      await ctx.close();
    }
  }
});

test("after enrolling, My Learning keeps paid classes and free classes under separate buttons", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  // a free class: enrolled in one click
  await page.goto("/app/checkout?c=free-taster-class");
  await agree(page);
  await page.getByRole("button", { name: "Enroll for free" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  // a paid class, given by the owner (paid in cash, say)
  const me = (await apiGet<{ student: { id: number } }>(page, "/auth/me")).student.id;
  const adminCtx = await browser.newContext({ locale: "en-US" });
  await useLang(adminCtx, "en");
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  const paid = (await (await admin.request.get("/api/courses/beginners-baking-class")).json()).course as { id: number };
  expect((await apiPost(admin, `/admin/students/${me}/enroll`, { course_ids: [paid.id] })).status).toBe(200);
  await adminCtx.close();

  await page.goto("/app/");
  const tabs = page.getByRole("tablist", { name: "Which classes" });
  const paidTab = tabs.getByRole("tab", { name: /Paid classes/ });
  const freeTab = tabs.getByRole("tab", { name: /Free classes/ });
  await expect(paidTab).toHaveAttribute("aria-selected", "true");
  await expect(paidTab).toContainText("1");
  await expect(freeTab).toContainText("1");
  const panel = page.getByRole("tabpanel");
  await expect(panel).toContainText("Beginners Baking Class");
  await expect(panel).not.toContainText("Free Taster Class");

  await freeTab.click();
  await expect(page).toHaveURL(/\/app\/?\?tab=free$/);
  await expect(freeTab).toHaveAttribute("aria-selected", "true");
  await expect(panel).toContainText("Free Taster Class");
  await expect(panel.locator(".chip-free")).toHaveText("Free");
  await expect(panel).not.toContainText("Beginners Baking Class");
  expect(await serious(page)).toEqual([]);

  // the arrow keys move between the two buttons, as a tab list should
  await freeTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(paidTab).toHaveAttribute("aria-selected", "true");
  await expect(paidTab).toBeFocused();
  // the address keeps the choice: a reload opens the same one
  await freeTab.click();
  await page.reload();
  await expect(page.getByRole("tab", { name: /Free classes/ })).toHaveAttribute("aria-selected", "true");

  // the header has the button too, beside night / day
  await expect(page.locator(".app-header .free-btn")).toHaveAttribute("href", "/en/free-classes");

  // ---- the lesson page, like a video site
  await page.goto("/app/learn/beginners-baking-class");
  await page.getByRole("link", { name: "Meet your oven and tools" }).first().click();
  await expect(page.locator(".watch-part")).toContainText("Part 1 of 4");
  const rail = page.getByRole("region", { name: "Lessons in this class" });
  await expect(rail.getByRole("listitem")).toHaveCount(4);
  await expect(rail.getByRole("link", { name: /Meet your oven and tools/ })).toHaveAttribute("aria-current", "page");
  // the lessons come before the lesson's words, right under the video and its buttons
  const order = await page.evaluate(() => {
    const at = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top;
    return { head: at(".watch-head"), rail: at(".rail-box"), words: at(".desc-box") };
  });
  expect(order.head).toBeLessThan(order.rail);
  expect(order.rail).toBeLessThan(order.words);
  const about = page.getByRole("region", { name: "About this lesson" });
  await expect(about).toContainText("What you need");
  const more = about.getByRole("button", { name: "Show more" });
  if (await more.isVisible()) {
    await more.click();
    await expect(about.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  }
  expect(await serious(page)).toEqual([]);

  // "Next part" goes on and counts this one as done
  await page.getByRole("link", { name: "Next part" }).click();
  await expect(page.locator(".watch-part")).toContainText("Part 2 of 4");
  await expect(rail.getByRole("link", { name: /Measuring and ratios/ })).toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("link", { name: /Meet your oven and tools \(Completed\)/ })).toBeVisible();
  await expect(page.getByText("Next part: Vanilla sponge cake")).toBeVisible();

  // a phone: nothing scrolls sideways but the row of lessons itself
  await page.setViewportSize({ width: 360, height: 740 });
  await noSidewaysScroll(page, "the lesson page on a phone");
  const scrolls = await page.locator(".rail").evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrolls).toBe(true);
  await ctx.close();
});
