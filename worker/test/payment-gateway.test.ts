import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFY_KINDS, viaOf } from "@mawah/shared";
import { setSetting } from "../src/lib/settings";
import { notices } from "../src/services/notify";
import { SSL_CAP_KEY, SSL_LAST_KEY, SSL_WAYS_KEY, scrubSsl, sslCheck, sslHost, sslInit, sslMethods, sslProblem, type SslProblem } from "../src/services/payments/sslcommerz";
import { Client, env, json, loginStaff, registerStudent, uniqueEmail } from "./helpers";

/*
 * Online payment (SSLCommerz). A student who picks it and is turned away sees one thing — "could not start" — and from outside there is no way
 * to tell why: wrong keys, a store registered for another website, a firewall. The reason is in the gateway's own sentence, and these tests
 * protect what the owner cannot see: that sentence is kept (shortened, with the keys cut out) and reaches the owner — the activity log, an
 * e-mail, Settings → Payments → "Check the connection" — but never the student; the student gets a plain message and the order is closed;
 * every kind of "no" turns into the right problem; the check really asks the gateway like a purchase does, charges nothing, and shows nothing
 * secret; and only the owner can press it. Nothing here talks to SSLCommerz: it is stood in for.
 */

const e = env as { SSLCOMMERZ_STORE_ID?: string; SSLCOMMERZ_STORE_PASSWORD?: string; PAYMENT_MODE: string };
const STORE_ID = e.SSLCOMMERZ_STORE_ID;
const STORE_PASSWORD = e.SSLCOMMERZ_STORE_PASSWORD;

interface Call {
  url: string;
  method: string;
  headers: Headers;
  form: URLSearchParams;
}

/** Pretend SSLCommerz is at the other end: every request for a new session gets `reply(call)`. Returns the sessions it was asked for. */
function gatewaySays(reply: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/gwprocess/")) return real(input as RequestInfo, init);
    const call: Call = { url, method: init?.method ?? "GET", headers: new Headers(init?.headers), form: new URLSearchParams(String(init?.body ?? "")) };
    calls.push(call);
    return reply(call, calls.length);
  });
  return calls;
}
const GOOD = () => Response.json({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw/pay?SESSIONKEY=abc", sessionkey: "abc", failedreason: "" });
/** The ways of paying, as SSLCommerz lists them in its answer (`desc`): its names, kinds, logos and the address that opens each one. */
const GW = "https://sandbox.sslcommerz.com/gwprocess/v4";
const way = (name: string, type: string, gw: string, over: Record<string, unknown> = {}) => ({
  name,
  type,
  logo: `${GW}/image/gw/${gw}.png`,
  gw,
  r_flag: "1",
  redirectGatewayURL: `${GW}/bankgw/indexhtmlotp.php?mamount=1850.00&ssl_id=x1&Q=REDIRECT&SESSIONKEY=abc&tran_type=success&cardname=${gw}`,
  ...over,
});
const DESC = [
  way("VISA", "visa", "visacard"),
  way("bKash", "mobilebanking", "bkash"),
  way("Nagad", "mobilebanking", "nagad"),
  way("City Touch", "internetbanking", "city"),
  way("DBBL Mobile Banking", "mobilebanking", "dbblmobilebanking"),
  way("MASTER", "master", "mastercard"),
  way("Upay", "mobilebanking", "upay"),
  way("<b>AMEX</b>", "amex", "amexcard", { logo: "https://evil.example/amex.png" }), // markup in a name, a logo from elsewhere
  way("Elsewhere", "mobilebanking", "x", { redirectGatewayURL: "https://evil.example/pay" }), // an address that is not SSLCommerz's
  way("Plain http", "mobilebanking", "y", { redirectGatewayURL: "http://sandbox.sslcommerz.com/pay" }),
  way("Look-alike", "mobilebanking", "z", { redirectGatewayURL: "https://sslcommerz.com.evil.example/pay" }),
  way("", "mobilebanking", "nameless"),
  way("bKash again", "mobilebanking", "bkash"), // the same address twice
  "not an entry",
  null,
];
const WAYS = [
  ["bKash", "mobile", "bkash"],
  ["Nagad", "mobile", "nagad"],
  ["DBBL Mobile Banking", "mobile", "dbblmobilebanking"],
  ["Upay", "mobile", "upay"],
  ["VISA", "card", "visacard"],
  ["MASTER", "card", "mastercard"],
  ["AMEX", "card", "amexcard"],
  ["City Touch", "bank", "city"],
].map(([name, group, gw]) => ({
  name,
  via: ({ bkash: "bkash", nagad: "nagad", dbblmobilebanking: "rocket", upay: "upay", visacard: "visa", mastercard: "mastercard", amexcard: "amex" } as Record<string, string>)[gw] ?? null,
  group,
  logo: gw === "amexcard" ? null : `${GW}/image/gw/${gw}.png`,
  url: `${GW}/bankgw/indexhtmlotp.php?mamount=1850.00&ssl_id=x1&Q=REDIRECT&SESSIONKEY=abc&tran_type=success&cardname=${gw}`,
}));
const GOOD_WITH_WAYS = () => Response.json({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw/pay?SESSIONKEY=abc", sessionkey: "abc", failedreason: "", desc: DESC });
const NO = (reason: string, extra: Record<string, unknown> = {}) => Response.json({ status: "FAILED", failedreason: reason, sessionkey: "", GatewayPageURL: "", ...extra });

let seq = 0;
async function makeCourse(price = 1850) {
  const n = ++seq;
  const slug = `gateway-test-${Date.now().toString(36)}-${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, 'published', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `গেটওয়ে ক্লাস ${n}`, `Gateway Course ${n}`, price)
    .run();
  const courseId = res.meta.last_row_id as number;
  const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort) VALUES (?, 'মডিউল', 'Module', 1)").bind(courseId).run();
  await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, sort) VALUES (?, ?, 'লেসন', 'Lesson One', 'external', 'https://youtu.be/dQw4w9WgXcQ', 1)")
    .bind(courseId, mod.meta.last_row_id)
    .run();
  return { id: courseId, slug, title: `Gateway Course ${n}` };
}

const owner = async () => (await loginStaff("super_admin")).client;
const mailsTo = async (to: string) => (await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(to)}`))).messages as { subject: string; text: string; html: string }[];
async function until<T>(fn: () => Promise<T | null | false>, ms = 1500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}
/** The owner's address for one test: nobody else's notes land in it. */
async function ownerBox() {
  const to = uniqueEmail("owner");
  await setSetting(env, "notifications", { emails: [to], off: [] }, null);
  return to;
}
/** The dearest published class or bundle: the second amount "Check the connection" asks SSLCommerz for. */
const dearest = async () =>
  (await env.DB.prepare("SELECT MAX(p) AS top FROM (SELECT MAX(price) AS p FROM courses WHERE status = 'published' UNION ALL SELECT MAX(price) FROM bundles WHERE status = 'published')").first<{ top: number }>())!.top;
const audits = async (action: string) =>
  (await env.DB.prepare("SELECT summary, meta, entity_id FROM activity_log WHERE action = ? ORDER BY id DESC").bind(action).all<{ summary: string; meta: string; entity_id: string }>()).results;

beforeEach(async () => {
  e.SSLCOMMERZ_STORE_ID = STORE_ID;
  e.SSLCOMMERZ_STORE_PASSWORD = STORE_PASSWORD;
  await env.KV.delete(SSL_LAST_KEY);
  await env.KV.delete(SSL_WAYS_KEY);
  await env.KV.delete(SSL_CAP_KEY);
  await setSetting(env, "notifications", { emails: [], off: [] }, null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** SSLCommerz's words when the store's own settings limit how much one payment may be (seen on the live store, October 2026). */
const LIMIT_WORDS = "Transaction amount is not allowed as per admin configuration!";

describe("what a refusal means", () => {
  const cases: [number | undefined, string, SslProblem][] = [
    [undefined, "", "network"],
    [200, "Store Credential Error Or Store is De-active", "credentials"],
    [200, "Store Credential Error", "credentials"],
    [200, "Your store is suspended", "credentials"],
    [200, "Invalid store id", "credentials"],
    [401, "", "credentials"],
    [200, "Domain mismatch with the registered store URL", "domain"],
    [200, "This website is not registered for the store", "domain"],
    [200, "Request IP is not whitelisted", "blocked"],
    [200, "Your IP address has been blocked by the firewall", "blocked"],
    [403, "Access Denied", "blocked"],
    [429, "Too Many Requests", "blocked"],
    [200, LIMIT_WORDS, "amount_limit"],
    [200, "Amount exceeds the transaction limit", "amount_limit"],
    [200, "Maximum transaction amount exceeded", "amount_limit"],
    [200, "Invalid Information", "bad_details"],
    [200, "Duplicate Transaction ID", "bad_details"],
    [200, "total_amount is required", "bad_details"],
    [503, "Service Unavailable", "gateway_down"],
    [500, "Internal Server Error", "gateway_down"],
    [200, "Something this code has never seen", "other"],
  ];
  it.each(cases)("%s “%s” → %s", (status, said, problem) => {
    expect(sslProblem(status, said)).toBe(problem);
  });

  it("a firewall page with markup is read as words, and the store's keys never survive in them", () => {
    const e2 = { ...env, SSLCOMMERZ_STORE_ID: "my-store-id", SSLCOMMERZ_STORE_PASSWORD: "my/store pass" };
    expect(scrubSsl(e2, "<html><body><h1>Access  Denied</h1><p>store my-store-id pass my%2Fstore%20pass or my/store pass</p></body></html>")).toBe("Access Denied store … pass … or …");
    // a long token (a session key, a signed address) is cut out, and the whole is kept short
    expect(scrubSsl(e2, `see ${"A1b2".repeat(15)} now`)).toBe("see … now");
    expect(scrubSsl(e2, "x".repeat(900)).length).toBeLessThanOrEqual(300);
  });
});

describe("asking the gateway for a payment page", () => {
  const order = { public_id: "ORD123", total: 1850 };
  const buyer = { name: "Rina Akter", email: "rina@example.test", phone: "01712345678", address: "Dhaka" };

  it("sends the order as the gateway wants it — whole-number-free amount, the return addresses, no instalments — and hands back the page", async () => {
    const calls = gatewaySays(GOOD);
    const r = await sslInit(env, order, buyer, "Beginners baking");
    expect(r).toEqual({ ok: true, redirectUrl: "https://sandbox.sslcommerz.com/gw/pay?SESSIONKEY=abc", sessionKey: "abc", methods: [] });
    expect(calls).toHaveLength(1);
    const f = calls[0].form;
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`https://${sslHost(env)}/gwprocess/v4/api.php`);
    expect(f.get("total_amount")).toBe("1850.00");
    expect(f.get("currency")).toBe("BDT");
    expect(f.get("tran_id")).toBe("ORD123");
    expect(f.get("emi_option")).toBe("0");
    expect(f.get("store_id")).toBe(STORE_ID);
    expect(f.get("success_url")).toBe(`${env.SITE_URL}/api/payments/sslcommerz/success`);
    expect(f.get("fail_url")).toBe(`${env.SITE_URL}/api/payments/sslcommerz/fail`);
    expect(f.get("cancel_url")).toBe(`${env.SITE_URL}/api/payments/sslcommerz/cancel`);
    expect(f.get("ipn_url")).toBe(`${env.SITE_URL}/api/payments/sslcommerz/ipn`);
    expect(f.get("cus_email")).toBe("rina@example.test");
    expect(f.get("product_profile")).toBe("non-physical-goods");
    // a firewall that turns away requests with no name on them gets one
    expect(calls[0].headers.get("user-agent")).toMatch(/^MAWAH-Academy\//);
  });

  it("reads SSLCommerz's list of ways to pay — its names and logos, mobile wallets first — and keeps only SSLCommerz's own https addresses", async () => {
    expect(sslMethods(DESC)).toEqual(WAYS);
    // nothing usable: no list at all, or not a list
    for (const nothing of [undefined, null, "bkash", {}, 42, []]) expect(sslMethods(nothing)).toEqual([]);
    gatewaySays(GOOD_WITH_WAYS);
    const r = await sslInit(env, order, buyer, "Beginners baking");
    expect(r).toEqual({ ok: true, redirectUrl: "https://sandbox.sslcommerz.com/gw/pay?SESSIONKEY=abc", sessionKey: "abc", methods: WAYS });
  });

  it("keeps the gateway’s own sentence when it says no", async () => {
    gatewaySays(() => NO("Store Credential Error Or Store is De-active"));
    expect(await sslInit(env, order, buyer, "x")).toEqual({ ok: false, problem: "credentials", detail: "Store Credential Error Or Store is De-active", status: 200 });
  });

  it("never lets the store’s keys through, even if the gateway repeats them", async () => {
    gatewaySays(() => NO(`Invalid request for store ${STORE_ID} with password ${STORE_PASSWORD}`));
    const r = await sslInit(env, order, buyer, "x");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(STORE_ID!);
    expect(JSON.stringify(r)).not.toContain(STORE_PASSWORD!);
  });

  it("reads a firewall page, a gateway error, a missing page address and a dead connection — none of them throws", async () => {
    gatewaySays(() => new Response("<html><body><h1>403 Forbidden</h1></body></html>", { status: 403, headers: { "content-type": "text/html" } }));
    expect(await sslInit(env, order, buyer, "x")).toEqual({ ok: false, problem: "blocked", detail: "403 Forbidden", status: 403 });

    vi.restoreAllMocks();
    gatewaySays(() => new Response("upstream down", { status: 502 }));
    expect(await sslInit(env, order, buyer, "x")).toMatchObject({ ok: false, problem: "gateway_down", status: 502 });

    vi.restoreAllMocks();
    gatewaySays(() => Response.json({ status: "SUCCESS", GatewayPageURL: "" })); // "success" with no page to send the buyer to is not a success
    expect(await sslInit(env, order, buyer, "x")).toMatchObject({ ok: false });

    vi.restoreAllMocks();
    gatewaySays(() => {
      throw new TypeError("Network connection lost.");
    });
    expect(await sslInit(env, order, buyer, "x")).toEqual({ ok: false, problem: "network", detail: "Network connection lost." });
  });
});

describe("a student turned away at checkout", () => {
  it("is told plainly (and nothing of the gateway’s words), the order is closed, and nobody is charged", async () => {
    gatewaySays(() => NO("Store Credential Error Or Store is De-active"));
    const course = await makeCourse(1850);
    const { client } = await registerStudent(new Client(), { name: "Rina Akter", phone: "01711223344" });
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("gateway_error");
    expect(text).not.toMatch(/credential|de-active|sslcommerz/i);

    const order = await env.DB.prepare("SELECT status, note, gateway_ref FROM orders ORDER BY id DESC LIMIT 1").first<{ status: string; note: string; gateway_ref: string | null }>();
    expect(order).toMatchObject({ status: "failed", note: "gateway_init_failed" });
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(0);
  });

  it("leaves the reason where the owner can read it: the activity log, the last result and an e-mail", async () => {
    const to = await ownerBox();
    gatewaySays(() => NO("Store Credential Error Or Store is De-active"));
    const course = await makeCourse(1850);
    const { client } = await registerStudent(new Client(), { name: "Rina Akter", phone: "01711223344" });
    expect((await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" })).status).toBe(502);

    const [entry] = await audits("checkout.gateway_failed");
    expect(entry.summary).toBe("sslcommerz: credentials");
    expect(JSON.parse(entry.meta)).toEqual({ problem: "credentials", status: 200, said: "Store Credential Error Or Store is De-active" });

    expect(await env.KV.get(SSL_LAST_KEY, "json")).toMatchObject({ ok: false, problem: "credentials", detail: "Store Credential Error Or Store is De-active", by: "checkout", mode: "sandbox" });

    const note = await until(async () => (await mailsTo(to)).find((m) => /could not start the online payment/i.test(m.subject)) ?? false);
    expect(note.text).toContain("Rina Akter");
    expect(note.text).toContain("01711223344");
    expect(note.text).toContain(course.title);
    expect(note.text).toContain("Store Credential Error Or Store is De-active");
    expect(note.text).toContain("does not accept the store keys");
    expect(note.text).toContain("/admin/settings?tab=payments");
    expect(note.html).toContain("কোনো টাকা কাটা হয়নি"); // in Bangla as well
  });

  it("a purchase that goes through hands the buyer SSLCommerz's ways of paying to tap — each opening that way at once — and SSLCommerz's own page", async () => {
    gatewaySays(GOOD_WITH_WAYS);
    const course = await makeCourse(500);
    const { client } = await registerStudent();
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.redirect_url).toBe("https://sandbox.sslcommerz.com/gw/pay?SESSIONKEY=abc");
    expect(body.pay_methods).toEqual(WAYS);
    // only what the buyer needs: never another site's address, never the store's keys
    const text = JSON.stringify(body);
    expect(text).not.toContain("evil.example");
    expect(text).not.toContain("http://");
    expect(text).not.toContain(STORE_PASSWORD);
    // SSLCommerz sent no list: SSLCommerz's own page, as before
    vi.restoreAllMocks();
    gatewaySays(GOOD);
    const plain = await json(await client.post("/api/checkout", { agree: true, courses: [(await makeCourse(600)).slug], channel: "sslcommerz" }));
    expect(plain.redirect_url).toContain("sslcommerz.com");
    expect(plain.pay_methods).toEqual([]);
  });

  it("a way of paying tapped on the checkout goes straight to it at SSLCommerz — bKash to bKash, Rocket to DBBL's, a card to the card's", async () => {
    const { client } = await registerStudent();
    for (const [via, gw] of [["bkash", "bkash"], ["rocket", "dbblmobilebanking"], ["upay", "upay"], ["mastercard", "mastercard"], ["amex", "amexcard"]] as const) {
      vi.restoreAllMocks();
      const calls = gatewaySays(GOOD_WITH_WAYS);
      const res = await client.post("/api/checkout", { agree: true, courses: [(await makeCourse(700)).slug], channel: "sslcommerz", via });
      expect(res.status, via).toBe(201);
      const body = await json(res);
      expect(body.redirect_url, via).toBe(`https://sandbox.sslcommerz.com/gwprocess/v4/bankgw/indexhtmlotp.php?mamount=1850.00&ssl_id=x1&Q=REDIRECT&SESSIONKEY=abc&tran_type=success&cardname=${gw}`);
      expect(body.pay_methods).toEqual([]); // nothing to choose from: the buyer already chose
      expect(body.via_missing).toBeUndefined();
      expect(calls).toHaveLength(1); // one session, as for any purchase
    }
    expect((await audits("checkout.started"))[0].meta).toBe(JSON.stringify({ via: "amex", offered: true }));
  });

  it("a way SSLCommerz does not offer the shop brings SSLCommerz's list instead, saying so; an unknown way is refused", async () => {
    const { client } = await registerStudent();
    // this shop has only bKash and Visa switched on
    gatewaySays(() => Response.json({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw/pay?SESSIONKEY=abc", sessionkey: "abc", desc: DESC.filter((d) => d && typeof d === "object" && ["visacard", "bkash"].includes((d as { gw: string }).gw)) }));
    const body = await json(await client.post("/api/checkout", { agree: true, courses: [(await makeCourse(800)).slug], channel: "sslcommerz", via: "nagad" }));
    expect(body.via_missing).toBe("nagad");
    expect(body.pay_methods.map((m: { name: string }) => m.name)).toEqual(["bKash", "VISA"]); // wallets first
    expect(body.redirect_url).toBe("https://sandbox.sslcommerz.com/gw/pay?SESSIONKEY=abc");
    expect((await audits("checkout.started"))[0].meta).toBe(JSON.stringify({ via: "nagad", offered: false }));
    // SSLCommerz sent no list at all: its own page, as before
    vi.restoreAllMocks();
    gatewaySays(GOOD);
    const plain = await json(await client.post("/api/checkout", { agree: true, courses: [(await makeCourse(900)).slug], channel: "sslcommerz", via: "bkash" }));
    expect(plain.redirect_url).toBe("https://sandbox.sslcommerz.com/gw/pay?SESSIONKEY=abc");
    expect(plain.pay_methods).toEqual([]);
    expect(plain.via_missing).toBeUndefined();
    // only the checkout's own buttons
    const odd = await client.post("/api/checkout", { agree: true, courses: [(await makeCourse(950)).slug], channel: "sslcommerz", via: "paypal" });
    expect(odd.status).toBe(422);
  });

  it("the checkout's buttons follow what SSLCommerz offered last time — all of them before it was ever asked — with SSLCommerz's logos only", async () => {
    const course = await makeCourse(1000);
    const quote = async () => (await json(await new Client().post("/api/checkout/quote", { courses: [course.slug] }))).quote;
    expect((await quote()).ssl_ways).toBeNull();
    gatewaySays(GOOD_WITH_WAYS);
    const { client } = await registerStudent();
    expect((await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" })).status).toBe(201);
    const ways = await until(async () => (await quote()).ssl_ways);
    expect(ways).toEqual([
      { via: "bkash", logo: `${GW}/image/gw/bkash.png` },
      { via: "nagad", logo: `${GW}/image/gw/nagad.png` },
      { via: "rocket", logo: `${GW}/image/gw/dbblmobilebanking.png` },
      { via: "upay", logo: `${GW}/image/gw/upay.png` },
      { via: "visa", logo: `${GW}/image/gw/visacard.png` },
      { via: "mastercard", logo: `${GW}/image/gw/mastercard.png` },
      { via: "amex", logo: null }, // its logo was on another site
    ]);
    // "Check the connection" in Settings → Payments updates them too
    vi.restoreAllMocks();
    gatewaySays(() => Response.json({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw/pay?SESSIONKEY=abc", sessionkey: "abc", desc: DESC.filter((d) => d && typeof d === "object" && ["upay", "bkash"].includes((d as { gw: string }).gw)) }));
    expect((await (await owner()).post("/api/admin/settings/payments/ssl/check")).status).toBe(200);
    expect((await quote()).ssl_ways.map((w: { via: string }) => w.via)).toEqual(["bkash", "upay"]);
    // a free class, or a shop without the online payment, shows none
    const free = await makeCourse(0);
    expect((await json(await new Client().post("/api/checkout/quote", { courses: [free.slug] }))).quote.ssl_ways).toBeNull();
  });

  it("knows each of SSLCommerz's entries by its gateway code, name and kind", () => {
    const cases: [Record<string, string>, string | null][] = [
      [{ gw: "bkash", name: "bKash", type: "mobilebanking" }, "bkash"],
      [{ gw: "nagad", name: "Nagad", type: "mobilebanking" }, "nagad"],
      [{ gw: "dbblmobilebanking", name: "DBBL Mobile Banking", type: "mobilebanking" }, "rocket"],
      [{ gw: "rocket", name: "Rocket", type: "mobilebanking" }, "rocket"],
      [{ gw: "upay", name: "Upay", type: "mobilebanking" }, "upay"],
      [{ gw: "dbbl_visa", name: "DBBL VISA", type: "visa" }, "visa"],
      [{ gw: "brac_master", name: "BRAC MASTER", type: "master" }, "mastercard"],
      [{ gw: "city_amex", name: "City AMEX", type: "amex" }, "amex"],
      [{ gw: "dbbl_nexus", name: "DBBL Nexus", type: "othercard" }, null],
      [{ gw: "mcash", name: "mCash", type: "mobilebanking" }, null],
      [{ gw: "city", name: "City Touch", type: "internetbanking" }, null],
    ];
    for (const [entry, via] of cases) expect(viaOf(entry), entry.gw).toBe(via);
    expect(viaOf({})).toBeNull();
  });

  it("the next purchase that goes through clears the warning", async () => {
    const calls = gatewaySays((_, n) => (n === 1 ? NO("Store Credential Error Or Store is De-active") : GOOD()));
    const course = await makeCourse(500);
    const { client } = await registerStudent();
    expect((await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" })).status).toBe(502);
    expect(await env.KV.get(SSL_LAST_KEY, "json")).toMatchObject({ ok: false });
    const again = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" });
    expect(again.status).toBe(201);
    expect((await json(again)).redirect_url).toContain("sslcommerz.com");
    expect(calls).toHaveLength(2);
    expect(await env.KV.get(SSL_LAST_KEY, "json")).toMatchObject({ ok: true, problem: null, detail: null, by: "checkout" });
  });

  it("a note to the owner can be switched off, and a burst of the same fault does not flood the inbox", async () => {
    const to = await ownerBox();
    gatewaySays(() => NO("Store Credential Error Or Store is De-active"));
    const course = await makeCourse(500);
    const { client } = await registerStudent();
    for (let i = 0; i < 9; i++) expect((await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" })).status).toBe(502);
    await until(async () => (await mailsTo(to)).filter((m) => /could not start the online payment/i.test(m.subject)).length >= 1);
    await new Promise((r) => setTimeout(r, 300));
    const sent = (await mailsTo(to)).filter((m) => /could not start the online payment/i.test(m.subject)).length;
    expect(sent).toBeGreaterThanOrEqual(1);
    expect(sent).toBeLessThanOrEqual(6);

    const off = uniqueEmail("owner");
    await setSetting(env, "notifications", { emails: [off], off: ["payment_failed"] }, null);
    expect((await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" })).status).toBe(502);
    await new Promise((r) => setTimeout(r, 300));
    expect(await mailsTo(off)).toHaveLength(0);
  });

  it("is a kind the owner can switch off in Settings → E-mail, with words for it in both languages", () => {
    expect(NOTIFY_KINDS).toContain("payment_failed");
    const n = notices.paymentFailed({ student: "A", phone: null, items: ["C"], total: 10, problem: "never-heard-of-it", said: "x" });
    expect(n.kind).toBe("payment_failed");
    // an unknown reason still reads as words, never as "undefined"
    expect(n.facts.find((f) => f.en === "What went wrong")?.value).toContain("SSLCommerz said no");
  });
});

describe("SSLCommerz's own limit on how much one payment may be", () => {
  /*
   * Seen on the live store: SSLCommerz took a 10-taka check ("Connected") and refused every real price with "Transaction amount is not allowed as
   * per admin configuration!". Only SSLCommerz can lift that limit, so the website names it, tells the next buyers before they press Pay, offers
   * send-money, gives the owner a message to send SSLCommerz — and forgets it the moment SSLCommerz takes such an amount again.
   */
  const quote = async (slug: string) => (await json(await new Client().post("/api/checkout/quote", { courses: [slug] }))).quote;

  it("a buyer turned away for the amount is told what it is (and nothing of the gateway's words); the owner gets the reason", async () => {
    const to = await ownerBox();
    // the tests above used up this hour's few notes of this kind
    await env.KV.delete(`notify:payment_failed:${Math.floor(Date.now() / 3_600_000)}`);
    gatewaySays(() => NO(LIMIT_WORDS));
    const course = await makeCourse(1850);
    const { client } = await registerStudent(new Client(), { name: "Rina Akter", phone: "01711223355" });
    const res = await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("gateway_amount_limit");
    expect(text).not.toMatch(/admin configuration|sslcommerz/i);
    expect(await env.DB.prepare("SELECT status, note FROM orders ORDER BY id DESC LIMIT 1").first()).toMatchObject({ status: "failed", note: "gateway_init_failed" });

    expect((await audits("checkout.gateway_failed"))[0].summary).toBe("sslcommerz: amount_limit");
    expect(await env.KV.get(SSL_LAST_KEY, "json")).toMatchObject({ ok: false, problem: "amount_limit", detail: LIMIT_WORDS, by: "checkout" });
    const note = await until(async () => (await mailsTo(to)).find((m) => /could not start the online payment/i.test(m.subject)) ?? false);
    expect(note.text).toContain("does not allow a payment this large");
    expect(note.text).toContain(LIMIT_WORDS);
  });

  it("the next buyers of that much are told before they press Pay; cheaper classes are not", async () => {
    gatewaySays(() => NO(LIMIT_WORDS));
    const [cheap, mid, dear] = [await makeCourse(300), await makeCourse(1000), await makeCourse(2500)];
    expect((await quote(mid.slug)).ssl_limited).toBe(false); // nothing is known yet
    const { client } = await registerStudent();
    expect((await client.post("/api/checkout", { agree: true, courses: [mid.slug], channel: "sslcommerz" })).status).toBe(502);
    expect((await quote(mid.slug)).ssl_limited).toBe(true);
    expect((await quote(dear.slug)).ssl_limited).toBe(true);
    expect((await quote(cheap.slug)).ssl_limited).toBe(false);
    // the smallest amount refused is the one kept
    expect((await client.post("/api/checkout", { agree: true, courses: [dear.slug], channel: "sslcommerz" })).status).toBe(502);
    expect(await env.KV.get(SSL_CAP_KEY, "json")).toMatchObject({ from: 1000, detail: LIMIT_WORDS });
    expect((await quote(mid.slug)).ssl_limited).toBe(true);
    // the buyer can still try: SSLCommerz may have lifted it since
    expect((await quote(mid.slug)).channels).toContain("sslcommerz");
    // a free class never shows it
    expect((await quote((await makeCourse(0)).slug)).ssl_limited).toBe(false);
  });

  it("is forgotten as soon as SSLCommerz takes that much again, and after a few hours anyway", async () => {
    const course = await makeCourse(1200);
    const { client } = await registerStudent();
    gatewaySays(() => NO(LIMIT_WORDS));
    expect((await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" })).status).toBe(502);
    expect((await quote(course.slug)).ssl_limited).toBe(true);
    // SSLCommerz lifted it: the next purchase goes through and nobody is warned any more
    vi.restoreAllMocks();
    gatewaySays(GOOD);
    expect((await client.post("/api/checkout", { agree: true, courses: [course.slug], channel: "sslcommerz" })).status).toBe(201);
    await until(async () => !(await env.KV.get(SSL_CAP_KEY)));
    expect((await quote(course.slug)).ssl_limited).toBe(false);
    // a note older than six hours is not trusted
    await env.KV.put(SSL_CAP_KEY, JSON.stringify({ from: 100, at: new Date(Date.now() - 7 * 3600_000).toISOString(), detail: LIMIT_WORDS }));
    expect((await quote(course.slug)).ssl_limited).toBe(false);
  });

  it("“Check the connection” tries the dearest price as well, and says the store is connected but limited", async () => {
    const top = await dearest();
    expect(top).toBeGreaterThan(10);
    const calls = gatewaySays((call) => (call.form.get("total_amount") === "10.00" ? GOOD_WITH_WAYS() : NO(LIMIT_WORDS)));
    const admin = await owner();
    const body = await json(await admin.post("/api/admin/settings/payments/ssl/check"));
    expect(body).toEqual({ ok: true, connected: true, mode: "sandbox", host: sslHost(env), methods: WAYS.map((w) => w.name), limited: { amount: top, detail: LIMIT_WORDS } });
    expect(calls.map((c) => c.form.get("total_amount"))).toEqual(["10.00", `${top}.00`]);
    // not "connected": the last result, the dashboard and the audit trail say what is wrong
    expect(await env.KV.get(SSL_LAST_KEY, "json")).toMatchObject({ ok: false, problem: "amount_limit", by: "check" });
    expect((await audits("payments.ssl_checked"))[0].meta).toBe(JSON.stringify({ connected: true, problem: "amount_limit", mode: "sandbox" }));
    const health = (await json(await admin.get("/api/admin/health"))).checks as { key: string; issues: string[] }[];
    expect(health.find((c) => c.key === "payments")?.issues).toContain("sslcommerz_failing");
    // Settings → Payments shows the limit (and the amount to ask SSLCommerz for) without pressing the button again
    expect(await json(await admin.get("/api/admin/settings/payments/ssl"))).toMatchObject({ cap: { from: top, detail: LIMIT_WORDS }, dearest: top });

    // SSLCommerz lifted it: the next check says so and the warnings go away
    vi.restoreAllMocks();
    gatewaySays(GOOD);
    expect(await json(await admin.post("/api/admin/settings/payments/ssl/check"))).toEqual({ ok: true, connected: true, mode: "sandbox", host: sslHost(env), methods: [] });
    expect(await json(await admin.get("/api/admin/settings/payments/ssl"))).toMatchObject({ cap: null, last: { ok: true } });
    const healed = (await json(await admin.get("/api/admin/health"))).checks as { key: string; issues: string[] }[];
    expect(healed.find((c) => c.key === "payments")?.issues).not.toContain("sslcommerz_failing");
  });

  it("another refusal of the dearest price is reported as what it is", async () => {
    gatewaySays((call) => (call.form.get("total_amount") === "10.00" ? GOOD() : NO("Invalid Information")));
    expect(await json(await (await owner()).post("/api/admin/settings/payments/ssl/check"))).toEqual({ ok: true, connected: false, mode: "sandbox", host: sslHost(env), problem: "bad_details", detail: "Invalid Information", status: 200 });
    expect(await env.KV.get(SSL_CAP_KEY)).toBeNull();
  });

  it("has words for the owner's e-mail in both languages", () => {
    const n = notices.paymentFailed({ student: "A", phone: null, items: ["C"], total: 1850, problem: "amount_limit", said: LIMIT_WORDS });
    const words = n.facts.find((f) => f.en === "What went wrong")?.value ?? "";
    expect(words).toContain("does not allow a payment this large");
    expect(words).toContain("এত টাকার পেমেন্ট");
  });
});

describe("Settings → Payments → Check the connection", () => {
  it("shows how things stand without ever showing a key", async () => {
    const admin = await owner();
    const res = await admin.get("/api/admin/settings/payments/ssl");
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ enabled: true, configured: true, store_id_set: true, password_set: true, mode: "sandbox", host: sslHost(env), site: new URL(env.SITE_URL).host, last: null });
    expect(body.return_urls.ipn).toBe(`${env.SITE_URL}/api/payments/sslcommerz/ipn`);
    expect(text).not.toContain(STORE_ID!);
    expect(text).not.toContain(STORE_PASSWORD!);
  });

  it("says so when the keys are not there — without calling anybody", async () => {
    e.SSLCOMMERZ_STORE_ID = undefined;
    e.SSLCOMMERZ_STORE_PASSWORD = undefined;
    const calls = gatewaySays(GOOD);
    const admin = await owner();
    expect(await json(await admin.get("/api/admin/settings/payments/ssl"))).toMatchObject({ configured: false, store_id_set: false, password_set: false });
    const res = await admin.post("/api/admin/settings/payments/ssl/check");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, connected: false, problem: "not_configured" });
    expect(calls).toHaveLength(0);
    expect(await env.KV.get(SSL_LAST_KEY)).toBeNull();
  });

  it("asks the gateway for a session like a purchase would — a made-up 10-taka order — and reports that it was accepted", async () => {
    const calls = gatewaySays(GOOD);
    const admin = await owner();
    const res = await admin.post("/api/admin/settings/payments/ssl/check");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({ ok: true, connected: true, mode: "sandbox", host: sslHost(env), methods: [] });
    // the page the gateway handed back is thrown away: nobody can be sent to pay a test order
    expect(JSON.stringify(body)).not.toContain("SESSIONKEY");
    // 10 taka, then the dearest price a buyer can be asked for: a store can be connected and still refuse every real price
    expect(calls).toHaveLength(2);
    expect(calls[0].form.get("total_amount")).toBe("10.00");
    expect(calls[1].form.get("total_amount")).toBe(`${await dearest()}.00`);
    expect(calls[1].form.get("tran_id")).not.toBe(calls[0].form.get("tran_id"));
    expect(calls[0].form.get("tran_id")).toMatch(/^CHECK[A-Z0-9]{5,25}$/);
    expect(calls[0].form.get("tran_id")!.length).toBeLessThanOrEqual(30);
    expect(calls[0].form.get("product_name")).toBe("Connection check");
    expect(await env.KV.get(SSL_LAST_KEY, "json")).toMatchObject({ ok: true, by: "check", problem: null });
    expect((await audits("payments.ssl_checked"))[0].meta).toBe(JSON.stringify({ connected: true, problem: null, mode: "sandbox" }));
  });

  it("when it works, names the ways to pay SSLCommerz has switched on for the store — names only, never their addresses", async () => {
    gatewaySays(GOOD_WITH_WAYS);
    const res = await (await owner()).post("/api/admin/settings/payments/ssl/check");
    const body = await json(res);
    expect(body).toEqual({ ok: true, connected: true, mode: "sandbox", host: sslHost(env), methods: WAYS.map((w) => w.name) });
    expect(JSON.stringify(body)).not.toContain("SESSIONKEY");
    expect(JSON.stringify(body)).not.toContain("indexhtmlotp");
  });

  it("reports the gateway's own words and what they mean when it says no — and the dashboard says so too", async () => {
    gatewaySays(() => NO("Store Credential Error Or Store is De-active"));
    const admin = await owner();
    const res = await admin.post("/api/admin/settings/payments/ssl/check");
    expect(res.status).toBe(200); // the owner’s screen must get the explanation, so this is not an error answer
    expect(await json(res)).toEqual({ ok: true, connected: false, mode: "sandbox", host: sslHost(env), problem: "credentials", detail: "Store Credential Error Or Store is De-active", status: 200 });
    expect(await json(await admin.get("/api/admin/settings/payments/ssl"))).toMatchObject({ last: { ok: false, problem: "credentials", by: "check" } });
    // the audit trail records that a check happened and how it ended — not the gateway's words
    const entry = (await audits("payments.ssl_checked"))[0];
    expect(entry.meta).toBe(JSON.stringify({ connected: false, problem: "credentials", mode: "sandbox" }));

    const health = (await json(await admin.get("/api/admin/health"))).checks as { key: string; status: string; issues: string[] }[];
    expect(health.find((c) => c.key === "payments")).toMatchObject({ status: "warn" });
    expect(health.find((c) => c.key === "payments")?.issues).toContain("sslcommerz_failing");

    // fixed on the gateway's side: the next check turns the warning off
    vi.restoreAllMocks();
    gatewaySays(GOOD);
    expect((await json(await admin.post("/api/admin/settings/payments/ssl/check"))).connected).toBe(true);
    const healed = (await json(await admin.get("/api/admin/health"))).checks as { key: string; status: string; issues: string[] }[];
    expect(healed.find((c) => c.key === "payments")?.issues).not.toContain("sslcommerz_failing");
  });

  it("only the owner can press it; anyone on the team can read how things stand; a stranger can do neither", async () => {
    const calls = gatewaySays(GOOD);
    const viewer = (await loginStaff("viewer")).client;
    expect((await viewer.get("/api/admin/settings/payments/ssl")).status).toBe(200);
    expect((await viewer.post("/api/admin/settings/payments/ssl/check")).status).toBe(403);
    const support = (await loginStaff("support")).client;
    expect((await support.post("/api/admin/settings/payments/ssl/check")).status).toBe(403);
    const stranger = new Client();
    expect((await stranger.get("/api/admin/settings/payments/ssl")).status).toBe(401);
    expect((await stranger.post("/api/admin/settings/payments/ssl/check")).status).toBe(401);
    // a student's login is not a team login
    const { client: student } = await registerStudent();
    expect((await student.post("/api/admin/settings/payments/ssl/check")).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("is a check, not a way to hammer the gateway: twenty an hour per person", async () => {
    const calls = gatewaySays(GOOD);
    const { client, email } = await loginStaff("super_admin");
    const staff = await env.DB.prepare("SELECT id FROM staff WHERE email = ?").bind(email).first<{ id: number }>();
    const hour = Math.floor(Date.now() / 3_600_000);
    await env.KV.put(`sslcheck:${staff!.id}:${hour}`, "19", { expirationTtl: 300 });
    expect((await client.post("/api/admin/settings/payments/ssl/check")).status).toBe(200); // the twentieth
    const refused = await client.post("/api/admin/settings/payments/ssl/check");
    expect(refused.status).toBe(429);
    expect((await json(refused)).error.code).toBe("rate_limited");
    expect(calls).toHaveLength(2); // the twentieth asked for its two amounts; the refused one never reached the gateway
  });

  it("the check itself never throws, whatever the gateway does", async () => {
    gatewaySays(() => {
      throw new TypeError("boom");
    });
    expect(await sslCheck(env)).toMatchObject({ connected: false, problem: "network", detail: "boom" });
  });
});
