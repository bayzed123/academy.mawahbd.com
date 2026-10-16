import { env, exports } from "cloudflare:workers";
import { GA_EVENTS, GA_EVENT_GROUPS, GA_FUNNEL } from "@mawah/shared";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkConnection, classify, forgetPass, parseServiceAccount, scrub, serviceAccountEmail, signedNote } from "../src/lib/ga4";
import { getSettings, resetSettingsCache, setSetting } from "../src/lib/settings";
import { isTracking, measuringAllowed, NO_TRACKING, regionOf, trackingFor } from "../src/lib/tracking";
import { gaCardAttr, gaItem, gaListAttr } from "../src/views/ga";
import { Client, firstCourse, json, loginStaff, registerStudent } from "./helpers";

/*
 * Counting visits and actions (Google Analytics 4) and the Admin → Analytics screen that reads the numbers back.
 *
 * Nothing here talks to Google: the sign-in and the report questions are answered by a stand-in that the test installs for `fetch`, and the key
 * the stand-in is checked against is made here, in memory, for the test — no real key (and no real Google account) is involved anywhere.
 */

const PUBLIC = "https://mawahacademy.com";
const FREE = "https://academy-mawahbd-com.mawahacademy.workers.dev";
const OWN_ID = "G-TEST1234"; // an ID the tests use for the shop's own settings
const REAL_ID = "G-J0R62NQJD4"; // the one the owner gave (migration 0013 puts it in the settings)
const PROPERTY = "559265538";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_URL = "https://analyticsdata.googleapis.com/v1beta";

const e = env as unknown as Record<string, string | undefined | object>;

/** Set some bindings for the length of `fn`, then put them back exactly as they were. */
async function withEnv<T>(over: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(over).map((k) => [k, e[k]]));
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete e[k];
      else e[k] = v;
    }
  }
}

const measured = <T>(fn: () => Promise<T>) => withEnv({ ANALYTICS_DEV: "true" }, fn);
const asRealSite = <T>(fn: () => Promise<T>) => withEnv({ ENVIRONMENT: "production", SITE_URL: PUBLIC }, fn);

async function setOwnId(ga4: string, clarity = "", meta_pixel = "") {
  await setSetting(env, "analytics", { ga4, clarity, meta_pixel }, null);
}

/** A request the way Cloudflare would deliver it to the site: an address, and (optionally) the visitor's country. */
function at(url: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return exports.default.fetch(new Request(url, { redirect: "manual", ...init, headers: { "cf-connecting-ip": `10.9.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`, ...headers } }));
}

const settingsWith = (ga4: string, clarity = "", meta_pixel = "") => ({ analytics: { ga4, clarity, meta_pixel } }) as never;
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/* ------------------------------------------------------------------------------------------------ a key made for the tests */

let KEY: { file: string; pem: string; email: string; publicKey: CryptoKey };

async function makeKey(email = "reader@mawah-test.iam.gserviceaccount.com") {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  const file = JSON.stringify({ type: "service_account", project_id: "mawah-test", private_key_id: "kid-123", private_key: pem, client_email: email, client_id: "1", token_uri: TOKEN_URL });
  return { file, pem, email, publicKey: pair.publicKey };
}

const fromB64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
const partOf = (note: string, i: number) => JSON.parse(new TextDecoder().decode(fromB64Url(note.split(".")[i]!))) as Record<string, unknown>;

beforeAll(async () => {
  KEY = await makeKey();
});

/* ------------------------------------------------------------------------------------------------ a stand-in for Google */

interface Raw {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  totals?: { metricValues: { value: string }[] }[];
}
interface DataCall {
  url: string;
  auth: string | null;
  kind: string;
  body: any;
}

/** A table the way the Analytics Data API answers: headers, then rows of strings. */
const table = (dims: string[], mets: string[], rows: [string[], number[]][], totals?: number[]): Raw => ({
  dimensionHeaders: dims.map((name) => ({ name })),
  metricHeaders: mets.map((name) => ({ name })),
  rows: rows.map(([d, m]) => ({ dimensionValues: d.map((value) => ({ value })), metricValues: m.map((value) => ({ value: String(value) })) })),
  ...(totals ? { totals: [{ metricValues: totals.map((value) => ({ value: String(value) })) }] } : {}),
});

const googleError = (status: number, message: string, state = "") => new Response(JSON.stringify({ error: { code: status, message, status: state } }), { status, headers: { "Content-Type": "application/json" } });

interface Stand {
  tokens: { url: string; grant: string | null; note: string }[];
  data: DataCall[];
  /** change how Google answers from now on */
  tokenReply?: (n: number) => Response | undefined;
  dataReply?: (call: DataCall, n: number) => Response | Raw | undefined;
}

let SLUGS: { a: string; b: string; c: string } = { a: "", b: "", c: "" };

/** The answers a healthy Google Analytics property would give (the numbers are the ones the assertions below look for). */
function healthy(call: DataCall): Raw {
  const dims = (call.body.dimensions ?? []).map((d: { name: string }) => d.name);
  const mets = (call.body.metrics ?? []).map((m: { name: string }) => m.name);
  const dim = dims[0] ?? "";
  if (call.kind === "runRealtimeReport") return table(dims, mets, [[["Beginners Baking Class | MAWAH Academy"], [3]], [["MAWAH Academy"], [2]]], [5]);
  switch (dim) {
    case "":
      return table([], mets, [[[], [140, 90, 210, 700, 0.62, 95]]]);
    case "date":
      return table(dims, mets, [[["20261014"], [120, 40]], [["20261015"], [260, 70]]]);
    case "pagePath":
      return call.body.dimensionFilter?.filter?.stringFilter
        ? table(dims, mets, [
            [[`/courses/${SLUGS.a}`], [120, 60, 3600]],
            [[`/en/courses/${SLUGS.a}`], [30, 15, 600]],
            [[`/courses/${SLUGS.b}/`], [10, 5, 50]],
            [["/courses/a-class-that-was-renamed"], [7, 4, 120]],
          ])
        : table(dims, mets, [[["/"], [300, 150]], [["/en/courses"], [90, 60]]]);
    case "itemId":
      return table(dims, mets, [[[SLUGS.a], [100, 20, 10, 4]], [["hero-1"], [50, 0, 0, 0]], [["offer-3"], [9, 0, 0, 0]]]);
    case "eventName":
      return table(dims, mets, [[["view_item"], [150, 70]], [["add_to_cart"], [20, 15]], [["purchase"], [4, 4]]]);
    case "sessionSourceMedium":
      return table(dims, mets, [[["google / organic"], [100, 80]], [["(direct) / (none)"], [50, 40]]]);
    case "deviceCategory":
      return table(dims, mets, [[["mobile"], [170, 110]], [["desktop"], [40, 30]]]);
    case "country":
      return table(dims, mets, [[["Bangladesh"], [180, 120]], [["United Kingdom"], [20, 15]]]);
    case "searchTerm":
      return table(dims, mets, [[["cake"], [9]], [["(not set)"], [3]]]);
    case "itemPromotionName":
      return table(dims, mets, [[["Learn to bake in Bangla"], [80, 6]], [["(not set)"], [5, 0]]]);
    default:
      return table(dims, mets, []);
  }
}

/** Installs the stand-in for `fetch`. Anything that is not Google goes to the real `fetch`. */
function google(): Stand {
  const stand: Stand = { tokens: [], data: [] };
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(TOKEN_URL) || url.endsWith("/token")) {
      const form = new URLSearchParams(String(init?.body ?? ""));
      stand.tokens.push({ url, grant: form.get("grant_type"), note: form.get("assertion") ?? "" });
      const custom = stand.tokenReply?.(stand.tokens.length);
      return custom ?? new Response(JSON.stringify({ access_token: `pass-${stand.tokens.length}`, expires_in: 3600, token_type: "Bearer" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/v1beta/properties/")) {
      const headers = new Headers(init?.headers);
      const call: DataCall = { url, auth: headers.get("authorization"), kind: url.split(":").pop() ?? "", body: JSON.parse(String(init?.body ?? "{}")) };
      stand.data.push(call);
      const custom = stand.dataReply?.(call, stand.data.length);
      if (custom instanceof Response) return custom;
      return new Response(JSON.stringify(custom ?? healthy(call)), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return real(input as never, init);
  }) as typeof fetch);
  return stand;
}

const clearKept = () => Promise.all([...["today", "7d", "28d", "90d"].map((r) => env.KV.delete(`ga4:report:${r}`)), env.KV.delete("ga4:live"), env.KV.delete("ga4:last")]);

beforeEach(async () => {
  forgetPass();
  resetSettingsCache();
  await clearKept();
  const a = await env.DB.prepare("SELECT slug FROM courses WHERE status = 'published' ORDER BY id LIMIT 3").all<{ slug: string }>();
  SLUGS = { a: a.results[0]!.slug, b: a.results[1]!.slug, c: a.results[2]!.slug };
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetPass();
});

/** The shop's Worker with a key and a property, as a deployed shop with everything set up would have. */
const connected = <T>(fn: () => Promise<T>) => withEnv({ GA4_SERVICE_ACCOUNT_JSON: KEY.file, GA_PROPERTY_ID: PROPERTY }, fn);

/* ============================================================================================= who is counted, and where */

describe("who is counted", () => {
  it("has the owner's measurement ID in the settings of a new shop (a migration puts it there once)", async () => {
    expect((await getSettings(env, { fresh: true })).analytics.ga4).toBe(REAL_ID);
  });

  const prod = { ENVIRONMENT: "production", SITE_URL: PUBLIC } as never;
  const dev = { ENVIRONMENT: "development", SITE_URL: "http://localhost:8787" } as never;

  it("counts visits on the real address in production, and nowhere else", () => {
    expect(measuringAllowed(prod, `${PUBLIC}/en/courses`)).toBe(true);
    expect(trackingFor(prod, `${PUBLIC}/`, settingsWith(REAL_ID)).ga4).toBe(REAL_ID);
    // the free fallback address (the deploy checks use it) and any other address: never
    expect(measuringAllowed(prod, `${FREE}/`)).toBe(false);
    expect(trackingFor(prod, `${FREE}/`, settingsWith(REAL_ID))).toEqual(NO_TRACKING);
    expect(trackingFor(prod, "https://somewhere-else.example/", settingsWith(REAL_ID))).toEqual(NO_TRACKING);
  });

  it("counts nothing on a developer's machine or in the automatic tests, unless a test turns it on — and never in production", () => {
    expect(measuringAllowed(dev, "http://localhost:8787/")).toBe(false);
    expect(trackingFor(dev, "http://localhost:8787/", settingsWith(REAL_ID))).toEqual(NO_TRACKING);
    expect(measuringAllowed({ ...(dev as object), ANALYTICS_DEV: "true" } as never, "http://localhost:8787/")).toBe(true);
    // ANALYTICS_DEV is a development switch: set by mistake on the live site it opens no door on another address
    expect(measuringAllowed({ ...(prod as object), ANALYTICS_DEV: "true" } as never, `${FREE}/`)).toBe(false);
    expect(measuringAllowed({ ...(dev as object), ANALYTICS_DEV: "yes" } as never, "http://localhost:8787/")).toBe(false);
  });

  it("puts only well-formed IDs in a page (they are written into it)", () => {
    const on = { ...(dev as object), ANALYTICS_DEV: "true" } as never;
    for (const bad of ['G-"><script>alert(1)</script>', "g-abcd1234", "G-AB", "UA-12345-1", "G-ABCDEFGHIJKLMNOPQRSTUVWXYZ", " "]) {
      expect(trackingFor(on, "http://localhost:8787/", settingsWith(bad)).ga4, bad).toBe("");
    }
    expect(trackingFor(on, "http://localhost:8787/", settingsWith("  G-ABCD1234  ")).ga4).toBe("G-ABCD1234");
    expect(trackingFor(on, "http://localhost:8787/", settingsWith("", "abc123xyz9", "123456789012345"))).toEqual({ ga4: "", clarity: "abc123xyz9", pixel: "123456789012345" });
    expect(trackingFor(on, "http://localhost:8787/", settingsWith("", '"><b>', "12ab"))).toEqual(NO_TRACKING);
    expect(isTracking(NO_TRACKING)).toBe(false);
    expect(isTracking({ ...NO_TRACKING, clarity: "abc123xyz9" })).toBe(true);
  });

  it("asks first in Europe (EU, EEA, UK, Switzerland, Tor) and counts the rest of the world unless they say no", () => {
    for (const country of ["DE", "fr", "GB", "CH", "NO", "IS", "T1", " it "]) expect(regionOf(country), country).toBe("eu");
    for (const country of ["BD", "US", "IN", "AE", "SA", "MY", "", null, undefined]) expect(regionOf(country), String(country)).toBe("row");
  });
});

/* ============================================================================================= what a page carries */

describe("pages of the real site", () => {
  it("carry the tag, the class on show, the script, a policy that lets Google in, and a one-day region cookie", async () => {
    const course = await firstCourse();
    await setOwnId(OWN_ID);
    await measured(async () => {
      const res = await new Client().get(`/en/courses/${course.slug}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<meta name="mawah:ga4" content="${OWN_ID}"`);
      expect(html).toMatch(/<script src="\/assets\/analytics\.[0-9a-f]+\.js" defer/);
      // the class, in the one shape every page uses
      const note = /<script type="application\/json" id="mawah-ga">([\s\S]*?)<\/script>/.exec(html);
      expect(note).not.toBeNull();
      const ga = JSON.parse(decode(note![1]!)) as { item: { item_id: string; item_name: string; price: number } };
      expect(ga.item.item_id).toBe(course.slug);
      expect(ga.item.item_name).toBe(course.title_en);
      expect(ga.item.price).toBe(course.price);
      // the footer's "stop counting my visits" button is there for the script to switch on
      expect(html).toContain("data-ga-choices");
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("script-src 'self' https://www.googletagmanager.com");
      expect(csp).toContain("https://*.google-analytics.com");
      expect(csp).not.toContain("'unsafe-inline'");
      expect(csp).not.toContain("'unsafe-eval'");
      // no inline script: the only script element with content is the data block above (type application/json — never run)
      for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)) expect(m[1], "an inline script").toMatch(/application\/(ld\+)?json/);
    });
  });

  it("mark each class card as a class and each list by name, so the script can count what was seen and what was chosen", async () => {
    await setOwnId(OWN_ID);
    await measured(async () => {
      const html = await (await new Client().get("/en/courses")).text();
      expect(html).toContain('data-ga-list="classes"');
      const cards = [...html.matchAll(/data-ga-item="([^"]*)"/g)].map((m) => JSON.parse(decode(m[1]!)) as { item_id: string; item_name: string; price: number });
      expect(cards.length).toBeGreaterThan(5);
      for (const c of cards) {
        expect(c.item_id).toMatch(/^[a-z0-9-]+$/);
        expect(typeof c.item_name).toBe("string");
        expect(Number.isFinite(c.price)).toBe(true);
      }
      const home = await (await new Client().get("/en")).text();
      expect(home).toContain('data-ga-list="home_featured"');
    });
  });

  it("leave the region cookie only where it is needed, only once, and without anything personal in it", async () => {
    await setOwnId(OWN_ID);
    await measured(async () => {
      const cookies = (res: Response) => res.headers.getSetCookie().filter((c) => c.startsWith("mawah_geo="));
      const europe = await at("http://localhost/en/courses", { "cf-ipcountry": "DE" });
      expect(cookies(europe)).toHaveLength(1);
      expect(cookies(europe)[0]).toMatch(/^mawah_geo=eu; Path=\/; Max-Age=86400; SameSite=Lax$/);
      const bangladesh = await at("http://localhost/en/courses", { "cf-ipcountry": "BD" });
      expect(cookies(bangladesh)[0]).toMatch(/^mawah_geo=row;/);
      // unknown country: not guessed — treated as the rest of the world
      expect(cookies(await at("http://localhost/en/courses"))[0]).toMatch(/^mawah_geo=row;/);
      // someone who already has the right cookie is not given it again
      expect(cookies(await at("http://localhost/en/courses", { "cf-ipcountry": "BD", cookie: "mawah_geo=row" }))).toHaveLength(0);
      // …but a traveller whose cookie is from another place is corrected
      expect(cookies(await at("http://localhost/en/courses", { "cf-ipcountry": "FR", cookie: "mawah_geo=row" }))[0]).toMatch(/^mawah_geo=eu;/);
      // never on the API, the admin or anything that is not a page
      expect(cookies(await at("http://localhost/api/health", { "cf-ipcountry": "DE" }))).toHaveLength(0);
      expect(cookies(await at("http://localhost/robots.txt", { "cf-ipcountry": "DE" }))).toHaveLength(0);
    });
  });

  it("are exactly as before when no ID is set, when the request is not measured, or on the free fallback address", async () => {
    const course = await firstCourse();
    await setOwnId("");
    await measured(async () => {
      const res = await at(`http://localhost/en/courses/${course.slug}`, { "cf-ipcountry": "DE" });
      const html = await res.text();
      for (const trace of ["mawah:ga4", "mawah-ga", "analytics.", "data-ga-", "googletagmanager", "google-analytics"]) expect(html + (res.headers.get("content-security-policy") ?? ""), trace).not.toContain(trace);
      expect(res.headers.getSetCookie().some((c) => c.startsWith("mawah_geo="))).toBe(false);
    });
    await setOwnId(OWN_ID);
    // an ID is set but this is a test machine that was not asked to count
    const plain = await at(`http://localhost/en/courses/${course.slug}`);
    expect(await plain.text()).not.toContain("mawah:ga4");
    expect(plain.headers.get("content-security-policy")).not.toContain("googletagmanager");
    // the real site's own address counts, the free address does not (the deploy checks and the live smoke test use it)
    await setOwnId(REAL_ID);
    await asRealSite(async () => {
      const real = await at(`${PUBLIC}/en/courses/${course.slug}`, { "cf-ipcountry": "DE" });
      const html = await real.text();
      expect(html).toContain(`<meta name="mawah:ga4" content="${REAL_ID}"`);
      expect(real.headers.getSetCookie().find((c) => c.startsWith("mawah_geo="))).toMatch(/^mawah_geo=eu; .*; Secure$/);
      const free = await at(`${FREE}/en/courses/${course.slug}`, { "cf-ipcountry": "DE" });
      const freeHtml = await free.text();
      expect(freeHtml).not.toContain("mawah:ga4");
      expect(freeHtml).not.toContain("data-ga-");
      expect(free.headers.get("content-security-policy")).not.toContain("google");
      expect(free.headers.getSetCookie().some((c) => c.startsWith("mawah_geo="))).toBe(false);
    });
  });

  it("keep serving from the page cache and still give each visitor their own region cookie", async () => {
    await setOwnId(REAL_ID);
    await asRealSite(async () => {
      const path = `${PUBLIC}/en/faq`;
      const first = await at(path, { "cf-ipcountry": "BD" });
      expect(first.status).toBe(200);
      await first.text();
      const second = await at(path, { "cf-ipcountry": "DE" });
      expect(second.headers.get("x-page-cache")).toBe("HIT");
      expect(second.headers.getSetCookie().find((c) => c.startsWith("mawah_geo="))).toMatch(/^mawah_geo=eu;/);
      expect(await second.text()).toContain(`content="${REAL_ID}"`);
    });
  });

  it("do not let one visitor's address, name or e-mail travel into the tag (the page carries public facts about classes only)", async () => {
    const { client, email } = await registerStudent(new Client(), { name: "Private Person" });
    await setOwnId(OWN_ID);
    await measured(async () => {
      for (const path of ["/en", "/en/courses", "/en/faq", "/en/contact"]) {
        const html = await (await client.get(path)).text();
        expect(html, path).not.toContain(email);
        expect(html, path).not.toContain("Private Person");
      }
    });
  });
});

describe("the student app and the admin", () => {
  const SHELL = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Student</title><script type="module" src="/app/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>';

  /** The built apps are not part of the unit tests; a one-page stand-in for the asset layer is enough to see what the Worker adds. */
  async function withShell<T>(fn: () => Promise<T>): Promise<T> {
    const before = e.ASSETS;
    e.ASSETS = { fetch: async () => new Response(SHELL, { headers: { "Content-Type": "text/html" } }) };
    try {
      return await fn();
    } finally {
      e.ASSETS = before;
    }
  }

  it("get the tag, and the script before the app's own, when the owner has set an ID", async () => {
    await setOwnId(OWN_ID, "abc123xyz9");
    await measured(() =>
      withShell(async () => {
        const res = await new Client().get("/app/checkout?c=anything");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toMatch(/<meta charset="utf-8"><meta name="mawah:ga4" content="G-TEST1234"><meta name="mawah:clarity" content="abc123xyz9"><script src="\/assets\/analytics\.[0-9a-f]+\.js" defer><\/script>/);
        expect(html.indexOf("analytics.")).toBeLessThan(html.indexOf("/app/assets/index-abc.js"));
        const csp = res.headers.get("content-security-policy") ?? "";
        expect(csp).toContain("https://www.googletagmanager.com");
        expect(csp).toContain("https://www.clarity.ms");
        expect(csp).not.toContain("'unsafe-inline'");
        expect(csp).not.toContain("connect.facebook.net"); // no Meta Pixel ID: its door stays shut
        expect(res.headers.get("cache-control")).toBe("no-cache");
      }),
    );
  });

  it("are left alone when nothing is to be counted", async () => {
    await setOwnId("");
    await measured(() =>
      withShell(async () => {
        const res = await new Client().get("/app/");
        expect(await res.text()).toBe(SHELL);
        expect(res.headers.get("content-security-policy")).not.toContain("google");
      }),
    );
    await setOwnId(OWN_ID);
    await withShell(async () => {
      expect(await (await new Client().get("/app/")).text()).toBe(SHELL); // a test machine that was not asked to count
    });
  });

  it("never count the admin: no tag, no script and no door in the policy, even with an ID set on the real site", async () => {
    await setOwnId(REAL_ID);
    await asRealSite(() =>
      withShell(async () => {
        const res = await at(`${PUBLIC}/admin/orders`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(SHELL);
        expect(res.headers.get("content-security-policy")).not.toContain("google");
        expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
        // …while the student app of the same site is counted
        const app = await at(`${PUBLIC}/app/`);
        expect(await app.text()).toContain(`content="${REAL_ID}"`);
      }),
    );
  });
});

describe("what a class looks like to the script", () => {
  it("is one shape: the address name, the English name first, the category and the price", () => {
    expect(gaItem({ slug: "cake-1", title_en: "Cake Class", title_bn: "কেক", price: 1200, category: { name_en: "Cakes", name_bn: "কেক" } })).toEqual({ item_id: "cake-1", item_name: "Cake Class", item_category: "Cakes", price: 1200 });
    expect(gaItem({ slug: "x", title_en: "", title_bn: "বাংলা", price: 0, category: { name_en: "", name_bn: "ক" } })).toEqual({ item_id: "x", item_name: "বাংলা", item_category: "ক", price: 0 });
    expect(gaItem({ slug: "x", title_en: "X", title_bn: "X", price: 5 })).toEqual({ item_id: "x", item_name: "X", price: 5 });
  });

  it("is written on a card only when the request is measured", () => {
    const c = { slug: "a", title_en: "A", title_bn: "A", price: 1 };
    const on = { track: { ga4: OWN_ID } } as never;
    const off = { track: NO_TRACKING } as never;
    expect(JSON.parse(gaCardAttr(on, c)["data-ga-item"]!)).toMatchObject({ item_id: "a" });
    expect(gaCardAttr(off, c)).toEqual({});
    expect(gaListAttr(on, "related")).toEqual({ "data-ga-list": "related" });
    expect(gaListAttr(off, "related")).toEqual({});
  });
});

describe("the checkout", () => {
  it("names a class by its address name, as the class page does, so Google counts the checkout and the page under one name", async () => {
    const course = await firstCourse();
    const res = await new Client().post("/api/checkout/quote", { courses: [course.slug] });
    expect(res.status).toBe(200);
    const { quote } = await json(res);
    expect(quote.items).toHaveLength(1);
    expect(quote.items[0]).toMatchObject({ slug: course.slug, course_id: course.id, title_en: course.title_en });
  });
});

describe("the list of events", () => {
  it("is one list: unique snake_case names GA4 accepts, each in a known group, the funnel inside it", () => {
    const names = GA_EVENTS.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n, n).toMatch(/^[a-z][a-z0-9_]{1,39}$/); // GA4: letters, digits, underscores; at most 40
    for (const ev of GA_EVENTS) expect(GA_EVENT_GROUPS, ev.name).toContain(ev.group);
    for (const g of GA_EVENT_GROUPS) expect(GA_EVENTS.some((x) => x.group === g), g).toBe(true);
    for (const step of GA_FUNNEL) expect(names).toContain(step);
    expect(GA_FUNNEL[0]).toBe("view_item");
    expect(GA_FUNNEL.at(-1)).toBe("purchase");
  });
});

/* ============================================================================================= the key file */

describe("the key file", () => {
  it("is read as Google gives it, or as that file in base64, and missing or damaged keys are told apart", () => {
    expect(parseServiceAccount(undefined)).toEqual({ ok: false, problem: "not_configured" });
    expect(parseServiceAccount("  \n ")).toEqual({ ok: false, problem: "not_configured" });
    const plain = parseServiceAccount(KEY.file);
    expect(plain.ok && plain.account.client_email).toBe(KEY.email);
    expect(plain.ok && plain.account.private_key_id).toBe("kid-123");
    const b64 = parseServiceAccount(btoa(KEY.file));
    expect(b64.ok && b64.account.client_email).toBe(KEY.email);
    // some forms turn line breaks into backslash-n: they are put back
    const flattened = JSON.stringify({ type: "service_account", client_email: KEY.email, private_key: KEY.pem.replace(/\n/g, "\\n") });
    const fixed = parseServiceAccount(flattened);
    expect(fixed.ok && fixed.account.private_key).toContain("\n");
    for (const bad of ["not json at all", "{", "[]", "null", "{}", JSON.stringify({ client_email: "a@b.c" }), JSON.stringify({ client_email: "nope", private_key: KEY.pem }), JSON.stringify({ type: "authorized_user", client_email: "a@b.c", private_key: KEY.pem }), JSON.stringify({ client_email: "a@b.c", private_key: "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----" }), "%%%not-base64%%%"]) {
      expect(parseServiceAccount(bad), bad.slice(0, 30)).toEqual({ ok: false, problem: "key_invalid" });
    }
  });

  it("gives the account's address (which is not a secret) and nothing else", () => {
    expect(serviceAccountEmail({ GA4_SERVICE_ACCOUNT_JSON: KEY.file } as never)).toBe(KEY.email);
    expect(serviceAccountEmail({} as never)).toBeNull();
    expect(serviceAccountEmail({ GA4_SERVICE_ACCOUNT_JSON: "junk" } as never)).toBeNull();
  });

  it("signs the note Google asks for: RS256, the account, read-only scope, the sign-in address, an hour — and the signature is real", async () => {
    const parsed = parseServiceAccount(KEY.file);
    if (!parsed.ok) throw new Error("key");
    const note = await signedNote(parsed.account, TOKEN_URL, 1_800_000_000);
    const [head, claims, signature] = note.split(".") as [string, string, string];
    expect(partOf(note, 0)).toEqual({ alg: "RS256", typ: "JWT", kid: "kid-123" });
    expect(partOf(note, 1)).toEqual({ iss: KEY.email, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: TOKEN_URL, iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(note).not.toMatch(/[+/=]/); // base64url, no padding
    const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", KEY.publicKey, fromB64Url(signature), new TextEncoder().encode(`${head}.${claims}`));
    expect(good).toBe(true);
    const tampered = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", KEY.publicKey, fromB64Url(signature), new TextEncoder().encode(`${head}.${claims}x`));
    expect(tampered).toBe(false);
    // never wider than reading
    expect(JSON.stringify(partOf(note, 1))).not.toContain("edit");
  });

  it("cuts anything shaped like a key out of what is shown, and keeps it short", () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(64)}\n${"B".repeat(64)}\n-----END PRIVATE KEY-----`;
    const shown = scrub(`failed: ${pem} and ya29.${"x".repeat(120)} for ${KEY.email}`);
    expect(shown).not.toContain("PRIVATE KEY");
    expect(shown).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    expect(shown).toContain(KEY.email);
    expect(scrub(`${"word ".repeat(200)}`).length).toBeLessThanOrEqual(300);
    expect(scrub("  A\n\n  plain   message  ")).toBe("A plain message");
  });
});

/* ============================================================================================= asking Google */

describe("signing in to Google and asking", () => {
  it("signs in once per hour with a note Google could verify, then asks with the pass it was given", async () => {
    const stand = google();
    await connected(async () => {
      expect((await checkConnection(env)).ok).toBe(true);
      expect((await checkConnection(env)).ok).toBe(true);
    });
    expect(stand.tokens).toHaveLength(1); // the pass is kept, not asked for again
    expect(stand.tokens[0]!.url).toBe(TOKEN_URL);
    expect(stand.tokens[0]!.grant).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const note = stand.tokens[0]!.note;
    expect(partOf(note, 1).iss).toBe(KEY.email);
    const [head, claims, signature] = note.split(".") as [string, string, string];
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", KEY.publicKey, fromB64Url(signature), new TextEncoder().encode(`${head}.${claims}`))).toBe(true);
    expect(stand.data).toHaveLength(2);
    for (const call of stand.data) {
      expect(call.url).toBe(`${DATA_URL}/properties/${PROPERTY}:runReport`);
      expect(call.auth).toBe("Bearer pass-1");
    }
    // the smallest question there is
    expect(stand.data[0]!.body).toEqual({ dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }] });
  });

  it("signs in again when Google no longer accepts the pass — once, not in a loop", async () => {
    const stand = google();
    stand.dataReply = (_call, n) => (n === 1 ? googleError(401, "Request had invalid authentication credentials.", "UNAUTHENTICATED") : undefined);
    await connected(async () => expect((await checkConnection(env)).ok).toBe(true));
    expect(stand.tokens).toHaveLength(2);
    expect(stand.data.map((c) => c.auth)).toEqual(["Bearer pass-1", "Bearer pass-2"]);

    forgetPass();
    const stubborn = google();
    stubborn.dataReply = () => googleError(401, "Request had invalid authentication credentials.", "UNAUTHENTICATED");
    await connected(async () => expect(await checkConnection(env)).toMatchObject({ ok: false, problem: "key_rejected", status: 401 }));
    expect(stubborn.data.length).toBeLessThanOrEqual(4); // asked, signed in again, asked again — then it stops
  });

  it("says in the owner's terms what went wrong, for each way it can", async () => {
    const stand = google();
    const ask = () => connected(() => checkConnection(env));
    const cases: [Response, string][] = [
      [googleError(403, "Google Analytics Data API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=123456 then retry.", "PERMISSION_DENIED"), "api_disabled"],
      [googleError(403, "User does not have sufficient permissions for this property. To learn more about Property ID, see https://developers.google.com/analytics/devguides/reporting/data/v1/property-id.", "PERMISSION_DENIED"), "no_access"],
      [googleError(404, "Property not found", "NOT_FOUND"), "property_missing"],
      [googleError(429, "Exhausted property tokens for a project per hour.", "RESOURCE_EXHAUSTED"), "quota"],
      [googleError(400, "Field searchTermX is not a valid dimension.", "INVALID_ARGUMENT"), "bad_request"],
      [googleError(503, "The service is currently unavailable.", "UNAVAILABLE"), "google_error"],
      [googleError(418, "I am a teapot"), "other"],
    ];
    for (const [reply, problem] of cases) {
      stand.dataReply = () => reply.clone();
      const r = await ask();
      expect(r.ok).toBe(false);
      expect(!r.ok && r.problem, problem).toBe(problem);
    }
    // an answer that is not JSON at all
    stand.dataReply = () => new Response("<html>Bad gateway</html>", { status: 502 });
    expect(await ask()).toMatchObject({ ok: false, problem: "google_error", status: 502 });
    stand.dataReply = () => new Response("not json", { status: 200 });
    expect(await ask()).toMatchObject({ ok: false, problem: "other" });
  });

  it("names the refusals of the sign-in too, and reaches no further when it cannot sign in", async () => {
    const stand = google();
    stand.tokenReply = () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT Signature." }), { status: 400 });
    await connected(async () => expect(await checkConnection(env)).toMatchObject({ ok: false, problem: "key_rejected", status: 400, detail: expect.stringContaining("Invalid JWT Signature") }));
    expect(stand.data).toHaveLength(0);
    stand.tokenReply = () => new Response("", { status: 503 });
    await connected(async () => expect(await checkConnection(env)).toMatchObject({ ok: false, problem: "google_error", status: 503 }));
    stand.tokenReply = () => {
      throw new Error("connection refused");
    };
    await connected(async () => expect(await checkConnection(env)).toMatchObject({ ok: false, problem: "network", detail: "connection refused" }));
  });

  it("says so when Google cannot be reached at all", async () => {
    const stand = google();
    stand.dataReply = () => {
      throw new Error("The network connection was lost");
    };
    await connected(async () => expect(await checkConnection(env)).toMatchObject({ ok: false, problem: "network" }));
  });

  it("does not even try when there is no key, a damaged key or no property — and there is no network call", async () => {
    const stand = google();
    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: undefined, GA_PROPERTY_ID: PROPERTY }, async () => expect(await checkConnection(env)).toMatchObject({ ok: false, problem: "not_configured" }));
    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: "this is not a key file", GA_PROPERTY_ID: PROPERTY }, async () => expect(await checkConnection(env)).toMatchObject({ ok: false, problem: "key_invalid" }));
    // looks like a key file, but the private key was cut off on the way: the browser's crypto cannot read it
    const cut = JSON.stringify({ type: "service_account", client_email: KEY.email, private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n" });
    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: cut, GA_PROPERTY_ID: PROPERTY }, async () => expect(await checkConnection(env)).toMatchObject({ ok: false, problem: "key_invalid", detail: expect.stringContaining("private key") }));
    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: KEY.file, GA_PROPERTY_ID: "" }, async () => expect(await checkConnection(env)).toMatchObject({ ok: false, problem: "property_missing" }));
    expect(stand.tokens).toHaveLength(0);
    expect(stand.data).toHaveLength(0);
  });

  it("never lets a key, a pass or a long token that Google echoed reach the owner's screen", async () => {
    const stand = google();
    const leak = `${KEY.pem} ya29.${"q".repeat(90)}`;
    stand.dataReply = () => googleError(400, `Bad request. ${leak}`, "INVALID_ARGUMENT");
    const r = await connected(() => checkConnection(env));
    const text = JSON.stringify(r);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain("qqqqqqqqqq");
    expect(text).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });

  it("reads Google's own words for each kind of refusal (the classifier on its own)", () => {
    expect(classify(403, "SERVICE_DISABLED analyticsdata.googleapis.com")).toBe("api_disabled");
    expect(classify(403, "Google Analytics Data API has not been used in project 1 before or it is disabled")).toBe("api_disabled");
    expect(classify(401, "UNAUTHENTICATED")).toBe("key_rejected");
    expect(classify(403, "PERMISSION_DENIED")).toBe("no_access");
    expect(classify(404, "")).toBe("property_missing");
    expect(classify(400, "Property 123 does not exist")).toBe("property_missing");
    expect(classify(429, "")).toBe("quota");
    expect(classify(200, "RESOURCE_EXHAUSTED")).toBe("quota");
    expect(classify(400, "invalid metric")).toBe("bad_request");
    expect(classify(500, "")).toBe("google_error");
    expect(classify(302, "")).toBe("other");
  });

  it("honours a stand-in address for Google outside production, and never in production", async () => {
    const stand = google();
    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: KEY.file, GA_PROPERTY_ID: PROPERTY, GOOGLE_API_BASE: "https://stand-in.test/api/dev/google/" }, async () => {
      expect((await checkConnection(env)).ok).toBe(true);
    });
    expect(stand.tokens[0]!.url).toBe("https://stand-in.test/api/dev/google/token");
    expect(partOf(stand.tokens[0]!.note, 1).aud).toBe("https://stand-in.test/api/dev/google/token"); // the note is for the address it is sent to
    expect(stand.data[0]!.url).toBe(`https://stand-in.test/api/dev/google/v1beta/properties/${PROPERTY}:runReport`);

    forgetPass();
    const live = google();
    await withEnv({ ENVIRONMENT: "production", GA4_SERVICE_ACCOUNT_JSON: KEY.file, GA_PROPERTY_ID: PROPERTY, GOOGLE_API_BASE: "https://evil.example" }, async () => {
      expect((await checkConnection(env)).ok).toBe(true);
    });
    expect(live.tokens[0]!.url).toBe(TOKEN_URL);
    expect(live.data[0]!.url).toBe(`${DATA_URL}/properties/${PROPERTY}:runReport`);
    expect(partOf(live.tokens[0]!.note, 1).aud).toBe(TOKEN_URL);
  });
});

/* ============================================================================================= Admin → Analytics */

describe("Admin → Analytics: who may look and who may change", () => {
  const READ = ["/api/admin/analytics/status", "/api/admin/analytics/report", "/api/admin/analytics/realtime", "/api/admin/analytics/classes.csv"];

  it("lets the owner, the content manager and the viewer read; not support; nobody without a login", async () => {
    google();
    await connected(async () => {
      for (const path of READ) expect((await new Client().get(path)).status, path).toBe(401);
      for (const role of ["super_admin", "content_manager", "viewer"] as const) {
        const { client } = await loginStaff(role);
        expect((await client.get("/api/admin/analytics/status")).status, role).toBe(200);
        expect((await client.get("/api/admin/analytics/report")).status, role).toBe(200);
      }
      const { client: support } = await loginStaff("support");
      for (const path of READ) expect((await support.get(path)).status, path).toBe(403);
    });
  });

  it("lets only the owner press the two buttons that cost Google quota", async () => {
    const stand = google();
    await connected(async () => {
      for (const path of ["/api/admin/analytics/check", "/api/admin/analytics/refresh"]) {
        expect((await new Client().post(path)).status, path).toBe(401);
        for (const role of ["content_manager", "viewer", "support"] as const) expect((await (await loginStaff(role)).client.post(path)).status, `${role} ${path}`).toBe(403);
      }
      expect((await (await loginStaff("super_admin")).client.post("/api/admin/analytics/refresh")).status).toBe(200);
    });
    expect(stand.data).toHaveLength(0); // the refused ones did not reach Google
  });
});

describe("Admin → Analytics: the connection", () => {
  it("shows what is set up and the address to add in Google Analytics — never the key", async () => {
    const { client } = await loginStaff();
    await connected(async () => {
      const res = await client.get("/api/admin/analytics/status");
      const text = await res.text();
      const body = JSON.parse(text);
      expect(body).toMatchObject({ ok: true, measurement_id: REAL_ID, property_id: PROPERTY, key_set: true, key_problem: null, service_email: KEY.email, last: null });
      expect(body.stream_id).toBe("16139065386");
      for (const secret of ["PRIVATE KEY", "private_key", KEY.pem.split("\n")[1]!, "kid-123"]) expect(text, secret).not.toContain(secret);
    });
  });

  it("says plainly when there is no key yet, or the key is not a key file", async () => {
    const { client } = await loginStaff();
    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: undefined }, async () => {
      expect(await json(await client.get("/api/admin/analytics/status"))).toMatchObject({ key_set: false, key_problem: null, service_email: null });
      // an answer, not an error: the screen explains it
      const report = await client.get("/api/admin/analytics/report");
      expect(report.status).toBe(200);
      expect(await json(report)).toMatchObject({ ok: true, report: { connected: false, problem: "not_configured" } });
    });
    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: "garbage" }, async () => {
      expect(await json(await client.get("/api/admin/analytics/status"))).toMatchObject({ key_set: true, key_problem: "key_invalid", service_email: null });
    });
  });

  it("checks the connection, remembers how it went, and writes it in the activity log", async () => {
    const stand = google();
    const { client } = await loginStaff();
    await connected(async () => {
      const good = await client.post("/api/admin/analytics/check");
      expect(good.status).toBe(200);
      expect(await json(good)).toEqual({ ok: true, connected: true });
      expect(await json(await client.get("/api/admin/analytics/status"))).toMatchObject({ last: { ok: true, problem: null, detail: null } });

      stand.dataReply = () => googleError(403, "User does not have sufficient permissions for this property.", "PERMISSION_DENIED");
      const bad = await client.post("/api/admin/analytics/check");
      // never `{ ok: false }` — the admin screen would take that for a failed request and not show the explanation
      expect(bad.status).toBe(200);
      expect(await json(bad)).toMatchObject({ ok: true, connected: false, problem: "no_access", status: 403 });
      expect(await json(await client.get("/api/admin/analytics/status"))).toMatchObject({ last: { ok: false, problem: "no_access" } });
    });
    const rows = await env.DB.prepare("SELECT meta FROM activity_log WHERE action = 'analytics.checked' ORDER BY id DESC LIMIT 2").all<{ meta: string }>();
    expect(rows.results.map((r) => JSON.parse(r.meta))).toEqual([{ ok: false, problem: "no_access" }, { ok: true, problem: null }]);
    expect(JSON.stringify(rows.results)).not.toContain("PRIVATE");
  });

  it("signs in afresh on every check (a replaced key must not wait for the old pass to run out)", async () => {
    const stand = google();
    const { client } = await loginStaff();
    await connected(async () => {
      await client.post("/api/admin/analytics/check");
      await client.post("/api/admin/analytics/check");
    });
    expect(stand.tokens).toHaveLength(2);
  });

  it("allows twenty checks an hour per person, then asks to wait", async () => {
    google();
    const { client } = await loginStaff();
    await connected(async () => {
      for (let i = 0; i < 20; i++) expect((await client.post("/api/admin/analytics/check")).status, `check ${i + 1}`).toBe(200);
      expect((await client.post("/api/admin/analytics/check")).status).toBe(429);
    });
  });
});

describe("Admin → Analytics: the report", () => {
  async function seedSales() {
    // the sales of an earlier test in this file are not this test's
    await env.DB.prepare("DELETE FROM orders WHERE public_id LIKE 'ga-%'").run();
    const course = await firstCourse(SLUGS.a);
    const other = await firstCourse(SLUGS.b);
    const { id: studentId } = await registerStudent();
    const insert = async (course_id: number, status: string, paidAt: string | null, price: number, tag: string) => {
      const o = await env.DB.prepare("INSERT INTO orders (public_id, student_id, status, subtotal, discount, total, gateway, customer_name, customer_email, paid_at) VALUES (?, ?, ?, ?, 0, ?, 'mock', 'n', 'e@x.test', ?)")
        .bind(`ga-${tag}-${Date.now()}`, studentId, status, price, price, paidAt)
        .run();
      await env.DB.prepare("INSERT INTO order_items (order_id, course_id, title_bn, title_en, list_price, price) VALUES (?, ?, 't', 't', ?, ?)").bind(o.meta.last_row_id, course_id, price, price).run();
    };
    const now = new Date().toISOString();
    const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();
    await insert(course.id, "paid", now, 500, "a1");
    await insert(course.id, "paid", now, 700, "a2");
    await insert(course.id, "paid", longAgo, 999, "old"); // outside the 28 days
    await insert(course.id, "pending", null, 123, "pend"); // not paid
    await insert(course.id, "paid", now, 0, "free"); // a free enrolment is not a sale
    await insert(other.id, "refunded", now, 321, "ref"); // refunded is not a sale
    return { course, other };
  }

  it("puts Google's page views and the shop's own paid sales side by side, one row per class", async () => {
    google();
    const { client } = await loginStaff();
    const { course, other } = await seedSales();
    const body = await connected(async () => json(await client.get("/api/admin/analytics/report?range=28d")));
    expect(body.report.connected).toBe(true);
    const r = body.report;
    expect(r).toMatchObject({ range: "28d", overview: { users: 140, new_users: 90, sessions: 210, page_views: 700, engagement_rate: 0.62, avg_session_sec: 95 }, problems: [] });
    expect(r.from <= r.to).toBe(true);
    expect(r.daily).toEqual([{ date: "20261014", page_views: 120, users: 40 }, { date: "20261015", page_views: 260, users: 70 }]);

    const row = (slug: string) => r.classes.find((c: { slug: string }) => c.slug === slug);
    // the Bangla and the English page of one class are one row; time on page is per person
    expect(row(course.slug)).toMatchObject({ id: course.id, views: 150, people: 75, seconds_per_person: 56, item_views: 100, carts: 20, checkouts: 10, ga_purchases: 4, paid_sales: 2, revenue: 1200 });
    // a trailing slash is the same page
    expect(row(other.slug)).toMatchObject({ id: other.id, views: 10, people: 5, seconds_per_person: 10, paid_sales: 0, revenue: 0 });
    // a page Google saw for a class that is not in the shop (renamed, removed) is still shown, as such
    expect(row("a-class-that-was-renamed")).toMatchObject({ id: null, title_en: "", views: 7, paid_sales: 0 });
    // banners are sent to Google as items too: they are not classes
    expect(row("hero-1")).toBeUndefined();
    expect(row("offer-3")).toBeUndefined();
    // a class on sale that nobody opened is listed with zeros
    expect(row(SLUGS.c)).toMatchObject({ views: 0, people: 0, item_views: 0, carts: 0, paid_sales: 0 });
    // busiest first
    const views = r.classes.map((c: { views: number }) => c.views);
    expect(views).toEqual([...views].sort((x: number, y: number) => y - x));
    // the other panels
    expect(r.events).toEqual([{ event: "view_item", count: 150, users: 70 }, { event: "add_to_cart", count: 20, users: 15 }, { event: "purchase", count: 4, users: 4 }]);
    expect(r.sources[0]).toEqual({ name: "google / organic", sessions: 100, users: 80 });
    expect(r.devices.map((d: { name: string }) => d.name)).toEqual(["mobile", "desktop"]);
    expect(r.countries[0]).toEqual({ name: "Bangladesh", sessions: 180, users: 120 });
    expect(r.searches).toEqual([{ term: "cake", count: 9 }]); // "(not set)" is not a search
    expect(r.promotions).toEqual([{ name: "Learn to bake in Bangla", views: 80, clicks: 6 }]);
    expect(r.pages[0]).toEqual({ path: "/", views: 300, users: 150 });
  });

  it("counts a class that was drafted or archived only if it sold in these days", async () => {
    google();
    const { client } = await loginStaff();
    const { course, other } = await seedSales();
    await env.DB.prepare("UPDATE courses SET status = 'draft' WHERE id = ?").bind(course.id).run(); // sold in the 28 days
    await env.DB.prepare("UPDATE courses SET status = 'archived' WHERE id = ?").bind(SLUGS.c ? (await firstCourse(SLUGS.c)).id : 0).run(); // sold nothing
    try {
      const r = (await connected(async () => json(await client.get("/api/admin/analytics/report?range=28d")))).report;
      const slugs = r.classes.map((c: { slug: string }) => c.slug);
      expect(slugs).toContain(course.slug);
      expect(slugs).not.toContain(SLUGS.c);
      expect(r.classes.find((c: { slug: string }) => c.slug === course.slug)).toMatchObject({ status: "draft", paid_sales: 2 });
    } finally {
      await env.DB.prepare("UPDATE courses SET status = 'published' WHERE slug IN (?, ?)").bind(course.slug, SLUGS.c).run();
      void other;
    }
  });

  it("asks for the days that were chosen, and a wrong choice means 28 days", async () => {
    const stand = google();
    const { client } = await loginStaff();
    await connected(async () => {
      await client.get("/api/admin/analytics/report?range=7d");
      await client.get("/api/admin/analytics/report?range=today");
      await client.get("/api/admin/analytics/report?range=90d");
      await client.get("/api/admin/analytics/report?range=forever");
    });
    const starts = (n: number) => stand.data.filter((c) => !c.body.dimensions).map((c) => c.body.dateRanges[0]).slice(n, n + 1)[0];
    expect(starts(0)).toEqual({ startDate: "6daysAgo", endDate: "today" });
    expect(starts(1)).toEqual({ startDate: "today", endDate: "today" });
    expect(starts(2)).toEqual({ startDate: "89daysAgo", endDate: "today" });
    expect(starts(3)).toEqual({ startDate: "27daysAgo", endDate: "today" });
  });

  it("asks only for the events the shop sends, and only for class pages when it asks about classes", async () => {
    const stand = google();
    const { client } = await loginStaff();
    await connected(async () => json(await client.get("/api/admin/analytics/report")));
    const by = (dim: string) => stand.data.find((c) => c.body.dimensions?.[0]?.name === dim && c.body.dimensionFilter?.filter?.stringFilter?.matchType !== "BEGINS_WITH");
    expect(by("eventName")!.body.dimensionFilter.filter.inListFilter.values).toEqual(GA_EVENTS.map((x) => x.name));
    const classes = stand.data.find((c) => c.body.dimensionFilter?.filter?.stringFilter?.matchType === "FULL_REGEXP")!;
    const re = new RegExp(classes.body.dimensionFilter.filter.stringFilter.value);
    for (const yes of ["/courses/cake", "/en/courses/cake", "/courses/cake/", "/en/courses/cake-2/"]) expect(re.test(yes), yes).toBe(true);
    for (const no of ["/courses", "/en/courses", "/courses/cake/lesson", "/app/learn/cake", "/blog/courses/x", "/fr/courses/x"]) expect(re.test(no), no).toBe(false);
    // the admin's own page views are not shown in "busiest pages"
    const pages = stand.data.find((c) => c.body.dimensionFilter?.notExpression);
    expect(pages!.body.dimensionFilter.notExpression.filter.stringFilter).toMatchObject({ matchType: "BEGINS_WITH", value: "/admin" });
    // the first question asked is the overview, alone: if the set-up is wrong, one answer says so
    expect(stand.data[0]!.body.dimensions).toBeUndefined();
  });

  it("shows what could be read when Google refuses one question, and says which one", async () => {
    const stand = google();
    stand.dataReply = (call) => (call.body.dimensions?.[0]?.name === "searchTerm" ? googleError(400, "Field searchTerm is not a valid dimension.", "INVALID_ARGUMENT") : undefined);
    const { client } = await loginStaff();
    const r = (await connected(async () => json(await client.get("/api/admin/analytics/report")))).report;
    expect(r.connected).toBe(true);
    expect(r.overview.users).toBe(140);
    expect(r.searches).toEqual([]);
    expect(r.problems).toEqual([{ section: "searches", problem: "bad_request", detail: expect.stringContaining("searchTerm") }]);
  });

  it("stops at the first refusal that no other question could get past, instead of showing ten empty panels", async () => {
    const stand = google();
    stand.dataReply = () => googleError(403, "Google Analytics Data API has not been used in project 123456 before or it is disabled.", "PERMISSION_DENIED");
    const { client } = await loginStaff();
    const body = await connected(async () => json(await client.get("/api/admin/analytics/report")));
    expect(body.report).toMatchObject({ connected: false, problem: "api_disabled" });
    expect(stand.data).toHaveLength(1);
    // …and it is not kept: the next look asks again
    const after = await connected(async () => json(await client.get("/api/admin/analytics/report")));
    expect(after.report.connected).toBe(false);
    expect(stand.data).toHaveLength(2);
    expect(await json(await client.get("/api/admin/analytics/status"))).toMatchObject({ last: { ok: false, problem: "api_disabled" } });
  });

  it("keeps a report for ten minutes, so opening the screen again does not use Google's quota, until the owner presses Refresh", async () => {
    const stand = google();
    const { client } = await loginStaff();
    await connected(async () => {
      const first = await json(await client.get("/api/admin/analytics/report"));
      const asked = stand.data.length;
      expect(asked).toBeGreaterThan(8);
      const second = await json(await client.get("/api/admin/analytics/report"));
      expect(stand.data).toHaveLength(asked);
      expect(second.report.fetched_at).toBe(first.report.fetched_at);
      // another range is another report
      await client.get("/api/admin/analytics/report?range=7d");
      expect(stand.data.length).toBeGreaterThan(asked);
      const before = stand.data.length;
      expect((await client.post("/api/admin/analytics/refresh")).status).toBe(200);
      await client.get("/api/admin/analytics/report");
      expect(stand.data.length).toBeGreaterThan(before);
    });
  });

  it("writes the same class table as a spreadsheet, formula-safe, and refuses when there is nothing to write", async () => {
    google();
    const { client } = await loginStaff();
    await seedSales();
    const res = await connected(() => client.get("/api/admin/analytics/classes.csv?range=28d"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="classes-28d-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}-/);
    const csv = await res.text();
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Class,Address name,Page views,People,Seconds on page per person,Pressed Enroll now,Opened checkout,Paid (Google saw),Paid sales (shop records),Money (BDT, shop records)".replace("Money (BDT, shop records)", '"Money (BDT, shop records)"'));
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.some((l) => l.includes(`,${SLUGS.a},150,75,56,20,10,4,2,1200`))).toBe(true);

    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: undefined }, async () => {
      await clearKept();
      expect((await client.get("/api/admin/analytics/classes.csv")).status).toBe(409);
    });
  });

  it("shows who is on the site right now, kept for half a minute", async () => {
    const stand = google();
    const { client } = await loginStaff("viewer");
    await connected(async () => {
      const live = (await json(await client.get("/api/admin/analytics/realtime"))).live;
      expect(live).toMatchObject({ connected: true, active_users: 5, pages: [{ title: "Beginners Baking Class | MAWAH Academy", users: 3 }, { title: "MAWAH Academy", users: 2 }] });
      expect(stand.data.map((c) => c.kind)).toEqual(["runRealtimeReport"]);
      expect(stand.data[0]!.body).toMatchObject({ dimensions: [{ name: "unifiedScreenName" }], metrics: [{ name: "activeUsers" }], metricAggregations: ["TOTAL"] });
      await client.get("/api/admin/analytics/realtime");
      expect(stand.data).toHaveLength(1);
      // Cloudflare KV keeps a value for a minute at the least, so the answer carries its own time: one older than half a minute is not used
      await env.KV.put("ga4:live", JSON.stringify({ ...live, fetched_at: new Date(Date.now() - 31_000).toISOString() }), { expirationTtl: 60 });
      await client.get("/api/admin/analytics/realtime");
      expect(stand.data).toHaveLength(2);
    });
    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: undefined }, async () => {
      await clearKept();
      expect((await json(await client.get("/api/admin/analytics/realtime"))).live).toMatchObject({ connected: false, problem: "not_configured" });
    });
  });
});

/* ============================================================================================= the dashboard */

describe("the dashboard's health strip", () => {
  it("says whether visits are being counted and whether the Google key works", async () => {
    const stand = google();
    const { client } = await loginStaff();
    const card = async () => (await json(await client.get("/api/admin/health"))).checks.find((c: { key: string }) => c.key === "analytics") as { status: string; issues: string[] };
    await setOwnId("");
    expect(await card()).toMatchObject({ status: "warn", issues: ["analytics_no_id"] });
    await setOwnId(OWN_ID);
    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: undefined }, async () => expect(await card()).toMatchObject({ status: "info", issues: ["analytics_key_missing"] }));
    await connected(async () => {
      expect(await card()).toMatchObject({ status: "ok", issues: [] });
      // the owner pressed "Check the connection" and Google said no
      stand.dataReply = () => googleError(403, "User does not have sufficient permissions for this property.", "PERMISSION_DENIED");
      await client.post("/api/admin/analytics/check");
      expect(await card()).toMatchObject({ status: "warn", issues: ["analytics_last_failed"] });
      // …and then yes again
      stand.dataReply = undefined;
      await client.post("/api/admin/analytics/check");
      expect(await card()).toMatchObject({ status: "ok", issues: [] });
    });
  });
});

/* ============================================================================================= the stand-in the browser tests use */

describe("the stand-in for Google (development and tests only)", () => {
  it("answers 404 on the real site", async () => {
    await asRealSite(async () => {
      expect((await at(`${PUBLIC}/api/dev/google/scenario`, {}, { method: "POST", body: "{}" })).status).toBe(404);
      expect((await at(`${PUBLIC}/api/dev/google/token`, {}, { method: "POST" })).status).toBe(404);
    });
  });

  it("walks the same road: a signed note gets a pass, the pass gets tables, and each way of saying no can be asked for", async () => {
    const client = new Client();
    await withEnv({ GA4_SERVICE_ACCOUNT_JSON: KEY.file, GA_PROPERTY_ID: PROPERTY, GOOGLE_API_BASE: "https://academy.test/api/dev/google" }, async () => {
      const real = globalThis.fetch;
      // send the Worker's calls for "Google" to the Worker itself (that is what the dev server does)
      vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith("https://academy.test/api/dev/google")) return real(input as never, init);
        const target = new URL(url);
        return client.fetch(`${target.pathname}${target.search}`, { method: init?.method, body: init?.body as BodyInit, headers: init?.headers });
      }) as typeof fetch);
      expect((await checkConnection(env)).ok).toBe(true);

      const staff = (await loginStaff()).client;
      const report = (await json(await staff.get("/api/admin/analytics/report"))).report;
      expect(report.connected).toBe(true);
      expect(report.overview.users).toBeGreaterThan(0);

      for (const [scenario, problem] of [["key_rejected", "key_rejected"], ["api_disabled", "api_disabled"], ["no_access", "no_access"], ["quota", "quota"], ["down", "google_error"]] as const) {
        expect((await client.post("/api/dev/google/scenario", { scenario })).status).toBe(200);
        forgetPass();
        const r = await checkConnection(env);
        expect(!r.ok && r.problem, scenario).toBe(problem);
      }
      await client.post("/api/dev/google/scenario", { scenario: "ok" });
      forgetPass();
      expect((await checkConnection(env)).ok).toBe(true);
    });
  });

  it("refuses a note that is not shaped as Google asks, and a question without a pass", async () => {
    const client = new Client();
    const bad = await client.fetch("/api/dev/google/token", { method: "POST", form: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: "not.a.note" } });
    expect(bad.status).toBe(400);
    const parsed = parseServiceAccount(KEY.file);
    if (!parsed.ok) throw new Error("key");
    const note = await signedNote(parsed.account, "https://academy.test/api/dev/google/token");
    const good = await client.fetch("/api/dev/google/token", { method: "POST", form: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: note } });
    expect(good.status).toBe(200);
    expect(await json(good)).toMatchObject({ access_token: "dev-pass", expires_in: 3600 });
    expect((await client.post(`/api/dev/google/v1beta/properties/${PROPERTY}:runReport`, { metrics: [{ name: "activeUsers" }] })).status).toBe(401);
  });
});
