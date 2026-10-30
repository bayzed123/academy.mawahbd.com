import { expect, test, type Page } from "@playwright/test";
import { adminLogin, apiGet, apiSend, offerAnswered, openAssistant } from "./helpers";

/*
 * The assistant's window on a phone, opened from the talk-to-us card: its Send button stays on the screen; it is a modal dialog that keeps
 * the focus inside, offers a person instead (WhatsApp and Messenger, at the owner's own addresses from Settings → Contact), and gives the
 * focus back to the talk-to-us button when it closes.
 */
let admin: Page;
let contact: Record<string, unknown>;
test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext()).newPage();
  await adminLogin(admin);
  contact = (await apiGet<{ settings: { contact: Record<string, unknown> } }>(admin, "/admin/settings")).settings.contact;
  await apiSend(admin, "PUT", "/admin/settings/contact", { ...contact, whatsapp: "01711000000", facebook: "https://www.facebook.com/mawahacademy", messenger: "" });
});
test.afterAll(async () => {
  await apiSend(admin, "PUT", "/admin/settings/contact", contact);
  await admin.context().close();
});

test("chatbot keeps the send action visible on mobile and manages dialog focus", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 760 }, locale: "en-US" });
  await offerAnswered(context);
  const page = await context.newPage();
  await page.goto("/en");

  const launcher = page.locator(".floats summary.fab-help");
  await expect(launcher).toBeVisible();
  await launcher.click();
  await page.getByRole("group", { name: "Talk to us" }).getByRole("button", { name: /^AI assistant/ }).click();
  // (the card folds away once a way is chosen: from here on its assistant button is found by what it is, not by its name)
  const assistant = page.locator(".floats [data-chat-open]");

  const dialog = page.getByRole("dialog", { name: "MAWAH Assistant" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(assistant).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".floats")).toBeHidden(); // the round buttons step aside: nothing sits on the Send button
  const site = await page.request.get("/api/site").then((r) => r.json() as Promise<{ site: { contact: { whatsapp: string; messenger: string } } }>);
  expect(site.site.contact.whatsapp).toBe("8801711000000"); // typed 01711000000: the site sends it with its country code, as WhatsApp needs
  await expect(dialog.getByRole("link", { name: /WhatsApp/ })).toHaveAttribute("href", "https://wa.me/8801711000000");
  expect(site.site.contact.messenger).toBe("https://m.me/mawahacademy");
  await expect(dialog.getByRole("link", { name: /Messenger/ })).toHaveAttribute("href", site.site.contact.messenger);
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
  await expect(assistant).toHaveAttribute("aria-expanded", "false");
  await expect(launcher).toBeFocused();
  await context.close();
});

test("offers only the ways the owner has: without a Messenger address, WhatsApp and the assistant share the row", async ({ browser }) => {
  await apiSend(admin, "PUT", "/admin/settings/contact", { ...contact, whatsapp: "01711000000", facebook: "", messenger: "" });
  const context = await browser.newContext({ locale: "en-US" });
  await offerAnswered(context);
  const page = await context.newPage();
  await page.goto("/en");
  await openAssistant(page);
  const dialog = page.getByRole("dialog", { name: "MAWAH Assistant" });
  const wa = dialog.getByRole("link", { name: /WhatsApp/ });
  await expect(wa).toHaveAttribute("href", "https://wa.me/8801711000000");
  await expect(dialog.getByRole("link", { name: /Messenger/ })).toHaveCount(0);
  const [row, one] = await Promise.all([dialog.locator(".mc-support-grid").boundingBox(), wa.boundingBox()]);
  expect(one!.width).toBeGreaterThan(row!.width / 2 - 10); // half the row each, no empty third column
  await context.close();
});
