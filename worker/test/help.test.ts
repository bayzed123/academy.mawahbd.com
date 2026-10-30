import { afterEach, describe, expect, it } from "vitest";
import { SETTING_DEFAULTS, setSetting } from "../src/lib/settings";
import { messengerOf, messengerUrl } from "../src/views/topbar";
import { Client, env, freshState, json, loginStaff } from "./helpers";

/*
 * "Talk to us" (the owner's fifth round: one button, then WhatsApp, Messenger or the AI assistant). The round orange button at the bottom
 * right opens a small card with every way the owner has switched on, and the visitor picks one; with one way only, that way's own button
 * stands there instead; with none, there is no button at all. The student app builds the same from /api/site (marketing/chat.js).
 */
/** What a page shows (its <body>): the inlined styles name every class too. */
const body = async (path: string) => {
  const page = await (await new Client().get(path)).text();
  return page.slice(page.indexOf("<body"));
};
/** The corner of a page: back to the top, then the way(s) to talk to us (it comes last, before the page's scripts). */
const corner = (page: string) => {
  const at = page.indexOf('<div class="floats">');
  expect(at, "the corner is on the page").toBeGreaterThan(0);
  return page.slice(at, page.indexOf("<script src=", at));
};

async function setWays({ whatsapp = "", facebook = "", messenger = "", ai = false }) {
  await setSetting(env, "contact", { ...SETTING_DEFAULTS.contact, whatsapp, facebook, messenger }, null);
  await setSetting(env, "chatbot", { ...SETTING_DEFAULTS.chatbot, enabled: ai }, null);
  freshState();
}
afterEach(async () => {
  await setSetting(env, "contact", SETTING_DEFAULTS.contact, null);
  await setSetting(env, "chatbot", SETTING_DEFAULTS.chatbot, null);
  freshState();
});

describe("the talk-to-us button", () => {
  it("is not there at all when the owner has switched on no way to talk (back to the top stays)", async () => {
    await setWays({});
    const c = corner(await body("/en"));
    expect(c).toContain('<a class="fab fab-top" href="#top"');
    for (const part of ["fab-wa", "fab-ms", "fab-chat", "fab-help", "data-help", "data-chat-open"]) expect(c, part).not.toContain(part);
  });

  it("is that way's own button when there is one way only: WhatsApp, Messenger or the assistant", async () => {
    await setWays({ whatsapp: "01712345678" });
    let c = corner(await body("/en"));
    // the number as the owner typed it (017…), with the country code WhatsApp's links need
    expect(c).toMatch(/<a class="fab fab-wa" href="https:\/\/wa\.me\/8801712345678\?text=[^"]+" rel="noopener noreferrer" target="_blank" aria-label="Chat on WhatsApp" title="Chat on WhatsApp">/);
    expect(c).not.toContain("data-help");

    await setWays({ messenger: "https://m.me/mawahacademy" });
    c = corner(await body("/en"));
    expect(c).toContain('<a class="fab fab-ms" href="https://m.me/mawahacademy" rel="noopener noreferrer" target="_blank" aria-label="Chat on Messenger" title="Chat on Messenger">');
    expect(c).not.toContain("data-help");

    await setWays({ ai: true });
    c = corner(await body("/en"));
    expect(c).toContain('<button class="fab fab-chat" type="button" data-chat-open="true" aria-label="Ask our assistant" title="Ask our assistant">');
    expect(c).not.toContain("data-help");
  });

  it("opens a card with the ways in a fixed order — WhatsApp, Messenger, the assistant — the two chats in a new tab, in both languages", async () => {
    await setWays({ whatsapp: "01712345678", messenger: "https://www.messenger.com/t/mawahacademy", ai: true });
    const en = corner(await body("/en"));
    expect(en).toContain('<details class="help" data-help="true"><summary class="fab fab-help" aria-label="Talk to us: WhatsApp, Messenger or our assistant" title="Talk to us: WhatsApp, Messenger or our assistant">');
    // the card is named by its heading, so a screen reader says what the group of choices is
    expect(en).toContain('<div class="help-pop" role="group" aria-labelledby="help-h"><p class="help-h" id="help-h">Talk to us</p><p class="help-sub">Choose how you would like to talk to us.</p>');
    const wa = en.indexOf('<a class="help-opt help-wa" href="https://wa.me/8801712345678?text='); // the number as typed (017…), with its country code
    const ms = en.indexOf('<a class="help-opt help-ms" href="https://m.me/mawahacademy" rel="noopener noreferrer" target="_blank">');
    const ai = en.indexOf('<button class="help-opt help-ai" type="button" data-chat-open="true">');
    expect(wa).toBeGreaterThan(0);
    expect(ms).toBeGreaterThan(wa);
    expect(ai).toBeGreaterThan(ms);
    expect(en).toContain('<b>WhatsApp<span class="vh"> (opens in a new tab)</span></b><small>Chat with our team</small>');
    expect(en).toContain("<b>AI assistant</b><small>Answers right away, any time</small>");
    // no single buttons beside the card
    for (const part of ["fab-wa", "fab-ms", "fab-chat"]) expect(en, part).not.toContain(part);

    const bn = corner(await body("/"));
    expect(bn).toContain('aria-label="আমাদের সাথে কথা বলুন: হোয়াটসঅ্যাপ, মেসেঞ্জার বা সহকারী"');
    expect(bn).toContain('<b>মেসেঞ্জার<span class="vh"> (নতুন ট্যাবে খুলবে)</span></b>');
    expect(bn).toContain("<b>এআই সহকারী</b>");
  });

  it("with two ways, the card lists just those two", async () => {
    await setWays({ whatsapp: "01712345678", ai: true });
    const c = corner(await body("/en"));
    expect(c).toContain("data-help");
    expect(c).toContain("help-wa");
    expect(c).toContain("help-ai");
    expect(c).not.toContain("help-ms");
  });
});

describe("the Messenger way", () => {
  it("is the m.me address the owner gives — or the one worked out from the Facebook page; a Facebook share link gives none", () => {
    // the owner's own address wins, written either way Facebook shows it
    expect(messengerUrl("https://m.me/mawahacademy")).toBe("https://m.me/mawahacademy");
    expect(messengerUrl("https://www.messenger.com/t/mawahacademy")).toBe("https://m.me/mawahacademy");
    expect(messengerUrl("  https://m.me/mawah.academy?ref=site  ")).toBe("https://m.me/mawah.academy");
    for (const bad of ["http://m.me/mawahacademy", "https://m.me/", "https://evil.example/m.me/x", "https://m.me.evil.example/x", "https://www.messenger.com/mawahacademy", "javascript:alert(1)", "m.me/mawahacademy", "https://m.me/a b"]) {
      expect(messengerUrl(bad), bad).toBeNull();
    }
    expect(messengerOf({ messenger: "https://m.me/mawahacademy", facebook: "https://www.facebook.com/share/1AbCdEf/" })).toBe("https://m.me/mawahacademy");
    expect(messengerOf({ messenger: "", facebook: "https://www.facebook.com/mawahacademy" })).toBe("https://m.me/mawahacademy");
    // the live site's Facebook address is a share link: there is no chat to open from it, so the owner gives the m.me address
    expect(messengerOf({ messenger: "", facebook: "https://www.facebook.com/share/1AbCdEf/" })).toBeNull();
    expect(messengerOf({ messenger: "", facebook: "" })).toBeNull();
  });

  it("is kept by Admin → Settings only when it is a Messenger address, and the student app gets it from /api/site", async () => {
    const admin = (await loginStaff("super_admin")).client;
    const base = { ...SETTING_DEFAULTS.contact, facebook: "https://www.facebook.com/share/1AbCdEf/" };
    for (const messenger of ["https://example.com/mawahacademy", "https://www.facebook.com/mawahacademy", "javascript:alert(1)"]) {
      const res = await admin.put("/api/admin/settings/contact", { ...base, messenger });
      expect(res.status, messenger).toBe(422);
      expect((await json(res)).error.fields, messenger).toMatchObject({ messenger: "invalid_messenger" });
    }
    expect((await admin.put("/api/admin/settings/contact", { ...base, messenger: "https://m.me/mawahacademy" })).status).toBe(200);
    freshState();
    const site = (await json(await new Client().get("/api/site"))).site;
    expect(site.contact.messenger).toBe("https://m.me/mawahacademy");
    // the WhatsApp number comes ready for a wa.me link: typed the local way, it gets its country code; typed with it, it stays
    for (const [typed, sent] of [["01712-345678", "8801712345678"], ["+880 1712 345678", "8801712345678"], ["", ""]]) {
      expect((await admin.put("/api/admin/settings/contact", { ...base, messenger: "https://m.me/mawahacademy", whatsapp: typed })).status, typed).toBe(200);
      freshState();
      expect((await json(await new Client().get("/api/site"))).site.contact.whatsapp, typed).toBe(sent);
    }
    // an empty box is fine: no Messenger way, unless the Facebook page gives one
    expect((await admin.put("/api/admin/settings/contact", { ...base, messenger: "" })).status).toBe(200);
    freshState();
    expect((await json(await new Client().get("/api/site"))).site.contact.messenger).toBe("");
  });
});
