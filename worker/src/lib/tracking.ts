import { isProd, type Env } from "../env";
import { isOtherAddress } from "../middleware/host";
import type { Settings } from "./settings";

/*
 * Who may be measured, and where. The shop's visitors are counted by Google Analytics (and, if the owner sets them, Microsoft Clarity
 * and Meta Pixel) — but only on the REAL site: not on a developer's computer, not in the automatic tests, not on the free
 * workers.dev fallback address. Otherwise every test run and every deploy check would add made-up visits to the owner's numbers.
 * The IDs themselves are the owner's, typed in Admin → Settings → Analytics (they are public: any visitor can see them in the page).
 */

export interface TrackIds {
  ga4: string;
  clarity: string;
  pixel: string;
}

export const NO_TRACKING: TrackIds = { ga4: "", clarity: "", pixel: "" };

const safeId = (v: string, re: RegExp) => (re.test(v) ? v : "");

/** Is this request one that may be measured at all? */
export function measuringAllowed(env: Env, requestUrl: string): boolean {
  if (isProd(env)) return !isOtherAddress(env, requestUrl);
  // development and tests: off, unless a test asks for it (ANALYTICS_DEV in worker/.dev.vars — never honoured in production)
  return env.ANALYTICS_DEV === "true";
}

/** The IDs to put in a page for this request: the owner's settings, if the request may be measured; nothing otherwise. */
export function trackingFor(env: Env, requestUrl: string, settings: Settings): TrackIds {
  if (!measuringAllowed(env, requestUrl)) return NO_TRACKING;
  const a = settings.analytics;
  return {
    ga4: safeId(a.ga4.trim(), /^G-[A-Z0-9]{4,20}$/),
    clarity: safeId(a.clarity.trim(), /^[a-z0-9]{6,20}$/i),
    pixel: safeId(a.meta_pixel.trim(), /^\d{8,20}$/),
  };
}

export const isTracking = (t: TrackIds) => !!(t.ga4 || t.clarity || t.pixel);

/**
 * Visitors who must be asked before they are measured: the European Union, the rest of the European Economic Area, the United
 * Kingdom and Switzerland (their laws want a "yes" first), and Tor users (T1), who have asked not to be known. Everywhere else the
 * visitor is measured unless they say no (the footer link, "Do Not Track" and "Global Privacy Control" are all honoured).
 */
const ASK_FIRST = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", // EU
  "IS", "LI", "NO", // the rest of the EEA
  "GB", "CH",
  "T1",
  // places Cloudflare reports under their own code although their law is the EU's or the UK's: the EU as a whole, the French overseas regions, Åland,
  // Saint-Barthélemy and Saint-Martin, Gibraltar and the three Crown Dependencies
  "EU", "RE", "GP", "MQ", "GF", "YT", "BL", "MF", "AX", "GI", "GG", "JE", "IM",
]);

/**
 * `eu` = ask first, `row` = the rest of the world. Cloudflare puts the visitor's country in the CF-IPCountry header ("XX" when it does not know).
 * When the country is not known, `whenUnknown` decides: the real site asks first (counting someone who should have been asked is the mistake
 * to avoid), a developer's machine, which has no such header, does not.
 */
export const regionOf = (country: string | null | undefined, whenUnknown: "eu" | "row" = "row"): "eu" | "row" => {
  const c = (country ?? "").trim().toUpperCase();
  if (!c || c === "XX") return whenUnknown;
  return ASK_FIRST.has(c) ? "eu" : "row";
};
