import { Hono, type Context } from "hono";
import type { AppEnv } from "../../env";
import { timingSafeEqual } from "../../lib/crypto";
import { orderForCourier, recordCourierWord, type Courier } from "../../services/courier";
import { notices, notifyOwner } from "../../services/notify";

/*
 * The couriers' webhooks: what Steadfast and Pathao tell the site about a parcel it booked with them (services/courier.ts). They come
 * from the couriers' servers, never from a browser, so they carry no cookie and are checked by the secret the owner gave each courier:
 *  - Steadfast:  POST /api/courier/steadfast   Authorization: Bearer <STEADFAST_WEBHOOK_TOKEN>
 *  - Pathao:     POST /api/courier/pathao      X-PATHAO-Signature: <PATHAO_WEBHOOK_SECRET>
 * A word about a parcel this site did not book (one made by hand in the courier's panel) is answered politely and dropped, so the courier
 * does not keep sending it; a word from anyone without the secret changes nothing.
 */

export const courierRoutes = new Hono<AppEnv>();

const text = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "");

async function take(c: Context<AppEnv>, courier: Courier, w: { cid: string; code: string; event: string; status: string; message: string }) {
  const order = await orderForCourier(c.env, courier, w.cid, w.code);
  if (!order) return;
  const meaning = await recordCourierWord(c.env, order, courier, { event: w.event, status: w.status, message: w.message });
  // the parcel came back, was cancelled, could not be delivered or is on hold: the owner decides what happens to the order
  if (meaning === "attention") {
    c.executionCtx.waitUntil(notifyOwner(c.env, notices.courierWord({ code: order.public_id, courier, said: w.status || w.event, message: w.message, name: order.name, phone: order.phone, total: order.total, payment: order.payment })));
  }
}

courierRoutes.post("/steadfast", async (c) => {
  const token = c.env.STEADFAST_WEBHOOK_TOKEN?.trim();
  if (!token || !timingSafeEqual(c.req.header("authorization") ?? "", `Bearer ${token}`)) return c.json({ status: "error", message: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ status: "error", message: "Invalid payload" }, 400);
  await take(c, "steadfast", {
    cid: text(body.consignment_id, 60),
    code: text(body.invoice, 40),
    // "delivery_status" (with a status) or "tracking_update" (with a sentence)
    event: text(body.notification_type, 60) || "delivery_status",
    status: text(body.status ?? body.delivery_status, 60),
    message: text(body.tracking_message ?? body.message, 500),
  });
  return c.json({ status: "success", message: "Webhook received successfully." });
});

courierRoutes.post("/pathao", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const event = text(body?.event, 60);
  // Pathao checks the address when the owner saves it in its panel: it wants 202 and its integration secret back in a header — the one
  // its request carries, or (when it carries none) the one the owner copied from Pathao's page into PATHAO_WEBHOOK_INTEGRATION_SECRET
  if (event === "webhook_integration") {
    const echo = (c.req.header("x-pathao-merchant-webhook-integration-secret") || c.env.PATHAO_WEBHOOK_INTEGRATION_SECRET || "").trim().slice(0, 200);
    if (echo) c.header("X-Pathao-Merchant-Webhook-Integration-Secret", echo);
    return c.json({ status: 202, message: "Webhook integration successful" }, 202);
  }
  const secret = c.env.PATHAO_WEBHOOK_SECRET?.trim();
  if (!secret || !timingSafeEqual(c.req.header("x-pathao-signature") ?? "", secret)) return c.json({ error: "Unauthorized", message: "Invalid webhook signature" }, 401);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "Invalid payload" }, 400);
  await take(c, "pathao", {
    cid: text(body.consignment_id, 60),
    code: text(body.merchant_order_id, 40),
    event: event || "order.updated",
    status: text(body.order_status ?? body.order_status_slug, 60) || event,
    message: text(body.reason ?? body.message, 500),
  });
  return c.json({ status: 202, message: "Webhook received successfully", data: null }, 202);
});
