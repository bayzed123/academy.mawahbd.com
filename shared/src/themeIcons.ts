/**
 * The night / day button's two drawn icons (24×24 line drawings like the site's other icons; their stroke is set in
 * shared/styles/theme-toggle.css): a moon by night, a sun by day. They are written into the button itself rather than taken from
 * /sprite.svg, which a browser may keep for a day — with an older copy a visitor would see an empty button on a phone, where the
 * button has no words.
 */
export const THEME_ICON = {
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  sun: "M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
} as const;
