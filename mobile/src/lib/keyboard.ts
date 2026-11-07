/*
 * Keeping the box one types in above the phone's keyboard (src/ui/KeyboardScroll.tsx). The app draws edge to edge (Android 15 and later
 * always do), so Android no longer shrinks the screen for the keyboard: the screen itself must make room, and scroll the box into view.
 * The arithmetic is here, apart from the screen, so it can be tested.
 */

/** How much of a view (where its top is on the screen, and its height) the keyboard covers when the keyboard's top edge is at `keyboardTop`. */
export function keyboardOverlap(view: { top: number; height: number }, keyboardTop: number): number {
  if (!(view.height > 0) || !Number.isFinite(keyboardTop)) return 0;
  return Math.max(0, Math.round(view.top + view.height - keyboardTop));
}

/** Room kept above the box (its label) and below it (its error or hint) when it is scrolled into view. */
export const REVEAL_MARGIN = { above: 40, below: 56 } as const;

/**
 * Where to scroll so the box being typed in is in clear view, or null when it already is. `offset`: how far the view is scrolled now;
 * `viewTop`–`viewBottom`: the part of the screen the view shows (its bottom is the keyboard's top, or the view's own bottom when that is
 * higher); `fieldTop`–`fieldBottom`: where the box is on the screen now. A box taller than the room shows its top.
 */
export function revealOffset(
  a: { offset: number; viewTop: number; viewBottom: number; fieldTop: number; fieldBottom: number },
  margin: { above: number; below: number } = REVEAL_MARGIN,
): number | null {
  const room = a.viewBottom - a.viewTop;
  if (!(room > 0) || !(a.fieldBottom >= a.fieldTop)) return null;
  const tooTall = a.fieldBottom - a.fieldTop + margin.above + margin.below > room;
  const under = a.fieldBottom + margin.below - a.viewBottom; // > 0: the box (or its message) is behind the keyboard
  if (under > 0) return Math.max(0, Math.round(a.offset + (tooTall ? a.fieldTop - margin.above - a.viewTop : under)));
  const over = a.viewTop - (a.fieldTop - margin.above); // > 0: the box (or its label) is above what the view shows
  if (over > 0) return Math.max(0, Math.round(a.offset - over));
  return null;
}
