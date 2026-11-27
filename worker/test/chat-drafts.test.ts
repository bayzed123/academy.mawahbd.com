import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftPending } from "../src/services/chatDrafts";
import { Client, env, firstCourse, json, loginStaff } from "./helpers";

/*
 * The chatbot learns by itself, with the owner's say-so (services/chatDrafts.ts): a question it could not answer gets an answer the AI
 * writes from the academy's own facts; the team approves it (one, or all at once) and the chatbot gives it word for word from then on.
 * A draft with a price the facts do not hold is never kept, and an approved answer whose price is no longer true is not given as it is.
 */

const KEY = "fake-test-key-not-a-secret-0123456789-abcd";
type Reply = string | ((body: any) => string) | Error;
let replies: Reply[] = [];

function mockGemini(...r: Reply[]) {
  replies = r;
  vi.restoreAllMocks(); // a fresh spy: the calls counted are this mock's own
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(typeof input === "string" ? input : input instanceof Request ? input.url : input);
    if (!url.includes("generativelanguage.googleapis.com")) throw new Error(`unexpected fetch ${url}`);
    const next = replies.length > 1 ? replies.shift()! : replies[0];
    if (next instanceof Error) return new Response(JSON.stringify({ error: { code: 500, message: "boom" } }), { status: 500, headers: { "content-type": "application/json" } });
    const text = typeof next === "function" ? next(null) : next;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
}
/** the calls that went to the AI (other fetches — the owner's e-mail — do not count) */
const aiCalls = (spy: ReturnType<typeof mockGemini>) => spy.mock.calls.filter(([input]) => String(typeof input === "string" ? input : input instanceof Request ? input.url : input).includes("generativelanguage")).length;
async function geminiOn() {
  const owner = (await loginStaff("super_admin")).client;
  expect((await owner.put("/api/admin/chatbot/providers/gemini/key", { api_key: KEY })).status).toBe(200);
  expect((await owner.post("/api/admin/chatbot/providers/gemini/activate")).status).toBe(200);
  return owner;
}
const ask = (content: string, lang: "bn" | "en" = "en") => new Client().post("/api/chat", { messages: [{ role: "user", content }], lang });
const row = (q: string) => env.DB.prepare("SELECT id, status, answer, draft, draft_state FROM chat_escalations WHERE question = ?").bind(q).first<{ id: number; status: string; answer: string | null; draft: string | null; draft_state: string | null }>();
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(async () => {
  await env.DB.prepare("UPDATE ai_provider_configs SET is_active = 0, key_enc = NULL, key_hint = NULL").run();
  await env.DB.prepare("DELETE FROM chat_escalations").run();
  await env.DB.prepare("DELETE FROM chat_knowledge").run();
});
afterEach(() => vi.restoreAllMocks());

describe("the AI drafts an answer to a question the chatbot could not answer", () => {
  it("at once, from the facts; the team approves it with one click, and the chatbot then gives it word for word", async () => {
    const owner = await geminiOn();
    const q = "draft-case: can I watch the classes on two phones?";
    mockGemini("[[ESCALATE]]", "Yes — sign in on each phone with your student ID and password.");
    const first = await json(await ask(q));
    expect(first.escalate).toBe(true);
    const drafted = await until(async () => {
      const r = await row(q);
      return r?.draft_state === "ready" ? r : null;
    });
    expect(drafted.draft).toBe("Yes — sign in on each phone with your student ID and password.");

    // the team's list shows it, and how many wait
    const list = await json(await owner.get("/api/admin/escalations?status=open"));
    expect(list.drafts_ready).toBe(1);
    expect(list.items[0]).toMatchObject({ question: q, draft_state: "ready", draft: drafted.draft });

    // one click: approved, taught, the question closed
    const approved = await owner.post(`/api/admin/escalations/${drafted.id}/approve-draft`, {});
    expect(approved.status).toBe(200);
    expect(await row(q)).toMatchObject({ status: "handled", answer: drafted.draft });
    // …and the chatbot gives it as it is, without asking the AI
    const spy = mockGemini("should not be asked");
    const again = await json(await ask(q));
    expect(again).toMatchObject({ reply: drafted.draft, taught: true });
    expect(aiCalls(spy)).toBe(0);
    // a second approval has nothing to approve
    expect((await owner.post(`/api/admin/escalations/${drafted.id}/approve-draft`, {})).status).toBe(409);
  });

  it("a draft that names a price the facts do not hold — or where the AI says the facts do not answer it — is not kept", async () => {
    await geminiOn();
    mockGemini("[[ESCALATE]]", "Yes, and you get ৳777 back as a bonus.");
    await ask("draft-case: is there a bonus?");
    expect(await until(async () => (await row("draft-case: is there a bonus?"))?.draft_state === "no_facts" && (await row("draft-case: is there a bonus?")))).toMatchObject({ draft: null });
    mockGemini("[[ESCALATE]]", "[[ESCALATE]]");
    await ask("draft-case: who is the chef's favourite singer?");
    expect(await until(async () => (await row("draft-case: who is the chef's favourite singer?"))?.draft_state === "no_facts")).toBe(true);
  });

  it("when the AI cannot be reached, the scheduled job tries again later; with no AI at all it waits for one", async () => {
    await geminiOn();
    mockGemini("[[ESCALATE]]", new Error("down"));
    await ask("draft-case: do you ship abroad?");
    const failed = await until(async () => {
      const r = await row("draft-case: do you ship abroad?");
      return r?.draft_state === "failed" ? r : null;
    });
    // not tried again at once…
    mockGemini("We teach online only; there is nothing to ship.");
    expect(await draftPending(env)).toBe(0);
    // …but after six hours
    await env.DB.prepare("UPDATE chat_escalations SET drafted_at = '2020-01-01T00:00:00Z' WHERE id = ?").bind(failed.id).run();
    expect(await draftPending(env)).toBe(1);
    expect(await row("draft-case: do you ship abroad?")).toMatchObject({ draft_state: "ready", draft: "We teach online only; there is nothing to ship." });

    // no AI set up: noted as such (a question recorded without one is drafted by the job once there is one)
    await env.DB.prepare("UPDATE ai_provider_configs SET is_active = 0, key_enc = NULL, key_hint = NULL").run();
    await env.DB.prepare("INSERT INTO chat_escalations (lang, question, reason) VALUES ('en', 'draft-case: no ai yet', 'no_provider')").run();
    expect(await draftPending(env)).toBe(1);
    expect((await row("draft-case: no ai yet"))!.draft_state).toBe("no_ai");
  });

  it("“Approve all” approves every answer waiting; only staff who answer messages may approve", async () => {
    const owner = await geminiOn();
    mockGemini("Answer one from the facts.");
    for (const q of ["draft-case: a?", "draft-case: b?"]) await env.DB.prepare("INSERT INTO chat_escalations (lang, question, reason) VALUES ('en', ?, 'low_confidence')").bind(q).run();
    expect(await draftPending(env)).toBe(2);
    expect((await (await loginStaff("viewer")).client.post("/api/admin/escalations/approve-drafts", {})).status).toBe(403);
    expect(await json(await owner.post("/api/admin/escalations/approve-drafts", {}))).toMatchObject({ approved: 2 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_knowledge").first<{ n: number }>())!.n).toBe(2);
    expect((await json(await owner.get("/api/admin/escalations"))).drafts_ready).toBe(0);
  });
});

describe("an approved answer that names a price", () => {
  it("is given word for word while the price is true; once the price changed it is not — the chatbot answers from today's facts", async () => {
    const owner = await geminiOn();
    const course = await firstCourse();
    const q = "draft-case: how much is the class?";
    const priced = `It costs ৳${course.price}.`;
    expect((await owner.post("/api/admin/chatbot/knowledge", { question: q, answer: priced, lang: "any" })).status).toBe(201);
    const spy = mockGemini("From today's facts: see the class page.");
    expect(await json(await ask(q))).toMatchObject({ reply: priced, taught: true });
    expect(aiCalls(spy)).toBe(0);
    // the price changes: the old answer is not given (nor handed to the AI as a fact)
    await env.DB.prepare("UPDATE chat_knowledge SET answer = ? WHERE question = ?").bind("It costs ৳98765.", q).run();
    const after = await json(await ask(q));
    expect(after.taught).toBeUndefined();
    expect(after.reply).not.toContain("98765");
    expect(aiCalls(spy)).toBeGreaterThan(0);
  });
});
