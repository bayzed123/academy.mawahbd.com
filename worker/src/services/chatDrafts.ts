import type { Env } from "../env";
import { AiError, type ChatMessage } from "../lib/ai-providers";
import { all, first, nowIso, run } from "../lib/db";
import { adminComplete } from "./adminAi";
import { chatFacts, ESCALATE_MARKER } from "./chatbot";
import { rankKnowledge, unsupportedFigures } from "./chatKnowledge";

/*
 * The chatbot learns by itself, with the owner's say-so (migration 0038). A question it could not answer is drafted an answer by the AI the
 * admin uses (Gemini, else the chatbot's own), from the academy's own facts only — the classes and their prices today, the FAQ, the answers
 * already approved. A draft that is not wholly in the facts (a price or a discount they do not hold) is thrown away, and so is one where the
 * AI says the facts do not answer it: the team then writes that answer. An approved draft is taught and given word for word from then on.
 */

export type DraftState = "ready" | "no_facts" | "failed" | "no_ai";

/** An answer for the team to check, written from the facts only; grounded false = the facts do not hold it (nothing is made up). */
export async function draftAnswer(env: Env, q: { question: string; lang: string; course_id: number | null }): Promise<{ answer: string; grounded: boolean }> {
  const lang = q.lang === "en" ? "en" : "bn";
  const learned = (await rankKnowledge(env, q.question, lang)).filter((k) => k.score > 0).slice(0, 8);
  const facts = await chatFacts(env, lang, q.course_id, learned);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${facts}\n\nYou are now drafting an answer for the academy's team to check before it is saved. Answer the student's question below from the facts only, in ${lang === "bn" ? "Bangla" : "English"}, in at most 5 short sentences. If the facts do not hold the answer, reply with exactly ${ESCALATE_MARKER} and nothing else.`,
    },
    { role: "user", content: q.question },
  ];
  const raw = await adminComplete(env, messages, { maxTokens: 500, temperature: 0.2 });
  const answer = raw.replaceAll(ESCALATE_MARKER, "").trim();
  const grounded = !!answer && !raw.includes(ESCALATE_MARKER) && unsupportedFigures(answer, facts).length === 0;
  return { answer: grounded ? answer : "", grounded };
}

/** Drafts the answer to one open, unanswered question and keeps it with the question. Never throws. */
export async function draftEscalation(env: Env, id: number): Promise<DraftState | null> {
  const row = await first<{ question: string; lang: string; course_id: number | null }>(
    env.DB,
    "SELECT question, lang, course_id FROM chat_escalations WHERE id = ? AND status = 'open' AND answer IS NULL",
    id,
  );
  if (!row) return null;
  let state: DraftState;
  let draft: string | null = null;
  try {
    const r = await draftAnswer(env, row);
    state = r.grounded ? "ready" : "no_facts";
    draft = r.grounded ? r.answer : null;
  } catch (err) {
    state = err instanceof AiError && err.code === "not_configured" ? "no_ai" : "failed";
    console.warn("chat_draft_failed", err instanceof AiError ? err.code : "error");
  }
  await run(env.DB, "UPDATE chat_escalations SET draft = ?, draft_state = ?, drafted_at = ? WHERE id = ?", draft, state, nowIso(), id);
  return state;
}

/**
 * The scheduled job (cron.ts): drafts the questions not tried yet, and tries again those whose AI could not be reached (or was not set up)
 * six hours ago — a few each time, so the AI's free allowance is not spent at once.
 */
export async function draftPending(env: Env, limit = 5): Promise<number> {
  const before = nowIso(new Date(Date.now() - 6 * 3600 * 1000));
  const rows = await all<{ id: number }>(
    env.DB,
    `SELECT id FROM chat_escalations
     WHERE status = 'open' AND answer IS NULL AND (draft_state IS NULL OR (draft_state IN ('failed','no_ai') AND drafted_at < ?))
     ORDER BY asked DESC, id DESC LIMIT ?`,
    before,
    limit,
  );
  for (const r of rows) await draftEscalation(env, r.id);
  return rows.length;
}
