import { expect, test } from "@playwright/test";

test("offer popup opens smoothly and yields to the chatbot", async ({ page }) => {
  await page.goto("/en");
  const bannerSrc = "/assets/banners.466992cda9.js";

  await page.evaluate(() => {
    const offer = document.createElement("div");
    offer.className = "offer";
    offer.hidden = true;
    offer.dataset.offer = "";
    offer.dataset.id = `pw-${Date.now()}`;
    offer.dataset.v = "1";
    offer.dataset.delay = "0";
    offer.dataset.days = "0";
    offer.setAttribute("role", "dialog");
    offer.setAttribute("aria-modal", "true");
    offer.setAttribute("aria-label", "Playwright offer");
    offer.innerHTML = '<div class="offer-card"><button class="offer-x" type="button" data-offer-close aria-label="Close">×</button><h2>Playwright offer</h2><p>Test offer</p><a href="/courses">Take the offer</a></div>';
    document.body.appendChild(offer);
  });
  await page.addScriptTag({ url: new URL(bannerSrc, page.url()).toString() });

  const offer = page.getByRole("dialog", { name: "Playwright offer" });
  await expect(offer).toBeVisible();
  await expect(offer).toHaveClass(/is-open/);
  await expect(page.locator("html")).toHaveClass(/offer-open/);
  await expect(offer.getByRole("button", { name: "Close" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(offer).toBeHidden();
  await expect(page.locator("html")).not.toHaveClass(/offer-open/);

  await page.locator("[data-chat-open]").first().click();
  const dialog = page.getByRole("dialog", { name: "MAWAH Assistant" });
  await expect(dialog).toBeVisible();

  await page.evaluate(() => {
    const offer = document.querySelector<HTMLElement>("[data-offer]")!;
    offer.hidden = false;
    document.documentElement.classList.add("offer-open");
  });
  await expect(offer).toBeVisible();
  await page.evaluate(() => window.MawahChat?.open());
  await expect(offer).toBeHidden();
  await expect(page.locator("html")).not.toHaveClass(/offer-open/);
  await expect(dialog).toBeVisible();
});
