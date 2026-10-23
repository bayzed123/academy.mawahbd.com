import { describe, expect, it } from "vitest";
import { PAGE_TEXTS } from "../src/content/pageTexts";
import { renderMarkdown } from "../src/lib/markdown";
import { SETTING_DEFAULTS, setSetting, TRADE_LICENCE } from "../src/lib/settings";
import { Client, env, firstCourse, json, loginStaff, registerStudent, uniqueEmail } from "./helpers";

/*
 * What SSLCommerz asks of a store's website before it switches payments on (its onboarding e-mail): the registered address and the trade
 * licence number in every page's footer and on the Contact / About pages, the delivery time, each item's availability (on its picture too when
 * it is not available), no third-party advertisements, and a blank box the buyer ticks to agree to the terms, the privacy policy and the refund
 * & cancellation policy before the order is placed.
 */

const text = async (res: Response) => await res.text();
const CONTACT = { ...SETTING_DEFAULTS.contact, phone: "09613-754321", whatsapp: "+880 13 0405 0584", email: "info@mawahbd.com" };
const footerOf = (html: string) => html.slice(html.indexOf('<footer class="site-footer"'));

describe("the registered address and the trade licence number", () => {
  it("are in every public page's footer, in the page's language, next to the delivery page", async () => {
    await setSetting(env, "contact", CONTACT, null);
    for (const path of ["/", "/en", "/courses", "/en/courses", "/about", "/en/contact", "/policies/refund", "/en/how-to-order"]) {
      const en = path === "/en" || path.startsWith("/en/");
      const foot = footerOf(await text(await new Client().get(path)));
      expect(foot, path).toContain(TRADE_LICENCE.trade_license);
      expect(foot, path).toContain(en ? TRADE_LICENCE.address_en : TRADE_LICENCE.address_bn);
      expect(foot, path).toContain(en ? "Trade licence No.: " : "ট্রেড লাইসেন্স নং: ");
      expect(foot, path).toContain(`href="${en ? "/en" : ""}/policies/delivery"`);
    }
  });

  it("are the business details on the Contact and About pages; the owner's own (Settings → Contact) replace them, and empty ones show no label", async () => {
    await setSetting(env, "contact", CONTACT, null);
    const about = await text(await new Client().get("/en/about"));
    expect(about).toContain("<h2 class=\"mt\">Business details</h2>");
    expect(about).toContain(`<dd>${TRADE_LICENCE.trade_license}</dd>`);
    expect(about).toContain(`<dd>${TRADE_LICENCE.address_en}</dd>`);
    const contactBn = await text(await new Client().get("/contact"));
    expect(contactBn).toContain("প্রতিষ্ঠানের তথ্য");
    expect(contactBn).toContain(`<dd>${TRADE_LICENCE.address_bn}</dd>`);

    // the owner writes their own in Admin → Settings → Contact (and only staff who may change settings can)
    const mine = { ...CONTACT, trade_license: "TRAD/CHT/000001/2026", address_en: "House 1, Road 1, Chattogram", address_bn: "বাড়ি ১, রোড ১, চট্টগ্রাম" };
    expect((await (await loginStaff("viewer")).client.put("/api/admin/settings/contact", mine)).status).toBe(403);
    const res = await (await loginStaff("super_admin")).client.put("/api/admin/settings/contact", mine);
    expect(res.status).toBe(200);
    expect((await json(res)).settings.contact).toMatchObject({ trade_license: "TRAD/CHT/000001/2026", address_bn: "বাড়ি ১, রোড ১, চট্টগ্রাম" });
    const home = footerOf(await text(await new Client().get("/en")));
    expect(home).toContain("TRAD/CHT/000001/2026");
    expect(home).toContain("House 1, Road 1, Chattogram");
    expect(home).not.toContain(TRADE_LICENCE.trade_license);

    // emptied: nothing is shown, not even a label
    await setSetting(env, "contact", { ...CONTACT, trade_license: "", address_bn: "", address_en: "" }, null);
    const bare = await text(await new Client().get("/en/about"));
    expect(bare).not.toContain('class="foot-legal"');
    expect(bare).not.toContain('class="biz"');
    expect(bare).not.toContain("Business details");
    expect(await text(await new Client().get("/contact"))).not.toContain("প্রতিষ্ঠানের তথ্য");
    await setSetting(env, "contact", CONTACT, null);
  });

  it("a too long or control-character address is refused or cleaned", async () => {
    const admin = (await loginStaff("super_admin")).client;
    const long = await admin.put("/api/admin/settings/contact", { ...CONTACT, address_en: "x".repeat(201) });
    expect(long.status).toBe(422);
    expect((await json(long)).error.fields.address_en).toBe("too_long");
    const res = await admin.put("/api/admin/settings/contact", { ...CONTACT, trade_license: " TRADICHTG/010407/2022\u0007 " });
    expect((await json(res)).settings.contact.trade_license).toBe("TRADICHTG/010407/2022");
    await setSetting(env, "contact", CONTACT, null);
  });
});

describe("the delivery time", () => {
  it("has its own page in both languages: online classes open in the account; anything physical takes 5 days inside Dhaka, 10 outside", async () => {
    await setSetting(env, "contact", CONTACT, null);
    for (const [url, lang, title] of [
      ["/policies/delivery", "bn", "ডেলিভারি নীতি"],
      ["/en/policies/delivery", "en", "Delivery policy"],
    ] as const) {
      const res = await new Client().get(url);
      expect(res.status, url).toBe(200);
      const html = await text(res);
      expect(html, url).toContain(`<h1>${title}</h1>`);
      expect(html, url).toContain(renderMarkdown(PAGE_TEXTS.delivery[lang]));
      expect(html, url).toContain('href="tel:09613754321"'); // how to reach us, under it
    }
    expect(PAGE_TEXTS.delivery.en).toContain("**5 days inside Dhaka** and within **10 days outside Dhaka**");
    expect(PAGE_TEXTS.delivery.bn).toContain("**ঢাকার ভেতরে ৫ দিনের মধ্যে** এবং **ঢাকার বাইরে ১০ দিনের মধ্যে**");
    const map = await text(await new Client().get("/sitemap.xml"));
    expect(map).toContain("/policies/delivery</loc>");
    expect(map).toContain("/en/policies/delivery</loc>");
  });
});

describe("the policies", () => {
  it("say there are no third-party advertisements and no sharing beyond what the privacy policy lists; the refund page covers cancelling", () => {
    expect(PAGE_TEXTS.terms.en).toContain("We do not show any third-party advertisements on this website.");
    expect(PAGE_TEXTS.privacy.en).toContain("We do not show third-party advertisements on this website, and no advertiser gets your information.");
    expect(PAGE_TEXTS.terms.bn).toContain("আমরা এই ওয়েবসাইটে তৃতীয় কোনো পক্ষের বিজ্ঞাপন দেখাই না।");
    expect(PAGE_TEXTS.privacy.bn).toContain("এই ওয়েবসাইটে তৃতীয় কোনো পক্ষের বিজ্ঞাপন দেখানো হয় না");
    expect(PAGE_TEXTS.refund.en).toContain("## Cancelling an order");
    expect(PAGE_TEXTS.refund.bn).toContain("## অর্ডার বাতিল");
    // the terms name the box ticked at checkout
    expect(PAGE_TEXTS.terms.en).toContain("Before you place an order, you tick a box to agree to these terms");
  });
});

describe("whether a class is available", () => {
  it("shows on every class card and on the class page — and, for one not yet open, on its picture", async () => {
    const list = await text(await new Client().get("/en/courses?per_page=60"));
    const cards = list.split('<article class="card').slice(1);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      if (card.includes('class="ribbon"')) {
        expect(card).toContain('<span class="ribbon">Not available yet</span>');
        expect(card).toMatch(/class="stock out"[^]*?Not available yet/);
      } else expect(card).toMatch(/class="stock in"[^]*?Available</);
    }
    const bn = await text(await new Client().get("/courses"));
    expect(bn).toMatch(/class="stock in"[^]*?ভর্তি চলছে/);

    const open = await firstCourse();
    expect(await text(await new Client().get(`/en/courses/${open.slug}`))).toContain("Available: an online class that opens in your account after payment.");
    // a class that is not open yet ("coming soon")
    const soon = { slug: `not-yet-${Date.now().toString(36)}`, title: "Monsoon Pitha Masterclass" };
    await env.DB.prepare(
      `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
       VALUES (?, 'বর্ষার পিঠা মাস্টারক্লাস', ?, 900, 'coming_soon', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    )
      .bind(soon.slug, soon.title)
      .run();
    const page = await text(await new Client().get(`/en/courses/${soon.slug}`));
    expect(page).toContain('<p class="stock out">Not available yet</p>');
    expect(page).not.toContain("Available: an online class");
    const found = (await text(await new Client().get(`/en/courses?q=${encodeURIComponent(soon.title)}`))).split('<article class="card').slice(1);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('<span class="ribbon">Not available yet</span>');
    expect(found[0]).toMatch(/class="stock out"[^]*?Not available yet/);
  });
});

describe("the box ticked before an order is placed", () => {
  it("is needed: without it (left out, false, or anything but true) nothing is ordered, signed in or not; with it the order goes through", async () => {
    const course = await firstCourse();
    const { client, id } = await registerStudent();
    const orders = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE student_id = ?").bind(id).first<{ n: number }>())!.n;
    for (const agree of [undefined, false, "true", 1]) {
      const res = await client.post("/api/checkout", { courses: [course.slug], channel: "mock", ...(agree === undefined ? {} : { agree }) });
      expect(res.status, String(agree)).toBe(422);
      expect((await json(res)).error.fields.agree, String(agree)).toBe("required");
    }
    expect(await orders()).toBe(0);
    expect((await client.post("/api/checkout", { courses: [course.slug], channel: "mock", agree: true })).status).toBe(201);
    expect(await orders()).toBe(1);

    // a visitor: no account is made and nothing is ordered without the tick
    const email = uniqueEmail("noagree");
    const guest = { name: "Rina Akter", phone: "01711223399", address: "House 12, Road 5, Dhanmondi, Dhaka", email, courses: [course.slug], channel: "mock", lang: "en" };
    const refused = await new Client().post("/api/checkout/guest", guest);
    expect(refused.status).toBe(422);
    expect((await json(refused)).error.fields.agree).toBe("required");
    expect(await env.DB.prepare("SELECT id FROM students WHERE email = ?").bind(email).first()).toBeNull();
    expect((await new Client().post("/api/checkout/guest", { ...guest, agree: true })).status).toBe(201);
  });
});
