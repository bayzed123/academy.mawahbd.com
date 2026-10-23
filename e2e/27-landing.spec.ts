import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminLogin, photoPng, useLang } from "./helpers";

/*
 * Landing pages, end to end: the owner makes a page in the admin, builds it from blocks (a banner with a picture, a class with its Enroll
 * button and the usual price, questions and answers), sees a dangerous button refused in plain words, publishes it, and a visitor reads
 * it in English and Bangla — on a 360 px phone too — and goes from its Enroll button straight to the class's checkout.
 */
test.describe.configure({ mode: "serial" });

const TAG = Date.now().toString(36);
const ADDRESS = `summer-offer-${TAG}`;
const TITLE = `Summer baking offer ${TAG}`;

let admin: Page;
const drawer = () => admin.getByRole("dialog");
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function axe(page: Page, scope: string) {
  const r = await new AxeBuilder({ page }).include(scope).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
});
test.afterAll(async () => admin.context().close());

test("the owner makes a page, builds it from blocks, is told what to fix, and publishes it", async ({ request }) => {
  await admin.goto("/admin/landing");
  await expect(admin.getByRole("heading", { level: 1, name: "Landing pages" })).toBeVisible();
  await admin.getByRole("button", { name: "+ Add" }).click();
  await drawer().getByLabel("Page name (Bangla)").fill(`গ্রীষ্মের বেকিং অফার ${TAG}`);
  await drawer().getByLabel("Page name (English)").fill(TITLE);
  await drawer().getByLabel("Address").fill(ADDRESS);
  await drawer().getByLabel("Search and share words (English)").fill("Three baking classes at one summer price.");
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  const row = admin.getByRole("row", { name: new RegExp(TITLE) });
  await expect(row).toContainText(`/l/${ADDRESS}`);
  await expect(row).toContainText("Draft");
  // a draft is not on the website
  expect((await request.get(`/en/l/${ADDRESS}`)).status()).toBe(404);

  await row.getByRole("button", { name: `Blocks of ${TITLE}` }).click();
  const ed = drawer();
  await expect(ed.getByText("No blocks yet.")).toBeVisible();
  // a banner: picture, heading, words, a button
  await ed.getByLabel("Kind of block to add").selectOption({ label: "Banner (picture, heading, button)" });
  await ed.getByRole("button", { name: "Add block" }).click();
  const one = ed.getByRole("group", { name: "1. Banner (picture, heading, button)" });
  await one.getByLabel("Picture", { exact: true }).setInputFiles({ name: "summer.png", mimeType: "image/png", buffer: photoPng(1200, 600, 7) });
  await expect(one.locator(".thumb img")).toBeVisible();
  await one.getByLabel("Heading (English)", { exact: true }).fill("Bake all summer");
  await one.getByLabel("Heading (Bangla)", { exact: true }).fill("সারা গ্রীষ্ম বেক করুন");
  await one.getByLabel("Words under the heading (English)").fill("Three classes, one price, until the end of June.");
  await one.getByLabel("Button words (English)").fill("See the classes");
  await one.getByLabel("Where the button goes").fill("javascript:alert(1)");
  // a class with its Enroll button and the usual price
  await ed.getByLabel("Kind of block to add").selectOption({ label: "Class with Enroll button" });
  await ed.getByRole("button", { name: "Add block" }).click();
  const two = ed.getByRole("group", { name: "2. Class with Enroll button" });
  const pickClass = two.getByLabel(/^Class/);
  await pickClass.selectOption((await pickClass.locator("option", { hasText: /^Beginners Baking Class ·/ }).getAttribute("value"))!);
  await two.getByLabel("Usual price (৳, optional)").fill("600");
  await expect(two.getByText("Visitors see “−33%”")).toBeVisible();
  // questions and answers
  await ed.getByLabel("Kind of block to add").selectOption({ label: "Questions and answers" });
  await ed.getByRole("button", { name: "Add block" }).click();
  const three = ed.getByRole("group", { name: "3. Questions and answers" });
  await three.getByRole("button", { name: "Add a question" }).click();
  await three.getByLabel("Question (English)").fill("Do I need an oven?");
  await three.getByLabel("Answer (English)").fill("A small **electric oven** is enough.");

  // the dangerous button is refused, in plain words, and nothing is stored
  await ed.getByRole("button", { name: "Save" }).click();
  await expect(one.getByText("Use a page of this site (/…), an https:// address, tel: or mailto:.")).toBeVisible();
  await one.getByLabel("Where the button goes").fill("/courses");
  // the class block moves above the banner and back: the order is the owner's
  await ed.getByRole("button", { name: "Move block 2 up" }).click();
  await expect(ed.getByRole("group", { name: "1. Class with Enroll button" })).toBeVisible();
  await ed.getByRole("button", { name: "Move block 2 up" }).click();
  await expect(ed.getByRole("group", { name: "1. Banner (picture, heading, button)" })).toBeVisible();
  await ed.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await axe(admin, '[role="dialog"]');
  await ed.getByRole("button", { name: "Close" }).click();

  // published from its details
  await row.getByRole("button", { name: /^Edit/ }).click();
  await drawer().getByLabel("Status").selectOption({ label: "Published" });
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await expect(row).toContainText("Published");
  await expect(row).toContainText("3");
});

test("a visitor reads it, opens a question, and goes from Enroll straight to the class's checkout", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto(`/en/l/${ADDRESS}`);
  await expect(page.getByRole("heading", { level: 1, name: "Bake all summer" })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(TITLE));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Three baking classes at one summer price.");
  await expect(page.locator(".lp-hero-img")).toBeVisible();
  await expect.poll(() => page.locator(".lp-hero-img").evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "See the classes" })).toHaveAttribute("href", "/courses");
  const buy = page.locator(".lp-buy");
  await expect(buy.locator(".lp-price s")).toContainText("৳600");
  await expect(buy.locator(".lp-off")).toHaveText("−33%");
  await page.getByText("Do I need an oven?").click();
  await expect(page.getByText("electric oven")).toBeVisible();
  await axe(page, "main");
  await buy.getByRole("link", { name: /^Enroll Now/ }).click();
  await expect(page).toHaveURL(/\/app\/checkout\?c=beginners-baking-class/);
  await ctx.close();
});

test("in Bangla on a 360 px phone the page fits and passes the accessibility scan", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 800 } });
  await useLang(ctx, "bn");
  const page = await ctx.newPage();
  await page.goto(`/l/${ADDRESS}`);
  await expect(page.getByRole("heading", { level: 1, name: "সারা গ্রীষ্ম বেক করুন" })).toBeVisible();
  // words the owner wrote only in English show in English rather than not at all
  await expect(page.getByText("Do I need an oven?")).toBeVisible();
  await expect(page.locator(".lp-buy .lp-off")).toHaveText("−৩৩%");
  expect(await noSideScroll(page)).toBe(true);
  await axe(page, "main");
  await ctx.close();
});
