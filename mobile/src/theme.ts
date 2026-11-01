import type { TextStyle } from "react-native";

/**
 * The app's two looks, taken from the website (shared/styles/dark.css and theme.css):
 *  - night (the default, like the website): a pitch-black page, flat dark-grey cards with a thin see-through edge, one solid orange
 *  - day: warm ivory, white cards, the brand's red
 * Text on the orange is near-black (white on #FF5722 is only 3.2:1); every pair below keeps WCAG AA contrast.
 */
export type Look = "night" | "day";

export interface Palette {
  look: Look;
  bg: string;
  surface: string;
  raised: string;
  line: string;
  line2: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  accentPressed: string;
  /** the accent, faint: behind the selected tab's icon */
  accentSoft: string;
  onAccent: string;
  link: string;
  ok: string;
  okBg: string;
  bad: string;
  badBg: string;
  skeleton: string;
  scrim: string;
}

export const PALETTES: Record<Look, Palette> = {
  night: {
    look: "night",
    bg: "#000000",
    surface: "#121212",
    raised: "#1a1a1a",
    line: "rgba(255,255,255,0.09)",
    line2: "rgba(255,255,255,0.16)",
    text: "#f5f5f5",
    text2: "#cccccc",
    text3: "#a3a3a3",
    accent: "#ff5722",
    accentPressed: "#ff6a3d",
    accentSoft: "rgba(255,87,34,0.16)",
    onAccent: "#0a0a0a",
    link: "#ff7b45",
    ok: "#34d399",
    okBg: "#0f2418",
    bad: "#ff7066",
    badBg: "#2a0f10",
    skeleton: "#1f1f1f",
    scrim: "rgba(0,0,0,0.55)",
  },
  day: {
    look: "day",
    bg: "#fbf7ee",
    surface: "#fffdf8",
    raised: "#f1eadc",
    line: "#e7dfca",
    line2: "#d9cfb4",
    text: "#1b1213",
    text2: "#4a3d3e",
    text3: "#6d5f60",
    accent: "#db1718",
    accentPressed: "#b50f12",
    accentSoft: "rgba(219,23,24,0.10)",
    onAccent: "#ffffff",
    link: "#b50f12",
    ok: "#1b6b40",
    okBg: "#ecf8f1",
    bad: "#b50f12",
    badBg: "#fef3f1",
    skeleton: "#ece4d3",
    scrim: "rgba(27,18,19,0.45)",
  },
};

/** Hind Siliguri, the website's font: it has both Bangla and English letters. */
export const FONT = {
  regular: "HindSiliguri_400Regular",
  semibold: "HindSiliguri_600SemiBold",
  bold: "HindSiliguri_700Bold",
} as const;

export type TextVariant = "display" | "title" | "heading" | "body" | "small" | "tiny" | "label";

/** Bangla letters stand taller than English ones, so every size has generous line height (no clipped vowel signs). */
export const TYPE: Record<TextVariant, TextStyle> = {
  display: { fontFamily: FONT.bold, fontSize: 26, lineHeight: 38 },
  title: { fontFamily: FONT.bold, fontSize: 20, lineHeight: 30 },
  heading: { fontFamily: FONT.semibold, fontSize: 16.5, lineHeight: 25 },
  body: { fontFamily: FONT.regular, fontSize: 15, lineHeight: 23 },
  small: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 20 },
  tiny: { fontFamily: FONT.semibold, fontSize: 11.5, lineHeight: 17 },
  label: { fontFamily: FONT.semibold, fontSize: 14, lineHeight: 21 },
};

export const RADIUS = { s: 10, m: 14, l: 20, pill: 999 } as const;
export const SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
