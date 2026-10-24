import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, useLang } from "./helpers";

/*
 * Runs after spec 03, where a student finished a lesson and left a 5-star review that waits for approval.
 * The owner asked why ratings and reviews were not visible. This follows one review from "waiting" to every place a
 * visitor can see it, and checks the honest states on the way: nothing is shown (or invented) before approval, and the
 * page always offers a clear way to write one.
 */
/** The structured data (JSON-LD) a search engine reads from the page. */
const structuredData = (page: Page) => page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map((el) => el.textContent ?? "").join("\n"));

test("a review goes from 'waiting' to the class page, the class list and the instructor badge — and never earlier", async ({ browser }) => {
  const visitorCtx = await browser.newContext({ locale: "en-US" });
  await useLang(visitorCtx, "en");
  const visitor = await visitorCtx.newPage();

  // 1. before approval: an honest empty state with a clear call to action, and no stars on the title line
  await visitor.goto("/en/courses/beginners-baking-class");
  const reviews = visitor.locator("#reviews");
  await expect(reviews.getByRole("heading", { name: "No reviews yet" })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Be the first to rate" })).toHaveAttribute("href", "#reviews");
  const write = reviews.getByRole("link", { name: "Be the first to review" });
  await expect(write).toHaveAttribute("href", "/app/review/beginners-baking-class");
  await expect(visitor.locator("body")).not.toContainText("Clear and easy to follow.");
  expect(await structuredData(visitor)).not.toContain("aggregateRating");

  // the button leads somewhere real: a visitor is asked to log in, then lands on the review page
  await write.click();
  await expect(visitor).toHaveURL(/\/app\/login/);

  // 2. the owner approves the review on the Reviews screen
  const adminCtx = await browser.newContext({ locale: "en-US" });
  await useLang(adminCtx, "en");
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Reviews", exact: true }).click();
  const row = admin.getByRole("row").filter({ hasText: "Clear and easy to follow." });
  await expect(row).toContainText("Pending");
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await expect(row).toContainText("Approved");

  // 3. now every public place shows the same real numbers
  await visitor.goto("/en/courses/beginners-baking-class");
  await expect(visitor.locator("#reviews")).toContainText("Clear and easy to follow.");
  await expect(visitor.locator("#reviews")).toContainText("Based on 1 student review");
  await expect(visitor.locator("#reviews .rev-avg")).toHaveText("5.0");
  await expect(visitor.locator(".fact-rating")).toContainText("5.0");
  await expect(visitor.getByRole("link", { name: "Write a review" })).toHaveAttribute("href", "/app/review/beginners-baking-class");
  const ld = await structuredData(visitor);
  expect(ld).toMatch(/"aggregateRating":\{[^}]*"ratingValue":5[,}][^}]*"ratingCount":1/);

  // the class list card carries the rating too
  await visitor.goto("/en/courses");
  const card = visitor.locator("article.card", { has: visitor.locator('a[href="/en/courses/beginners-baking-class"]') }).first();
  await expect(card).toContainText("5.0");

  // the instructor of that class now shows a badge with the real rating
  await visitor.goto("/en/courses/beginners-baking-class");
  const instructorHref = await visitor.locator('a[href*="/instructors/"]').first().getAttribute("href");
  await visitor.goto(instructorHref!);
  await expect(visitor.getByText("MAWAH Academy instructor").first()).toBeVisible();
  await expect(visitor.locator(".rating-badge").first()).toContainText("5.0");
  await expect(visitor.locator(".rating-badge").first()).toContainText("1 review");
  // …and their profile shows what students actually wrote, each review linking to its class
  await expect(visitor.locator("#reviews")).toContainText("Clear and easy to follow.");
  await expect(visitor.locator('#reviews a[href="/en/courses/beginners-baking-class"]')).toBeVisible();

  // an unrated class still says so, instead of showing stars it has not earned
  await visitor.goto("/en/courses/traditional-aurosh-biryani-online-class");
  await expect(visitor.locator("#reviews")).toContainText("No reviews yet");

  // and the new sections pass the accessibility audit
  await visitor.goto("/en/courses/beginners-baking-class");
  const axe = await new AxeBuilder({ page: visitor }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await adminCtx.close();
  await visitorCtx.close();
});

test("the Equipment Shop is in every menu (this website's own shop, in the same tab); another shop's address opens a new tab safely, and the owner can switch it off", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();

  for (const path of ["/en", "/en/courses", "/en/courses/beginners-baking-class"]) {
    await page.goto(path);
    const shop = page.locator('a[href="/en/shop"]:visible').first();
    await expect(shop, path).toBeVisible();
    await expect(shop, path).not.toHaveAttribute("target", "_blank");
  }
  // the shop is not open yet (Admin → Shop): its page says so, with no product or price
  await page.goto("/en");
  await page.locator('.nav-links a[href="/en/shop"]').click();
  await expect(page.getByRole("heading", { level: 1, name: "Equipment Shop" })).toBeVisible();
  await expect(page.getByText("Opening soon")).toBeVisible();
  await expect(page.locator("article.pcard")).toHaveCount(0);

  // on a phone it sits in the menu
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/en");
  await page.locator("details.menu > summary").click();
  await expect(page.locator('.menu-panel a[href="/en/shop"]')).toBeVisible();

  // the student app has it too
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/login");
  await expect(page.locator('a.nav-shop[href="/en/shop"]')).toBeVisible();

  // the owner gives another shop's address in Settings: the menus open it in a new tab, safely
  const adminCtx = await browser.newContext({ locale: "en-US" });
  await useLang(adminCtx, "en");
  const admin = await adminCtx.newPage();
  await adminLogin(admin);
  await admin.goto("/admin/settings");
  const shopForm = admin.locator("form", { has: admin.locator("#sh-url") });
  const save = async () => {
    const saved = admin.waitForResponse((r) => r.url().endsWith("/api/admin/settings/shop") && r.request().method() === "PUT");
    await shopForm.getByRole("button", { name: "Save" }).click();
    expect((await saved).status()).toBe(200);
  };
  await expect(shopForm.locator("#sh-url")).toHaveValue("");
  await shopForm.locator("#sh-url").fill("https://mawahbd.com");
  await save();
  for (const path of ["/en", "/en/courses"]) {
    await page.goto(path);
    const other = page.locator('a[data-shop]:visible, nav a[href="https://mawahbd.com"]:visible').first();
    await expect(other, path).toHaveAttribute("href", "https://mawahbd.com");
    await expect(other, path).toHaveAttribute("target", "_blank");
    await expect(other, path).toHaveAttribute("rel", /noopener/);
  }

  // switched off in Settings -> every shop link disappears
  const shopSwitch = shopForm.getByRole("switch", { name: "Show the shop in the menus of the website and the student app" });
  await expect(shopSwitch).toBeChecked();
  await shopForm.locator("label.switch").click();
  await expect(shopSwitch).not.toBeChecked();
  await save();
  await page.goto("/en");
  await expect(page.locator('a[href="https://mawahbd.com"], a[href="/en/shop"]')).toHaveCount(0);
  // …and back to this website's own shop
  await shopForm.locator("label.switch").click();
  await expect(shopSwitch).toBeChecked();
  await shopForm.locator("#sh-url").fill("");
  await save();
  await page.goto("/en");
  await expect(page.locator('a[href="/en/shop"]').first()).toBeVisible();
  await expect(page.locator('a[href="https://mawahbd.com"]')).toHaveCount(0);

  await adminCtx.close();
  await ctx.close();
});
