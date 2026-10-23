import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { AGREE, TEST_ADDRESS, uniqueEmail, uniquePhone, useLang } from "./helpers";

/*
 * What SSLCommerz checks on the website before it switches payments on: the registered address and the trade licence number at the bottom of
 * every page (and on About and Contact), the delivery page, whether each class is available, and the blank box a buyer ticks to agree to the
 * terms, the privacy policy and the refund & cancellation policy before an order is placed — in both languages and on a phone.
 */

const noSideScroll = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth;

test("the registered address, the trade licence number and the delivery page are at the bottom of every page, and on About and Contact", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en/courses");
  const footer = page.locator("footer");
  await expect(footer).toContainText("Registered address: Road No. 03, House # 42, Block B, Chandgaon, Chattogram, Bangladesh");
  await expect(footer).toContainText("Trade licence No.: TRADICHTG/010407/2022");
  await footer.getByRole("link", { name: "Delivery policy", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/policies\/delivery$/);
  await expect(page.getByRole("heading", { level: 1, name: "Delivery policy" })).toBeVisible();
  await expect(page.locator(".prose")).toContainText("within 5 days inside Dhaka and within 10 days outside Dhaka");

  await page.goto("/en/about");
  await expect(page.getByRole("heading", { name: "Business details" })).toBeVisible();
  await expect(page.locator(".biz")).toContainText("TRADICHTG/010407/2022");
  await page.goto("/en/contact");
  await expect(page.getByRole("heading", { name: "Business details" })).toBeVisible();
  await expect(page.locator(".biz")).toContainText("Chandgaon, Chattogram");
  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  await ctx.close();
});

test("each class says it is available; at checkout the agree box is blank, nothing is ordered until it is ticked, and its links open the three policies", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en/courses");
  await expect(page.locator(".card .stock.in").first()).toHaveText("Available");
  await page.goto("/en/courses/beginners-baking-class");
  await expect(page.locator(".buy .stock.in")).toHaveText("Available: an online class that opens in your account after payment.");
  await page.getByRole("link", { name: /Enroll Now/ }).first().click();
  await expect(page).toHaveURL(/\/app\/checkout\?c=beginners-baking-class/);

  const box = page.getByRole("checkbox", { name: AGREE });
  await expect(box).not.toBeChecked();
  for (const [name, href] of [
    ["Terms & Conditions", "/en/policies/terms"],
    ["Privacy Policy", "/en/policies/privacy"],
    ["Refund & Cancellation Policy", "/en/policies/refund"],
  ]) {
    const link = page.locator(".agree").getByRole("link", { name, exact: true });
    await expect(link, name).toHaveAttribute("href", href);
    await expect(link, name).toHaveAttribute("target", "_blank");
  }

  // the details typed, the box not ticked: nothing is sent; the box says why and takes the focus
  await page.getByLabel(/^Full name/).fill("Agree Tester");
  await page.getByLabel(/^Mobile number/).fill(uniquePhone());
  await page.getByLabel(/^Address/).fill(TEST_ADDRESS);
  await page.getByLabel(/^E-mail/).fill(uniqueEmail("agree"));
  await page.getByText("Test payment").click();
  let sent = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && /^\/api\/checkout(\/guest)?$/.test(new URL(r.url()).pathname)) sent++;
  });
  await page.getByRole("button", { name: /Pay ৳400/ }).click();
  await expect(page.getByText("Please tick the box to agree before you continue.")).toBeVisible();
  await expect(box).toBeFocused();
  await expect(box).toHaveAttribute("aria-invalid", "true");
  expect(sent).toBe(0);
  const axe = await new AxeBuilder({ page }).include("form.checkout").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);

  // ticked: the message goes, and the order goes through
  await box.check();
  await expect(page.getByText("Please tick the box to agree before you continue.")).toHaveCount(0);
  await page.getByRole("button", { name: /Pay ৳400/ }).click();
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  expect(sent).toBe(1);
  await ctx.close();
});

test("in Bangla on a 360 px phone: the address and licence, ভর্তি চলছে on each open class, and the box with its links and message all fit", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 800 } });
  await useLang(ctx, "bn");
  const page = await ctx.newPage();
  await page.goto("/courses");
  await expect(page.locator(".card .stock.in").first()).toHaveText("ভর্তি চলছে");
  const footer = page.locator("footer");
  await expect(footer).toContainText("নিবন্ধিত ঠিকানা: রোড নং-০৩, বাড়ী # ৪২, বি-ব্লক, চান্দগাঁও, চট্টগ্রাম");
  await expect(footer).toContainText("ট্রেড লাইসেন্স নং: TRADICHTG/010407/2022");
  expect(await page.evaluate(noSideScroll)).toBe(true);

  await page.goto("/app/checkout?c=beginners-baking-class");
  const box = page.getByRole("checkbox", { name: AGREE });
  await expect(box).not.toBeChecked();
  await expect(page.locator(".agree").getByRole("link", { name: "রিফান্ড ও বাতিল নীতি" })).toHaveAttribute("href", "/policies/refund");
  await page.getByText("টেস্ট পেমেন্ট").click();
  await page.getByRole("button", { name: /পেমেন্ট করুন$/ }).click();
  await expect(page.getByText("এগিয়ে যেতে ঘরে টিক দিয়ে সম্মতি দিন।")).toBeVisible();
  expect(await page.evaluate(noSideScroll)).toBe(true);
  await ctx.close();
});
