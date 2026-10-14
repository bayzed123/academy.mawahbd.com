import type { PaymentMethod } from "@mawah/shared";
import type { Env } from "../../env";
import { HttpError } from "../../lib/http";

/**
 * SSLCommerz — the Bangladeshi aggregator behind one hosted page for bKash, Nagad, Rocket and cards.
 * Flow: init session -> customer pays on the gateway page -> gateway calls our IPN (server to server)
 * -> we re-validate with SSLCommerz's validator API (never trusting the posted fields) -> enroll.
 * Credentials: SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD are Wrangler secrets.
 */
const BASE = { live: "https://securepay.sslcommerz.com", sandbox: "https://sandbox.sslcommerz.com" };

export const sslConfigured = (env: Env) => !!(env.SSLCOMMERZ_STORE_ID && env.SSLCOMMERZ_STORE_PASSWORD);
const base = (env: Env) => (env.PAYMENT_MODE === "live" ? BASE.live : BASE.sandbox);

export interface SslValidation {
  status: string; // VALID | VALIDATED | INVALID_TRANSACTION
  tran_id: string;
  val_id: string;
  amount: string;
  currency: string;
  bank_tran_id?: string;
  card_type?: string;
  risk_level?: string;
  risk_title?: string;
}

export async function sslInit(
  env: Env,
  order: { public_id: string; total: number },
  customer: { name: string; email: string; phone: string },
  productName: string,
): Promise<{ redirectUrl: string; sessionKey: string }> {
  const form = new URLSearchParams({
    store_id: env.SSLCOMMERZ_STORE_ID as string,
    store_passwd: env.SSLCOMMERZ_STORE_PASSWORD as string,
    total_amount: order.total.toFixed(2),
    currency: "BDT",
    tran_id: order.public_id,
    success_url: `${env.SITE_URL}/api/payments/sslcommerz/success`,
    fail_url: `${env.SITE_URL}/api/payments/sslcommerz/fail`,
    cancel_url: `${env.SITE_URL}/api/payments/sslcommerz/cancel`,
    ipn_url: `${env.SITE_URL}/api/payments/sslcommerz/ipn`,
    cus_name: customer.name.slice(0, 50),
    cus_email: customer.email,
    cus_add1: "Dhaka",
    cus_city: "Dhaka",
    cus_postcode: "1000",
    cus_country: "Bangladesh",
    cus_phone: customer.phone || "01700000000",
    shipping_method: "NO",
    num_of_item: "1",
    product_name: productName.slice(0, 200),
    product_category: "Online Course",
    product_profile: "non-physical-goods",
  });
  const res = await fetch(`${base(env)}/gwprocess/v4/api.php`, { method: "POST", body: form });
  const json = (await res.json().catch(() => ({}))) as { status?: string; GatewayPageURL?: string; sessionkey?: string };
  if (!res.ok || json.status !== "SUCCESS" || !json.GatewayPageURL) throw new HttpError(502, "gateway_error");
  return { redirectUrl: json.GatewayPageURL, sessionKey: json.sessionkey ?? "" };
}

/** Ask SSLCommerz whether `valId` is a genuine, completed payment. Returns null on any transport problem. */
export async function sslValidate(env: Env, valId: string): Promise<SslValidation | null> {
  const url = new URL(`${base(env)}/validator/api/validationserverAPI.php`);
  url.searchParams.set("val_id", valId);
  url.searchParams.set("store_id", env.SSLCOMMERZ_STORE_ID as string);
  url.searchParams.set("store_passwd", env.SSLCOMMERZ_STORE_PASSWORD as string);
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as SslValidation;
  } catch {
    return null;
  }
}

/** Decide whether a validation result is an acceptable payment for an order of `expectedTotal` BDT. */
export function sslAcceptable(v: SslValidation, publicId: string, expectedTotal: number): "ok" | "risky" | "reject" {
  if (v.status !== "VALID" && v.status !== "VALIDATED") return "reject";
  if (v.tran_id !== publicId || v.currency !== "BDT") return "reject";
  if (Math.abs(Number(v.amount) - expectedTotal) > 0.009) return "reject";
  // SSLCommerz flags risky payments (risk_level 1): hold them for a human instead of auto-enrolling
  if (v.risk_level && v.risk_level !== "0") return "risky";
  return "ok";
}

export function sslMethod(cardType: string | undefined): PaymentMethod {
  const t = (cardType ?? "").toLowerCase();
  if (t.includes("bkash")) return "bkash";
  if (t.includes("nagad")) return "nagad";
  if (t.includes("rocket") || t.includes("dbbl mobile")) return "rocket";
  return "card";
}
