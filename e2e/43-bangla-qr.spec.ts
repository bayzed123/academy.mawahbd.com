import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, agree, registerStudent, useLang } from "./helpers";

/*
 * Bangla QR, the third way to pay. The shop's own QR (MAWAH) is built in, so the owner only switches it Active or Inactive in
 * Settings → Payments. A student picks it at checkout, gets the QR (sharp, scannable, inside a phone screen), the amount and the order code,
 * pays in any banking app, and sends the TrxID — then waits for staff, as with send-money. Inactive, it is not offered.
 * The student's own number is never needed to go on. Runs after the admin spec (the owner exists); leaves Bangla QR Active.
 */
test.describe.configure({ mode: "serial" });

const CLASS = "traditional-aurosh-biryani-online-class";
let admin: Page;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
});
test.afterAll(async () => admin.context().close());

const qrSwitch = () => admin.getByRole("switch", { name: "Bangla QR" });
async function save() {
  const done = admin.waitForResponse((r) => r.url().endsWith("/api/admin/settings/payments") && r.request().method() === "PUT");
  await admin.getByRole("button", { name: "Save", exact: true }).click();
  return (await done).status();
}

test("the owner sees Bangla QR Active with the shop's own QR built in, and can switch it Inactive and back", async ({ browser }) => {
  test.setTimeout(120_000);
  await admin.goto("/admin/settings?tab=payments");
  await expect(qrSwitch()).toBeChecked();
  await expect(admin.locator(".pay-qr-head .chip")).toHaveText("Active");
  const preview = admin.locator(".qr-preview img");
  await expect(preview).toHaveAttribute("src", "/pay/bangla-qr.png");
  await expect.poll(() => preview.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(924);
  await expect(admin.locator(".qr-preview figcaption")).toHaveText("Built in: your MAWAH Bangla QR");
  await expect(admin.getByRole("switch", { name: /bKash direct/i })).toHaveCount(0);
  await expect(admin.getByLabel(/payment link/i)).toHaveCount(0);

  // Inactive: not offered at checkout
  await qrSwitch().locator("xpath=ancestor::label").click();
  await expect(admin.locator(".pay-qr-head .chip")).toHaveText("Inactive");
  expect(await save()).toBe(200);
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  await page.goto(`/app/checkout?c=${CLASS}`);
  await expect(page.getByText("Send money manually")).toBeVisible();
  await expect(page.locator("label.pay-opt", { hasText: "Bangla QR" })).toHaveCount(0);

  // Active again
  await admin.reload();
  await qrSwitch().locator("xpath=ancestor::label").click();
  await expect(admin.locator(".pay-qr-head .chip")).toHaveText("Active");
  expect(await save()).toBe(200);
  await page.reload();
  await expect(page.locator("label.pay-opt", { hasText: "Bangla QR" })).toBeVisible();
  await ctx.close();

  const axe = await new AxeBuilder({ page: admin }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
});

test("a student pays by Bangla QR on a phone: the QR, the amount and the order code, then the TrxID and the waiting state", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  await page.goto(`/app/checkout?c=${CLASS}`);
  const qr = page.locator("label.pay-opt", { hasText: "Bangla QR" });
  await expect(qr).toContainText("Scan our QR with any bank or mobile-banking app");
  await qr.click();
  await expect(page.getByText(/you get our Bangla QR and \d+ minutes to pay/)).toBeVisible();
  await agree(page);
  const go = page.getByRole("button", { name: "Continue — show payment details" });
  await expect(go).toBeEnabled();
  await go.click();

  await expect(page).toHaveURL(/\/app\/orders\/[a-z2-7]{20}/);
  const img = page.locator(".qr-box img");
  await expect(img).toHaveAttribute("src", "/pay/bangla-qr.png");
  await expect(img).toHaveAttribute("alt", "Our Bangla QR — scan it in your banking app");
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(924);
  const box = await img.boundingBox();
  expect(box!.width, "big enough to scan").toBeGreaterThanOrEqual(220);
  expect(box!.x + box!.width, "inside the screen").toBeLessThanOrEqual(360);
  await expect(page.getByText("Pays to: MAWAH")).toBeVisible();
  await expect(page.getByText(/Scan the QR and pay exactly ৳[\d,]+\./)).toBeVisible();
  await expect(page.getByText("You are paying from")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByLabel("Transaction ID (TrxID)").fill("QRE2E12345");
  await page.getByRole("button", { name: "I have paid — send for checking" }).click();
  await expect(page.getByRole("heading", { name: "We are verifying your payment" })).toBeVisible();
  await expect(page.getByText("TrxID QRE2E12345")).toBeVisible();
  await ctx.close();
});

test("send money without typing your own number: Continue works and the order opens", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  await page.goto(`/app/checkout?c=${CLASS}`);
  await page.getByText("Send money manually").click();
  await expect(page.getByLabel(/^Your number — the one you will send money from/)).toHaveValue("");
  await agree(page);
  await page.getByRole("button", { name: "Continue — show payment details" }).click();
  await expect(page).toHaveURL(/\/app\/orders\/[a-z2-7]{20}/);
  await expect(page.getByRole("heading", { name: /^Send ৳[\d,]+ now$/ })).toBeVisible();
  await ctx.close();
});
