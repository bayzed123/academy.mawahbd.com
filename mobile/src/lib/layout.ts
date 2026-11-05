/**
 * Tablets: the screens keep a phone-like column in the middle (at most CONTENT_MAX wide, like a page of a book) instead of stretching a
 * card or a line of text across 25 cm, and the shop shows more products in a row. Phones use their full width, as before.
 */
export const CONTENT_MAX = 760;
/** the space on each side of a screen's content */
export const GUTTER = 16;
const GAP = 12;

/** The width of the content column in a window this wide. */
export function contentWidth(windowWidth: number): number {
  return Math.max(0, Math.min(windowWidth, CONTENT_MAX + GUTTER * 2) - GUTTER * 2);
}

/** Product tiles in a row of the content column: 2 on a phone, 3 on a small tablet (or a phone on its side), 4 on a large one. */
export function gridColumns(width: number): number {
  return width >= 700 ? 4 : width >= 520 ? 3 : 2;
}

/** The width of one tile when `columns` of them share `width`, with the usual gap between them. */
export function tileWidth(width: number, columns: number, gap = GAP): number {
  return Math.floor((width - gap * (columns - 1)) / columns);
}
