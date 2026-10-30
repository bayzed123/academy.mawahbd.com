import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { drawWholePage, offerAnswered, registerStudent, useLang } from "./helpers";

const look = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const bar = (page: Page) => page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute("content"));

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`);
}

test.describe("day/night theme", () => {
  test("toggles on the public site, persists across routes, and is available in the student app", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    await context.addInitScript(() => {
      if (!localStorage.getItem("mawah_theme")) localStorage.setItem("mawah_theme", "dark");
    });
    const page = await context.newPage();

    await page.goto("/en");
    const toggle = page.locator("[data-theme-toggle]").first();
    await expect(toggle).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveAttribute("aria-label", "Switch to light mode");

    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("aria-label", "Switch to dark mode");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(251, 247, 238)");
    await expect(page.evaluate(() => localStorage.getItem("mawah_theme"))).resolves.toBe("light");

    await page.goto("/en/courses");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("[data-theme-toggle]").first()).toHaveAttribute("aria-pressed", "true");

    await page.goto("/app/login");
    const appToggle = page.locator("[data-theme-toggle]").first();
    await expect(appToggle).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await appToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(appToggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.evaluate(() => localStorage.getItem("mawah_theme"))).resolves.toBe("dark");

    await context.close();
  });

  test("without a choice of the visitor's own it follows the device's setting; a choice made wins over it", async ({ browser }) => {
    const day = await browser.newContext({ locale: "en-US", colorScheme: "light" });
    const page = await day.newPage();
    await page.goto("/en");
    expect(await look(page)).toBe("light");
    expect(await bar(page)).toBe("#fbf7ee"); // the phone's bar takes the day look's ivory
    await day.addInitScript(() => localStorage.setItem("mawah_theme", "dark"));
    await page.goto("/en/courses");
    expect(await look(page)).toBe("dark");
    expect(await bar(page)).toBe("#000000");
    await day.close();
  });

  test("the look is set before the page is drawn — by theme.js in <head>, even when the site's own script never arrives", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "en-US" });
    await ctx.addInitScript(() => localStorage.setItem("mawah_theme", "light"));
    const page = await ctx.newPage();
    const refused: string[] = [];
    page.on("console", (m) => m.type() === "error" && /Content Security Policy|Refused/.test(m.text()) && refused.push(m.text()));
    await page.route(/\/assets\/site\.[0-9a-f]+\.js$/, (r) => r.abort());
    for (const path of ["/en", "/en/faq", "/app/login"]) {
      await page.goto(path);
      expect(await look(page), path).toBe("light");
      expect(await bar(page), path).toBe("#fbf7ee");
    }
    expect(refused, "nothing refused by the security policy").toEqual([]);
    await ctx.close();
  });

  test("the day look passes the accessibility scan on the main pages, in both languages, and on a phone", async ({ browser }) => {
    for (const [lang, paths] of [
      ["en", ["/en", "/en/courses", "/en/courses/beginners-baking-class", "/en/faq", "/en/contact", "/en/shop"]],
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
    await expect(page.locator(".site-header").getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
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
});
