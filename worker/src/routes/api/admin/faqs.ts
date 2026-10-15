import { z } from "zod";
import { FAQ_TOPICS } from "@mawah/shared";
import { crudRoutes, type ResourceDef } from "../../../lib/crud";
import { all, first, qs } from "../../../lib/db";
import { HttpError } from "../../../lib/http";
import { textSchema } from "../../../lib/schemas";

/**
 * Admin → FAQ: the questions visitors see on the home page, on the FAQ page and on class pages. Everything here is shown to
 * every visitor, so a question is plain text and an answer is simple Markdown (rendered by the same safe renderer as class
 * descriptions: no HTML, no scripts, only http(s)/mailto/tel/relative links).
 *
 * A question is either site-wide or belongs to one class. Each language is optional on its own — the other language is shown
 * when one is empty — but a question and an answer must exist in at least one.
 */
const faqSchema = z.object({
  scope: z.enum(["site", "course"]),
  course_id: z.number().int().positive().nullable(),
  topic: z.enum(FAQ_TOPICS),
  question_bn: textSchema(250),
  question_en: textSchema(250),
  answer_bn: textSchema(3000),
  answer_en: textSchema(3000),
  featured: z.boolean(),
  active: z.boolean(),
  sort: z.number().int().min(0).max(99999),
});

export const faqs = crudRoutes({
  name: "faqs",
  table: "faqs",
  perms: { read: "faqs:read", write: "faqs:write" },
  schema: faqSchema,
  searchCols: ["question_bn", "question_en", "answer_bn", "answer_en"],
  sortCols: ["id", "sort", "scope", "topic", "updated_at"],
  defaultSort: "sort",
  filters: { scope: "scope", topic: "topic", course_id: "course_id", active: "active" },
  softDelete: true,
  publicContent: true,
  label: (r) => String(r.question_en || r.question_bn || `#${r.id}`),
  async beforeSave(c, data, existing) {
    const get = (k: string) => (k in data ? data[k] : existing?.[k]);

    const scope = get("scope");
    if (scope === "course") {
      const courseId = get("course_id");
      if (!courseId) throw new HttpError(422, "validation", "validation", { course_id: "required" });
      if ("course_id" in data || "scope" in data) {
        const ok = await first(c.env.DB, "SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL", courseId as number);
        if (!ok) throw new HttpError(422, "validation", "validation", { course_id: "invalid_id" });
      }
      data.featured = false; // only site-wide questions can be on the home page
    } else if (get("course_id") !== null && get("course_id") !== undefined) {
      data.course_id = null; // a site-wide question belongs to no class
    }

    // a question and an answer, in at least one language each
    const has = (k: string) => !!String(get(k) ?? "").trim();
    if (!has("question_bn") && !has("question_en")) throw new HttpError(422, "validation", "validation", { question_en: "required" });
    if (!has("answer_bn") && !has("answer_en")) throw new HttpError(422, "validation", "validation", { answer_en: "required" });
    return data;
  },
  /** the list shows which class a class-question belongs to */
  async decorate(c, rows) {
    const ids = [...new Set(rows.map((r) => r.course_id).filter((x): x is number => typeof x === "number"))];
    if (!ids.length) return rows;
    const titles = await all<{ id: number; title_bn: string; title_en: string }>(c.env.DB, `SELECT id, title_bn, title_en FROM courses WHERE id IN (${qs(ids.length)})`, ...ids);
    return rows.map((r) => {
      const t = titles.find((x) => x.id === r.course_id);
      return t ? { ...r, course_title_bn: t.title_bn, course_title_en: t.title_en } : r;
    });
  },
} satisfies ResourceDef<typeof faqSchema>);
