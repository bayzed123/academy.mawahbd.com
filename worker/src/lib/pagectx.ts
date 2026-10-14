import type { CategoryDTO, Lang } from "@mawah/shared";
import type { Ctx, Env } from "../env";
import { listCategories } from "../services/catalog";
import { makePageCtx, type PageCtx } from "../views/ctx";
import { getSettings } from "./settings";

let memo: { at: number; data: CategoryDTO[] } | null = null;

/** Category list is needed by the footer of every page: keep it for a few seconds per isolate. */
export async function categoriesCached(env: Env): Promise<CategoryDTO[]> {
  if (memo && Date.now() - memo.at < 20_000) return memo.data;
  const data = await listCategories(env);
  memo = { at: Date.now(), data };
  return data;
}

export function resetCategoryCache(): void {
  memo = null;
}

export async function pageCtxFor(c: Ctx, lang: Lang, path: string): Promise<PageCtx> {
  const [settings, categories] = await Promise.all([getSettings(c.env), categoriesCached(c.env)]);
  return makePageCtx(c.env, settings, categories, lang, path);
}

export const langFromPath = (pathname: string): Lang => (pathname === "/en" || pathname.startsWith("/en/") ? "en" : "bn");
