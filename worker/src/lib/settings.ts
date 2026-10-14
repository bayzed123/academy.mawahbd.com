import { MANUAL_WINDOW_DEFAULT_MIN } from "@mawah/shared";
import type { Env } from "../env";
import { all, nowIso, run, safeJson } from "./db";

/** Typed, defaulted view over the key/value `settings` table (everything is editable in Admin → Settings). */
export interface Settings {
  contact: { whatsapp: string; phone: string; email: string; facebook: string; youtube: string; instagram: string };
  announcement: { bn: string; en: string };
  payments: {
    sslcommerz: boolean;
    bkash_direct: boolean;
    manual: boolean;
    manual_numbers: { bkash: string; nagad: string; rocket: string };
    manual_note_bn: string;
    manual_note_en: string;
    /** minutes a student is asked to pay within after choosing manual payment */
    manual_window_min: number;
  };
  policies: {
    refund_bn: string;
    refund_en: string;
    privacy_bn: string;
    privacy_en: string;
    terms_bn: string;
    terms_en: string;
  };
  about: { bn: string; en: string };
  analytics: { ga4: string; clarity: string; meta_pixel: string };
  chatbot: { enabled: boolean; greeting_bn: string; greeting_en: string; faq_bn: string; faq_en: string };
  onboarding: { dismissed: boolean };
}

export const SETTING_DEFAULTS: Settings = {
  contact: { whatsapp: "", phone: "", email: "", facebook: "", youtube: "", instagram: "" },
  announcement: { bn: "", en: "" },
  payments: {
    sslcommerz: true,
    bkash_direct: false,
    manual: true,
    manual_numbers: { bkash: "", nagad: "", rocket: "" },
    manual_note_bn: "",
    manual_note_en: "",
    manual_window_min: MANUAL_WINDOW_DEFAULT_MIN,
  },
  policies: { refund_bn: "", refund_en: "", privacy_bn: "", privacy_en: "", terms_bn: "", terms_en: "" },
  about: { bn: "", en: "" },
  analytics: { ga4: "", clarity: "", meta_pixel: "" },
  chatbot: { enabled: true, greeting_bn: "", greeting_en: "", faq_bn: "", faq_en: "" },
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
export function resetSettingsCache(): void {
  memo = null;
  cvMemo = null;
}
