/**
 * The marks of the payment services, in the order shown: the footer's "We accept" row and the payment options on the checkout page. The three
 * mobile-wallet pictures are made by scripts/gen-pay-logos.mjs from the owner's own files (brand/pay/); Visa and Mastercard are small vector
 * files. `width` and `height` are each file's own size, so the browser keeps room for the picture before it arrives; CSS shows every logo
 * at a fixed height. worker/test/footer.test.ts checks these numbers against the real files.
 */
export const PAY_LOGOS = [
  { key: "bkash", src: "/pay/bkash.webp", width: 306, height: 72 },
  { key: "nagad", src: "/pay/nagad.webp", width: 206, height: 72 },
  { key: "rocket", src: "/pay/rocket.webp", width: 222, height: 72 },
  { key: "visa", src: "/pay/visa.svg", width: 93, height: 30 },
  { key: "mastercard", src: "/pay/mastercard.svg", width: 152, height: 94 },
] as const;

export type PayLogoKey = (typeof PAY_LOGOS)[number]["key"];

/**
 * SSLCommerz's own picture of the ways to pay ("Pay with … Verified by SSLCommerz"), as the owner sent it (brand/pay/payment.png, copied by
 * scripts/gen-pay-logos.mjs). It takes the place of the small marks — at the bottom of every page and on the online choice at checkout —
 * while SSLCommerz really takes payments here and the owner has not pasted SSLCommerz's own link to it (Settings → Payments, which wins).
 * `width` and `height` are the file's own size; worker/test/ssl-logo.test.ts checks them against the file.
 */
export const SSL_BANNER = { src: "/pay/sslcommerz.png", width: 640, height: 75 } as const;

/** Which marks go with each way of paying on the checkout page (the hosted page takes the wallets and cards; send-money is the three wallets). */
export const CHANNEL_LOGOS: Record<"sslcommerz" | "bkash" | "manual" | "mock", readonly PayLogoKey[]> = {
  sslcommerz: ["bkash", "nagad", "rocket", "visa", "mastercard"],
  bkash: ["bkash"],
  manual: ["bkash", "nagad", "rocket"],
  mock: [],
};

/**
 * The well-known ways of paying in SSLCommerz's list of the ways a store takes, which `viaOf` recognises: Settings → Payments → "Check the
 * connection" names them. The buyer chooses one on SSLCommerz's own page, never on this website.
 */
export const PAY_VIA = ["bkash", "nagad", "rocket", "upay", "visa", "mastercard", "amex"] as const;
export type PayVia = (typeof PAY_VIA)[number];

/**
 * Which of these an entry of SSLCommerz's list is — from its gateway code (`gw`), its name and its kind — or null for anything else (a bank,
 * another wallet, a local card scheme). Rocket is "DBBL Mobile Banking" there; a bank's own Visa or Mastercard gateway is still Visa or
 * Mastercard.
 */
export function viaOf(entry: { gw?: unknown; name?: unknown; type?: unknown }): PayVia | null {
  const text = `${typeof entry.gw === "string" ? entry.gw : ""} ${typeof entry.name === "string" ? entry.name : ""}`.toLowerCase();
  const kind = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
  if (text.includes("bkash")) return "bkash";
  if (text.includes("nagad")) return "nagad";
  if (/rocket|dbbl\s*mobile|dbblmobile/.test(text)) return "rocket";
  if (text.includes("upay")) return "upay";
  if (kind === "amex" || /amex|american\s*express/.test(text)) return "amex";
  if (kind === "master" || text.includes("master")) return "mastercard";
  if (kind === "visa" || text.includes("visa")) return "visa";
  return null;
}
