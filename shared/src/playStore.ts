/**
 * The Android app's page on Google Play, as the owner pastes it (Admin → Android app → On the website). Only an app's own Play page is
 * taken — https://play.google.com/store/apps/details?id=<package> — and it comes back tidied: the package and, when given, the page's
 * language; whatever else was copied along (tracking bits, a referrer) is left off. Anything else is null.
 */
export const ANDROID_PACKAGE = "com.mawahacademy.app";

const PACKAGE = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/;

export function playStoreUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "play.google.com" || u.pathname.replace(/\/+$/, "") !== "/store/apps/details") return null;
  const id = u.searchParams.get("id") ?? "";
  if (!PACKAGE.test(id) || id.length > 150) return null;
  const hl = u.searchParams.get("hl");
  return `https://play.google.com/store/apps/details?id=${id}${hl && /^[a-zA-Z]{2,3}(?:[-_][a-zA-Z]{2,4})?$/.test(hl) ? `&hl=${hl}` : ""}`;
}

/** The address the app's Play page will have — shown to the owner as an example of what to paste. */
export const PLAY_URL_EXAMPLE = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
