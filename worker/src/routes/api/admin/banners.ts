import { z } from "zod";
import { BANNER_PLACEMENTS } from "@mawah/shared";
import { crudRoutes, type ResourceDef } from "../../../lib/crud";
import { HttpError } from "../../../lib/http";
import { textSchema } from "../../../lib/schemas";

/**
 * Admin → Banners: the home-page slider and the offer pop-up. Everything here is shown to every visitor, so the owner's words
 * are plain text (never HTML) and the button can only lead somewhere safe: a page of this site, an https address, a phone
 * number or an e-mail address — never javascript: or data: (see `link`).
 */
const imageKey = z
  .string()
  .max(200)
  .regex(/^banners\/[a-f0-9]{16,64}\.(png|jpe?g|webp|avif)$/, "invalid_image")
  .nullable();

/** A day in the Bangladesh calendar, "2026-10-20", or nothing. */
const day = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date"), z.null()]);

/** Where the button goes. Relative links must start with a single "/" (a "//host" would leave the site without saying so). */
const link = z
  .string()
  .trim()
  .max(500, "too_long")
  .refine((v) => v === "" || /^\/(?!\/)\S*$/.test(v) || /^https:\/\/\S+$/i.test(v) || /^tel:\+?[\d -]{6,20}$/i.test(v) || /^mailto:[^\s@]+@[^\s@]+$/i.test(v), "invalid_url");

const bannerSchema = z.object({
  placement: z.enum(BANNER_PLACEMENTS),
  title_bn: textSchema(90),
  title_en: textSchema(90),
  text_bn: textSchema(180),
  text_en: textSchema(180),
  image_key: imageKey,
  mobile_image_key: imageKey,
  alt_bn: textSchema(160),
  alt_en: textSchema(160),
  button_bn: textSchema(30),
  button_en: textSchema(30),
  link_url: link,
  new_tab: z.boolean(),
  active: z.boolean(),
  starts_at: day,
  ends_at: day,
  sort: z.number().int().min(0).max(99999),
  popup_delay_sec: z.number().int().min(0).max(120),
  popup_repeat_days: z.number().int().min(0).max(365),
  popup_pages: z.enum(["home", "all"]),
});

export const banners = crudRoutes({
  name: "banners",
  table: "banners",
  perms: { read: "banners:read", write: "banners:write" },
  schema: bannerSchema,
  searchCols: ["title_bn", "title_en", "alt_en", "button_en"],
  sortCols: ["id", "placement", "sort", "starts_at", "ends_at", "updated_at"],
  defaultSort: "placement",
  filters: { placement: "placement" },
  softDelete: true,
  publicContent: true,
  label: (r) => String(r.title_en || r.title_bn || r.alt_en || `#${r.id}`),
  beforeSave(_c, data, existing) {
    const get = (k: string) => (k in data ? data[k] : existing?.[k]);
    // a banner needs something to show: a picture or a title
    if (!get("image_key") && !String(get("title_bn") ?? "").trim() && !String(get("title_en") ?? "").trim()) {
      throw new HttpError(422, "validation", "validation", { image_key: "required" });
    }
    // a button without a place to go (or the other way round) is a mistake worth catching now
    const hasLabel = !!String(get("button_bn") ?? "").trim() || !!String(get("button_en") ?? "").trim();
    if (hasLabel && !String(get("link_url") ?? "").trim()) throw new HttpError(422, "validation", "validation", { link_url: "required" });
    const from = get("starts_at") as string | null;
    const to = get("ends_at") as string | null;
    if (from && to && to < from) throw new HttpError(422, "validation", "validation", { ends_at: "before_start" });
    return data;
  },
} satisfies ResourceDef<typeof bannerSchema>);
