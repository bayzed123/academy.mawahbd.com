import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { setSetting } from "../src/lib/settings";
import { SHOP_CSS } from "../src/generated/assets";
import { styleHash } from "../src/middleware/security";
import { runScheduled } from "../src/cron";
import { SSL_CAP_KEY } from "../src/services/payments/sslcommerz";
import { geoChildren, geoPlace } from "../src/services/geo";
import { DISTRICTS, DIVISIONS, UNIONS, UPAZILAS } from "../src/data/bd-geo";
import { Client, json, loginStaff, uniqueEmail } from "./helpers";

/*
 * The Equipment Shop. What it must never get wrong: a price is always the Worker's own (a cart holds only ids and quantities), the last one in
 * stock goes to one buyer only, an online order is paid only when SSLCommerz's own validation says so for this order and this exact amount,
 * a buyer's order opens only with the key in their link, an address is a real division → district → upazila → union, and the shop stays
 * shut until the owner has set what delivery costs. SSLCommerz is stood in for; nothing leaves the machine.
 */

const CHATTOGRAM = { division_id: 1, district_id: 8 };
const STORE = { enabled: true, cod: true, online: true, home_district: 8, fee_home: 80, fee_other: 150, free_over: 0, free_delivery: false, delivery_bn: "২–৩ দিন", delivery_en: "2–3 days" };

const owner = async () => (await loginStaff("super_admin")).client;
const mailsTo = async (to: string) => (await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(to)}`))).messages as { subject: string; text: string }[];
async function until<T>(fn: () => Promise<T | null | false>, ms = 1500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}

let seq = 0;
/** A published product with two weights (the 500 g one discounted, the 1 kg one with 3 in stock) in its own category. */
async function makeProduct(admin: Client, over: Record<string, unknown> = {}) {
  const n = ++seq;
  const cat = await json(await admin.post("/api/admin/shop/categories", { name_bn: `ক্যাটাগরি ${n}`, name_en: `Category ${n}`, sort: 10, active: true }));
  const res = await admin.post("/api/admin/shop/products", {
    name_bn: `কেকের ছাঁচ ${n}`,
    name_en: `Cake mould ${n}`,
    category_id: cat.item.id,
    short_bn: "অ্যালুমিনিয়াম",
    short_en: "Aluminium, non-stick",
    body_bn: "",
    body_en: "A sturdy mould.\n\n- Oven safe",
    status: "published",
    featured: false,
    sort: 100,
    variants: [
      { label_bn: "৫০০ গ্রাম", label_en: "500 g", price: 400, list_price: 500, stock: null, sku: "" },
      { label_bn: "১ কেজি", label_en: "1 kg", price: 700, list_price: 0, stock: 3, sku: "M1" },
    ],
    ...over,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const item = (await json(res)).item;
  const [small, big] = item.variants as { id: number; price: number; stock: number | null }[];
  return { id: item.id as number, slug: item.slug as string, category: cat.item.slug as string, categoryId: cat.item.id as number, small, big };
}

const address = { name: "Rina Akter", phone: "01711223366", ...CHATTOGRAM, upazila_id: 0, union_id: 0, address: "House 4, Road 2, Chandgaon", agree: true };

beforeEach(async () => {
  await setSetting(env, "store", STORE, null);
  await setSetting(env, "notifications", { emails: [], off: [] }, null);
});
afterEach(() => vi.restoreAllMocks());

describe("the Bangladesh address lists (Bangladesh-geocode)", () => {
  it("are complete and each place sits in a place that exists", () => {
    expect([DIVISIONS.length, DISTRICTS.length, UPAZILAS.length, UNIONS.length]).toEqual([8, 64, 494, 4540]);
    const ids = (l: typeof DIVISIONS) => new Set(l.map((p) => p[0]));
    for (const [list, parents] of [[DISTRICTS, ids(DIVISIONS)], [UPAZILAS, ids(DISTRICTS)], [UNIONS, ids(UPAZILAS)]] as const) for (const p of list) expect(parents.has(p[1])).toBe(true);
    for (const l of [DIVISIONS, DISTRICTS, UPAZILAS, UNIONS]) for (const p of l) expect(p[2] && p[3]).toBeTruthy();
  });

  it("are served one level at a time, in both languages", async () => {
    const get = async (path: string) => json(await new Client().get(`/api/shop/geo/${path}`));
    expect((await get("divisions")).items).toHaveLength(8);
    const districts = (await get("districts?division=1")).items as { id: number; name_en: string; name_bn: string }[];
    expect(districts.find((d) => d.id === 8)).toEqual({ id: 8, name_en: "Chattogram", name_bn: "চট্টগ্রাম" });
    expect((await get("districts")).items).toHaveLength(64);
    expect((await get("upazilas?district=1")).items.length).toBeGreaterThan(5);
    expect((await new Client().get("/api/shop/geo/unions")).status).toBe(422);
    expect((await new Client().get("/api/shop/geo/villages")).status).toBe(404);
  });

  it("an address is accepted only when its levels fit together", () => {
    const dist = geoChildren("districts", 1)[0];
    const upa = geoChildren("upazilas", dist.id)[0];
    const uni = geoChildren("unions", upa.id)[0];
    expect(geoPlace({ division_id: 1, district_id: dist.id, upazila_id: upa.id, union_id: uni.id })?.en).toBe(`${uni.name_en}, ${upa.name_en}, ${dist.name_en}, Chattagram`);
    expect(geoPlace({ ...CHATTOGRAM, upazila_id: 0, union_id: 0 })).toEqual({ en: "Chattogram city / town area, Chattogram, Chattagram", bn: "চট্টগ্রাম শহর এলাকা, চট্টগ্রাম, চট্টগ্রাম" });
    expect(geoPlace({ division_id: 2, district_id: 8, upazila_id: 0, union_id: 0 })).toBeNull(); // a district of another division
    const otherUpazila = geoChildren("upazilas", 8).length ? geoChildren("upazilas", 1)[0] : upa; // an upazila of another district
    expect(geoPlace({ ...CHATTOGRAM, upazila_id: otherUpazila.id, union_id: 0 })).toBeNull();
    expect(geoPlace({ ...CHATTOGRAM, upazila_id: 0, union_id: uni.id })).toBeNull(); // a union needs its upazila
    expect(geoPlace({ division_id: 1, district_id: dist.id, upazila_id: upa.id, union_id: 999999 })).toBeNull();
  });
});

describe("the shop's own settings", () => {
  it("stays shut until the owner sets the delivery charges (or free delivery) and a way to pay", async () => {
    const admin = await owner();
    const open = (over: Record<string, unknown>) => admin.put("/api/admin/settings/store", { ...STORE, ...over });
    expect((await json(await open({ fee_home: 0 }))).error.fields).toMatchObject({ fee_home: "required" });
    expect((await json(await open({ cod: false, online: false }))).error.fields).toMatchObject({ cod: "store_no_payment" });
    expect((await open({ home_district: 99 })).status).toBe(422);
    expect((await open({ fee_home: 0, fee_other: 0, free_delivery: true })).status).toBe(200);
    expect((await open({})).status).toBe(200);
    // a closed shop: no products and no orders; its page in the menus only says it opens soon (not for search engines)
    await setSetting(env, "store", { ...STORE, enabled: false }, null);
    const soon = await new Client().get("/shop");
    expect(soon.status).toBe(200);
    const soonHtml = await soon.text();
    expect(soonHtml).toContain("শীঘ্রই আসছে");
    expect(soonHtml).toContain('content="noindex');
    expect(soonHtml).not.toContain('class="pcard"');
    expect((await new Client().get("/en/shop")).status).toBe(200);
    expect((await new Client().get("/shop/category/moulds")).status).toBe(404);
    expect((await json(await new Client().get("/api/shop/config"))).open).toBe(false);
    expect((await new Client().post("/api/shop/orders", { items: [{ variant_id: 1, qty: 1 }], ...address, payment: "cod" })).status).toBe(409);
    expect((await json(await new Client().get("/api/site"))).site.shop).toMatchObject({ url: "/shop", internal: true });
  });
});

describe("the catalogue", () => {
  it("shows a product with its weights, the cheapest price first, the saving, and only what is for sale", async () => {
    const admin = await owner();
    const p = await makeProduct(admin);
    const list = await json(await new Client().get(`/api/shop/products?category=${p.category}`));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ slug: p.slug, price: 400, list_price: 500, several: true, variant_id: null, in_stock: true, reviews: 0, rating: null });
    const one = await json(await new Client().get(`/api/shop/products/${p.slug}`));
    expect(one.product.variants.map((v: { label_en: string; price: number; stock: number | null }) => [v.label_en, v.price, v.stock])).toEqual([
      ["500 g", 400, null],
      ["1 kg", 700, 3],
    ]);
    // a draft, or a product whose every weight is switched off, is not for sale
    await admin.patch(`/api/admin/shop/products/${p.id}`, { status: "draft" });
    expect((await new Client().get(`/api/shop/products/${p.slug}`)).status).toBe(404);
    expect((await new Client().get(`/shop/p/${p.slug}`)).status).toBe(404);
  });

  it("the pages: the grid with its categories and pages, and a product with its price, saving, description and search data", async () => {
    const admin = await owner();
    const p = await makeProduct(admin);
    const grid = await new Client().get("/en/shop");
    expect(grid.status).toBe(200);
    const g = await grid.text();
    expect(g).toContain(`/en/shop/category/${p.category}`);
    expect(g).toContain(`Cake mould ${seq}`);
    expect(g).toContain("−20%");
    const page = await new Client().get(`/en/shop/p/${p.slug}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("500 g");
    expect(html).toContain("1 kg");
    expect(html).toContain("<li>Oven safe</li>"); // the description is Markdown
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain('"lowPrice":400');
    expect(html).toMatch(/\/assets\/shop\.[a-f0-9]{10}\.js/);
    // the shop's look travels only with the shop's pages, allowed by its own hash; every other page stays as light as before
    expect(html).toContain(`<style>${SHOP_CSS}</style>`);
    expect(g).toContain(`<style>${SHOP_CSS}</style>`);
    expect(page.headers.get("content-security-policy")).toContain(await styleHash(SHOP_CSS));
    expect(await (await new Client().get("/en")).text()).not.toContain(SHOP_CSS);
    // the Bangla page, and the policy pages
    expect((await new Client().get(`/shop/p/${p.slug}`)).status).toBe(200);
    for (const path of ["/policies/shop-terms", "/policies/shop-returns", "/en/policies/shop-returns"]) expect((await new Client().get(path)).status, path).toBe(200);
    // the menus point at the shop here (an ordinary link, not a new tab)
    expect((await json(await new Client().get("/api/site"))).site.shop).toMatchObject({ url: "/shop", internal: true });
  });
});

describe("the grid, like a shop's category page", () => {
  it("filters by price and stock, sorts, says how many it shows, and numbers its pages", async () => {
    const admin = await owner();
    const p = await makeProduct(admin); // Cake mould: from ৳400
    const one = (price: number, stock: number | null) => [{ label_bn: "১টি", label_en: "1 pc", price, list_price: 0, stock, sku: "" }];
    const n = seq;
    await makeProduct(admin, { category_id: p.categoryId, name_en: `Spatula ${n}`, variants: one(150, null) });
    await makeProduct(admin, { category_id: p.categoryId, name_en: `Turntable ${n}`, variants: one(900, 0) });
    const grid = async (q = "") => {
      const res = await new Client().get(`/en/shop/category/${p.category}${q}`);
      expect(res.status, q).toBe(200);
      return res.text();
    };
    const all = await grid();
    expect(all).toContain("Showing all 3 results");
    expect(all).toContain(`<p class="pcard-cat">Category ${n}</p>`); // the category's name on each card
    for (const name of [`Cake mould ${n}`, `Spatula ${n}`, `Turntable ${n}`]) expect(all).toContain(name);
    // the price filter reads the price on the card; the two ends may be typed either way round
    for (const q of ["?min=300&max=800", "?min=800&max=300"]) {
      const mid = await grid(q);
      expect(mid, q).toContain("Showing the single result");
      expect(mid, q).toContain(`Cake mould ${n}`);
      expect(mid, q).not.toContain(`Spatula ${n}`);
      expect(mid, q).toContain('name="min" min="0" step="1" inputmode="numeric" value="300"');
    }
    // in stock only
    const inStock = await grid("?stock=1");
    expect(inStock).toContain("Showing all 2 results");
    expect(inStock).not.toContain(`Turntable ${n}`);
    // sorting by price, both ways; the other sortings answer too (and the API takes them)
    const asc = await grid("?sort=price_asc");
    expect(asc.indexOf(`Spatula ${n}`)).toBeLessThan(asc.indexOf(`Cake mould ${n}`));
    expect(asc.indexOf(`Cake mould ${n}`)).toBeLessThan(asc.indexOf(`Turntable ${n}`));
    const desc = await grid("?sort=price_desc");
    expect(desc.indexOf(`Turntable ${n}`)).toBeLessThan(desc.indexOf(`Spatula ${n}`));
    for (const sort of ["popular", "rating", "new"]) {
      expect(await grid(`?sort=${sort}`)).toContain(`<option value="${sort}" selected`);
      expect((await new Client().get(`/api/shop/products?sort=${sort}`)).status).toBe(200);
    }
    // more than a page: "Showing 1–12 of 14 results" and the page numbers
    for (let i = 0; i < 11; i++) await makeProduct(admin, { category_id: p.categoryId, name_en: `Piping tip ${n}-${i}`, variants: one(200 + i, null) });
    const first = await grid();
    expect(first).toContain("Showing 1–12 of 14 results");
    expect(first).toContain('class="pager pager-num"');
    expect(first).toContain(`href="/en/shop/category/${p.category}?page=2" aria-label="Page 2 of 2"`);
    expect(await grid("?page=2")).toContain("Showing 13–14 of 14 results");
    // a filtered or sorted grid is not for search engines; the plain one is
    expect(asc).toContain('content="noindex');
    expect(all).not.toContain('content="noindex');
  });
});

describe("the cart", () => {
  it("is priced by the Worker: unknown and sold-out weights are named, a quantity is cut to what is left, and delivery follows the district", async () => {
    const admin = await owner();
    const p = await makeProduct(admin);
    const quote = async (items: unknown, district_id?: number) => (await json(await new Client().post("/api/shop/quote", { items, district_id }))).quote;
    const q = await quote([{ variant_id: p.small.id, qty: 2 }, { variant_id: p.big.id, qty: 5 }, { variant_id: 999999, qty: 1 }]);
    expect(q.lines.map((l: { variant_id: number; qty: number; limited: boolean; price: number }) => [l.variant_id, l.qty, l.limited, l.price])).toEqual([
      [p.small.id, 2, false, 400],
      [p.big.id, 3, true, 700],
    ]);
    expect(q.gone).toEqual([999999]);
    expect(q).toMatchObject({ subtotal: 2900, delivery_fee: null, total: 2900, payments: ["cod", "sslcommerz"] });
    expect((await quote([{ variant_id: p.small.id, qty: 1 }], 8)).delivery_fee).toBe(80); // inside Chattogram
    expect((await quote([{ variant_id: p.small.id, qty: 1 }], 47)).delivery_fee).toBe(150); // Dhaka
    await setSetting(env, "store", { ...STORE, free_over: 1000 }, null);
    expect((await quote([{ variant_id: p.small.id, qty: 3 }], 47)).delivery_fee).toBe(0);
    // a price sent by the browser is never read
    expect((await quote([{ variant_id: p.small.id, qty: 1, price: 1 }], 8)).total).toBe(480);
  });
});

describe("cash on delivery", () => {
  it("an order at today's prices: stock taken, the owner told, and the buyer's link — and only that link — opens it", async () => {
    const to = uniqueEmail("owner");
    await setSetting(env, "notifications", { emails: [to], off: [] }, null);
    const admin = await owner();
    const p = await makeProduct(admin);
    const res = await new Client().post("/api/shop/orders", { items: [{ variant_id: p.small.id, qty: 2 }, { variant_id: p.big.id, qty: 1 }], ...address, payment: "cod" });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = await json(res);
    expect(body.order).toMatchObject({ status: "placed", total: 400 * 2 + 700 + 80 });
    expect(body.order.public_id).toMatch(/^SH[0-9A-Z]{10}$/);
    const key = new URL(`https://x${body.link}`).searchParams.get("k")!;
    expect(body.link).toBe(`/app/shop/orders/${body.order.public_id}?k=${key}`);
    expect((await env.DB.prepare("SELECT stock FROM shop_variants WHERE id = ?").bind(p.big.id).first<{ stock: number }>())!.stock).toBe(2);

    const mine = await json(await new Client().get(`/api/shop/orders/${body.order.public_id}?k=${key}`));
    expect(mine.order).toMatchObject({ status: "placed", payment: "cod", subtotal: 1500, delivery_fee: 80, total: 1580, place: "Chattogram city / town area, Chattogram, Chattagram", address: "House 4, Road 2, Chandgaon" });
    expect(mine.order.items.map((i: { label_en: string; qty: number }) => [i.label_en, i.qty])).toEqual([
      ["500 g", 2],
      ["1 kg", 1],
    ]);
    expect((await new Client().get(`/api/shop/orders/${body.order.public_id}`)).status).toBe(404);
    expect((await new Client().get(`/api/shop/orders/${body.order.public_id}?k=${"x".repeat(key.length)}`)).status).toBe(404);

    const note = await until(async () => (await mailsTo(to)).find((m) => /equipment shop/i.test(m.subject)) ?? false);
    expect(note.text).toContain(body.order.public_id);
    expect(note.text).toContain("Cash on delivery");
    expect(note.text).toContain("01711223366");
  });

  it("refuses a cart that changed (sold out meanwhile), a made-up address, and a missing agreement", async () => {
    const admin = await owner();
    const p = await makeProduct(admin);
    const order = (over: Record<string, unknown>) => new Client().post("/api/shop/orders", { items: [{ variant_id: p.big.id, qty: 1 }], ...address, payment: "cod", ...over });
    expect((await json(await order({ items: [{ variant_id: p.big.id, qty: 4 }] }))).error.code).toBe("cart_changed");
    expect((await json(await order({ district_id: 47 }))).error.fields).toMatchObject({ district_id: "invalid" });
    expect((await order({ agree: false })).status).toBe(422);
    expect((await order({ payment: "bkash" })).status).toBe(422);
    // the last three go to two buyers: the second is told the cart changed, and nothing was taken twice
    expect((await order({ items: [{ variant_id: p.big.id, qty: 3 }] })).status).toBe(201);
    expect((await json(await order({ items: [{ variant_id: p.big.id, qty: 1 }] }))).error.code).toBe("cart_changed");
    expect((await env.DB.prepare("SELECT stock FROM shop_variants WHERE id = ?").bind(p.big.id).first<{ stock: number }>())!.stock).toBe(0);
  });
});

describe("paying online (SSLCommerz stood in for)", () => {
  let validation: Record<string, unknown> | null = null;
  // what SSLCommerz answers a new session (a Response is made per call: a body cannot cross from one request to another)
  let session: Record<string, unknown> = {};
  beforeEach(() => {
    validation = null;
    session = { status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw?SESSIONKEY=shop", sessionkey: "shop" };
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("gwprocess")) {
        sent.push(new URLSearchParams(String(init?.body ?? "")));
        return Response.json(session);
      }
      if (url.includes("validationserverAPI")) return validation ? Response.json(validation) : new Response("down", { status: 503 });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch);
  });
  const sent: URLSearchParams[] = [];

  async function start(qty = 1) {
    const admin = await owner();
    const p = await makeProduct(admin);
    const res = await new Client().post("/api/shop/orders", { items: [{ variant_id: p.big.id, qty }], ...address, district_id: 8, payment: "sslcommerz" });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = await json(res);
    return { p, admin, body, code: body.order.public_id as string, key: new URL(`https://x${body.link}`).searchParams.get("k")! };
  }
  const valid = (code: string, amount: number, over: Record<string, unknown> = {}) => ({ status: "VALID", tran_id: code, amount: amount.toFixed(2), currency: "BDT", val_id: "v1", bank_tran_id: "BT1", card_type: "BKASH-BKash", risk_level: "0", ...over });
  const status = async (code: string, key: string) => (await json(await new Client().get(`/api/shop/orders/${code}?k=${key}`))).order.status;
  const stock = async (id: number) => (await env.DB.prepare("SELECT stock FROM shop_variants WHERE id = ?").bind(id).first<{ stock: number }>())!.stock;

  it("opens SSLCommerz's page for physical goods, and only SSLCommerz's own validation of this order and amount marks it paid", async () => {
    const { body, code, key } = await start(2);
    expect(body.redirect_url).toContain("sandbox.sslcommerz.com");
    const f = sent.at(-1)!;
    expect(f.get("tran_id")).toBe(code);
    expect(f.get("total_amount")).toBe("1480.00");
    expect(f.get("product_profile")).toBe("physical-goods");
    expect(f.get("num_of_item")).toBe("2");
    expect(f.get("cus_city")).toBe("Chattogram");
    expect(await status(code, key)).toBe("pending");
    // the browser landing on "success" proves nothing by itself
    expect((await new Client().fetch("/api/payments/sslcommerz/success", { method: "POST", form: { tran_id: code } })).status).toBe(303);
    expect(await status(code, key)).toBe("pending");
    // the server-to-server note, checked with SSLCommerz
    validation = valid(code, 1480);
    const ipn = await new Client().fetch("/api/payments/sslcommerz/ipn", { method: "POST", form: { tran_id: code, val_id: "v1" } });
    expect(await json(ipn)).toMatchObject({ status: "paid" });
    expect(await status(code, key)).toBe("paid");
    // SSLCommerz sends the buyer back to their own order page — never with its key: anyone who knows the code can call this address
    const back = await new Client().fetch("/api/payments/sslcommerz/success", { method: "POST", form: { tran_id: code, val_id: "v1" } });
    expect(back.headers.get("location")).toBe(`${env.SITE_URL}/app/shop/orders/${code}`);
    for (const path of ["success", "fail", "cancel"]) {
      const r = await new Client().fetch(`/api/payments/sslcommerz/${path}?tran_id=${code}`);
      expect(r.headers.get("location") ?? "").not.toContain(key);
    }
    expect(await status(code, key)).toBe("paid"); // a paid order is not closed by a "fail" or "cancel" call
  });

  it("a wrong amount fails it and gives the stock back; a risky payment waits for a person; a payment after the order was closed is not lost", async () => {
    const one = await start(1);
    validation = valid(one.code, 1, { amount: "1.00" });
    await new Client().fetch("/api/payments/sslcommerz/ipn", { method: "POST", form: { tran_id: one.code, val_id: "v1" } });
    expect(await status(one.code, one.key)).toBe("failed");
    expect(await stock(one.p.big.id)).toBe(3);

    const two = await start(1);
    validation = valid(two.code, 780, { risk_level: "1" });
    await new Client().fetch("/api/payments/sslcommerz/ipn", { method: "POST", form: { tran_id: two.code, val_id: "v1" } });
    expect(await status(two.code, two.key)).toBe("review");

    const three = await start(1);
    await new Client().fetch("/api/payments/sslcommerz/cancel", { method: "POST", form: { tran_id: three.code } });
    expect(await status(three.code, three.key)).toBe("cancelled");
    expect(await stock(three.p.big.id)).toBe(3);
    validation = valid(three.code, 780);
    await new Client().fetch("/api/payments/sslcommerz/ipn", { method: "POST", form: { tran_id: three.code, val_id: "v1" } });
    expect(await status(three.code, three.key)).toBe("review");
  });

  it("SSLCommerz saying no closes the order (stock back) and offers cash on delivery; an order never paid is closed by the night's housekeeping", async () => {
    session = { status: "FAILED", failedreason: "Store Credential Error Or Store is De-active" };
    const admin = await owner();
    const p = await makeProduct(admin);
    const res = await new Client().post("/api/shop/orders", { items: [{ variant_id: p.big.id, qty: 1 }], ...address, payment: "sslcommerz" });
    expect(res.status).toBe(502);
    expect((await json(res)).error.code).toBe("gateway_error");
    expect(await stock(p.big.id)).toBe(3);
    expect((await env.DB.prepare("SELECT status FROM shop_orders ORDER BY id DESC LIMIT 1").first<{ status: string }>())!.status).toBe("failed");
    // SSLCommerz's own limit on how much one payment may be is named as such, and the stock still goes back
    session = { status: "FAILED", failedreason: "Transaction amount is not allowed as per admin configuration!" };
    const capped = await new Client().post("/api/shop/orders", { items: [{ variant_id: p.big.id, qty: 1 }], ...address, payment: "sslcommerz" });
    expect(capped.status).toBe(502);
    expect((await json(capped)).error.code).toBe("gateway_amount_limit");
    expect(await stock(p.big.id)).toBe(3);
    await env.KV.delete(SSL_CAP_KEY);

    session = { status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw?SESSIONKEY=x", sessionkey: "x" };
    const left = await start(2);
    await env.DB.prepare("UPDATE shop_orders SET created_at = ? WHERE public_id = ?").bind(new Date(Date.now() - 30 * 3600_000).toISOString(), left.code).run();
    await runScheduled(env, "0 */6 * * *");
    expect(await status(left.code, left.key)).toBe("cancelled");
    expect(await stock(left.p.big.id)).toBe(3);
  });
});

describe("Admin → Shop → Orders", () => {
  it("moves an order one step at a time; a cancelled order gives its stock back, and a paid one is marked to refund", async () => {
    const admin = await owner();
    const p = await makeProduct(admin);
    const placed = await json(await new Client().post("/api/shop/orders", { items: [{ variant_id: p.big.id, qty: 2 }], ...address, payment: "cod" }));
    const code = placed.order.public_id;
    const step = (s: string, extra: Record<string, unknown> = {}) => admin.post(`/api/admin/shop/orders/${code}/status`, { status: s, ...extra });
    expect((await step("delivered")).status).toBe(409); // not yet
    expect((await json(await step("confirmed"))).order.next).toEqual(["shipped", "cancelled"]);
    const shipped = await json(await step("shipped", { courier_ref: "STF-12345" }));
    expect(shipped.order).toMatchObject({ status: "shipped", courier_ref: "STF-12345" });
    expect((await json(await step("delivered"))).order.status).toBe("delivered");
    expect((await step("cancelled")).status).toBe(409); // delivered is the end

    const list = await json(await admin.get("/api/admin/shop/orders?status=delivered"));
    expect(list.items.map((o: { public_id: string }) => o.public_id)).toContain(code);

    const other = await json(await new Client().post("/api/shop/orders", { items: [{ variant_id: p.big.id, qty: 1 }], ...address, payment: "cod" }));
    expect((await env.DB.prepare("SELECT stock FROM shop_variants WHERE id = ?").bind(p.big.id).first<{ stock: number }>())!.stock).toBe(0);
    expect((await json(await admin.post(`/api/admin/shop/orders/${other.order.public_id}/status`, { status: "cancelled" }))).order.status).toBe("cancelled");
    expect((await env.DB.prepare("SELECT stock FROM shop_variants WHERE id = ?").bind(p.big.id).first<{ stock: number }>())!.stock).toBe(1);

    // a paid order that is cancelled is "refunded": the money must go back
    const paid = await json(await new Client().post("/api/shop/orders", { items: [{ variant_id: p.small.id, qty: 1 }], ...address, payment: "cod" }));
    await env.DB.prepare("UPDATE shop_orders SET status = 'paid', paid_at = ? WHERE public_id = ?").bind(new Date().toISOString(), paid.order.public_id).run();
    expect((await json(await admin.post(`/api/admin/shop/orders/${paid.order.public_id}/status`, { status: "cancelled" }))).order.status).toBe("refunded");
  });

  it("who may do what: support handles orders, a content manager the products, a viewer only looks", async () => {
    const admin = await owner();
    const p = await makeProduct(admin);
    const placed = await json(await new Client().post("/api/shop/orders", { items: [{ variant_id: p.small.id, qty: 1 }], ...address, payment: "cod" }));
    const code = placed.order.public_id;
    const support = (await loginStaff("support")).client;
    const cm = (await loginStaff("content_manager")).client;
    const viewer = (await loginStaff("viewer")).client;
    expect((await support.post(`/api/admin/shop/orders/${code}/status`, { status: "confirmed" })).status).toBe(200);
    expect((await support.patch(`/api/admin/shop/products/${p.id}`, { featured: true })).status).toBe(403);
    expect((await cm.patch(`/api/admin/shop/products/${p.id}`, { featured: true })).status).toBe(200);
    expect((await cm.get("/api/admin/shop/orders")).status).toBe(403);
    expect((await viewer.get(`/api/admin/shop/orders/${code}`)).status).toBe(200);
    expect((await viewer.post(`/api/admin/shop/orders/${code}/status`, { status: "shipped" })).status).toBe(403);
    expect((await new Client().get("/api/admin/shop/orders")).status).toBe(401);
  });

  it("a weight taken off a product is switched off, not deleted: past orders keep it; a usual price below the price is refused", async () => {
    const admin = await owner();
    const p = await makeProduct(admin);
    const res = await admin.patch(`/api/admin/shop/products/${p.id}`, { variants: [{ id: p.small.id, label_bn: "৫০০ গ্রাম", label_en: "500 g", price: 450, list_price: 0, stock: null, sku: "" }] });
    expect(res.status).toBe(200);
    expect((await json(res)).item.variants).toHaveLength(1);
    expect((await env.DB.prepare("SELECT active FROM shop_variants WHERE id = ?").bind(p.big.id).first<{ active: number }>())!.active).toBe(0);
    const bad = await admin.patch(`/api/admin/shop/products/${p.id}`, { variants: [{ label_bn: "", label_en: "x", price: 500, list_price: 400, stock: null, sku: "" }] });
    expect(bad.status).toBe(422);
    // a weight id from another product is refused
    const other = await makeProduct(admin);
    expect((await admin.patch(`/api/admin/shop/products/${p.id}`, { variants: [{ id: other.small.id, label_bn: "", label_en: "a", price: 5, list_price: 0, stock: null, sku: "" }] })).status).toBe(422);
  });
});

describe("reviews", () => {
  it("show only once approved; a phone that received the product is marked a verified buyer", async () => {
    const admin = await owner();
    const p = await makeProduct(admin);
    const placed = await json(await new Client().post("/api/shop/orders", { items: [{ variant_id: p.small.id, qty: 1 }], ...address, payment: "cod" }));
    await env.DB.prepare("UPDATE shop_orders SET status = 'delivered' WHERE public_id = ?").bind(placed.order.public_id).run();
    const write = (phone: string, rating: number | string) => new Client().post(`/api/shop/products/${p.slug}/reviews`, { name: "Rina", phone, rating, body: "Very good mould" });
    expect((await write("01711223366", "5")).status).toBe(201);
    expect((await write("01811223366", 4)).status).toBe(201);
    expect((await json(await new Client().get(`/api/shop/products/${p.slug}`))).reviews).toHaveLength(0);
    const pending = (await json(await admin.get("/api/admin/shop/reviews?status=pending"))).items.filter((r: { product_slug: string }) => r.product_slug === p.slug);
    expect(pending.map((r: { verified: number; rating: number }) => [r.verified, r.rating]).sort()).toEqual([
      [0, 4],
      [1, 5],
    ]);
    for (const r of pending) expect((await admin.post(`/api/admin/shop/reviews/${r.id}`, { status: "approved" })).status).toBe(200);
    const shown = await json(await new Client().get(`/api/shop/products/${p.slug}`));
    expect(shown.reviews).toHaveLength(2);
    expect(shown.product).toMatchObject({ reviews: 2, rating: 4.5 });
    expect(JSON.stringify(shown)).not.toContain("01711223366"); // a phone is never shown
    expect((await new Client().post(`/api/shop/products/${p.slug}/reviews`, { name: "X", phone: "01711223366", rating: 9, body: "hm" })).status).toBe(422);
  });
});
