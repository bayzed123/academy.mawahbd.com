import { toDhaka, type BannerPlacement } from "@mawah/shared";
import type { Env } from "../env";
import { all } from "../lib/db";
import { contentVersion } from "../lib/settings";

/** What the public pages need to draw a banner (the admin sees the whole row). */
export interface BannerDTO {
  id: number;
  placement: BannerPlacement;
  title_bn: string;
  title_en: string;
  text_bn: string;
  text_en: string;
  image_key: string | null;
  mobile_image_key: string | null;
  alt_bn: string;
  alt_en: string;
  button_bn: string;
  button_en: string;
  link_url: string;
  new_tab: number;
  popup_delay_sec: number;
  popup_repeat_days: number;
  popup_pages: "home" | "all";
  /** changes whenever the owner edits the banner: an edited pop-up is shown again to people who closed the old one */
  updated_at: string;
}

const COLS =
  "id, placement, title_bn, title_en, text_bn, text_en, image_key, mobile_image_key, alt_bn, alt_en, button_bn, button_en, link_url, new_tab, popup_delay_sec, popup_repeat_days, popup_pages, updated_at";

/** Today in Bangladesh as "YYYY-MM-DD": the day banners start and end on. */
export const dhakaToday = (now: Date = new Date()) => toDhaka(now).toISOString().slice(0, 10);

/** The banners that may be shown today: switched on, not deleted, inside their dates (both end days included). */
export async function liveBanners(env: Env, placement: BannerPlacement, limit: number): Promise<BannerDTO[]> {
  const today = dhakaToday();
  return all<BannerDTO>(
    env.DB,
    `SELECT ${COLS} FROM banners
     WHERE placement = ? AND active = 1 AND deleted_at IS NULL AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
     ORDER BY sort, id LIMIT ?`,
    placement,
    today,
    today,
    limit,
  );
}

/** Pages that are documents (certificates, verification) or part of paying never get a pop-up. */
const NO_POPUP = ["/certificate", "/verify", "/invoice"];

let memo: { cv: string; day: string; at: number; popups: BannerDTO[] } | null = null;

/**
 * The offer pop-up for a page, or null. Every public page asks, so the list of live pop-ups is kept for a minute per isolate —
 * but only while the content version and the day are the same, so an edit (or midnight) is never served from the memo.
 */
export async function popupFor(env: Env, path: string): Promise<BannerDTO | null> {
  if (NO_POPUP.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  const cv = await contentVersion(env);
  const day = dhakaToday();
  if (!memo || memo.cv !== cv || memo.day !== day || Date.now() - memo.at > 60_000) {
    memo = { cv, day, at: Date.now(), popups: await liveBanners(env, "popup", 5) };
  }
  return memo.popups.find((b) => b.popup_pages === "all" || path === "/") ?? null;
}

/** Test helper: forget the in-isolate memo. */
export function resetBannerCache(): void {
  memo = null;
}
