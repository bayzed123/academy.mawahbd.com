import { z } from "zod";
import { ACCENTS, CLASS_ICONS, COURSE_STATUSES } from "@mawah/shared";
import type { Env } from "../../../env";
import { crudRoutes, type ResourceDef } from "../../../lib/crud";
import { all, first, nowIso, qs } from "../../../lib/db";
import { HttpError } from "../../../lib/http";
import { slugSchema, textSchema, optionalUrl } from "../../../lib/schemas";
import { uniqueSlug } from "../../../lib/slug";
import { notifyLaunch } from "../../../services/launch";

/* ============================================================================================== shared bits */
const imageKey = (folder: string) =>
  z
    .string()
    .max(200)
    .regex(new RegExp(`^${folder}/[a-f0-9]{16,64}\\.(png|jpe?g|webp|avif)$`), "invalid_image")
    .nullable();

const isoDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, "invalid_date"), z.null()]);
const sortNum = z.number().int().min(0).max(99999);
const money = z.number().int().min(0).max(10_000_000);

async function ensureSlug(c: { env: Env }, table: string, data: Record<string, unknown>, existing: { id: number; slug?: unknown } | null, source: string) {
  if (existing) {
    if (data.slug && data.slug !== existing.slug) {
      const clash = await first<{ id: number }>(c.env.DB, `SELECT id FROM ${table} WHERE slug = ? AND id <> ?`, data.slug as string, existing.id);
      if (clash) throw new HttpError(409, "duplicate", "duplicate", { slug: "duplicate" });
    }
    return data;
  }
  data.slug = data.slug ? data.slug : await uniqueSlug(c.env.DB, table, source);
  return data;
}

/* ==================================================================================================== instructors */
const instructorSchema = z.object({
  slug: slugSchema.optional(),
  name_bn: textSchema(120, 1),
  name_en: textSchema(120, 1),
  headline_bn: textSchema(160),
  headline_en: textSchema(160),
  bio_bn: textSchema(4000),
  bio_en: textSchema(4000),
  credentials: textSchema(600),
  photo_key: imageKey("photos"),
  links: z.array(z.object({ label: textSchema(40, 1), url: z.string().trim().max(500).refine((v) => /^https?:\/\//i.test(v), "invalid_url") })).max(6),
  active: z.boolean(),
  sort: sortNum,
});

export const instructors = crudRoutes({
  name: "instructors",
  table: "instructors",
  perms: { read: "instructors:read", write: "instructors:write" },
  schema: instructorSchema,
  searchCols: ["name_bn", "name_en", "headline_en"],
  sortCols: ["id", "name_en", "sort", "updated_at"],
  defaultSort: "sort",
  softDelete: true,
  publicContent: true,
  label: (r) => String(r.name_en),
  beforeSave: (c, data, existing) => ensureSlug(c, "instructors", data, existing, String(data.name_en ?? "")),
  async canDelete(c, row) {
    const n = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM courses WHERE instructor_id = ? AND deleted_at IS NULL", row.id);
    if ((n?.n ?? 0) > 0) throw new HttpError(409, "in_use");
  },
  csv: [
    { key: "id", label: "ID" },
    { key: "name_en", label: "Name (EN)" },
    { key: "name_bn", label: "Name (BN)" },
    { key: "headline_en", label: "Headline" },
    { key: "active", label: "Active" },
  ],
} satisfies ResourceDef<typeof instructorSchema>);

/* ==================================================================================================== categories */
const categorySchema = z.object({
  slug: slugSchema.optional(),
  name_bn: textSchema(80, 1),
  name_en: textSchema(80, 1),
  blurb_bn: textSchema(200),
  blurb_en: textSchema(200),
  accent: z.enum(ACCENTS),
  icon: z.enum(CLASS_ICONS),
  sort: sortNum,
  active: z.boolean(),
});

export const categories = crudRoutes({
  name: "categories",
  table: "categories",
  perms: { read: "categories:read", write: "categories:write" },
  schema: categorySchema,
  searchCols: ["name_bn", "name_en", "slug"],
  sortCols: ["id", "name_en", "sort"],
  defaultSort: "sort",
  hasUpdatedAt: false,
  publicContent: true,
  label: (r) => String(r.name_en),
  beforeSave: (c, data, existing) => ensureSlug(c, "categories", data, existing, String(data.name_en ?? "")),
  async canDelete(c, row) {
    const n = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM courses WHERE category_id = ? AND deleted_at IS NULL", row.id);
    if ((n?.n ?? 0) > 0) throw new HttpError(409, "in_use");
  },
} satisfies ResourceDef<typeof categorySchema>);

/* ======================================================================================================== blog */
const blogSchema = z.object({
  slug: slugSchema.optional(),
  title_bn: textSchema(200, 1),
  title_en: textSchema(200, 1),
  excerpt_bn: textSchema(400),
  excerpt_en: textSchema(400),
  body_bn: z.string().max(60000),
  body_en: z.string().max(60000),
  cover_key: imageKey("blog"),
  tags: textSchema(200),
  status: z.enum(["draft", "published"]),
  seo_title_bn: textSchema(120),
  seo_title_en: textSchema(120),
  seo_desc_bn: textSchema(320),
  seo_desc_en: textSchema(320),
  published_at: isoDate,
});

export const blog = crudRoutes({
  name: "blog",
  table: "blog_posts",
  perms: { read: "blog:read", write: "blog:write" },
  schema: blogSchema,
  searchCols: ["title_bn", "title_en", "tags"],
  sortCols: ["id", "title_en", "published_at", "updated_at", "status"],
  defaultSort: "-updated_at",
  filters: { status: "status" },
  softDelete: true,
  publicContent: true,
  label: (r) => String(r.title_en),
  async beforeSave(c, data, existing) {
    await ensureSlug(c, "blog_posts", data, existing, String(data.title_en ?? ""));
    const status = (data.status as string | undefined) ?? (existing?.status as string | undefined);
    if (status === "published" && !data.published_at && !existing?.published_at) data.published_at = nowIso();
    return data;
  },
  csv: [
    { key: "id", label: "ID" },
    { key: "title_en", label: "Title (EN)" },
    { key: "title_bn", label: "Title (BN)" },
    { key: "status", label: "Status" },
    { key: "published_at", label: "Published" },
  ],
} satisfies ResourceDef<typeof blogSchema>);

/* ===================================================================================================== bundles */
const bundleSchema = z.object({
  slug: slugSchema.optional(),
  title_bn: textSchema(160, 1),
  title_en: textSchema(160, 1),
  desc_bn: textSchema(600),
  desc_en: textSchema(600),
  price: money,
  status: z.enum(["draft", "published", "archived"]),
  banner_key: imageKey("banners"),
  sort: sortNum,
  course_ids: z.array(z.number().int().positive()).min(1, "required").max(20),
});

export const bundles = crudRoutes({
  name: "bundles",
  table: "bundles",
  perms: { read: "bundles:read", write: "bundles:write" },
  schema: bundleSchema,
  virtual: ["course_ids"],
  searchCols: ["title_bn", "title_en"],
  sortCols: ["id", "title_en", "price", "sort", "updated_at"],
  defaultSort: "sort",
  filters: { status: "status" },
  softDelete: true,
  publicContent: true,
  label: (r) => String(r.title_en),
  beforeSave: (c, data, existing) => ensureSlug(c, "bundles", data, existing, String(data.title_en ?? "")),
  async afterSave(c, row, data) {
    if (!Array.isArray(data.course_ids)) return;
    const ids = [...new Set(data.course_ids as number[])];
    const valid = await all<{ id: number }>(c.env.DB, `SELECT id FROM courses WHERE id IN (${qs(ids.length)}) AND deleted_at IS NULL`, ...ids);
    if (valid.length !== ids.length) throw new HttpError(422, "validation", "validation", { course_ids: "invalid" });
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM bundle_items WHERE bundle_id = ?").bind(row.id),
      ...ids.map((id) => c.env.DB.prepare("INSERT INTO bundle_items (bundle_id, course_id) VALUES (?, ?)").bind(row.id, id)),
    ]);
  },
  async decorate(c, rows) {
    if (!rows.length) return rows;
    const items = await all<{ bundle_id: number; course_id: number }>(c.env.DB, `SELECT bundle_id, course_id FROM bundle_items WHERE bundle_id IN (${qs(rows.length)})`, ...rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, course_ids: items.filter((i) => i.bundle_id === r.id).map((i) => i.course_id) }));
  },
} satisfies ResourceDef<typeof bundleSchema>);

/* ===================================================================================================== coupons */
const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, "invalid_code"),
  type: z.enum(["percent", "flat"]),
  value: z.number().int().min(1).max(10_000_000),
  min_order: money,
  max_discount: z.union([money, z.null()]),
  starts_at: isoDate,
  expires_at: isoDate,
  max_uses: z.union([z.number().int().min(1).max(1_000_000), z.null()]),
  per_student_limit: z.number().int().min(1).max(100),
  active: z.boolean(),
  note: textSchema(200),
  course_ids: z.array(z.number().int().positive()).max(50),
});

export const coupons = crudRoutes({
  name: "coupons",
  table: "coupons",
  perms: { read: "coupons:read", write: "coupons:write" },
  schema: couponSchema,
  virtual: ["course_ids"],
  searchCols: ["code", "note"],
  sortCols: ["id", "code", "used_count", "expires_at", "created_at"],
  defaultSort: "-created_at",
  softDelete: true,
  label: (r) => String(r.code),
  async beforeSave(_c, data, existing) {
    const type = (data.type as string | undefined) ?? (existing?.type as string | undefined);
    const value = (data.value as number | undefined) ?? (existing?.value as number | undefined);
    if (type === "percent" && value !== undefined && value > 100) throw new HttpError(422, "validation", "validation", { value: "percent_max_100" });
    return data;
  },
  async afterSave(c, row, data) {
    if (!Array.isArray(data.course_ids)) return;
    const ids = [...new Set(data.course_ids as number[])];
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM coupon_courses WHERE coupon_id = ?").bind(row.id),
      ...ids.map((id) => c.env.DB.prepare("INSERT OR IGNORE INTO coupon_courses (coupon_id, course_id) VALUES (?, ?)").bind(row.id, id)),
    ]);
  },
  async decorate(c, rows) {
    if (!rows.length) return rows;
    const items = await all<{ coupon_id: number; course_id: number }>(c.env.DB, `SELECT coupon_id, course_id FROM coupon_courses WHERE coupon_id IN (${qs(rows.length)})`, ...rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, course_ids: items.filter((i) => i.coupon_id === r.id).map((i) => i.course_id) }));
  },
  csv: [
    { key: "code", label: "Code" },
    { key: "type", label: "Type" },
    { key: "value", label: "Value" },
    { key: "min_order", label: "Min order" },
    { key: "used_count", label: "Used" },
    { key: "max_uses", label: "Max uses" },
    { key: "expires_at", label: "Expires" },
    { key: "active", label: "Active" },
  ],
} satisfies ResourceDef<typeof couponSchema>);

/* ===================================================================================================== courses */
const courseSchema = z.object({
  slug: slugSchema.optional(),
  title_bn: textSchema(200, 1),
  title_en: textSchema(200, 1),
  short_bn: textSchema(400),
  short_en: textSchema(400),
  long_bn: z.string().max(30000),
  long_en: z.string().max(30000),
  banner_key: imageKey("banners"),
  icon: z.union([z.enum(CLASS_ICONS), z.null()]),
  category_id: z.union([z.number().int().positive(), z.null()]),
  instructor_id: z.union([z.number().int().positive(), z.null()]),
  level: z.union([z.enum(["beginner", "intermediate", "advanced"]), z.null()]),
  price: money,
  status: z.enum(COURSE_STATUSES),
  details_url: optionalUrl,
  featured: z.boolean(),
  cert_enabled: z.boolean(),
  cert_template: z.enum(["classic"]).optional(), // one template today: the column default applies when the form does not send it
  seo_title_bn: textSchema(120),
  seo_title_en: textSchema(120),
  seo_desc_bn: textSchema(320),
  seo_desc_en: textSchema(320),
  sort: sortNum,
  launch_at: isoDate,
});

export const courses = crudRoutes({
  name: "courses",
  table: "courses",
  serverColumns: ["published_at"],
  perms: { read: "courses:read", write: "courses:write", delete: "courses:delete" },
  schema: courseSchema,
  searchCols: ["title_bn", "title_en", "slug"],
  sortCols: ["id", "title_en", "price", "status", "sort", "updated_at", "published_at", "rating_avg"],
  defaultSort: "sort",
  filters: { status: "status", category_id: "category_id" },
  softDelete: true,
  publicContent: true,
  label: (r) => String(r.title_en),
  async beforeSave(c, data, existing) {
    await ensureSlug(c, "courses", data, existing, String(data.title_en ?? ""));
    const status = (data.status as string | undefined) ?? (existing?.status as string | undefined);
    if (status === "published" && !existing?.published_at) data.published_at = nowIso();
    if (data.category_id) {
      const ok = await first(c.env.DB, "SELECT id FROM categories WHERE id = ?", data.category_id as number);
      if (!ok) throw new HttpError(422, "validation", "validation", { category_id: "invalid" });
    }
    if (data.instructor_id) {
      const ok = await first(c.env.DB, "SELECT id FROM instructors WHERE id = ? AND deleted_at IS NULL", data.instructor_id as number);
      if (!ok) throw new HttpError(422, "validation", "validation", { instructor_id: "invalid" });
    }
    return data;
  },
  async afterSave(c, row, _data, kind) {
    // flipping a Coming Soon class live (by any route) tells everyone who asked to be notified
    if (kind === "update" && row.status === "published") {
      const waiting = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM notify_signups WHERE course_id = ? AND notified_at IS NULL", row.id);
      if ((waiting?.n ?? 0) > 0) c.executionCtx.waitUntil(notifyLaunch(c.env, row.id).then(() => undefined));
    }
  },
  async canDelete(c, row) {
    const n = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?", row.id);
    if ((n?.n ?? 0) > 0) throw new HttpError(409, "has_enrollments"); // archive it instead — students paid for this class
  },
  async decorate(c, rows) {
    if (!rows.length) return rows;
    const [enrolled, waiting] = await Promise.all([
      all<{ course_id: number; n: number }>(c.env.DB, `SELECT course_id, COUNT(*) AS n FROM enrollments WHERE status = 'active' AND course_id IN (${qs(rows.length)}) GROUP BY course_id`, ...rows.map((r) => r.id)),
      all<{ course_id: number; n: number }>(c.env.DB, `SELECT course_id, COUNT(*) AS n FROM notify_signups WHERE notified_at IS NULL AND course_id IN (${qs(rows.length)}) GROUP BY course_id`, ...rows.map((r) => r.id)),
    ]);
    return rows.map((r) => ({
      ...r,
      enrolled_count: enrolled.find((e) => e.course_id === r.id)?.n ?? 0,
      notify_count: waiting.find((e) => e.course_id === r.id)?.n ?? 0,
    }));
  },
  csv: [
    { key: "id", label: "ID" },
    { key: "title_en", label: "Title (EN)" },
    { key: "title_bn", label: "Title (BN)" },
    { key: "price", label: "Price (BDT)" },
    { key: "status", label: "Status" },
    { key: "lesson_count", label: "Lessons" },
    { key: "rating_avg", label: "Rating" },
    { key: "rating_count", label: "Reviews" },
  ],
} satisfies ResourceDef<typeof courseSchema>);
