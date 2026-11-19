import type { Env, Lang } from "../env";
import { all, nowIso, run } from "../lib/db";

/**
 * What the team has taught the chatbot (Admin → Messages → Chatbot hand-offs, or Admin → AI Chatbot → Taught answers): a question and the
 * right answer, written by a person. The chatbot gives such an answer word for word when a visitor asks the same thing, and otherwise reads
 * the closest few as approved facts — so it learns from every question it could not answer, without ever making one up.
 */
export interface KnowledgeRow {
  id: number;
  question: string;
  answer: string;
  lang: "bn" | "en" | "any";
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Bangla digits as Latin ones (৩৫০ → 350), so a price written either way compares equal. */
export const latinDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

/** A question reduced to what it says: lower case, Latin digits, no punctuation or extra spaces. */
export function normalizeQuestion(s: string): string {
  return latinDigits(s.toLowerCase())
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// small words that say nothing about what is asked (Bangla and English)
const STOP = new Set(
  "a an the is are was be to of in on for and or i you we it my me your our do does did can how what when where which who why this that with please plz pls ki কি কী কেন কিভাবে কীভাবে কোথায় কখন কে আমি আমার আপনি আপনার আমরা আমাদের এই ওই সেই এটা ওটা টা টি টো হয় হবে আছে ছিল করে করতে করব করবো করুন দিন দাও না তো ও এবং আর বা জন্য থেকে নিয়ে দিয়ে একটা একটি".split(" "),
);

/** The words of a question that carry its meaning. */
export function questionWords(s: string): Set<string> {
  return new Set(
    normalizeQuestion(s)
      .split(" ")
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** How alike two questions are, 0–1: the share of meaningful words they have in common. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / Math.max(a.size, b.size);
}

/** Taught answers for a language, best match first, each with how close its question is to the one asked. */
export async function rankKnowledge(env: Env, question: string, lang: Lang): Promise<(KnowledgeRow & { score: number })[]> {
  const rows = await all<KnowledgeRow>(env.DB, "SELECT id, question, answer, lang FROM chat_knowledge WHERE active = 1 AND lang IN (?, 'any') ORDER BY updated_at DESC LIMIT 500", lang);
  const asked = questionWords(question);
  const plain = normalizeQuestion(question);
  return rows
    .map((r) => ({ ...r, score: normalizeQuestion(r.question) === plain ? 1 : similarity(asked, questionWords(r.question)) }))
    .sort((x, y) => y.score - x.score);
}

/** Close enough to give the taught answer as it is, with no AI in between: the same question, or nearly the same words. */
export const DIRECT_MATCH = 0.8;

export async function countUse(env: Env, id: number): Promise<void> {
  await run(env.DB, "UPDATE chat_knowledge SET used = used + 1 WHERE id = ?", id);
}

/** Teach the chatbot an answer (from a hand-off, or added by hand). */
export async function teach(env: Env, k: { question: string; answer: string; lang: "bn" | "en" | "any"; escalationId?: number | null; staffId: number | null }): Promise<number> {
  const now = nowIso();
  const res = await run(
    env.DB,
    "INSERT INTO chat_knowledge (question, answer, lang, escalation_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    k.question,
    k.answer,
    k.lang,
    k.escalationId ?? null,
    k.staffId,
    now,
    now,
  );
  return res.meta.last_row_id as number;
}

/**
 * Money and percentages in a reply that the facts do not contain — the one kind of mistake a visitor would act on (a wrong price, a
 * discount that does not exist). A reply that names one is not sent; the visitor is told the team will answer instead.
 */
export function unsupportedFigures(reply: string, facts: string): string[] {
  const known = new Set((latinDigits(facts).replace(/(\d),(?=\d)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(String));
  const text = latinDigits(reply).replace(/(\d),(?=\d)/g, "$1");
  const found: string[] = [];
  const money = /(?:৳|tk\.?|bdt|taka|টাকা)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:৳|\/-|tk\b|tk\.|bdt|taka|টাকা)|(\d+(?:\.\d+)?)\s*(?:%|percent|শতাংশ)/gi;
  for (const m of text.matchAll(money)) {
    const n = m[1] ?? m[2] ?? m[3];
    if (n && !known.has(n)) found.push(n);
  }
  return found;
}
