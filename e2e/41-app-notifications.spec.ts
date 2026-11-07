import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, useLang } from "./helpers";

/*
 * Admin → Android app → Notifications (worker/src/services/push.ts): whether they are set up, a check that asks Google, the two that go out by
 * themselves, and the owner's own notification. "Google" is the test server's stand-in (worker/src/routes/api/dev-google.ts), which keeps
 * what was sent for the test to read. Runs after the admin spec (the owner exists).
 */
const STAMP = Date.now().toString(36);
interface Sent {
  topic?: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

test("the owner checks the connection, switches an automatic one, and sends a notification to every phone in its own language", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const admin = await ctx.newPage();
  await adminLogin(admin);

  await admin.goto("/admin/app");
  const panel = admin.locator(".panel", { has: admin.getByRole("heading", { name: "Notifications", exact: true }) });
  await expect(panel.getByText("Set up — sent from the Firebase project mawah-e2e.")).toBeVisible();
  expect((await new AxeBuilder({ page: admin }).include("main").analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  // the check asks Google to look at a notification in full, and delivers nothing
  await panel.getByRole("button", { name: "Check the connection" }).click();
  await expect(panel.getByText("Connected: Google accepted a test notification (it went to no phone).")).toBeVisible();

  // an automatic one switched off stays off, and back on
  const newClass = panel.getByRole("switch", { name: /One of the app's free classes goes live/ });
  await expect(newClass).toBeChecked();
  await newClass.click({ force: true });
  await expect(admin.getByText("Saved.").first()).toBeVisible();
  await admin.reload();
  await expect(panel.getByRole("switch", { name: /One of the app's free classes goes live/ })).not.toBeChecked();
  await panel.getByRole("switch", { name: /One of the app's free classes goes live/ }).click({ force: true });
  await expect(panel.getByRole("switch", { name: /One of the app's free classes goes live/ })).toBeChecked();

  // the owner's own: both languages, to everyone, a tap opens the app's Home
  await expect(panel.getByRole("radio", { name: "Everyone with the app" })).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByLabel("A tap opens")).toHaveValue("");
  await panel.getByLabel("Title (Bangla)").fill(`আজ রাতে লাইভ ক্লাস ${STAMP}`);
  await panel.getByLabel("Message (Bangla)").fill("রাত ৮টায় অ্যাপে চলে আসুন");
  await panel.getByLabel("Title (English)").fill(`Live class tonight ${STAMP}`);
  await panel.getByLabel("Message (English)").fill("Join us in the app at 8 pm");
  await panel.getByRole("button", { name: "Send now" }).click();
  const ask = admin.getByRole("alertdialog");
  await expect(ask).toContainText("Send this notification now?");
  await ask.getByRole("button", { name: "Send now" }).click();
  await expect(admin.getByText("Notification sent.").first()).toBeVisible();
  const row = panel.locator(".push-sends li", { hasText: `Live class tonight ${STAMP}` });
  await expect(row).toContainText("Your message");
  await expect(row).toContainText("Everyone");
  await expect(row).toContainText("by Owner Test");
  await expect(row.getByText("Sent", { exact: true })).toBeVisible();
  // the form is empty again, ready for the next one
  await expect(panel.getByLabel("Title (English)")).toHaveValue("");

  const { sent } = await apiGet<{ sent: Sent[] }>(admin, "/dev/google/push");
  const bn = sent.find((s) => s.title === `আজ রাতে লাইভ ক্লাস ${STAMP}`);
  const en = sent.find((s) => s.title === `Live class tonight ${STAMP}`);
  expect(bn).toMatchObject({ topic: "lang-bn", body: "রাত ৮টায় অ্যাপে চলে আসুন", data: { kind: "manual", path: "/" } });
  expect(en).toMatchObject({ topic: "lang-en", body: "Join us in the app at 8 pm", data: { kind: "manual", path: "/" } });

  // a second one at once is almost always a double click
  await panel.getByLabel("Title (Bangla)").fill("আবার");
  await panel.getByLabel("Message (Bangla)").fill("আবার");
  await panel.getByLabel("Title (English)").fill("Again");
  await panel.getByLabel("Message (English)").fill("Again");
  await panel.getByRole("button", { name: "Send now" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Send now" }).click();
  await expect(admin.getByText("A notification went out less than a minute ago.").first()).toBeVisible();
  await ctx.close();
});

test("in Bangla on a phone the panel reads in Bangla and fits the screen", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 780 } });
  await useLang(ctx, "bn");
  const admin = await ctx.newPage();
  await adminLogin(admin);
  await admin.goto("/admin/app");
  const panel = admin.locator(".panel", { has: admin.getByRole("heading", { name: "নোটিফিকেশন", exact: true }) });
  await expect(panel.getByText("চালু আছে — Firebase প্রজেক্ট mawah-e2e থেকে যায়।")).toBeVisible();
  await expect(panel.getByRole("button", { name: "এখনই পাঠান" })).toBeVisible();
  await expect(panel.getByRole("radio", { name: "অ্যাপ আছে এমন সবাই" })).toBeVisible();
  const wide = await admin.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide).toBeLessThanOrEqual(1);
  await ctx.close();
});
