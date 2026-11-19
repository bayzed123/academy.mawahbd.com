import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noEmailAddress } from "@mawah/shared";
import { cleanApiKey, API_KEY_SHAPE } from "../src/lib/ai-providers";
import { extractText, workersAiInput } from "../src/lib/ai-providers/workers-ai";
import { normalizeQuestion, unsupportedFigures } from "../src/services/chatKnowledge";
import { Client, env, json, loginStaff, registerStudent, uniqueEmail } from "./helpers";

/*
 * The AI fixes and the chatbot that learns:
 *  - a pasted Gemini key is saved however it was copied; a thinking Workers AI model (Gemma 4) no longer answers empty
 *  - a question the chatbot could not answer is kept once (counted when asked again), opened by the team, answered and taught; the
 *    chatbot then gives that answer itself, word for word, without asking the AI
 *  - the chatbot never sends a price or a discount its facts do not hold
 *  - the team's private assistant and the class draft, staff only, each seeing only what their role may
 *  - the marketing list holds the students' e-mails as well as the newsletter's
 */
const KEY = "fake-test-key-not-a-secret-0123456789-abcd";
type Reply = string | ((body: any) => string);
let replies: Reply[] = [];
let sent: any[] = [];

function mockGemini(...r: Reply[]) {
  replies = r;
  sent = [];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(typeof input === "string" ? input : input instanceof Request ? input.url : input);
    if (!url.includes("generativelanguage.googleapis.com")) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String((init as RequestInit).body));
    sent.push(body);
    const next = replies.length > 1 ? replies.shift()! : replies[0];
    const text = typeof next === "function" ? next(body) : next;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

async function geminiOn(active = true) {
  const owner = (await loginStaff("super_admin")).client;
  expect((await owner.put("/api/admin/chatbot/providers/gemini/key", { api_key: KEY })).status).toBe(200);
  if (active) expect((await owner.post("/api/admin/chatbot/providers/gemini/activate")).status).toBe(200);
  return owner;
}
async function noAi() {
  await env.DB.prepare("UPDATE ai_provider_configs SET is_active = 0, key_enc = NULL, key_hint = NULL").run();
}
const ask = (content: string, lang: "bn" | "en" = "bn") => new Client().post("/api/chat", { messages: [{ role: "user", content }], lang });

beforeEach(async () => noAi());
afterEach(() => vi.restoreAllMocks());

describe("AI settings that used to fail", () => {
  it("a key is accepted however it was pasted — spaces, quotes, its name in front, a dot in it — and still checked for shape", async () => {
    expect(cleanApiKey('  "AIzaSyD-abc_def123456789012345678901234"  ')).toBe("AIzaSyD-abc_def123456789012345678901234");
    expect(cleanApiKey("GEMINI_API_KEY=AIzaSyD-abc_def12345678901234567890\n1234")).toBe("AIzaSyD-abc_def123456789012345678901234");
    expect(cleanApiKey("x-goog-api-key: AQ.Ab8RN6Labc-def_ghi.jkl0123456789")).toBe("AQ.Ab8RN6Labc-def_ghi.jkl0123456789");
    expect(cleanApiKey("Bearer AQ.Ab8RN6Labc-def_ghi.jkl0123456789")).toBe("AQ.Ab8RN6Labc-def_ghi.jkl0123456789");
    expect(API_KEY_SHAPE.test("AQ.Ab8RN6Labc-def_ghi.jkl0123456789")).toBe(true);
    expect(API_KEY_SHAPE.test("short")).toBe(false);
    expect(API_KEY_SHAPE.test("has<script>tags-and-is-long-enough")).toBe(false);

    const owner = (await loginStaff("super_admin")).client;
    const dotted = await owner.put("/api/admin/chatbot/providers/gemini/key", { api_key: "  'AQ.Ab8RN6Labc-def_ghi.jkl0123456789wxyz'\n" });
    expect(dotted.status).toBe(200);
    expect((await json(dotted)).provider).toMatchObject({ configured: true, key_hint: "••••wxyz" });
    const bad = await owner.put("/api/admin/chatbot/providers/gemini/key", { api_key: "not a key" });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields).toEqual({ api_key: "invalid_key" });
    // a wrong number in a setting says which and why, not only "check the fields"
    const tokens = await owner.put("/api/admin/chatbot/providers/gemini", { max_tokens: 0 });
    expect((await json(tokens)).error.fields).toEqual({ max_tokens: "tokens_range" });
  });

  it("a thinking Workers AI model is asked not to think, with room to spare; an empty answer is read as empty, not as a crash", () => {
    const gemma = workersAiInput("@cf/google/gemma-4-26b-a4b-it", [], 300, 0.5);
    expect(gemma).toMatchObject({ max_tokens: 700, chat_template_kwargs: { enable_thinking: false } });
    const llama = workersAiInput("@cf/meta/llama-3.1-8b-instruct", [], 300, 0.5);
    expect(llama).toEqual({ messages: [], max_tokens: 300, temperature: 0.5 });
    expect(extractText({ choices: [{ message: { content: "ready" } }] })).toBe("ready");
    expect(extractText({ choices: [{ message: { content: null, reasoning_content: "thinking…" } }] })).toBe("");
  });
});

describe("the chatbot never sends a price it cannot back up", () => {
  it("knows a figure from the facts, in Bangla or Latin digits, and flags one that is not there", () => {
    const facts = "Biryani class — ৳৩৫০ — open. Cake class — ৳1,200.";
    expect(unsupportedFigures("দাম ৩৫০ টাকা", facts)).toEqual([]);
    expect(unsupportedFigures("It costs ৳1,200 only", facts)).toEqual([]);
    expect(unsupportedFigures("এখন ৳২৫০ টাকায় পাবেন", facts)).toEqual(["250"]);
    expect(unsupportedFigures("Get 30% off today", facts)).toEqual(["30"]);
    expect(unsupportedFigures("Lesson 3 shows the dough", facts)).toEqual([]); // not money
  });

  it("a reply with an invented price is held back and the question goes to the team", async () => {
    await geminiOn();
    mockGemini("এই ক্লাস এখন মাত্র ৳৯৯ টাকায়!");
    const res = await json(await ask("অফার আছে কি invented-price-case?"));
    expect(res.escalate).toBe(true);
    expect(res.reply).not.toContain("৯৯");
    expect((await env.DB.prepare("SELECT reason FROM chat_escalations WHERE question LIKE '%invented-price-case%'").first<any>()).reason).toBe("unverified_fact");
  });

  it("the prompt carries the website's pages and how-to guide, so the chatbot sends people to the right page", async () => {
    await geminiOn();
    mockGemini("ঠিক আছে।");
    await ask("কীভাবে ক্লাস কিনব?");
    const system = sent[0].systemInstruction.parts[0].text as string;
    for (const page of ["/free-classes", "/how-to-order", "/guide", "/app/login", "/verify", "/policies/refund"]) expect(system).toContain(page);
    expect(system).toContain("Never work out, round or guess a price");
  });
});

describe("the chatbot learns from the team", () => {
  it("the same unanswered question is kept once and counted; the team opens it, answers and teaches; then the chatbot answers by itself", async () => {
    const q = "সার্টিফিকেট কি প্রিন্ট করা যায় learn-case-1?";
    expect((await json(await ask(q))).escalate).toBe(true); // no AI at all: handed to the team
    expect((await json(await ask(q))).escalate).toBe(true);
    const rows = (await env.DB.prepare("SELECT id, asked FROM chat_escalations WHERE question = ?").bind(q).all<any>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].asked).toBe(2);

    const support = (await loginStaff("support")).client;
    const list = await json(await support.get("/api/admin/escalations?status=open"));
    expect(list.items.find((e: any) => e.id === rows[0].id)).toMatchObject({ asked: 2, answered: 0 });
    const opened = await json(await support.get(`/api/admin/escalations/${rows[0].id}`));
    expect(opened.item).toMatchObject({ question: q, asked: 2, status: "open", taught: null });

    const answer = "হ্যাঁ, সার্টিফিকেটের PDF ডাউনলোড করে প্রিন্ট করতে পারবেন: /app/certificates";
    const saved = await support.post(`/api/admin/escalations/${rows[0].id}/answer`, { answer, teach: true });
    expect(saved.status).toBe(200);
    expect((await json(saved)).item).toMatchObject({ status: "handled", answer, taught: { answer, active: 1 } });

    // asked again — even in other punctuation and case — the taught answer comes back word for word, with no AI involved
    const spy = mockGemini("should not be asked");
    const again = await json(await ask("সার্টিফিকেট কি প্রিন্ট করা যায় LEARN-CASE-1"));
    expect(again).toMatchObject({ reply: answer, escalate: false, taught: true });
    expect(spy).not.toHaveBeenCalled();
    expect((await env.DB.prepare("SELECT used FROM chat_knowledge WHERE escalation_id = ?").bind(rows[0].id).first<any>()).used).toBe(1);
  });

  it("a related question is answered from the taught answers given to the AI as approved facts", async () => {
    const owner = await geminiOn();
    await owner.post("/api/admin/chatbot/knowledge", { question: "Do you have offline classes in Chattogram?", answer: "Offline classes run at the MAWAH kitchen in Chandgaon, Chattogram — call the hotline to book.", lang: "en" });
    mockGemini("Yes — at the MAWAH kitchen in Chandgaon. Call the hotline to book.");
    const res = await json(await ask("are there any offline cooking classes near chattogram for kids", "en"));
    expect(res.escalate).toBe(false);
    const system = sent[0].systemInstruction.parts[0].text as string;
    expect(system).toContain("Answers the team has approved");
    expect(system).toContain("MAWAH kitchen in Chandgaon");
  });

  it("an answer can be added, changed, switched off and deleted by the team; a viewer can only read", async () => {
    const support = (await loginStaff("support")).client;
    const viewer = (await loginStaff("viewer")).client;
    expect((await viewer.post("/api/admin/chatbot/knowledge", { question: "q?", answer: "a." })).status).toBe(403);
    expect((await support.post("/api/admin/chatbot/knowledge", { question: "", answer: "" })).status).toBe(422);
    const made = await json(await support.post("/api/admin/chatbot/knowledge", { question: "Is there a class for kids crud-case?", answer: "Yes, the kids' baking class.", lang: "any" }));
    const id = made.item.id;
    expect((await support.put(`/api/admin/chatbot/knowledge/${id}`, { active: false })).status).toBe(200);
    const off = await json(await ask("Is there a class for kids crud-case?", "en"));
    expect(off.taught).toBeUndefined(); // switched off: not used
    expect((await json(await viewer.get("/api/admin/chatbot/knowledge?q=crud-case"))).items).toHaveLength(1);
    expect((await support.del(`/api/admin/chatbot/knowledge/${id}`)).status).toBe(200);
    expect((await json(await viewer.get("/api/admin/chatbot/knowledge?q=crud-case"))).items).toHaveLength(0);
  });

  it("the suggested answer is written from the facts only — it says so instead of guessing", async () => {
    await geminiOn(false);
    const support = (await loginStaff("support")).client;
    await env.DB.prepare("INSERT INTO chat_escalations (lang, question, reason) VALUES ('en', 'suggest-case: is there a refund?', 'low_confidence')").run();
    const id = (await env.DB.prepare("SELECT id FROM chat_escalations WHERE question LIKE 'suggest-case%'").first<any>()).id;

    mockGemini("Yes — within 7 days of buying, as the refund policy says: /policies/refund");
    expect(await json(await support.post(`/api/admin/escalations/${id}/suggest`))).toMatchObject({ grounded: true, answer: expect.stringContaining("7 days") });
    mockGemini("[[ESCALATE]]");
    expect(await json(await support.post(`/api/admin/escalations/${id}/suggest`))).toMatchObject({ grounded: false, answer: "" });
    mockGemini("Yes, and you get ৳777 back as a bonus.");
    expect(await json(await support.post(`/api/admin/escalations/${id}/suggest`))).toMatchObject({ grounded: false });
  });
});

describe("the team's private AI", () => {
  it("the assistant answers staff only, from today's facts limited to what each role may see; without AI it says how to set it up", async () => {
    const support = (await loginStaff("support")).client;
    expect((await new Client().post("/api/admin/assistant", { messages: [{ role: "user", content: "hi" }] })).status).toBe(401);
    expect(await json(await support.get("/api/admin/assistant"))).toMatchObject({ ready: false });
    const none = await support.post("/api/admin/assistant", { messages: [{ role: "user", content: "hi" }] });
    expect(none.status).toBe(409);
    expect((await json(none)).error.code).toBe("ai_not_configured");

    await geminiOn(false); // a saved Gemini key is enough, even while the chatbot uses another AI
    expect(await json(await support.get("/api/admin/assistant"))).toMatchObject({ ready: true, provider: "Google Gemini" });
    mockGemini("আজ ২টি পেমেন্ট যাচাই বাকি।");
    const r = await json(await support.post("/api/admin/assistant", { messages: [{ role: "user", content: "আজ কী কাজ বাকি?" }] }));
    expect(r.reply).toContain("পেমেন্ট");
    const supportPrompt = sent[0].systemInstruction.parts[0].text as string;
    expect(supportPrompt).toContain("Orders waiting:");
    expect(supportPrompt, "support may not see revenue").not.toContain("Paid sales");
    expect(supportPrompt).toContain("Classes (");

    const viewer = (await loginStaff("viewer")).client;
    mockGemini("ok");
    await viewer.post("/api/admin/assistant", { messages: [{ role: "user", content: "sales?" }] });
    expect(sent[0].systemInstruction.parts[0].text).toContain("Paid sales today");

    expect((await support.post("/api/admin/assistant", { messages: [{ role: "assistant", content: "only me" }] })).status).toBe(422);
  });

  it("a class's words are drafted in both languages from the class itself, for staff who may edit classes; nothing is saved", async () => {
    await geminiOn(false);
    const cm = (await loginStaff("content_manager")).client;
    const support = (await loginStaff("support")).client;
    const course = await env.DB.prepare("SELECT id, title_bn, title_en, long_bn FROM courses WHERE status = 'published' ORDER BY id LIMIT 1").first<any>();
    const body = { course_id: course.id, title_bn: course.title_bn, title_en: course.title_en, price: 500, notes: "for beginners" };
    expect((await support.post("/api/admin/ai/draft/course", body)).status).toBe(403);

    mockGemini('```json\n{"short_bn":"ছোট","short_en":"Short","long_bn":"## বিস্তারিত","long_en":"## Details","seo_title_bn":"' + "শ".repeat(300) + '","seo_desc_en":"desc","other":"ignored"}\n```');
    const r = await json(await cm.post("/api/admin/ai/draft/course", body));
    expect(r.draft).toMatchObject({ short_bn: "ছোট", short_en: "Short", long_bn: "## বিস্তারিত", seo_desc_en: "desc" });
    expect(r.draft.seo_title_bn.length).toBe(120);
    expect(r.draft.other).toBeUndefined();
    expect(sent[0].generationConfig.responseMimeType).toBe("application/json");
    const prompt = JSON.stringify(sent[0]);
    expect(prompt).toContain("for beginners");
    expect(prompt).toContain("Never invent");
    expect((await env.DB.prepare("SELECT long_bn FROM courses WHERE id = ?").bind(course.id).first<any>()).long_bn).toBe(course.long_bn);

    expect((await cm.post("/api/admin/ai/draft/course", { title_bn: "", title_en: "" })).status).toBe(422);
  });
});

describe("the marketing list", () => {
  it("holds the newsletter's subscribers and every student with an e-mail, once each, with whether they agreed to offers", async () => {
    const owner = (await loginStaff("super_admin")).client;
    const both = uniqueEmail("both");
    await registerStudent(new Client(), { email: both });
    await new Client().post("/api/newsletter", { email: both, lang: "bn" });
    const studentOnly = await registerStudent();
    const subOnly = uniqueEmail("subonly");
    await new Client().post("/api/newsletter", { email: subOnly, lang: "en" });
    // a student who signed up with a phone number only has no e-mail to send to
    await env.DB.prepare("INSERT INTO students (email, name, phone, locale) VALUES (?, 'Phone Only', '01799998888', 'bn')").bind(noEmailAddress("01799998888")).run();

    const all = (await json(await owner.get("/api/admin/subscribers?per_page=100"))).items as any[];
    const of = (email: string) => all.filter((r) => r.email.toLowerCase() === email.toLowerCase());
    expect(of(both)).toHaveLength(1);
    expect(of(both)[0]).toMatchObject({ kind: "subscriber", consent: 1 });
    expect(of(studentOnly.email)[0]).toMatchObject({ kind: "student", name: "Test Student", phone: "01712345678" });
    expect(of(subOnly)[0]).toMatchObject({ kind: "subscriber" });
    expect(all.some((r) => r.email.endsWith("no-email.invalid"))).toBe(false);

    const students = (await json(await owner.get(`/api/admin/subscribers?kind=student&q=${encodeURIComponent(studentOnly.email)}`))).items;
    expect(students).toHaveLength(1);
    const csv = await (await owner.get(`/api/admin/subscribers/export.csv?q=${encodeURIComponent(studentOnly.email)}`)).text();
    expect(csv).toContain("Agreed to offers");
    expect(csv).toContain(studentOnly.email);
  });
});
