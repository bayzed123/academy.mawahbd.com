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
