import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { adminDict, common, createT, formatDate, formatDateTime, formatMoney, formatNumber, loc, type Lang } from "@mawah/shared";
import type { AdminKey } from "@mawah/shared/i18n/admin";

type Key = AdminKey | keyof typeof common.en;

const dicts = {
  en: { ...common.en, ...adminDict.en },
  bn: { ...common.bn, ...adminDict.bn },
} as { en: Record<Key, string>; bn: Record<Key, string> };

const STORAGE_KEY = "mawah_admin_lang";

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "bn" || stored === "en") return stored;
  } catch {
    /* storage blocked */
  }
  return "bn";
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  /** a key that may not exist (built at run time): returns the fallback when missing */
  tx: (key: string, fallback?: string) => string;
  pick: (obj: object, key: string) => string;
  money: (n: number) => string;
  num: (n: number) => string;
  date: (iso: string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  err: (code: string) => string;
}

const Ctx = createContext<I18n | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
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
      tx: (key, fallback) => (key in dicts.en ? t(key as Key) : (fallback ?? key)),
      pick: (obj, key) => loc(obj, key, lang),
      money: (n) => formatMoney(n, lang),
      num: (n) => formatNumber(n, lang),
      date: (iso) => formatDate(iso, lang),
      dateTime: (iso) => formatDateTime(iso, lang),
      err: (code) => {
        const k = `err.${code}`;
        return k in dicts.en ? t(k as Key) : t("err.generic");
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
