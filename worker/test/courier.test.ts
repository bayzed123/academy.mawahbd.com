import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { setSetting } from "../src/lib/settings";
import { courierMeaning } from "../src/services/courier";
import { Client, json, loginStaff, uniqueEmail } from "./helpers";

/*
 * The couriers (Admin → Shop → Orders → Send to Steadfast / Pathao, and their webhooks). What must never go wrong: a parcel is booked only
 * for a confirmed order, once, with the right cash to collect; a courier's refusal reaches staff in its own words and leaves the order as
 * it was; only a courier holding the secret the owner gave it can change an order, and only from "shipped" to "delivered"; a parcel that
 * comes back is put in front of the owner. Steadfast and Pathao are stood in for: nothing leaves the machine.
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
const COURIER = { pathao_store: 130820, pathao_store_name: "MAWAH Chattogram", pathao_delivery: 48 as const, weight: 0.5 };
const address = { name: "Rina Akter", phone: "01711223366", division_id: 1, district_id: 8, upazila_id: 0, union_id: 0, address: "House 4, Road 2, Chandgaon", agree: true };

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
/** A cash-on-delivery order of two 400-taka moulds to Chattogram (৳880 with delivery), placed by a visitor and confirmed by staff. */
async function confirmedOrder(admin: Client, confirm = true): Promise<string> {
  const n = ++seq;
  const cat = await json(await admin.post("/api/admin/shop/categories", { name_bn: `কুরিয়ার ${n}`, name_en: `Courier ${n}`, sort: 10, active: true }));
  const product = await json(
    await admin.post("/api/admin/shop/products", {
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
    }),
  );
  const variant = product.item.variants[0].id as number;
  const placed = await json(await new Client().post("/api/shop/orders", { items: [{ variant_id: variant, qty: 2 }], ...address, note: "Call before coming", payment: "cod" }));
  const code = placed.order.public_id as string;
  if (confirm) expect((await admin.post(`/api/admin/shop/orders/${code}/status`, { status: "confirmed" })).status).toBe(200);
  return code;
}

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
}
/** Stand in for the couriers: every request to Steadfast's or Pathao's API gets `reply(call)`; the calls are kept to be looked at. */
function couriersSay(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://portal.packzy.com/") && !url.startsWith("https://api-hermes.pathao.com/")) return real(input as RequestInfo, init);
    const call: Call = { url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : {} };
    calls.push(call);
    return reply(call);
  });
  return calls;
}

beforeEach(async () => {
  await setSetting(env, "store", STORE, null);
  await setSetting(env, "courier", COURIER, null);
  await setSetting(env, "notifications", { emails: [], off: [] }, null);
  await env.KV.delete("courier:pathao:token");
});
afterEach(() => vi.restoreAllMocks());

describe("what a courier's word means", () => {
  it("delivered closes the order; returned, cancelled, failed, on hold or partly delivered needs the owner; anything else is news", () => {
    expect(["delivered", "order.delivered"].map(courierMeaning)).toEqual(["delivered", "delivered"]);
    expect(["partial_delivered", "cancelled", "order.returned", "order.delivery-failed", "hold", "order.on-hold", "order.pickup-cancelled"].map(courierMeaning)).toEqual(Array(7).fill("attention"));
    expect(["pending", "in_review", "order.picked", "order.in-transit", "tracking_update", "order.paid", ""].map(courierMeaning)).toEqual(Array(7).fill("news"));
  });
});

describe("sending a parcel from Admin → Shop → Orders", () => {
  it("Steadfast: a confirmed order is booked with the cash to collect and the whole address, once, and the order is on its way", async () => {
    const admin = await owner();
    expect(await json(await admin.get("/api/admin/shop/couriers"))).toMatchObject({ steadfast: true, pathao: true, pathao_store: 130820, weight: 0.5 });
    const calls = couriersSay(() => Response.json({ status: 200, message: "Consignment has been created successfully.", consignment: { consignment_id: 1424107, invoice: "x", tracking_code: "15BAEB8A", status: "in_review" } }));
    const code = await confirmedOrder(admin);
    const res = await admin.post(`/api/admin/shop/orders/${code}/courier`, { courier: "steadfast", note: "Fragile" });
    expect(res.status, await res.clone().text()).toBe(200);
    const { order } = await json(res);
    expect(order).toMatchObject({ status: "shipped", courier: "steadfast", courier_cid: "1424107", courier_ref: "15BAEB8A", courier_status: "in_review" });
    expect(order.courier_events.map((e: { event: string; status: string }) => [e.event, e.status])).toEqual([["booked", "in_review"]]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://portal.packzy.com/api/v1/create_order");
    expect(calls[0].headers.get("Api-Key")).toBe("test-steadfast-key");
    expect(calls[0].headers.get("Secret-Key")).toBe("test-steadfast-secret");
    expect(calls[0].body).toMatchObject({ invoice: code, recipient_name: "Rina Akter", recipient_phone: "01711223366", cod_amount: 880, note: "Call before coming · Fragile", total_lot: 2 });
    expect(calls[0].body.recipient_address).toMatch(/^House 4, Road 2, Chandgaon, .*Chattogram/);
    expect(calls[0].body.item_description).toMatch(/^Mould \d+ \(500 g\) × 2$/);

    // the buyer sees which courier has it and the code to follow it by; a second press books nothing more
    const key = (await env.DB.prepare("SELECT access_key FROM shop_orders WHERE public_id = ?").bind(code).first<{ access_key: string }>())!.access_key;
    expect((await json(await new Client().get(`/api/shop/orders/${code}?k=${key}`))).order).toMatchObject({ courier: "steadfast", courier_ref: "15BAEB8A", status: "shipped" });
    expect((await json(await admin.post(`/api/admin/shop/orders/${code}/courier`, { courier: "steadfast" }))).error.code).toBe("bad_step");
    expect(calls).toHaveLength(1);
  });

  it("only a confirmed order can be sent; a refusal comes back in the courier's own words and the order stays as it was", async () => {
    const admin = await owner();
    const placedOnly = await confirmedOrder(admin, false);
    expect((await json(await admin.post(`/api/admin/shop/orders/${placedOnly}/courier`, { courier: "steadfast" }))).error.code).toBe("bad_step");

    let answer: () => Response | Promise<Response> = () => Response.json({ status: 400, message: "Validation failed", errors: { recipient_phone: ["The recipient phone must be 11 digits."] } }, { status: 422 });
    couriersSay(() => answer());
    const code = await confirmedOrder(admin);
    const refused = await admin.post(`/api/admin/shop/orders/${code}/courier`, { courier: "steadfast" });
    expect(refused.status).toBe(502);
    const body = await json(refused);
    expect(body.error.code).toBe("courier_refused");
    expect(body.error.fields.detail).toBe("Validation failed · recipient_phone: The recipient phone must be 11 digits.");
    const after = (await json(await admin.get(`/api/admin/shop/orders/${code}`))).order;
    expect(after).toMatchObject({ status: "confirmed", courier: "", courier_cid: "", courier_ref: "" });

    // the courier cannot be reached: said so; then it answers and the same order goes
    answer = () => {
      throw new TypeError("network down");
    };
    expect((await json(await admin.post(`/api/admin/shop/orders/${code}/courier`, { courier: "steadfast" }))).error.code).toBe("courier_unanswered");
    answer = () => Response.json({ status: 200, consignment: { consignment_id: 77, tracking_code: "AB77", status: "in_review" } });
    expect((await json(await admin.post(`/api/admin/shop/orders/${code}/courier`, { courier: "steadfast" }))).order).toMatchObject({ status: "shipped", courier_ref: "AB77" });

    // a viewer can see the couriers but not send a parcel
    const viewer = (await loginStaff("viewer")).client;
    expect((await viewer.get("/api/admin/shop/couriers")).status).toBe(200);
    expect((await viewer.post(`/api/admin/shop/orders/${code}/courier`, { courier: "pathao" })).status).toBe(403);
  });

  it("Pathao: logs in once and keeps the token, books from the chosen store with the weight, and replaces a token Pathao no longer takes", async () => {
    const admin = await owner();
    let token = "tok-1";
    let refuseNext = false;
    const calls = couriersSay((call) => {
      if (call.url.endsWith("/aladdin/api/v1/external/login")) return Response.json({ type: "success", code: 200, data: { access_token: token, token_type: "Bearer", expires_in: 432000 } });
      if (call.url.endsWith("/aladdin/api/v1/orders")) {
        if (refuseNext) {
          refuseNext = false;
          return Response.json({ message: "Unauthenticated." }, { status: 401 });
        }
        return Response.json({ type: "success", code: 200, message: "Order Created Successfully", data: { consignment_id: `DL${call.body.merchant_order_id}`, merchant_order_id: call.body.merchant_order_id, order_status: "Pending", delivery_fee: 83 } });
      }
      return Response.json({ message: "not here" }, { status: 404 });
    });

    // no store chosen yet: said so before anything is sent
    await setSetting(env, "courier", { ...COURIER, pathao_store: 0 }, null);
    const first = await confirmedOrder(admin);
    expect((await json(await admin.post(`/api/admin/shop/orders/${first}/courier`, { courier: "pathao" }))).error.code).toBe("courier_no_store");
    await setSetting(env, "courier", COURIER, null);

    const one = await json(await admin.post(`/api/admin/shop/orders/${first}/courier`, { courier: "pathao", weight: 1.5 }));
    expect(one.order).toMatchObject({ status: "shipped", courier: "pathao", courier_cid: `DL${first}`, courier_ref: `DL${first}`, courier_status: "Pending" });
    expect(one.order.courier_events[0]).toMatchObject({ event: "booked", message: "Delivery fee 83" });
    const order = calls.find((c) => c.url.endsWith("/orders"))!;
    expect(calls[0].body).toEqual({ client_id: "test-pathao-client", client_secret: "test-pathao-client-secret" });
    expect(order.headers.get("Authorization")).toBe("Bearer tok-1");
    expect(order.body).toMatchObject({ store_id: 130820, merchant_order_id: first, delivery_type: 48, item_type: 2, item_quantity: 2, item_weight: 1.5, amount_to_collect: 880, recipient_phone: "01711223366" });

    // the second parcel uses the kept token; when Pathao turns it down, a new one is fetched once and the parcel still goes
    const second = await confirmedOrder(admin);
    expect((await json(await admin.post(`/api/admin/shop/orders/${second}/courier`, { courier: "pathao" }))).order.courier_cid).toBe(`DL${second}`);
    expect(calls.filter((c) => c.url.endsWith("/external/login"))).toHaveLength(1);
    token = "tok-2";
    refuseNext = true;
    const third = await confirmedOrder(admin);
    expect((await json(await admin.post(`/api/admin/shop/orders/${third}/courier`, { courier: "pathao" }))).order.courier_cid).toBe(`DL${third}`);
    expect(calls.filter((c) => c.url.endsWith("/external/login"))).toHaveLength(2);
    expect(calls.at(-1)!.headers.get("Authorization")).toBe("Bearer tok-2");
  });

  it("“Check the couriers”: Steadfast's balance and Pathao's stores, or each one's reason", async () => {
    const admin = await owner();
    couriersSay((call) => {
      if (call.url.endsWith("/get_balance")) return Response.json({ status: 200, current_balance: 1520.5 });
      if (call.url.endsWith("/external/login")) return Response.json({ data: { access_token: "tok", expires_in: 3600 } });
      if (call.url.endsWith("/aladdin/api/v1/stores")) return Response.json({ data: { data: [{ store_id: 130820, store_name: "MAWAH Chattogram", store_address: "Chandgaon", is_active: 1 }] } });
      return new Response("no", { status: 404 });
    });
    expect(await json(await admin.post("/api/admin/shop/couriers/check", {}))).toMatchObject({
      steadfast: { ok: true, data: { balance: 1520.5 } },
      pathao: { ok: true, data: [{ id: 130820, name: "MAWAH Chattogram", address: "Chandgaon", active: true }] },
    });
    vi.restoreAllMocks();
    couriersSay((call) => (call.url.endsWith("/get_balance") ? Response.json({ status: 401, message: "Unauthorized: invalid API key" }, { status: 401 }) : Response.json({ message: "Invalid client credentials" }, { status: 401 })));
    await env.KV.delete("courier:pathao:token");
    expect(await json(await admin.post("/api/admin/shop/couriers/check", {}))).toMatchObject({
      steadfast: { ok: false, problem: "refused", status: 401, detail: "Unauthorized: invalid API key" },
      pathao: { ok: false, problem: "refused", status: 401, detail: "Invalid client credentials" },
    });
    expect((await (await loginStaff("support")).client.post("/api/admin/shop/couriers/check", {})).status).toBe(403);
  });
});

describe("what the couriers tell the site (their webhooks)", () => {
  async function shippedWith(courier: "steadfast" | "pathao") {
    const admin = await owner();
    couriersSay((call) =>
      call.url.endsWith("/external/login")
        ? Response.json({ data: { access_token: "tok", expires_in: 3600 } })
        : courier === "steadfast"
          ? Response.json({ status: 200, consignment: { consignment_id: 900 + seq, tracking_code: `T${seq}`, status: "in_review" } })
          : Response.json({ data: { consignment_id: `DL${seq}`, order_status: "Pending" } }),
    );
    const code = await confirmedOrder(admin);
    const { order } = await json(await admin.post(`/api/admin/shop/orders/${code}/courier`, { courier }));
    vi.restoreAllMocks();
    return { admin, code, cid: order.courier_cid as string };
  }
  const steadfast = (body: unknown, token = "test-steadfast-webhook-token") => new Client().fetch("/api/courier/steadfast", { method: "POST", json: body, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const pathao = (body: unknown, headers: Record<string, string> = { "X-PATHAO-Signature": "test-pathao-webhook-secret" }) => new Client().fetch("/api/courier/pathao", { method: "POST", json: body, headers });

  it("Steadfast: only with its Bearer token; news is kept, “delivered” closes the order, “cancelled” goes to the owner", async () => {
    const to = uniqueEmail("owner");
    await setSetting(env, "notifications", { emails: [to], off: [] }, null);
    const { admin, code, cid } = await shippedWith("steadfast");
    const delivered = { notification_type: "delivery_status", consignment_id: Number(cid), invoice: code, cod_amount: 880, status: "delivered", delivery_charge: 60, tracking_message: "Delivered to the customer", updated_at: "2026-11-01 12:00:00" };
    expect((await steadfast(delivered, "")).status).toBe(401);
    expect((await steadfast(delivered, "wrong-token")).status).toBe(401);
    expect((await json(await admin.get(`/api/admin/shop/orders/${code}`))).order.status).toBe("shipped");

    const news = await steadfast({ notification_type: "tracking_update", consignment_id: Number(cid), invoice: code, tracking_message: "Parcel is at the Chattogram hub", updated_at: "2026-11-01 10:00:00" });
    expect(news.status).toBe(200);
    expect(await json(news)).toEqual({ status: "success", message: "Webhook received successfully." });
    let order = (await json(await admin.get(`/api/admin/shop/orders/${code}`))).order;
    expect(order).toMatchObject({ status: "shipped", courier_status: "in_review" });
    expect(order.courier_events.at(-1)).toMatchObject({ event: "tracking_update", status: "", message: "Parcel is at the Chattogram hub" });

    expect((await steadfast(delivered)).status).toBe(200);
    order = (await json(await admin.get(`/api/admin/shop/orders/${code}`))).order;
    expect(order).toMatchObject({ status: "delivered", courier_status: "delivered" });
    expect(order.delivered_at).toBeTruthy();
    // a parcel this site did not book is answered and dropped; a later word never reopens a closed order
    expect((await steadfast({ ...delivered, consignment_id: 1, invoice: "SHNOTOURS000" })).status).toBe(200);
    expect((await steadfast({ ...delivered, status: "cancelled" })).status).toBe(200);
    expect((await json(await admin.get(`/api/admin/shop/orders/${code}`))).order.status).toBe("delivered");

    const other = await shippedWith("steadfast");
    expect((await steadfast({ notification_type: "delivery_status", consignment_id: Number(other.cid), invoice: other.code, status: "cancelled", tracking_message: "Customer refused the parcel" })).status).toBe(200);
    expect((await json(await admin.get(`/api/admin/shop/orders/${other.code}`))).order).toMatchObject({ status: "shipped", courier_status: "cancelled" });
    const note = await until(async () => (await mailsTo(to)).find((m) => m.subject.includes(other.code) && m.subject.includes("Steadfast")) ?? false);
    expect(note.text).toContain("Steadfast");
    expect(note.text).toContain("Customer refused the parcel");
  });

  it("Pathao: its webhook check gets 202 and its secret back; everything else needs the signature; “order.delivered” closes the order", async () => {
    const check = await pathao({ event: "webhook_integration" }, { "X-Pathao-Merchant-Webhook-Integration-Secret": "f00d-cafe-1234" });
    expect(check.status).toBe(202);
    expect(check.headers.get("X-Pathao-Merchant-Webhook-Integration-Secret")).toBe("f00d-cafe-1234");
    expect((await pathao({ event: "webhook_integration" }, {})).status).toBe(202);

    const { admin, code, cid } = await shippedWith("pathao");
    const word = (event: string) => ({ consignment_id: cid, merchant_order_id: code, updated_at: "2026-11-01 12:00:00", timestamp: "2026-11-01T06:00:00+00:00", store_id: 130820, event, delivery_fee: 83 });
    expect((await pathao(word("order.delivered"), {})).status).toBe(401);
    expect((await pathao(word("order.delivered"), { "X-PATHAO-Signature": "not-it" })).status).toBe(401);
    expect((await pathao(word("order.in-transit"))).status).toBe(202);
    expect((await json(await admin.get(`/api/admin/shop/orders/${code}`))).order).toMatchObject({ status: "shipped", courier_status: "order.in-transit" });
    expect((await pathao(word("order.delivered"))).status).toBe(202);
    expect((await json(await admin.get(`/api/admin/shop/orders/${code}`))).order).toMatchObject({ status: "delivered", courier_status: "order.delivered" });
    // another courier's number never touches this order
    expect((await steadfast({ consignment_id: cid, invoice: code, status: "cancelled" })).status).toBe(200);
    expect((await json(await admin.get(`/api/admin/shop/orders/${code}`))).order.courier_status).toBe("order.delivered");
  });
});
