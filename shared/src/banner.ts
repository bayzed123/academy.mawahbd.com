import { BANNER_FOCUS, BANNER_LAYOUTS, BANNER_THEMES, CLASS_ICONS } from "./constants";

/**
 * What the owner chose for a banner's look (Admin → Banners), turned into the page's classes. Used by the public page and by the admin's
 * live preview, so both always agree. A value that is not one of the known ones is ignored (the page never trusts a class name it was
 * not given), and an empty choice adds nothing — the banner keeps the look it always had.
 */
const known = <T extends string>(list: readonly T[], v: string | null | undefined): T | null => (v && (list as readonly string[]).includes(v) ? (v as T) : null);

export interface BannerLook {
  theme?: string | null;
  layout?: string | null;
  focus?: string | null;
  icon?: string | null;
  image_key?: string | null;
}

/** `bn-t-<theme> bn-l-<layout> bn-f-<focus>` — the layout only for slides (a pop-up card has no layout). */
export function bannerDesign(b: BannerLook, withLayout: boolean): string {
  const theme = known(BANNER_THEMES, b.theme);
  const layout = withLayout ? known(BANNER_LAYOUTS, b.layout) : null;
  const focus = known(BANNER_FOCUS, b.focus);
  return [theme && `bn-t-${theme}`, layout && `bn-l-${layout}`, focus && `bn-f-${focus}`].filter(Boolean).join(" ");
}

/** The large line drawing of a banner with no picture (one of the class icons), or null. */
export function bannerIcon(b: BannerLook): string | null {
  return b.image_key ? null : known(CLASS_ICONS, b.icon);
}
