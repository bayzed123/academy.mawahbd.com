/**
 * Which notifications count as new on the bell: the ones newer than the newest the person has seen (`seen`, an id), and not older than
 * FRESH_DAYS — a phone that never opened the bell (a new install) does not start with a month of old news marked new.
 */
export const FRESH_DAYS = 14;

export function unreadOf(items: readonly { id: number; created_at: string }[], seen: number, now: number = Date.now()): number {
  const since = now - FRESH_DAYS * 86_400_000;
  return items.filter((x) => x.id > seen && Date.parse(x.created_at) >= since).length;
}

/** What the badge says: the number, or "9+" (a phone shows a long count as a smudge). */
export function badgeText(n: number, digits: (v: number) => string): string {
  return n > 9 ? `${digits(9)}+` : digits(n);
}

/** The newest id of a list (0 for none): the bell remembers it once the list was looked at. */
export function newestId(items: readonly { id: number }[]): number {
  return items.reduce((m, x) => (x.id > m ? x.id : m), 0);
}
