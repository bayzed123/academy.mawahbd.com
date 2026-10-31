import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminLogin, agree, uniquePhone, useLang } from "./helpers";

/*
 * The Equipment Shop, end to end on a fresh local database: the owner opens it (delivery charges, a category, a product with two weights and
 * their usual prices), a visitor finds it, chooses a weight, keeps it on the wishlist, adds it to the cart and orders it to a village in
 * Comilla with cash on delivery, staff take the order from "new" to "delivered", the buyer's review shows as a verified buyer's once
 * approved — and the pages read in Bangla on a 360 px phone and pass the accessibility scan. Nothing leaves this machine.
 */
test.describe.configure({ mode: "serial" });

const TAG = Date.now().toString(36);
const PRODUCT = `Silicone Cake Mould ${TAG}`;
const PRODUCT_BN = `সিলিকন কেক ছাঁচ ${TAG}`;
const CATEGORY = `Moulds ${TAG}`;
const BUYER = { name: "Shirin Akter", phone: uniquePhone() };

let admin: Page;
let productUrl = "";
let orderUrl = "";
let orderCode = "";

const drawer = () => admin.getByRole("dialog");
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
});
test.afterAll(async () => admin.context().close());

/** The shop's on/off switch, pressed on its label like a person does (the drawn track sits over the real checkbox). */
async function setShopOpen(on: boolean) {
  const sw = admin.getByRole("switch", { name: /^The shop is open/ });
  if ((await sw.isChecked()) !== on) await admin.locator("label.switch", { has: sw }).click();
  if (on) await expect(sw).toBeChecked();
  else await expect(sw).not.toBeChecked();
}

test("while the shop is closed, its menu link only says it opens soon", async ({ request }) => {
  for (const [path, words] of [["/shop", "শীঘ্রই আসছে"], ["/en/shop", "Opening soon"]]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const html = await res.text();
    expect(html, path).toContain(words);
    expect(html, path).not.toContain('class="pcard"');
  }
});

test("the owner opens the shop: delivery charges, a category, and a product with two weights and their usual prices", async () => {
  await admin.goto("/admin/shop?tab=settings");
  await expect(admin.getByRole("tab", { name: "Shop settings" })).toHaveAttribute("aria-selected", "true");
  await setShopOpen(true);
  // opened with no delivery charge set: the owner is told what is missing
  await admin.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("This field is required.").first()).toBeVisible();
  await admin.getByLabel("Your district", { exact: true }).selectOption({ label: "Comilla" });
  await admin.getByLabel("Charge inside your district (৳)").fill("60");
  await admin.getByLabel("Charge everywhere else (৳)").fill("120");
  await admin.getByLabel("How long delivery takes (English)").fill("1–2 days in Comilla, 3–5 days elsewhere");
  await admin.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();

  // the two offers: a cash-on-delivery charge at the couriers' 1% (at least ৳10), and free delivery from ৳2,000
  const codCharge = admin.getByRole("switch", { name: "Add a charge when the buyer pays on delivery" });
  await admin.locator("label.switch", { has: codCharge }).click();
  await expect(codCharge).toBeChecked();
  await admin.getByLabel("Percent of the cash collected (%)").fill("1");
  await admin.getByLabel("At least (৳, optional)").fill("10");
  await expect(admin.getByText("For example, an order of ৳1,000 with ৳120 delivery: paying on delivery adds ৳12.")).toBeVisible();
  const free = admin.locator("fieldset.offer-box", { hasText: "Free delivery offer" });
  await expect(free.getByText("Inactive", { exact: true })).toBeVisible();
  const freeSwitch = admin.getByRole("switch", { name: "Give free delivery" });
  await admin.locator("label.switch", { has: freeSwitch }).click();
  await expect(free.getByText("Active", { exact: true })).toBeVisible();
  await admin.getByLabel("Orders of a certain amount or more").check();
  await admin.getByLabel("Orders of this much or more (৳)").fill("2000");
  await expect(admin.getByText("Buyers see: Free delivery on orders of ৳2,000 or more")).toBeVisible();
  await admin.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await (await admin.request.get("/api/shop/config")).json()).free).toEqual({ from: 2000, until: "" });
  expect((await (await admin.request.get("/api/shop/config")).json()).cod_charge).toEqual({ pct: 1, min: 10 });

  await admin.getByRole("tab", { name: "Categories" }).click();
  await admin.getByRole("button", { name: "+ Add" }).click();
  await drawer().getByLabel(/^Name \(Bangla\)/).fill(`ছাঁচ ${TAG}`);
  await drawer().getByLabel(/^Name \(English\)/).fill(CATEGORY);
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await expect(admin.getByRole("cell", { name: CATEGORY })).toBeVisible();

  await admin.getByRole("tab", { name: "Products" }).click();
  await admin.getByRole("button", { name: "+ Add" }).click();
  const d = drawer();
  await d.getByLabel(/^Name \(Bangla\)/).fill(PRODUCT_BN);
  await d.getByLabel(/^Name \(English\)/).fill(PRODUCT);
  await d.getByLabel("Category").selectOption({ label: CATEGORY });
  await d.getByLabel("Status").selectOption({ label: "Published" });
  const one = d.getByRole("group", { name: "Weight or size 1" });
  await one.getByLabel("Weight / size (Bangla)").fill("৫০০ গ্রাম");
  await one.getByLabel("Weight / size (English)").fill("500 g");
  await one.getByLabel(/^Price \(৳\)/).fill("450");
  await one.getByLabel("Usual price (৳)").fill("500");
  await expect(one.getByText("Buyers see “−10%”")).toBeVisible();
  await d.getByRole("button", { name: "Add a weight or size" }).click();
  const two = d.getByRole("group", { name: "Weight or size 2" });
  await two.getByLabel("Weight / size (Bangla)").fill("১ কেজি");
  await two.getByLabel("Weight / size (English)").fill("1 kg");
  await two.getByLabel(/^Price \(৳\)/).fill("800");
  await two.getByLabel("Usual price (৳)").fill("1000");
  await two.getByLabel("In stock").fill("3");
  await expect(two.getByText("Buyers see “−20%”")).toBeVisible();
  await d.getByLabel("Short description (English)").fill("Food-grade silicone, oven safe to 230 °C.");
  await d.getByLabel("Short description (Bangla)").fill("ফুড-গ্রেড সিলিকন, ২৩০ °সে পর্যন্ত ওভেনে চলে।");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  const row = admin.getByRole("row", { name: new RegExp(PRODUCT) });
  await expect(row).toContainText("৳450 – ৳800");
  await expect(row).toContainText("Published");
});

test("a visitor finds it, chooses a weight, keeps it on the wishlist and adds two to the cart", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en/shop");
  await expect(page.getByRole("heading", { level: 1, name: "Equipment Shop" })).toBeVisible();
  await expect(page.locator(".offer-strip")).toContainText("Free delivery on orders of ৳2,000 or more");
  await expect(page.locator(".shop-count")).toHaveText(/^Showing (the single result|all \d+ results)$/); // a retry may have added one
  const card = page.locator("article.pcard", { hasText: PRODUCT });
  await expect(card).toContainText("From ৳450");
  await expect(card.locator(".off-badge")).toHaveText("−10%");
  // two weights: the card sends the buyer to the product page to choose
  await card.getByRole("link", { name: `Choose size — ${PRODUCT}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT })).toBeVisible();
  productUrl = new URL(page.url()).pathname;

  await expect(page.locator("[data-now]")).toHaveText("৳450");
  await expect(page.locator("[data-list-amount]")).toHaveText("৳500");
  await expect(page.locator("[data-off]")).toHaveText("−10%");
  await page.getByRole("radio", { name: "1 kg" }).check();
  await expect(page.locator("[data-now]")).toHaveText("৳800");
  await expect(page.locator("[data-list-amount]")).toHaveText("৳1,000");
  await expect(page.locator("[data-off]")).toHaveText("−20%");
  await expect(page.locator("[data-stock-line]")).toHaveText("Only 3 left");

  const heart = page.getByRole("button", { name: `Add to wishlist — ${PRODUCT}` });
  await heart.click();
  await expect(page.getByRole("button", { name: `Remove from wishlist — ${PRODUCT}` })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".shop-bar [data-wish-count]")).toHaveText("1");

  await page.getByRole("button", { name: "One more" }).click();
  await page.getByRole("button", { name: /^Add to cart/ }).click();
  await expect(page.getByText("Added to your cart.")).toBeVisible();
  await expect(page.locator(".shop-bar [data-cart-count]")).toHaveText("2");
  await axe(page);

  // the wishlist in the app keeps it
  await page.goto("/app/shop/wishlist");
  await expect(page.getByRole("link", { name: PRODUCT, exact: true })).toBeVisible();

  // the cart, priced again by the website, then the checkout
  await page.goto("/app/shop/cart");
  await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();
  const line = page.locator(".cart-line", { hasText: PRODUCT });
  await expect(line.getByRole("link", { name: PRODUCT, exact: true })).toBeVisible();
  await expect(line).toContainText("1 kg");
  await expect(line.getByRole("group", { name: `Quantity of ${PRODUCT}` })).toContainText("2");
  // ৳1,600 in the cart: ৳400 short of the free-delivery offer
  await expect(page.getByText("Add ৳400 more for free delivery.")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "On the way to free delivery" })).toHaveAttribute("aria-valuenow", "1600");
  await page.getByRole("link", { name: "Go to checkout" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();

  await page.getByLabel(/^Full name/).fill(BUYER.name);
  await page.getByLabel(/^Mobile number/).fill(BUYER.phone);
  // the address, one level at a time, from Bangladesh's own lists
  await page.getByLabel(/^Division/).selectOption({ label: "Chattagram" });
  await page.getByLabel(/^District/).selectOption({ label: "Comilla" });
  await expect(page.getByLabel(/^Upazila \/ thana/).locator("option", { hasText: "Comilla city or town area" })).toHaveCount(1);
  await page.getByLabel(/^Upazila \/ thana/).selectOption({ label: "Debidwar" });
  await page.getByLabel("Union (optional)").selectOption({ label: "Barkamta" });
  await page.getByLabel(/^House, road, area or village/).fill("Bari 4, near the primary school");
  await expect(page.getByText("1–2 days in Comilla, 3–5 days elsewhere")).toBeVisible();
  // inside the owner's district: ৳1,600 for the two moulds and ৳60 delivery; paying on delivery adds 1% of ৳1,660, rounded up: ৳17
  await expect(page.getByRole("radio", { name: /^Cash on delivery/ })).toBeChecked();
  await expect(page.locator("label.pay-opt", { hasText: "Cash on delivery" })).toContainText("+৳17 cash on delivery charge");
  await expect(page.locator(".sum-row", { hasText: "Cash on delivery charge" })).toContainText("৳17");
  await expect(page.locator(".sum-row.total")).toContainText("৳1,677");
  await expect(page.getByRole("link", { name: "Return & refund policy" })).toHaveAttribute("href", "/en/policies/shop-returns");

  // nothing is sent before the box is ticked
  await page.getByRole("button", { name: "Place order · ৳1,677" }).click();
  await expect(page.getByText("Please tick the box to agree before you continue.")).toBeVisible();
  await agree(page);
  await page.getByRole("button", { name: "Place order · ৳1,677" }).click();
  await expect(page).toHaveURL(/\/app\/shop\/orders\/SH[0-9A-Z]{10}\?k=/);
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
  await expect(page.getByText("Debidwar")).toBeVisible();
  await expect(page.locator(".sum-row", { hasText: "Cash on delivery charge" })).toContainText("৳17");
  await expect(page.locator(".sum-row.total")).toContainText("৳1,677");
  orderUrl = page.url();
  orderCode = /orders\/(SH[0-9A-Z]{10})/.exec(orderUrl)![1];
  // the cart is empty again
  await page.goto("/app/shop/cart");
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
  await ctx.close();
});

test("staff take the order from new to delivered, and the buyer's page follows", async ({ browser }) => {
  await admin.goto("/admin/shop?tab=orders");
  const row = admin.getByRole("row", { name: new RegExp(orderCode) });
  await expect(row).toContainText(BUYER.name);
  await expect(row).toContainText("New (cash on delivery)");
  await row.getByRole("button", { name: orderCode }).click();
  const panel = drawer();
  await expect(panel).toContainText("Bari 4, near the primary school, Barkamta, Debidwar, Comilla, Chattagram");
  await expect(panel).toContainText("৳60");
  await expect(panel.getByRole("row", { name: /Cash on delivery charge/ })).toContainText("৳17");
  await expect(panel.getByRole("row", { name: /Total/ })).toContainText("৳1,677");
  await panel.getByRole("button", { name: "Confirm order" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await panel.getByLabel("Courier tracking number").fill("STEADFAST-77812");
  await panel.getByRole("button", { name: "Mark as shipped" }).click();
  await expect(panel.getByRole("button", { name: "Mark as delivered" })).toBeVisible();

  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const buyer = await ctx.newPage();
  await buyer.goto(orderUrl);
  await expect(buyer.getByRole("heading", { name: "On the way" })).toBeVisible();
  await expect(buyer.getByText("Courier tracking number: STEADFAST-77812")).toBeVisible();
  // the buyer's own browser keeps the key, so the bare link still opens there; anyone else gets nothing without the key
  const bare = orderUrl.split("?")[0];
  await buyer.goto(bare);
  await expect(buyer.getByRole("heading", { name: "On the way" })).toBeVisible();
  const strangerCtx = await browser.newContext({ locale: "en-US" });
  await useLang(strangerCtx, "en");
  const stranger = await strangerCtx.newPage();
  await stranger.goto(bare);
  await expect(stranger.getByText("Courier tracking number: STEADFAST-77812")).toHaveCount(0);
  await expect(stranger.getByRole("heading", { name: "On the way" })).toHaveCount(0);
  await strangerCtx.close();

  await panel.getByRole("button", { name: "Mark as delivered" }).click();
  await expect(panel.getByText("Delivered", { exact: true })).toBeVisible();
  await buyer.goto(orderUrl);
  await expect(buyer.getByRole("heading", { name: "Delivered" })).toBeVisible();
  await ctx.close();
});

test("the buyer's review shows as a verified buyer's once staff approve it", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto(productUrl);
  await expect(page.getByText("No reviews yet.")).toBeVisible();
  await page.getByText("Write a review").click();
  await page.getByLabel("Your name").fill(BUYER.name);
  await page.getByLabel("Mobile number (not shown)").fill(BUYER.phone);
  await page.getByLabel("Your review").fill("Bakes evenly and comes out clean every time.");
  await page.getByRole("button", { name: "Send review" }).click();
  await expect(page.getByText("Thank you! Your review will show after we check it.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Bakes evenly and comes out clean every time.")).toHaveCount(0); // not before it is checked

  await admin.goto("/admin/shop?tab=reviews");
  const item = admin.locator("li.panel", { hasText: "Bakes evenly and comes out clean every time." });
  await expect(item).toContainText("Verified buyer");
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();

  await page.reload();
  const review = page.locator(".review", { hasText: "Bakes evenly and comes out clean every time." });
  await expect(review).toContainText(BUYER.name);
  await expect(review).toContainText("Verified buyer");
  await expect(review).not.toContainText(BUYER.phone); // the number is never shown
  await ctx.close();
});

test("in Bangla on a 360 px phone the shop, the product page and the checkout fit and pass the accessibility scan", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 800 } });
  await useLang(ctx, "bn");
  const page = await ctx.newPage();
  await page.goto("/shop");
  await expect(page.getByRole("heading", { level: 1, name: "ইকুইপমেন্ট শপ" })).toBeVisible();
  await expect(page.locator("article.pcard", { hasText: PRODUCT_BN })).toContainText("শুরু ৳৪৫০");
  expect(await noSideScroll(page)).toBe(true);
  await axe(page);

  await page.locator("article.pcard", { hasText: PRODUCT_BN }).getByRole("link", { name: PRODUCT_BN, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT_BN })).toBeVisible();
  await page.getByRole("radio", { name: "১ কেজি" }).check();
  await expect(page.locator("[data-now]")).toHaveText("৳৮০০");
  await expect(page.locator("[data-off]")).toHaveText("−২০%");
  expect(await noSideScroll(page)).toBe(true);
  await axe(page);
  await page.getByRole("button", { name: /^কার্টে যোগ করুন/ }).click();

  await page.goto("/app/shop/checkout");
  await page.getByLabel(/^বিভাগ/).selectOption({ label: "চট্টগ্রাম" });
  await page.getByLabel(/^জেলা/).selectOption({ label: "কুমিল্লা" });
  await expect(page.getByLabel(/^উপজেলা/)).toBeEnabled();
  expect(await noSideScroll(page)).toBe(true);
  await axe(page);
  await ctx.close();
});

test("closed again, the shop's pages are gone and nothing more can be ordered", async ({ request }) => {
  await admin.goto("/admin/shop?tab=settings");
  await setShopOpen(false);
  await admin.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  expect(await (await request.get("/shop")).text()).toContain("শীঘ্রই আসছে");
  expect((await request.get(productUrl)).status()).toBe(404);
  const cfg = await (await request.get("/api/shop/config")).json();
  expect(cfg.open).toBe(false);
});
