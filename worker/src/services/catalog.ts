import type {
  Accent,
  CategoryDTO,
  CourseCardDTO,
  CourseStatus,
  CurriculumModuleDTO,
  LessonType,
} from "@mawah/shared";
import type { Env } from "../env";
import { all, first, likeEscape, qs, safeJson } from "./../lib/db";

/* -------------------------------------------------------------------------------------------------
 * Read-side catalog queries used by the server-rendered pages and the public JSON API.
 * Every list query is indexed (status/deleted_at/sort, category) and paginated from day one.
 * ----------------------------------------------------------------------------------------------- */

const CARD_COLUMNS = `
  c.id, c.slug, c.title_bn, c.title_en, c.short_bn, c.short_en, c.banner_key, c.icon, c.price, c.status, c.level,
  c.rating_avg, c.rating_count, c.lesson_count, c.featured,
  cat.slug AS cat_slug, cat.name_bn AS cat_name_bn, cat.name_en AS cat_name_en, cat.accent AS cat_accent, cat.icon AS cat_icon`;

interface CardRow {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  short_bn: string;
  short_en: string;
  banner_key: string | null;
  icon: string | null;
  price: number;
  status: CourseStatus;
  level: CourseCardDTO["level"];
  rating_avg: number;
  rating_count: number;
  lesson_count: number;
  featured: number;
  cat_slug: string | null;
  cat_name_bn: string | null;
  cat_name_en: string | null;
  cat_accent: Accent | null;
  cat_icon: string | null;
}

export function toCard(r: CardRow): CourseCardDTO {
  return {
    id: r.id,
    slug: r.slug,
    title_bn: r.title_bn,
    title_en: r.title_en,
    short_bn: r.short_bn,
    short_en: r.short_en,
    banner_key: r.banner_key,
    icon: r.icon,
    price: r.price,
    status: r.status,
    level: r.level,
    rating_avg: r.rating_avg,
    rating_count: r.rating_count,
    lesson_count: r.lesson_count,
    featured: !!r.featured,
    category: r.cat_slug
      ? { slug: r.cat_slug, name_bn: r.cat_name_bn ?? "", name_en: r.cat_name_en ?? "", accent: r.cat_accent ?? "snack", icon: r.cat_icon ?? "cake" }
      : null,
  };
}

export type CourseSort = "featured" | "new" | "price_asc" | "price_desc";
const ORDER: Record<CourseSort, string> = {
  featured: "c.featured DESC, c.sort ASC, c.id ASC",
  new: "c.published_at DESC, c.id DESC",
  price_asc: "c.price ASC, c.sort ASC, c.id ASC",
  price_desc: "c.price DESC, c.sort ASC, c.id ASC",
};

export interface ListOptions {
  category?: string;
  q?: string;
  sort?: CourseSort;
  page?: number;
  perPage?: number;
  featuredOnly?: boolean;
  level?: "beginner" | "intermediate" | "advanced";
  excludeId?: number;
  ids?: number[];
}

export async function listCourses(env: Env, o: ListOptions = {}): Promise<{ items: CourseCardDTO[]; total: number }> {
  const where: string[] = ["c.deleted_at IS NULL", "c.status IN ('published','coming_soon')"];
  const params: (string | number)[] = [];
  if (o.category) {
    where.push("cat.slug = ?");
    params.push(o.category);
  }
  if (o.featuredOnly) where.push("c.featured = 1");
  if (o.level) {
    where.push("c.level = ?");
    params.push(o.level);
  }
  if (o.excludeId) {
    where.push("c.id <> ?");
    params.push(o.excludeId);
  }
  if (o.ids?.length) {
    where.push(`c.id IN (${qs(o.ids.length)})`);
    params.push(...o.ids);
  }
  if (o.q?.trim()) {
    const like = `%${likeEscape(o.q.trim().slice(0, 80))}%`;
    where.push(
      "(c.title_bn LIKE ? ESCAPE '\\' OR c.title_en LIKE ? ESCAPE '\\' OR c.short_bn LIKE ? ESCAPE '\\' OR c.short_en LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like, like);
  }
  const perPage = Math.min(60, Math.max(1, o.perPage ?? 12));
  const page = Math.max(1, o.page ?? 1);
  const from = `FROM courses c LEFT JOIN categories cat ON cat.id = c.category_id WHERE ${where.join(" AND ")}`;

  const [rows, totalRow] = await Promise.all([
    all<CardRow>(env.DB, `SELECT ${CARD_COLUMNS} ${from} ORDER BY ${ORDER[o.sort ?? "featured"]} LIMIT ? OFFSET ?`, ...params, perPage, (page - 1) * perPage),
    first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n ${from}`, ...params),
  ]);
  return { items: rows.map(toCard), total: totalRow?.n ?? 0 };
}

export interface CourseDetail extends CourseCardDTO {
  long_bn: string;
  long_en: string;
  details_url: string | null;
  cert_enabled: boolean;
  duration_sec: number;
  seo_title_bn: string;
  seo_title_en: string;
  seo_desc_bn: string;
  seo_desc_en: string;
  published_at: string | null;
  launch_at: string | null;
  updated_at: string;
  instructor: InstructorDTO | null;
}

/** What students think of an instructor: the average of the approved reviews of their live classes (real data only). */
export interface InstructorRating {
  avg: number;
  count: number;
  classes: number;
}

export interface InstructorDTO {
  id: number;
  slug: string;
  name_bn: string;
  name_en: string;
  headline_bn: string;
  headline_en: string;
  bio_bn: string;
  bio_en: string;
  credentials: string;
  photo_key: string | null;
  links: { label: string; url: string }[];
  /** filled in by the functions below that load instructors for a page */
  rating?: InstructorRating;
}

interface InstructorRow extends Omit<InstructorDTO, "links"> {
  links: string;
}

const toInstructor = (r: InstructorRow): InstructorDTO => ({ ...r, links: safeJson(r.links, []) });

/**
 * Ratings per instructor, computed from their classes' approved-review totals (the same numbers the class pages show):
 * a review-weighted average, so a class with 20 reviews counts for more than one with 1. Nothing here is ever invented —
 * an instructor whose classes have no approved review has count 0.
 */
export async function instructorRatings(env: Env, ids: number[]): Promise<Map<number, InstructorRating>> {
  const out = new Map<number, InstructorRating>();
  const unique = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
  if (unique.length === 0) return out;
  const rows = await all<{ instructor_id: number; classes: number; reviews: number; weighted: number }>(
    env.DB,
    `SELECT instructor_id, COUNT(*) AS classes, COALESCE(SUM(rating_count), 0) AS reviews, COALESCE(SUM(rating_avg * rating_count), 0) AS weighted
     FROM courses WHERE instructor_id IN (${unique.map(() => "?").join(",")}) AND deleted_at IS NULL AND status IN ('published','coming_soon')
     GROUP BY instructor_id`,
    ...unique,
  );
  for (const r of rows) out.set(r.instructor_id, { avg: r.reviews > 0 ? Math.round((r.weighted / r.reviews) * 10) / 10 : 0, count: r.reviews, classes: r.classes });
  return out;
}

async function withRatings(env: Env, list: InstructorDTO[]): Promise<InstructorDTO[]> {
  const ratings = await instructorRatings(env, list.map((i) => i.id));
  return list.map((i) => ({ ...i, rating: ratings.get(i.id) ?? { avg: 0, count: 0, classes: 0 } }));
}

export async function getCourseBySlug(env: Env, slug: string, opts: { includeHidden?: boolean } = {}): Promise<CourseDetail | null> {
  const row = await first<CardRow & Record<string, unknown>>(
    env.DB,
    `SELECT ${CARD_COLUMNS}, c.long_bn, c.long_en, c.details_url, c.cert_enabled, c.duration_sec, c.seo_title_bn, c.seo_title_en,
            c.seo_desc_bn, c.seo_desc_en, c.published_at, c.launch_at, c.updated_at, c.instructor_id
     FROM courses c LEFT JOIN categories cat ON cat.id = c.category_id
     WHERE c.slug = ? AND c.deleted_at IS NULL ${opts.includeHidden ? "" : "AND c.status IN ('published','coming_soon')"}`,
    slug,
  );
  if (!row) return null;
  const instructor = row.instructor_id
    ? await first<InstructorRow>(env.DB, "SELECT * FROM instructors WHERE id = ? AND deleted_at IS NULL AND active = 1", row.instructor_id as number)
    : null;
  return {
    ...toCard(row),
    long_bn: row.long_bn as string,
    long_en: row.long_en as string,
    details_url: (row.details_url as string | null) ?? null,
    cert_enabled: !!row.cert_enabled,
    duration_sec: row.duration_sec as number,
    seo_title_bn: row.seo_title_bn as string,
    seo_title_en: row.seo_title_en as string,
    seo_desc_bn: row.seo_desc_bn as string,
    seo_desc_en: row.seo_desc_en as string,
    published_at: (row.published_at as string | null) ?? null,
    launch_at: (row.launch_at as string | null) ?? null,
    updated_at: row.updated_at as string,
    instructor: instructor ? (await withRatings(env, [toInstructor(instructor)]))[0] : null,
  };
}

export async function listCategories(env: Env): Promise<CategoryDTO[]> {
  return all<CategoryDTO>(
    env.DB,
    `SELECT cat.id, cat.slug, cat.name_bn, cat.name_en, cat.blurb_bn, cat.blurb_en, cat.accent, cat.icon,
            (SELECT COUNT(*) FROM courses c WHERE c.category_id = cat.id AND c.deleted_at IS NULL AND c.status IN ('published','coming_soon')) AS course_count
     FROM categories cat WHERE cat.active = 1 ORDER BY cat.sort, cat.id`,
  );
}

export async function listInstructors(env: Env): Promise<InstructorDTO[]> {
  const rows = await all<InstructorRow>(env.DB, "SELECT * FROM instructors WHERE active = 1 AND deleted_at IS NULL ORDER BY sort, id");
  return withRatings(env, rows.map(toInstructor));
}

export async function getInstructorBySlug(env: Env, slug: string): Promise<InstructorDTO | null> {
  const row = await first<InstructorRow>(env.DB, "SELECT * FROM instructors WHERE slug = ? AND active = 1 AND deleted_at IS NULL", slug);
  return row ? (await withRatings(env, [toInstructor(row)]))[0] : null;
}

export async function coursesByInstructor(env: Env, instructorId: number): Promise<CourseCardDTO[]> {
  const rows = await all<CardRow>(
    env.DB,
    `SELECT ${CARD_COLUMNS} FROM courses c LEFT JOIN categories cat ON cat.id = c.category_id
     WHERE c.instructor_id = ? AND c.deleted_at IS NULL AND c.status IN ('published','coming_soon') ORDER BY c.sort, c.id`,
    instructorId,
  );
  return rows.map(toCard);
}

/** Other classes from the same category first, topped up with featured ones. */
export async function relatedCourses(env: Env, course: { id: number; category: { slug: string } | null }, limit = 3): Promise<CourseCardDTO[]> {
  const out: CourseCardDTO[] = [];
  if (course.category) {
    out.push(...(await listCourses(env, { category: course.category.slug, excludeId: course.id, perPage: limit })).items);
  }
  if (out.length < limit) {
    const more = await listCourses(env, { featuredOnly: true, excludeId: course.id, perPage: limit + 2 });
    for (const c of more.items) {
      if (out.length >= limit) break;
      if (!out.some((o) => o.id === c.id)) out.push(c);
    }
  }
  return out.slice(0, limit);
}

/** Module/lesson skeleton only — titles, types, durations. Never any playable content. */
export async function getCurriculum(env: Env, courseId: number): Promise<CurriculumModuleDTO[]> {
  const [modules, lessons] = await Promise.all([
    all<{ id: number; title_bn: string; title_en: string; drip_days: number }>(
      env.DB,
      "SELECT id, title_bn, title_en, drip_days FROM modules WHERE course_id = ? ORDER BY sort, id",
      courseId,
    ),
    all<{ id: number; module_id: number; title_bn: string; title_en: string; type: LessonType; duration_sec: number; is_preview: number }>(
      env.DB,
      "SELECT id, module_id, title_bn, title_en, type, duration_sec, is_preview FROM lessons WHERE course_id = ? ORDER BY sort, id",
      courseId,
    ),
  ]);
  return modules.map((m) => ({
    id: m.id,
    title_bn: m.title_bn,
    title_en: m.title_en,
    drip_days: m.drip_days,
    lessons: lessons
      .filter((l) => l.module_id === m.id)
      .map((l) => ({
        id: l.id,
        title_bn: l.title_bn,
        title_en: l.title_en,
        type: l.type,
        duration_sec: l.duration_sec,
        is_preview: !!l.is_preview,
      })),
  }));
}

export interface PublicReview {
  id: number;
  rating: number;
  body: string;
  reply: string | null;
  created_at: string;
  author: string;
}

/** Approved reviews only. Authors are shown by first name + initial. */
export async function approvedReviews(env: Env, courseId: number, limit = 10): Promise<PublicReview[]> {
  const rows = await all<{ id: number; rating: number; body: string; reply: string | null; created_at: string; name: string }>(
    env.DB,
    `SELECT r.id, r.rating, r.body, r.reply, r.created_at, s.name
     FROM reviews r JOIN students s ON s.id = r.student_id
     WHERE r.course_id = ? AND r.status = 'approved' ORDER BY r.created_at DESC LIMIT ?`,
    courseId,
    limit,
  );
  return rows.map(({ name, ...r }) => ({ ...r, author: shortName(name) }));
}

/** A review shown on an instructor's profile: it also says which of their classes it is about. */
export interface InstructorReview extends PublicReview {
  course_slug: string;
  course_title_bn: string;
  course_title_en: string;
}

/** The latest approved reviews on the instructor's live classes (a hidden or draft class never shows up here). */
export async function reviewsByInstructor(env: Env, instructorId: number, limit = 6): Promise<InstructorReview[]> {
  const rows = await all<Omit<InstructorReview, "author"> & { name: string }>(
    env.DB,
    `SELECT r.id, r.rating, r.body, r.reply, r.created_at, s.name, c.slug AS course_slug, c.title_bn AS course_title_bn, c.title_en AS course_title_en
     FROM reviews r JOIN students s ON s.id = r.student_id JOIN courses c ON c.id = r.course_id
     WHERE c.instructor_id = ? AND c.deleted_at IS NULL AND c.status IN ('published','coming_soon') AND r.status = 'approved'
     ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    instructorId,
    limit,
  );
  return rows.map(({ name, ...r }) => ({ ...r, author: shortName(name) }));
}

export interface ReviewSummary {
  /** average of the approved reviews, one decimal (0 when there are none) */
  avg: number;
  count: number;
  /** how many approved reviews gave 1, 2, 3, 4 and 5 stars (index 0 = one star) */
  dist: [number, number, number, number, number];
}

/** The numbers behind the rating summary on a class page: every figure is counted from approved reviews, nothing else. */
export async function reviewSummary(env: Env, courseId: number): Promise<ReviewSummary> {
  const rows = await all<{ rating: number; n: number }>(env.DB, "SELECT rating, COUNT(*) AS n FROM reviews WHERE course_id = ? AND status = 'approved' GROUP BY rating", courseId);
  const dist: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    if (r.rating < 1 || r.rating > 5) continue;
    dist[r.rating - 1] = r.n;
    sum += r.rating * r.n;
    count += r.n;
  }
  return { avg: count ? Math.round((sum / count) * 10) / 10 : 0, count, dist };
}

export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${[...parts[parts.length - 1]][0]}.`;
}

export async function publishedCounts(env: Env): Promise<{ courses: number }> {
  const row = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM courses WHERE deleted_at IS NULL AND status = 'published'");
  return { courses: row?.n ?? 0 };
}

/** Keep the denormalised list columns (lesson count, duration) in sync after curriculum edits. */
export async function refreshCourseStats(env: Env, courseId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE courses SET
       lesson_count = (SELECT COUNT(*) FROM lessons WHERE course_id = ?1),
       duration_sec = (SELECT COALESCE(SUM(duration_sec), 0) FROM lessons WHERE course_id = ?1),
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ?1`,
  )
    .bind(courseId)
    .run();
}

/** Recompute the rating columns from approved reviews (called whenever a review's status changes). */
export async function refreshCourseRating(env: Env, courseId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE courses SET
       rating_avg = COALESCE((SELECT ROUND(AVG(rating), 2) FROM reviews WHERE course_id = ?1 AND status = 'approved'), 0),
       rating_count = (SELECT COUNT(*) FROM reviews WHERE course_id = ?1 AND status = 'approved')
     WHERE id = ?1`,
  )
    .bind(courseId)
    .run();
}
