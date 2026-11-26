/*
 * A class's price, in one place. A class has its regular `price` and may have an offer (`offer_price`, ending at `offer_ends_at` or never;
 * migration 0032). While the offer runs it is the price the class sells at — on the cards, the class page, the checkout and the order —
 * and the regular price is shown crossed out beside it. Every query that shows or charges a class's price takes it from here, so what a
 * page shows is always what the checkout charges.
 */

/** SQL: the moment the query runs, in the format offer_ends_at is stored in */
const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";

/** SQL: the class's offer is running (lower than its price, and not ended). `a` is the courses table's alias in the query. */
export const OFFER_ON = (a = "c") => `(${a}.offer_price IS NOT NULL AND ${a}.offer_price < ${a}.price AND (${a}.offer_ends_at IS NULL OR ${a}.offer_ends_at > ${NOW}))`;

/** SQL: the price the class sells at now — the offer while it runs, else the regular price. */
export const SELL_PRICE = (a = "c") => `(CASE WHEN ${OFFER_ON(a)} THEN ${a}.offer_price ELSE ${a}.price END)`;

/** SQL columns: `price` (the price now), `regular_price`, and `offer_ends_at` (only while an offer with an end runs). */
export const PRICE_COLUMNS = (a = "c") => `${SELL_PRICE(a)} AS price, ${a}.price AS regular_price, CASE WHEN ${OFFER_ON(a)} THEN ${a}.offer_ends_at END AS offer_ends_at`;

/** "2026-11-20T17:59" (from an admin form, any ISO form) → "2026-11-20T17:59:00Z": the one format the SQL above compares against. */
export function offerEnd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}
