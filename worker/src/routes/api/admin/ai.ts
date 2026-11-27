import { Hono } from "hono";
import { z } from "zod";
import { shownEmail, studentCode } from "@mawah/shared";
import type { AppEnv } from "../../../env";
import { AiError, type ChatMessage } from "../../../lib/ai-providers";
import { audit } from "../../../lib/audit";
import { all, first, likeEscape, nowIso, pageInfo, pageParams, run } from "../../../lib/db";
import { HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { requirePerm } from "../../../middleware/auth";
import { adminAi, adminComplete, assistantFacts, assistantSystem, firstJson } from "../../../services/adminAi";
import { draftAnswer } from "../../../services/chatDrafts";
import { rankKnowledge, teach, unsupportedFigures } from "../../../services/chatKnowledge";

/**
 * The team's AI tools: open a question the chatbot could not answer, answer it and teach the chatbot (with an AI-suggested answer to
 * start from), keep the taught answers, the private assistant, and drafts of a class's words. Staff only; nothing here reaches a
 * student unless a person saves it.
 */
export const aiAdmin = new Hono<AppEnv>();

const LANG = z.enum(["bn", "en", "any"]);
const aiFailed = (err: unknown): never => {
  if (err instanceof AiError && err.code === "not_configured") throw new HttpError(409, "ai_not_configured");
  throw new HttpError(502, "ai_failed", "ai_failed", { detail: err instanceof AiError ? err.code : "error" });
};

/* ------------------------------------------------------------------------- a question the chatbot could not answer */
interface EscalationRow {
  id: number;
  question: string;
  reason: string;
  lang: "bn" | "en";
  status: string;
  created_at: string;
  asked: number;
  last_asked_at: string | null;
  answer: string | null;
  answered_at: string | null;
  /** the AI's answer waiting for approval (services/chatDrafts.ts), and how drafting went */
  draft: string | null;
  draft_state: string | null;
  course_id: number | null;
  course_title_en: string | null;
  course_title_bn: string | null;
  course_slug: string | null;
  student_id: number | null;
  student_name: string | null;
  student_email: string | null;
  student_phone: string | null;
}

async function escalation(env: AppEnv["Bindings"], id: number) {
  const r = await first<EscalationRow>(
    env.DB,
    `SELECT e.id, e.question, e.reason, e.lang, e.status, e.created_at, e.asked, e.last_asked_at, e.answer, e.answered_at, e.draft, e.draft_state, e.course_id,
            c.title_en AS course_title_en, c.title_bn AS course_title_bn, c.slug AS course_slug,
            e.student_id, s.name AS student_name, s.email AS student_email, s.phone AS student_phone
       FROM chat_escalations e LEFT JOIN courses c ON c.id = e.course_id LEFT JOIN students s ON s.id = e.student_id WHERE e.id = ?`,
    id,
  );
  if (!r) throw notFound();
  const taught = await first<{ id: number; question: string; answer: string; lang: string; active: number }>(
    env.DB,
    "SELECT id, question, answer, lang, active FROM chat_knowledge WHERE escalation_id = ? ORDER BY id DESC LIMIT 1",
    id,
  );
  return {
    ...r,
    student: r.student_id ? { id: r.student_id, code: studentCode(r.student_id), name: r.student_name, email: shownEmail(r.student_email) || null, phone: r.student_phone || null } : null,
    taught: taught ?? null,
  };
}

aiAdmin.get("/escalations/:id", requirePerm("messages:read"), async (c) => ok(c, { item: await escalation(c.env, intParam(c, "id")) }));

/** Keeps the team's answer with the question, closes it, and (teach) teaches it to the chatbot. */
async function answerEscalation(env: AppEnv["Bindings"], id: number, staffId: number, a: { answer: string; question?: string; lang?: "bn" | "en" | "any"; teach: boolean }) {
  const row = await escalation(env, id);
  await run(env.DB, "UPDATE chat_escalations SET answer = ?, answered_at = ?, answered_by = ?, status = 'handled' WHERE id = ?", a.answer, nowIso(), staffId, id);
  if (!a.teach) return null;
  const question = a.question ?? row.question;
  const lang = a.lang ?? row.lang;
  if (row.taught) {
    await run(env.DB, "UPDATE chat_knowledge SET question = ?, answer = ?, lang = ?, active = 1, updated_at = ? WHERE id = ?", question, a.answer, lang, nowIso(), row.taught.id);
    return row.taught.id;
  }
  return teach(env, { question, answer: a.answer, lang, escalationId: id, staffId });
}

/** The team's answer: kept with the question, the question closed, and — unless the team says not to — taught to the chatbot. */
aiAdmin.post("/escalations/:id/answer", requirePerm("messages:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(
    c,
    z.object({
      answer: z.string().trim().min(2, "required").max(2000, "too_long"),
      // the question as it should be remembered (the team may tidy the wording)
      question: z.string().trim().min(2, "required").max(500, "too_long").optional(),
      lang: LANG.optional(),
      teach: z.boolean().default(true),
    }),
  );
  const knowledgeId = await answerEscalation(c.env, id, c.get("staff")!.id, body);
  await audit(c, { action: body.teach ? "escalation.taught" : "escalation.answered", entity: "escalation", entityId: id });
  return ok(c, { item: await escalation(c.env, id), knowledge_id: knowledgeId });
});

/** One click: the AI's answer, as it is, approved — kept, the question closed, and taught (given word for word from then on). */
aiAdmin.post("/escalations/:id/approve-draft", requirePerm("messages:write"), async (c) => {
  const id = intParam(c, "id");
  const row = await escalation(c.env, id);
  if (row.draft_state !== "ready" || !row.draft || row.answer) throw new HttpError(409, "no_draft");
  const knowledgeId = await answerEscalation(c.env, id, c.get("staff")!.id, { answer: row.draft, teach: true });
  await audit(c, { action: "escalation.draft_approved", entity: "escalation", entityId: id });
  return ok(c, { item: await escalation(c.env, id), knowledge_id: knowledgeId });
});

/** "Approve all": every AI answer waiting for approval, approved the same way. */
aiAdmin.post("/escalations/approve-drafts", requirePerm("messages:write"), async (c) => {
  const rows = await all<{ id: number }>(c.env.DB, "SELECT id FROM chat_escalations WHERE status = 'open' AND answer IS NULL AND draft_state = 'ready' AND draft IS NOT NULL ORDER BY id LIMIT 200");
  const staffId = c.get("staff")!.id;
  for (const r of rows) {
    const row = await escalation(c.env, r.id);
    if (row.draft) await answerEscalation(c.env, r.id, staffId, { answer: row.draft, teach: true });
  }
  await audit(c, { action: "escalation.drafts_approved", entity: "escalation", entityId: "", meta: { n: rows.length } });
  return ok(c, { approved: rows.length });
});

/**
 * A suggested answer for the team to check, written only from the academy's own facts and taught answers. When the facts do not hold the
 * answer it says so (grounded: false) instead of making one up — then the team writes it.
 */
aiAdmin.post("/escalations/:id/suggest", requirePerm("messages:write"), async (c) => {
  const row = await escalation(c.env, intParam(c, "id"));
  try {
    return ok(c, await draftAnswer(c.env, row));
  } catch (err) {
    return aiFailed(err);
  }
});

/* ------------------------------------------------------------------------------------------ taught answers */
aiAdmin.get("/chatbot/knowledge", requirePerm("messages:read"), async (c) => {
  const q = c.req.query();
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    where.push("(question LIKE ? ESCAPE '\\' OR answer LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  if (q.active === "1" || q.active === "0") {
    where.push("active = ?");
    params.push(Number(q.active));
  }
  const { page, per_page, offset } = pageParams(q);
  const [items, total] = await Promise.all([
    all(c.env.DB, `SELECT id, question, answer, lang, active, used, escalation_id, created_at, updated_at FROM chat_knowledge WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, ...params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM chat_knowledge WHERE ${where.join(" AND ")}`, ...params),
  ]);
  return ok(c, { items, page: pageInfo(page, per_page, total?.n ?? 0) });
});

const knowledgeSchema = z.object({
  question: z.string().trim().min(2, "required").max(500, "too_long"),
  answer: z.string().trim().min(2, "required").max(2000, "too_long"),
  lang: LANG.default("any"),
  active: z.boolean().default(true),
});

aiAdmin.post("/chatbot/knowledge", requirePerm("messages:write"), async (c) => {
  const body = await parseBody(c, knowledgeSchema);
  const id = await teach(c.env, { question: body.question, answer: body.answer, lang: body.lang, staffId: c.get("staff")!.id });
  if (!body.active) await run(c.env.DB, "UPDATE chat_knowledge SET active = 0 WHERE id = ?", id);
  await audit(c, { action: "chatbot.knowledge_added", entity: "chat_knowledge", entityId: id });
  return ok(c, { item: await first(c.env.DB, "SELECT * FROM chat_knowledge WHERE id = ?", id) }, 201);
});

aiAdmin.put("/chatbot/knowledge/:id", requirePerm("messages:write"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, knowledgeSchema.partial());
  const sets: string[] = [];
  const params: (string | number)[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
  }
  if (sets.length) {
    const res = await run(c.env.DB, `UPDATE chat_knowledge SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...params, nowIso(), id);
    if ((res.meta.changes ?? 0) === 0) throw notFound();
  }
  await audit(c, { action: "chatbot.knowledge_changed", entity: "chat_knowledge", entityId: id });
  const item = await first(c.env.DB, "SELECT * FROM chat_knowledge WHERE id = ?", id);
  if (!item) throw notFound();
  return ok(c, { item });
});

aiAdmin.delete("/chatbot/knowledge/:id", requirePerm("messages:write"), async (c) => {
  const id = intParam(c, "id");
  const res = await run(c.env.DB, "DELETE FROM chat_knowledge WHERE id = ?", id);
  if ((res.meta.changes ?? 0) === 0) throw notFound();
  await audit(c, { action: "chatbot.knowledge_deleted", entity: "chat_knowledge", entityId: id });
  return ok(c);
});

/* ------------------------------------------------------------------------------------- the private assistant */
aiAdmin.get("/assistant", requirePerm("assistant:use"), async (c) => {
  const ai = await adminAi(c.env);
  return ok(c, { ready: !!ai, provider: ai?.provider.label ?? null, model: ai?.row.model ?? null });
});

aiAdmin.post("/assistant", requirePerm("assistant:use"), async (c) => {
  const body = await parseBody(
    c,
    z.object({
      messages: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(6000) }))
        .min(1)
        .max(24),
    }),
  );
  const turns = body.messages.slice(-16);
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") throw new HttpError(422, "validation", "validation", { messages: "invalid" });
  const staff = c.get("staff")!;
  const facts = await assistantFacts(c.env, staff.role);
  let reply: string;
  try {
    reply = await adminComplete(c.env, [{ role: "system", content: assistantSystem(facts, staff.name) }, ...turns], { maxTokens: 1800, temperature: 0.4 });
  } catch (err) {
    return aiFailed(err);
  }
  // only that it was used — never what was asked or answered
  await audit(c, { action: "assistant.asked", entity: "assistant" });
  return ok(c, { reply });
});

/* ------------------------------------------------------------------------------------------- class drafts */
const DRAFT_KEYS = ["short_bn", "short_en", "long_bn", "long_en", "seo_title_bn", "seo_title_en", "seo_desc_bn", "seo_desc_en"] as const;
const DRAFT_MAX: Record<(typeof DRAFT_KEYS)[number], number> = { short_bn: 400, short_en: 400, long_bn: 6000, long_en: 6000, seo_title_bn: 120, seo_title_en: 120, seo_desc_bn: 320, seo_desc_en: 320 };

/**
 * A first draft of a class's words in both languages — the short line, the full description (Markdown) and the search title and
 * description — from what the class really has: its title, price, level and lesson names, plus the owner's own notes. It fills the form
 * only; nothing is saved until the owner reads it and presses Save.
 */
aiAdmin.post("/ai/draft/course", requirePerm("courses:write"), async (c) => {
  const body = await parseBody(
    c,
    z.object({
      course_id: z.number().int().positive().optional(),
      title_bn: z.string().trim().max(200).default(""),
      title_en: z.string().trim().max(200).default(""),
      price: z.number().int().min(0).max(10_000_000).optional(),
      level: z.string().trim().max(40).nullish(),
      notes: z.string().trim().max(3000).default(""),
    }),
  );
  if (!body.title_bn && !body.title_en) throw new HttpError(422, "validation", "validation", { title_bn: "required" });
  const lessons = body.course_id
    ? await all<{ title_bn: string; title_en: string }>(c.env.DB, "SELECT l.title_bn, l.title_en FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.course_id = ? ORDER BY m.sort, m.id, l.sort, l.id LIMIT 60", body.course_id)
    : [];
  const cert = body.course_id ? await first<{ cert_enabled: number }>(c.env.DB, "SELECT cert_enabled FROM courses WHERE id = ?", body.course_id) : null;
  const facts = [
    `Title (Bangla): ${body.title_bn || "—"}`,
    `Title (English): ${body.title_en || "—"}`,
    body.price !== undefined ? `Price: ${body.price > 0 ? `৳${body.price}` : "free"}` : "",
    body.level ? `Level: ${body.level}` : "",
    lessons.length ? `Lessons (${lessons.length}): ${lessons.map((l) => l.title_bn || l.title_en).join("; ")}` : "Lessons: not added yet",
    cert ? `Certificate on completion: ${cert.cert_enabled ? "yes" : "no"}` : "",
    body.notes ? `Owner's notes: ${body.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You write the words for a class page of MAWAH Academy, an online cooking and baking academy in Bangladesh. Warm, clear, honest; natural Bangla (not a word-for-word translation) and plain English.",
        "Use ONLY the facts given. Never invent a duration, a number of lessons other than the one given, dates, results, earnings, discounts, testimonials, or a certificate when it is not said.",
        "Return ONE JSON object with exactly these string keys:",
        "short_bn, short_en: one or two sentences (at most 250 characters) saying what the student will learn.",
        "long_bn, long_en: the full description in Markdown (at most 2000 characters): what the class is, what you will learn (a short list built from the lessons), who it is for, how it works online (video lessons, learn at your own pace on the phone).",
        "seo_title_bn, seo_title_en: at most 60 characters. seo_desc_bn, seo_desc_en: at most 155 characters.",
      ].join("\n"),
    },
    { role: "user", content: facts },
  ];
  let raw: string;
  try {
    raw = await adminComplete(c.env, messages, { maxTokens: 3000, temperature: 0.6, json: true });
  } catch (err) {
    return aiFailed(err);
  }
  const parsed = firstJson<Record<string, unknown>>(raw);
  if (!parsed) throw new HttpError(502, "ai_failed", "ai_failed", { detail: "bad_json" });
  const draft: Record<string, string> = {};
  for (const k of DRAFT_KEYS) if (typeof parsed[k] === "string" && (parsed[k] as string).trim()) draft[k] = (parsed[k] as string).trim().slice(0, DRAFT_MAX[k]);
  await audit(c, { action: "ai.course_draft", entity: "course", entityId: body.course_id });
  return ok(c, { draft });
});
