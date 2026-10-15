import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, STAFF, useLang } from "./helpers";

/*
 * Two things the owner asked for. (1) The footer's "We accept" row shows the real marks — the owner's bKash, Nagad and Rocket
 * pictures plus Visa and Mastercard — sharp, small, with the developer credit and the rights line under it. (2) A way to see
 * whether e-mail really goes out: Settings → E-mail → "Send me a test e-mail", with the answer in plain words. Resend itself is
 * not reachable from a test, so the failure texts are checked by answering the button's request the way the Worker would.
 * Runs after the admin spec (the owner exists).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
});
test.afterAll(async () => admin.context().close());

test("the footer shows the five payment marks as real, sharp pictures with the developer credit under them — English and Bangla", async ({ browser }) => {
  for (const [lang, path, names, accept, rights, developed] of [
    ["en-US", "/en", ["bKash", "Nagad", "Rocket", "Visa", "Mastercard"], "We accept", "All rights reserved.", "Developed by"],
    ["bn-BD", "/", ["বিকাশ", "নগদ", "রকেট", "ভিসা", "মাস্টারকার্ড"], "আমরা গ্রহণ করি", "সর্বস্বত্ব সংরক্ষিত", "ডেভেলপ করেছেন"],
  ] as const) {
    const ctx = await browser.newContext({ locale: lang, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(path);
    const row = page.getByRole("list", { name: accept });
    await row.scrollIntoViewIfNeeded();
    const imgs = row.locator("img");
    await expect(imgs).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      const img = imgs.nth(i);
      await expect(img).toHaveAttribute("alt", names[i]);
      // loaded for real (the owner's pictures, not a broken link) …
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      // … shown small (24px tall) from a file at least twice that tall, so it stays sharp on a phone
      expect(await img.evaluate((el: HTMLImageElement) => Math.round(el.getBoundingClientRect().height))).toBe(24);
      if (!(await img.getAttribute("src"))!.endsWith(".svg")) expect(await img.evaluate((el: HTMLImageElement) => el.naturalHeight)).toBeGreaterThanOrEqual(48);
    }
    // each mark sits on a white badge so the different colours read on the black footer
    expect(await row.locator("li").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");

    const bottom = page.locator(".foot-bottom");
    await expect(bottom).toContainText(rights);
    await expect(bottom).toContainText(developed);
    const credit = bottom.getByRole("link", { name: /Sayad Bayezid/ });
    await expect(credit).toHaveAttribute("href", "https://sayadbayezid.com");
    await expect(credit).toHaveAttribute("target", "_blank");
    await expect(credit).toHaveAttribute("rel", "noopener noreferrer");
    await ctx.close();
  }
});

test("the footer fits a phone and passes the accessibility scan", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/en");
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  for (const img of await page.locator(".pay-logos img").all()) {
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const box = await img.boundingBox();
    expect(box!.x + box!.width, "inside the screen").toBeLessThanOrEqual(360);
  }
  const axe = await new AxeBuilder({ page }).include(".site-footer").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await ctx.close();
});

test("Settings → E-mail: the test button works, says where the message went, and remembers the result", async () => {
  await admin.goto("/admin/settings?tab=email");
  await expect(admin.getByRole("heading", { name: "E-mail sending" })).toBeVisible();
  // this is a test copy of the site: no Resend key, so the message goes to the local test inbox
  await expect(admin.getByText("Local test inbox")).toBeVisible();
  await expect(admin.getByText(`It goes to your own address (${STAFF.email}) only.`)).toBeVisible();

  await admin.getByRole("button", { name: "Send me a test e-mail" }).click();
  await expect(admin.getByText("Saved in the local test inbox")).toBeVisible();
  await expect(admin.getByText(/Worked — /)).toBeVisible();

  // it really was addressed to the signed-in person
  const box = await apiGet<{ messages: { to: string; subject: string }[] }>(admin, `/dev/outbox?to=${encodeURIComponent(STAFF.email)}`);
  expect(box.messages.at(-1)).toMatchObject({ to: STAFF.email });
  expect(box.messages.at(-1)!.subject).toContain("Test e-mail");

  // the dashboard's "Connect email" first step now leads to this tab
  await admin.goto("/admin/");
  const step = admin.locator("ol.steps li", { hasText: "Connect email" });
  await expect(step.getByRole("link", { name: "Do it" })).toHaveAttribute("href", /settings\?tab=email/);
});

test("a refusal is explained in plain words with the steps, in English and Bangla — and Resend's own words are shown", async () => {
  const refuse = (body: Record<string, unknown>) =>
    admin.route("**/api/admin/settings/email/test", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, at: new Date().toISOString(), by: "Owner Test", to: STAFF.email, from: "MAWAH Academy <no-reply@mawahacademy.com>", domain: "mawahacademy.com", ...body }) }),
    );

  await refuse({ sent: false, provider: "resend", problem: "domain_not_verified", status: 403, detail: "The mawahacademy.com domain is not verified. Please, add and verify your domain on https://resend.com/domains" });
  await admin.goto("/admin/settings?tab=email");
  await admin.getByRole("button", { name: "Send me a test e-mail" }).click();
  const alert = admin.getByRole("alert");
  await expect(alert).toContainText("Resend does not know mawahacademy.com yet");
  await expect(alert).toContainText("Add Domain");
  await expect(alert).toContainText("DNS only");
  await expect(alert).toContainText("Resend says: The mawahacademy.com domain is not verified.");
  await expect(alert).toContainText("(403)");
  await expect(alert).toContainText("press “Send me a test e-mail” again");

  const axe = await new AxeBuilder({ page: admin }).include(".panel").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // another refusal replaces the first one (a key that Resend does not accept)
  await admin.unroute("**/api/admin/settings/email/test");
  await refuse({ sent: false, provider: "resend", problem: "key_invalid", status: 401, detail: "API key is invalid" });
  await admin.getByRole("button", { name: "Send me a test e-mail" }).click();
  await expect(admin.getByRole("alert")).toContainText("Resend did not accept the key");
  await expect(admin.getByRole("alert")).not.toContainText("Add Domain");

  // the same screen in Bangla
  await admin.unroute("**/api/admin/settings/email/test");
  await refuse({ sent: false, provider: "resend", problem: "domain_not_verified", status: 403, detail: "The mawahacademy.com domain is not verified." });
  await admin.getByRole("banner").getByRole("button", { name: "বাংলা" }).click();
  await expect(admin.getByRole("heading", { name: "ইমেইল পাঠানো" })).toBeVisible();
  await admin.getByRole("button", { name: "আমাকে একটি পরীক্ষামূলক ইমেইল পাঠান" }).click();
  await expect(admin.getByRole("alert")).toContainText("Resend এখনো mawahacademy.com চেনে না");
  await expect(admin.getByRole("alert")).toContainText("Resend বলছে:");
  await admin.unroute("**/api/admin/settings/email/test");
  await admin.getByRole("banner").getByRole("button", { name: "English" }).click();
});
