/**
 * The marks in the footer's "We accept" row, in the order shown. The three mobile-wallet pictures are made by
 * scripts/gen-pay-logos.mjs from the owner's own files (brand/pay/); Visa and Mastercard are small vector files.
 * `width` and `height` are each file's own size, so the browser keeps room for the picture before it arrives; CSS shows every
 * logo 24px tall. worker/test/footer.test.ts checks these numbers against the real files.
 */
export const PAY_LOGOS = [
  { key: "bkash", src: "/pay/bkash.webp", width: 306, height: 72 },
  { key: "nagad", src: "/pay/nagad.webp", width: 206, height: 72 },
  { key: "rocket", src: "/pay/rocket.webp", width: 222, height: 72 },
  { key: "visa", src: "/pay/visa.svg", width: 93, height: 30 },
  { key: "mastercard", src: "/pay/mastercard.svg", width: 152, height: 94 },
] as const;

/** Who built the site: the credit line in the footer (the owner asked for it). */
export const DEVELOPER = { name: "Sayad Bayezid", url: "https://sayadbayezid.com" } as const;
