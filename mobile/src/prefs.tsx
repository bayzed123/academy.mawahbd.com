import { toBnDigits } from "@mawah/shared/format";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { KEYS, readValue, writeValue } from "./storage";
import { translate, type Lang, type StringKey } from "./strings";
import { PALETTES, type Palette } from "./theme";

export type LookPref = "system" | "night" | "day";

interface Prefs {
  ready: boolean;
  lang: Lang;
  setLang: (lang: Lang) => void;
  lookPref: LookPref;
  setLookPref: (pref: LookPref) => void;
  c: Palette;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  /** a number in the reader's digits (৩ in Bangla, 3 in English) */
  n: (value: number | string) => string;
}

const PrefsContext = createContext<Prefs | null>(null);

/**
 * Language (Bangla first, like the website) and look, remembered on the phone. The look follows the phone (day when the phone is set to
 * light, else night) until the student chooses one, as the website follows the device until the visitor chooses.
 */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>("bn");
  const [lookPref, setLookState] = useState<LookPref>("system");

  useEffect(() => {
    void (async () => {
      const [l, look] = await Promise.all([readValue(KEYS.lang), readValue(KEYS.look)]);
      if (l === "bn" || l === "en") setLangState(l);
      if (look === "system" || look === "night" || look === "day") setLookState(look);
      setReady(true);
    })();
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    void writeValue(KEYS.lang, next);
  }, []);
  const setLookPref = useCallback((next: LookPref) => {
    setLookState(next);
    void writeValue(KEYS.look, next);
  }, []);

  const value = useMemo<Prefs>(() => {
    const look = lookPref === "system" ? (system === "light" ? "day" : "night") : lookPref;
    const n = (v: number | string) => (lang === "bn" ? toBnDigits(v) : String(v));
    return {
      ready,
      lang,
      setLang,
      lookPref,
      setLookPref,
      c: PALETTES[look],
      n,
      t: (key, vars) => translate(lang, key, vars && lang === "bn" ? Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === "number" ? n(v) : v])) : vars),
    };
  }, [ready, lang, setLang, lookPref, setLookPref, system]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const v = useContext(PrefsContext);
  if (!v) throw new Error("usePrefs outside PrefsProvider");
  return v;
}
