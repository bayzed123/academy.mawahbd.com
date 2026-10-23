import type { Channel, ManualPayInfo } from "@mawah/shared";
import { isProd, type Env } from "../../env";
import { hmacHex, timingSafeEqual } from "../../lib/crypto";
import type { Settings } from "../../lib/settings";
import { bkashConfigured } from "./bkash";
import { sslConfigured } from "./sslcommerz";

/** The simulated gateway exists ONLY for local development and automated tests — never in production. */
export function mockEnabled(env: Env): boolean {
  return !isProd(env) && env.ALLOW_MOCK_PAYMENTS === "true";
}

/** Channels the student can pick right now = enabled in Admin -> Settings AND actually connected (secrets present). */
export function availableChannels(env: Env, settings: Settings): Channel[] {
  const out: Channel[] = [];
  // the order the checkout lists them in (and the first is the one chosen): send-money first, then SSLCommerz's secure online payment.
  // Manual payment is only offered once the owner has entered somewhere to pay: a number to send money to, or the SSLCommerz payment link
  if (settings.payments.manual && manualReady(settings)) out.push("manual");
  if (settings.payments.sslcommerz && sslConfigured(env)) out.push("sslcommerz");
  if (settings.payments.bkash_direct && bkashConfigured(env)) out.push("bkash");
  if (mockEnabled(env)) out.push("mock");
  return out;
}

/** The owner has entered somewhere a manual payment can go: a number to send money to, or the shop's SSLCommerz payment link. */
export function manualReady(settings: Settings): boolean {
  return Object.values(settings.payments.manual_numbers).some((n) => !!n) || !!settings.payments.manual_link;
}

/** Where a manual (send-money) payment goes and how long the student has — shown in the quote and on the open order. */
export function manualPayInfo(settings: Settings): ManualPayInfo {
  const p = settings.payments;
  return { numbers: p.manual_numbers, link: p.manual_link, note_bn: p.manual_note_bn, note_en: p.manual_note_en, window_min: p.manual_window_min };
}

/** Plain-language connection status shown on the admin dashboard "Health check" strip. */
export function paymentHealth(env: Env, settings: Settings) {
  return {
    sslcommerz: { connected: sslConfigured(env), enabled: settings.payments.sslcommerz },
    bkash: { connected: bkashConfigured(env), enabled: settings.payments.bkash_direct },
    manual: {
      connected: manualReady(settings),
      enabled: settings.payments.manual,
    },
    mode: env.PAYMENT_MODE,
  };
}

/* ------- mock gateway signatures: the "webhook" is authenticated with an HMAC exactly like a real one ------- */
export async function mockSignature(env: Env, publicId: string, status: "paid" | "failed"): Promise<string> {
  return hmacHex(env.APP_SECRET, `mock:${publicId}:${status}`);
}

export async function mockVerify(env: Env, publicId: string, status: string, sig: string): Promise<boolean> {
  if (status !== "paid" && status !== "failed") return false;
  return timingSafeEqual(await mockSignature(env, publicId, status), sig);
}
