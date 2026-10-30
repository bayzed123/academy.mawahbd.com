import { useEffect, useState } from "react";
import { THEME_COLOR, THEME_KEY } from "@mawah/shared";
import { useI18n } from "../lib/i18n";

/** Night or day, as the page is showing it now (set before the app started by the few words in the page's <head>: shared/src/theme.ts). */
const isLight = () => document.documentElement.getAttribute("data-theme") === "light";

function show(light: boolean) {
  const root = document.documentElement;
  if (light) root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[light ? "light" : "dark"]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", light ? "light" : "dark");
}

/**
 * The night / day switch in the app's header — the same button, the same choice and the same place to keep it (this browser) as on the
 * public site, so the look follows a visitor from the site into the app and back. Pressed = the day look.
 */
export function ThemeToggle() {
  const { t } = useI18n();
  const [light, setLight] = useState(isLight);

  // a change made in another tab (the site or the app) follows here too
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      show(e.newValue === "light");
      setLight(e.newValue === "light");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = () => {
    const next = !light;
    show(next);
    setLight(next);
    try {
      localStorage.setItem(THEME_KEY, next ? "light" : "dark");
    } catch {
      /* private mode: this page only */
    }
  };

  return (
    <button type="button" className="theme-toggle" aria-pressed={light} aria-label={t("app.theme.day")} title={t("app.theme.day")} onClick={toggle}>
      <svg className="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" />
      </svg>
      <svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
      </svg>
    </button>
  );
}
