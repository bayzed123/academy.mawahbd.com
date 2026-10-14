import type { Lang } from "../format";

export type Vars = Record<string, string | number>;
export type Dict = Record<string, string>;

/**
 * Build a translator for one language over one or more dictionaries.
 * Missing keys fall back to English and finally to the key itself (never crashes a page).
 * `{name}` placeholders are replaced from `vars`.
 */
export function createT<D extends Dict>(dicts: { en: D; bn: Record<keyof D, string> }, lang: Lang) {
  const primary = dicts[lang] as Dict;
  const fallback = dicts.en as Dict;
  return function t(key: keyof D & string, vars?: Vars): string {
    const raw = primary[key] ?? fallback[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
  };
}

export { common } from "./common";
export { site } from "./site";
export { appDict } from "./app";
export { adminDict } from "./admin";
