import type { PageCtx } from "./ctx";

/*
 * What the analytics script is told about a class. One shape everywhere (cards, the class page, the app's checkout), so the same class
 * is the same "item" in Google Analytics whichever page it was seen on. Only public facts: the address name of the class (its slug), its
 * name, its category and its price. English names are used on purpose, so the owner's Google reports read the same in either language.
 */
export interface GaItem {
  item_id: string;
  item_name: string;
  item_category?: string;
  price: number;
}

interface ClassLike {
  slug: string;
  title_en: string;
  title_bn: string;
  price: number;
  category?: { name_en: string; name_bn: string } | null;
}

export function gaItem(c: ClassLike): GaItem {
  const category = c.category ? c.category.name_en || c.category.name_bn : "";
  return { item_id: c.slug, item_name: c.title_en || c.title_bn, ...(category ? { item_category: category } : {}), price: c.price };
}

/** The attribute that marks a card as a class (written only when this request is measured, so a page nobody measures stays as light as before). */
export const gaCardAttr = (ctx: PageCtx, c: ClassLike): Record<string, string> => (ctx.track.ga4 ? { "data-ga-item": JSON.stringify(gaItem(c)) } : {});

/** The attribute that marks a group of cards as one list ("home_featured", "classes", "related"). */
export const gaListAttr = (ctx: PageCtx, id: string): Record<string, string> => (ctx.track.ga4 ? { "data-ga-list": id } : {});
