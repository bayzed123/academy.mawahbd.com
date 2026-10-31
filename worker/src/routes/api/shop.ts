import { Hono } from "hono";
import { z } from "zod";
import { SHOP_MAX_LINES, SHOP_MAX_QTY, type ShopPayment } from "@mawah/shared";
import type { AppEnv } from "../../env";
import { audit } from "../../lib/audit";
import { first, run } from "../../lib/db";
import { HttpError, notFound, ok, parseBody, parseQuery } from "../../lib/http";
import { nameSchema, optionalEmailSchema, requiredPhoneSchema, textSchema, turnstileField } from "../../lib/schemas";
import { getSettings } from "../../lib/settings";
import { verifyTurnstile } from "../../lib/turnstile";
import { rateLimit } from "../../middleware/ratelimit";
import { geoChildren, geoPlace, type GeoLevel } from "../../services/geo";
import { notices, notifyOwner } from "../../services/notify";
import { clearCap, rememberCap, rememberSsl, sslInit } from "../../services/payments/sslcommerz";
import {
  closeShopOrder,
  createShopOrder,
  freeOffer,
  productReviews,
  quoteCart,
  relatedProducts,
  shopCategories,
  shopOrderDTO,
  shopOrderRow,
  shopProduct,
  shopProducts,
  storeOpen,
  type ShopSort,
} from "../../services/shop";
import { timingSafeEqual } from "../../lib/crypto";

/**
 * The tools shop for buyers: the catalogue, a cart priced by the Worker, an order with a delivery address anywhere in Bangladesh, paid
 * in cash on delivery or online with SSLCommerz. No account is needed: an order is opened with the link the buyer gets (its code and a key).
 */
export const shopRoutes = new Hono<AppEnv>();

const cache = (c: { header: (k: string, v: string) => void }, s = 60) => c.header("Cache-Control", `public, max-age=${s}, s-maxage=${s * 2}`);

/**
 * Whether the shop takes orders, what delivery costs, the free-delivery offer running today and the cash-on-delivery charge — for the
 * cart and the checkout.
 */
shopRoutes.get("/config", async (c) => {
  const s = (await getSettings(c.env)).store;
  return ok(c, {
    open: storeOpen(s, c.env),
    home_district: s.home_district,
    fee_home: s.fee_home,
    fee_other: s.fee_other,
    free: freeOffer(s),
    cod_charge: s.cod && s.cod_charge ? { pct: s.cod_pct, min: s.cod_min } : null,
    delivery_bn: s.delivery_bn,
    delivery_en: s.delivery_en,
  });
});

const listQuery = z.object({
  category: z.string().max(80).regex(/^[a-z0-9-]*$/).optional(),
  sort: z.enum(["featured", "popular", "rating", "new", "price_asc", "price_desc"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  ids: z
    .string()
    .max(400)
    .regex(/^\d+(,\d+)*$/)
    .optional(),
  q: z.string().trim().max(80).optional(),
});

shopRoutes.get("/categories", async (c) => {
  cache(c);
  return ok(c, { items: await shopCategories(c.env) });
});

shopRoutes.get("/products", async (c) => {
  const q = parseQuery(c, listQuery);
  cache(c);
  const ids = q.ids ? [...new Set(q.ids.split(",").map(Number))].slice(0, 60) : undefined;
  return ok(c, await shopProducts(c.env, { category: q.category || null, sort: q.sort as ShopSort | undefined, page: q.page, ids, q: q.q || undefined }));
});

shopRoutes.get("/products/:slug", async (c) => {
  const product = await shopProduct(c.env, c.req.param("slug"));
  if (!product) throw notFound();
  cache(c);
  const [reviews, related] = await Promise.all([productReviews(c.env, product.id), relatedProducts(c.env, product)]);
  return ok(c, { product, reviews, related });
});

/* -------------------------------------------------------------------------------------------------------- the address lists */

const PARENT_OF: Record<GeoLevel, string | null> = { divisions: null, districts: "division", upazilas: "district", unions: "upazila" };

shopRoutes.get("/geo/:level", (c) => {
  const level = c.req.param("level") as GeoLevel;
  if (!(level in PARENT_OF)) throw notFound();
  const key = PARENT_OF[level];
  // every district at once (Admin → Shop → Settings picks the shop's own one) — the other levels always need their parent
  const all = level === "districts" && c.req.query("division") === undefined;
  const parent = key && !all ? Number(c.req.query(key)) : 0;
  if (key && !all && !(Number.isInteger(parent) && parent > 0)) throw new HttpError(422, "validation", "validation", { [key]: "required" });
  // the lists never change between deploys
  c.header("Cache-Control", "public, max-age=86400, s-maxage=86400");
  return ok(c, { items: all ? geoChildren("districts", -1) : geoChildren(level, parent) });
});

/* --------------------------------------------------------------------------------------------------------------- the cart */

const cartSchema = z
  .array(z.object({ variant_id: z.number().int().positive(), qty: z.number().int().min(1).max(SHOP_MAX_QTY) }))
  .max(SHOP_MAX_LINES);

shopRoutes.post("/quote", async (c) => {
  const body = await parseBody(c, z.object({ items: cartSchema, district_id: z.number().int().positive().nullish() }));
  const { rows: _rows, ...quote } = await quoteCart(c.env, body.items, body.district_id ?? null);
  return ok(c, { quote });
});

/* ------------------------------------------------------------------------------------------------------------- the order */

const orderSchema = z.object({
  items: cartSchema.min(1, "required"),
  name: nameSchema,
  phone: requiredPhoneSchema,
  email: optionalEmailSchema,
  division_id: z.number({ error: "required" }).int().positive(),
  district_id: z.number({ error: "required" }).int().positive(),
  // 0 = the district's town or city area
  upazila_id: z.number().int().min(0).default(0),
  union_id: z.number().int().min(0).default(0),
  address: textSchema(300, 5),
  note: textSchema(300).default(""),
  payment: z.enum(["cod", "sslcommerz"]),
  agree: z.literal(true, { error: "required" }),
  turnstile: turnstileField,
});

shopRoutes.post("/orders", rateLimit("RL_FORM"), async (c) => {
  const body = await parseBody(c, orderSchema);
  if (!(await verifyTurnstile(c.env, body.turnstile, c.get("ip")))) throw new HttpError(400, "captcha");
  const settings = (await getSettings(c.env)).store;
  if (!storeOpen(settings, c.env)) throw new HttpError(409, "shop_closed");
  const place = geoPlace(body);
  if (!place) throw new HttpError(422, "validation", "validation", { district_id: "invalid" });
  const quote = await quoteCart(c.env, body.items, body.district_id);
  // the buyer must see the cart as it really is before paying for it: anything gone or cut down sends them back to it
  if (!quote.lines.length || quote.gone.length || quote.lines.some((l) => l.limited)) throw new HttpError(409, "cart_changed");
  if (!quote.payments.includes(body.payment as ShopPayment)) throw new HttpError(422, "validation", "validation", { payment: "invalid" });

  const order = await createShopOrder(c.env, quote, {
    name: body.name,
    phone: body.phone,
    email: body.email ?? "",
    division_id: body.division_id,
    district_id: body.district_id,
    upazila_id: body.upazila_id,
    union_id: body.union_id,
    place: place.en,
    address: body.address,
    note: body.note,
    payment: body.payment,
  });
  if (!order) throw new HttpError(409, "cart_changed");
  // what the buyer pays: paying on delivery adds its charge, an online payment does not
  const total = quote.subtotal + (quote.delivery_fee ?? 0) + (body.payment === "cod" ? (quote.cod_fee ?? 0) : 0);
  await audit(c, { action: "shop.order_placed", entity: "shop_order", entityId: order.id, summary: `${order.public_id} · ${body.payment}` });
  const link = `/app/shop/orders/${order.public_id}?k=${order.access_key}`;
  const notice = notices.shopOrder({ code: order.public_id, name: body.name, phone: body.phone, total, payment: body.payment, place: `${body.address}, ${place.en}`, items: quote.lines.map((l) => ({ name: `${l.name_en}${l.label_en ? ` (${l.label_en})` : ""}`, qty: l.qty })) });

  if (body.payment === "cod") {
    c.executionCtx.waitUntil(notifyOwner(c.env, notice));
    return ok(c, { order: { public_id: order.public_id, total, status: "placed" }, link }, 201);
  }

  // online: SSLCommerz opens the payment; the owner hears of the order once it is paid (routes/api/payments.ts)
  const district = place.en.split(", ").at(-2) ?? "";
  const r = await sslInit(
    c.env,
    { public_id: order.public_id, total },
    { name: body.name, email: body.email || c.env.NOTIFY_EMAIL?.trim() || "customer@mawahacademy.com", phone: body.phone, address: body.address },
    quote.lines.map((l) => l.name_en).join(", ").slice(0, 200),
    { items: quote.lines.reduce((n, l) => n + l.qty, 0), city: district },
  );
  await rememberSsl(c.env, r, "checkout");
  if (!r.ok) {
    await closeShopOrder(c.env, order.id, "failed");
    await audit(c, { action: "shop.gateway_failed", entity: "shop_order", entityId: order.id, summary: `sslcommerz: ${r.problem}`, meta: { problem: r.problem, status: r.status ?? null, said: r.detail } });
    c.executionCtx.waitUntil(notifyOwner(c.env, notices.paymentFailed({ student: body.name, phone: body.phone, items: quote.lines.map((l) => l.name_en), total, problem: r.problem, said: r.detail })));
    // SSLCommerz's own limit on how much one payment may be: said as such (only SSLCommerz can lift it), remembered like the class checkout's
    if (r.problem === "amount_limit") {
      await rememberCap(c.env, total, r.detail);
      throw new HttpError(502, "gateway_amount_limit");
    }
    throw new HttpError(502, "gateway_error");
  }
  c.executionCtx.waitUntil(clearCap(c.env, total));
  // SSLCommerz's own payment page (GatewayPageURL): the buyer chooses bKash, Nagad, Rocket, a card … there
  return ok(c, { order: { public_id: order.public_id, total, status: "pending" }, link, redirect_url: r.redirectUrl }, 201);
});

/** The buyer's own order, opened with the key in their link. */
shopRoutes.get("/orders/:id", async (c) => {
  const row = await shopOrderRow(c.env, c.req.param("id"));
  const key = c.req.query("k") ?? "";
  if (!row || !key || !timingSafeEqual(key, row.access_key)) throw notFound();
  c.header("Cache-Control", "no-store");
  return ok(c, { order: await shopOrderDTO(c.env, row) });
});

/* ----------------------------------------------------------------------------------------------------------------- reviews */

const reviewSchema = z.object({
  name: nameSchema,
  phone: requiredPhoneSchema,
  // a form on the product page sends it as text
  rating: z.coerce.number().int().min(1).max(5),
  body: textSchema(1500, 3),
  turnstile: turnstileField,
});

/** Anyone may write a review; it shows once staff approve it. A phone that received this product marks it as a verified buyer's. */
shopRoutes.post("/products/:slug/reviews", rateLimit("RL_FORM"), async (c) => {
  const body = await parseBody(c, reviewSchema);
  if (!(await verifyTurnstile(c.env, body.turnstile, c.get("ip")))) throw new HttpError(400, "captcha");
  const product = await first<{ id: number; name_en: string }>(c.env.DB, "SELECT id, name_en FROM shop_products WHERE slug = ? AND status = 'published'", c.req.param("slug"));
  if (!product) throw notFound();
  const bought = await first<{ n: number }>(
    c.env.DB,
    "SELECT COUNT(*) AS n FROM shop_orders o JOIN shop_order_items i ON i.order_id = o.id WHERE o.phone = ? AND o.status = 'delivered' AND i.product_id = ?",
    body.phone,
    product.id,
  );
  await run(c.env.DB, "INSERT INTO shop_reviews (product_id, name, phone, rating, body, verified) VALUES (?, ?, ?, ?, ?, ?)", product.id, body.name, body.phone, body.rating, body.body, bought?.n ? 1 : 0);
  c.executionCtx.waitUntil(notifyOwner(c.env, notices.shopReview({ product: product.name_en, name: body.name, rating: body.rating, body: body.body })));
  return ok(c, { status: "pending" }, 201);
});
