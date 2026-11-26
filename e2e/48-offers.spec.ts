import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiSend, useLang } from "./helpers";

/*
 * A class on offer, in a real browser: the owner sets an offer price and an end in the class editor; the class list's card, the class page
 * and the checkout show the regular price crossed out, the price now and the saving, the class page counts down to the end, and the
 * checkout charges the offer. Set SHOTS_DIR to keep pictures. Runs after the admin spec; the offer is taken off again at the end.
 */
test.describe.configure({ mode: "serial" });

const SLUG = "beginners-baking-class";
const shots = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string, sel: string) => {
  if (!shots) return;
  await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/${name}.png` });
};

let admin: Page;
let id = 0;
let price = 0;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  const list = await apiGet<{ items: { id: number; slug: string; price: number }[] }>(admin, "/admin/courses?per_page=100");
  const c = list.items.find((x) => x.slug === SLUG)!;
  id = c.id;
  price = c.price;
});
test.afterAll(async () => {
  await apiSend(admin, "PATCH", `/admin/courses/${id}`, { offer_price: null, offer_ends_at: null });
  await admin.context().close();
});

test("the owner sets an offer in the class editor: quick end buttons and a preview of how the website shows it", async () => {
  await admin.goto(`/admin/courses/${id}/edit`);
  const offer = admin.getByLabel("Offer price (optional)");
  await offer.fill(String(price - 100));
  await expect(admin.getByText("On the website:")).toContainText(`${Math.round((100 / price) * 100)}% off`);
  await admin.getByRole("button", { name: "Tonight 11:59 PM" }).click();
  await expect(admin.getByLabel("Offer ends (Bangladesh time)")).toHaveValue(/T23:59$/);
  await admin.getByRole("button", { name: "Save" }).first().click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  if (shots) await admin.locator(".offer-help").screenshot({ path: `${shots}/offer-admin.png` });
  // an offer not lower than the price is explained
  await offer.fill(String(price));
  await expect(admin.getByText("The offer price must be lower than the price.")).toBeVisible();
  await offer.fill(String(price - 100));
});

test("the class list, the class page and the checkout show it — the regular price crossed out, the saving, the time left — and charge it", async ({ browser }) => {
  // an end a few hours away, so the countdown has hours to show whatever the time of day
  expect((await apiSend(admin, "PATCH", `/admin/courses/${id}`, { offer_price: price - 100, offer_ends_at: new Date(Date.now() + 5 * 3600_000).toISOString() })).status).toBe(200);
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  const pct = `${Math.round((100 / price) * 100)}% off`;

  await page.goto("/en/courses");
  const card = page.locator("article", { has: page.locator(`a[href$="/courses/${SLUG}"]`) }).first();
  await expect(card.locator(".offer-line")).toBeVisible(); // seen, not only there (a class name once clashed with the pop-up's hidden card)
  await expect(card.locator(".offer-line del")).toHaveText(`৳${price.toLocaleString("en")}`);
  await expect(card.locator(".offer-line")).toContainText(pct);
  await expect(card.getByRole("link", { name: /Enroll Now/ })).toContainText(`৳${(price - 100).toLocaleString("en")}`);
  await shot(page, "offer-card", `article:has(a[href$="/courses/${SLUG}"])`);

  await page.goto(`/en/courses/${SLUG}`);
  const buy = page.locator(".ol-buy");
  await expect(buy).toContainText(pct);
  // the countdown moves (the server wrote the end's time; the page's script turns it into the time left)
  await expect(buy.locator("[data-offer-text]")).toContainText(/Offer ends in 0?(4|5):\d\d:\d\d/);
  const axe = await new AxeBuilder({ page }).include(".ol-buy").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await shot(page, "offer-class-page", ".ol-buy");

  await page.goto(`/app/checkout?c=${SLUG}`);
  const summary = page.locator(".summary-item").first();
  await expect(summary.locator("s")).toContainText(`৳${price.toLocaleString("en")}`);
  await expect(summary.locator(".off-chip")).toHaveText(pct);
  await expect(page.locator(".sum-row.total")).toContainText(`৳${(price - 100).toLocaleString("en")}`);
  await shot(page, "offer-checkout", ".summary-item");

  // on a phone, in Bangla: nothing spills sideways
  await ctx.close();
  const phone = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  await useLang(phone, "bn");
  const p = await phone.newPage();
  await p.goto(`/courses/${SLUG}`);
  await expect(p.locator(".ol-buy")).toContainText("ছাড়");
  expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await shot(p, "offer-phone-bn", ".ol-buy");
  await phone.close();
});
