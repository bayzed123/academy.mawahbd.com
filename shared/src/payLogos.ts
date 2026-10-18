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

/** Which marks go with each way of paying on the checkout page (the hosted page takes the wallets and cards; send-money is the three wallets). */
export const CHANNEL_LOGOS: Record<"sslcommerz" | "bkash" | "manual" | "mock", readonly PayLogoKey[]> = {
  sslcommerz: ["bkash", "nagad", "rocket", "visa", "mastercard"],
  bkash: ["bkash"],
  manual: ["bkash", "nagad", "rocket"],
  mock: [],
};

/**
 * The ways of paying a buyer can tap on the checkout as soon as they choose the online payment — before SSLCommerz is asked anything — in the
 * order shown: mobile wallets first, then cards. A tap starts the payment and goes straight to that way of paying at SSLCommerz (its entry
 * in SSLCommerz's own list, matched by `viaOf`); one SSLCommerz does not offer the shop brings SSLCommerz's list instead.
 */
export const PAY_VIA = ["bkash", "nagad", "rocket", "upay", "visa", "mastercard", "amex"] as const;
export type PayVia = (typeof PAY_VIA)[number];
export const PAY_VIA_GROUP: Record<PayVia, "mobile" | "card"> = { bkash: "mobile", nagad: "mobile", rocket: "mobile", upay: "mobile", visa: "card", mastercard: "card", amex: "card" };
/** Brand names, the same in both languages */
export const PAY_VIA_NAME: Record<PayVia, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay", visa: "Visa", mastercard: "Mastercard", amex: "American Express" };

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
