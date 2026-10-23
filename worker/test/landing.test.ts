import { describe, expect, it } from "vitest";
import { setSetting, SETTING_DEFAULTS } from "../src/lib/settings";
import { LANDING_CSS } from "../src/generated/assets";
import { styleHash } from "../src/middleware/security";
import { Client, env, json, loginStaff, registerStudent } from "./helpers";

/*
 * Landing pages (Admin → Landing pages): pages the owner builds from blocks, at /l/<address> and /en/l/<address>. These tests protect what
 * the owner cannot see by eye: that a draft is never on the website, that every block is checked before it is stored (no script, no
 * javascript: button, no picture from anywhere, no made-up saving, no class that does not exist), that the page shows only what the owner
 * wrote or students wrote and staff approved, and who may change pages.
 */
const text = (res: Response) => res.text();
const PICTURE = `banners/${"b4".repeat(16)}.webp`;
let seq = 0;

async function owner() {
  return (await loginStaff("super_admin")).client;
}
async function makePage(admin: Client, over: Record<string, unknown> = {}) {
  const n = ++seq;
  const res = await admin.post("/api/admin/landing", { title_bn: `অফার ${n}`, title_en: `Eid offer ${n} ${Date.now().toString(36)}`, description_bn: "", description_en: "", status: "draft", ...over });
  if (res.status !== 201) throw new Error(`create page failed: ${res.status} ${await res.text()}`);
  return (await json(res)).item as { id: number; slug: string };
}
const putBlocks = (admin: Client, id: number, blocks: unknown[]) => admin.put(`/api/admin/landing/${id}/blocks`, { blocks });
const publish = (admin: Client, id: number) => admin.patch(`/api/admin/landing/${id}`, { status: "published" });

async function newClass(over: { price?: number; status?: string } = {}) {
  const slug = `lp-class-${Date.now().toString(36)}-${++seq}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, long_bn, long_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, 'অফারের ক্লাস', ?, 'ছোট', 'A short line', '', '', ?, ?, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `Offer class ${slug}`, over.price ?? 1200, over.status ?? "published")
    .run();
  return { id: res.meta.last_row_id as number, slug };
}
async function review(courseId: number, status: "approved" | "pending", body: string) {
  const { id } = await registerStudent(new Client(), { name: `Reviewer ${++seq}` });
  const enrollment = await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'admin')").bind(id, courseId).run();
  await env.DB.prepare("INSERT INTO reviews (course_id, student_id, enrollment_id, rating, body, status) VALUES (?, ?, ?, 5, ?, ?)").bind(courseId, id, enrollment.meta.last_row_id, body, status).run();
}

const hero = (over: Record<string, unknown> = {}) => ({ type: "hero", image_key: PICTURE, heading_bn: "ঈদের অফার", heading_en: "Eid offer", text_bn: "", text_en: "Three classes, one price.", button_bn: "", button_en: "Enroll now", link: "/courses", ...over });

describe("a landing page's life", () => {
  it("is made with an address from its English name, is not on the website as a draft, and once published is there in both languages", async () => {
    const admin = await owner();
    const page = await makePage(admin, { title_en: "Eid Baking Offer", title_bn: "ঈদের বেকিং অফার" });
    expect(page.slug).toBe("eid-baking-offer");
    expect((await new Client().get(`/l/${page.slug}`)).status).toBe(404);
    expect((await putBlocks(admin, page.id, [hero()])).status).toBe(200);
    expect((await new Client().get(`/l/${page.slug}`)).status).toBe(404); // still a draft
    expect((await publish(admin, page.id)).status).toBe(200);
    const bn = await text(await new Client().get(`/l/${page.slug}`));
    expect(bn).toContain("<h1>ঈদের অফার</h1>");
    expect(bn).toContain("<title>ঈদের বেকিং অফার");
    const enRes = await new Client().get(`/en/l/${page.slug}`);
    const en = await text(enRes);
    expect(en).toContain("<h1>Eid offer</h1>");
    // the landing pages' look travels only with a landing page, allowed by its own hash; every other page stays as light as before
    expect(en).toContain(`<style>${LANDING_CSS}</style>`);
    expect(enRes.headers.get("content-security-policy")).toContain(await styleHash(LANDING_CSS));
    expect(await text(await new Client().get("/en"))).not.toContain(LANDING_CSS);
    // in the list: how many blocks, not the blocks themselves
    const row = (await json(await admin.get(`/api/admin/landing/${page.id}`))).item;
    expect(row).toMatchObject({ status: "published", block_count: 1 });
    expect(row.blocks).toBeUndefined();
    expect(row.published_at).toBeTruthy();
    // the search engines' list has it; a draft is not on it
    const draft = await makePage(admin);
    const map = await text(await new Client().get("/sitemap.xml"));
    expect(map).toContain(`/l/${page.slug}`);
    expect(map).not.toContain(`/l/${draft.slug}`);
    // an address chosen by the owner, and one already taken
    const own = await makePage(admin, { slug: "winter-cakes" });
    expect(own.slug).toBe("winter-cakes");
    expect((await admin.post("/api/admin/landing", { title_bn: "", title_en: "Another", description_bn: "", description_en: "", status: "draft", slug: "winter-cakes" })).status).toBe(409);
    expect((await admin.post("/api/admin/landing", { title_bn: "", title_en: "", description_bn: "", description_en: "", status: "draft" })).status).toBe(422);
    // deleted: gone from the website
    expect((await admin.del(`/api/admin/landing/${page.id}`)).status).toBe(200);
    expect((await new Client().get(`/l/${page.slug}`)).status).toBe(404);
  });
});

describe("the blocks are checked before they are stored", () => {
  it("refuses a dangerous button, a picture from elsewhere, a video that cannot play, a made-up saving and a class that does not exist", async () => {
    const admin = await owner();
    const page = await makePage(admin);
    const fields = async (blocks: unknown[]) => {
      const res = await putBlocks(admin, page.id, blocks);
      expect(res.status).toBe(422);
      return (await json(res)).error.fields as Record<string, string>;
    };
    expect(await fields([hero({ link: "javascript:alert(1)" })])).toMatchObject({ "blocks.0.link": "invalid_url" });
    expect(await fields([hero({ link: "//evil.example/x" })])).toMatchObject({ "blocks.0.link": "invalid_url" });
    expect(await fields([hero({ image_key: "https://evil.example/x.png" })])).toMatchObject({ "blocks.0.image_key": "invalid_image" });
    expect(await fields([hero({ image_key: "private/abc.webp" })])).toMatchObject({ "blocks.0.image_key": "invalid_image" });
    expect(await fields([hero({ link: "" })])).toMatchObject({ "blocks.0.link": "required" }); // button words, nowhere to go
    expect(await fields([{ type: "video", heading_bn: "", heading_en: "", url: "https://example.com/video.mp4" }])).toMatchObject({ "blocks.0.url": "video_unsupported" });
    // Facebook's player is let into the apps only, never a public page: a Facebook video would not play here
    expect(await fields([{ type: "video", heading_bn: "", heading_en: "", url: "https://www.facebook.com/mawahbd/videos/1234567890123456" }])).toMatchObject({ "blocks.0.url": "video_unsupported" });
    expect(await fields([{ type: "price", heading_bn: "", heading_en: "Offer", price: 1500, list_price: 1200, note_bn: "", note_en: "", button_bn: "", button_en: "", link: "" }])).toMatchObject({
      "blocks.0.list_price": "list_below_price",
    });
    expect(await fields([{ type: "class", course_id: 999999, list_price: 0, button_bn: "", button_en: "" }])).toMatchObject({ "blocks.0.course_id": "not_found" });
    const cls = await newClass({ price: 1200 });
    expect(await fields([{ type: "class", course_id: cls.id, list_price: 1000, button_bn: "", button_en: "" }])).toMatchObject({ "blocks.0.list_price": "list_below_price" });
    expect(await fields([{ type: "text", heading_bn: "", heading_en: "", body_bn: "", body_en: "" }])).toMatchObject({ "blocks.0.body_en": "required" });
    expect(await fields([{ type: "faq", heading_bn: "", heading_en: "", items: [{ question_bn: "", question_en: "Why?", answer_bn: "", answer_en: "" }] }])).toMatchObject({ "blocks.0.items.0": "required" });
    // a kind of block that does not exist, and too many blocks
    expect((await putBlocks(admin, page.id, [{ type: "script", body: "<script>" }])).status).toBe(422);
    expect((await putBlocks(admin, page.id, Array.from({ length: 31 }, () => hero()))).status).toBe(422);
    // nothing of that was stored
    expect((await json(await admin.get(`/api/admin/landing/${page.id}/blocks`))).blocks).toEqual([]);
    // a good list is stored as given and read back in the same order
    const good = [hero(), { type: "text", heading_bn: "", heading_en: "Why us", body_bn: "", body_en: "We **bake**." }];
    expect((await putBlocks(admin, page.id, good)).status).toBe(200);
    expect((await json(await admin.get(`/api/admin/landing/${page.id}/blocks`))).blocks.map((b: { type: string }) => b.type)).toEqual(["hero", "text"]);
  });

  it("only staff who may edit content change pages; anyone on the team may look", async () => {
    const admin = await owner();
    const page = await makePage(admin);
    for (const role of ["support", "viewer"] as const) {
      const c = (await loginStaff(role)).client;
      expect((await c.get("/api/admin/landing")).status).toBe(200);
      expect((await c.get(`/api/admin/landing/${page.id}/blocks`)).status).toBe(200);
      expect((await putBlocks(c, page.id, [hero()])).status).toBe(403);
      expect((await c.patch(`/api/admin/landing/${page.id}`, { status: "published" })).status).toBe(403);
    }
    const cm = (await loginStaff("content_manager")).client;
    expect((await putBlocks(cm, page.id, [hero()])).status).toBe(200);
    expect((await new Client().put(`/api/admin/landing/${page.id}/blocks`, { blocks: [] })).status).toBe(401);
  });
});

describe("the page shows each block", () => {
  it("words, pictures, a video, a class with its Enroll button and saving, a price, questions and answers, reviews and WhatsApp — only what is real", async () => {
    const admin = await owner();
    const cls = await newClass({ price: 1200 });
    const hidden = await newClass({ status: "draft" });
    await review(cls.id, "approved", "The cakes came out perfect.");
    await review(cls.id, "pending", "Not checked yet.");
    const page = await makePage(admin);
    const blocks = [
      hero(),
      { type: "text", heading_bn: "", heading_en: "What you learn", body_bn: "শুধু বাংলা", body_en: "Real **butter** <script>alert(1)</script>" },
      { type: "pictures", heading_bn: "", heading_en: "From the class", items: [{ image_key: PICTURE, caption_bn: "", caption_en: "Sponge cake" }] },
      { type: "video", heading_bn: "", heading_en: "Watch", url: "https://youtu.be/dQw4w9WgXcQ" },
      { type: "class", course_id: cls.id, list_price: 1500, button_bn: "", button_en: "Join today" },
      { type: "class", course_id: hidden.id, list_price: 0, button_bn: "", button_en: "" },
      { type: "price", heading_bn: "", heading_en: "Bundle price", price: 2000, list_price: 2500, note_bn: "", note_en: "Until Friday", button_bn: "", button_en: "Message us", link: "https://wa.me/8801700000000" },
      { type: "faq", heading_bn: "", heading_en: "", items: [{ question_bn: "", question_en: "Is it online?", answer_bn: "", answer_en: "Yes, **live**." }] },
      { type: "reviews", heading_bn: "", heading_en: "", course_id: cls.id, count: 6 },
      { type: "whatsapp", heading_bn: "", heading_en: "Questions?", button_bn: "", button_en: "Ask on WhatsApp", message_bn: "", message_en: "Hi, about the Eid offer" },
    ];
    expect((await putBlocks(admin, page.id, blocks)).status).toBe(200);
    expect((await publish(admin, page.id)).status).toBe(200);
    await setSetting(env, "contact", { ...SETTING_DEFAULTS.contact, whatsapp: "" }, null);
    let html = await text(await new Client().get(`/en/l/${page.slug}`));

    expect(html).toContain(`src="/media/${PICTURE}"`);
    expect(html).toContain('href="/courses"');
    expect(html).toContain("<strong>butter</strong>");
    expect(html).not.toContain("<script>alert(1)</script>"); // the owner's words are never HTML
    expect(html).toContain("Sponge cake");
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    // the class: its own picture and price, the owner's usual price struck through with the saving, Enroll straight to its checkout
    expect(html).toContain(`href="/app/checkout?c=${cls.slug}"`);
    expect(html).toContain("Join today");
    expect(html).toContain("<s><span class=\"vh\">Usual price </span>৳1,500</s>");
    expect(html).toContain("−20%");
    // a class that is not on sale is left out — never a Buy button for it
    expect(html).not.toContain(`/app/checkout?c=${hidden.slug}`);
    expect(html).toContain("৳2,000");
    expect(html).toContain("Until Friday");
    expect(html).toContain('target="_blank"'); // another site opens in a new tab
    expect(html).toContain("Is it online?");
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain("The cakes came out perfect.");
    expect(html).not.toContain("Not checked yet.");
    // no WhatsApp number in Settings → Contact: nothing to press
    expect(html).not.toContain("Ask on WhatsApp");

    await setSetting(env, "contact", { ...SETTING_DEFAULTS.contact, whatsapp: "01711111111" }, null);
    await admin.put(`/api/admin/landing/${page.id}/blocks`, { blocks }); // a change to the page shows at once
    html = await text(await new Client().get(`/en/l/${page.slug}`));
    expect(html).toContain(`href="https://wa.me/8801711111111?text=${encodeURIComponent("Hi, about the Eid offer")}"`);
    // the Bangla page: the Bangla words, and the English ones where the owner wrote only English (the heading)
    const bn = await text(await new Client().get(`/l/${page.slug}`));
    expect(bn).toContain("শুধু বাংলা");
    expect(bn).toContain("What you learn");
    expect(bn).toContain("−২০%");
    await setSetting(env, "contact", SETTING_DEFAULTS.contact, null);
  });

  it("a reviews block with no approved review yet is left out rather than filled with anything made up", async () => {
    const admin = await owner();
    const cls = await newClass();
    const page = await makePage(admin);
    await putBlocks(admin, page.id, [hero(), { type: "reviews", heading_bn: "", heading_en: "Loved by students", course_id: cls.id, count: 3 }]);
    await publish(admin, page.id);
    const html = await text(await new Client().get(`/en/l/${page.slug}`));
    expect(html).not.toContain("Loved by students");
  });
});
