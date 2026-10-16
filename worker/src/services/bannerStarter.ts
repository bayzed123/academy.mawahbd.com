import { CLASS_ICONS, common, type BannerLayout, type BannerTheme } from "@mawah/shared";
import type { Env } from "../env";
import { all } from "../lib/db";

/**
 * "Create starter banners": the owner's first slider, made from the classes themselves in one click. Every word comes from the class
 * (its title, the first sentence of its short description, its category) — never a price, a discount or a number nobody gave. The
 * banners are ordinary banners: the owner edits, replaces the picture, switches off or deletes each one.
 */

/** How many class banners the slider starts with. Pressing the button again never adds more than this in total. */
export const STARTER_COUNT = 5;

/** Colours and layouts the starters take turns in, so five banners side by side do not look alike. */
const THEMES: readonly BannerTheme[] = ["dark", "ruby", "gold", "ivory", "dark"];
const LAYOUTS_PLAIN: readonly BannerLayout[] = ["split", "center", "left", "split", "center"];
const LAYOUTS_PICTURE: readonly BannerLayout[] = ["split", "left", "split", "left", "split"];

interface ClassRow {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  short_bn: string;
  short_en: string;
  icon: string | null;
  banner_key: string | null;
  cat_bn: string | null;
  cat_en: string | null;
  cat_icon: string | null;
}

/** The first sentence of a description as one plain line of at most `max` characters (markdown marks and line breaks removed). */
export function firstSentence(text: string, max: number): string {
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  const end = plain.search(/[.!?।](\s|$)/);
  const sentence = end >= 0 ? plain.slice(0, end + 1) : plain;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
}

const limit = (s: string | null | undefined, max: number) => {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
};

export interface StarterResult {
  created: number;
  /** class banners that were already there (they count towards the five) */
  existing: number;
  /** live classes there was no banner for yet, whether or not there was room for them */
  available: number;
  ids: number[];
}

/** Makes up to five hero banners from published classes that have none yet. Safe to press twice. */
export async function createStarterBanners(env: Env): Promise<StarterResult> {
  const links = await all<{ link_url: string }>(env.DB, "SELECT link_url FROM banners WHERE deleted_at IS NULL AND placement = 'hero' AND link_url LIKE '/courses/%'");
  const have = new Set(links.map((r) => r.link_url.replace(/^\/courses\//, "").split(/[?#]/)[0]));
  const classes = await all<ClassRow>(
    env.DB,
    `SELECT c.id, c.slug, c.title_bn, c.title_en, c.short_bn, c.short_en, c.icon, c.banner_key, k.name_bn AS cat_bn, k.name_en AS cat_en, k.icon AS cat_icon
     FROM courses c LEFT JOIN categories k ON k.id = c.category_id
     WHERE c.status = 'published' AND c.deleted_at IS NULL
     ORDER BY c.featured DESC, c.sort, c.id`,
  );
  const fresh = classes.filter((c) => !have.has(c.slug));
  const room = Math.max(0, STARTER_COUNT - have.size);
  const chosen = fresh.slice(0, room);
  if (chosen.length === 0) return { created: 0, existing: have.size, available: fresh.length, ids: [] };

  const top = await all<{ top: number | null }>(env.DB, "SELECT MAX(sort) AS top FROM banners WHERE deleted_at IS NULL AND placement = 'hero'");
  let sort = (top[0]?.top ?? 0) + 10;
  const index = have.size; // the colours continue where the banners already there stopped
  const insert = env.DB.prepare(
    `INSERT INTO banners (placement, title_bn, title_en, text_bn, text_en, image_key, alt_bn, alt_en, button_bn, button_en, link_url, active, sort, layout, theme, icon, kicker_bn, kicker_en)
     VALUES ('hero', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  );
  const rows = chosen.map((c, i) => {
    const n = (index + i) % THEMES.length;
    const withPicture = !!c.banner_key;
    const icon = [c.icon, c.cat_icon].find((x): x is string => !!x && (CLASS_ICONS as readonly string[]).includes(x)) ?? "cake";
    const layout = (withPicture ? LAYOUTS_PICTURE : LAYOUTS_PLAIN)[n];
    const theme = THEMES[n];
    // the class's own banner picture is a class banner (folder banners/), so it is allowed here too
    const stmt = insert.bind(
      limit(c.title_bn || c.title_en, 90),
      limit(c.title_en || c.title_bn, 90),
      firstSentence(c.short_bn || c.short_en, 180),
      firstSentence(c.short_en || c.short_bn, 180),
      c.banner_key,
      withPicture ? limit(c.title_bn || c.title_en, 160) : "",
      withPicture ? limit(c.title_en || c.title_bn, 160) : "",
      common.bn["btn.enrollNow"],
      common.en["btn.enrollNow"],
      `/courses/${c.slug}`,
      (sort += 10),
      layout,
      theme,
      icon,
      limit(c.cat_bn || c.cat_en, 40),
      limit(c.cat_en || c.cat_bn, 40),
    );
    return stmt;
  });
  const res = await env.DB.batch(rows);
  const ids = res.map((r) => r.meta.last_row_id as number);
  return { created: ids.length, existing: have.size, available: fresh.length, ids };
}
