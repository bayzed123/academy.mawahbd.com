import { describe, expect, it } from "vitest";
import migration from "../migrations/0015_page_texts.sql?raw";
import { ABOUT_TEXT, PAGE_TEXTS, type PageKind } from "../src/content/pageTexts";
import { renderMarkdown } from "../src/lib/markdown";
import { getSettings, SETTING_DEFAULTS, setSetting } from "../src/lib/settings";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * The policy and help pages: refund, privacy and terms (SSLCommerz looks for them before it switches a store on), how to order, how to use
 * the site, and the hotline. The site's own texts show until the owner writes their own in Admin → Settings → Policies; the numbers and the
 * e-mail under every page come from Settings → Contact, never from the texts.
 */

const text = async (res: Response) => await res.text();
const PAGES: [string, PageKind][] = [
  ["/policies/refund", "refund"],
  ["/policies/privacy", "privacy"],
  ["/policies/terms", "terms"],
  ["/how-to-order", "order"],
  ["/guide", "guide"],
  ["/hotline", "hotline"],
];
const CONTACT = { whatsapp: "+880 13 0405 0584", phone: "09613-754321", email: "info@mawahbd.com", facebook: "", youtube: "", instagram: "" };
/** a statement of the migration, by what it starts with */
const statement = (start: string) => migration.split(/;\s*\n/).map((s) => s.replace(/^(--[^\n]*\n)+/, "").trim()).filter((s) => s.startsWith(start));

describe("the policy and help pages", () => {
  it("the first install's short stand-ins are gone: refund, privacy, terms and About now show the site's own texts", async () => {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'policies'").first<{ value: string }>();
    for (const k of ["refund_bn", "refund_en", "privacy_bn", "privacy_en", "terms_bn", "terms_en"]) expect(JSON.parse(row!.value)[k], k).toBeUndefined();
    const s = await getSettings(env, { fresh: true });
    expect(s.policies.refund_en).toBe(PAGE_TEXTS.refund.en);
    expect(s.about).toEqual({ bn: ABOUT_TEXT.bn, en: ABOUT_TEXT.en });
  });

  it("each page, in both languages, shows its text as a page (not as Markdown) and, under it, how to reach us from Settings → Contact", async () => {
    await setSetting(env, "contact", CONTACT, null);
    for (const [path, kind] of PAGES) {
      for (const lang of ["bn", "en"] as const) {
        const url = lang === "en" ? `/en${path}` : path;
        const res = await new Client().get(url);
        expect(res.status, url).toBe(200);
        const html = await text(res);
        expect(html, url).toContain(renderMarkdown(PAGE_TEXTS[kind][lang]));
        expect(html, url).not.toMatch(/will be published here soon|শীঘ্রই এখানে প্রকাশ করা হবে/);
        expect(html, url).toContain('href="tel:09613754321"');
        expect(html, url).toContain("https://wa.me/8801304050584");
        expect(html, url).toContain('href="mailto:info@mawahbd.com"');
        expect(html, url).not.toMatch(/\sstyle="/);
      }
    }
    // the hotline page puts the numbers first, before its words
    const hotline = await text(await new Client().get("/hotline"));
    expect(hotline.indexOf('class="page-contact big"')).toBeGreaterThan(0);
    expect(hotline.indexOf('class="page-contact big"')).toBeLessThan(hotline.indexOf('class="prose"'));
  });

  it("no contact details set: no empty box", async () => {
    await setSetting(env, "contact", { ...CONTACT, phone: "", whatsapp: "", email: "" }, null);
    expect(await text(await new Client().get("/en/guide"))).not.toContain(`class="page-contact`); // (the inline styles name it)
  });

  it("the owner's own words win, saved in Admin → Settings → Policies — the help pages too", async () => {
    const admin = (await loginStaff("super_admin")).client;
    const body = { ...SETTING_DEFAULTS.policies, refund_en: "## Our own rules\n\nAsk within **3 days**.", guide_bn: "## নিজের নির্দেশিকা\n\nআমাদের লেখা।" };
    const res = await admin.put("/api/admin/settings/policies", body);
    expect(res.status).toBe(200);
    expect((await json(res)).settings.policies.guide_bn).toBe(body.guide_bn);
    const refund = await text(await new Client().get("/en/policies/refund"));
    expect(refund).toContain("<h3>Our own rules</h3>");
    expect(refund).toContain("<strong>3 days</strong>");
    expect(await text(await new Client().get("/guide"))).toContain("নিজের নির্দেশিকা");
    // and only staff who may change settings can
    const viewer = (await loginStaff("viewer")).client;
    expect((await viewer.put("/api/admin/settings/policies", body)).status).toBe(403);
    await setSetting(env, "policies", SETTING_DEFAULTS.policies, null);
  });

  it("the footer links every page, and the sitemap lists them in both languages", async () => {
    const home = await text(await new Client().get("/en"));
    for (const href of ["/en/how-to-order", "/en/guide", "/en/hotline", "/en/policies/refund", "/en/policies/privacy", "/en/policies/terms"]) expect(home).toContain(`href="${href}"`);
    const map = await text(await new Client().get("/sitemap.xml"));
    for (const path of ["/how-to-order", "/guide", "/hotline"]) {
      expect(map).toContain(`${path}</loc>`);
      expect(map).toContain(`/en${path}</loc>`);
    }
    expect((await new Client().get("/policies/shipping")).status).toBe(404);
  });
});

describe("the migration that brings the texts in (0015_page_texts.sql)", () => {
  it("removes a stand-in only while both its languages are untouched, and leaves anything the owner wrote", async () => {
    const seeded = JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = 'about'").first<{ value: string }>())?.value ?? "{}");
    expect(seeded.bn).toBeUndefined(); // already applied to this database
    const stand = { bn: "মাওয়াহ একাডেমি রান্না ও বেকিংয়ের একটি অনলাইন একাডেমি। আমাদের ক্লাসগুলো ঘরে বসে ধাপে ধাপে শেখার জন্য সাজানো — কেক, মিষ্টি, ফাস্টফুড, বিরিয়ানি থেকে শুরু করে ফ্রোজেন ফুড বিজনেস পর্যন্ত।", en: "MAWAH Academy is an online cooking and baking academy. Our classes are arranged so you can learn step by step from home — from cakes, mishti, fast food and biryani to frozen food business." };
    const [aboutSql] = statement("UPDATE settings SET value = json_remove(value, '$.bn', '$.en')");
    await setSetting(env, "about", stand, null);
    await env.DB.prepare(aboutSql).run();
    expect(JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = 'about'").first<{ value: string }>())!.value)).toEqual({});
    // the owner changed the English one: both stay
    await setSetting(env, "about", { ...stand, en: "Our story, in our words." }, null);
    await env.DB.prepare(aboutSql).run();
    expect(JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = 'about'").first<{ value: string }>())!.value).en).toBe("Our story, in our words.");
    await env.DB.prepare("DELETE FROM settings WHERE key = 'about'").run();
  });

  it("sets the hotline number and the shop's e-mail only while the contact details set on 14 October are still there; WhatsApp stays", async () => {
    const [contactSql] = statement("UPDATE settings SET value = json_set(value, '$.phone'");
    const before = { whatsapp: "+880 13 0405 0584", phone: "+880 13 0405 0584", email: "mawahacademy@gmail.com", facebook: "https://www.facebook.com/x", youtube: "", instagram: "" };
    await setSetting(env, "contact", before, null);
    await env.DB.prepare(contactSql).run();
    const after = JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = 'contact'").first<{ value: string }>())!.value);
    expect(after).toEqual({ ...before, phone: "09613-754321", email: "info@mawahbd.com" });
    // something else set since: left alone
    await setSetting(env, "contact", { ...before, phone: "01700000000" }, null);
    await env.DB.prepare(contactSql).run();
    expect(JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key = 'contact'").first<{ value: string }>())!.value).phone).toBe("01700000000");
  });
});
