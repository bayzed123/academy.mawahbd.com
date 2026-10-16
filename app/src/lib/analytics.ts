/*
 * Counting what students do (Google Analytics 4 — see docs/analytics.md for every event and what it carries).
 * The script that talks to Google (marketing/analytics.js) is added to this app only when the owner has set a measurement ID and the page
 * is on the real site; with no such script, track() does nothing. A visitor who said no (Do Not Track, the footer switch, Europe/UK until
 * they say yes) is never counted — the script decides, not this file. An error here must never reach the student.
 *
 * What goes in: class names, prices, order numbers, simple choices (the payment service, a rating). What never goes in: names, e-mail
 * addresses, phone numbers, addresses, passwords, or anything a student typed (the script also cuts out anything that looks like an
 * e-mail or a phone number).
 */
export type GaParams = Record<string, unknown>;

declare global {
  interface Window {
    mawahTrack?: (name: string, params?: GaParams) => void;
  }
}

export const CURRENCY = "BDT";

export function track(name: string, params?: GaParams): void {
  try {
    window.mawahTrack?.(name, params);
  } catch {
    /* counting never breaks the app */
  }
}

/** A class (or an order line) as Google Analytics wants an item. The class's address name (slug) is its id, as on the public pages. */
export function gaItem(i: { slug?: string; course_id?: number; id?: number; title_en?: string; title_bn?: string; price?: number }, extra: GaParams = {}): GaParams {
  return { item_id: i.slug ?? String(i.course_id ?? i.id ?? ""), item_name: i.title_en || i.title_bn || "", price: i.price ?? 0, quantity: 1, ...extra };
}

/** True the first time a key is seen on this device, false afterwards — so a sale is counted once however often the order page is opened. */
export function firstTime(key: string): boolean {
  try {
    const store = "mawah_ga_seen";
    const seen: string[] = JSON.parse(window.localStorage.getItem(store) || "[]");
    if (seen.includes(key)) return false;
    window.localStorage.setItem(store, JSON.stringify([...seen.slice(-59), key]));
    return true;
  } catch {
    return true;
  }
}
