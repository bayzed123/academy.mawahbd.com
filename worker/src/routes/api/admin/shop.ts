import { Hono } from "hono";
import { z } from "zod";
import { SHOP_MAX_PICTURES, SHOP_NEXT, SHOP_ORDER_STATUSES, type ShopOrderStatus } from "@mawah/shared";
import type { AppEnv, Ctx } from "../../../env";
import { audit } from "../../../lib/audit";
import { crudRoutes, type ResourceDef } from "../../../lib/crud";
import { all, first, likeEscape, nowIso, pageInfo, pageParams, qs, run } from "../../../lib/db";
import { HttpError, conflict, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { slugSchema, textSchema } from "../../../lib/schemas";
import { bumpContentVersion } from "../../../lib/settings";
import { uniqueSlug } from "../../../lib/slug";
import { requirePerm } from "../../../middleware/auth";
import { restockOrder, shopOrderDTO, shopOrderRow } from "../../../services/shop";

/**
 * Admin → Shop: the products (with their weights or sizes and prices, pictures and descriptions), the categories, the orders (with the
 * steps of a delivery) and the buyers' reviews. Products and categories show on the public site, so every change refreshes its cache.
 */

const sortNum = z.number().int().min(0).max(99999);

async function slugFor(c: Ctx, table: string, data: Record<string, unknown>, existing: { id: number; slug?: unknown } | null) {
  if (existing) {
    if (data.slug && data.slug !== existing.slug) {
      const clash = await first<{ id: number }>(c.env.DB, `SELECT id FROM ${table} WHERE slug = ? AND id <> ?`, data.slug as string, existing.id);
      if (clash) throw new HttpError(409, "duplicate", "duplicate", { slug: "duplicate" });
    }
    return data;
  }
  data.slug = data.slug ? data.slug : await uniqueSlug(c.env.DB, table, String(data.name_en ?? ""));
  return data;
}

/* =============================================================================================================== categories */
const categorySchema = z.object({
  slug: slugSchema.optional(),
  name_bn: textSchema(80, 1),
  name_en: textSchema(80, 1),
  sort: sortNum,
  active: z.boolean(),
});

export const shopCategoriesAdmin = crudRoutes({
  name: "shop_categories",
  table: "shop_categories",
  perms: { read: "shop:read", write: "shop:write" },
  schema: categorySchema,
  searchCols: ["name_bn", "name_en"],
  sortCols: ["id", "sort", "name_en"],
  defaultSort: "sort",
  publicContent: true,
  hasUpdatedAt: false,
  label: (r) => String(r.name_en),
  beforeSave: (c, data, existing) => slugFor(c, "shop_categories", data, existing),
  async decorate(c, rows) {
    if (!rows.length) return rows;
    const counts = await all<{ category_id: number; n: number }>(c.env.DB, `SELECT category_id, COUNT(*) AS n FROM shop_products WHERE category_id IN (${qs(rows.length)}) GROUP BY category_id`, ...rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, products: counts.find((x) => x.category_id === r.id)?.n ?? 0 }));
  },
} satisfies ResourceDef<typeof categorySchema>);

/* ================================================================================================================= products */
const variantSchema = z.object({
  /** an existing weight keeps its id (carts and past orders point at it); a new one has none */
  id: z.number().int().positive().optional(),
  label_bn: textSchema(60),
  label_en: textSchema(60),
  price: z.number().int().min(1, "required").max(1_000_000),
  list_price: z.number().int().min(0).max(1_000_000),
  stock: z.union([z.number().int().min(0).max(1_000_000), z.null()]),
  sku: textSchema(60),
});

const productSchema = z.object({
  slug: slugSchema.optional(),
  category_id: z.union([z.number().int().positive(), z.null()]),
  name_bn: textSchema(160, 1),
  name_en: textSchema(160, 1),
  short_bn: textSchema(300),
  short_en: textSchema(300),
  body_bn: textSchema(8000),
  body_en: textSchema(8000),
  status: z.enum(["draft", "published", "archived"]),
  featured: z.boolean(),
  sort: sortNum,
  variants: z
    .array(variantSchema)
    .min(1, "required")
    .max(20)
    .superRefine((list, ctx) => {
      // several weights must each say which one it is; the usual price, when given, is above the price
      list.forEach((v, i) => {
        if (list.length > 1 && !v.label_bn.trim() && !v.label_en.trim()) ctx.addIssue({ code: "custom", path: [i, "label_en"], message: "required" });
        if (v.list_price && v.list_price <= v.price) ctx.addIssue({ code: "custom", path: [i, "list_price"], message: "list_price_low" });
      });
    }),
});

export const shopProductsAdmin = crudRoutes({
  name: "shop_products",
  table: "shop_products",
  perms: { read: "shop:read", write: "shop:write" },
  schema: productSchema,
  virtual: ["variants"],
  serverColumns: ["published_at"],
  searchCols: ["name_bn", "name_en", "slug"],
  sortCols: ["id", "sort", "name_en", "updated_at", "status"],
  defaultSort: "sort",
  filters: { status: "status", category_id: "category_id" },
  publicContent: true,
  label: (r) => String(r.name_en),
  async beforeSave(c, data, existing) {
    if (data.category_id) {
      const cat = await first(c.env.DB, "SELECT id FROM shop_categories WHERE id = ?", data.category_id as number);
      if (!cat) throw new HttpError(422, "validation", "validation", { category_id: "invalid_id" });
    }
    // the first time it goes on sale is its "new" date in the shop
    if (data.status === "published" && !existing?.published_at) data.published_at = nowIso();
    return slugFor(c, "shop_products", data, existing);
  },
  async afterSave(c, row, data) {
    if (!Array.isArray(data.variants)) return;
    const list = data.variants as z.output<typeof variantSchema>[];
    const have = await all<{ id: number }>(c.env.DB, "SELECT id FROM shop_variants WHERE product_id = ?", row.id);
    const mine = new Set(have.map((v) => v.id));
    if (list.some((v) => v.id && !mine.has(v.id))) throw new HttpError(422, "validation", "validation", { variants: "invalid_id" });
    const kept = new Set(list.filter((v) => v.id).map((v) => v.id!));
    const stmts = list.map((v, i) =>
      v.id
        ? c.env.DB.prepare("UPDATE shop_variants SET label_bn = ?, label_en = ?, price = ?, list_price = ?, stock = ?, sku = ?, sort = ?, active = 1 WHERE id = ? AND product_id = ?").bind(
            v.label_bn,
            v.label_en,
            v.price,
            v.list_price,
            v.stock,
            v.sku,
            (i + 1) * 10,
            v.id,
            row.id,
          )
        : c.env.DB.prepare("INSERT INTO shop_variants (product_id, label_bn, label_en, price, list_price, stock, sku, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
            row.id,
            v.label_bn,
            v.label_en,
            v.price,
            v.list_price,
            v.stock,
            v.sku,
            (i + 1) * 10,
          ),
    );
    // a weight taken off the list is switched off, not deleted: past orders and carts still point at it
    for (const id of mine) if (!kept.has(id)) stmts.push(c.env.DB.prepare("UPDATE shop_variants SET active = 0 WHERE id = ?").bind(id));
    await c.env.DB.batch(stmts);
  },
  async decorate(c, rows) {
    if (!rows.length) return rows;
    const ids = rows.map((r) => r.id);
    const [variants, images, sold] = await Promise.all([
      all<{ id: number; product_id: number; label_bn: string; label_en: string; price: number; list_price: number; stock: number | null; sku: string }>(
        c.env.DB,
        `SELECT id, product_id, label_bn, label_en, price, list_price, stock, sku FROM shop_variants WHERE active = 1 AND product_id IN (${qs(ids.length)}) ORDER BY sort, id`,
        ...ids,
      ),
      all<{ product_id: number; image_key: string; thumb_key: string | null }>(c.env.DB, `SELECT product_id, image_key, thumb_key FROM shop_images WHERE product_id IN (${qs(ids.length)}) ORDER BY sort, id`, ...ids),
      all<{ product_id: number; n: number }>(
        c.env.DB,
        `SELECT i.product_id, SUM(i.qty) AS n FROM shop_order_items i JOIN shop_orders o ON o.id = i.order_id
         WHERE o.status IN ('placed','paid','review','confirmed','shipped','delivered') AND i.product_id IN (${qs(ids.length)}) GROUP BY i.product_id`,
        ...ids,
      ),
    ]);
    return rows.map((r) => ({
      ...r,
      variants: variants.filter((v) => v.product_id === r.id).map(({ product_id: _p, ...v }) => v),
      image: images.find((i) => i.product_id === r.id)?.thumb_key ?? images.find((i) => i.product_id === r.id)?.image_key ?? null,
      pictures: images.filter((i) => i.product_id === r.id).length,
      sold: sold.find((s) => s.product_id === r.id)?.n ?? 0,
    }));
  },
} satisfies ResourceDef<typeof productSchema>);

/* ================================================================================================================= pictures */
export const shopPictures = new Hono<AppEnv>();

const imageKey = z
  .string()
  .max(200)
  .regex(/^(gallery|photos|banners)\/[a-f0-9]{16,64}\.(png|jpe?g|webp|avif)$/, "invalid_image");
interface PictureRow {
  id: number;
  product_id: number;
  image_key: string;
  thumb_key: string | null;
  sort: number;
}
const pictures = (c: Ctx, productId: number) => all<PictureRow>(c.env.DB, "SELECT id, product_id, image_key, thumb_key, sort FROM shop_images WHERE product_id = ? ORDER BY sort, id", productId);

async function requireProduct(c: Ctx, id: number) {
  const p = await first<{ id: number; name_en: string }>(c.env.DB, "SELECT id, name_en FROM shop_products WHERE id = ?", id);
  if (!p) throw notFound();
  return p;
}

shopPictures.get("/shop/products/:id/images", requirePerm("shop:read"), async (c) => {
  const p = await requireProduct(c, intParam(c, "id"));
  return ok(c, { items: await pictures(c, p.id), max: SHOP_MAX_PICTURES });
});

shopPictures.post("/shop/products/:id/images", requirePerm("shop:write"), async (c) => {
  const p = await requireProduct(c, intParam(c, "id"));
  const body = await parseBody(c, z.object({ image_key: imageKey, thumb_key: imageKey.optional() }));
  // only a picture the upload endpoint really stored
  if (!(await c.env.R2.head(body.image_key))) throw new HttpError(422, "validation", "validation", { image_key: "invalid_image" });
  if (body.thumb_key && !(await c.env.R2.head(body.thumb_key))) throw new HttpError(422, "validation", "validation", { thumb_key: "invalid_image" });
  const count = (await first<{ n: number; top: number | null }>(c.env.DB, "SELECT COUNT(*) AS n, MAX(sort) AS top FROM shop_images WHERE product_id = ?", p.id)) ?? { n: 0, top: null };
  if (count.n >= SHOP_MAX_PICTURES) throw conflict("gallery_full");
  await run(c.env.DB, "INSERT INTO shop_images (product_id, image_key, thumb_key, sort) VALUES (?, ?, ?, ?)", p.id, body.image_key, body.thumb_key ?? null, (count.top ?? 0) + 10);
  await bumpContentVersion(c.env);
  await audit(c, { action: "shop_products.picture_added", entity: "shop_products", entityId: p.id, summary: p.name_en });
  return ok(c, { items: await pictures(c, p.id) }, 201);
});

shopPictures.post("/shop/products/:id/images/order", requirePerm("shop:write"), async (c) => {
  const p = await requireProduct(c, intParam(c, "id"));
  const { ids } = await parseBody(c, z.object({ ids: z.array(z.number().int().positive()).min(1).max(SHOP_MAX_PICTURES) }));
  const have = (await pictures(c, p.id)).map((r) => r.id).sort((a, b) => a - b);
  const want = [...ids].sort((a, b) => a - b);
  if (have.length !== want.length || have.some((id, i) => id !== want[i])) throw new HttpError(422, "validation", "validation", { ids: "invalid" });
  await c.env.DB.batch(ids.map((id, i) => c.env.DB.prepare("UPDATE shop_images SET sort = ? WHERE id = ? AND product_id = ?").bind((i + 1) * 10, id, p.id)));
  await bumpContentVersion(c.env);
  return ok(c, { items: await pictures(c, p.id) });
});

shopPictures.delete("/shop/products/:id/images/:imageId", requirePerm("shop:write"), async (c) => {
  const p = await requireProduct(c, intParam(c, "id"));
  const res = await run(c.env.DB, "DELETE FROM shop_images WHERE id = ? AND product_id = ?", intParam(c, "imageId"), p.id);
  if (!res.meta.changes) throw notFound();
  await bumpContentVersion(c.env);
  await audit(c, { action: "shop_products.picture_removed", entity: "shop_products", entityId: p.id, summary: p.name_en });
  return ok(c);
});

/* =================================================================================================================== orders */
export const shopOrdersAdmin = new Hono<AppEnv>();

shopOrdersAdmin.get("/shop/orders", requirePerm("shop:orders"), async (c) => {
  const q = c.req.query();
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (q.status && (SHOP_ORDER_STATUSES as readonly string[]).includes(q.status)) {
    where.push("status = ?");
    params.push(q.status);
  } else if (q.status === "open") where.push("status IN ('placed','paid','review','confirmed','shipped')");
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().slice(0, 60))}%`;
    where.push("(public_id LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const { page, per_page, offset } = pageParams(q);
  const [items, total, counts] = await Promise.all([
    all(c.env.DB, `SELECT id, public_id, status, payment, total, name, phone, place, created_at FROM shop_orders WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM shop_orders WHERE ${where.join(" AND ")}`, ...params),
    all<{ status: string; n: number }>(c.env.DB, "SELECT status, COUNT(*) AS n FROM shop_orders GROUP BY status"),
  ]);
  return ok(c, { items, page: pageInfo(page, per_page, total?.n ?? 0), counts: Object.fromEntries(counts.map((r) => [r.status, r.n])) });
});

shopOrdersAdmin.get("/shop/orders/:code", requirePerm("shop:orders"), async (c) => {
  const row = await shopOrderRow(c.env, c.req.param("code"));
  if (!row) throw notFound();
  return ok(c, { order: { ...(await shopOrderDTO(c.env, row)), id: row.id, staff_note: row.staff_note, gateway_txn: row.gateway_txn, next: SHOP_NEXT[row.status] } });
});

const STAMP: Partial<Record<ShopOrderStatus, string>> = { shipped: "shipped_at", delivered: "delivered_at", cancelled: "cancelled_at" };

/** Move an order one step: confirm, ship (with the courier's number), deliver, or cancel (the stock goes back). Only the allowed next steps. */
shopOrdersAdmin.post("/shop/orders/:code/status", requirePerm("shop:orders_write"), async (c) => {
  const body = await parseBody(c, z.object({ status: z.enum(SHOP_ORDER_STATUSES as [ShopOrderStatus, ...ShopOrderStatus[]]), courier_ref: textSchema(80).optional(), staff_note: textSchema(500).optional() }));
  const row = await shopOrderRow(c.env, c.req.param("code"));
  if (!row) throw notFound();
  if (!SHOP_NEXT[row.status].includes(body.status)) throw conflict("bad_step");
  const now = nowIso();
  const stamp = STAMP[body.status];
  // a cancelled order that was paid online is to be refunded by hand: it is marked so the money is not forgotten
  const status: ShopOrderStatus = body.status === "cancelled" && row.paid_at ? "refunded" : body.status;
  const res = await run(
    c.env.DB,
    `UPDATE shop_orders SET status = ?, courier_ref = COALESCE(?, courier_ref), staff_note = COALESCE(?, staff_note), ${stamp ? `${stamp} = ?, ` : ""}updated_at = ? WHERE id = ? AND status = ?`,
    status,
    body.courier_ref ?? null,
    body.staff_note ?? null,
    ...(stamp ? [now] : []),
    now,
    row.id,
    row.status,
  );
  if (!res.meta.changes) throw conflict("bad_step");
  if (body.status === "cancelled") await restockOrder(c.env, row.id);
  await audit(c, { action: `shop_orders.${status}`, entity: "shop_order", entityId: row.id, summary: row.public_id });
  const fresh = (await shopOrderRow(c.env, row.public_id))!;
  return ok(c, { order: { ...(await shopOrderDTO(c.env, fresh)), id: fresh.id, staff_note: fresh.staff_note, gateway_txn: fresh.gateway_txn, next: SHOP_NEXT[fresh.status] } });
});

/* ================================================================================================================== reviews */
export const shopReviewsAdmin = new Hono<AppEnv>();

shopReviewsAdmin.get("/shop/reviews", requirePerm("shop:read"), async (c) => {
  const status = c.req.query("status");
  const items = await all(
    c.env.DB,
    `SELECT r.id, r.name, r.rating, r.body, r.verified, r.status, r.created_at, p.name_en AS product_en, p.name_bn AS product_bn, p.slug AS product_slug
     FROM shop_reviews r JOIN shop_products p ON p.id = r.product_id
     ${status === "pending" || status === "approved" || status === "hidden" ? "WHERE r.status = ?" : ""} ORDER BY r.created_at DESC, r.id DESC LIMIT 200`,
    ...(status === "pending" || status === "approved" || status === "hidden" ? [status] : []),
  );
  return ok(c, { items });
});

shopReviewsAdmin.post("/shop/reviews/:id", requirePerm("shop:reviews"), async (c) => {
  const { status } = await parseBody(c, z.object({ status: z.enum(["approved", "hidden"]) }));
  const id = intParam(c, "id");
  const res = await run(c.env.DB, "UPDATE shop_reviews SET status = ? WHERE id = ?", status, id);
  if (!res.meta.changes) throw notFound();
  await bumpContentVersion(c.env);
  await audit(c, { action: `shop_reviews.${status}`, entity: "shop_review", entityId: id });
  return ok(c);
});
