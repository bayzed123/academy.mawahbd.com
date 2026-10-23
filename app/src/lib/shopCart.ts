import { SHOP_MAX_LINES, SHOP_MAX_QTY, type ShopCartLine } from "@mawah/shared";

/*
 * The tools-shop cart and wishlist, kept in this browser exactly as the shop's pages keep them (marketing/shop.js): the same keys, only
 * variant ids and quantities (the wishlist: product ids). Every name and price comes from the Worker (/api/shop/quote).
 */
const CART = "mawah_cart";
const WISH = "mawah_wish";
/** the order the cart was turned into: it is emptied once that order is placed or paid */
const PLACED = "mawah_cart_order";

function read<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage refused: the cart simply does not persist */
  }
}

export function readCart(): ShopCartLine[] {
  return read<ShopCartLine>(CART)
    .filter((l) => l && Number.isInteger(l.variant_id) && l.variant_id > 0 && Number.isInteger(l.qty) && l.qty > 0)
    .map((l) => ({ variant_id: l.variant_id, qty: Math.min(SHOP_MAX_QTY, l.qty) }))
    .slice(0, SHOP_MAX_LINES);
}
export const writeCart = (lines: ShopCartLine[]) => write(CART, lines.filter((l) => l.qty > 0));
export const clearCart = () => write(CART, []);

export function addToCart(variantId: number, qty = 1): boolean {
  const lines = readCart();
  const line = lines.find((l) => l.variant_id === variantId);
  if (line) line.qty = Math.min(SHOP_MAX_QTY, line.qty + qty);
  else if (lines.length >= SHOP_MAX_LINES) return false;
  else lines.push({ variant_id: variantId, qty: Math.min(SHOP_MAX_QTY, qty) });
  writeCart(lines);
  return true;
}

export const readWish = () => read<number>(WISH).filter((id) => Number.isInteger(id) && id > 0);
export const writeWish = (ids: number[]) => write(WISH, ids.slice(0, 60));

export function markPlaced(publicId: string) {
  try {
    localStorage.setItem(PLACED, publicId);
  } catch {
    /* ignore */
  }
}
/** The order `publicId` went through: the cart it came from is emptied (once). */
export function placedDone(publicId: string) {
  try {
    if (localStorage.getItem(PLACED) === publicId) {
      clearCart();
      localStorage.removeItem(PLACED);
    }
  } catch {
    /* ignore */
  }
}

/*
 * The key of each order placed from this browser (its link's ?k=): SSLCommerz sends the buyer back to the order's page without it — the
 * key is never put in an address the Worker hands to whoever knows an order's code — and the page finds it here.
 */
const KEYS = "mawah_shop_keys";
export function rememberOrderKey(publicId: string, key: string) {
  if (!publicId || !key) return;
  try {
    const all = JSON.parse(localStorage.getItem(KEYS) ?? "{}") as Record<string, string>;
    const next = Object.fromEntries([[publicId, key], ...Object.entries(all).filter(([k]) => k !== publicId)].slice(0, 20));
    localStorage.setItem(KEYS, JSON.stringify(next));
  } catch {
    /* storage refused: the link with its key still opens the order */
  }
}
export function orderKey(publicId: string): string {
  try {
    const v = (JSON.parse(localStorage.getItem(KEYS) ?? "{}") as Record<string, unknown>)[publicId];
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}
