import { z } from "zod";
import { playsOnPublicPages } from "@mawah/shared";
import { crudRoutes, type ResourceDef } from "../../../lib/crud";
import { textSchema } from "../../../lib/schemas";

/**
 * Admin → Home videos: YouTube or Vimeo videos for the home page, each with its own on/off switch. Only an address the page can play in the
 * video site's own player is kept (a Facebook video would need Facebook's player on the public pages, which they never load); the player
 * is always rebuilt from the checked id (shared/src/videoEmbed.ts), never from the pasted text.
 */
const videoSchema = z.object({
  url: z.string().trim().min(1, "required").max(300, "too_long").refine(playsOnPublicPages, "video_site"),
  title_bn: textSchema(120),
  title_en: textSchema(120),
  active: z.boolean(),
  sort: z.number().int().min(0).max(99999),
});

export const videos = crudRoutes({
  name: "videos",
  table: "home_videos",
  perms: { read: "banners:read", write: "banners:write" },
  schema: videoSchema,
  searchCols: ["title_bn", "title_en", "url"],
  sortCols: ["id", "sort", "updated_at"],
  defaultSort: "sort",
  filters: { active: "active" },
  softDelete: true,
  publicContent: true,
  label: (r) => String(r.title_en || r.title_bn || r.url || `#${r.id}`),
} satisfies ResourceDef<typeof videoSchema>);
