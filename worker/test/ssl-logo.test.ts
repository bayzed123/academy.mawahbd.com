import { afterEach, describe, expect, it } from "vitest";
import { readSslLogo, SSL_LOGO_MAX } from "@mawah/shared";
import { SETTING_DEFAULTS, setSetting } from "../src/lib/settings";
import { buildCsp } from "../src/middleware/security";
import { Client, env, freshState, json, loginStaff, registerStudent } from "./helpers";

/*
 * SSLCommerz's own logo. SSLCommerz asks every shop that takes payments through it to show its picture (one image with the logos of the ways to
 * pay) and gives the shop the link to it — the website must not make one up. The owner pastes what SSLCommerz gave (a link, or its few lines
 * of HTML) in Settings → Payments, and the picture takes the place of the five small marks: at the bottom of every page and on the online
 * choice at checkout. What these tests protect: every shape SSLCommerz hands out is read; nothing but an https picture on sslcommerz.com is
 * taken; nothing else that was pasted ever reaches a page; the page's security policy lets that one picture in; and only the owner (or anyone
 * allowed to change settings) can set it. The picture is never fetched here — the address below is a made-up file name on SSLCommerz's server.
 */

const LOGO = "https://securepay.sslcommerz.com/public/image/test-pay-with-logos.png";
const SNIPPET = `<a href="https://www.sslcommerz.com/" target="_blank" title="SSLCommerz" alt="SSLCommerz"><img style="width:100%;height:auto;" src="${LOGO}" /></a>`;
const COURSE = "beginners-baking-class";

const payments = (over: Partial<typeof SETTING_DEFAULTS.payments> = {}) => ({ ...SETTING_DEFAULTS.payments, ...over });
async function setPayments(over: Partial<typeof SETTING_DEFAULTS.payments>) {
  await setSetting(env, "payments", payments(over), null);
  freshState();
}
const page = async (path: string) => (await new Client().get(path)).text();
const logoBlock = (html: string) => html.match(/<p class="ssl-logo">(.*?)<\/p>/s)?.[1] ?? null;

afterEach(async () => setPayments({}));

describe("reading what SSLCommerz gave", () => {
  it("takes the picture from a bare link, a link with words or a line break around it, or SSLCommerz's HTML (with its link)", () => {
    expect(readSslLogo(LOGO)).toEqual({ src: LOGO, href: null });
    expect(readSslLogo(`  ${LOGO}\n`)).toEqual({ src: LOGO, href: null });
    expect(readSslLogo(`Logo link: ${LOGO} — please add it to your website`)).toEqual({ src: LOGO, href: null });
    expect(readSslLogo(SNIPPET)).toEqual({ src: LOGO, href: "https://www.sslcommerz.com/" });
    expect(readSslLogo(`<IMG SRC='${LOGO}'>`)).toEqual({ src: LOGO, href: null });
    expect(readSslLogo(`<img alt=SSLCommerz src=${LOGO}>`)).toEqual({ src: LOGO, href: null });
    // a link straight to the picture (no <img>) is the picture
    expect(readSslLogo(`<a href="${LOGO}">SSLCommerz</a>`)).toEqual({ src: LOGO, href: null });
    // the bare sslcommerz.com and any of its sub-domains; "&amp;" written in HTML is the "&" of the address
    expect(readSslLogo(`<a href="https://sslcommerz.com/?a=1&amp;b=2"><img src="https://sslcommerz.com/logo.png?v=1&amp;w=2"></a>`)).toEqual({
      src: "https://sslcommerz.com/logo.png?v=1&w=2",
      href: "https://sslcommerz.com/?a=1&b=2",
    });
  });

  it("takes nothing that is not an https picture on sslcommerz.com", () => {
    const bad = [
      "",
      "   ",
      "the SSLCommerz logo",
      "http://securepay.sslcommerz.com/public/image/logo.png",
      "https://evil.example/logo.png",
      "https://sslcommerz.com.evil.example/logo.png",
      "https://evilsslcommerz.com/logo.png",
      "https://user:secret@securepay.sslcommerz.com/logo.png",
      "https://securepay.sslcommerz.com:8443/logo.png",
      "javascript:alert(1)",
      `<img src="javascript:alert(1)">`,
      `<img src="https://evil.example/logo.png">`,
      `<img src="data:image/png;base64,AAAA">`,
      `${LOGO}${" ".repeat(SSL_LOGO_MAX)}x`,
    ];
    for (const v of bad) expect(readSslLogo(v), v.slice(0, 60)).toBeNull();
  });

  it("keeps the picture but drops a link that goes anywhere but SSLCommerz", () => {
    expect(readSslLogo(`<a href="https://evil.example/"><img src="${LOGO}"></a>`)).toEqual({ src: LOGO, href: null });
    expect(readSslLogo(`<a href="javascript:alert(1)"><img src="${LOGO}"></a>`)).toEqual({ src: LOGO, href: null });
  });
});

describe("Settings → Payments → SSLCommerz logo", () => {
  it("keeps exactly what was pasted when it holds an SSLCommerz picture, and says plainly when it does not", async () => {
    const admin = (await loginStaff("super_admin")).client;
    expect((await admin.put("/api/admin/settings/payments", payments({ ssl_logo: SNIPPET }))).status).toBe(200);
    expect((await json(await admin.get("/api/admin/settings"))).settings.payments.ssl_logo).toBe(SNIPPET);

    for (const v of ["https://evil.example/logo.png", "http://securepay.sslcommerz.com/x.png", "not a link", `<img src="https://evil.example/x.png">`]) {
      const res = await admin.put("/api/admin/settings/payments", payments({ ssl_logo: v }));
      expect(res.status, v).toBe(422);
      expect((await json(res)).error.fields).toMatchObject({ ssl_logo: "ssl_logo_invalid" });
    }
    const long = await admin.put("/api/admin/settings/payments", payments({ ssl_logo: `${LOGO} ${"x".repeat(SSL_LOGO_MAX)}` }));
    expect((await json(long)).error.fields).toMatchObject({ ssl_logo: "too_long" });
    // the refused ones did not replace the good one
    expect((await json(await admin.get("/api/admin/settings"))).settings.payments.ssl_logo).toBe(SNIPPET);

    // emptied: nothing of SSLCommerz's is shown
    expect((await admin.put("/api/admin/settings/payments", payments({ ssl_logo: "" }))).status).toBe(200);
    expect((await json(await admin.get("/api/admin/settings"))).settings.payments.ssl_logo).toBe("");
  });

  it("only people who may change settings can set it", async () => {
    for (const role of ["viewer", "support", "content_manager"] as const) {
      const { client } = await loginStaff(role);
      expect((await client.put("/api/admin/settings/payments", payments({ ssl_logo: LOGO }))).status, role).toBe(403);
    }
    expect((await new Client().put("/api/admin/settings/payments", payments({ ssl_logo: LOGO }))).status).toBe(401);
  });
});

describe("SSLCommerz's logo on the site", () => {
  it("every public page shows SSLCommerz's picture in place of the five marks, in both languages, linking to SSLCommerz", async () => {
    await setPayments({ ssl_logo: SNIPPET });
    for (const [path, alt] of [
      ["/", "SSLCommerz-এর মাধ্যমে পেমেন্ট"],
      ["/courses", "SSLCommerz-এর মাধ্যমে পেমেন্ট"],
      ["/en", "Pay through SSLCommerz"],
      ["/en/faq", "Pay through SSLCommerz"],
    ] as const) {
      const html = await page(path);
      const block = logoBlock(html);
      expect(block, path).not.toBeNull();
      expect(block).toContain('<a href="https://www.sslcommerz.com/" rel="noopener noreferrer" target="_blank">');
      expect(block).toMatch(new RegExp(`<img src="${LOGO.replace(/[.?]/g, "\\$&")}" alt="${alt}" loading="lazy" decoding="async"\\s*/?>`));
      expect(html, "SSLCommerz's picture replaces the small marks").not.toContain('class="pay-logos"');
      // still under the "We accept" heading
      expect(html).toMatch(/<p class="foot-h mt" id="pay-h">[^<]+<\/p>\s*<p class="ssl-logo">/);
    }
  });

  it("a bare link shows the picture with no link; nothing pasted, or online payment switched off, keeps the five marks", async () => {
    await setPayments({ ssl_logo: LOGO });
    const bare = logoBlock(await page("/en"));
    expect(bare).toContain(`src="${LOGO}"`);
    expect(bare).not.toContain("<a ");

    await setPayments({ ssl_logo: "" });
    let html = await page("/en");
    expect(logoBlock(html)).toBeNull();
    expect(html).toContain('class="pay-logos"');

    await setPayments({ ssl_logo: LOGO, sslcommerz: false });
    html = await page("/en");
    expect(logoBlock(html), "no SSLCommerz logo while online payment is off").toBeNull();
    expect(html).toContain('class="pay-logos"');
  });

  it("nothing else from what was pasted ever reaches a page — only the two addresses", async () => {
    // a stored value can only ever have passed the check above; this one is put straight in the database, as an attacker with database access
    // or a future bug might, to show the page still takes nothing but the picture's address and the link
    await setPayments({
      ssl_logo: `<a href="https://www.sslcommerz.com/" onclick="alert(1)" style="x"><img src="${LOGO}" onerror="alert(2)" class="evil"></a><script>alert(3)</script>`,
    });
    const html = await page("/en");
    expect(logoBlock(html)).toContain(`src="${LOGO}"`);
    for (const bad of ["alert(1)", "alert(2)", "alert(3)", 'class="evil"', "onerror", "onclick"]) expect(html, bad).not.toContain(bad);
  });

  it("the page's security policy lets pictures come from SSLCommerz — on the public pages, the student app and the admin", async () => {
    const imgSources = (csp: string) =>
      (
        csp
          .split(";")
          .map((d) => d.trim())
          .find((d) => d.startsWith("img-src ")) ?? ""
      ).split(" ");
    const wanted = ["'self'", "https://sslcommerz.com", "https://*.sslcommerz.com"];
    // the public pages, as served
    for (const path of ["/", "/en/courses"]) {
      const res = await new Client().get(path);
      expect(imgSources(res.headers.get("content-security-policy") ?? ""), path).toEqual(expect.arrayContaining(wanted));
    }
    // the student app and the admin take their policy from the same builder (routes/spa.ts); their built pages are not needed for this
    expect(imgSources(buildCsp({ spa: true }))).toEqual(expect.arrayContaining(wanted));
    expect(imgSources(buildCsp({ spa: true, analytics: { ga4: true, clarity: true, pixel: true }, turnstile: true }))).toEqual(expect.arrayContaining(wanted));
  });
});

describe("SSLCommerz's logo at checkout", () => {
  it("the price answer carries the picture for the online choice — not when online payment is off, nothing is pasted, or the class is free", async () => {
    const buyer = await registerStudent();
    const quote = async () => (await json(await buyer.client.post("/api/checkout/quote", { courses: [COURSE] }))).quote;

    await setPayments({ ssl_logo: SNIPPET });
    let q = await quote();
    expect(q.channels).toContain("sslcommerz");
    expect(q.ssl_logo).toBe(LOGO);

    await setPayments({ ssl_logo: SNIPPET, sslcommerz: false });
    q = await quote();
    expect(q.channels).not.toContain("sslcommerz");
    expect(q.ssl_logo).toBeNull();

    await setPayments({ ssl_logo: "" });
    expect((await quote()).ssl_logo).toBeNull();

    // a free class needs no payment at all
    await setPayments({ ssl_logo: LOGO });
    const free = await env.DB.prepare("SELECT slug FROM courses WHERE price = 0 AND status = 'published' LIMIT 1").first<{ slug: string }>();
    if (free) {
      const fq = (await json(await buyer.client.post("/api/checkout/quote", { courses: [free.slug] }))).quote;
      expect(fq.channels).toEqual([]);
      expect(fq.ssl_logo).toBeNull();
    }
  });
});
