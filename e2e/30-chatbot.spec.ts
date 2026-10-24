import { expect, test } from "@playwright/test";

test("chatbot keeps the send action visible on mobile and manages dialog focus", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 760 }, locale: "en-US" });
  const page = await context.newPage();
  await page.goto("/en");

  const launcher = page.locator("[data-chat-open]").first();
  await expect(launcher).toBeVisible();
  await launcher.click();

  const dialog = page.getByRole("dialog", { name: "MAWAH Assistant" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(launcher).toHaveAttribute("aria-expanded", "true");
  await expect(launcher).toHaveAttribute("aria-hidden", "true");
  await expect(dialog.getByRole("link", { name: /WhatsApp/ })).toHaveAttribute("href", "https://wa.me/01700000000");
  await expect(dialog.getByRole("link", { name: /Messenger/ })).toHaveAttribute("href", "https://www.facebook.com/mawahcookingschool/?rdid=MRdfBI65oWmOpDDh");
  await expect(dialog.getByRole("button", { name: /AI Bot/ })).toBeVisible();

  const input = dialog.locator(".mc-in");
  const send = dialog.getByRole("button", { name: "Send" });
  await expect(input).toBeFocused();
  await expect(send).toBeVisible();
  const box = await send.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);

  await input.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: /AI Bot/ })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link", { name: /Messenger/ })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link", { name: /WhatsApp/ })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(".mc-x")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(send).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
  await expect(launcher).toBeFocused();
  await context.close();
});
