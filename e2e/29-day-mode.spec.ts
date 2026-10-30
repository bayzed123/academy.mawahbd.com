import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { drawWholePage, offerAnswered, registerStudent, useLang } from "./helpers";

/*
 * Night and day (the owner's fifth round), in a real browser. The night look is the default. The sun / moon button in the header switches
 * to the day look, which stays while the visitor moves between pages, reloads, and goes into the student app — and back again from there.
 * It is there before the page is drawn: the few words in <head> set it even if the site's own script never arrives. The day look passes
 * the accessibility scan (contrast included) on the main pages, in both languages.
 */
const look = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const bar = (page: Page) => page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute("content"));
const pageColour = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const kept = (page: Page) => page.evaluate(() => localStorage.getItem("mawah_theme"));

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`);
}

test("the switch turns the day look on, and it stays across pages, a reload and the student app — and the app's switch turns it back", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  await page.goto("/en");
  // the night look first: a black page and a black bar
  expect(await look(page)).toBeNull();
  expect(await bar(page)).toBe("#000000");
  expect(await pageColour(page)).toBe("rgb(0, 0, 0)");
  const day = page.locator(".site-header").getByRole("button", { name: "Day mode" });
  await expect(day).toBeVisible();
  await expect(day).toHaveAttribute("aria-pressed", "false");

  await day.click();
  await expect(day).toHaveAttribute("aria-pressed", "true");
  expect(await look(page)).toBe("light");
  expect(await bar(page)).toBe("#ffffff");
  expect(await pageColour(page)).toBe("rgb(255, 255, 255)");
  expect(await kept(page)).toBe("light");
  // the orange buttons stay orange, with near-black words on them
  const cta = page.getByRole("link", { name: "Browse classes" });
  expect(await cta.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])).toEqual(["rgb(255, 87, 34)", "rgb(10, 10, 10)"]);

  // another page, a reload: still day
  await page.goto("/en/courses");
  expect(await look(page)).toBe("light");
  await expect(page.locator(".site-header").getByRole("button", { name: "Day mode" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  expect(await look(page)).toBe("light");

  // the student app opens in the day look too, and its own switch brings the night back for the whole site
  await page.goto("/app/login");
  const appDay = page.locator(".app-header").getByRole("button", { name: "Day mode" });
  await expect(appDay).toHaveAttribute("aria-pressed", "true");
  expect(await look(page)).toBe("light");
  expect(await pageColour(page)).toBe("rgb(255, 255, 255)");
  await appDay.click();
  await expect(appDay).toHaveAttribute("aria-pressed", "false");
  expect(await look(page)).toBeNull();
  expect(await bar(page)).toBe("#000000");
  await page.goto("/en");
  expect(await look(page)).toBeNull();
  expect(await pageColour(page)).toBe("rgb(0, 0, 0)");
  await ctx.close();
});

test("the day look is set before the page is drawn — by the few words in <head>, even when the site's script never arrives", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await ctx.addInitScript(() => localStorage.setItem("mawah_theme", "light"));
  const page = await ctx.newPage();
  const refused: string[] = [];
  page.on("console", (m) => m.type() === "error" && /Content Security Policy|Refused/.test(m.text()) && refused.push(m.text()));
  await page.route(/\/assets\/site\.[0-9a-f]+\.js$/, (r) => r.abort());
  for (const path of ["/en", "/en/faq", "/app/login"]) {
    await page.goto(path);
    expect(await look(page), path).toBe("light");
    expect(await bar(page), path).toBe("#ffffff");
    expect(await page.evaluate(() => document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")), path).toBe("light");
  }
  // the site's switch needs the script: without it, it stays out of the way
  await page.goto("/en");
  await expect(page.locator(".site-header .theme-toggle")).toBeHidden();
  expect(refused, "the policy let the few words run").toEqual([]);
  await ctx.close();
});

test("the day look passes the accessibility scan on the main pages, in both languages, and on a phone", async ({ browser }) => {
  for (const [lang, paths] of [
    ["en", ["/en", "/en/courses", "/en/courses/beginners-baking-class", "/en/faq", "/en/contact"]],
    ["bn", ["/", "/courses"]],
  ] as const) {
    const ctx = await browser.newContext({ locale: lang === "en" ? "en-US" : "bn-BD" });
    await useLang(ctx, lang);
    await offerAnswered(ctx);
    await ctx.addInitScript(() => localStorage.setItem("mawah_theme", "light"));
    const page = await ctx.newPage();
    for (const path of paths) {
      await page.goto(path);
      expect(await look(page), path).toBe("light");
      await drawWholePage(page);
      expect(await axe(page), path).toEqual([]);
    }
    await ctx.close();
  }
  // a phone: the header still fits, with the switch in it, and nothing scrolls sideways
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  await ctx.addInitScript(() => localStorage.setItem("mawah_theme", "light"));
  const page = await ctx.newPage();
  await page.goto("/en");
  await expect(page.locator(".site-header").getByRole("button", { name: "Day mode" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await axe(page)).toEqual([]);
  await ctx.close();
});

test("the student app's pages pass the scan in the day look too, and its talk-to-us button clears the tab bar", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await useLang(ctx, "en");
  await ctx.addInitScript(() => localStorage.setItem("mawah_theme", "light"));
  const page = await ctx.newPage();
  await registerStudent(page);
  for (const path of ["/app/", "/app/orders", "/app/profile"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await look(page), path).toBe("light");
    expect(await axe(page), path).toEqual([]);
  }
  const [corner, tabs] = await Promise.all([page.locator(".mc-floats .fab").boundingBox(), page.locator(".tabbar").boundingBox()]);
  expect(corner!.y + corner!.height).toBeLessThanOrEqual(tabs!.y + 1);
  await ctx.close();
});
