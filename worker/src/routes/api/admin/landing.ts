import { z } from "zod";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { crudRoutes, type ResourceDef } from "../../../lib/crud";
import { first, nowIso, run } from "../../../lib/db";
import { HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { slugSchema, textSchema } from "../../../lib/schemas";
import { bumpContentVersion } from "../../../lib/settings";
import { uniqueSlug } from "../../../lib/slug";
import { requirePerm } from "../../../middleware/auth";
import { blockProblems, blocksSchema, readBlocks } from "../../../services/landing";
import type { Hono } from "hono";
import type { LandingBlock } from "@mawah/shared";

/**
 * Admin → Landing pages: the page's name, address, search words and whether it is live (this list), and its blocks (their own endpoint:
 * the whole list in the owner's order, checked block by block before it is stored).
 */
const landingSchema = z.object({
  slug: slugSchema.optional(),
  title_bn: textSchema(120),
  title_en: textSchema(120),
  description_bn: textSchema(300),
  description_en: textSchema(300),
  status: z.enum(["draft", "published"]),
});

export const landing: Hono<AppEnv> = crudRoutes({
  name: "landing",
  table: "landing_pages",
  perms: { read: "landing:read", write: "landing:write" },
  schema: landingSchema,
  searchCols: ["title_bn", "title_en", "slug"],
  sortCols: ["id", "title_en", "status", "updated_at", "published_at"],
  defaultSort: "-updated_at",
  filters: { status: "status" },
  softDelete: true,
  publicContent: true,
  serverColumns: ["published_at"],
  label: (r) => String(r.title_en || r.title_bn || r.slug),
  async beforeSave(c, data, existing) {
    const get = (k: string) => (k in data ? data[k] : existing?.[k]);
    if (!String(get("title_bn") ?? "").trim() && !String(get("title_en") ?? "").trim()) throw new HttpError(422, "validation", "validation", { title_en: "required" });
    if (existing) {
      if (data.slug && data.slug !== existing.slug) {
        const clash = await first<{ id: number }>(c.env.DB, "SELECT id FROM landing_pages WHERE slug = ? AND id <> ?", data.slug as string, existing.id);
        if (clash) throw new HttpError(409, "duplicate", "duplicate", { slug: "duplicate" });
      }
    } else if (data.slug) {
      if (await first(c.env.DB, "SELECT id FROM landing_pages WHERE slug = ?", data.slug as string)) throw new HttpError(409, "duplicate", "duplicate", { slug: "duplicate" });
    } else data.slug = await uniqueSlug(c.env.DB, "landing_pages", String(get("title_en") || get("title_bn") || ""));
    // the first time it goes live
    if (data.status === "published" && !existing?.published_at) data.published_at = nowIso();
    return data;
  },
  // the list shows how many blocks a page has, not the blocks themselves
  async decorate(_c, rows) {
    return rows.map(({ blocks, ...r }) => ({ ...r, block_count: readBlocks(blocks).length }));
  },
} satisfies ResourceDef<typeof landingSchema>);

landing.get("/:id/blocks", requirePerm("landing:read"), async (c) => {
  const row = await first<{ blocks: string }>(c.env.DB, "SELECT blocks FROM landing_pages WHERE id = ? AND deleted_at IS NULL", intParam(c, "id"));
  if (!row) throw notFound();
  return ok(c, { blocks: readBlocks(row.blocks) });
});

landing.put("/:id/blocks", requirePerm("landing:write"), async (c) => {
  const id = intParam(c, "id");
  const row = await first<{ id: number; slug: string }>(c.env.DB, "SELECT id, slug FROM landing_pages WHERE id = ? AND deleted_at IS NULL", id);
  if (!row) throw notFound();
  const { blocks } = await parseBody(c, z.object({ blocks: blocksSchema }));
  const problems = await blockProblems(c.env, blocks as LandingBlock[]);
  if (Object.keys(problems).length) throw new HttpError(422, "validation", "validation", problems);
  await run(c.env.DB, "UPDATE landing_pages SET blocks = ?, updated_at = ? WHERE id = ?", JSON.stringify(blocks), nowIso(), id);
  await bumpContentVersion(c.env);
  await audit(c, { action: "landing.blocks", entity: "landing_pages", entityId: id, summary: `${row.slug}: ${blocks.length} blocks`, meta: { types: blocks.map((b) => b.type) } });
  return ok(c, { blocks });
});
