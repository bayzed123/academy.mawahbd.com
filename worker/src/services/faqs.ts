import { FAQ_TOPICS, type FaqTopic } from "@mawah/shared";
import type { Env } from "../env";
import { all } from "../lib/db";

/** What the public pages need to draw a question (the admin sees the whole row). */
export interface FaqDTO {
  id: number;
  scope: "site" | "course";
  course_id: number | null;
  topic: FaqTopic;
  question_bn: string;
  question_en: string;
  answer_bn: string;
  answer_en: string;
  featured: number;
}

const COLS = "id, scope, course_id, topic, question_bn, question_en, answer_bn, answer_en, featured";

/** Site-wide questions that are switched on and not deleted, in the owner's order. `featuredOnly` = the ones for the home page. */
export function siteFaqs(env: Env, opts: { featuredOnly?: boolean; limit?: number } = {}): Promise<FaqDTO[]> {
  return all<FaqDTO>(
    env.DB,
    `SELECT ${COLS} FROM faqs WHERE scope = 'site' AND active = 1 AND deleted_at IS NULL ${opts.featuredOnly ? "AND featured = 1" : ""} ORDER BY sort, id LIMIT ?`,
    opts.limit ?? 100,
  );
}

/** The questions the owner wrote for one class. */
export function courseFaqs(env: Env, courseId: number, limit = 30): Promise<FaqDTO[]> {
  return all<FaqDTO>(env.DB, `SELECT ${COLS} FROM faqs WHERE scope = 'course' AND course_id = ? AND active = 1 AND deleted_at IS NULL ORDER BY sort, id LIMIT ?`, courseId, limit);
}

/** A class page shows the class's own questions first, then tops up with the home-page ones so a buyer always finds the basics. */
export const CLASS_FAQ_MAX = 8;
export async function faqsForClass(env: Env, courseId: number): Promise<FaqDTO[]> {
  const own = await courseFaqs(env, courseId, CLASS_FAQ_MAX);
  if (own.length >= CLASS_FAQ_MAX) return own;
  return [...own, ...(await siteFaqs(env, { featuredOnly: true, limit: CLASS_FAQ_MAX - own.length }))];
}

/** Site-wide questions grouped by topic, in the order topics are listed (empty topics left out). */
export function groupByTopic(items: FaqDTO[]): { topic: FaqTopic; items: FaqDTO[] }[] {
  return FAQ_TOPICS.map((topic) => ({ topic, items: items.filter((i) => i.topic === topic) })).filter((g) => g.items.length > 0);
}
