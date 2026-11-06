import { Hono } from "hono";
import { z } from "zod";
import { studentCode } from "@mawah/shared";
import { FC_UNIT_LIST, type FcUnit } from "@mawah/shared/foodcost";
import type { AppEnv, Ctx } from "../../../env";
import { audit } from "../../../lib/audit";
import { all, first, likeEscape, nowIso, run } from "../../../lib/db";
import { HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { textSchema } from "../../../lib/schemas";
import { requirePerm } from "../../../middleware/auth";
import { latestPrices, planNow, priceDTO, type PriceRow } from "../../../services/foodcost";

/*
 * Admin → FoodCost (docs/foodcost.md): the shared ingredient list every user's recipes start from, with its default prices (the current
 * Dhaka average, one row per change so there is a history), and the users' workspaces with their plan. Staff never see a user's recipes or
 * own prices here: only how many recipes a workspace keeps.
 */
export const fcAdmin = new Hono<AppEnv>();

const unit = z.enum(FC_UNIT_LIST as [FcUnit, ...FcUnit[]], { error: "invalid_unit" });
const priceSchema = z.object({
  pack_qty: z.number({ error: "required" }).finite().positive("required").max(1_000_000, "too_big"),
  pack_unit: unit,
  price_minor: z.number({ error: "required" }).int("invalid").min(0, "invalid").max(1_000_000_000, "too_big"),
  supplier: textSchema(80).default(""),
  bought_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date").nullish(),
});
const ingredientSchema = z
  .object({
    name_bn: textSchema(80).default(""),
    name_en: textSchema(80).default(""),
    category: textSchema(40).default(""),
    g_per_ml: z.number().finite().positive().max(30).nullable().default(null),
    g_per_piece: z.number().finite().positive().max(100_000).nullable().default(null),
    sort: z.number().int().min(0).max(99_999).default(100),
    active: z.boolean().default(true),
    price: priceSchema.nullish(),
  })
  .refine((i) => !!(i.name_bn || i.name_en), { message: "required", path: ["name_en"] });

interface SharedRow {
  id: number;
  name_bn: string;
  name_en: string;
  category: string;
  g_per_ml: number | null;
  g_per_piece: number | null;
  active: number;
  sort: number;
  prices: number;
  used_in: number;
}

async function sharedList(c: Ctx, ids?: number[]) {
  const rows = await all<SharedRow>(
    c.env.DB,
    `SELECT i.id, i.name_bn, i.name_en, i.category, i.g_per_ml, i.g_per_piece, i.active, i.sort,
            (SELECT COUNT(*) FROM fc_prices p WHERE p.ingredient_id = i.id AND p.workspace_id IS NULL) AS prices,
            (SELECT COUNT(DISTINCT it.recipe_id) FROM fc_recipe_items it JOIN fc_recipes r ON r.id = it.recipe_id WHERE it.ingredient_id = i.id AND r.deleted_at IS NULL) AS used_in
     FROM fc_ingredients i WHERE i.workspace_id IS NULL ${ids ? `AND i.id IN (${ids.map(() => "?").join(",")})` : ""} ORDER BY i.sort, i.name_en, i.name_bn, i.id`,
    ...(ids ?? []),
  );
  const { defaults } = await latestPrices(c.env, null, ids);
  return rows.map((r) => ({ ...r, active: !!r.active, default_price: priceDTO(defaults.get(r.id)) }));
}

async function addDefaultPrice(c: Ctx, ingredientId: number, p: z.output<typeof priceSchema>) {
  await run(
    c.env.DB,
    "INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, currency, supplier, bought_on, staff_id) VALUES (?, NULL, ?, ?, ?, 'BDT', ?, ?, ?)",
    ingredientId,
    p.pack_qty,
    p.pack_unit,
    p.price_minor,
    p.supplier,
    p.bought_on ?? null,
    c.get("staff")!.id,
  );
}

const sharedIngredient = async (c: Ctx) => {
  const row = await first<{ id: number; name_en: string; name_bn: string }>(c.env.DB, "SELECT id, name_en, name_bn FROM fc_ingredients WHERE id = ? AND workspace_id IS NULL", intParam(c, "id"));
  if (!row) throw notFound();
  return row;
};

/* -------------------------------------------------------------------------------------------------------------- the shared list */

fcAdmin.get("/fc/ingredients", requirePerm("fc:read"), async (c) => ok(c, { items: await sharedList(c) }));

fcAdmin.post("/fc/ingredients", requirePerm("fc:write"), async (c) => {
  const body = await parseBody(c, ingredientSchema);
  const res = await run(
    c.env.DB,
    "INSERT INTO fc_ingredients (workspace_id, name_bn, name_en, category, g_per_ml, g_per_piece, sort, active) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)",
    body.name_bn,
    body.name_en,
    body.category,
    body.g_per_ml,
    body.g_per_piece,
    body.sort,
    body.active ? 1 : 0,
  );
  const id = res.meta.last_row_id as number;
  if (body.price) await addDefaultPrice(c, id, body.price);
  await audit(c, { action: "fc.ingredient_created", entity: "fc_ingredient", entityId: id, summary: body.name_en || body.name_bn });
  return ok(c, { item: (await sharedList(c, [id]))[0] }, 201);
});

/** Change a shared ingredient. It is never deleted (recipes may use it): switched off, it is no longer offered for new lines. */
fcAdmin.put("/fc/ingredients/:id", requirePerm("fc:write"), async (c) => {
  const row = await sharedIngredient(c);
  const body = await parseBody(c, ingredientSchema);
  await run(
    c.env.DB,
    "UPDATE fc_ingredients SET name_bn = ?, name_en = ?, category = ?, g_per_ml = ?, g_per_piece = ?, sort = ?, active = ?, updated_at = ? WHERE id = ? AND workspace_id IS NULL",
    body.name_bn,
    body.name_en,
    body.category,
    body.g_per_ml,
    body.g_per_piece,
    body.sort,
    body.active ? 1 : 0,
    nowIso(),
    row.id,
  );
  if (body.price) await addDefaultPrice(c, row.id, body.price);
  await audit(c, { action: "fc.ingredient_updated", entity: "fc_ingredient", entityId: row.id, summary: body.name_en || body.name_bn });
  return ok(c, { item: (await sharedList(c, [row.id]))[0] });
});

/** A new default price (the newest counts; the older ones stay as the history). */
fcAdmin.post("/fc/ingredients/:id/price", requirePerm("fc:write"), async (c) => {
  const row = await sharedIngredient(c);
  const body = await parseBody(c, priceSchema);
  await addDefaultPrice(c, row.id, body);
  await audit(c, { action: "fc.price_set", entity: "fc_ingredient", entityId: row.id, summary: row.name_en || row.name_bn, meta: { price_minor: body.price_minor, pack: `${body.pack_qty} ${body.pack_unit}` } });
  return ok(c, { item: (await sharedList(c, [row.id]))[0] });
});

fcAdmin.get("/fc/ingredients/:id/prices", requirePerm("fc:read"), async (c) => {
  const row = await sharedIngredient(c);
  const history = await all<PriceRow>(
    c.env.DB,
    "SELECT ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on, created_at FROM fc_prices WHERE ingredient_id = ? AND workspace_id IS NULL ORDER BY id DESC LIMIT 100",
    row.id,
  );
  return ok(c, { history: history.map(priceDTO) });
});

/**
 * A pasted list (the screen reads the table, one row per ingredient, and sends a long one in parts): new names are added, names already on the
 * list are updated, and a row with a price adds it as the new default unless it is the newest one already. Each row is checked on its own;
 * the rows that are wrong come back with their reason. Three database calls whatever the length (the writes are batched), so a long list
 * stays within a Worker's budget.
 */
export const FC_IMPORT_MAX_ROWS = 200;
const importSchema = z.object({
  rows: z
    .array(
      z.object({
        name_bn: textSchema(80).default(""),
        name_en: textSchema(80).default(""),
        category: textSchema(40).default(""),
        g_per_ml: z.number().finite().positive().max(30).nullable().default(null),
        g_per_piece: z.number().finite().positive().max(100_000).nullable().default(null),
        price: priceSchema.nullish(),
      }),
    )
    .min(1, "required")
    .max(FC_IMPORT_MAX_ROWS, "too_many"),
});

fcAdmin.post("/fc/ingredients/import", requirePerm("fc:write"), async (c) => {
  const { rows } = await parseBody(c, importSchema);
  const existing = await all<{ id: number; name_en: string; name_bn: string }>(c.env.DB, "SELECT id, name_en, name_bn FROM fc_ingredients WHERE workspace_id IS NULL");
  const known = new Map<string, number>(); // a name on the list → its ingredient
  for (const e of existing) {
    if (e.name_en) known.set(`en:${e.name_en.toLowerCase()}`, e.id);
    if (e.name_bn) known.set(`bn:${e.name_bn}`, e.id);
  }
  const errors: { row: number; code: string }[] = [];
  const at = nowIso();
  // Each row goes to one ingredient: one already on the list (found by either name), or a new one. A name twice in the same list is one new
  // ingredient: the first row adds it and the later rows fill it in, as they would a known one (what a row leaves empty stays as it was).
  type Fields = Pick<(typeof rows)[number], "name_bn" | "name_en" | "category" | "g_per_ml" | "g_per_piece">;
  const updates: D1PreparedStatement[] = [];
  const fresh: Fields[] = [];
  const freshOf = new Map<string, number>(); // a name → the new ingredient it is
  const priced: { price: NonNullable<(typeof rows)[number]["price"]>; id: number | null; fresh: number }[] = [];
  let valid = 0;
  for (const [n, r] of rows.entries()) {
    if (!r.name_bn && !r.name_en) {
      errors.push({ row: n, code: "required" });
      continue;
    }
    valid++;
    const names = [r.name_en ? `en:${r.name_en.toLowerCase()}` : null, r.name_bn ? `bn:${r.name_bn}` : null].filter((k): k is string => !!k);
    const id = names.map((k) => known.get(k)).find((v) => v !== undefined) ?? null;
    let f = -1;
    if (id !== null) {
      updates.push(
        c.env.DB.prepare(
          `UPDATE fc_ingredients SET name_bn = COALESCE(NULLIF(?, ''), name_bn), name_en = COALESCE(NULLIF(?, ''), name_en), category = COALESCE(NULLIF(?, ''), category),
             g_per_ml = COALESCE(?, g_per_ml), g_per_piece = COALESCE(?, g_per_piece), updated_at = ? WHERE id = ?`,
        ).bind(r.name_bn, r.name_en, r.category, r.g_per_ml, r.g_per_piece, at, id),
      );
      for (const k of names) if (!known.has(k)) known.set(k, id); // a name it is given here finds it for the rows below
    } else {
      f = names.map((k) => freshOf.get(k)).find((v) => v !== undefined) ?? -1;
      if (f === -1) {
        f = fresh.push({ name_bn: r.name_bn, name_en: r.name_en, category: r.category, g_per_ml: r.g_per_ml, g_per_piece: r.g_per_piece }) - 1;
      } else {
        const into = fresh[f];
        if (r.name_bn) into.name_bn = r.name_bn;
        if (r.name_en) into.name_en = r.name_en;
        if (r.category) into.category = r.category;
        if (r.g_per_ml !== null) into.g_per_ml = r.g_per_ml;
        if (r.g_per_piece !== null) into.g_per_piece = r.g_per_piece;
      }
      for (const k of names) if (!freshOf.has(k)) freshOf.set(k, f);
    }
    if (r.price) priced.push({ price: r.price, id, fresh: f });
  }
  const inserts = fresh.map((i) =>
    c.env.DB.prepare("INSERT INTO fc_ingredients (workspace_id, name_bn, name_en, category, g_per_ml, g_per_piece) VALUES (NULL, ?, ?, ?, ?, ?)").bind(
      i.name_bn,
      i.name_en,
      i.category,
      i.g_per_ml,
      i.g_per_piece,
    ),
  );
  const results = updates.length + inserts.length ? await c.env.DB.batch([...updates, ...inserts]) : [];
  const freshIds = inserts.map((_, i) => results[updates.length + i].meta.last_row_id as number);
  // a price the same as the ingredient's newest default is not saved again, so the same list pasted twice (or each month) keeps only real changes
  const prices = priced.map((p) =>
    c.env.DB.prepare(
      `INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, currency, supplier, bought_on, staff_id)
       SELECT ?1, NULL, ?2, ?3, ?4, 'BDT', ?5, ?6, ?7
       WHERE NOT EXISTS (SELECT 1 FROM (SELECT pack_qty, pack_unit, price_minor FROM fc_prices WHERE ingredient_id = ?1 AND workspace_id IS NULL ORDER BY id DESC LIMIT 1) newest
                         WHERE newest.pack_qty = ?2 AND newest.pack_unit = ?3 AND newest.price_minor = ?4)`,
    ).bind(p.id ?? freshIds[p.fresh], p.price.pack_qty, p.price.pack_unit, p.price.price_minor, p.price.supplier, p.price.bought_on ?? null, c.get("staff")!.id),
  );
  const saved = prices.length ? (await c.env.DB.batch(prices)).reduce((n, r) => n + (r.meta.changes ?? 0), 0) : 0;
  const added = fresh.length;
  const updated = valid - added;
  await audit(c, { action: "fc.ingredients_imported", entity: "fc_ingredient", meta: { added, updated, priced: saved, errors: errors.length } });
  return ok(c, { added, updated, priced: saved, errors });
});

/* ------------------------------------------------------------------------------------------------------------------- workspaces */

/** The users' workspaces: whose, the plan, how many recipes — never the recipes themselves. */
fcAdmin.get("/fc/workspaces", requirePerm("fc:read"), async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  const like = `%${likeEscape(q)}%`;
  const rows = await all<{ id: number; student_id: number; name: string; plan: "free" | "pro"; plan_until: string | null; plan_source: string; recipes: number; created_at: string }>(
    c.env.DB,
    `SELECT w.id, w.student_id, s.name, w.plan, w.plan_until, w.plan_source, w.created_at,
            (SELECT COUNT(*) FROM fc_recipes r WHERE r.workspace_id = w.id AND r.deleted_at IS NULL) AS recipes
     FROM fc_workspaces w JOIN students s ON s.id = w.student_id
     WHERE s.deleted_at IS NULL ${q ? "AND (s.name LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\' OR CAST(s.id AS TEXT) = ?)" : ""}
     ORDER BY w.id DESC LIMIT 200`,
    ...(q ? [like, like, q.replace(/^stu-?0*/i, "")] : []),
  );
  return ok(c, { items: rows.map((r) => ({ ...r, code: studentCode(r.student_id), plan_now: planNow(r) })) });
});

/** Give a workspace Pro (no limit), until a day or for good — or take it back to Free. */
fcAdmin.put("/fc/workspaces/:id/plan", requirePerm("fc:plans"), async (c) => {
  const body = await parseBody(c, z.object({ plan: z.enum(["free", "pro"]), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date").nullish() }));
  const until = body.plan === "pro" && body.until ? `${body.until}T23:59:59Z` : null;
  if (until && until <= nowIso()) throw new HttpError(422, "validation", "validation", { until: "in_past" });
  const res = await run(
    c.env.DB,
    "UPDATE fc_workspaces SET plan = ?, plan_until = ?, plan_source = ?, updated_at = ? WHERE id = ?",
    body.plan,
    until,
    body.plan === "pro" ? "admin" : "",
    nowIso(),
    intParam(c, "id"),
  );
  if (!res.meta.changes) throw notFound();
  await audit(c, { action: "fc.plan_changed", entity: "fc_workspace", entityId: intParam(c, "id"), meta: { plan: body.plan, until } });
  return ok(c, { plan: body.plan, plan_until: until });
});
