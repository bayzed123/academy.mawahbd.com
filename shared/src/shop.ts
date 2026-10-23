/**
 * The tools shop (/shop): what the Worker, the student app and the admin share — the shapes of a product, a cart and an order, and the
 * few rules that must be the same everywhere (how many of one thing fit in a cart, the order steps, the discount).
 */

/** At most this many of one weight or size in one order, and this many different lines. */
export const SHOP_MAX_QTY = 20;
export const SHOP_MAX_LINES = 30;
/** Products per page in the shop's grid. */
export const SHOP_PER_PAGE = 12;
/** Pictures per product. */
export const SHOP_MAX_PICTURES = 8;

export type ShopPayment = "cod" | "sslcommerz";
export type ShopOrderStatus = "pending" | "placed" | "paid" | "review" | "confirmed" | "shipped" | "delivered" | "cancelled" | "failed" | "refunded";
export const SHOP_ORDER_STATUSES: readonly ShopOrderStatus[] = ["pending", "placed", "paid", "review", "confirmed", "shipped", "delivered", "cancelled", "failed", "refunded"];

/** Where staff may move an order from each step (anything else is refused). */
export const SHOP_NEXT: Record<ShopOrderStatus, readonly ShopOrderStatus[]> = {
  pending: ["cancelled"],
  placed: ["confirmed", "cancelled"],
  paid: ["confirmed", "cancelled"],
  // SSLCommerz took the money but marked it risky: staff look in the SSLCommerz panel, then confirm it or cancel (and refund) it
  review: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
  failed: [],
  refunded: [],
};

/** "-20%" when the usual price is above the price (rounded down, never 0%); null otherwise. */
export function percentOff(price: number, listPrice: number): number | null {
  if (!(listPrice > price) || price <= 0) return null;
  const p = Math.floor(((listPrice - price) / listPrice) * 100);
  return p >= 1 ? p : null;
}

export interface ShopCategoryDTO {
  id: number;
  slug: string;
  name_bn: string;
  name_en: string;
  /** published products in it */
  count: number;
}

export interface ShopVariantDTO {
  id: number;
  label_bn: string;
  label_en: string;
  price: number;
  list_price: number;
  /** null = not counted */
  stock: number | null;
  in_stock: boolean;
}

/** A product in the grid: the cheapest weight's price ("from ৳120" when there are several). */
export interface ShopCardDTO {
  id: number;
  slug: string;
  name_bn: string;
  name_en: string;
  short_bn: string;
  short_en: string;
  category_slug: string | null;
  image: string | null;
  price: number;
  list_price: number;
  /** more than one weight or size: the card says "from" and its button opens the product to choose */
  several: boolean;
  /** the one weight there is, for "Add to cart" right on the card */
  variant_id: number | null;
  in_stock: boolean;
  rating: number | null;
  reviews: number;
}

export interface ShopReviewDTO {
  id: number;
  name: string;
  rating: number;
  body: string;
  verified: boolean;
  created_at: string;
}

export interface ShopProductDTO extends ShopCardDTO {
  body_bn: string;
  body_en: string;
  category: { slug: string; name_bn: string; name_en: string } | null;
  images: { large: string; small: string }[];
  variants: ShopVariantDTO[];
}

/** One line of a cart, as the browser keeps it. */
export interface ShopCartLine {
  variant_id: number;
  qty: number;
}

/** A cart priced by the Worker: what is really for sale now, at today's price. */
export interface ShopQuoteDTO {
  lines: {
    variant_id: number;
    product_slug: string;
    name_bn: string;
    name_en: string;
    label_bn: string;
    label_en: string;
    image: string | null;
    price: number;
    list_price: number;
    qty: number;
    /** fewer than asked are left (or none): the cart is set to what there is */
    limited: boolean;
  }[];
  /** lines that cannot be bought any more (taken off sale, or none left) */
  gone: number[];
  subtotal: number;
  /** null until a district is chosen */
  delivery_fee: number | null;
  total: number;
  /** the ways to pay this order can use */
  payments: ShopPayment[];
  /** free delivery from this much (0 = never) */
  free_over: number;
}

export interface ShopOrderDTO {
  public_id: string;
  status: ShopOrderStatus;
  payment: ShopPayment;
  subtotal: number;
  delivery_fee: number;
  total: number;
  name: string;
  phone: string;
  email: string;
  place: string;
  address: string;
  note: string;
  courier_ref: string;
  created_at: string;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  items: { product_slug: string | null; name_bn: string; name_en: string; label_bn: string; label_en: string; price: number; qty: number }[];
}

export interface GeoPlaceDTO {
  id: number;
  name_en: string;
  name_bn: string;
}
