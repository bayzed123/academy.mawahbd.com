import { BUILTIN_QR, type BanglaQrInfo, type Channel, type ManualPayInfo } from "@mawah/shared";
import { isProd, type Env } from "../../env";
import { hmacHex, timingSafeEqual } from "../../lib/crypto";
import type { Settings } from "../../lib/settings";
import { sslConfigured } from "./sslcommerz";

/** An uploaded Bangla QR picture (Admin → Settings → Payments): the content-hash key the image upload gives, in its own folder. */
export const QR_IMAGE_KEY = /^payments\/[a-f0-9]{32}\.(?:png|jpg|webp|avif)$/;

/** The simulated gateway exists ONLY for local development and automated tests — never in production. */
export function mockEnabled(env: Env): boolean {
  return !isProd(env) && env.ALLOW_MOCK_PAYMENTS === "true";
}

/**
 * Channels the student can pick right now = switched on in Admin → Settings → Payments AND ready. The checkout lists them in this order (the
 * first is the one chosen): send money to the shop's number, SSLCommerz's automatic online payment, the shop's Bangla QR. Nothing else.
 */
export function availableChannels(env: Env, settings: Settings): Channel[] {
  const out: Channel[] = [];
  // send-money once the owner has given a number to send it to; SSLCommerz once its keys are set; Bangla QR whenever it is Active (its QR is built in)
  if (settings.payments.manual && manualReady(settings)) out.push("manual");
  if (settings.payments.sslcommerz && sslConfigured(env)) out.push("sslcommerz");
  if (settings.payments.bangla_qr) out.push("bangla_qr");
  if (mockEnabled(env)) out.push("mock");
  return out;
}

/** The owner has given a number to send money to (bKash, Nagad or Rocket). */
export function manualReady(settings: Settings): boolean {
  return Object.values(settings.payments.manual_numbers).some((n) => !!n);
}

/** The picture of the shop's Bangla QR: the one uploaded in Settings → Payments, else the shop's own built-in QR. */
export function qrImage(settings: Settings): string {
  const key = settings.payments.qr_image;
  return QR_IMAGE_KEY.test(key) ? `/media/${key}` : BUILTIN_QR.src;
}

/** The shop's Bangla QR while it is Active; null while Inactive. */
export function qrInfo(settings: Settings): BanglaQrInfo | null {
  const p = settings.payments;
  return p.bangla_qr ? { image: qrImage(settings), name: p.qr_name } : null;
}

/** Where a manual payment goes (the numbers, or the Bangla QR) and how long the student has — shown in the quote and on the open order. */
export function manualPayInfo(settings: Settings): ManualPayInfo {
  const p = settings.payments;
  return { numbers: p.manual_numbers, note_bn: p.manual_note_bn, note_en: p.manual_note_en, window_min: p.manual_window_min, qr: qrInfo(settings) };
}

/** Plain-language connection status shown on the admin dashboard "Health check" strip. */
export function paymentHealth(env: Env, settings: Settings) {
  return {
    sslcommerz: { connected: sslConfigured(env), enabled: settings.payments.sslcommerz },
    manual: { connected: manualReady(settings), enabled: settings.payments.manual },
    bangla_qr: { connected: true, enabled: settings.payments.bangla_qr },
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
