import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../src/lib/crypto";
import { SETTING_DEFAULTS, setSetting } from "../src/lib/settings";
import { retryPurchases } from "../src/services/metaCapi";
import { Client, env, freshState, json, loginStaff, registerStudent } from "./helpers";

/*
 * Meta Conversions API. A paid order is reported to Meta by the server — once, with the same event ID the browser's Pixel uses
 * ("purchase." + the order's code) so Meta keeps one — carrying Meta's own cookies, the buyer's browser and address from checkout, and the
 * e-mail / phone / name only scrambled (SHA-256). Nobody is reported who may not be counted (Do Not Track, Global Privacy Control, "stop
 * counting", Europe without a yes), nothing without the owner's Pixel and token, and nothing from a copy of the site that does not measure.
 * The token is kept encrypted and never shown; the owner's test button marks its event with the test code. Meta itself is a stub here.
 */
const PIXEL = "123456789012";
const TOKEN = `EAAB${"x1Y2z3".repeat(12)}`;
const e = env as unknown as Record<string, string | undefined>;
const numbers = { bkash: "01711111111", nagad: "", rocket: "" };

let calls: { url: string; body: any }[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: { events_received: 1, fbtrace_id: "TRACE1" } };
function stubMeta() {
  calls = [];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(typeof input === "string" ? input : input instanceof Request ? input.url : input);
    if (!url.startsWith("https://graph.facebook.com/")) throw new Error(`unexpected fetch ${url}`);
    calls.push({ url, body: JSON.parse(String((init as RequestInit).body)) });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
}
async function until(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}

let seq = 0;
async function makeCourse(price = 1500) {
  const n = ++seq;
  const slug = `capi-test-${Date.now().toString(36)}-${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, 'published', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `সিএপিআই ${n}`, `CAPI Course ${n}`, price)
    .run();
  return { id: res.meta.last_row_id as number, slug };
}

async function setup(over: { test?: string; token?: boolean } = {}) {
  await setSetting(env, "analytics", { ...SETTING_DEFAULTS.analytics, meta_pixel: PIXEL, meta_capi_test: over.test ?? "" }, null);
  await setSetting(env, "payments", { ...SETTING_DEFAULTS.payments, manual: true, manual_numbers: numbers }, null);
  freshState();
  const owner = (await loginStaff("super_admin")).client;
  if (over.token !== false) expect((await owner.put("/api/admin/analytics/meta/token", { token: ` "${TOKEN}"\n` })).status).toBe(200);
  return owner;
}

/** A student buys by send-money (with the given browser), sends the TrxID, and staff approve: the order is paid. */
async function buyAndApprove(opts: { headers?: Record<string, string>; cookies?: Record<string, string> } = {}) {
  const course = await makeCourse();
  const { client, email } = await registerStudent();
  for (const [k, v] of Object.entries(opts.cookies ?? {})) client.jar.set(k, v);
  const res = await client.fetch("/api/checkout", {
    method: "POST",
    json: { agree: true, courses: [course.slug], channel: "manual", manual: { method: "bkash" } },
    headers: { "user-agent": "TestBrowser/1.0 (Android)", referer: `${env.SITE_URL.replace(/\/$/, "")}/app/checkout?c=${course.slug}`, ...(opts.headers ?? {}) },
  });
  expect(res.status).toBe(201);
  const publicId = (await json(res)).order.public_id as string;
  await client.post(`/api/checkout/${publicId}/proof`, { trx_id: `TRX${Date.now().toString(36).toUpperCase()}` });
  const id = (await env.DB.prepare("SELECT id FROM orders WHERE public_id = ?").bind(publicId).first<any>()).id;
  const support = (await loginStaff("support")).client;
  expect((await support.post(`/api/admin/orders/${id}/approve`)).status).toBe(200);
  return { course, client, email, publicId, id, support };
}

beforeEach(() => {
  e.ANALYTICS_DEV = "true"; // this copy of the site measures (as the real one does)
  answer = { status: 200, body: { events_received: 1, fbtrace_id: "TRACE1" } };
});
afterEach(async () => {
  e.ANALYTICS_DEV = "false";
  vi.restoreAllMocks();
  await env.DB.prepare("DELETE FROM settings WHERE key = 'meta_capi_token'").run();
  await setSetting(env, "analytics", SETTING_DEFAULTS.analytics, null);
  freshState();
});

describe("a paid order is reported to Meta from the server", () => {
  it("once, deduplicated with the Pixel, with Meta's cookies, the browser, and the buyer's details only scrambled", async () => {
    await setup();
    stubMeta();
    const fbp = "fb.1.1763500000000.1234567890";
    const fbc = "fb.1.1763500000000.IwAR0abcdefGHIJK";
    const { course, client, email, publicId, id, support } = await buyAndApprove({ cookies: { _fbp: fbp, _fbc: fbc } });
    expect(await until(() => calls.length === 1)).toBe(true);

    const call = calls[0];
    expect(call.url).toBe(`https://graph.facebook.com/v24.0/${PIXEL}/events`);
    expect(call.url, "the token is never in the address").not.toContain(TOKEN);
    expect(call.body.access_token).toBe(TOKEN);
    expect(call.body.test_event_code).toBeUndefined();
    const ev = call.body.data[0];
    expect(ev).toMatchObject({ event_name: "Purchase", event_id: `purchase.${publicId}`, action_source: "website", event_source_url: expect.stringContaining("/app/checkout") });
    expect(ev.custom_data).toMatchObject({ currency: "BDT", value: 1500, order_id: publicId, content_type: "product", content_ids: [course.slug], num_items: 1 });
    expect(ev.custom_data.contents).toEqual([{ id: course.slug, quantity: 1, item_price: 1500 }]);
    expect(ev.user_data).toMatchObject({
      em: [await sha256Hex(email.toLowerCase())],
      ph: [await sha256Hex("8801712345678")],
      fn: [await sha256Hex("test")],
      ln: [await sha256Hex("student")],
      country: [await sha256Hex("bd")],
      fbp,
      fbc,
      client_ip_address: client.ip,
      client_user_agent: "TestBrowser/1.0 (Android)",
    });
    expect(JSON.stringify(ev), "nothing personal in plain text").not.toContain(email);
    expect(JSON.stringify(ev)).not.toContain("01712345678");

    // reported once: the order is marked, and what the browser said is forgotten
    const row = await env.DB.prepare("SELECT capi_sent_at, ad_track FROM orders WHERE id = ?").bind(id).first<any>();
    expect(row.capi_sent_at).toBeTruthy();
    expect(row.ad_track).toBeNull();
    expect((await support.post(`/api/admin/orders/${id}/approve`)).status).toBe(409);
    await retryPurchases(env);
    expect(calls).toHaveLength(1);

    // the owner sees Meta's answer
    const owner = (await loginStaff("super_admin")).client;
    const meta = (await json(await owner.get("/api/admin/analytics/meta"))).meta;
    expect(meta).toMatchObject({ ready: true, pixel: PIXEL, token: { source: "admin", hint: `••••${TOKEN.slice(-4)}` }, last: { ok: true, event: "Purchase", test: false } });
  });

  it("is not reported for a buyer who asked not to be counted, nor in Europe without a yes", async () => {
    await setup();
    stubMeta();
    await buyAndApprove({ headers: { dnt: "1" } });
    await buyAndApprove({ headers: { "sec-gpc": "1" } });
    await buyAndApprove({ cookies: { mawah_measure: "off" } });
    await buyAndApprove({ headers: { "cf-ipcountry": "DE" } });
    await new Promise((r) => setTimeout(r, 200));
    expect(calls, "nobody of these four").toHaveLength(0);

    await buyAndApprove({ headers: { "cf-ipcountry": "DE" }, cookies: { mawah_measure: "on" } }); // said yes
    expect(await until(() => calls.length === 1)).toBe(true);
  });

  it("nothing is sent without the token, nor from a copy of the site that does not measure", async () => {
    await setup({ token: false });
    stubMeta();
    await buyAndApprove();
    e.ANALYTICS_DEV = "false";
    await setup();
    const { id } = await buyAndApprove();
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toHaveLength(0);
    expect((await env.DB.prepare("SELECT ad_track FROM orders WHERE id = ?").bind(id).first<any>()).ad_track).toBeNull();
  });

  it("while a test code is set every report carries it; a report Meta did not take is tried again later", async () => {
    await setup({ test: "TEST22309" });
    stubMeta();
    answer = { status: 400, body: { error: { message: "Invalid parameter", code: 100 }, fbtrace_id: "T2" } };
    const { id, publicId } = await buyAndApprove();
    expect(await until(() => calls.length === 1)).toBe(true);
    expect(calls[0].body.test_event_code).toBe("TEST22309");
    await new Promise((r) => setTimeout(r, 50));
    expect((await env.DB.prepare("SELECT capi_sent_at, ad_track FROM orders WHERE id = ?").bind(id).first<any>()).capi_sent_at).toBeNull();

    answer = { status: 200, body: { events_received: 1 } };
    await retryPurchases(env); // (it also reports any other paid order Meta has not had yet — one paid before the token was set, say)
    const mine = (c: { body: any }) => c.body.data[0].event_id === `purchase.${publicId}`;
    expect(calls.filter(mine)).toHaveLength(2);
    expect((await env.DB.prepare("SELECT capi_sent_at FROM orders WHERE id = ?").bind(id).first<any>()).capi_sent_at).toBeTruthy();
  });
});

describe("the Graph API version", () => {
  it("is the owner's when set; when Meta refuses it, the built-in one is used at once and the event still arrives", async () => {
    const owner = await setup();
    await setSetting(env, "analytics", { ...SETTING_DEFAULTS.analytics, meta_pixel: PIXEL, meta_graph_version: "v27.0" }, null);
    freshState();
    calls = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(typeof input === "string" ? input : input instanceof Request ? input.url : input);
      calls.push({ url, body: JSON.parse(String((init as RequestInit).body)) });
      const refused = url.includes("/v27.0/");
      return new Response(JSON.stringify(refused ? { error: { message: "Unknown path components: /v27.0", code: 2500 } } : { events_received: 1 }), { status: refused ? 400 : 200 });
    });
    const r = await json(await owner.post("/api/admin/analytics/meta/test", { test_code: "TEST22309" }));
    expect(calls.map((c) => c.url.split("/")[3])).toEqual(["v27.0", "v24.0"]);
    expect(r.result).toMatchObject({ ok: true, detail: expect.stringContaining("Meta refused v27.0") });
    expect((await owner.put("/api/admin/settings/analytics", { ...SETTING_DEFAULTS.analytics, meta_graph_version: "27" })).status, "only a version as Meta writes it").toBe(422);
  });
});

describe("the owner's screen", () => {
  it("keeps the token encrypted and never shows it; only the owner may change it; the test button needs a test code and shows Meta's answer", async () => {
    const owner = await setup();
    const viewer = (await loginStaff("viewer")).client;
    expect((await viewer.put("/api/admin/analytics/meta/token", { token: TOKEN })).status).toBe(403);
    expect((await owner.put("/api/admin/analytics/meta/token", { token: "short" })).status).toBe(422);

    const stored = await env.DB.prepare("SELECT value FROM settings WHERE key = 'meta_capi_token'").first<any>();
    expect(stored.value).not.toContain(TOKEN);
    const everything = JSON.stringify(await json(await owner.get("/api/admin/settings"))) + JSON.stringify(await json(await viewer.get("/api/admin/analytics/meta")));
    expect(everything).not.toContain(TOKEN);

    stubMeta();
    expect((await owner.post("/api/admin/analytics/meta/test", {})).status).toBe(422); // no code: never a test that would count as a sale
    const ok = await json(await owner.post("/api/admin/analytics/meta/test", { test_code: "TEST22309" }));
    expect(ok.result).toMatchObject({ ok: true, detail: "events_received: 1" });
    expect(calls[0].body).toMatchObject({ test_event_code: "TEST22309", data: [{ event_name: "Purchase" }] });

    answer = { status: 400, body: { error: { message: "Invalid OAuth access token - Cannot parse access token", code: 190 }, fbtrace_id: "T9" } };
    const bad = await json(await owner.post("/api/admin/analytics/meta/test", { test_code: "TEST22309" }));
    expect(bad.result).toMatchObject({ ok: false, detail: "#190 Invalid OAuth access token - Cannot parse access token", trace: "T9" });
    expect(bad.meta.last).toMatchObject({ ok: false, test: true });

    expect((await owner.del("/api/admin/analytics/meta/token")).status).toBe(200);
    expect((await json(await owner.get("/api/admin/analytics/meta"))).meta).toMatchObject({ ready: false, token: { source: "none" } });
  });
});

describe("an ad click is kept by the server", () => {
  it("a visitor from a Facebook ad gets Meta's _fbc cookie from the page itself — not with Do Not Track, not over their own", async () => {
    await setup({ token: false });
    const page = async (headers: Record<string, string> = {}) => new Client().fetch("/?fbclid=IwAR0Click123abc", { headers });
    const cookie = (await page()).headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/_fbc=fb\.1\.\d{13}\.IwAR0Click123abc; Path=\/; Max-Age=7776000; SameSite=Lax/);
    expect((await page({ dnt: "1" })).headers.get("set-cookie") ?? "").not.toContain("_fbc=");
    expect((await page({ cookie: "_fbc=fb.1.1.old" })).headers.get("set-cookie") ?? "").not.toContain("_fbc=");
    expect((await new Client().fetch("/")).headers.get("set-cookie") ?? "", "no ad click, no cookie").not.toContain("_fbc=");
  });
});
