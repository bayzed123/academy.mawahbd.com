import { expect, test } from "@playwright/test";

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
});
