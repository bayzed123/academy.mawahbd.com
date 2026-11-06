import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { getSettings, setSetting } from "../src/lib/settings";
import { shopSms, type ShopTextStep } from "../src/lib/smsText";
import { Client, json, loginStaff } from "./helpers";

/*
 * Text messages to Equipment shop buyers: one when the order arrives (cash on delivery) or is paid (online), and one at each step staff or
 * the courier take — confirmed, on its way (with the tracking number), delivered, cancelled (paid online: the money comes back). Each in the
 * buyer's own language, with the order code and never a web address. What must never go wrong: a text that cannot go never breaks an
 * order; a visitor cannot use cash-on-delivery orders to flood a stranger's phone; a courier saying "delivered" twice sends one text; the
 * owner can switch shop texts off. SSLCommerz and the couriers are stood in for; texts go to the test outbox — nothing leaves the machine.
 */

const STORE = {
  enabled: true,
  cod: true,
  online: true,
  home_district: 8,
  fee_home: 80,
  fee_other: 150,
  free_over: 0,
  free_delivery: false,
  free_until: "",
  cod_charge: false,
  cod_pct: 1,
  cod_min: 0,
  delivery_bn: "",
  delivery_en: "",
};
const SMS = { enabled: true, sender_id: "", with_email: true, shop: true };

const owner = async () => (await loginStaff("super_admin")).client;
const textsTo = async (phone: string) =>
  ((await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(phone)}`))).messages as { text: string; sms?: boolean }[]).filter((m) => m.sms).map((m) => m.text);
async function until<T>(fn: () => Promise<T | null | false | undefined>, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 150));

let seq = 0;
/** A number of its own for each buyer, so the texts (and the hourly limit per number) of one test never mix with another's. */
const newPhone = () => `0181${String(Date.now() % 1_000_000).padStart(6, "0")}${++seq % 10}`;

/** A published product: one 400-taka weight, stock not counted. */
async function makeProduct(admin: Client) {
  const n = ++seq;
  const cat = await json(await admin.post("/api/admin/shop/categories", { name_bn: `টেক্সট ${n}`, name_en: `Texts ${n}`, sort: 10, active: true }));
  const res = await admin.post("/api/admin/shop/products", {
    name_bn: `ছাঁচ ${n}`,
    name_en: `Mould ${n}`,
    category_id: cat.item.id,
    short_bn: "",
    short_en: "",
    body_bn: "",
    body_en: "",
    status: "published",
    featured: false,
    sort: 100,
    variants: [{ label_bn: "৫০০ গ্রাম", label_en: "500 g", price: 400, list_price: 0, stock: null, sku: "" }],
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await json(res)).item.variants[0].id as number;
}

/** A buyer orders two of the 400-taka weight to Chattogram (৳880 with delivery). */
async function order(variant: number, over: Record<string, unknown> = {}) {
  const phone = (over.phone as string | undefined) ?? newPhone();
  const res = await new Client().post("/api/shop/orders", {
    items: [{ variant_id: variant, qty: 2 }],
    name: "Rina Akter",
    phone,
    division_id: 1,
    district_id: 8,
    upazila_id: 0,
    union_id: 0,
    address: "House 4, Road 2, Chandgaon",
    agree: true,
    payment: "cod",
    ...over,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const body = await json(res);
  return { phone, code: body.order.public_id as string, body };
}

/** How each text about an order went, from the activity log, oldest first. */
async function logged(code: string) {
  const rows = await env.DB.prepare("SELECT meta FROM activity_log WHERE action = 'shop_orders.texted' AND summary LIKE ? ORDER BY id").bind(`${code} ·%`).all<{ meta: string }>();
  return (rows.results ?? []).map((r) => JSON.parse(r.meta) as { step: ShopTextStep; sms: string });
}

beforeEach(async () => {
  await setSetting(env, "store", STORE, null);
  await setSetting(env, "sms", SMS, null);
  await setSetting(env, "notifications", { emails: [], off: [] }, null);
});
afterEach(() => vi.restoreAllMocks());

describe("the words of the shop texts", () => {
  const steps: ShopTextStep[] = ["placed", "paid", "confirmed", "shipped", "delivered", "cancelled", "refunded"];
  const d = { code: "SH0123456789", total: 12500, cod: true, courier: "steadfast", tracking: "SFR1234567890" };

  it("carry the order code and never a web address; the English ones are one plain text message each", () => {
    for (const step of steps) {
      for (const lang of ["bn", "en"] as const) {
        const text = shopSms(lang, step, d);
        expect(text, `${lang} ${step}`).toContain("SH0123456789");
        expect(text, `${lang} ${step}`).not.toMatch(/https?:|www\.|\.com/i);
      }
      const en = shopSms("en", step, d);
      expect(en.startsWith("MAWAH Academy: "), step).toBe(true);
      // plain letters only (one Bangla letter or a taka sign would make it the dearer kind, 70 letters a message) and short enough for one
      expect(en, step).toMatch(/^[\x20-\x7E]+$/);
      expect(en.length, step).toBeLessThanOrEqual(160);
      expect(shopSms("bn", step, d).startsWith("মাওয়াহ একাডেমি: "), step).toBe(true);
    }
  });

  it("say what to do: the amount to have ready for cash on delivery, the courier and tracking number, the money coming back", () => {
    expect(shopSms("en", "placed", d)).toBe("MAWAH Academy: we got your order SH0123456789 (Tk 12500, cash on delivery). We will confirm it soon.");
    expect(shopSms("en", "shipped", d)).toBe("MAWAH Academy: your order SH0123456789 is on its way (with Steadfast, tracking no. SFR1234567890). Please have Tk 12500 ready on delivery.");
    expect(shopSms("en", "shipped", { ...d, cod: false, courier: "", tracking: "" })).toBe("MAWAH Academy: your order SH0123456789 is on its way.");
    expect(shopSms("en", "confirmed", { ...d, cod: false })).toBe("MAWAH Academy: your order SH0123456789 is confirmed and will be sent soon.");
    expect(shopSms("en", "refunded", { ...d, cod: false })).toContain("Your payment of Tk 12500 will be refunded.");
    expect(shopSms("bn", "shipped", d)).toBe("মাওয়াহ একাডেমি: আপনার অর্ডার SH0123456789 পাঠানো হয়েছে (স্টেডফাস্ট, ট্র্যাকিং নম্বর SFR1234567890)। ডেলিভারির সময় ৳১২,৫০০ দেবেন।");
    expect(shopSms("bn", "paid", { ...d, cod: false })).toBe("মাওয়াহ একাডেমি: অর্ডার SH0123456789-এর পেমেন্ট পেয়েছি (৳১২,৫০০)। শিগগিরই কনফার্ম করব।");
    // what staff typed as the tracking number stays one short line
    expect(shopSms("en", "shipped", { ...d, courier: "", tracking: `  Sundarban\n  ${"9".repeat(60)}  ` })).toContain(`(tracking no. Sundarban ${"9".repeat(30)}).`);
  });
});

describe("texting the buyer at each step", () => {
  it("cash on delivery: received, confirmed, on its way with the tracking number, delivered — in Bangla unless the buyer read the site in English", async () => {
    const admin = await owner();
    const variant = await makeProduct(admin);
    const { phone, code } = await order(variant);
    const placed = await until(async () => (await textsTo(phone)).find((t) => t.includes(code)));
    expect(placed).toBe(`মাওয়াহ একাডেমি: আপনার অর্ডার ${code} পেয়েছি (৳৮৮০, ক্যাশ অন ডেলিভারি)। শিগগিরই কনফার্ম করব।`);
    expect((await env.DB.prepare("SELECT locale FROM shop_orders WHERE public_id = ?").bind(code).first<{ locale: string }>())!.locale).toBe("bn");

    const en = await order(variant, { lang: "en" });
    expect(await until(async () => (await textsTo(en.phone)).find((t) => t.includes(en.code)))).toBe(`MAWAH Academy: we got your order ${en.code} (Tk 880, cash on delivery). We will confirm it soon.`);

    const step = (status: string, extra: Record<string, unknown> = {}) => admin.post(`/api/admin/shop/orders/${en.code}/status`, { status, courier_ref: "", staff_note: "", ...extra });
    expect((await step("confirmed")).status).toBe(200);
    await until(async () => (await textsTo(en.phone)).length === 2);
    expect((await step("shipped", { courier_ref: "SB-4471" })).status).toBe(200);
    await until(async () => (await textsTo(en.phone)).length === 3);
    expect((await step("delivered", { courier_ref: "SB-4471" })).status).toBe(200);
    const texts = await until(async () => {
      const all = await textsTo(en.phone);
      return all.length === 4 && all;
    });
    expect(texts.slice(1)).toEqual([
      `MAWAH Academy: your order ${en.code} is confirmed and will be sent soon. Please have Tk 880 ready on delivery.`,
      `MAWAH Academy: your order ${en.code} is on its way (tracking no. SB-4471). Please have Tk 880 ready on delivery.`,
      `MAWAH Academy: your order ${en.code} was delivered. Thank you!`,
    ]);
    // the owner can see each one went (Admin → Activity)
    expect(await logged(en.code)).toEqual(["placed", "confirmed", "shipped", "delivered"].map((s) => ({ step: s, sms: "sent" })));
  });

  it("a cancelled order is told so; staff steps are not held back by the visitors' hourly limit", async () => {
    const admin = await owner();
    const variant = await makeProduct(admin);
    const { phone, code } = await order(variant, { lang: "en" });
    await until(async () => (await textsTo(phone)).length === 1);
    // three more orders from the same number within the hour: the visitors' limit (3 a number an hour) stops the last one's text
    const more: string[] = [];
    for (let i = 0; i < 3; i++) more.push((await order(variant, { phone, lang: "en" })).code);
    await until(async () => (await logged(more[2])).length === 1);
    expect((await textsTo(phone)).length).toBe(3);
    expect(await logged(more[2])).toEqual([{ step: "placed", sms: "not_sent" }]);
    // …but what staff do still reaches the buyer
    expect((await admin.post(`/api/admin/shop/orders/${code}/status`, { status: "cancelled", courier_ref: "", staff_note: "Out of stock" })).status).toBe(200);
    const cancelled = await until(async () => (await textsTo(phone)).find((t) => t.includes("cancelled")));
    expect(cancelled).toBe(`MAWAH Academy: your order ${code} was cancelled. Please contact us if you have a question.`);
  });

  it("the owner can switch shop texts off (or all texts); the order goes through all the same", async () => {
    const admin = await owner();
    const variant = await makeProduct(admin);
    await setSetting(env, "sms", { ...SMS, shop: false }, null);
    const quiet = await order(variant);
    expect((await admin.post(`/api/admin/shop/orders/${quiet.code}/status`, { status: "confirmed", courier_ref: "", staff_note: "" })).status).toBe(200);
    await setSetting(env, "sms", { ...SMS, enabled: false }, null);
    const off = await order(variant);
    expect((await admin.post(`/api/admin/shop/orders/${off.code}/status`, { status: "confirmed", courier_ref: "", staff_note: "" })).status).toBe(200);
    await settle();
    expect(await textsTo(quiet.phone)).toEqual([]);
    expect(await textsTo(off.phone)).toEqual([]);
    expect(await logged(quiet.code)).toEqual([]);
    // texts switched off altogether: each step is logged as not sent, so "why did the buyer get nothing" has its answer
    expect((await logged(off.code)).map((l) => l.sms)).toEqual(["not_sent", "not_sent"]);
  });
});

describe("the switch in Admin → Settings → SMS", () => {
  it("is on by default, is saved with the other SMS settings, and only staff who may change settings can change it", async () => {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'sms'").run();
    const admin = await owner();
    expect(await json(await admin.get("/api/admin/settings/sms"))).toMatchObject({ enabled: true, with_email: true, shop: true });
    expect((await admin.put("/api/admin/settings/sms", { enabled: true, sender_id: "8809601017241", with_email: true, shop: false })).status).toBe(200);
    expect((await getSettings(env, { fresh: true })).sms).toEqual({ enabled: true, sender_id: "8809601017241", with_email: true, shop: false });
    expect((await admin.put("/api/admin/settings/sms", { enabled: true, sender_id: "", with_email: true })).status).toBe(422);
    const support = (await loginStaff("support")).client;
    expect((await support.put("/api/admin/settings/sms", SMS)).status).toBe(403);
  });
});

describe("online payment and the couriers", () => {
  let validation: Record<string, unknown> | null = null;
  beforeEach(() => {
    validation = null;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("gwprocess")) return Response.json({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw?SESSIONKEY=t", sessionkey: "t" });
      if (url.includes("validationserverAPI")) return validation ? Response.json(validation) : new Response("down", { status: 503 });
      if (url.startsWith("https://portal.packzy.com/"))
        return Response.json({ status: 200, message: "Consignment has been created successfully.", consignment: { consignment_id: 5550000 + seq, invoice: "x", tracking_code: `TRK${seq}`, status: "in_review" } });
      return real(input as RequestInfo, init);
    }) as typeof fetch);
  });
  const valid = (code: string, amount: number) => ({ status: "VALID", tran_id: code, amount: amount.toFixed(2), currency: "BDT", val_id: "v1", bank_tran_id: "BT1", card_type: "BKASH-BKash", risk_level: "0" });
  const ipn = (code: string) => new Client().fetch("/api/payments/sslcommerz/ipn", { method: "POST", form: { tran_id: code, val_id: "v1" } });

  it("paid online: one text once SSLCommerz's own check says so (none for the unpaid order); cancelled after paying: the money comes back", async () => {
    const admin = await owner();
    const variant = await makeProduct(admin);
    const { phone, code } = await order(variant, { payment: "sslcommerz", lang: "en" });
    await settle();
    expect(await textsTo(phone)).toEqual([]); // nothing is said before the money is there
    validation = valid(code, 880);
    expect(await json(await ipn(code))).toMatchObject({ status: "paid" });
    expect(await until(async () => (await textsTo(phone)).find((t) => t.includes(code)))).toBe(`MAWAH Academy: payment received for order ${code} (Tk 880). We will confirm it soon.`);
    // SSLCommerz telling the site again changes nothing and sends nothing more
    await ipn(code);
    await settle();
    expect(await textsTo(phone)).toHaveLength(1);

    expect((await admin.post(`/api/admin/shop/orders/${code}/status`, { status: "cancelled", courier_ref: "", staff_note: "" })).status).toBe(200);
    expect(await until(async () => (await textsTo(phone)).find((t) => t.includes("refunded")))).toBe(`MAWAH Academy: your order ${code} was cancelled. Your payment of Tk 880 will be refunded.`);
  });

  it("booked with a courier: the text names it with its tracking number; its “delivered” sends one text, however often it says so", async () => {
    const admin = await owner();
    const variant = await makeProduct(admin);
    const { phone, code } = await order(variant);
    expect((await admin.post(`/api/admin/shop/orders/${code}/status`, { status: "confirmed", courier_ref: "", staff_note: "" })).status).toBe(200);
    const booked = await json(await admin.post(`/api/admin/shop/orders/${code}/courier`, { courier: "steadfast" }));
    expect(booked.order.status).toBe("shipped");
    const tracking = booked.order.courier_ref as string;
    const shipped = await until(async () => (await textsTo(phone)).find((t) => t.includes("পাঠানো হয়েছে")));
    expect(shipped).toBe(`মাওয়াহ একাডেমি: আপনার অর্ডার ${code} পাঠানো হয়েছে (স্টেডফাস্ট, ট্র্যাকিং নম্বর ${tracking})। ডেলিভারির সময় ৳৮৮০ দেবেন।`);

    const delivered = { notification_type: "delivery_status", consignment_id: Number(booked.order.courier_cid), invoice: code, cod_amount: 880, status: "delivered", tracking_message: "Delivered" };
    const say = () => new Client().fetch("/api/courier/steadfast", { method: "POST", json: delivered, headers: { Authorization: "Bearer test-steadfast-webhook-token" } });
    expect((await say()).status).toBe(200);
    expect((await say()).status).toBe(200);
    await until(async () => (await textsTo(phone)).some((t) => t.includes("ডেলিভারি হয়েছে")));
    await settle();
    const texts = await textsTo(phone);
    expect(texts.filter((t) => t.includes("ডেলিভারি হয়েছে"))).toEqual([`মাওয়াহ একাডেমি: আপনার অর্ডার ${code} ডেলিভারি হয়েছে। ধন্যবাদ!`]);
    expect((await logged(code)).map((l) => l.step)).toEqual(["placed", "confirmed", "shipped", "delivered"]);
  });
});
