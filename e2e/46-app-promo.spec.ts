import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiSend, useLang } from "./helpers";

/*
 * "Get the app" on the website, in a real browser: the Android app is not on Google Play yet, so the home page's section and the footer of
 * every page say it is coming soon, with nothing to press. The owner pastes the app's Google Play address in Admin → Android app once it is
 * live, and the same places become the "Get it on Google Play" button. It fits a 360 px phone, in the night and the day look.
 * Set SHOTS_DIR to keep pictures of it. Runs after the admin spec (the owner exists); the address is taken out again at the end.
 */
test.describe.configure({ mode: "serial" });

const PLAY = "https://play.google.com/store/apps/details?id=com.mawahacademy.app";
const shots = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string, sel = "#app") => {
  if (!shots) return;
  // scrolled to the top of the screen first, then the screen as a visitor sees it (an element's own picture came out cut on a long page)
  await page.locator(sel).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/${name}.png` });
};

let admin: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  await apiSend(admin, "PUT", "/admin/settings/play", { show: true, url: "" });
});
test.afterAll(async () => {
  await apiSend(admin, "PUT", "/admin/settings/play", { show: true, url: "" });
  await admin.context().close();
});

test("before the app is live: the home page and the footer say it is coming soon, with nothing to press", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en");
  const section = page.locator("#app");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText("Learn from your phone, anywhere");
  await expect(section).toContainText("Free classes made just for the app");
  await expect(section).toContainText("A notification the moment a new class is out");
  await expect(section.locator(".play-badge")).toContainText("COMING SOON ONGoogle Play");
  await expect(section.getByRole("link", { name: /Google Play/ })).toHaveCount(0);
  // the footer's corner is on every other page (on the home page the section just above says it all)
  await expect(page.locator(".site-footer .foot-app")).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).include("#app").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  await shot(page, "app-desktop-soon");

  await page.goto("/en/courses");
  const footer = page.locator(".site-footer .foot-app");
  await expect(footer).toContainText("Download the app on your phone");
  await expect(footer).toContainText("COMING SOON ONGoogle Play");
  await expect(footer.getByRole("link")).toHaveCount(0);
  const axeFoot = await new AxeBuilder({ page }).include(".foot-app").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axeFoot.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await shot(page, "app-footer-soon", ".site-footer");
  await page.goto("/en");

  // the day look
  await page.evaluate(() => localStorage.setItem("mawah_theme", "light"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const light = await new AxeBuilder({ page }).include("#app").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(light.violations.filter((v) => v.impact === "serious" || v.impact === "critical").flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1] ?? ""}`))).toEqual([]);
  await shot(page, "app-desktop-light");
  await ctx.close();
});

test("it fits a 360 px phone, in Bangla", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  await useLang(ctx, "bn");
  const page = await ctx.newPage();
  await page.goto("/");
  const section = page.locator("#app");
  await expect(section).toContainText("শিগগিরই আসছে");
  await section.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  const box = await section.locator(".play-badge").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await shot(page, "app-phone-bn");
  await ctx.close();
});

test("the owner adds the app's Google Play address in Admin → Android app: the website's button opens Google Play", async ({ browser }) => {
  await admin.goto("/admin/app");
  const panel = admin.locator(".play-form");
  await expect(panel).toContainText('Now on the website: "Coming soon on Google Play"');
  const field = panel.getByLabel("The app's Google Play address");
  await field.fill("https://example.com/our-app");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByRole("alert")).toContainText("That is not the app's Google Play address");
  await field.fill(`${PLAY}&utm_source=share`);
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await expect(panel).toContainText('Now on the website: "Get it on Google Play"');
  await expect(field).toHaveValue(PLAY); // tidied
  await expect(panel.getByRole("link", { name: "Open on Google Play" })).toHaveAttribute("href", PLAY);
  if (shots) await panel.screenshot({ path: `${shots}/app-admin.png` });

  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en");
  const button = page.locator("#app").getByRole("link", { name: /GET IT ON.*Google Play/ });
  await expect(button).toHaveAttribute("href", PLAY);
  await expect(button).toHaveAttribute("target", "_blank");
  await shot(page, "app-desktop-live");
  await page.goto("/en/courses");
  await expect(page.locator(".site-footer .foot-app").getByRole("link", { name: /Google Play/ })).toHaveAttribute("href", PLAY);
  // the Install strip at the top: opens Google Play; closed, it stays away (here, after a reload)
  const strip = page.locator("[data-app-strip]");
  await expect(strip).toContainText("The MAWAH Academy app is on Google Play");
  await expect(strip.getByRole("link", { name: /Install/ })).toHaveAttribute("href", PLAY);
  await shot(page, "app-strip", "[data-app-strip]");
  await strip.getByRole("button", { name: "Close" }).click();
  await expect(strip).toBeHidden();
  await page.reload();
  await expect(page.locator("[data-app-strip]")).toBeHidden();
  await shot(page, "app-footer-live", ".site-footer");
  await ctx.close();
});
