import { Hono } from "hono";
import { z } from "zod";
import { MAX_CLASS_PICTURES } from "@mawah/shared";
import type { AppEnv, Ctx } from "../../../env";
import { audit } from "../../../lib/audit";
import { all, first, run } from "../../../lib/db";
import { HttpError, conflict, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { textSchema } from "../../../lib/schemas";
import { bumpContentVersion } from "../../../lib/settings";
import { requirePerm } from "../../../middleware/auth";

/**
 * Admin → a class → Pictures: more pictures for the class page. The owner uploads them (one request per picture, like every
 * picture field in the admin), then saves each as part of the class. A picture can only be one the upload endpoint stored,
 * under a public folder — never an address, never a private file.
 */
export const gallery = new Hono<AppEnv>();

const imageKey = z
  .string()
  .max(200)
  .regex(/^(gallery|photos|banners)\/[a-f0-9]{16,64}\.(png|jpe?g|webp|avif)$/, "invalid_image");

// `thumb_key`: the small copy the browser made for the grid (the large one is used there when it is missing)
const addSchema = z.object({ image_key: imageKey, thumb_key: imageKey.optional(), caption_bn: textSchema(160), caption_en: textSchema(160) });
const captionSchema = z.object({ caption_bn: textSchema(160), caption_en: textSchema(160) });
const orderSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(MAX_CLASS_PICTURES) });

interface ImageRow {
  id: number;
  course_id: number;
  image_key: string;
  thumb_key: string | null;
  caption_bn: string;
  caption_en: string;
  sort: number;
  created_at: string;
}

async function requireCourse(c: Ctx, id: number): Promise<{ id: number; title_en: string }> {
  const course = await first<{ id: number; title_en: string }>(c.env.DB, "SELECT id, title_en FROM courses WHERE id = ? AND deleted_at IS NULL", id);
  if (!course) throw notFound();
  return course;
}

const list = (c: Ctx, courseId: number) =>
  all<ImageRow>(c.env.DB, "SELECT id, course_id, image_key, thumb_key, caption_bn, caption_en, sort, created_at FROM course_images WHERE course_id = ? ORDER BY sort, id", courseId);

gallery.get("/courses/:id/images", requirePerm("courses:read"), async (c) => {
  const course = await requireCourse(c, intParam(c, "id"));
  return ok(c, { items: await list(c, course.id), max: MAX_CLASS_PICTURES });
});

gallery.post("/courses/:id/images", requirePerm("courses:write"), async (c) => {
  const course = await requireCourse(c, intParam(c, "id"));
  const body = await parseBody(c, addSchema);
  // only a picture the upload endpoint really stored (a made-up key would show a broken picture to every visitor)
  if (!(await c.env.R2.head(body.image_key))) throw new HttpError(422, "validation", "validation", { image_key: "invalid_image" });
  if (body.thumb_key && !(await c.env.R2.head(body.thumb_key))) throw new HttpError(422, "validation", "validation", { thumb_key: "invalid_image" });
  const count = (await first<{ n: number; top: number | null }>(c.env.DB, "SELECT COUNT(*) AS n, MAX(sort) AS top FROM course_images WHERE course_id = ?", course.id)) ?? { n: 0, top: null };
  if (count.n >= MAX_CLASS_PICTURES) throw conflict("gallery_full");
  const res = await run(
    c.env.DB,
    "INSERT INTO course_images (course_id, image_key, thumb_key, caption_bn, caption_en, sort) VALUES (?, ?, ?, ?, ?, ?)",
    course.id,
    body.image_key,
    body.thumb_key ?? null,
    body.caption_bn,
    body.caption_en,
    (count.top ?? 0) + 10,
  );
  await bumpContentVersion(c.env);
  await audit(c, { action: "gallery.added", entity: "course", entityId: course.id, summary: course.title_en });
  const item = await first<ImageRow>(c.env.DB, "SELECT id, course_id, image_key, thumb_key, caption_bn, caption_en, sort, created_at FROM course_images WHERE id = ?", res.meta.last_row_id as number);
  return ok(c, { item }, 201);
});

/** New order: the ids of all the class's pictures, first to last. Anything else (a missing, extra or foreign id) is refused. */
gallery.post("/courses/:id/images/order", requirePerm("courses:write"), async (c) => {
  const course = await requireCourse(c, intParam(c, "id"));
  const { ids } = await parseBody(c, orderSchema);
  const have = (await list(c, course.id)).map((r) => r.id).sort((a, b) => a - b);
  const want = [...ids].sort((a, b) => a - b);
  if (have.length !== want.length || have.some((id, i) => id !== want[i])) throw new HttpError(422, "validation", "validation", { ids: "invalid" });
  await c.env.DB.batch(ids.map((id, i) => c.env.DB.prepare("UPDATE course_images SET sort = ? WHERE id = ? AND course_id = ?").bind((i + 1) * 10, id, course.id)));
  await bumpContentVersion(c.env);
  await audit(c, { action: "gallery.reordered", entity: "course", entityId: course.id, summary: course.title_en });
  return ok(c, { items: await list(c, course.id) });
});

gallery.patch("/courses/:id/images/:imageId", requirePerm("courses:write"), async (c) => {
  const course = await requireCourse(c, intParam(c, "id"));
  const imageId = intParam(c, "imageId");
  const body = await parseBody(c, captionSchema);
  const res = await run(c.env.DB, "UPDATE course_images SET caption_bn = ?, caption_en = ? WHERE id = ? AND course_id = ?", body.caption_bn, body.caption_en, imageId, course.id);
  if (!res.meta.changes) throw notFound();
  await bumpContentVersion(c.env);
  await audit(c, { action: "gallery.captioned", entity: "course", entityId: course.id, summary: course.title_en });
  return ok(c);
});

gallery.delete("/courses/:id/images/:imageId", requirePerm("courses:write"), async (c) => {
  const course = await requireCourse(c, intParam(c, "id"));
  const res = await run(c.env.DB, "DELETE FROM course_images WHERE id = ? AND course_id = ?", intParam(c, "imageId"), course.id);
  if (!res.meta.changes) throw notFound();
  await bumpContentVersion(c.env);
  await audit(c, { action: "gallery.removed", entity: "course", entityId: course.id, summary: course.title_en });
  return ok(c);
});
