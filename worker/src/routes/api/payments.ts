import { Hono } from "hono";
import { formatMoney } from "@mawah/shared";
import type { AppEnv, Ctx } from "../../env";
import { escapeHtml } from "../../lib/html";
import { first, nowIso, run } from "../../lib/db";
import { HttpError } from "../../lib/http";
import { closeOrder, markOrderPaid, orderByPublicId } from "../../services/orders";
import { mockEnabled, mockSignature, mockVerify } from "../../services/payments";
import { bkashAcceptable, bkashExecute, bkashQuery } from "../../services/payments/bkash";
import { sslAcceptable, sslConfigured, sslMethod, sslValidate } from "../../services/payments/sslcommerz";
import { notices, notifyOwner } from "../../services/notify";
import { closeShopOrder, holdShopPayment, isShopOrderId, lateShopPayment, markShopPaid, shopOrderRow } from "../../services/shop";

/**
 * Payment gateway callbacks. These are NOT cookie-authenticated (they arrive cross-site, often as POST from
 * the gateway's servers or a redirect from its hosted page). Trust comes from re-verifying every payment
 * with the gateway itself, and from an HMAC for the mock gateway. Enrollment is granted only by
 * markOrderPaid() after that server-side verification — never because a browser landed on a "success" URL.
 */
export const paymentRoutes = new Hono<AppEnv>();

async function logEvent(c: Ctx, orderId: number | null, provider: string, event: string, verified: boolean, payload: unknown) {
  await run(
    c.env.DB,
    "INSERT INTO payment_events (order_id, provider, event, verified, payload) VALUES (?, ?, ?, ?, ?)",
    orderId,
    provider,
    event,
    verified ? 1 : 0,
    JSON.stringify(payload).slice(0, 4000),
  );
}

async function formOrQuery(c: Ctx): Promise<Record<string, string>> {
  const out: Record<string, string> = { ...c.req.query() };
  if (c.req.method === "POST") {
    try {
      const body = await c.req.parseBody();
      for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
    } catch {
      /* empty body */
    }
  }
  return out;
}

const orderUrl = (c: Ctx, publicId: string, flag = "") => `${c.env.SITE_URL}/app/orders/${publicId}${flag ? `?${flag}` : ""}`;

/* ------------------------------------------------------ SSLCommerz ------------------------------------------------------ */
async function confirmSsl(c: Ctx, tranId: string, valId: string): Promise<"paid" | "pending" | "failed"> {
  const order = await orderByPublicId(c.env, tranId);
  if (!order || order.gateway !== "sslcommerz") return "failed";
  if (order.status === "paid") return "paid";
  if (order.status !== "pending" && order.status !== "awaiting_verification") return "failed";
  if (!valId || !sslConfigured(c.env)) return "pending";

  const v = await sslValidate(c.env, valId);
  await logEvent(c, order.id, "sslcommerz", "validate", !!v, v ?? { error: "no_response" });
  if (!v) return "pending"; // transport problem: SSLCommerz will retry the IPN
  const verdict = sslAcceptable(v, order.public_id, order.total);
  if (verdict === "ok") {
    await markOrderPaid(c.env, order.id, {
      gateway: "sslcommerz",
      method: sslMethod(v.card_type),
      txn: v.bank_tran_id || v.val_id,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    return "paid";
  }
  if (verdict === "risky") {
    await run(c.env.DB, "UPDATE orders SET status = 'awaiting_verification', note = ?, updated_at = ? WHERE id = ? AND status = 'pending'", "gateway_risk_review", nowIso(), order.id);
    return "pending";
  }
  await closeOrder(c.env, order.public_id, "failed", "validation_failed");
  return "failed";
}

/*
 * A tools-shop order (its code starts "SH"): the same rules — SSLCommerz's own validation API, the order's code, the currency and the exact
 * amount, risky payments held for a person — but it marks the shop order paid instead of opening a class.
 */
async function confirmShopSsl(c: Ctx, tranId: string, valId: string): Promise<"paid" | "pending" | "failed"> {
  const order = await shopOrderRow(c.env, tranId);
  if (!order || order.payment !== "sslcommerz") return "failed";
  const closed = order.status === "failed" || order.status === "cancelled";
  if (order.status !== "pending" && !closed) return "paid";
  if (!valId || !sslConfigured(c.env)) return closed ? "failed" : "pending";
  const v = await sslValidate(c.env, valId);
  await logEvent(c, null, "sslcommerz", `shop_validate:${order.public_id}`, !!v, v ?? { error: "no_response" });
  if (!v) return "pending";
  const verdict = sslAcceptable(v, order.public_id, order.total);
  const txn = v.bank_tran_id || v.val_id;
  if (verdict === "reject") {
    if (!closed) await closeShopOrder(c.env, order.id, "failed");
    return "failed";
  }
  // paid after the order was closed (the buyer took very long): staff check it rather than the money being lost
  const changed = closed ? await lateShopPayment(c.env, order.id, txn) : verdict === "ok" ? await markShopPaid(c.env, order.id, txn) : await holdShopPayment(c.env, order.id, txn);
  // the owner hears of an online order once it is paid (a cash-on-delivery order is told at once)
  if (changed) {
    const items = await c.env.DB.prepare("SELECT name_en, label_en, qty FROM shop_order_items WHERE order_id = ? ORDER BY id").bind(order.id).all<{ name_en: string; label_en: string; qty: number }>();
    c.executionCtx.waitUntil(
      notifyOwner(
        c.env,
        notices.shopOrder({
          code: order.public_id,
          name: order.name,
          phone: order.phone,
          total: order.total,
          payment: "sslcommerz",
          place: `${order.address}, ${order.place}`,
          items: (items.results ?? []).map((i) => ({ name: `${i.name_en}${i.label_en ? ` (${i.label_en})` : ""}`, qty: i.qty })),
        }),
      ),
    );
  }
  return verdict === "ok" && !closed ? "paid" : "pending";
}

/**
 * Where the buyer lands after SSLCommerz's page: their shop order, or their class order. The shop order's key is never put in this address
 * (anyone who knows an order's code can call these addresses): the buyer's browser kept it when the order was placed.
 */
async function backTo(c: Ctx, tranId: string | undefined): Promise<string> {
  if (!tranId) return `${c.env.SITE_URL}/app/`;
  if (isShopOrderId(tranId)) {
    const order = await shopOrderRow(c.env, tranId);
    return order ? `${c.env.SITE_URL}/app/shop/orders/${order.public_id}` : `${c.env.SITE_URL}/shop`;
  }
  return orderUrl(c, tranId);
}

// Server-to-server notification (the authoritative signal)
paymentRoutes.post("/sslcommerz/ipn", async (c) => {
  const f = await formOrQuery(c);
  if (!f.tran_id || !f.val_id) throw new HttpError(400, "bad_request");
  const result = isShopOrderId(f.tran_id) ? await confirmShopSsl(c, f.tran_id, f.val_id) : await confirmSsl(c, f.tran_id, f.val_id);
  return c.json({ ok: result !== "failed", status: result });
});

// Browser redirects after the hosted page: re-verify, then show the order page
paymentRoutes.on(["GET", "POST"], "/sslcommerz/success", async (c) => {
  const f = await formOrQuery(c);
  if (!f.tran_id) return c.redirect(`${c.env.SITE_URL}/app/`, 303);
  if (isShopOrderId(f.tran_id)) await confirmShopSsl(c, f.tran_id, f.val_id ?? "");
  else await confirmSsl(c, f.tran_id, f.val_id ?? "");
  return c.redirect(await backTo(c, f.tran_id), 303);
});
paymentRoutes.on(["GET", "POST"], "/sslcommerz/fail", async (c) => {
  const f = await formOrQuery(c);
  if (f.tran_id && isShopOrderId(f.tran_id)) {
    const order = await shopOrderRow(c.env, f.tran_id);
    if (order) await closeShopOrder(c.env, order.id, "failed");
  } else if (f.tran_id) await closeOrder(c.env, f.tran_id, "failed", "gateway_failed");
  return c.redirect(await backTo(c, f.tran_id), 303);
});
paymentRoutes.on(["GET", "POST"], "/sslcommerz/cancel", async (c) => {
  const f = await formOrQuery(c);
  if (f.tran_id && isShopOrderId(f.tran_id)) {
    const order = await shopOrderRow(c.env, f.tran_id);
    if (order) await closeShopOrder(c.env, order.id, "cancelled");
  } else if (f.tran_id) await closeOrder(c.env, f.tran_id, "cancelled", "customer_cancelled");
  return c.redirect(await backTo(c, f.tran_id), 303);
});

/* --------------------------------------------------------- bKash ---------------------------------------------------------- */
paymentRoutes.get("/bkash/callback", async (c) => {
  const { paymentID, status } = c.req.query();
  if (!paymentID) throw new HttpError(400, "bad_request");
  const order = await first<{ id: number; public_id: string; total: number; status: string }>(
    c.env.DB,
    "SELECT id, public_id, total, status FROM orders WHERE gateway = 'bkash' AND gateway_ref = ?",
    paymentID,
  );
  if (!order) throw new HttpError(404, "not_found");
  if (order.status === "paid") return c.redirect(orderUrl(c, order.public_id), 303);

  if (status === "success") {
    let result = await bkashExecute(c.env, paymentID);
    if (!result || result.statusCode !== "0000") result = (await bkashQuery(c.env, paymentID)) ?? result; // never miss a completed payment
    await logEvent(c, order.id, "bkash", "execute", !!result, result ?? { error: "no_response" });
    if (result && bkashAcceptable(result, order.public_id, order.total)) {
      await markOrderPaid(c.env, order.id, {
        gateway: "bkash",
        method: "bkash",
        txn: result.trxID ?? null,
        payerNumber: result.customerMsisdn ?? null,
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      });
    } else {
      await closeOrder(c.env, order.public_id, "failed", "validation_failed");
    }
  } else {
    await closeOrder(c.env, order.public_id, status === "cancel" ? "cancelled" : "failed", `bkash_${status ?? "unknown"}`);
  }
  return c.redirect(orderUrl(c, order.public_id), 303);
});

/* ----------------------------------------- mock gateway (development & tests only) ----------------------------------------- */
paymentRoutes.get("/mock/pay/:publicId", async (c) => {
  if (!mockEnabled(c.env)) throw new HttpError(404, "not_found");
  const order = await orderByPublicId(c.env, c.req.param("publicId"));
  if (!order) throw new HttpError(404, "not_found");
  const [paid, failed] = await Promise.all([mockSignature(c.env, order.public_id, "paid"), mockSignature(c.env, order.public_id, "failed")]);
  const form = (status: string, sig: string, label: string, cls: string) =>
    `<form method="post" action="/api/payments/mock/webhook"><input type="hidden" name="order" value="${escapeHtml(order.public_id)}"><input type="hidden" name="status" value="${status}"><input type="hidden" name="sig" value="${sig}"><button class="${cls}" type="submit">${label}</button></form>`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test payment</title>
<style>body{font-family:system-ui,sans-serif;background:#fbf7ee;color:#1b1213;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;border:1px solid #e6dfcc;border-radius:16px;padding:32px;max-width:380px;text-align:center}
h1{font-size:20px;margin:0 0 6px}p{color:#4a3d3e}button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:14px 22px;margin:6px;cursor:pointer;min-width:200px}.ok{background:#db1718;color:#fff}.no{background:#eee;color:#333}</style>
<main><h1>Test payment gateway</h1><p>Development only. Order total: <b>${escapeHtml(formatMoney(order.total, "en"))}</b></p>
${form("paid", paid, "Simulate successful payment", "ok")}${form("failed", failed, "Simulate failed payment", "no")}</main></html>`;
  return c.html(html, 200, { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" });
});

// The "webhook": authenticated by an HMAC, exactly like a real gateway would sign its callback
paymentRoutes.post("/mock/webhook", async (c) => {
  if (!mockEnabled(c.env)) throw new HttpError(404, "not_found");
  const f = await formOrQuery(c);
  if (!f.order || !f.status || !f.sig || !(await mockVerify(c.env, f.order, f.status, f.sig))) throw new HttpError(403, "bad_signature");
  const order = await orderByPublicId(c.env, f.order);
  if (!order || order.gateway !== "mock") throw new HttpError(404, "not_found");
  await logEvent(c, order.id, "mock", f.status, true, { status: f.status });
  if (f.status === "paid") {
    await markOrderPaid(c.env, order.id, { gateway: "mock", method: "mock", txn: `MOCK-${order.public_id.slice(0, 8).toUpperCase()}`, waitUntil: (p) => c.executionCtx.waitUntil(p) });
  } else {
    await closeOrder(c.env, order.public_id, "failed", "mock_failed");
  }
  // programmatic callers (tests) get JSON, browsers get redirected back to their order
  if ((c.req.header("accept") ?? "").includes("text/html")) return c.redirect(orderUrl(c, order.public_id), 303);
  return c.json({ ok: true, status: f.status });
});
