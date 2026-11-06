import { Hono } from "hono";
import { z } from "zod";
import { FC_MAX_DEPTH, FC_UNIT_LIST, type FcItemDTO, type FcUnit } from "@mawah/shared/foodcost";
import type { AppEnv, Ctx } from "../../env";
import { audit } from "../../lib/audit";
import { all, first, nowIso, run } from "../../lib/db";
import { HttpError, conflict, forbidden, intParam, notFound, ok, parseBody } from "../../lib/http";
import { textSchema } from "../../lib/schemas";
import { requireStudent } from "../../middleware/auth";
import {
  bookOf,
  chainProblem,
  costWith,
  foreignRefs,
  ingredientFor,
  ingredientsFor,
  itemStatements,
  latestPrices,
  meDTO,
  priceDTO,
  recipesOf,
  summaries,
  workspaceFor,
  type PriceRow,
  type RecipeInput,
  type Workspace,
} from "../../services/foodcost";

/*
 * FoodCost Pro's API for the website and the Android app (docs/foodcost.md). Everything is the signed-in student's own workspace: their
 * recipes, their own ingredients and their own prices; the shared ingredient list and its default prices are kept by staff (Admin →
 * FoodCost). Recipes are costed here with the same engine the screens run while one types.
 */
export const fcRoutes = new Hono<AppEnv>();
fcRoutes.use("*", requireStudent);

/* ------------------------------------------------------------------------------------------------------------------------- validation */

const unit = z.enum(FC_UNIT_LIST as [FcUnit, ...FcUnit[]], { error: "invalid_unit" });
const qty = z.number({ error: "required" }).finite().positive("required").max(1_000_000, "too_big");
/** money in paisa: up to ৳1 crore */
const minor = z.number({ error: "required" }).int("invalid").min(0, "invalid").max(1_000_000_000, "too_big");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date");
const id = z.number().int().positive();

const priceSchema = z.object({ pack_qty: qty, pack_unit: unit, price_minor: minor, supplier: textSchema(80).default(""), bought_on: day.nullish() });

const itemSchema = z
  .object({ ingredient_id: id.nullable().default(null), recipe_id: id.nullable().default(null), qty, unit, note: textSchema(120).default("") })
  .refine((i) => (i.ingredient_id === null) !== (i.recipe_id === null), { message: "required", path: ["ingredient_id"] });

const costSchema = z
  .object({
    kind: z.enum(["packaging", "labour", "energy", "other"]),
    label: textSchema(60).default(""),
    per: z.enum(["batch", "piece", "hour"]),
    amount_minor: minor,
    hours: z.number().finite().min(0, "invalid").max(1000, "too_big").nullable().default(null),
  })
  .refine((c) => c.per !== "hour" || c.hours !== null, { message: "required", path: ["hours"] });

const pricingSchema = z
  .object({
    mode: z.enum(["markup", "margin"]),
    pct: z.number().finite().min(0, "invalid").max(10_000, "too_big"),
    round_to_minor: z.number().int().min(0).max(100_000).default(0),
    actual_minor: minor.nullable().default(null),
  })
  // no price reaches a margin of 100% or more
  .refine((p) => p.mode !== "margin" || p.pct < 100, { message: "bad_margin", path: ["pct"] });

const recipeSchema = z.object({
  name: textSchema(120, 1),
  notes: textSchema(2000).default(""),
  yield_qty: qty,
  yield_unit: unit,
  yield_label: textSchema(40).default(""),
  output_g: z.number().finite().positive().max(1_000_000).nullable().default(null),
  items: z.array(itemSchema).max(60, "too_many"),
  costs: z.array(costSchema).max(20, "too_many").default([]),
  pricing: pricingSchema.default({ mode: "markup", pct: 0, round_to_minor: 0, actual_minor: null }),
});

const ingredientSchema = z
  .object({
    name_bn: textSchema(80).default(""),
    name_en: textSchema(80).default(""),
    category: textSchema(40).default(""),
    g_per_ml: z.number().finite().positive().max(30).nullable().default(null),
    g_per_piece: z.number().finite().positive().max(100_000).nullable().default(null),
    price: priceSchema.nullish(),
  })
  .refine((i) => !!(i.name_bn || i.name_en), { message: "required", path: ["name_en"] });

/** A workspace keeps at most this many ingredients of its own (the shared list is staff's). */
const OWN_INGREDIENTS = 300;
/** "No limit" (a MAWAH student, Pro) still stops here, so nobody can fill the database: far more than a bakery keeps. */
const HARD_RECIPE_LIMIT = 2000;
/** One's own price history for an ingredient keeps this many changes (the oldest go). */
const OWN_PRICE_HISTORY = 50;

/* ----------------------------------------------------------------------------------------------------------------------- helpers */

const ws = (c: Ctx) => workspaceFor(c.env, c.get("student")!.id);

/** The lines refer only to what this workspace may use, and the recipe does not end up using itself. */
async function checkRecipe(c: Ctx, w: Workspace, body: RecipeInput, recipeId: number) {
  const bad = await foreignRefs(c.env, w.id, body.items);
  if (bad.length) throw new HttpError(422, "validation", "validation", { [`items.${bad[0]}`]: "not_found" });
  const book = await bookOf(c.env, w.id);
  const chain = chainProblem({ id: recipeId, items: body.items }, book.recipes, FC_MAX_DEPTH);
  if (chain) throw new HttpError(422, "validation", "validation", { items: chain === "cycle" ? "fc_cycle" : "fc_too_deep" });
  return book;
}

/** A recipe of this workspace with its costing, as the screens show it. */
async function recipeOut(c: Ctx, w: Workspace, recipeId: number) {
  const book = await bookOf(c.env, w.id);
  const recipe = book.recipes.find((r) => r.id === recipeId);
  if (!recipe) throw notFound();
  return { recipe, result: costWith(recipe, book) };
}

/**
 * A new recipe — only while the workspace is under its limit (Free: 3; a MAWAH student or Pro: none). The count and the insert are one
 * statement, so two saves at once cannot both slip past the limit.
 */
async function insertRecipe(c: Ctx, w: Workspace, body: RecipeInput): Promise<number> {
  const me = await meDTO(c.env, w);
  const at = nowIso();
  const values = [w.id, body.name, body.notes, body.yield_qty, body.yield_unit, body.yield_label, body.output_g, JSON.stringify(body.costs), JSON.stringify(body.pricing), at, at];
  const limit = me.limit ?? HARD_RECIPE_LIMIT;
  const res = await run(
    c.env.DB,
    `INSERT INTO fc_recipes (workspace_id, name, notes, yield_qty, yield_unit, yield_label, output_g, costs, pricing, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM fc_recipes WHERE workspace_id = ? AND deleted_at IS NULL) < ?`,
    ...values,
    w.id,
    limit,
  );
  // the screens say what the limit is and how to make room (delete one) — never anything about buying (Google Play); "no limit" stopped at its
  // safety stop is told it has too many, never the Free limit
  if (!res.meta.changes) throw me.limit === null ? conflict("fc_too_many") : forbidden("fc_limit");
  const recipeId = res.meta.last_row_id as number;
  if (body.items.length) {
    try {
      await c.env.DB.batch(itemStatements(c.env, recipeId, body.items));
    } catch (e) {
      await run(c.env.DB, "DELETE FROM fc_recipes WHERE id = ?", recipeId);
      throw e;
    }
  }
  return recipeId;
}

/* ------------------------------------------------------------------------------------------------------------------------------ me */

fcRoutes.get("/me", async (c) => ok(c, { me: await meDTO(c.env, await ws(c)) }));

/** Everything the screens need to cost while one types: the plan, every ingredient with the price that counts, and every recipe in full. */
fcRoutes.get("/book", async (c) => {
  const w = await ws(c);
  const [me, book] = await Promise.all([meDTO(c.env, w), bookOf(c.env, w.id)]);
  return ok(c, { me, ...book });
});

/* ---------------------------------------------------------------------------------------------------------------------- ingredients */

fcRoutes.get("/ingredients", async (c) => {
  const w = await ws(c);
  return ok(c, { ingredients: await ingredientsFor(c.env, w.id) });
});

async function ingredientOut(c: Ctx, w: Workspace, ingredientId: number) {
  const list = await ingredientsFor(c.env, w.id);
  return list.find((i) => i.id === ingredientId)!;
}

/** An ingredient of one's own (not on the shared list), with its price if given. */
fcRoutes.post("/ingredients", async (c) => {
  const w = await ws(c);
  const body = await parseBody(c, ingredientSchema);
  const count = (await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM fc_ingredients WHERE workspace_id = ?", w.id))?.n ?? 0;
  if (count >= OWN_INGREDIENTS) throw conflict("fc_too_many");
  const res = await run(
    c.env.DB,
    "INSERT INTO fc_ingredients (workspace_id, name_bn, name_en, category, g_per_ml, g_per_piece) VALUES (?, ?, ?, ?, ?, ?)",
    w.id,
    body.name_bn,
    body.name_en,
    body.category,
    body.g_per_ml,
    body.g_per_piece,
  );
  const ingredientId = res.meta.last_row_id as number;
  if (body.price) await addPrice(c, w, ingredientId, body.price);
  return ok(c, { ingredient: await ingredientOut(c, w, ingredientId) }, 201);
});

/** Only one's own ingredients can be changed or deleted here; the shared ones are staff's. */
async function ownIngredient(c: Ctx, w: Workspace) {
  const row = await ingredientFor(c.env, w.id, intParam(c, "id"));
  if (!row) throw notFound();
  if (row.workspace_id === null) throw forbidden("fc_shared");
  return row;
}

fcRoutes.put("/ingredients/:id", async (c) => {
  const w = await ws(c);
  const row = await ownIngredient(c, w);
  const body = await parseBody(c, ingredientSchema);
  await run(
    c.env.DB,
    "UPDATE fc_ingredients SET name_bn = ?, name_en = ?, category = ?, g_per_ml = ?, g_per_piece = ?, updated_at = ? WHERE id = ?",
    body.name_bn,
    body.name_en,
    body.category,
    body.g_per_ml,
    body.g_per_piece,
    nowIso(),
    row.id,
  );
  return ok(c, { ingredient: await ingredientOut(c, w, row.id) });
});

/** Delete one's own ingredient — not while a recipe uses it. */
fcRoutes.delete("/ingredients/:id", async (c) => {
  const w = await ws(c);
  const row = await ownIngredient(c, w);
  const used = await first<{ n: number }>(
    c.env.DB,
    "SELECT COUNT(*) AS n FROM fc_recipe_items i JOIN fc_recipes r ON r.id = i.recipe_id WHERE i.ingredient_id = ? AND r.deleted_at IS NULL",
    row.id,
  );
  if (used?.n) throw conflict("fc_in_use");
  await run(c.env.DB, "DELETE FROM fc_ingredients WHERE id = ? AND workspace_id = ?", row.id, w.id);
  return ok(c, { deleted: true });
});

/* ----------------------------------------------------------------------------------------------------------------------------- prices */

async function addPrice(c: Ctx, w: Workspace, ingredientId: number, p: z.output<typeof priceSchema>) {
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, currency, supplier, bought_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
      ingredientId,
      w.id,
      p.pack_qty,
      p.pack_unit,
      p.price_minor,
      w.currency,
      p.supplier,
      p.bought_on ?? null,
    ),
    // only the newest changes are kept
    c.env.DB.prepare(
      "DELETE FROM fc_prices WHERE id IN (SELECT id FROM fc_prices WHERE ingredient_id = ? AND workspace_id = ? ORDER BY id DESC LIMIT -1 OFFSET ?)",
    ).bind(ingredientId, w.id, OWN_PRICE_HISTORY),
  ]);
}

/** One's own price for an ingredient — for oneself only; it replaces staff's default in one's own recipes. Each change is kept. */
fcRoutes.put("/prices/:id", async (c) => {
  const w = await ws(c);
  const row = await ingredientFor(c.env, w.id, intParam(c, "id"));
  if (!row) throw notFound();
  const body = await parseBody(c, priceSchema);
  await addPrice(c, w, row.id, body);
  return ok(c, { ingredient: await ingredientOut(c, w, row.id) });
});

/** Back to staff's default price (one's own prices for it are removed). */
fcRoutes.delete("/prices/:id", async (c) => {
  const w = await ws(c);
  const row = await ingredientFor(c.env, w.id, intParam(c, "id"));
  if (!row) throw notFound();
  await run(c.env.DB, "DELETE FROM fc_prices WHERE ingredient_id = ? AND workspace_id = ?", row.id, w.id);
  return ok(c, { ingredient: await ingredientOut(c, w, row.id) });
});

/** One's own price history for an ingredient, newest first, with staff's current default. */
fcRoutes.get("/prices/:id", async (c) => {
  const w = await ws(c);
  const row = await ingredientFor(c.env, w.id, intParam(c, "id"));
  if (!row) throw notFound();
  const [history, latest] = await Promise.all([
    all<PriceRow>(
      c.env.DB,
      "SELECT ingredient_id, workspace_id, pack_qty, pack_unit, price_minor, supplier, bought_on, created_at FROM fc_prices WHERE ingredient_id = ? AND workspace_id = ? ORDER BY id DESC LIMIT 50",
      row.id,
      w.id,
    ),
    latestPrices(c.env, w.id, [row.id]),
  ]);
  return ok(c, { history: history.map(priceDTO), default_price: priceDTO(latest.defaults.get(row.id)) });
});

/* ---------------------------------------------------------------------------------------------------------------------------- recipes */

/** The workspace's recipes, each with its cost per unit and suggested price, and where the limit stands. */
fcRoutes.get("/recipes", async (c) => {
  const w = await ws(c);
  const [book, me] = await Promise.all([bookOf(c.env, w.id), meDTO(c.env, w)]);
  return ok(c, { recipes: summaries(book), me });
});

fcRoutes.post("/recipes", async (c) => {
  const w = await ws(c);
  const body = await parseBody(c, recipeSchema);
  await checkRecipe(c, w, body, 0);
  const recipeId = await insertRecipe(c, w, body);
  await audit(c, { action: "fc.recipe_created", entity: "fc_recipe", entityId: recipeId });
  return ok(c, await recipeOut(c, w, recipeId), 201);
});

fcRoutes.get("/recipes/:id", async (c) => {
  const w = await ws(c);
  return ok(c, await recipeOut(c, w, intParam(c, "id")));
});

fcRoutes.put("/recipes/:id", async (c) => {
  const w = await ws(c);
  const recipeId = intParam(c, "id");
  const body = await parseBody(c, recipeSchema);
  const mine = await first<{ id: number }>(c.env.DB, "SELECT id FROM fc_recipes WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL", recipeId, w.id);
  if (!mine) throw notFound();
  await checkRecipe(c, w, body, recipeId);
  // the recipe and its lines change together, or not at all
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE fc_recipes SET name = ?, notes = ?, yield_qty = ?, yield_unit = ?, yield_label = ?, output_g = ?, costs = ?, pricing = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
    ).bind(body.name, body.notes, body.yield_qty, body.yield_unit, body.yield_label, body.output_g, JSON.stringify(body.costs), JSON.stringify(body.pricing), nowIso(), recipeId, w.id),
    c.env.DB.prepare("DELETE FROM fc_recipe_items WHERE recipe_id = ?").bind(recipeId),
    ...itemStatements(c.env, recipeId, body.items),
  ]);
  return ok(c, await recipeOut(c, w, recipeId));
});

/** Delete a recipe (its place under the limit is freed) — not while another recipe uses it: those are named. */
fcRoutes.delete("/recipes/:id", async (c) => {
  const w = await ws(c);
  const recipeId = intParam(c, "id");
  const mine = await first<{ id: number }>(c.env.DB, "SELECT id FROM fc_recipes WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL", recipeId, w.id);
  if (!mine) throw notFound();
  const users = await all<{ name: string }>(
    c.env.DB,
    "SELECT DISTINCT r.name FROM fc_recipe_items i JOIN fc_recipes r ON r.id = i.recipe_id WHERE i.sub_recipe_id = ? AND r.deleted_at IS NULL AND r.id <> ? ORDER BY r.name LIMIT 10",
    recipeId,
    recipeId,
  );
  if (users.length) throw new HttpError(409, "fc_in_use", "fc_in_use", { used_by: users.map((u) => u.name).join(", ") });
  await run(c.env.DB, "UPDATE fc_recipes SET deleted_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?", nowIso(), nowIso(), recipeId, w.id);
  await audit(c, { action: "fc.recipe_deleted", entity: "fc_recipe", entityId: recipeId });
  return ok(c, { deleted: true });
});

/** A copy of a recipe ("… (copy)"), counted against the limit like a new one. */
fcRoutes.post("/recipes/:id/duplicate", async (c) => {
  const w = await ws(c);
  const source = (await recipesOf(c.env, w.id)).find((r) => r.id === intParam(c, "id"));
  if (!source) throw notFound();
  const items: FcItemDTO[] = source.items;
  const recipeId = await insertRecipe(c, w, { ...source, name: `${source.name} (copy)`.slice(0, 120), items });
  await audit(c, { action: "fc.recipe_created", entity: "fc_recipe", entityId: recipeId, meta: { copy_of: source.id } });
  return ok(c, await recipeOut(c, w, recipeId), 201);
});
