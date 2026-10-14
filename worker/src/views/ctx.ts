import { common, createT, site, type CategoryDTO, type Lang } from "@mawah/shared";
import type { Env } from "../env";
import type { Settings } from "../lib/settings";

const dict = {
  en: { ...common.en, ...site.en } as Record<string, string>,
  bn: { ...common.bn, ...site.bn } as Record<string, string>,
};

type Key = keyof typeof common.en | keyof typeof site.en;

/** Everything a server-rendered page needs to know about the current request. */
export interface PageCtx {
  lang: Lang;
  env: Env;
  settings: Settings;
  categories: CategoryDTO[];
  /** language-agnostic path of the current page, e.g. "/courses/brownie" */
  path: string;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  /** localised URL for a language-agnostic path: "/courses" -> "/en/courses" in English */
  href: (path: string) => string;
  /** the same page in the other language */
  altHref: string;
  abs: (path: string) => string;
}

export const langPrefix = (lang: Lang) => (lang === "en" ? "/en" : "");

export function localizedPath(lang: Lang, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (lang === "bn") return p;
  return p === "/" ? "/en" : `/en${p}`;
}

export function makePageCtx(env: Env, settings: Settings, categories: CategoryDTO[], lang: Lang, path: string): PageCtx {
  const t = createT(dict as never, lang) as unknown as PageCtx["t"];
  const base = env.SITE_URL.replace(/\/$/, "");
  const other: Lang = lang === "bn" ? "en" : "bn";
  return {
    lang,
    env,
    settings,
    categories,
    path,
    t,
    href: (p) => localizedPath(lang, p),
    altHref: localizedPath(other, path),
    abs: (p) => `${base}${p}`,
  };
}
