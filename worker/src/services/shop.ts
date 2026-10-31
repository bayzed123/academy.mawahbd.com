import {
  codCharge,
  SHOP_MAX_QTY,
  SHOP_PER_PAGE,
  type ShopCardDTO,
  type ShopCartLine,
  type ShopCategoryDTO,
  type ShopFreeOffer,
  type ShopOrderDTO,
  type ShopOrderStatus,
  type ShopPayment,
  type ShopProductDTO,
  type ShopQuoteDTO,
  type ShopReviewDTO,
  type ShopVariantDTO,
} from "@mawah/shared";
import type { Env } from "../env";
import { CROCKFORD, randomString, randomToken } from "../lib/crypto";
import { all, first, nowIso, qs, run } from "../lib/db";
import { getSettings, type Settings } from "../lib/settings";
import { dhakaToday } from "./banners";
import { sslConfigured } from "./payments/sslcommerz";

/**
 * The tools shop: products sold by weight or size, a cart the browser keeps (only variant ids and quantities — every price is the
 * Worker's, read again for each quote and for the order), delivery anywhere in Bangladesh, cash on delivery or SSLCommerz.
 */

export type ShopSort = "featured" | "popular" | "rating" | "new" | "price_asc" | "price_desc";
export const SHOP_SORTS: ShopSort[] = ["featured", "popular", "rating", "new", "price_asc", "price_desc"];

const media = (key: string | null | undefined) => (key ? `/media/${key}` : null);

interface CardRow {
  id: number;
  slug: string;
  name_bn: string;
  name_en: string;
  short_bn: string;
  short_en: string;
  category_slug: string | null;
  image_key: string | null;
  thumb_key: string | null;
  price: number;
  list_price: number;
  variants: number;
  one_variant: number | null;
  in_stock: number;
  rating: number | null;
  reviews: number;
}

/*
 * One row per published product that has something for sale: the cheapest active weight's price (and its usual price), how many weights
 * there are, whether any is in stock, the first picture and the approved reviews' average.
 */
const CARD_SQL = `
  SELECT p.id, p.slug, p.name_bn, p.name_en, p.short_bn, p.short_en, c.slug AS category_slug,
         (SELECT image_key FROM shop_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_key,
         (SELECT thumb_key FROM shop_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS thumb_key,
         v.price, v.list_price, v.variants, v.one_variant, v.in_stock,
         (SELECT ROUND(AVG(rating), 1) FROM shop_reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating,
         (SELECT COUNT(*) FROM shop_reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS reviews
  FROM shop_products p
  LEFT JOIN shop_categories c ON c.id = p.category_id
  JOIN (
    SELECT product_id,
           MIN(price) AS price,
           (SELECT list_price FROM shop_variants x WHERE x.product_id = sv.product_id AND x.active = 1 ORDER BY x.price, x.sort, x.id LIMIT 1) AS list_price,
           COUNT(*) AS variants,
           CASE WHEN COUNT(*) = 1 THEN MIN(id) END AS one_variant,
           MAX(CASE WHEN stock IS NULL OR stock > 0 THEN 1 ELSE 0 END) AS in_stock
    FROM shop_variants sv WHERE active = 1 GROUP BY product_id
  ) v ON v.product_id = p.id
  WHERE p.status = 'published' AND (c.id IS NULL OR c.active = 1)`;

const toCard = (r: CardRow): ShopCardDTO => ({
  id: r.id,
  slug: r.slug,
  name_bn: r.name_bn,
  name_en: r.name_en,
  short_bn: r.short_bn,
  short_en: r.short_en,
  category_slug: r.category_slug,
  image: media(r.thumb_key ?? r.image_key),
  price: r.price,
  list_price: r.list_price > r.price ? r.list_price : 0,
  several: r.variants > 1,
  variant_id: r.variants === 1 ? r.one_variant : null,
  in_stock: !!r.in_stock,
  rating: r.reviews ? r.rating : null,
  reviews: r.reviews,
});

// "popular": how many were ordered (orders not cancelled, failed or refunded); "rating": the approved reviews' average, then how many
const SOLD = `(SELECT COALESCE(SUM(i.qty), 0) FROM shop_order_items i JOIN shop_orders o ON o.id = i.order_id
               WHERE i.product_id = p.id AND o.status IN ('placed','paid','review','confirmed','shipped','delivered'))`;
const ORDER_BY: Record<ShopSort, string> = {
  featured: "p.featured DESC, p.sort, p.id DESC",
  popular: `${SOLD} DESC, p.featured DESC, p.sort, p.id DESC`,
  rating: "COALESCE(rating, 0) DESC, reviews DESC, p.featured DESC, p.sort, p.id DESC",
  new: "COALESCE(p.published_at, p.created_at) DESC, p.id DESC",
  price_asc: "v.price, p.id",
  price_desc: "v.price DESC, p.id",
};

export async function shopCategories(env: Env): Promise<ShopCategoryDTO[]> {
  return all<ShopCategoryDTO>(
    env.DB,
    `SELECT c.id, c.slug, c.name_bn, c.name_en,
            (SELECT COUNT(*) FROM shop_products p WHERE p.category_id = c.id AND p.status = 'published'
               AND EXISTS (SELECT 1 FROM shop_variants v WHERE v.product_id = p.id AND v.active = 1)) AS count
     FROM shop_categories c WHERE c.active = 1 ORDER BY c.sort, c.name_en`,
  );
}

export async function shopProducts(
  env: Env,
  opts: { category?: string | null; sort?: ShopSort; page?: number; perPage?: number; ids?: number[]; q?: string; min?: number; max?: number; inStock?: boolean },
): Promise<{ items: ShopCardDTO[]; total: number; page: number; pages: number }> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.category) {
    where.push("c.slug = ?");
    params.push(opts.category);
  }
  if (opts.ids) {
    if (!opts.ids.length) return { items: [], total: 0, page: 1, pages: 1 };
    where.push(`p.id IN (${qs(opts.ids.length)})`);
    params.push(...opts.ids);
  }
  if (opts.q) {
    where.push("(p.name_en LIKE ? ESCAPE '\\' OR p.name_bn LIKE ? ESCAPE '\\')");
    const like = `%${opts.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like);
  }
  // the price filter reads the price the grid shows (the cheapest weight's)
  if (opts.min) {
    where.push("v.price >= ?");
    params.push(opts.min);
  }
  if (opts.max) {
    where.push("v.price <= ?");
    params.push(opts.max);
  }
  if (opts.inStock) where.push("v.in_stock = 1");
  const base = `${CARD_SQL}${where.length ? ` AND ${where.join(" AND ")}` : ""}`;
  const perPage = opts.perPage ?? SHOP_PER_PAGE;
  const total = (await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM (${base})`, ...params))?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const rows = await all<CardRow>(env.DB, `${base} ORDER BY ${ORDER_BY[opts.sort ?? "featured"]} LIMIT ? OFFSET ?`, ...params, perPage, (page - 1) * perPage);
  return { items: rows.map(toCard), total, page, pages };
}

interface VariantRow {
  id: number;
  product_id: number;
  label_bn: string;
  label_en: string;
  price: number;
  list_price: number;
  stock: number | null;
}

const toVariant = (v: VariantRow): ShopVariantDTO => ({
  id: v.id,
  label_bn: v.label_bn,
  label_en: v.label_en,
  price: v.price,
  list_price: v.list_price > v.price ? v.list_price : 0,
  stock: v.stock,
  in_stock: v.stock === null || v.stock > 0,
});

/** A published product with its weights, pictures and description; null when there is no such product on sale. */
export async function shopProduct(env: Env, slug: string): Promise<ShopProductDTO | null> {
  const row = await first<CardRow & { body_bn: string; body_en: string; category_id: number | null; cat_name_bn: string | null; cat_name_en: string | null }>(
    env.DB,
    `SELECT q.*, p.body_bn, p.body_en, p.category_id, c.name_bn AS cat_name_bn, c.name_en AS cat_name_en
     FROM (${CARD_SQL} AND p.slug = ?) q JOIN shop_products p ON p.id = q.id LEFT JOIN shop_categories c ON c.id = p.category_id`,
    slug,
  );
  if (!row) return null;
  const [variants, images] = await Promise.all([
    all<VariantRow>(env.DB, "SELECT id, product_id, label_bn, label_en, price, list_price, stock FROM shop_variants WHERE product_id = ? AND active = 1 ORDER BY sort, price, id", row.id),
    all<{ image_key: string; thumb_key: string | null }>(env.DB, "SELECT image_key, thumb_key FROM shop_images WHERE product_id = ? ORDER BY sort, id", row.id),
  ]);
  return {
    ...toCard(row),
    body_bn: row.body_bn,
    body_en: row.body_en,
    category: row.category_slug ? { slug: row.category_slug, name_bn: row.cat_name_bn ?? "", name_en: row.cat_name_en ?? "" } : null,
    images: images.map((i) => ({ large: `/media/${i.image_key}`, small: `/media/${i.thumb_key ?? i.image_key}` })),
    variants: variants.map(toVariant),
  };
}

/** Other products of the same category (then any), best first: "You may also like". */
export async function relatedProducts(env: Env, product: { id: number; category_slug: string | null }, limit = 4): Promise<ShopCardDTO[]> {
  const rows = await all<CardRow>(
    env.DB,
    `${CARD_SQL} AND p.id != ? ORDER BY CASE WHEN c.slug IS ? THEN 0 ELSE 1 END, p.featured DESC, p.sort, p.id DESC LIMIT ?`,
    product.id,
    product.category_slug,
    limit,
  );
  return rows.map(toCard);
}

export async function productReviews(env: Env, productId: number, limit = 30): Promise<ShopReviewDTO[]> {
  const rows = await all<{ id: number; name: string; rating: number; body: string; verified: number; created_at: string }>(
    env.DB,
    "SELECT id, name, rating, body, verified, created_at FROM shop_reviews WHERE product_id = ? AND status = 'approved' ORDER BY created_at DESC, id DESC LIMIT ?",
    productId,
    limit,
  );
  return rows.map((r) => ({ ...r, verified: !!r.verified }));
}

/* ------------------------------------------------------------------------------------------------------------- delivery and pay */

export type StoreSettings = Settings["store"];

/** The shop takes orders: switched on, with delivery charges set (or free delivery for every order chosen) and a way to pay. */
export function storeOpen(s: StoreSettings, env: Env): boolean {
  return s.enabled && deliverySet(s) && storePayments(s, env).length > 0;
}

/** Every order has a delivery price: the charges are set, or delivery is free for every order with no last day. */
export const deliverySet = (s: StoreSettings) => (s.free_delivery && s.free_over === 0 && !s.free_until) || (s.fee_home > 0 && s.fee_other > 0);

/** The free-delivery offer running on `today` (a Bangladesh calendar day, YYYY-MM-DD): switched on and not past its last day; else null. */
export function freeOffer(s: StoreSettings, today: string = dhakaToday()): ShopFreeOffer | null {
  if (!s.free_delivery || (s.free_until && today > s.free_until)) return null;
  return { from: s.free_over, until: s.free_until };
}

/** The ways a buyer can pay, in the order the checkout lists them (the first is chosen): cash on delivery, then SSLCommerz online. */
export function storePayments(s: StoreSettings, env: Env): ShopPayment[] {
  const out: ShopPayment[] = [];
  if (s.cod) out.push("cod");
  if (s.online && sslConfigured(env)) out.push("sslcommerz");
  return out;
}

/** What delivery to `districtId` costs for an order of `subtotal`. */
export function deliveryFee(s: StoreSettings, districtId: number, subtotal: number, today: string = dhakaToday()): number {
  const offer = freeOffer(s, today);
  if (offer && subtotal >= offer.from) return 0;
  return districtId === s.home_district ? s.fee_home : s.fee_other;
}

/** What paying on delivery adds to an order whose courier collects `amount` (the goods and the delivery): nothing unless switched on. */
export function codFee(s: StoreSettings, amount: number): number {
  return s.cod && s.cod_charge ? codCharge(amount, s.cod_pct, s.cod_min) : 0;
}

/* ----------------------------------------------------------------------------------------------------------------------- cart */

interface LineRow {
  variant_id: number;
  product_id: number;
  product_slug: string;
  name_bn: string;
  name_en: string;
  label_bn: string;
  label_en: string;
  price: number;
  list_price: number;
  stock: number | null;
  image_key: string | null;
  thumb_key: string | null;
}

/** Price a cart from the database: unknown, hidden or sold-out lines are named in `gone`; a line wanting more than is left gets what is left. */
export async function quoteCart(env: Env, cart: ShopCartLine[], districtId: number | null): Promise<ShopQuoteDTO & { rows: LineRow[] }> {
  const settings = (await getSettings(env)).store;
  // the same weight twice in one cart counts as one line
  const wanted = new Map<number, number>();
  for (const l of cart) wanted.set(l.variant_id, Math.min(SHOP_MAX_QTY, (wanted.get(l.variant_id) ?? 0) + l.qty));
  const ids = [...wanted.keys()];
  const rows = ids.length
    ? await all<LineRow>(
        env.DB,
        `SELECT v.id AS variant_id, p.id AS product_id, p.slug AS product_slug, p.name_bn, p.name_en, v.label_bn, v.label_en, v.price, v.list_price, v.stock,
                (SELECT image_key FROM shop_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_key,
                (SELECT thumb_key FROM shop_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS thumb_key
         FROM shop_variants v JOIN shop_products p ON p.id = v.product_id LEFT JOIN shop_categories c ON c.id = p.category_id
         WHERE v.id IN (${qs(ids.length)}) AND v.active = 1 AND p.status = 'published' AND (c.id IS NULL OR c.active = 1)`,
        ...ids,
      )
    : [];
  const byId = new Map(rows.map((r) => [r.variant_id, r]));
  const lines: ShopQuoteDTO["lines"] = [];
  const gone: number[] = [];
  const kept: LineRow[] = [];
  for (const [id, qty] of wanted) {
    const r = byId.get(id);
    const left = r ? (r.stock === null ? SHOP_MAX_QTY : Math.min(SHOP_MAX_QTY, r.stock)) : 0;
    if (!r || left <= 0) {
      gone.push(id);
      continue;
    }
    const take = Math.min(qty, left);
    kept.push(r);
    lines.push({
      variant_id: id,
      product_slug: r.product_slug,
      name_bn: r.name_bn,
      name_en: r.name_en,
      label_bn: r.label_bn,
      label_en: r.label_en,
      image: media(r.thumb_key ?? r.image_key),
      price: r.price,
      list_price: r.list_price > r.price ? r.list_price : 0,
      qty: take,
      limited: take < qty,
    });
  }
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const today = dhakaToday();
  const fee = districtId && lines.length ? deliveryFee(settings, districtId, subtotal, today) : null;
  const payments = storePayments(settings, env);
  return {
    lines,
    gone,
    subtotal,
    delivery_fee: fee,
    cod_fee: fee === null ? null : payments.includes("cod") ? codFee(settings, subtotal + fee) : 0,
    total: subtotal + (fee ?? 0),
    payments,
    free: freeOffer(settings, today),
    rows: kept,
  };
}

/* --------------------------------------------------------------------------------------------------------------------- orders */

/** "SH" and ten letters or digits that are easy to read out on the phone: the order code, and SSLCommerz's tran_id. */
export const newShopOrderId = () => `SH${randomString(10, CROCKFORD)}`;
export const isShopOrderId = (id: string) => /^SH[0-9A-HJKMNP-TV-Z]{10}$/.test(id);

export interface PlaceInput {
  name: string;
  phone: string;
  email: string;
  division_id: number;
  district_id: number;
  upazila_id: number;
  union_id: number;
  place: string;
  address: string;
  note: string;
  payment: ShopPayment;
}

/**
 * Store the order with today's prices. Stock is taken off at once (so two buyers cannot both get the last one) and given back when an
 * order is cancelled or its online payment fails. Returns null when the cart changed since it was priced (a weight sold out meanwhile).
 */
export async function createShopOrder(env: Env, quote: Awaited<ReturnType<typeof quoteCart>>, input: PlaceInput): Promise<{ id: number; public_id: string; access_key: string } | null> {
  const publicId = newShopOrderId();
  const accessKey = randomToken(18);
  const now = nowIso();
  const status: ShopOrderStatus = input.payment === "cod" ? "placed" : "pending";
  const fee = quote.delivery_fee ?? 0;
  const cod = input.payment === "cod" ? (quote.cod_fee ?? 0) : 0;
  const res = await run(
    env.DB,
    `INSERT INTO shop_orders (public_id, access_key, status, payment, subtotal, delivery_fee, cod_fee, total, name, phone, email, division_id, district_id,
                              upazila_id, union_id, place, address, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    publicId,
    accessKey,
    status,
    input.payment,
    quote.subtotal,
    fee,
    cod,
    quote.subtotal + fee + cod,
    input.name,
    input.phone,
    input.email,
    input.division_id,
    input.district_id,
    input.upazila_id,
    input.union_id,
    input.place,
    input.address,
    input.note,
    now,
    now,
  );
  const orderId = res.meta.last_row_id as number;
  const byVariant = new Map(quote.rows.map((r) => [r.variant_id, r]));
  const stmts: D1PreparedStatement[] = [];
  // which statement takes which line's stock off (only weights whose stock is counted)
  const takes: { at: number; variant_id: number; qty: number }[] = [];
  for (const l of quote.lines) {
    const r = byVariant.get(l.variant_id)!;
    stmts.push(
      env.DB.prepare("INSERT INTO shop_order_items (order_id, product_id, variant_id, name_en, name_bn, label_en, label_bn, price, qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
        orderId,
        r.product_id,
        l.variant_id,
        l.name_en,
        l.name_bn,
        l.label_en,
        l.label_bn,
        l.price,
        l.qty,
      ),
    );
    if (r.stock !== null) {
      takes.push({ at: stmts.length, variant_id: l.variant_id, qty: l.qty });
      stmts.push(env.DB.prepare("UPDATE shop_variants SET stock = stock - ? WHERE id = ? AND stock >= ?").bind(l.qty, l.variant_id, l.qty));
    }
  }
  let out: D1Result[];
  try {
    out = await env.DB.batch(stmts);
  } catch (e) {
    // the lines could not be stored (the batch is all or nothing): no order without its lines is left behind
    await run(env.DB, "DELETE FROM shop_orders WHERE id = ?", orderId);
    throw e;
  }
  // a stock update that changed nothing: someone else took the last ones between the quote and now — the order is undone
  const taken = takes.filter((t) => !!out[t.at]?.meta.changes);
  if (taken.length < takes.length) {
    await giveBackStock(env, taken);
    await env.DB.batch([env.DB.prepare("DELETE FROM shop_order_items WHERE order_id = ?").bind(orderId), env.DB.prepare("DELETE FROM shop_orders WHERE id = ?").bind(orderId)]);
    return null;
  }
  return { id: orderId, public_id: publicId, access_key: accessKey };
}

async function giveBackStock(env: Env, lines: { variant_id: number; qty: number }[]) {
  if (!lines.length) return;
  await env.DB.batch(lines.map((l) => env.DB.prepare("UPDATE shop_variants SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL").bind(l.qty, l.variant_id)));
}

/** Put an order's quantities back on the shelf (it was cancelled, or its online payment did not happen). */
export async function restockOrder(env: Env, orderId: number): Promise<void> {
  const items = await all<{ variant_id: number | null; qty: number }>(env.DB, "SELECT variant_id, qty FROM shop_order_items WHERE order_id = ?", orderId);
  await giveBackStock(env, items.filter((i): i is { variant_id: number; qty: number } => i.variant_id !== null));
}

interface OrderRow {
  id: number;
  public_id: string;
  access_key: string;
  status: ShopOrderStatus;
  payment: ShopPayment;
  subtotal: number;
  delivery_fee: number;
  cod_fee: number;
  total: number;
  name: string;
  phone: string;
  email: string;
  place: string;
  address: string;
  note: string;
  courier_ref: string;
  staff_note: string;
  gateway_txn: string | null;
  created_at: string;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
}

export async function shopOrderRow(env: Env, publicId: string): Promise<OrderRow | null> {
  return first<OrderRow>(env.DB, "SELECT * FROM shop_orders WHERE public_id = ?", publicId);
}

export async function shopOrderDTO(env: Env, row: OrderRow): Promise<ShopOrderDTO> {
  const items = await all<{ product_slug: string | null; name_bn: string; name_en: string; label_bn: string; label_en: string; price: number; qty: number }>(
    env.DB,
    "SELECT p.slug AS product_slug, i.name_bn, i.name_en, i.label_bn, i.label_en, i.price, i.qty FROM shop_order_items i LEFT JOIN shop_products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id",
    row.id,
  );
  return {
    public_id: row.public_id,
    status: row.status,
    payment: row.payment,
    subtotal: row.subtotal,
    delivery_fee: row.delivery_fee,
    cod_fee: row.cod_fee,
    total: row.total,
    name: row.name,
    phone: row.phone,
    email: row.email,
    place: row.place,
    address: row.address,
    note: row.note,
    courier_ref: row.courier_ref,
    created_at: row.created_at,
    paid_at: row.paid_at,
    shipped_at: row.shipped_at,
    delivered_at: row.delivered_at,
    cancelled_at: row.cancelled_at,
    items,
  };
}

/** The online payment went through (SSLCommerz said so and the amount matched): pending → paid, once. */
export async function markShopPaid(env: Env, orderId: number, txn: string): Promise<boolean> {
  const now = nowIso();
  const res = await run(env.DB, "UPDATE shop_orders SET status = 'paid', gateway_txn = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'", txn, now, now, orderId);
  return !!res.meta.changes;
}

/** Online orders never paid (the buyer left SSLCommerz's page) and older than `before`: cancelled, their stock given back. */
export async function expireShopOrders(env: Env, before: Date): Promise<number> {
  const rows = await all<{ id: number }>(env.DB, "SELECT id FROM shop_orders WHERE status = 'pending' AND created_at < ? LIMIT 200", nowIso(before));
  for (const r of rows) await closeShopOrder(env, r.id, "cancelled");
  return rows.length;
}

/**
 * SSLCommerz says an order that was already closed (failed, cancelled, or expired) has been paid after all: it goes to staff (review) to check
 * the stock and the payment — the money must not be forgotten.
 */
export async function lateShopPayment(env: Env, orderId: number, txn: string): Promise<boolean> {
  const now = nowIso();
  const res = await run(
    env.DB,
    "UPDATE shop_orders SET status = 'review', gateway_txn = ?, paid_at = ?, staff_note = ?, updated_at = ? WHERE id = ? AND status IN ('failed','cancelled')",
    txn,
    now,
    "Paid after the order was closed: check the stock before confirming",
    now,
    orderId,
  );
  return !!res.meta.changes;
}

/** SSLCommerz took the money but marked the payment risky (risk_level 1): pending → review, for staff to check before packing. */
export async function holdShopPayment(env: Env, orderId: number, txn: string): Promise<boolean> {
  const now = nowIso();
  const res = await run(env.DB, "UPDATE shop_orders SET status = 'review', gateway_txn = ?, paid_at = ?, staff_note = ?, updated_at = ? WHERE id = ? AND status = 'pending'", txn, now, "SSLCommerz marked this payment as risky", now, orderId);
  return !!res.meta.changes;
}

/** The online payment did not happen (failed or cancelled at SSLCommerz): pending → failed / cancelled, and the stock goes back. */
export async function closeShopOrder(env: Env, orderId: number, status: "failed" | "cancelled"): Promise<boolean> {
  const now = nowIso();
  const res = await run(env.DB, `UPDATE shop_orders SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`, status, now, now, orderId);
  if (res.meta.changes) await restockOrder(env, orderId);
  return !!res.meta.changes;
}
