/**
 * A class's offer as the pages show it: the price now, the regular price crossed out, the saving in per cent, and when it ends (null =
 * it runs until the owner removes it). `on` is false when there is no offer (the price is the regular price).
 */
export interface OfferView {
  on: boolean;
  price: number;
  regular: number;
  /** whole per cent, never shown as 0 (a saving under 1% is shown as 1%) */
  pct: number;
  ends_at: string | null;
}

export function offerView(c: { price: number; regular_price?: number | null; offer_ends_at?: string | null }): OfferView {
  const regular = c.regular_price ?? c.price;
  const on = regular > c.price && c.price > 0;
  return { on, price: c.price, regular, pct: on ? Math.max(1, Math.round(((regular - c.price) / regular) * 100)) : 0, ends_at: on ? (c.offer_ends_at ?? null) : null };
}
