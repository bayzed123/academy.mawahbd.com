import { expect, test } from "@playwright/test";

test.describe("light mode and shop mobile layout", () => {
  test.use({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });

  test("keeps the home FAQ questions visible in light mode", async ({ browser }) => {
    const context = await browser.newContext({ locale: "bn-BD" });
    await context.addInitScript(() => localStorage.setItem("mawah_theme", "light"));
    const page = await context.newPage();
    await page.goto("/");

    const question = page.locator(".faq-item > summary").first();
    await expect(question).toBeVisible();
    await expect(question).toHaveCSS("color", "rgb(27, 18, 19)");
    await expect(page.locator(".faq-item").first()).toHaveCSS("background-color", "rgb(255, 253, 248)");
    const primary = page.locator("a.btn-primary").first();
    await expect(primary).toHaveCSS("background-color", "rgb(219, 23, 24)");
    await expect(primary).toHaveCSS("color", "rgb(255, 255, 255)");
    await context.close();
  });

  for (const path of ["/shop", "/en/shop"]) {
    test(`does not overflow horizontally on ${path}`, async ({ browser }) => {
      const context = await browser.newContext({ locale: path.startsWith("/en") ? "en-US" : "bn-BD" });
      await context.addInitScript(() => localStorage.setItem("mawah_theme", "light"));
      const page = await context.newPage();
      await page.goto(path);
      const dimensions = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        wideShopPanels: [...document.querySelectorAll(".shop-side, .shop-side > *, .shop-main")]
          .map((el) => Math.ceil(el.getBoundingClientRect().width))
          .filter((width) => width > document.documentElement.clientWidth + 1),
      }));
      expect(dimensions.scroll - dimensions.client, path).toBeLessThanOrEqual(1);
      expect(dimensions.wideShopPanels, `${path} contains a panel wider than the viewport`).toEqual([]);
      await context.close();
    });
  }
});
