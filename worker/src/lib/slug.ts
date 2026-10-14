import { randomString, BASE32_LOWER } from "./crypto";
import { first } from "./db";

/** URL-safe ASCII slug. Bangla-only titles have no ASCII letters, so callers fall back to a random suffix. */
export function slugify(input: string, max = 80): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

const TABLES = new Set(["courses", "instructors", "bundles", "blog_posts", "categories"]);

/** First free slug for `base` in `table` (appends -2, -3 … ; random when the base is empty). */
export async function uniqueSlug(db: D1Database, table: string, base: string, excludeId?: number): Promise<string> {
  if (!TABLES.has(table)) throw new Error("bad table");
  const root = slugify(base) || `item-${randomString(5, BASE32_LOWER)}`;
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const hit = await first<{ id: number }>(db, `SELECT id FROM ${table} WHERE slug = ? ${excludeId ? "AND id <> ?" : ""}`, ...(excludeId ? [candidate, excludeId] : [candidate]));
    if (!hit) return candidate;
  }
  return `${root}-${randomString(5, BASE32_LOWER)}`;
}
