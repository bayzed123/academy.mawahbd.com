import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { appDict, common, createT, formatDate, formatDateTime, formatDuration, formatMoney, loc, type Lang } from "@mawah/shared";
import type { AppKey } from "@mawah/shared/i18n/app";

type Key = AppKey | keyof typeof common.en;

const dicts = {
  en: { ...common.en, ...appDict.en },
  bn: { ...common.bn, ...appDict.bn },
} as { en: Record<Key, string>; bn: Record<Key, string> };

const STORAGE_KEY = "mawah_lang";

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "bn" || stored === "en") return stored;
  } catch {
    /* storage blocked */
  }
  return navigator.language?.toLowerCase().startsWith("en") && !navigator.language.toLowerCase().startsWith("bn") ? "en" : "bn";
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  /** localised field of a bilingual record: pick(course, "title") */
  pick: (obj: object, key: string) => string;
  money: (n: number) => string;
  date: (iso: string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  duration: (sec: number) => string;
  /** translate an API error code, falling back to the generic message */
  err: (code: string) => string;
}

const Ctx = createContext<I18n | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === "bn" ? "মাওয়াহ একাডেমি" : "MAWAH Academy";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage blocked */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const t = createT(dicts, lang) as I18n["t"];
    return {
      lang,
      setLang,
      t,
      pick: (obj, key) => loc(obj, key, lang),
      money: (n) => formatMoney(n, lang),
      date: (iso) => formatDate(iso, lang),
      dateTime: (iso) => formatDateTime(iso, lang),
      duration: (sec) => formatDuration(sec, lang),
      err: (code) => {
        const k = `err.${code}` as Key;
        return k in dicts.en ? t(k) : t("err.generic");
      },
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("LangProvider missing");
  return v;
}
