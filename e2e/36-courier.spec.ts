import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminLogin, apiGet, apiPost, apiSend, uniquePhone, useLang } from "./helpers";

/*
 * Sending shop parcels with a courier, end to end on a fresh local database, with Steadfast and Pathao stood in for by the Worker itself
 * (worker/src/routes/api/dev-courier.ts — made-up keys, nothing leaves this machine): the owner checks the couriers and chooses the Pathao
 * store, staff send one confirmed order to Steadfast and another to Pathao, the buyer sees which courier has the parcel and where to follow
 * it, and Steadfast's webhook marks the first one delivered — then the same screens in Bangla on a 360 px phone with the accessibility scan.
 */
test.describe.configure({ mode: "serial" });

const TAG = Date.now().toString(36);
let admin: Page;
const drawer = () => admin.getByRole("dialog");
const STORE = { enabled: true, cod: true, online: false, home_district: 8, fee_home: 60, fee_other: 120, free_over: 0, free_delivery: false, free_until: "", cod_charge: false, cod_pct: 1, cod_min: 0, delivery_bn: "", delivery_en: "" };
const orders: { code: string; key: string }[] = [];
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  // the shop, open, with one product; two cash-on-delivery orders to Chattogram, confirmed by staff
  expect((await apiSend(admin, "PUT", "/admin/settings/store", STORE)).status).toBe(200);
  const cat = await apiPost(admin, "/admin/shop/categories", { name_bn: `কুরিয়ার ${TAG}`, name_en: `Courier ${TAG}`, sort: 10, active: true });
  const product = await apiPost(admin, "/admin/shop/products", {
    name_bn: `পাইপিং ব্যাগ ${TAG}`,
    name_en: `Piping bag ${TAG}`,
    category_id: (cat.body as { item: { id: number } }).item.id,
    short_bn: "",
    short_en: "",
    body_bn: "",
    body_en: "",
    status: "published",
    featured: false,
    sort: 100,
    variants: [{ label_bn: "", label_en: "", price: 350, list_price: 0, stock: null, sku: "" }],
  });
  const variant = (product.body as { item: { variants: { id: number }[] } }).item.variants[0].id;
  for (let i = 0; i < 2; i++) {
    const placed = await admin.request.post("/api/shop/orders", {
      data: { items: [{ variant_id: variant, qty: 2 }], name: "Nasrin Sultana", phone: uniquePhone(), division_id: 1, district_id: 8, upazila_id: 0, union_id: 0, address: "Flat 3B, Road 7, Khulshi", note: "", payment: "cod", agree: true },
    });
    expect(placed.status()).toBe(201);
    const body = await placed.json();
    orders.push({ code: body.order.public_id, key: new URL(body.link, "http://x").searchParams.get("k")! });
    expect((await apiPost(admin, `/admin/shop/orders/${body.order.public_id}/status`, { status: "confirmed" })).status).toBe(200);
  }
});
test.afterAll(async () => {
  // the shop closed again, as the other tests expect it
  await apiSend(admin, "PUT", "/admin/settings/store", { ...STORE, enabled: false });
  await admin.context().close();
});

test("the owner checks the couriers: Steadfast's balance, Pathao's stores — and chooses the store parcels are picked up from", async () => {
  await admin.goto("/admin/shop?tab=settings");
  const box = admin.locator("section", { has: admin.getByRole("heading", { name: "Couriers (Steadfast, Pathao)" }) });
  await expect(box.getByText("Keys are in")).toHaveCount(2);
  await expect(box.getByText(/\/api\/courier\/steadfast$/)).toBeVisible();
  await expect(box.getByText(/\/api\/courier\/pathao$/)).toBeVisible();
  await box.getByRole("button", { name: "Check the couriers" }).click();
  await expect(box.getByText("connected · balance ৳1,520")).toBeVisible();
  await expect(box.getByText("connected · 1 store(s) — choose yours below")).toBeVisible();
  const store = box.getByLabel("Pathao store (where parcels are picked up)");
  await store.selectOption({ label: "MAWAH Chattogram (stand-in) — Chandgaon, Chattogram" });
  await expect(store).toHaveValue("130820");
  await box.getByLabel("Usual parcel weight (kg)").fill("1");
  await box.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await apiGet<{ pathao_store: number; weight: number }>(admin, "/admin/shop/couriers")).pathao_store).toBe(130820);
  expect((await apiGet<{ weight: number }>(admin, "/admin/shop/couriers")).weight).toBe(1);
  // opened again later (the stores not asked for yet), the chosen store is still the one shown
  await admin.reload();
  await expect(store).toHaveValue("130820");
  await expect(store.locator("option:checked")).toHaveText("MAWAH Chattogram (stand-in)");
});

test("staff send one order to Steadfast and one to Pathao; each is on its way with the courier's own numbers", async () => {
  await admin.goto("/admin/shop?tab=orders");
  await admin.getByRole("row", { name: new RegExp(orders[0].code) }).getByRole("button", { name: orders[0].code }).click();
  const panel = drawer();
  await expect(panel.getByText("The courier collects ৳760 from the buyer (cash on delivery).")).toBeVisible();
  await panel.getByLabel("Note for the rider (optional)").fill("Fragile: piping tips inside");
  await panel.getByRole("button", { name: "Send to Steadfast" }).click();
  await expect(admin.getByText("Sent to Steadfast. The order is now on its way.")).toBeVisible();
  await expect(panel.getByText("With Steadfast")).toBeVisible();
  await expect(panel.getByText("The courier's last word: in_review")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Mark as delivered" })).toBeVisible();
  await admin.keyboard.press("Escape");

  await admin.getByRole("row", { name: new RegExp(orders[1].code) }).getByRole("button", { name: orders[1].code }).click();
  await panel.getByLabel("Weight for Pathao (kg)").fill("1.5");
  await panel.getByRole("button", { name: "Send to Pathao" }).click();
  await expect(admin.getByText("Sent to Pathao. The order is now on its way.")).toBeVisible();
  await expect(panel.getByText("With Pathao")).toBeVisible();
  await expect(panel.getByText(/tracking code DL[0-9A-Z]{10}/)).toBeVisible();
  await expect(panel.getByText(/Delivery fee 70/)).toBeVisible();
});

test("the buyer sees which courier has the parcel and where to follow it; Steadfast's word that it was delivered closes the order", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const buyer = await ctx.newPage();
  await buyer.goto(`/app/shop/orders/${orders[0].code}?k=${orders[0].key}`);
  await expect(buyer.getByRole("heading", { name: "On the way" })).toBeVisible();
  await expect(buyer.getByText(/^Sent with Steadfast\. Tracking code: [0-9A-Z]{8}$/)).toBeVisible();
  await expect(buyer.getByRole("link", { name: "Follow it on Steadfast's website" })).toHaveAttribute("href", "https://steadfast.com.bd/");

  // Steadfast tells the website the parcel was delivered (its webhook, with the token the owner gave it)
  const order = (await apiGet<{ order: { courier_cid: string } }>(admin, `/admin/shop/orders/${orders[0].code}`)).order;
  const res = await admin.request.post("/api/courier/steadfast", {
    headers: { Authorization: "Bearer e2e-steadfast-webhook-token" },
    data: { notification_type: "delivery_status", consignment_id: Number(order.courier_cid), invoice: orders[0].code, cod_amount: 760, status: "delivered", tracking_message: "Delivered to Nasrin Sultana", updated_at: "2026-11-01 12:00:00" },
  });
  expect(res.status()).toBe(200);
  await buyer.reload();
  await expect(buyer.getByRole("heading", { name: "Delivered" })).toBeVisible();
  // without the token, nothing changes
  expect((await admin.request.post("/api/courier/steadfast", { data: { consignment_id: 1, invoice: orders[1].code, status: "delivered" } })).status()).toBe(401);
  await ctx.close();
});

test("in Bangla on a 360 px phone: the couriers' card, an order with Pathao and the buyer's page fit and pass the accessibility scan", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 800 } });
  await useLang(ctx, "bn");
  const page = await ctx.newPage();
  await adminLogin(page);
  await page.goto("/admin/shop?tab=settings");
  const box = page.locator("section", { has: page.getByRole("heading", { name: "কুরিয়ার (স্টেডফাস্ট, পাঠাও)" }) });
  await expect(box.getByText("কী দেওয়া আছে")).toHaveCount(2);
  await expect(box.getByLabel("পাঠাও স্টোর (যেখান থেকে পার্সেল নেওয়া হয়)")).toHaveValue("130820");
  expect(await noSideScroll(page)).toBe(true);
  await axe(page);

  await page.goto("/admin/shop?tab=orders");
  await page.getByRole("row", { name: new RegExp(orders[1].code) }).getByRole("button", { name: orders[1].code }).click();
  await expect(page.getByRole("dialog").getByText("Pathao-এর কাছে")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await axe(page);

  const buyer = await ctx.newPage();
  await buyer.goto(`/app/shop/orders/${orders[1].code}?k=${orders[1].key}`);
  await expect(buyer.getByText(/^Pathao দিয়ে পাঠানো হয়েছে। ট্র্যাকিং কোড: DL[0-9A-Z]{10}$/)).toBeVisible();
  await expect(buyer.getByRole("link", { name: "Pathao-এর ওয়েবসাইটে দেখুন" })).toHaveAttribute("href", "https://merchant.pathao.com/");
  expect(await noSideScroll(buyer)).toBe(true);
  await axe(buyer);
  await ctx.close();
});
