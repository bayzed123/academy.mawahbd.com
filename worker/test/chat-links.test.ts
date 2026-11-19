import { afterEach, describe, expect, it, vi } from "vitest";
import { linkify } from "../src/services/chatLinks";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * The chatbot's answers name pages by their path; the visitor gets buttons instead — the page's own name (a class: its real title), the right
 * language's address — and the paths are taken out of the words. Only pages that exist get a button.
 */
const CLASS = "traditional-aurosh-biryani-online-class";
afterEach(() => vi.restoreAllMocks());

describe("pages in an answer become buttons", () => {
  it("a path in brackets after a page's name is dropped from the words and becomes a button", async () => {
    const r = await linkify(env, "এরপর আপনার 'আমার ক্লাস' বা My Learning (/app/) পেজে যান।", "bn");
    expect(r.reply).toBe("এরপর আপনার 'আমার ক্লাস' বা My Learning পেজে যান।");
    expect(r.links).toEqual([{ label: "আমার ক্লাস", href: "/app/" }]);
  });

  it("a class gets its real title and the address in the visitor's language; the site's full address and a bare path work too", async () => {
    const c = await env.DB.prepare("SELECT title_en, title_bn FROM courses WHERE slug = ?").bind(CLASS).first<any>();
    const en = await linkify(env, `Have a look at the biryani class (/courses/${CLASS}). Your orders are at https://mawahacademy.com/app/orders, or write to /contact.`, "en");
    expect(en.links).toEqual([
      { label: c.title_en, href: `/en/courses/${CLASS}` },
      { label: "My orders", href: "/app/orders" },
      { label: "Contact us", href: "/en/contact" },
    ]);
    expect(en.reply).not.toMatch(/\/courses\/|\/app\/|\/contact|https?:/);
    const bn = await linkify(env, `ক্লাসটি দেখুন: /courses/${CLASS}`, "bn");
    expect(bn.links).toEqual([{ label: c.title_bn, href: `/courses/${CLASS}` }]);
    expect(bn.reply).toBe(`ক্লাসটি দেখুন: ${c.title_bn}`);
  });

  it("a class that is not on the website, or a page the website does not have, gets no button", async () => {
    const r = await linkify(env, "See /courses/no-such-class-here or /app/secret-admin and /admin/.", "en");
    expect(r.links).toEqual([]);
    expect(r.reply).not.toContain("no-such-class-here");
    expect((await linkify(env, "No pages here at all.", "en")).links).toEqual([]);
  });

  it("the chatbot's answer carries them", async () => {
    const owner = (await loginStaff("super_admin")).client;
    await owner.put("/api/admin/chatbot/providers/gemini/key", { api_key: "fake-test-key-not-a-secret-0123456789-abcd" });
    expect((await owner.post("/api/admin/chatbot/providers/gemini/activate")).status).toBe(200);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "সাইন ইন করে আমার ক্লাস (/app/) পাতায় যান, সেখানে ভিডিও দেখতে পাবেন।" }] } }] }), { status: 200 }),
    );
    const res = await json(await new Client().post("/api/chat", { messages: [{ role: "user", content: "Course enrolled korar pore video dekhbo kivabe links-case" }], lang: "bn" }));
    expect(res).toMatchObject({ escalate: false, reply: "সাইন ইন করে আমার ক্লাস পাতায় যান, সেখানে ভিডিও দেখতে পাবেন।", links: [{ label: "আমার ক্লাস", href: "/app/" }] });
    await env.DB.prepare("UPDATE ai_provider_configs SET is_active = 0, key_enc = NULL WHERE provider = 'gemini'").run();
  });
});
