/**
 * Night and day: the site and the student app open in the night look (shared/styles/dark.css); a visitor who pressed the sun button gets the
 * day look (shared/styles/light.css) on every page from then on. The choice lives in this browser only (localStorage, shared by the site and
 * the app: same address), so the cached pages stay the same for everyone.
 *
 * THEME_BOOT runs in <head>, before the page is drawn, so a page never flashes in the other look first. It is inline — the one inline script
 * the pages have — and the Content-Security-Policy allows exactly this text by its SHA-256 (worker/src/middleware/security.ts), nothing else.
 * It also gives the phone's address bar the page's colour, and tells the browser which way round the page is before its stylesheet arrives
 * (the student app's stylesheet is a file of its own: without this its first frame would be the wrong colour).
 */
export const THEME_KEY = "mawah_theme";
export type Theme = "dark" | "light";
/** The colour of the phone's address bar and of the page before it is drawn: the page's own background. */
export const THEME_COLOR: Record<Theme, string> = { dark: "#000000", light: "#ffffff" };

export const THEME_BOOT = `try{if(localStorage.getItem("${THEME_KEY}")==="light"){var d=document,m=d.querySelector('meta[name="theme-color"]'),c=d.querySelector('meta[name="color-scheme"]');d.documentElement.setAttribute("data-theme","light");if(m)m.setAttribute("content","${THEME_COLOR.light}");if(c)c.setAttribute("content","light")}}catch(e){}`;
