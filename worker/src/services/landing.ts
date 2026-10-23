import { z } from "zod";
import { LANDING_MAX_BLOCKS, LANDING_MAX_FAQS, LANDING_MAX_PICTURES, videoEmbed, type CourseCardDTO, type LandingBlock } from "@mawah/shared";
import type { Env } from "../env";
import { all, first, qs } from "../lib/db";
import { textSchema } from "../lib/schemas";
import { listCourses, shortName, type PublicReview } from "./catalog";

/*
 * Landing pages: the blocks are checked here before they are stored — every word is plain text (Markdown only where it says so), every
 * picture a key the upload endpoint stored under the public banners folder, every button an address that stays safe (a page of this
 * site, https, tel: or mailto: — never javascript: or data:), every video one the page can play (YouTube or Vimeo).
 */
/**
 * The player for a video block: YouTube or Vimeo. A Facebook video is not one — the site's security policy lets Facebook's player into the
 * student app and the admin only, never a public page (middleware/security.ts).
 */
export function landingVideo(url: string): string | null {
  const v = videoEmbed(url);
  return v && v.site !== "facebook" ? v.src : null;
}

const imageKey = z.string().max(200).regex(/^banners\/[a-f0-9]{16,64}\.(png|jpe?g|webp|avif)$/, "invalid_image");

/** Where a button goes. A relative link must start with a single "/" (a "//host" would leave the site without saying so). */
const link = z
  .string()
  .trim()
  .max(500, "too_long")
  .refine((v) => v === "" || /^\/(?!\/)\S*$/.test(v) || /^https:\/\/\S+$/i.test(v) || /^tel:\+?[\d -]{6,20}$/i.test(v) || /^mailto:[^\s@]+@[^\s@]+$/i.test(v), "invalid_url");

const money = z.number().int().min(0).max(10_000_000);
const pair = (max: number) => ({ bn: textSchema(max), en: textSchema(max) });
const heading = { heading_bn: pair(120).bn, heading_en: pair(120).en };

export const blockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hero"),
    image_key: imageKey.nullable(),
    ...heading,
    text_bn: textSchema(300),
    text_en: textSchema(300),
    button_bn: textSchema(40),
    button_en: textSchema(40),
    link,
  }),
  z.object({ type: z.literal("text"), ...heading, body_bn: textSchema(8000), body_en: textSchema(8000) }),
  z.object({
    type: z.literal("pictures"),
    ...heading,
    items: z.array(z.object({ image_key: imageKey, caption_bn: textSchema(160), caption_en: textSchema(160) })).min(1, "required").max(LANDING_MAX_PICTURES, "too_many"),
  }),
  z.object({
    type: z.literal("video"),
    ...heading,
    url: z
      .string()
      .trim()
      .max(500, "too_long")
      .refine((v) => landingVideo(v) !== null, "video_unsupported"),
  }),
  z.object({ type: z.literal("class"), course_id: z.number().int().positive("required"), list_price: money, button_bn: textSchema(40), button_en: textSchema(40) }),
  z.object({
    type: z.literal("price"),
    ...heading,
    price: money.refine((v) => v > 0, "required"),
    list_price: money,
    note_bn: textSchema(300),
    note_en: textSchema(300),
    button_bn: textSchema(40),
    button_en: textSchema(40),
    link,
  }),
  z.object({
    type: z.literal("faq"),
    ...heading,
    items: z
      .array(z.object({ question_bn: textSchema(300), question_en: textSchema(300), answer_bn: textSchema(3000), answer_en: textSchema(3000) }))
      .min(1, "required")
      .max(LANDING_MAX_FAQS, "too_many"),
  }),
  z.object({ type: z.literal("reviews"), ...heading, course_id: z.number().int().min(0), count: z.number().int().min(3).max(12) }),
  z.object({
    type: z.literal("whatsapp"),
    ...heading,
    button_bn: textSchema(40),
    button_en: textSchema(40),
    message_bn: textSchema(500),
    message_en: textSchema(500),
  }),
]);

export const blocksSchema = z.array(blockSchema).max(LANDING_MAX_BLOCKS, "too_many");

/**
 * What the schema cannot see: a button's words without a place to go (or the other way round), a usual price at or below the price,
 * words that are empty in both languages, a class that does not exist. Returns the problems as "blocks.<n>.<field>" → code.
 */
export async function blockProblems(env: Env, blocks: LandingBlock[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const both = (b: Record<string, unknown>, k: string) => !!String(b[`${k}_bn`] ?? "").trim() || !!String(b[`${k}_en`] ?? "").trim();
  const ids = [...new Set(blocks.flatMap((b) => (b.type === "class" || (b.type === "reviews" && b.course_id > 0) ? [b.course_id] : [])))];
  const known = new Map(
    ids.length ? (await all<{ id: number; price: number }>(env.DB, `SELECT id, price FROM courses WHERE deleted_at IS NULL AND id IN (${qs(ids.length)})`, ...ids)).map((r) => [r.id, r.price]) : [],
  );
  blocks.forEach((b, i) => {
    const at = (k: string) => `blocks.${i}.${k}`;
    const r = b as unknown as Record<string, unknown>;
    if ((b.type === "hero" || b.type === "price") && both(r, "button") && !b.link) out[at("link")] = "required";
    if ((b.type === "hero" || b.type === "price") && b.link && !both(r, "button")) out[at("button_en")] = "required";
    if (b.type === "hero" && !b.image_key && !both(r, "heading")) out[at("heading_en")] = "required";
    if (b.type === "text" && !both(r, "body")) out[at("body_en")] = "required";
    if (b.type === "price" && b.list_price > 0 && b.list_price <= b.price) out[at("list_price")] = "list_below_price";
    if (b.type === "class" && b.list_price > 0 && known.has(b.course_id) && b.list_price <= known.get(b.course_id)!) out[at("list_price")] = "list_below_price";
    if (b.type === "class" && !known.has(b.course_id)) out[at("course_id")] = "not_found";
    if (b.type === "reviews" && b.course_id > 0 && !known.has(b.course_id)) out[at("course_id")] = "not_found";
    if (b.type === "faq") {
      b.items.forEach((q, n) => {
        const item = q as unknown as Record<string, unknown>;
        if (!both(item, "question") || !both(item, "answer")) out[at(`items.${n}`)] = "required";
      });
    }
    if (b.type === "whatsapp" && !both(r, "button")) out[at("button_en")] = "required";
  });
  return out;
}

/** The stored list, read back (a broken row reads as no blocks rather than failing the page). */
export function readBlocks(raw: unknown): LandingBlock[] {
  try {
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    const r = blocksSchema.safeParse(parsed);
    return r.success ? (r.data as LandingBlock[]) : [];
  } catch {
    return [];
  }
}

export interface LandingRow {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  description_bn: string;
  description_en: string;
  status: "draft" | "published";
  blocks: string;
  updated_at: string;
  published_at: string | null;
}

export async function landingBySlug(env: Env, slug: string): Promise<LandingRow | null> {
  return first<LandingRow>(env.DB, "SELECT * FROM landing_pages WHERE slug = ? AND status = 'published' AND deleted_at IS NULL", slug);
}

/** A review on a landing page: who (first name), the class it is about, the stars and the words. */
export interface LandingReview extends PublicReview {
  course_slug: string;
  course_title_bn: string;
  course_title_en: string;
}

/** What the blocks need from the database: the classes they show (published ones only) and the reviews they quote. */
export interface LandingData {
  courses: Map<number, CourseCardDTO>;
  reviews: Map<number, LandingReview[]>;
}

export async function landingData(env: Env, blocks: LandingBlock[]): Promise<LandingData> {
  const ids = [...new Set(blocks.flatMap((b) => (b.type === "class" ? [b.course_id] : [])))];
  const courses = new Map<number, CourseCardDTO>();
  if (ids.length) {
    const { items } = await listCourses(env, { ids, perPage: 60 });
    for (const c of items) if (c.status === "published") courses.set(c.id, c);
  }
  const reviews = new Map<number, LandingReview[]>();
  for (const b of blocks) {
    if (b.type !== "reviews" || reviews.has(b.course_id)) continue;
    const rows = await all<Omit<LandingReview, "author"> & { name: string }>(
      env.DB,
      `SELECT r.id, r.rating, r.body, r.reply, r.created_at, s.name, c.slug AS course_slug, c.title_bn AS course_title_bn, c.title_en AS course_title_en
       FROM reviews r JOIN students s ON s.id = r.student_id JOIN courses c ON c.id = r.course_id
       WHERE r.status = 'approved' AND c.deleted_at IS NULL AND c.status IN ('published','coming_soon') ${b.course_id > 0 ? "AND c.id = ?" : ""}
       ORDER BY r.created_at DESC, r.id DESC LIMIT 12`,
      ...(b.course_id > 0 ? [b.course_id] : []),
    );
    reviews.set(
      b.course_id,
      rows.map(({ name, ...r }) => ({ ...r, author: shortName(name) })),
    );
  }
  return { courses, reviews };
}
