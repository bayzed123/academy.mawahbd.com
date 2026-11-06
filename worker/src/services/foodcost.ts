import {
  fcCostWith,
  fcRecipe,
  fcRecipeLimit,
  type FcBook,
  type FcCostDTO,
  type FcCurrency,
  type FcIngredientDTO,
  type FcItemDTO,
  type FcMeDTO,
  type FcPlan,
  type FcPriceDTO,
  type FcPricingDTO,
  type FcRecipeDTO,
  type FcRecipeSummaryDTO,
  type FcResult,
  type FcUnit,
} from "@mawah/shared/foodcost";
import type { Env } from "../env";
import { all, first, qs } from "../lib/db";

/*
 * FoodCost Pro on the server (docs/foodcost.md): workspaces, plans and limits, ingredients with the price that counts for a workspace (its
 * own, else the shared default staff keep in Admin), and recipes — costed with the same engine the website and the app run
 * (shared/src/foodcost.ts), so a saved recipe and the one on the screen always agree.
 */

export interface Workspace {
  id: number;
  student_id: number;
  plan: FcPlan;
  plan_until: string | null;
  plan_source: string;
  currency: FcCurrency;
}

/** A student's personal workspace, made the first time they open FoodCost. */
export async function workspaceFor(env: Env, studentId: number): Promise<Workspace> {
  const cols = "id, student_id, plan, plan_until, plan_source, currency";
  const found = await first<Workspace>(env.DB, `SELECT ${cols} FROM fc_workspaces WHERE student_id = ?`, studentId);
  if (found) return found;
  await env.DB.prepare("INSERT INTO fc_workspaces (student_id) VALUES (?) ON CONFLICT(student_id) DO NOTHING").bind(studentId).run();
  return (await first<Workspace>(env.DB, `SELECT ${cols} FROM fc_workspaces WHERE student_id = ?`, studentId))!;
}

/**
 * A MAWAH student: someone with a class of the website that is theirs (bought, given by staff, or in a bundle). A free class of the Android
 * app does not count — anyone can join one — nor a free website class, for the same reason.
 */
export async function isMawahStudent(env: Env, studentId: number): Promise<boolean> {
  const row = await first<{ one: number }>(
    env.DB,
    `SELECT 1 AS one FROM enrollments e JOIN courses c ON c.id = e.course_id
     WHERE e.student_id = ? AND e.status = 'active' AND e.source IN ('purchase','admin','bundle') AND c.channel = 'website' LIMIT 1`,
    studentId,
  );
  return !!row;
}

/** The plan that is in force now: a Pro that has run out is Free again. */
export function planNow(ws: Pick<Workspace, "plan" | "plan_until">, now = new Date()): FcPlan {
  return ws.plan === "pro" && (!ws.plan_until || ws.plan_until > now.toISOString()) ? "pro" : "free";
}

export async function recipeCount(env: Env, workspaceId: number): Promise<number> {
  return (await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM fc_recipes WHERE workspace_id = ? AND deleted_at IS NULL", workspaceId))?.n ?? 0;
}

/** What the screens show about the plan: which one, the limit and how much of it is used. */
export async function meDTO(env: Env, ws: Workspace): Promise<FcMeDTO> {
  const [student, used] = await Promise.all([isMawahStudent(env, ws.student_id), recipeCount(env, ws.id)]);
  const plan = planNow(ws);
  return { plan, plan_until: plan === "pro" ? ws.plan_until : null, student, limit: fcRecipeLimit(plan, student), used, currency: ws.currency };
}

/* ------------------------------------------------------------------------------------------------------------------------ ingredients */

interface IngredientRow {
  id: number;
  workspace_id: number | null;
  name_bn: string;
  name_en: string;
  category: string;
  g_per_ml: number | null;
  g_per_piece: number | null;
  active: number;
  sort: number;
}
export interface PriceRow {
  ingredient_id: number;
  workspace_id: number | null;
  pack_qty: number;
  pack_unit: FcUnit;
  price_minor: number;
  supplier: string;
  bought_on: string | null;
  created_at: string;
}

export const priceDTO = (p: PriceRow | undefined | null): FcPriceDTO | null =>
  p ? { pack_qty: p.pack_qty, pack_unit: p.pack_unit, price_minor: p.price_minor, supplier: p.supplier, bought_on: p.bought_on, at: p.created_at } : null;

/** The newest price of each ingredient: the shared defaults, and (with a workspace) that workspace's own. */
export async function latestPrices(env: Env, workspaceId: number | null, ingredientIds?: number[]): Promise<{ defaults: Map<number, PriceRow>; mine: Map<number, PriceRow> }> {
  if (ingredientIds && !ingredientIds.length) return { defaults: new Map(), mine: new Map() };
  const only = ingredientIds ? `AND ingredient_id IN (${qs(ingredientIds.length)})` : "";
  const rows = await all<PriceRow>(
    env.DB,
    `SELECT p.ingredient_id, p.workspace_id, p.pack_qty, p.pack_unit, p.price_minor, p.supplier, p.bought_on, p.created_at FROM fc_prices p
     JOIN (SELECT MAX(id) AS id FROM fc_prices WHERE (workspace_id IS NULL OR workspace_id = ?) ${only} GROUP BY ingredient_id, workspace_id) last ON last.id = p.id`,
    workspaceId ?? -1,
    ...(ingredientIds ?? []),
  );
  const defaults = new Map<number, PriceRow>();
  const mine = new Map<number, PriceRow>();
  for (const r of rows) (r.workspace_id === null ? defaults : mine).set(r.ingredient_id, r);
  return { defaults, mine };
}

function ingredientDTO(r: IngredientRow, defaults: Map<number, PriceRow>, mine: Map<number, PriceRow>): FcIngredientDTO {
  const own = mine.get(r.id);
  const def = defaults.get(r.id);
  return {
    id: r.id,
    own: r.workspace_id !== null,
    name_bn: r.name_bn,
    name_en: r.name_en,
    category: r.category,
    g_per_ml: r.g_per_ml,
    g_per_piece: r.g_per_piece,
    active: !!r.active,
    price: priceDTO(own ?? def),
    price_source: own ? "mine" : def ? "default" : null,
    default_price: priceDTO(def),
  };
}

const INGREDIENT_COLS = "id, workspace_id, name_bn, name_en, category, g_per_ml, g_per_piece, active, sort";

/** Every ingredient a workspace may use — the shared list and its own — each with the price that counts for it. */
export async function ingredientsFor(env: Env, workspaceId: number): Promise<FcIngredientDTO[]> {
  const [rows, prices] = await Promise.all([
    all<IngredientRow>(env.DB, `SELECT ${INGREDIENT_COLS} FROM fc_ingredients WHERE workspace_id IS NULL OR workspace_id = ? ORDER BY workspace_id IS NOT NULL, sort, name_en, name_bn, id`, workspaceId),
    latestPrices(env, workspaceId),
  ]);
  return rows.map((r) => ingredientDTO(r, prices.defaults, prices.mine));
}

/** One ingredient the workspace may use (shared, or its own), or null. */
export async function ingredientFor(env: Env, workspaceId: number, id: number): Promise<IngredientRow | null> {
  return first<IngredientRow>(env.DB, `SELECT ${INGREDIENT_COLS} FROM fc_ingredients WHERE id = ? AND (workspace_id IS NULL OR workspace_id = ?)`, id, workspaceId);
}

/* ------------------------------------------------------------------------------------------------------------------------------ recipes */

interface RecipeRow {
  id: number;
  workspace_id: number;
  name: string;
  notes: string;
  yield_qty: number;
  yield_unit: FcUnit;
  yield_label: string;
  output_g: number | null;
  costs: string;
  pricing: string;
  created_at: string;
  updated_at: string;
}
interface ItemRow {
  recipe_id: number;
  ingredient_id: number | null;
  sub_recipe_id: number | null;
  qty: number;
  unit: FcUnit;
  note: string;
}

const DEFAULT_PRICING: FcPricingDTO = { mode: "markup", pct: 0, round_to_minor: 0, actual_minor: null };
const parse = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

function recipeDTO(r: RecipeRow, items: ItemRow[]): FcRecipeDTO {
  return {
    id: r.id,
    name: r.name,
    notes: r.notes,
    yield_qty: r.yield_qty,
    yield_unit: r.yield_unit,
    yield_label: r.yield_label,
    output_g: r.output_g,
    items: items.map((i) => ({ ingredient_id: i.ingredient_id, recipe_id: i.sub_recipe_id, qty: i.qty, unit: i.unit, note: i.note })),
    costs: parse<FcCostDTO[]>(r.costs, []),
    pricing: { ...DEFAULT_PRICING, ...parse<Partial<FcPricingDTO>>(r.pricing, {}) },
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const RECIPE_COLS = "id, workspace_id, name, notes, yield_qty, yield_unit, yield_label, output_g, costs, pricing, created_at, updated_at";

/** Every live recipe of a workspace with its lines — what the engine needs to cost any one of them (they may use each other). */
export async function recipesOf(env: Env, workspaceId: number): Promise<FcRecipeDTO[]> {
  const [rows, items] = await Promise.all([
    all<RecipeRow>(env.DB, `SELECT ${RECIPE_COLS} FROM fc_recipes WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC`, workspaceId),
    all<ItemRow>(
      env.DB,
      `SELECT i.recipe_id, i.ingredient_id, i.sub_recipe_id, i.qty, i.unit, i.note FROM fc_recipe_items i JOIN fc_recipes r ON r.id = i.recipe_id
       WHERE r.workspace_id = ? AND r.deleted_at IS NULL ORDER BY i.recipe_id, i.sort, i.id`,
      workspaceId,
    ),
  ]);
  const byRecipe = new Map<number, ItemRow[]>();
  for (const i of items) byRecipe.set(i.recipe_id, [...(byRecipe.get(i.recipe_id) ?? []), i]);
  return rows.map((r) => recipeDTO(r, byRecipe.get(r.id) ?? []));
}

/** Everything a workspace's recipes are costed with: its ingredients (with the prices that count) and its recipes. */
export async function bookOf(env: Env, workspaceId: number): Promise<{ ingredients: FcIngredientDTO[]; recipes: FcRecipeDTO[] }> {
  const [ingredients, recipes] = await Promise.all([ingredientsFor(env, workspaceId), recipesOf(env, workspaceId)]);
  return { ingredients, recipes };
}

/** Cost one recipe against a workspace's book (the recipe as given — saved or not — wins over the saved copy of the same id). */
export function costWith(recipe: Parameters<typeof fcRecipe>[0], book: FcBook): FcResult {
  return fcCostWith(recipe, book);
}

export function summaries(book: { ingredients: FcIngredientDTO[]; recipes: FcRecipeDTO[] }): FcRecipeSummaryDTO[] {
  const usedBy = new Map<number, number>();
  for (const r of book.recipes) for (const i of r.items) if (i.recipe_id !== null) usedBy.set(i.recipe_id, (usedBy.get(i.recipe_id) ?? 0) + 1);
  return book.recipes.map((r) => {
    const result = costWith(r, book);
    return {
      id: r.id,
      name: r.name,
      yield_qty: r.yield_qty,
      yield_unit: r.yield_unit,
      yield_label: r.yield_label,
      per_unit_minor: result.perUnitMinor,
      suggested_minor: result.suggestedMinor,
      complete: result.complete,
      used_by: usedBy.get(r.id) ?? 0,
      updated_at: r.updated_at,
    };
  });
}

export interface RecipeInput {
  name: string;
  notes: string;
  yield_qty: number;
  yield_unit: FcUnit;
  yield_label: string;
  output_g: number | null;
  items: FcItemDTO[];
  costs: FcCostDTO[];
  pricing: FcPricingDTO;
}

/** The statements that write a recipe's lines (after its old ones are gone). */
export function itemStatements(env: Env, recipeId: number, items: FcItemDTO[]): D1PreparedStatement[] {
  return items.map((i, n) =>
    env.DB.prepare("INSERT INTO fc_recipe_items (recipe_id, sort, ingredient_id, sub_recipe_id, qty, unit, note) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      recipeId,
      n,
      i.ingredient_id,
      i.recipe_id,
      i.qty,
      i.unit,
      i.note,
    ),
  );
}

/** Which of the given ingredient ids and recipe ids this workspace may not use (not its own, not on the shared list, deleted). */
export async function foreignRefs(env: Env, workspaceId: number, items: FcItemDTO[]): Promise<number[]> {
  const ingIds = [...new Set(items.map((i) => i.ingredient_id).filter((x): x is number => x !== null))];
  const recIds = [...new Set(items.map((i) => i.recipe_id).filter((x): x is number => x !== null))];
  const [ings, recs] = await Promise.all([
    ingIds.length ? all<{ id: number }>(env.DB, `SELECT id FROM fc_ingredients WHERE id IN (${qs(ingIds.length)}) AND (workspace_id IS NULL OR workspace_id = ?)`, ...ingIds, workspaceId) : [],
    recIds.length ? all<{ id: number }>(env.DB, `SELECT id FROM fc_recipes WHERE id IN (${qs(recIds.length)}) AND workspace_id = ? AND deleted_at IS NULL`, ...recIds, workspaceId) : [],
  ]);
  const okIng = new Set(ings.map((r) => r.id));
  const okRec = new Set(recs.map((r) => r.id));
  return items.flatMap((i, n) => ((i.ingredient_id !== null && !okIng.has(i.ingredient_id)) || (i.recipe_id !== null && !okRec.has(i.recipe_id)) ? [n] : []));
}

/**
 * Whether saving `candidate` would make a recipe use itself, through any chain of the workspace's recipes (cycle), or nest deeper than the
 * engine goes (too_deep). The engine would only report it; a recipe like that is refused when it is saved.
 */
export function chainProblem(candidate: { id: number; items: FcItemDTO[] }, recipes: FcRecipeDTO[], maxDepth: number): "cycle" | "too_deep" | null {
  const edges = new Map<number, number[]>(recipes.map((r) => [r.id, r.items.map((i) => i.recipe_id).filter((x): x is number => x !== null)]));
  edges.set(candidate.id, candidate.items.map((i) => i.recipe_id).filter((x): x is number => x !== null));
  let problem: "cycle" | "too_deep" | null = null;
  const walk = (id: number, path: number[]) => {
    if (problem === "cycle") return;
    for (const next of edges.get(id) ?? []) {
      if (next === candidate.id || path.includes(next)) {
        problem = "cycle";
        return;
      }
      // the engine costs a chain of up to maxDepth recipes (this one counted): one more is too deep
      if (path.length >= maxDepth) problem ??= "too_deep";
      else walk(next, [...path, next]);
    }
  };
  walk(candidate.id, [candidate.id]);
  return problem;
}
