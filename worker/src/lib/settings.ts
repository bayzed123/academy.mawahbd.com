import { MANUAL_WINDOW_DEFAULT_MIN, type NotifyKind } from "@mawah/shared";
import { ABOUT_TEXT, PAGE_TEXTS } from "../content/pageTexts";
import type { Env } from "../env";
import { all, nowIso, run, safeJson } from "./db";

/** Typed, defaulted view over the key/value `settings` table (everything is editable in Admin → Settings). */
export interface Settings {
  /** how to reach the shop; and the registered address and trade licence number, as on the trade licence — every page's footer, the Contact and
   * About pages show them (SSLCommerz asks for them) */
  contact: {
    whatsapp: string;
    phone: string;
    email: string;
    facebook: string;
    /** the Messenger chat of the owner's page (an m.me/… address); empty = worked out from `facebook` when that is the page's own address */
    messenger: string;
    youtube: string;
    instagram: string;
    address_bn: string;
    address_en: string;
    trade_license: string;
  };
  /**
   * the bar at the very top of every page: the owner's words, and — when the owner sets them — a countdown to the end of the offer
   * (`ends_at`, a minute of Bangladesh time like "2026-10-31T23:59"; once it has passed the bar is gone) and a button (a page of this
   * site or an https address, the same rules as a banner's button)
   */
  announcement: { bn: string; en: string; ends_at: string; button_bn: string; button_en: string; link: string };
  payments: {
    sslcommerz: boolean;
    bkash_direct: boolean;
    manual: boolean;
    manual_numbers: { bkash: string; nagad: string; rocket: string };
    manual_note_bn: string;
    manual_note_en: string;
    /** minutes a student is asked to pay within after choosing manual payment */
    manual_window_min: number;
    /** what SSLCommerz gave the shop to show its logo (a link, or its few lines of HTML) — read by readSslLogo; empty = not shown */
    ssl_logo: string;
    /**
     * the shop's payment link from the SSLCommerz panel (its own payment page, e.g. https://invoice.sslcommerz.com/invoice-form?refer=…):
     * one more way under manual payment — the student pays there and sends the transaction ID, staff check it in the SSLCommerz panel.
     * Only an https address on sslcommerz.com is stored (sslcommerzUrl); empty = not offered.
     */
    manual_link: string;
  };
  /** the policy and help pages (Markdown); until the owner writes their own, the site's texts (content/pageTexts.ts) */
  policies: {
    refund_bn: string;
    refund_en: string;
    privacy_bn: string;
    privacy_en: string;
    terms_bn: string;
    terms_en: string;
    delivery_bn: string;
    delivery_en: string;
    guide_bn: string;
    guide_en: string;
    order_bn: string;
    order_en: string;
    hotline_bn: string;
    hotline_en: string;
    /** the tools shop's own pages: terms (ordering, delivery, paying, cancelling) and return & refund for products */
    shop_terms_bn: string;
    shop_terms_en: string;
    shop_returns_bn: string;
    shop_returns_en: string;
  };
  about: { bn: string; en: string };
  analytics: { ga4: string; clarity: string; meta_pixel: string };
  chatbot: { enabled: boolean; greeting_bn: string; greeting_en: string; faq_bn: string; faq_en: string };
  /**
   * the Shop item of the menus, the footer, the class list and the student app (see menuShop): the Equipment Shop on this website, or —
   * when the owner gives an address — another shop of theirs, opened in a new tab. The names are that other shop's.
   */
  shop: { enabled: boolean; url: string; label_bn: string; label_en: string };
  /**
   * the tools shop on this website (/shop): closed until the owner opens it, with the delivery charges set (or free delivery chosen).
   * Delivery costs `fee_home` inside the home district (the shop's own, from the trade licence: Chattogram) and `fee_other` elsewhere;
   * nothing from `free_over` taka (0 = never). `cod` = cash on delivery, `online` = SSLCommerz (needs the store keys).
   */
  store: {
    enabled: boolean;
    cod: boolean;
    online: boolean;
    home_district: number;
    fee_home: number;
    fee_other: number;
    free_over: number;
    free_delivery: boolean;
    /** how long delivery takes, in the owner's words ("2–3 days inside Chattogram, 3–5 days elsewhere") — shown at checkout */
    delivery_bn: string;
    delivery_en: string;
  };
  /** who is e-mailed about what happens on the site (payments, messages, questions …); no addresses = the default one from NOTIFY_EMAIL */
  notifications: { emails: string[]; off: NotifyKind[] };
  /** text messages to students (Admin → Settings → SMS): the sender name the SMS company approved, and when messages go out */
  sms: { enabled: boolean; sender_id: string; with_email: boolean };
  onboarding: { dismissed: boolean };
}

/** The shop's e-Trade Licence (Chattogram City Corporation, valid until 30 June 2027): its number and the registered address written on it. */
export const TRADE_LICENCE = {
  trade_license: "TRADICHTG/010407/2022",
  address_bn: "রোড নং-০৩, বাড়ী # ৪২, বি-ব্লক, চান্দগাঁও, চট্টগ্রাম",
  address_en: "Road No. 03, House # 42, Block B, Chandgaon, Chattogram, Bangladesh",
};

export const SETTING_DEFAULTS: Settings = {
  contact: { whatsapp: "", phone: "", email: "", facebook: "", messenger: "", youtube: "", instagram: "", ...TRADE_LICENCE },
  announcement: { bn: "", en: "", ends_at: "", button_bn: "", button_en: "", link: "" },
  payments: {
    sslcommerz: true,
    bkash_direct: false,
    manual: true,
    manual_numbers: { bkash: "", nagad: "", rocket: "" },
    manual_note_bn: "",
    manual_note_en: "",
    manual_window_min: MANUAL_WINDOW_DEFAULT_MIN,
    ssl_logo: "",
    manual_link: "",
  },
  policies: {
    refund_bn: PAGE_TEXTS.refund.bn,
    refund_en: PAGE_TEXTS.refund.en,
    privacy_bn: PAGE_TEXTS.privacy.bn,
    privacy_en: PAGE_TEXTS.privacy.en,
    terms_bn: PAGE_TEXTS.terms.bn,
    terms_en: PAGE_TEXTS.terms.en,
    delivery_bn: PAGE_TEXTS.delivery.bn,
    delivery_en: PAGE_TEXTS.delivery.en,
    guide_bn: PAGE_TEXTS.guide.bn,
    guide_en: PAGE_TEXTS.guide.en,
    order_bn: PAGE_TEXTS.order.bn,
    order_en: PAGE_TEXTS.order.en,
    hotline_bn: PAGE_TEXTS.hotline.bn,
    hotline_en: PAGE_TEXTS.hotline.en,
    shop_terms_bn: PAGE_TEXTS.shop_terms.bn,
    shop_terms_en: PAGE_TEXTS.shop_terms.en,
    shop_returns_bn: PAGE_TEXTS.shop_returns.bn,
    shop_returns_en: PAGE_TEXTS.shop_returns.en,
  },
  about: { bn: ABOUT_TEXT.bn, en: ABOUT_TEXT.en },
  analytics: { ga4: "", clarity: "", meta_pixel: "" },
  chatbot: { enabled: true, greeting_bn: "", greeting_en: "", faq_bn: "", faq_en: "" },
  shop: { enabled: true, url: "", label_bn: "দোকান", label_en: "Shop" },
  // Chattogram district (worker/src/data/bd-geo.ts), where the shop is; no charges are made up: the owner sets them before opening
  store: { enabled: false, cod: true, online: true, home_district: 8, fee_home: 0, fee_other: 0, free_over: 0, free_delivery: false, delivery_bn: "", delivery_en: "" },
  notifications: { emails: [], off: [] },
  sms: { enabled: true, sender_id: "", with_email: true },
  onboarding: { dismissed: false },
};

export type SettingKey = keyof Settings;
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

const MEMO_MS = 15_000;
let memo: { at: number; data: Settings } | null = null;

function merge<T extends object>(base: T, over: unknown): T {
  if (!over || typeof over !== "object") return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b as object, v) : v;
  }
  return out as T;
}

export async function getSettings(env: Env, opts: { fresh?: boolean } = {}): Promise<Settings> {
  if (!opts.fresh && memo && Date.now() - memo.at < MEMO_MS) return memo.data;
  const rows = await all<{ key: string; value: string }>(env.DB, "SELECT key, value FROM settings");
  const data = structuredClone(SETTING_DEFAULTS) as Settings;
  for (const row of rows) {
    if ((SETTING_KEYS as string[]).includes(row.key)) {
      (data as unknown as Record<string, unknown>)[row.key] = merge(
        (SETTING_DEFAULTS as unknown as Record<string, object>)[row.key],
        safeJson(row.value, {}),
      );
    }
  }
  memo = { at: Date.now(), data };
  return data;
}

export async function setSetting(env: Env, key: SettingKey, value: unknown, staffId: number | null): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    key,
    JSON.stringify(value),
    nowIso(),
    staffId,
  );
  memo = null;
  await bumpContentVersion(env);
}

/* Content version: public pages are cached at the edge under a key that includes this number, so one
 * KV write after any admin change makes every cached page refresh (no per-URL purge needed). */
let cvMemo: { at: number; v: string } | null = null;

export async function contentVersion(env: Env): Promise<string> {
  if (cvMemo && Date.now() - cvMemo.at < 10_000) return cvMemo.v;
  const v = (await env.KV.get("cv")) ?? "0";
  cvMemo = { at: Date.now(), v };
  return v;
}

export async function bumpContentVersion(env: Env): Promise<void> {
  const v = String(Date.now());
  await env.KV.put("cv", v);
  cvMemo = { at: Date.now(), v };
  memo = null;
}

/** Test helper: forget in-isolate caches. */
/**
 * What the menus' Shop item opens. The Equipment Shop on this website once it is open; before that, the other shop whose address the owner
 * gave (Admin → Settings → Shop in the menu), or else this website's shop page saying it opens soon. Null when the owner switched the item off.
 */
export function menuShop(s: Settings): { own: true } | { own: false; url: string } | null {
  if (s.store.enabled) return { own: true };
  if (!s.shop.enabled) return null;
  if (!s.shop.url) return { own: true };
  return /^https?:\/\//i.test(s.shop.url) ? { own: false, url: s.shop.url } : null;
}

export function resetSettingsCache(): void {
  memo = null;
  cvMemo = null;
}
