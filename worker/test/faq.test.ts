import { describe, expect, it, vi } from "vitest";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * Admin → FAQ: the questions visitors read on the home page, the FAQ page and class pages. The owner writes them; these tests
 * protect what the owner cannot see by eye: the starter questions only describe things the site really does (and every link in
 * them leads somewhere), who may edit, that a question belongs to a class or to everyone but never both, that what the owner
 * types can never become markup, that the structured data lists exactly the questions on the page, and that the chatbot reads
 * the same questions the website shows.
 */

const text = (res: Response) => res.text();
const SITE = env.SITE_URL.replace(/\/$/, "");
const owner = async () => (await loginStaff("super_admin")).client;

const base = { scope: "site", course_id: null, topic: "general", question_bn: "", question_en: "A question?", answer_bn: "", answer_en: "An answer.", featured: false, active: true, sort: 100 };
async function make(admin: Client, over: Record<string, unknown> = {}) {
  const res = await admin.post("/api/admin/faqs", { ...base, ...over });
  if (res.status !== 201) throw new Error(`create faq failed: ${res.status} ${await res.text()}`);
  return (await json(res)).item as { id: number };
}
async function clearFaqs() {
  await env.DB.prepare("DELETE FROM faqs").run();
}
const questionsOn = (html: string) => [...html.matchAll(/<details class="faq-item" id="faq-\d+"><summary>(.*?)<\/summary>/g)].map((m) => m[1]);
/** The FAQPage structured data on a page, or null. */
function faqLd(html: string): { mainEntity: { name: string; acceptedAnswer: { text: string } }[] } | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    const data = JSON.parse(m[1]);
    if (data["@type"] === "FAQPage") return data;
  }
  return null;
}

describe("the starter questions", () => {
  // These run first, before any test below empties the table.
  it("the FAQ page has them, grouped by topic, in both languages", async () => {
    const bn = await text(await new Client().get("/faq"));
    expect(questionsOn(bn)).toHaveLength(10);
    for (const topic of ["সাধারণ", "পেমেন্ট", "শেখা", "সার্টিফিকেট", "রিফান্ড"]) expect(bn).toContain(`>${topic}</h2>`);
    expect(bn).toContain("কীভাবে ক্লাসে ভর্তি হব?");
    const en = await text(await new Client().get("/en/faq"));
    expect(questionsOn(en)).toHaveLength(10);
    for (const topic of ["General", "Payment", "Learning", "Certificates", "Refunds"]) expect(en).toContain(`>${topic}</h2>`);
    expect(en).toContain("How do I join a class?");
    expect(en).toContain(`<link rel="canonical" href="${SITE}/en/faq"`);
  });

  it("every link in an answer leads to a page that exists, and an English answer stays in English", async () => {
    const rows = (await env.DB.prepare("SELECT answer_bn, answer_en FROM faqs").all<{ answer_bn: string; answer_en: string }>()).results;
    const links = new Set<string>();
    for (const r of rows) for (const m of `${r.answer_bn}\n${r.answer_en}`.matchAll(/\]\((\/[^)\s]*)\)/g)) links.add(m[1]);
    expect(links.size).toBeGreaterThan(2);
    for (const href of links) expect((await new Client().get(href)).status, href).toBe(200);
    for (const r of rows) for (const m of r.answer_en.matchAll(/\]\((\/[^)\s]*)\)/g)) expect(m[1].startsWith("/en/"), m[1]).toBe(true);
    for (const r of rows) for (const m of r.answer_bn.matchAll(/\]\((\/[^)\s]*)\)/g)) expect(m[1].startsWith("/en"), m[1]).toBe(false);
  });

  it("the home page shows only the ones marked for it, with a way to see them all and a way to reach a person", async () => {
    const html = await text(await new Client().get("/en"));
    const section = html.slice(html.indexOf('id="faq"'), html.indexOf("</section>", html.indexOf('id="faq"')));
    expect(questionsOn(section)).toHaveLength(5);
    expect(section).toContain('href="/en/faq"');
    expect(section).toContain('href="/en/contact"');
    expect(html).toContain('<a href="/en/faq">FAQ</a>'); // the footer and the menu lead to it
  });

  it("the questions make no promise the site does not keep: no money amounts, no numbers of students, no times", async () => {
    const rows = (await env.DB.prepare("SELECT question_en, answer_en FROM faqs").all<{ question_en: string; answer_en: string }>()).results;
    for (const r of rows) {
      const words = `${r.question_en} ${r.answer_en}`;
      expect(words, words).not.toMatch(/৳|\bBDT\b|\btaka\b|\d+\s*(students|learners|people|minutes|hours|days)/i);
    }
  });
});

describe("who may edit questions, and what they may enter", () => {
  it("content managers and owners can; support and viewers can look but not change; strangers cannot even look", async () => {
    const content = (await loginStaff("content_manager")).client;
    const support = (await loginStaff("support")).client;
    const viewer = (await loginStaff("viewer")).client;
    const item = await make(content, { question_en: "Made by a content manager" });
    expect((await viewer.get("/api/admin/faqs")).status).toBe(200);
    expect((await support.get("/api/admin/faqs")).status).toBe(200);
    for (const who of [viewer, support]) {
      expect((await who.post("/api/admin/faqs", { ...base })).status).toBe(403);
      expect((await who.patch(`/api/admin/faqs/${item.id}`, { active: false })).status).toBe(403);
      expect((await who.del(`/api/admin/faqs/${item.id}`)).status).toBe(403);
    }
    expect((await new Client().get("/api/admin/faqs")).status).toBe(401);
    expect((await (await owner()).patch(`/api/admin/faqs/${item.id}`, { active: false })).status).toBe(200);
  });

  it("a question needs words and an answer in at least one language; the other language falls back", async () => {
    const admin = await owner();
    const noQuestion = await admin.post("/api/admin/faqs", { ...base, question_en: "", question_bn: "" });
    expect(noQuestion.status).toBe(422);
    expect((await json(noQuestion)).error.fields).toMatchObject({ question_en: "required" });
    const noAnswer = await admin.post("/api/admin/faqs", { ...base, answer_en: "", answer_bn: "   " });
    expect(noAnswer.status).toBe(422);
    expect((await json(noAnswer)).error.fields).toMatchObject({ answer_en: "required" });
    expect((await admin.post("/api/admin/faqs", { ...base, topic: "gossip" })).status).toBe(422);
    expect((await admin.post("/api/admin/faqs", { ...base, answer_en: "x".repeat(3001) })).status).toBe(422);

    await clearFaqs();
    await make(admin, { question_bn: "", question_en: "Only in English", answer_bn: "", answer_en: "English answer only" });
    const bn = await text(await new Client().get("/faq"));
    expect(bn).toContain("Only in English"); // the Bangla page falls back instead of showing an empty question
    expect(bn).toContain("English answer only");
  });

  it("a question belongs to one class or to everyone — never both — and only to a class that exists", async () => {
    const admin = await owner();
    const course = await env.DB.prepare("SELECT id FROM courses WHERE deleted_at IS NULL ORDER BY id LIMIT 1").first<{ id: number }>();
    const needsClass = await admin.post("/api/admin/faqs", { ...base, scope: "course", course_id: null });
    expect(needsClass.status).toBe(422);
    expect((await json(needsClass)).error.fields).toMatchObject({ course_id: "required" });
    const ghost = await admin.post("/api/admin/faqs", { ...base, scope: "course", course_id: 999999 });
    expect(ghost.status).toBe(422);
    expect((await json(ghost)).error.fields).toMatchObject({ course_id: "invalid_id" });

    // a class question is never on the home page; a site-wide one lets go of any class it was tied to
    const own = await make(admin, { scope: "course", course_id: course!.id, featured: true });
    expect((await json(await admin.get(`/api/admin/faqs/${own.id}`))).item).toMatchObject({ scope: "course", course_id: course!.id, featured: 0 });
    expect((await admin.patch(`/api/admin/faqs/${own.id}`, { scope: "site", course_id: course!.id })).status).toBe(200);
    expect((await json(await admin.get(`/api/admin/faqs/${own.id}`))).item).toMatchObject({ scope: "site", course_id: null });
  });

  it("the list says which class a class question belongs to, and can be filtered by class", async () => {
    const admin = await owner();
    await clearFaqs();
    const [a, b] = (await env.DB.prepare("SELECT id, title_en FROM courses WHERE deleted_at IS NULL ORDER BY id LIMIT 2").all<{ id: number; title_en: string }>()).results;
    await make(admin, { scope: "course", course_id: a.id, question_en: "About class A" });
    await make(admin, { scope: "course", course_id: b.id, question_en: "About class B" });
    await make(admin, { question_en: "About everything" });
    const onlyA = (await json(await admin.get(`/api/admin/faqs?course_id=${a.id}`))).items;
    expect(onlyA.map((r: { question_en: string }) => r.question_en)).toEqual(["About class A"]);
    expect(onlyA[0].course_title_en).toBe(a.title_en);
    expect((await json(await admin.get("/api/admin/faqs?scope=site"))).items).toHaveLength(1);
  });

  it("the quick on/off switch changes only that, and every change is in the activity log", async () => {
    const admin = await owner();
    const q = await make(admin, { question_en: "Switch me", featured: true, topic: "payment" });
    expect((await admin.patch(`/api/admin/faqs/${q.id}`, { active: false })).status).toBe(200);
    expect((await json(await admin.get(`/api/admin/faqs/${q.id}`))).item).toMatchObject({ active: 0, question_en: "Switch me", featured: 1, topic: "payment" });
    expect((await json(await admin.get("/api/admin/activity?action=faqs.updated"))).items.length).toBeGreaterThan(0);
  });
});

describe("what visitors see", () => {
  it("only switched-on, undeleted questions, in the owner's order; hiding one removes it at once, deleting it too", async () => {
    const admin = await owner();
    await clearFaqs();
    const second = await make(admin, { question_en: "Second question", sort: 20 });
    await make(admin, { question_en: "First question", sort: 10 });
    const hidden = await make(admin, { question_en: "Hidden question", active: false });
    const gone = await make(admin, { question_en: "Deleted question" });
    await admin.del(`/api/admin/faqs/${gone.id}`);
    const html = await text(await new Client().get("/en/faq"));
    expect(questionsOn(html)).toEqual(["First question", "Second question"]);
    expect(html).not.toContain("Hidden question");
    expect(html).not.toContain("Deleted question");

    await admin.patch(`/api/admin/faqs/${hidden.id}`, { active: true });
    await admin.patch(`/api/admin/faqs/${second.id}`, { active: false });
    expect(questionsOn(await text(await new Client().get("/en/faq")))).toEqual(["First question", "Hidden question"]);
    expect((await admin.post(`/api/admin/faqs/${gone.id}/restore`, {})).status).toBe(200);
    expect(questionsOn(await text(await new Client().get("/en/faq")))).toContain("Deleted question");
  });

  it("with no questions the page says so honestly and the home page shows no FAQ section", async () => {
    await clearFaqs();
    const faq = await text(await new Client().get("/en/faq"));
    expect(questionsOn(faq)).toEqual([]);
    expect(faq).toContain("No questions have been added yet.");
    expect(faqLd(faq)).toBeNull();
    const home = await text(await new Client().get("/en"));
    expect(home).not.toContain('id="faq"');
  });

  it("the home page shows only the questions marked for it, at most six, and never a class question", async () => {
    const admin = await owner();
    await clearFaqs();
    const course = await env.DB.prepare("SELECT id FROM courses WHERE deleted_at IS NULL ORDER BY id LIMIT 1").first<{ id: number }>();
    for (let i = 1; i <= 8; i++) await make(admin, { question_en: `Home question ${i}`, featured: true, sort: i });
    await make(admin, { question_en: "Not for the home page" });
    await make(admin, { scope: "course", course_id: course!.id, question_en: "Class question" });
    const home = await text(await new Client().get("/en"));
    const shown = questionsOn(home.slice(home.indexOf('id="faq"')));
    expect(shown.slice(0, 6)).toEqual(["Home question 1", "Home question 2", "Home question 3", "Home question 4", "Home question 5", "Home question 6"]);
    expect(home).not.toContain("Home question 7");
    expect(home).not.toContain("Not for the home page");
    expect(home).not.toContain("Class question");
  });

  it("a class page shows that class's own questions first, then the home-page ones — and no other class's", async () => {
    const admin = await owner();
    await clearFaqs();
    const [a, b] = (await env.DB.prepare("SELECT id, slug FROM courses WHERE deleted_at IS NULL AND status = 'published' ORDER BY id LIMIT 2").all<{ id: number; slug: string }>()).results;
    await make(admin, { scope: "course", course_id: a.id, question_en: "Is class A good for beginners?", sort: 5 });
    await make(admin, { scope: "course", course_id: b.id, question_en: "Question only for class B" });
    await make(admin, { question_en: "A basic question", featured: true });
    await make(admin, { question_en: "Not on the home page, so not on class pages", featured: false });

    const pageA = await text(await new Client().get(`/en/courses/${a.slug}`));
    expect(questionsOn(pageA)).toEqual(["Is class A good for beginners?", "A basic question"]);
    expect(pageA).not.toContain("Question only for class B");
    expect(pageA).not.toContain("Not on the home page, so not on class pages");
    const pageB = await text(await new Client().get(`/en/courses/${b.slug}`));
    expect(questionsOn(pageB)).toEqual(["Question only for class B", "A basic question"]);

    // a class with no questions of its own still gets the basics; with none anywhere, no section at all
    await clearFaqs();
    expect(await text(await new Client().get(`/en/courses/${a.slug}`))).not.toContain('class="faq-sec"');
  });

  it("the structured data lists exactly the questions on the page, with the words the visitor reads", async () => {
    const admin = await owner();
    await clearFaqs();
    await make(admin, { question_en: "Is e-mail needed?", answer_en: "**Yes** — a free [account](/courses) is needed.\n\n- first step\n- second step" });
    await make(admin, { question_en: "Hidden one", active: false });
    const html = await text(await new Client().get("/en/faq"));
    const ld = faqLd(html)!;
    expect(ld.mainEntity.map((q) => q.name)).toEqual(questionsOn(html));
    expect(ld.mainEntity[0].acceptedAnswer.text).toBe("Yes — a free account is needed.\n\nfirst step\nsecond step");
    expect(JSON.stringify(ld)).not.toContain("Hidden one");

    const course = await env.DB.prepare("SELECT slug FROM courses WHERE deleted_at IS NULL AND status = 'published' ORDER BY id LIMIT 1").first<{ slug: string }>();
    await admin.patch("/api/admin/faqs/" + (await env.DB.prepare("SELECT id FROM faqs LIMIT 1").first<{ id: number }>())!.id, { featured: true });
    const classPage = await text(await new Client().get(`/en/courses/${course!.slug}`));
    expect(faqLd(classPage)!.mainEntity.map((q) => q.name)).toEqual(questionsOn(classPage));
  });

  it("what the owner types can never become markup: tags are shown as text, only safe links work, and links follow the language", async () => {
    const admin = await owner();
    await clearFaqs();
    await make(admin, {
      question_en: 'What about <img src=x onerror=alert(1)> and "quotes"?',
      question_bn: "বাংলা প্রশ্ন",
      answer_en: 'Try <script>alert(1)</script> or [bad](javascript:alert(1)) or [good](/courses) or [shop](https://mawahbd.com).',
      answer_bn: "ক্লাসগুলো দেখুন: [ক্লাস](/courses)",
    });
    const en = await text(await new Client().get("/en/faq"));
    expect(en).not.toContain("<script>alert(1)");
    expect(en).not.toContain("<img src=x");
    expect(en).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(en).not.toContain("javascript:");
    expect(en).toContain('<a href="/en/courses">good</a>'); // an English visitor stays in English
    expect(en).toContain('<a href="https://mawahbd.com" target="_blank" rel="noopener noreferrer nofollow">shop</a>');
    const bn = await text(await new Client().get("/faq"));
    expect(bn).toContain('<a href="/courses">ক্লাস</a>');
  });

  it("the page is real HTML that needs no script: each question is a native details element", async () => {
    const admin = await owner();
    await clearFaqs();
    await make(admin, { question_en: "Works without JavaScript?", answer_en: "Yes." });
    const html = await text(await new Client().get("/en/faq"));
    expect(html).toMatch(/<details class="faq-item" id="faq-\d+"><summary>Works without JavaScript\?<\/summary><div class="faq-a"><p>Yes\.<\/p>\n?<\/div><\/details>/);
    expect(html).toContain('<a href="/en/faq" aria-current="page">FAQ</a>');
  });

  it("the sitemap lists the FAQ page in both languages", async () => {
    const xml = await text(await new Client().get("/sitemap.xml"));
    expect(xml).toContain(`<loc>${SITE}/faq</loc>`);
    expect(xml).toContain(`<loc>${SITE}/en/faq</loc>`);
  });
});

describe("the chatbot reads the same questions", () => {
  const KEY = "fake-test-key-not-a-secret-0123456789-faq1";
  it("the owner's published questions — the class's own first — reach the facts the model is given; hidden ones do not", async () => {
    const admin = await owner();
    await clearFaqs();
    const course = await env.DB.prepare("SELECT id FROM courses WHERE deleted_at IS NULL AND status = 'published' ORDER BY id LIMIT 1").first<{ id: number }>();
    await make(admin, { question_en: "Can I pay in instalments?", answer_en: "Not at the moment — the price is paid once at checkout." });
    await make(admin, { scope: "course", course_id: course!.id, question_en: "Do I need an oven for this class?", answer_en: "Yes, a home oven is enough." });
    await make(admin, { question_en: "A hidden question", answer_en: "Hidden answer.", active: false });
    await admin.put("/api/admin/chatbot/providers/gemini/key", { api_key: KEY });
    expect((await admin.post("/api/admin/chatbot/providers/gemini/activate")).status).toBe(200);

    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(typeof input === "string" ? input : input instanceof Request ? input.url : input);
      if (url.includes("generativelanguage.googleapis.com")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
      throw new Error(`unexpected fetch ${url}`);
    });
    try {
      const res = await new Client().post("/api/chat", { messages: [{ role: "user", content: "Can I pay in instalments?" }], lang: "en", course_id: course!.id });
      expect(res.status).toBe(200);
      const sent = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
      const system = sent.systemInstruction.parts[0].text as string;
      expect(system).toContain("Questions and answers published on the website:");
      expect(system).toContain("Q: Can I pay in instalments?\nA: Not at the moment — the price is paid once at checkout.");
      expect(system.indexOf("Do I need an oven")).toBeGreaterThan(-1);
      expect(system.indexOf("Do I need an oven")).toBeLessThan(system.indexOf("Can I pay in instalments?")); // the class's own first
      expect(system).not.toContain("A hidden question");
    } finally {
      spy.mockRestore();
    }
  });
});
