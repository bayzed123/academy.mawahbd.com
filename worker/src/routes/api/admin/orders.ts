import { Hono } from "hono";
import { z } from "zod";
import { ORDER_STATUSES, PAYMENT_METHODS, shownEmail } from "@mawah/shared";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { csvResponse, toCsv } from "../../../lib/csv";
import { all, first, likeEscape, pageInfo, pageParams } from "../../../lib/db";
import { HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { manualPaymentRejectedMail } from "../../../lib/mailer";
import { rejectedSms } from "../../../lib/smsText";
import { tellStudent } from "../../../services/studentMessages";
import { textSchema } from "../../../lib/schemas";
import { requirePerm } from "../../../middleware/auth";
import { markOrderPaid, refundOrder, rejectManualOrder } from "../../../services/orders";

export const orders = new Hono<AppEnv>();

const COLS = `o.id, o.public_id, o.invoice_no, o.status, o.subtotal, o.discount, o.total, o.coupon_code, o.method, o.gateway, o.gateway_txn,
  o.payer_number, o.customer_name, o.customer_email, o.customer_phone, o.customer_address, o.note, o.created_at, o.paid_at, o.refunded_at, o.student_id,
  o.pay_by, o.proof_at, (o.proof_key IS NOT NULL) AS has_proof_image,
  (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
  (SELECT group_concat(oi.title_en, ' · ') FROM order_items oi WHERE oi.order_id = o.id) AS items`;

function filters(c: { req: { query(): Record<string, string> } }) {
  const q = c.req.query();
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (q.status && (ORDER_STATUSES as readonly string[]).includes(q.status)) {
    where.push("o.status = ?");
    params.push(q.status);
  }
  if (q.method && (PAYMENT_METHODS as readonly string[]).includes(q.method)) {
    where.push("o.method = ?");
    params.push(q.method);
  }
  if (q.gateway && /^[a-z]{3,12}$/.test(q.gateway)) {
    where.push("o.gateway = ?");
    params.push(q.gateway);
  }
  if (q.student_id && /^\d+$/.test(q.student_id)) {
    where.push("o.student_id = ?");
    params.push(Number(q.student_id));
  }
  if (q.course_id && /^\d+$/.test(q.course_id)) {
    where.push("EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.course_id = ?)");
    params.push(Number(q.course_id));
  }
  // dates are Dhaka calendar days (UTC+6)
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) {
    where.push("date(o.created_at, '+6 hours') >= ?");
    params.push(q.from);
  }
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
    where.push("date(o.created_at, '+6 hours') <= ?");
    params.push(q.to);
  }
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    where.push("(o.public_id LIKE ? ESCAPE '\\' OR o.invoice_no LIKE ? ESCAPE '\\' OR o.customer_email LIKE ? ESCAPE '\\' OR o.customer_name LIKE ? ESCAPE '\\' OR o.customer_phone LIKE ? ESCAPE '\\' OR o.gateway_txn LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like, like, like);
  }
  const sorts: Record<string, string> = { created: "o.created_at", total: "o.total", paid: "o.paid_at" };
  const sortKey = (q.sort ?? "-created").replace(/^-/, "");
  const order = `${sorts[sortKey] ?? "o.created_at"} ${(q.sort ?? "-created").startsWith("-") ? "DESC" : "ASC"}, o.id DESC`;
  return { where: where.join(" AND "), params, order };
}

orders.get("/orders", requirePerm("orders:read"), async (c) => {
  const f = filters(c);
  const { page, per_page, offset } = pageParams(c.req.query());
  const [rows, total, sums] = await Promise.all([
    all(c.env.DB, `SELECT ${COLS} FROM orders o WHERE ${f.where} ORDER BY ${f.order} LIMIT ? OFFSET ?`, ...f.params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM orders o WHERE ${f.where}`, ...f.params),
    first<{ paid_total: number; paid_count: number }>(
      c.env.DB,
      `SELECT COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.total END), 0) AS paid_total, COUNT(CASE WHEN o.status = 'paid' THEN 1 END) AS paid_count FROM orders o WHERE ${f.where}`,
      ...f.params,
    ),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0), summary: sums });
});

orders.get("/orders/export.csv", requirePerm("orders:read"), async (c) => {
  const f = filters(c);
  const rows = await all<Record<string, unknown>>(c.env.DB, `SELECT ${COLS} FROM orders o WHERE ${f.where} ORDER BY ${f.order} LIMIT 5000`, ...f.params);
  return csvResponse(
    "orders",
    toCsv(rows, [
      { key: "invoice_no", label: "Invoice" },
      { key: "public_id", label: "Order ref" },
      { key: "created_at", label: "Created (UTC)" },
      { key: "paid_at", label: "Paid (UTC)" },
      { key: "status", label: "Status" },
      { key: "customer_name", label: "Student" },
      { key: "customer_email", label: "Email" },
      { key: "customer_phone", label: "Phone" },
      { key: "customer_address", label: "Address" },
      { key: "items", label: "Classes" },
      { key: "subtotal", label: "Subtotal (BDT)" },
      { key: "discount", label: "Discount (BDT)" },
      { key: "total", label: "Total (BDT)" },
      { key: "coupon_code", label: "Coupon" },
      { key: "gateway", label: "Gateway" },
      { key: "method", label: "Method" },
      { key: "gateway_txn", label: "Transaction id" },
      { key: "payer_number", label: "Payer number" },
    ]),
  );
});

orders.get("/orders/:id", requirePerm("orders:read"), async (c) => {
  const id = intParam(c, "id");
  const order = await first<Record<string, unknown>>(c.env.DB, `SELECT ${COLS} FROM orders o WHERE o.id = ?`, id);
  if (!order) throw notFound();
  const [items, events, student] = await Promise.all([
    all(c.env.DB, "SELECT course_id, title_bn, title_en, list_price, price FROM order_items WHERE order_id = ? ORDER BY id", id),
    all(c.env.DB, "SELECT id, provider, event, verified, created_at FROM payment_events WHERE order_id = ? ORDER BY id", id),
    first(c.env.DB, "SELECT id, name, email, phone, blocked FROM students WHERE id = ?", order.student_id as number),
  ]);
  // a buyer who gave no e-mail is kept under a made-up address: the screen says "none", never that address
  return ok(c, { order, items, events, student: student ? { ...student, email: shownEmail((student as { email: string }).email) } : null });
});

/** The payment screenshot a student sent. Private: only staff who verify payments can open it, and browsers are told not to keep it. */
orders.get("/orders/:id/proof-image", requirePerm("orders:verify"), async (c) => {
  const id = intParam(c, "id");
  const row = await first<{ proof_key: string | null }>(c.env.DB, "SELECT proof_key FROM orders WHERE id = ?", id);
  if (!row?.proof_key) throw notFound();
  const object = await c.env.R2.get(row.proof_key);
  if (!object) throw notFound();
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
});

/** A manual (bKash/Nagad/Rocket send-money) payment checked against the account statement -> opens the classes. */
orders.post("/orders/:id/approve", requirePerm("orders:verify"), async (c) => {
  const id = intParam(c, "id");
  const order = await first<{ id: number; status: string; gateway: string | null; method: string | null; gateway_txn: string | null }>(
    c.env.DB,
    "SELECT id, status, gateway, method, gateway_txn FROM orders WHERE id = ?",
    id,
  );
  if (!order) throw notFound();
  // a manual order can be approved while it is still "pending" too: the student paid but sent the proof on WhatsApp instead of the form
  const approvable = order.status === "awaiting_verification" || (order.status === "pending" && order.gateway === "manual");
  if (!approvable) throw new HttpError(409, "not_awaiting_verification");
  const result = await markOrderPaid(c.env, id, { gateway: "manual", waitUntil: (p) => c.executionCtx.waitUntil(p) });
  if (!result.won) throw new HttpError(409, "already_processed");
  await audit(c, { action: "order.approved", entity: "order", entityId: id, summary: order.gateway_txn ?? "" });
  return ok(c, { order: await first(c.env.DB, `SELECT ${COLS} FROM orders o WHERE o.id = ?`, id) });
});

orders.post("/orders/:id/reject", requirePerm("orders:verify"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ reason: textSchema(300) }));
  const order = await first<{ id: number; customer_name: string; customer_email: string; customer_phone: string; student_id: number }>(
    c.env.DB,
    "SELECT id, customer_name, customer_email, customer_phone, student_id FROM orders WHERE id = ?",
    id,
  );
  if (!order) throw notFound();
  if (!(await rejectManualOrder(c.env, id, body.reason))) throw new HttpError(409, "not_awaiting_verification");
  const student = await first<{ locale: "bn" | "en"; phone: string | null }>(c.env.DB, "SELECT locale, phone FROM students WHERE id = ?", order.student_id);
  const lang = student?.locale ?? "bn";
  // by e-mail when they gave one, and by text message to their number (the only way for a buyer who gave no e-mail)
  c.executionCtx.waitUntil(
    tellStudent(
      c.env,
      { email: order.customer_email, phone: order.customer_phone || student?.phone },
      { mail: manualPaymentRejectedMail(lang, { name: order.customer_name, reason: body.reason }), sms: rejectedSms(lang, { reason: body.reason }) },
    ).then(() => undefined),
  );
  await audit(c, { action: "order.rejected", entity: "order", entityId: id, summary: body.reason });
  return ok(c);
});

/** Refund bookkeeping (the money itself goes back outside the system): closes access, keeps the record. Super Admin only. */
orders.post("/orders/:id/refund", requirePerm("orders:refund"), async (c) => {
  const id = intParam(c, "id");
  const body = await parseBody(c, z.object({ reason: textSchema(300, 1) }));
  if (!(await first(c.env.DB, "SELECT id FROM orders WHERE id = ?", id))) throw notFound();
  if (!(await refundOrder(c.env, id, body.reason))) throw new HttpError(409, "not_paid");
  await audit(c, { action: "order.refunded", entity: "order", entityId: id, summary: body.reason });
  return ok(c);
});
