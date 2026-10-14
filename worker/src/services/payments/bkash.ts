import type { Env } from "../../env";
import { HttpError } from "../../lib/http";

/**
 * bKash Tokenized Checkout (v1.2.0-beta): grant token -> create payment -> customer pays in bKash ->
 * bKash redirects the customer to our callback -> we EXECUTE the payment server-side and verify the result.
 * Credentials are Wrangler secrets: BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD.
 * (Enabled from Admin -> Settings -> Payments once the merchant account is live. Test in bKash's sandbox first.)
 */
const BASE = {
  live: "https://tokenized.pay.bka.sh/v1.2.0-beta",
  sandbox: "https://tokenized.sandbox.bka.sh/v1.2.0-beta",
};

export const bkashConfigured = (env: Env) => !!(env.BKASH_APP_KEY && env.BKASH_APP_SECRET && env.BKASH_USERNAME && env.BKASH_PASSWORD);
const base = (env: Env) => (env.PAYMENT_MODE === "live" ? BASE.live : BASE.sandbox);

async function grantToken(env: Env): Promise<string> {
  const cached = await env.KV.get("bkash:id_token");
  if (cached) return cached;
  const res = await fetch(`${base(env)}/tokenized/checkout/token/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", username: env.BKASH_USERNAME as string, password: env.BKASH_PASSWORD as string },
    body: JSON.stringify({ app_key: env.BKASH_APP_KEY, app_secret: env.BKASH_APP_SECRET }),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; expires_in?: number };
  if (!res.ok || !json.id_token) throw new HttpError(502, "gateway_error");
  await env.KV.put("bkash:id_token", json.id_token, { expirationTtl: Math.max(60, Math.min(3300, (json.expires_in ?? 3600) - 120)) });
  return json.id_token;
}

const headers = (env: Env, token: string) => ({
  "Content-Type": "application/json",
  Accept: "application/json",
  Authorization: token,
  "X-APP-Key": env.BKASH_APP_KEY as string,
});

export async function bkashCreate(env: Env, order: { public_id: string; total: number }, payerRef: string): Promise<{ redirectUrl: string; paymentId: string }> {
  const token = await grantToken(env);
  const res = await fetch(`${base(env)}/tokenized/checkout/create`, {
    method: "POST",
    headers: headers(env, token),
    body: JSON.stringify({
      mode: "0011",
      payerReference: payerRef.slice(0, 40) || "student",
      callbackURL: `${env.SITE_URL}/api/payments/bkash/callback`,
      amount: order.total.toFixed(2),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: order.public_id,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { bkashURL?: string; paymentID?: string; statusCode?: string };
  if (!res.ok || !json.bkashURL || !json.paymentID) throw new HttpError(502, "gateway_error");
  return { redirectUrl: json.bkashURL, paymentId: json.paymentID };
}

export interface BkashResult {
  statusCode?: string;
  transactionStatus?: string;
  trxID?: string;
  amount?: string;
  currency?: string;
  merchantInvoiceNumber?: string;
  customerMsisdn?: string;
}

export async function bkashExecute(env: Env, paymentId: string): Promise<BkashResult | null> {
  try {
    const token = await grantToken(env);
    const res = await fetch(`${base(env)}/tokenized/checkout/execute`, {
      method: "POST",
      headers: headers(env, token),
      body: JSON.stringify({ paymentID: paymentId }),
    });
    return res.ok ? ((await res.json()) as BkashResult) : null;
  } catch {
    return null;
  }
}

/** Query the payment's status (used when execute reports an error so a completed payment is never missed). */
export async function bkashQuery(env: Env, paymentId: string): Promise<BkashResult | null> {
  try {
    const token = await grantToken(env);
    const res = await fetch(`${base(env)}/tokenized/checkout/payment/status`, {
      method: "POST",
      headers: headers(env, token),
      body: JSON.stringify({ paymentID: paymentId }),
    });
    return res.ok ? ((await res.json()) as BkashResult) : null;
  } catch {
    return null;
  }
}

export function bkashAcceptable(r: BkashResult, publicId: string, expectedTotal: number): boolean {
  return (
    r.statusCode === "0000" &&
    r.transactionStatus === "Completed" &&
    r.merchantInvoiceNumber === publicId &&
    (r.currency ?? "BDT") === "BDT" &&
    Math.abs(Number(r.amount) - expectedTotal) <= 0.009
  );
}
