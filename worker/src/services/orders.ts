import type { Channel, OrderDTO, OrderItemDTO, OrderStatus, PaymentMethod } from "@mawah/shared";
import { dhakaDayStamp, formatMoney, loc, MANUAL_WINDOW_DEFAULT_MIN, MAX_PROOF_IMAGE_BYTES } from "@mawah/shared";
import type { Env, StudentCtx } from "../env";
import { auditAs } from "../lib/audit";
import { generatePublicOrderId, randomToken, sha256Hex } from "../lib/crypto";
import { all, first, nowIso, qs, run } from "../lib/db";
import { sniffImage } from "../lib/files";
import { conflict, HttpError, notFound } from "../lib/http";
import { orderReceiptMail, sendMail } from "../lib/mailer";
import { notices, notifyOwner } from "./notify";

/* =================================================================================================
 *  Pricing  (server-side, always — the browser never tells us a price)
 * ============================================================================================== */
export interface QuoteInput {
  studentId: number;
  courseSlugs?: string[];
  bundleId?: number;
  coupon?: string;
}

export interface Quote {
  items: OrderItemDTO[];
  subtotal: number;
  discount: number;
  total: number;
  coupon: { id: number; code: string } | null;
  bundle_id: number | null;
}

interface CourseLite {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  price: number;
  status: string;
}

interface CouponRow {
  id: number;
  code: string;
  type: "percent" | "flat";
  value: number;
  min_order: number;
  max_discount: number | null;
  starts_at: string | null;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  per_student_limit: number;
  active: number;
}

const MAX_ITEMS = 12;

async function resolveCourses(env: Env, input: QuoteInput): Promise<{ courses: CourseLite[]; bundlePrice: number | null; bundleId: number | null }> {
  if (input.bundleId) {
    const bundle = await first<{ id: number; price: number }>(
      env.DB,
      "SELECT id, price FROM bundles WHERE id = ? AND status = 'published' AND deleted_at IS NULL",
      input.bundleId,
    );
    if (!bundle) throw new HttpError(422, "course_unavailable");
    const courses = await all<CourseLite>(
      env.DB,
      `SELECT c.id, c.slug, c.title_bn, c.title_en, c.price, c.status FROM bundle_items bi
       JOIN courses c ON c.id = bi.course_id WHERE bi.bundle_id = ? AND c.deleted_at IS NULL ORDER BY c.id`,
      bundle.id,
    );
    if (courses.length === 0 || courses.some((c) => c.status !== "published")) throw new HttpError(422, "course_unavailable");
    return { courses, bundlePrice: bundle.price, bundleId: bundle.id };
  }
  const slugs = [...new Set((input.courseSlugs ?? []).map((s) => s.trim()).filter(Boolean))].slice(0, MAX_ITEMS);
  if (slugs.length === 0) throw new HttpError(422, "course_unavailable");
  const courses = await all<CourseLite>(
    env.DB,
    `SELECT id, slug, title_bn, title_en, price, status FROM courses WHERE slug IN (${qs(slugs.length)}) AND deleted_at IS NULL`,
    ...slugs,
  );
  if (courses.length !== slugs.length || courses.some((c) => c.status !== "published")) throw new HttpError(422, "course_unavailable");
  return { courses, bundlePrice: null, bundleId: null };
}

/** Split `amount` across weights with no rounding loss (remainder goes to the last item). */
export function allocate(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((amount * w) / sum));
  const rest = amount - out.reduce((a, b) => a + b, 0);
  out[out.length - 1] += rest;
  return out;
}

export async function buildQuote(env: Env, input: QuoteInput): Promise<Quote> {
  const { courses, bundlePrice, bundleId } = await resolveCourses(env, input);

  const owned = await all<{ course_id: number }>(
    env.DB,
    `SELECT course_id FROM enrollments WHERE student_id = ? AND status = 'active' AND course_id IN (${qs(courses.length)})`,
    input.studentId,
    ...courses.map((c) => c.id),
  );
  if (owned.length) throw conflict("already_enrolled", { course_ids: owned.map((o) => o.course_id).join(",") });

  // price per item before any coupon: the list price, or the bundle price spread across its classes
  const base = bundlePrice !== null ? allocate(bundlePrice, courses.map((c) => c.price)) : courses.map((c) => c.price);
  const subtotal = base.reduce((a, b) => a + b, 0);
  const net = [...base];
  let discount = 0;
  let coupon: Quote["coupon"] = null;

  if (input.coupon?.trim()) {
    const applied = await applyCoupon(env, input.studentId, input.coupon, courses, base);
    discount = applied.discount;
    coupon = { id: applied.id, code: applied.code };
    // spread the discount over the classes it applies to, so per-class revenue stays accurate
    const eligibleIdx = applied.eligible;
    const shares = allocate(discount, eligibleIdx.map((i) => base[i]));
    eligibleIdx.forEach((i, k) => (net[i] = base[i] - shares[k]));
  }

  const items: OrderItemDTO[] = courses.map((c, i) => ({
    course_id: c.id,
    title_bn: c.title_bn,
    title_en: c.title_en,
    list_price: c.price,
    price: net[i],
  }));
  return { items, subtotal, discount, total: subtotal - discount, coupon, bundle_id: bundleId };
}

async function applyCoupon(env: Env, studentId: number, code: string, courses: CourseLite[], base: number[]) {
  const c = await first<CouponRow>(env.DB, "SELECT * FROM coupons WHERE code = ? AND deleted_at IS NULL", code.trim().slice(0, 40));
  if (!c || !c.active) throw new HttpError(422, "invalid_coupon");
  const now = Date.now();
  if (c.starts_at && Date.parse(c.starts_at) > now) throw new HttpError(422, "invalid_coupon");
  if (c.expires_at && Date.parse(c.expires_at) < now) throw new HttpError(422, "coupon_expired");
  if (c.max_uses !== null && c.used_count >= c.max_uses) throw new HttpError(422, "coupon_used");

  const used = await first<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM orders WHERE coupon_id = ? AND student_id = ? AND status IN ('paid','awaiting_verification')",
    c.id,
    studentId,
  );
  if ((used?.n ?? 0) >= c.per_student_limit) throw new HttpError(422, "coupon_used");

  const scoped = await all<{ course_id: number }>(env.DB, "SELECT course_id FROM coupon_courses WHERE coupon_id = ?", c.id);
  const scope = new Set(scoped.map((s) => s.course_id));
  const eligible = courses.map((course, i) => i).filter((i) => scope.size === 0 || scope.has(courses[i].id));
  if (eligible.length === 0) throw new HttpError(422, "coupon_not_applicable");

  const eligibleTotal = eligible.reduce((sum, i) => sum + base[i], 0);
  if (eligibleTotal < c.min_order) throw new HttpError(422, "coupon_min_order");

  let discount = c.type === "percent" ? Math.floor((eligibleTotal * c.value) / 100) : Math.min(c.value, eligibleTotal);
  if (c.max_discount !== null) discount = Math.min(discount, c.max_discount);
  return { id: c.id, code: c.code, discount: Math.max(0, Math.min(discount, eligibleTotal)), eligible };
}

/* =================================================================================================
 *  Orders
 * ============================================================================================== */
export interface ManualProof {
  method: "bkash" | "nagad" | "rocket";
  /** the number the student pays FROM — it lets staff match the payment in their statement */
  payer_number: string;
  /** absent when the student is only starting: they pay first and send the TrxID (and/or a screenshot) afterwards */
  trx_id?: string;
}

export async function createOrder(
  env: Env,
  student: StudentCtx,
  quote: Quote,
  channel: Channel | "free",
  manual?: ManualProof,
  windowMin: number = MANUAL_WINDOW_DEFAULT_MIN,
): Promise<{ id: number; public_id: string }> {
  const publicId = generatePublicOrderId();
  const created = new Date();
  const now = nowIso(created);
  // A manual order starts "pending" with a payment window and moves on when the student sends proof — or at once when the
  // TrxID comes with the order (the one-step form older clients use).
  const isManual = channel === "manual";
  const withProof = isManual && !!manual?.trx_id;
  const status: OrderStatus = withProof ? "awaiting_verification" : "pending";
  const payBy = isManual ? nowIso(new Date(created.getTime() + windowMin * 60_000)) : null;
  const insert = env.DB.prepare(
    `INSERT INTO orders (public_id, student_id, status, subtotal, discount, total, coupon_id, coupon_code, bundle_id, method, gateway,
                         gateway_txn, payer_number, customer_name, customer_email, customer_phone, pay_by, proof_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    publicId,
    student.id,
    status,
    quote.subtotal,
    quote.discount,
    quote.total,
    quote.coupon?.id ?? null,
    quote.coupon?.code ?? null,
    quote.bundle_id,
    manual?.method ?? null,
    channel,
    manual?.trx_id ?? null,
    manual?.payer_number ?? null,
    student.name,
    student.email,
    student.phone ?? "",
    payBy,
    withProof ? now : null,
    now,
    now,
  );
  let orderId: number;
  try {
    const res = await insert.run();
    orderId = res.meta.last_row_id as number;
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw conflict("trx_used", { trx_id: "trx_used" });
    throw err;
  }
  await env.DB.batch(
    quote.items.map((it) =>
      env.DB.prepare("INSERT INTO order_items (order_id, course_id, title_bn, title_en, list_price, price) VALUES (?, ?, ?, ?, ?, ?)").bind(
        orderId,
        it.course_id,
        it.title_bn,
        it.title_en,
        it.list_price,
        it.price,
      ),
    ),
  );
  return { id: orderId, public_id: publicId };
}

/** Starting again replaces the student's own unpaid manual order for the same class(es), so they never pile up. */
export async function cancelReplacedManualOrders(env: Env, studentId: number, courseIds: number[]): Promise<void> {
  if (courseIds.length === 0) return;
  await run(
    env.DB,
    `UPDATE orders SET status = 'cancelled', note = 'replaced', updated_at = ?
     WHERE student_id = ? AND gateway = 'manual' AND status = 'pending'
       AND id IN (SELECT order_id FROM order_items WHERE course_id IN (${qs(courseIds.length)}))`,
    nowIso(),
    studentId,
    ...courseIds,
  );
}

interface OpenManualOrder {
  id: number;
  status: OrderStatus;
  gateway: string | null;
  gateway_txn: string | null;
  proof_key: string | null;
}

/** The student's own manual order, and only while it can still change (pending, or waiting for staff). */
async function openManualOrder(env: Env, studentId: number, publicId: string): Promise<OpenManualOrder> {
  const row = await first<OpenManualOrder>(env.DB, "SELECT id, status, gateway, gateway_txn, proof_key FROM orders WHERE public_id = ? AND student_id = ?", publicId, studentId);
  if (!row) throw notFound();
  if (row.gateway !== "manual") throw new HttpError(409, "not_manual");
  if (row.status !== "pending" && row.status !== "awaiting_verification") throw new HttpError(409, "order_closed");
  return row;
}

/**
 * The student sends proof for an open manual order: a TrxID, a screenshot sent earlier with saveProofImage, or both — at least one.
 * The first time it moves the order to "awaiting_verification"; later it only lets them fix a typo while staff have not decided.
 * Proof that arrives after the payment window is accepted on purpose: the money may already have been sent.
 */
export async function submitManualProof(env: Env, studentId: number, publicId: string, trxId: string | null): Promise<{ id: number; first: boolean }> {
  const row = await openManualOrder(env, studentId, publicId);
  const trx = trxId ?? row.gateway_txn;
  if (!trx && !row.proof_key) throw new HttpError(422, "validation", "validation", { trx_id: "required" });
  const now = nowIso();
  try {
    const res = await run(
      env.DB,
      `UPDATE orders SET status = 'awaiting_verification', gateway_txn = ?, proof_at = COALESCE(proof_at, ?), updated_at = ?
       WHERE id = ? AND status IN ('pending','awaiting_verification')`,
      trx,
      now,
      now,
      row.id,
    );
    if ((res.meta.changes ?? 0) !== 1) throw new HttpError(409, "order_closed");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (String(err).includes("UNIQUE")) throw conflict("trx_used", { trx_id: "trx_used" });
    throw err;
  }
  return { id: row.id, first: row.status === "pending" };
}

/**
 * Stores the payment screenshot as a private R2 object that only staff can open. The type comes from the file's own bytes, and the key
 * holds the order and the content hash, so the same picture sent twice is stored once.
 */
export async function saveProofImage(env: Env, studentId: number, publicId: string, bytes: Uint8Array): Promise<number> {
  const row = await openManualOrder(env, studentId, publicId);
  if (bytes.length === 0) throw new HttpError(400, "empty_file");
  if (bytes.length > MAX_PROOF_IMAGE_BYTES) throw new HttpError(413, "file_too_large");
  const kind = sniffImage(bytes);
  if (!kind) throw new HttpError(415, "unsupported_file_type");
  const key = `proofs/${publicId}/${(await sha256Hex(bytes)).slice(0, 24)}.${kind.ext}`;
  await env.R2.put(key, bytes, { httpMetadata: { contentType: kind.mime } });
  await run(env.DB, "UPDATE orders SET proof_key = ?, updated_at = ? WHERE id = ?", key, nowIso(), row.id);
  if (row.proof_key && row.proof_key !== key) await env.R2.delete(row.proof_key).catch(() => undefined);
  return row.id;
}

export interface PaidInput {
  gateway: "sslcommerz" | "bkash" | "manual" | "mock" | "free";
  method?: PaymentMethod | null;
  txn?: string | null;
  payerNumber?: string | null;
  note?: string;
  /** schedule background work (receipt e-mail) when running inside a request */
  waitUntil?: (p: Promise<unknown>) => void;
}

/**
 * Confirm payment — the single code path that turns an order into enrollments. It is idempotent:
 * gateway retries, the browser redirect and the IPN webhook can all arrive (even concurrently) and exactly
 * one of them wins. Everything below happens in ONE atomic D1 batch:
 *   1. claim the order (pending/awaiting -> paid)   2./3. take the next gapless invoice number for today
 *   4. create or re-activate the enrollments        5. count the coupon use
 * Every later step is guarded by this call's random claim token, so a replay can never double-issue an
 * invoice, double-count a coupon or resurrect an enrollment an admin revoked.
 */
export async function markOrderPaid(env: Env, orderId: number, p: PaidInput): Promise<{ won: boolean }> {
  // A random per-call claim token — NOT a timestamp: workerd freezes Date.now() inside a tick, so concurrent
  // webhook retries can share the exact same clock value. The token is what makes only one call "the winner".
  const claim = randomToken(12);
  const now = nowIso();
  const day = dhakaDayStamp();
  const prefix = `INV-${env.BRAND_CODE}-${day}-`;

  const results = await env.DB.batch([
    // 1. claim: pending/awaiting -> paid, stamped with our token
    env.DB.prepare(
      `UPDATE orders SET status = 'paid', paid_at = ?1, paid_claim = ?8, updated_at = ?1,
              gateway = COALESCE(?2, gateway), method = COALESCE(?3, method), gateway_txn = COALESCE(?4, gateway_txn),
              payer_number = COALESCE(?5, payer_number), note = CASE WHEN ?6 = '' THEN note ELSE ?6 END
       WHERE id = ?7 AND status IN ('pending','awaiting_verification')`,
    ).bind(now, p.gateway, p.method ?? null, p.txn ?? null, p.payerNumber ?? null, p.note ?? "", orderId, claim),
    // 2. bump today's counter — only if our claim succeeded (a replay carries a different token and does nothing)
    env.DB.prepare(
      `INSERT INTO invoice_counters (day, last_seq)
       SELECT ?1, 1 WHERE EXISTS (SELECT 1 FROM orders WHERE id = ?2 AND paid_claim = ?3 AND invoice_no IS NULL)
       ON CONFLICT(day) DO UPDATE SET last_seq = last_seq + 1`,
    ).bind(day, orderId, claim),
    // 3. stamp the gapless invoice number
    env.DB.prepare(
      `UPDATE orders SET invoice_no = ?1 || printf('%04d', (SELECT last_seq FROM invoice_counters WHERE day = ?2))
       WHERE id = ?3 AND paid_claim = ?4 AND invoice_no IS NULL`,
    ).bind(prefix, day, orderId, claim),
    // 4. enrol (or re-activate) the student in every class on the order
    env.DB.prepare(
      `INSERT INTO enrollments (student_id, course_id, order_id, status, source, enrolled_at)
       SELECT o.student_id, oi.course_id, o.id, 'active',
              CASE WHEN o.bundle_id IS NOT NULL THEN 'bundle' WHEN o.total = 0 THEN 'free' ELSE 'purchase' END, ?1
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.id = ?2 AND o.paid_claim = ?3 AND o.invoice_no IS NOT NULL
       ON CONFLICT(student_id, course_id) DO UPDATE SET status = 'active', revoked_at = NULL, order_id = excluded.order_id,
         source = excluded.source,
         enrolled_at = CASE WHEN enrollments.status = 'revoked' THEN excluded.enrolled_at ELSE enrollments.enrolled_at END`,
    ).bind(now, orderId, claim),
    // 5. count the coupon use
    env.DB.prepare(
      `UPDATE coupons SET used_count = used_count + 1
       WHERE id = (SELECT coupon_id FROM orders WHERE id = ?1 AND paid_claim = ?2 AND invoice_no IS NOT NULL)`,
    ).bind(orderId, claim),
  ]);

  const won = (results[0].meta.changes ?? 0) === 1;
  if (!won) return { won: false };

  await auditAs(env, { type: "system", id: null, name: "" }, { action: "order.paid", entity: "order", entityId: orderId, summary: p.gateway, meta: { txn: p.txn ?? null } });
  const job = Promise.all([sendReceipt(env, orderId).catch((err) => console.error("receipt_failed", orderId, err)), notifyPaid(env, orderId)]).then(() => undefined);
  if (p.waitUntil) p.waitUntil(job);
  else await job;
  return { won: true };
}

/** The facts of an order that a note to the owner needs. */
async function orderForNotice(env: Env, orderId: number) {
  const [order, items] = await Promise.all([
    first<{ public_id: string; invoice_no: string | null; total: number; method: string | null; customer_name: string; customer_email: string; customer_phone: string; gateway_txn: string | null; payer_number: string | null; has_image: number }>(
      env.DB,
      "SELECT public_id, invoice_no, total, method, customer_name, customer_email, customer_phone, gateway_txn, payer_number, (proof_key IS NOT NULL) AS has_image FROM orders WHERE id = ?",
      orderId,
    ),
    all<{ title_en: string }>(env.DB, "SELECT title_en FROM order_items WHERE order_id = ? ORDER BY id", orderId),
  ]);
  return order ? { order, items: items.map((i) => i.title_en) } : null;
}

/** "A payment came in" — to the owner, after the student has been let in. Never throws. */
export async function notifyPaid(env: Env, orderId: number): Promise<void> {
  try {
    const d = await orderForNotice(env, orderId);
    if (!d) return;
    const o = d.order;
    await notifyOwner(env, notices.orderPaid({ student: o.customer_name, email: o.customer_email, phone: o.customer_phone || null, items: d.items, total: o.total, method: o.method, invoiceNo: o.invoice_no ?? "" }));
  } catch (err) {
    console.error("notify_paid_failed", orderId, err instanceof Error ? err.message : err);
  }
}

/** "A payment is waiting for you to verify" — when a student has sent the TrxID and/or a screenshot. Never throws. */
export async function notifyProof(env: Env, orderId: number): Promise<void> {
  try {
    const d = await orderForNotice(env, orderId);
    if (!d) return;
    const o = d.order;
    await notifyOwner(
      env,
      notices.paymentWaiting({ student: o.customer_name, email: o.customer_email, phone: o.customer_phone || null, items: d.items, total: o.total, method: o.method, trx: o.gateway_txn, payer: o.payer_number, hasImage: !!o.has_image, publicId: o.public_id }),
    );
  } catch (err) {
    console.error("notify_proof_failed", orderId, err instanceof Error ? err.message : err);
  }
}

export async function sendReceipt(env: Env, orderId: number): Promise<void> {
  const order = await first<{ invoice_no: string; total: number; customer_name: string; customer_email: string; public_id: string; student_id: number }>(
    env.DB,
    "SELECT invoice_no, total, customer_name, customer_email, public_id, student_id FROM orders WHERE id = ?",
    orderId,
  );
  if (!order?.invoice_no) return;
  const [student, items] = await Promise.all([
    first<{ locale: "bn" | "en" }>(env.DB, "SELECT locale FROM students WHERE id = ?", order.student_id),
    all<{ title_bn: string; title_en: string }>(env.DB, "SELECT title_bn, title_en FROM order_items WHERE order_id = ?", orderId),
  ]);
  const lang = student?.locale ?? "bn";
  const mail = orderReceiptMail(lang, {
    name: order.customer_name,
    invoiceNo: order.invoice_no,
    total: formatMoney(order.total, lang),
    items: items.map((i) => loc(i, "title", lang)),
    learnUrl: `${env.SITE_URL}/app/`,
    invoiceUrl: `${env.SITE_URL}/app/orders/${order.public_id}`,
  });
  await sendMail(env, { to: order.customer_email, ...mail });
}

/** Mark an unpaid order failed/cancelled (gateway fail/cancel redirects). No-op once paid. */
export async function closeOrder(env: Env, publicId: string, status: "failed" | "cancelled", note = ""): Promise<void> {
  await run(
    env.DB,
    "UPDATE orders SET status = ?, note = CASE WHEN ? = '' THEN note ELSE ? END, updated_at = ? WHERE public_id = ? AND status = 'pending'",
    status,
    note,
    note,
    nowIso(),
    publicId,
  );
}

/* ------------------------------------------------ admin actions ------------------------------------------------ */
export async function rejectManualOrder(env: Env, orderId: number, reason: string): Promise<boolean> {
  const res = await run(
    env.DB,
    "UPDATE orders SET status = 'failed', note = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_verification'",
    reason.slice(0, 300),
    nowIso(),
    orderId,
  );
  return (res.meta.changes ?? 0) === 1;
}

/** Refund bookkeeping: the money is returned outside the system; here we close access and keep the record. */
export async function refundOrder(env: Env, orderId: number, reason: string): Promise<boolean> {
  const now = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status = 'refunded', refunded_at = ?1, updated_at = ?1, note = ?2 WHERE id = ?3 AND status = 'paid'").bind(now, reason.slice(0, 300), orderId),
    env.DB.prepare(
      `UPDATE enrollments SET status = 'revoked', revoked_at = ?1
       WHERE order_id = ?2 AND status = 'active' AND (SELECT status FROM orders WHERE id = ?2) = 'refunded'`,
    ).bind(now, orderId),
  ]);
  return (results[0].meta.changes ?? 0) === 1;
}

/* ------------------------------------------------- read models ------------------------------------------------- */
interface OrderRow {
  id: number;
  public_id: string;
  invoice_no: string | null;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  total: number;
  coupon_code: string | null;
  method: PaymentMethod | null;
  gateway: string | null;
  gateway_txn: string | null;
  payer_number: string | null;
  created_at: string;
  paid_at: string | null;
  pay_by: string | null;
  proof_at: string | null;
  has_proof_image: number;
}

const ORDER_COLS =
  "id, public_id, invoice_no, status, subtotal, discount, total, coupon_code, method, gateway, gateway_txn, payer_number, created_at, paid_at, pay_by, proof_at, (proof_key IS NOT NULL) AS has_proof_image";

async function withItems(env: Env, rows: OrderRow[]): Promise<OrderDTO[]> {
  if (rows.length === 0) return [];
  const items = await all<OrderItemDTO & { order_id: number }>(
    env.DB,
    `SELECT oi.order_id, oi.course_id, c.slug, oi.title_bn, oi.title_en, oi.price, oi.list_price
     FROM order_items oi JOIN courses c ON c.id = oi.course_id WHERE oi.order_id IN (${qs(rows.length)}) ORDER BY oi.id`,
    ...rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    ...r,
    has_proof_image: !!r.has_proof_image,
    items: items.filter((i) => i.order_id === r.id).map(({ order_id: _o, ...rest }) => rest),
  }));
}

export async function ordersForStudent(env: Env, studentId: number): Promise<OrderDTO[]> {
  const rows = await all<OrderRow>(env.DB, `SELECT ${ORDER_COLS} FROM orders WHERE student_id = ? ORDER BY created_at DESC LIMIT 100`, studentId);
  return withItems(env, rows);
}

/** `ref` is the unguessable public id (never a sequential id) — and the order must belong to the student. */
export async function orderForStudent(env: Env, studentId: number, publicId: string): Promise<OrderDTO> {
  const row = await first<OrderRow>(env.DB, `SELECT ${ORDER_COLS} FROM orders WHERE public_id = ? AND student_id = ?`, publicId, studentId);
  if (!row) throw notFound();
  return (await withItems(env, [row]))[0];
}

export async function orderByPublicId(env: Env, publicId: string) {
  return first<{ id: number; public_id: string; student_id: number; status: OrderStatus; total: number; gateway: string | null }>(
    env.DB,
    "SELECT id, public_id, student_id, status, total, gateway FROM orders WHERE public_id = ?",
    publicId,
  );
}
