import { formatNumber, fromBnDigits, toBnDigits, type Lang } from "./format";

/*
 * FoodCost Pro — the calculation engine. One piece of plain TypeScript that the website, the Android app, the server (saved recipes,
 * reports) and the tests all run, so a recipe costs the same everywhere. It knows nothing of databases, screens or languages: it takes a
 * recipe and the ingredients' prices and returns every number with the problems it met, never a number it could not stand behind.
 *
 * - Money is in minor units (paisa for taka, cents for dollars) with a currency code; lines are rounded to the minor unit and the totals are
 *   the sums of the rounded lines, so what is shown always adds up.
 * - Quantities are converted to base units: grams, millilitres, pieces. Between weight and volume an ingredient needs its density (grams per
 *   millilitre); between pieces and weight, the weight of one piece. Without it the line is a problem, never a guess.
 * - A recipe may use another recipe (a buttercream in a cake): its whole batch cost is shared out by how much of it is used.
 * - Markup and margin are both offered, and are not the same thing: a 25% markup on ৳100 is ৳125, a 25% margin is ৳133.34.
 */

export type FcDimension = "mass" | "volume" | "count";
export type FcUnit = "mg" | "g" | "kg" | "lb" | "oz" | "ml" | "l" | "tsp" | "tbsp" | "cup" | "piece" | "dozen";

/** Every unit, its dimension and how many base units (g, ml, piece) one of it is. Spoons and cup are metric (5 ml, 15 ml, 240 ml). */
export const FC_UNITS: Record<FcUnit, { dim: FcDimension; base: number }> = {
  mg: { dim: "mass", base: 0.001 },
  g: { dim: "mass", base: 1 },
  kg: { dim: "mass", base: 1000 },
  lb: { dim: "mass", base: 453.59237 },
  oz: { dim: "mass", base: 28.349523125 },
  ml: { dim: "volume", base: 1 },
  l: { dim: "volume", base: 1000 },
  tsp: { dim: "volume", base: 5 },
  tbsp: { dim: "volume", base: 15 },
  cup: { dim: "volume", base: 240 },
  piece: { dim: "count", base: 1 },
  dozen: { dim: "count", base: 12 },
};
export const FC_UNIT_LIST = Object.keys(FC_UNITS) as FcUnit[];
export const isFcUnit = (u: unknown): u is FcUnit => typeof u === "string" && Object.prototype.hasOwnProperty.call(FC_UNITS, u);

/** The currencies a workspace can keep its prices in, and how many minor units make one (all of these: 100). */
export const FC_CURRENCIES = {
  BDT: { symbol: "৳", minor: 100 },
  USD: { symbol: "$", minor: 100 },
  GBP: { symbol: "£", minor: 100 },
  EUR: { symbol: "€", minor: 100 },
  AED: { symbol: "AED ", minor: 100 },
} as const;
export type FcCurrency = keyof typeof FC_CURRENCIES;
export const FC_CURRENCY_LIST = Object.keys(FC_CURRENCIES) as FcCurrency[];

/** What one pack costs: "৳120 for 1 kg", "৳150 for 1 dozen", "৳850 for 2 l". */
export interface FcPrice {
  packQty: number;
  packUnit: FcUnit;
  /** in minor units (paisa) */
  priceMinor: number;
}

export interface FcIngredient {
  id: string | number;
  name: string;
  /** grams in one millilitre (flour ≈ 0.53, oil ≈ 0.92, water 1): lets weight and volume meet */
  gPerMl?: number | null;
  /** grams in one piece (an egg ≈ 50): lets pieces and weight meet */
  gPerPiece?: number | null;
  /** null: no price yet */
  price: FcPrice | null;
  /** its figures per 100 g (calories, protein …); null or no kcal: none */
  nutrition?: FcNutrition | null;
}

/** One line of a recipe: an ingredient, or another recipe, and how much of it. */
export interface FcItem {
  ingredientId?: string | number | null;
  recipeId?: string | number | null;
  qty: number;
  unit: FcUnit;
}

export type FcCostKind = "packaging" | "labour" | "energy" | "other";
/** A cost that is not an ingredient: for the whole batch, for each piece made, or a rate for each hour (labour, the oven's gas or electricity). */
export interface FcCost {
  kind: FcCostKind;
  label?: string;
  per: "batch" | "piece" | "hour";
  amountMinor: number;
  /** with per = "hour": how many hours the batch takes */
  hours?: number;
}

export interface FcPricing {
  /** markup: the profit as a part of the cost; margin: the profit as a part of the price */
  mode: "markup" | "margin";
  pct: number;
  /** the suggested price is rounded up to a multiple of this (in minor units: 100 = ৳1, 500 = ৳5); 0 or missing = to the paisa */
  roundToMinor?: number;
  /** the price it is (or will be) sold at, for each yield unit — to see the real profit */
  actualMinor?: number | null;
}

export interface FcRecipe {
  id: string | number;
  name: string;
  /** what one batch makes: 12 pieces, 1 cake, 800 g of buttercream */
  yieldQty: number;
  yieldUnit: FcUnit;
  /** the batch's finished weight in grams, when the yield is counted (lets another recipe use it by weight) */
  outputG?: number | null;
  items: FcItem[];
  costs: FcCost[];
  pricing?: FcPricing | null;
}

export type FcProblemCode =
  | "bad_qty" // a quantity that is not a positive number
  | "unknown_ingredient"
  | "unknown_recipe"
  | "no_price" // the ingredient has no price yet
  | "unit_mismatch" // weight against volume (or pieces) with no density / piece weight to bridge them
  | "cycle" // a recipe that ends up using itself
  | "too_deep" // recipes inside recipes, more than FC_MAX_DEPTH deep
  | "sub_recipe_problem" // the recipe used here has a problem of its own (its cost is counted as far as it goes)
  | "bad_yield" // the batch makes nothing
  | "bad_cost" // a cost that is not a whole, non-negative amount (or negative hours)
  | "per_piece_needs_count" // a cost "for each piece" in a recipe whose yield is a weight or a volume
  | "bad_margin" // a margin of 100% or more: no price can reach it
  | "bad_pct" // a negative or impossible percentage
  | "bad_price"; // an actual price that is not a whole, non-negative amount

/** Problems about the price only: the cost is still whole. */
const PRICING_ONLY: ReadonlySet<FcProblemCode> = new Set(["bad_margin", "bad_pct", "bad_price"]);

export interface FcProblem {
  code: FcProblemCode;
  /** the recipe line (items) or cost line (costs) it is about */
  line?: number;
  cost?: number;
}

export interface FcLine {
  kind: "ingredient" | "recipe";
  ref: string | number | null;
  name: string;
  qty: number;
  unit: FcUnit;
  /** in minor units, rounded; 0 when it could not be costed */
  costMinor: number;
  /** its part of the ingredients' cost, in % (one decimal) */
  sharePct: number;
  problem?: FcProblemCode;
}

export interface FcResult {
  lines: FcLine[];
  ingredientsMinor: number;
  packagingMinor: number;
  labourMinor: number;
  energyMinor: number;
  otherMinor: number;
  /** everything one batch costs */
  batchMinor: number;
  /** the cost of one yield unit (one piece, one cake, one gram of buttercream …) */
  perUnitMinor: number | null;
  /** the price for one yield unit that reaches the markup or margin, rounded up to the step */
  suggestedMinor: number | null;
  /** with an actual price: the profit on one unit and on the batch, and what margin and markup that is */
  actual: { priceMinor: number; profitMinor: number; profitBatchMinor: number; marginPct: number | null; markupPct: number | null } | null;
  problems: FcProblem[];
  /** every line was costed: the totals are the whole cost, not a part of it */
  complete: boolean;
}

/** Recipes inside recipes, at most this deep (a cake → its filling → the filling's caramel …). */
export const FC_MAX_DEPTH = 6;

/** Half up, to a whole minor unit — after cutting off the noise floating point adds (12.4999999 is 12.5). */
export function roundMinor(x: number): number {
  return Math.round(Number(x.toFixed(6)));
}
const round1 = (x: number) => Math.round(Number((x * 10).toFixed(6))) / 10;

/** How many base units (g, ml or pieces) `qty` of `unit` is. */
export function toBase(qty: number, unit: FcUnit): number {
  return qty * FC_UNITS[unit].base;
}

/**
 * `qty` of `unit` in the base unit of dimension `dim`, for this ingredient: a weight as millilitres needs its density, pieces as grams the
 * weight of one piece. null when they cannot meet.
 */
export function convert(qty: number, unit: FcUnit, dim: FcDimension, ing: Pick<FcIngredient, "gPerMl" | "gPerPiece"> = {}): number | null {
  const from = FC_UNITS[unit].dim;
  const base = toBase(qty, unit);
  if (from === dim) return base;
  const gPerMl = ing.gPerMl && ing.gPerMl > 0 ? ing.gPerMl : null;
  const gPerPiece = ing.gPerPiece && ing.gPerPiece > 0 ? ing.gPerPiece : null;
  // everything goes through grams
  const grams = from === "mass" ? base : from === "volume" ? (gPerMl ? base * gPerMl : null) : gPerPiece ? base * gPerPiece : null;
  if (grams === null) return null;
  if (dim === "mass") return grams;
  if (dim === "volume") return gPerMl ? grams / gPerMl : null;
  return gPerPiece ? grams / gPerPiece : null;
}

/** What one `unit` of the ingredient costs, in minor units (not rounded): "৳0.12 a gram". null without a price or a way to convert. */
export function unitCost(ing: FcIngredient, unit: FcUnit): number | null {
  const p = ing.price;
  if (!p || !(p.packQty > 0) || !(p.priceMinor >= 0)) return null;
  const packDim = FC_UNITS[p.packUnit].dim;
  const pack = toBase(p.packQty, p.packUnit);
  const one = convert(1, unit, packDim, ing);
  return one === null ? null : (p.priceMinor / pack) * one;
}

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const wholeMinor = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

interface Book {
  ingredients: ReadonlyMap<string, FcIngredient>;
  recipes: ReadonlyMap<string, FcRecipe>;
}

/**
 * How much of another recipe's batch a line uses (¼ = a quarter of it): in its own yield's terms, or by weight through its finished weight.
 * null when they cannot meet. The cost and the nutrition share a recipe inside a recipe out the same way.
 */
function shareOf(item: FcItem, sub: FcRecipe): number | null {
  const subDim = FC_UNITS[sub.yieldUnit].dim;
  const itemDim = FC_UNITS[item.unit].dim;
  if (itemDim === subDim) return toBase(item.qty, item.unit) / toBase(sub.yieldQty, sub.yieldUnit);
  if (itemDim === "mass" && subDim === "count" && positive(sub.outputG)) return toBase(item.qty, item.unit) / sub.outputG;
  return null;
}

/** What a batch of the recipe weighs in grams, when it is known: a yield by weight, or the finished weight of a counted one. */
function batchGrams(recipe: Pick<FcRecipe, "yieldQty" | "yieldUnit" | "outputG">): number | null {
  if (!(positive(recipe.yieldQty) && isFcUnit(recipe.yieldUnit))) return null;
  const dim = FC_UNITS[recipe.yieldUnit].dim;
  if (dim === "mass") return toBase(recipe.yieldQty, recipe.yieldUnit);
  return dim === "count" && positive(recipe.outputG) ? recipe.outputG : null;
}

function cost(recipe: FcRecipe, book: Book, stack: string[]): FcResult {
  const problems: FcProblem[] = [];
  const key = String(recipe.id);
  const path = [...stack, key];
  const yieldOk = positive(recipe.yieldQty) && isFcUnit(recipe.yieldUnit);
  if (!yieldOk) problems.push({ code: "bad_yield" });
  const yieldDim = yieldOk ? FC_UNITS[recipe.yieldUnit].dim : "count";
  const yieldBase = yieldOk ? toBase(recipe.yieldQty, recipe.yieldUnit) : 0;

  const lines: FcLine[] = recipe.items.map((item, i) => {
    const line: FcLine = { kind: item.recipeId != null ? "recipe" : "ingredient", ref: item.recipeId ?? item.ingredientId ?? null, name: "", qty: item.qty, unit: item.unit, costMinor: 0, sharePct: 0 };
    const fail = (code: FcProblemCode): FcLine => {
      problems.push({ code, line: i });
      return { ...line, problem: code };
    };
    if (!positive(item.qty) || !isFcUnit(item.unit)) return fail("bad_qty");

    if (item.recipeId != null) {
      const sub = book.recipes.get(String(item.recipeId));
      if (!sub) return fail("unknown_recipe");
      line.name = sub.name;
      if (path.includes(String(sub.id))) return fail("cycle");
      if (path.length >= FC_MAX_DEPTH) return fail("too_deep");
      if (!(positive(sub.yieldQty) && isFcUnit(sub.yieldUnit))) return fail("sub_recipe_problem");
      const share = shareOf(item, sub);
      if (share === null) return fail("unit_mismatch");
      // its whole batch (ingredients and its own labour, gas …), shared out by how much of it is used here
      const inner = cost(sub, book, path);
      line.costMinor = roundMinor(inner.batchMinor * share);
      if (!inner.complete) return fail("sub_recipe_problem");
      return line;
    }

    const ing = item.ingredientId != null ? book.ingredients.get(String(item.ingredientId)) : undefined;
    if (!ing) return fail("unknown_ingredient");
    line.name = ing.name;
    if (!ing.price) return fail("no_price");
    const each = unitCost(ing, item.unit);
    if (each === null) return fail("unit_mismatch");
    line.costMinor = roundMinor(each * item.qty);
    return line;
  });

  const ingredientsMinor = lines.reduce((n, l) => n + l.costMinor, 0);
  for (const l of lines) l.sharePct = ingredientsMinor > 0 ? round1((l.costMinor / ingredientsMinor) * 100) : 0;

  const byKind: Record<FcCostKind, number> = { packaging: 0, labour: 0, energy: 0, other: 0 };
  recipe.costs.forEach((c, i) => {
    if (!wholeMinor(c.amountMinor) || !(c.kind in byKind)) return problems.push({ code: "bad_cost", cost: i });
    if (c.per === "batch") byKind[c.kind] += c.amountMinor;
    else if (c.per === "hour") {
      const hours = c.hours ?? 0;
      if (!(typeof hours === "number" && Number.isFinite(hours) && hours >= 0)) return problems.push({ code: "bad_cost", cost: i });
      byKind[c.kind] += roundMinor(c.amountMinor * hours);
    } else if (c.per === "piece") {
      if (!yieldOk) return;
      if (yieldDim !== "count") return problems.push({ code: "per_piece_needs_count", cost: i });
      byKind[c.kind] += roundMinor(c.amountMinor * yieldBase);
    } else problems.push({ code: "bad_cost", cost: i });
  });

  const batchMinor = ingredientsMinor + byKind.packaging + byKind.labour + byKind.energy + byKind.other;
  // the cost of one yield unit, from the batch as shown (the rounded lines) — per piece, per cake, or per gram/ml of a sub-recipe
  const perUnitExact = yieldOk ? batchMinor / recipe.yieldQty : null;
  const perUnitMinor = perUnitExact === null ? null : roundMinor(perUnitExact);

  let suggestedMinor: number | null = null;
  let actual: FcResult["actual"] = null;
  const p = recipe.pricing;
  if (p && perUnitExact !== null) {
    const pctOk = typeof p.pct === "number" && Number.isFinite(p.pct) && p.pct >= 0 && (p.mode === "markup" ? p.pct <= 10_000 : true);
    if (!pctOk) problems.push({ code: "bad_pct" });
    else if (p.mode === "margin" && p.pct >= 100) problems.push({ code: "bad_margin" });
    else {
      const raw = p.mode === "markup" ? perUnitExact * (1 + p.pct / 100) : perUnitExact / (1 - p.pct / 100);
      const step = p.roundToMinor && p.roundToMinor > 0 ? Math.round(p.roundToMinor) : 1;
      // rounded up: a price rounded down would miss the margin asked for
      suggestedMinor = Math.ceil(Number((raw / step).toFixed(6))) * step;
    }
    if (p.actualMinor != null) {
      if (!wholeMinor(p.actualMinor)) problems.push({ code: "bad_price" });
      else {
        const profit = p.actualMinor - perUnitExact;
        actual = {
          priceMinor: p.actualMinor,
          profitMinor: roundMinor(profit),
          profitBatchMinor: roundMinor(profit * recipe.yieldQty),
          marginPct: p.actualMinor > 0 ? round1((profit / p.actualMinor) * 100) : null,
          markupPct: perUnitExact > 0 ? round1((profit / perUnitExact) * 100) : null,
        };
      }
    }
  }

  return {
    lines,
    ingredientsMinor,
    packagingMinor: byKind.packaging,
    labourMinor: byKind.labour,
    energyMinor: byKind.energy,
    otherMinor: byKind.other,
    batchMinor,
    perUnitMinor,
    suggestedMinor,
    actual,
    problems,
    // a price that cannot be worked out leaves the cost whole; anything else means a part of the cost is missing
    complete: problems.every((x) => PRICING_ONLY.has(x.code)),
  };
}

/**
 * Cost a recipe. `ingredients` and `recipes` are what its lines may name (recipes used inside it, and theirs); a line naming something missing
 * is a problem, not an error. Never throws for bad input: it reports it.
 */
export function costRecipe(recipe: FcRecipe, ingredients: Iterable<FcIngredient>, recipes: Iterable<FcRecipe> = []): FcResult {
  const book: Book = {
    ingredients: new Map([...ingredients].map((i) => [String(i.id), i])),
    recipes: new Map([...recipes, recipe].map((r) => [String(r.id), r])),
  };
  return cost(recipe, book, []);
}

/* ------------------------------------------------------------------------------------------------------------------------------------
 * Nutrition: calories and nutrients from each ingredient's figures per 100 g (the starter list's come from USDA's food tables; a user
 * types their own), through the same units and the same sharing of a recipe inside a recipe as the cost. A line it cannot weigh (a cup
 * of something with no density), or an ingredient with no figures, is reported and left out — never guessed — and each total says
 * whether it is the whole of it.
 * ---------------------------------------------------------------------------------------------------------------------------------- */

/** What is counted, per 100 g of an ingredient: energy in kcal, sodium in mg, the rest in grams. */
export const FC_NUTRIENTS = ["kcal", "protein_g", "carbs_g", "fat_g", "sugar_g", "fiber_g", "sodium_mg"] as const;
export type FcNutrient = (typeof FC_NUTRIENTS)[number];
/** An ingredient's figures per 100 g; null or missing = not known. Without kcal it counts as having none. */
export type FcNutrition = Partial<Record<FcNutrient, number | null>>;
export type FcNutrients = Record<FcNutrient, number>;
/** The highest figure per 100 g each nutrient can have (salt is 38,758 mg of sodium; nothing is over 900 kcal or 100 g). */
export const FC_NUTRIENT_MAX: Record<FcNutrient, number> = { kcal: 900, protein_g: 100, carbs_g: 100, fat_g: 100, sugar_g: 100, fiber_g: 100, sodium_mg: 40_000 };

export type FcNutritionProblemCode =
  | "no_figures" // the ingredient has no calorie figure
  | "no_weight" // a volume or pieces of it, with no density / weight of one piece to weigh it
  | "unknown_ingredient"
  | "unknown_recipe"
  | "bad_qty"
  | "cycle"
  | "too_deep"
  | "sub_recipe_problem"; // the recipe used here is missing figures of its own (it is counted as far as it goes)

export interface FcNutritionLine {
  /** what the line weighs; null when it cannot be weighed */
  grams: number | null;
  /** its calories, rounded; null when not known */
  kcal: number | null;
  problem?: FcNutritionProblemCode;
}

export interface FcNutritionResult {
  lines: FcNutritionLine[];
  /** the whole batch, as far as it is known (kcal and mg whole, grams to one decimal) */
  batch: FcNutrients;
  /** one yield unit (a piece, a cake …) when the yield is counted */
  perUnit: FcNutrients | null;
  /** 100 g of what the batch makes, when its weight is known: a yield by weight, or the finished weight */
  per100g: FcNutrients | null;
  /** for each nutrient: every line had its figure, so its total is the whole of it */
  known: Record<FcNutrient, boolean>;
  /** lines that were counted */
  counted: number;
  problems: { code: FcNutritionProblemCode; line: number }[];
  /** every line was counted: the calories are the whole of them */
  complete: boolean;
}

const zeroNutrients = (): FcNutrients => ({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sugar_g: 0, fiber_g: 0, sodium_mg: 0 });
/** kcal and mg to the whole number, grams to one decimal. */
const roundNutrients = (n: FcNutrients, by = 1): FcNutrients =>
  Object.fromEntries(FC_NUTRIENTS.map((k) => [k, k === "kcal" || k === "sodium_mg" ? Math.round(Number((n[k] / by).toFixed(6))) : round1(n[k] / by)])) as FcNutrients;
const figure = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** The batch's figures, unrounded, so a recipe inside another one is shared out before anything is rounded. */
interface RawNutrition {
  lines: FcNutritionLine[];
  batch: FcNutrients;
  known: Record<FcNutrient, boolean>;
  counted: number;
  problems: { code: FcNutritionProblemCode; line: number }[];
}

function nutrition(recipe: FcRecipe, book: Book, stack: string[]): RawNutrition {
  const path = [...stack, String(recipe.id)];
  const batch = zeroNutrients();
  const known = Object.fromEntries(FC_NUTRIENTS.map((k) => [k, true])) as Record<FcNutrient, boolean>;
  const problems: RawNutrition["problems"] = [];
  let counted = 0;
  const unknownAll = () => FC_NUTRIENTS.forEach((k) => (known[k] = false));

  const lines = recipe.items.map((item, i): FcNutritionLine => {
    const fail = (code: FcNutritionProblemCode, grams: number | null = null): FcNutritionLine => {
      problems.push({ code, line: i });
      unknownAll();
      return { grams, kcal: null, problem: code };
    };
    if (!positive(item.qty) || !isFcUnit(item.unit)) return fail("bad_qty");

    if (item.recipeId != null) {
      const sub = book.recipes.get(String(item.recipeId));
      if (!sub) return fail("unknown_recipe");
      if (path.includes(String(sub.id))) return fail("cycle");
      if (path.length >= FC_MAX_DEPTH) return fail("too_deep");
      if (!(positive(sub.yieldQty) && isFcUnit(sub.yieldUnit))) return fail("sub_recipe_problem");
      const share = shareOf(item, sub);
      const weight = batchGrams(sub);
      const grams = FC_UNITS[item.unit].dim === "mass" ? toBase(item.qty, item.unit) : share !== null && weight !== null ? share * weight : null;
      if (share === null) return fail("no_weight");
      // its whole batch's figures, shared out by how much of it is used here — as far as they go
      const inner = nutrition(sub, book, path);
      for (const k of FC_NUTRIENTS) {
        batch[k] += inner.batch[k] * share;
        if (!inner.known[k]) known[k] = false;
      }
      counted++;
      const line: FcNutritionLine = { grams: grams === null ? null : round1(grams), kcal: Math.round(inner.batch.kcal * share) };
      if (inner.problems.length) {
        problems.push({ code: "sub_recipe_problem", line: i });
        return { ...line, problem: "sub_recipe_problem" };
      }
      return line;
    }

    const ing = item.ingredientId != null ? book.ingredients.get(String(item.ingredientId)) : undefined;
    if (!ing) return fail("unknown_ingredient");
    const grams = convert(item.qty, item.unit, "mass", ing);
    const n = ing.nutrition;
    // no figures at all is the first thing to say: weighing it would not help
    if (!n || !figure(n.kcal)) return fail("no_figures", grams === null ? null : round1(grams));
    if (grams === null) return fail("no_weight");
    for (const k of FC_NUTRIENTS) {
      const v = n[k];
      if (figure(v)) batch[k] += (v * grams) / 100;
      else known[k] = false;
    }
    counted++;
    return { grams: round1(grams), kcal: Math.round((n.kcal * grams) / 100) };
  });

  return { lines, batch, known, counted, problems };
}

/**
 * The calories and nutrients of a recipe: the batch, one yield unit (when it is counted: a piece, a cake) and 100 g (when its weight is
 * known). `ingredients` and `recipes` are what its lines may name, as for costRecipe. Never throws for bad input: it reports it.
 */
export function nutritionOf(recipe: FcRecipe, ingredients: Iterable<FcIngredient>, recipes: Iterable<FcRecipe> = []): FcNutritionResult {
  const book: Book = {
    ingredients: new Map([...ingredients].map((i) => [String(i.id), i])),
    recipes: new Map([...recipes, recipe].map((r) => [String(r.id), r])),
  };
  const raw = nutrition(recipe, book, []);
  const counts = positive(recipe.yieldQty) && isFcUnit(recipe.yieldUnit) && FC_UNITS[recipe.yieldUnit].dim === "count";
  const grams = batchGrams(recipe);
  return {
    lines: raw.lines,
    batch: roundNutrients(raw.batch),
    perUnit: counts ? roundNutrients(raw.batch, recipe.yieldQty) : null,
    per100g: grams ? roundNutrients(raw.batch, grams / 100) : null,
    known: raw.known,
    counted: raw.counted,
    problems: raw.problems,
    complete: raw.problems.length === 0,
  };
}

/** Each nutrient's name and unit for people, in both languages. */
export const FC_NUTRIENT_NAMES: Record<FcNutrient, Record<Lang, { name: string; unit: string }>> = {
  kcal: { bn: { name: "ক্যালরি", unit: "ক্যালরি" }, en: { name: "Calories", unit: "kcal" } },
  protein_g: { bn: { name: "প্রোটিন", unit: "গ্রাম" }, en: { name: "Protein", unit: "g" } },
  carbs_g: { bn: { name: "শর্করা", unit: "গ্রাম" }, en: { name: "Carbohydrate", unit: "g" } },
  fat_g: { bn: { name: "চর্বি", unit: "গ্রাম" }, en: { name: "Fat", unit: "g" } },
  sugar_g: { bn: { name: "চিনি (শর্করার অংশ)", unit: "গ্রাম" }, en: { name: "of which sugar", unit: "g" } },
  fiber_g: { bn: { name: "আঁশ", unit: "গ্রাম" }, en: { name: "Fibre", unit: "g" } },
  sodium_mg: { bn: { name: "সোডিয়াম", unit: "মিলিগ্রাম" }, en: { name: "Sodium", unit: "mg" } },
};

/** "245 kcal" / "২৪৫ ক্যালরি", "3.2 g" / "৩.২ গ্রাম": a figure as the engine rounds it, in the reader's digits. */
export function fcNutrientText(k: FcNutrient, value: number, lang: Lang): string {
  return `${formatNumber(value, lang)} ${FC_NUTRIENT_NAMES[k][lang].unit}`;
}

/** "৳৭৪.১৭" / "৳74.17", whole amounts without the paisa ("৳১,২০০"); other currencies with their own sign. */
export function fcMoney(minor: number, lang: Lang, currency: FcCurrency = "BDT"): string {
  const c = FC_CURRENCIES[currency];
  const abs = Math.abs(Math.round(minor));
  const part = abs % c.minor;
  const text = formatNumber(Math.floor(abs / c.minor), "en") + (part ? `.${String(part).padStart(2, "0")}` : "");
  return `${minor < 0 ? "-" : ""}${c.symbol}${lang === "bn" ? toBnDigits(text) : text}`;
}

/** The plans a workspace can be on, and how many saved recipes each keeps. A MAWAH student (a class bought on the website) is never limited. */
export const FC_PLANS = ["free", "pro"] as const;
export type FcPlan = (typeof FC_PLANS)[number];
export const FC_LIMITS: Record<FcPlan | "student", { recipes: number | null }> = {
  free: { recipes: 3 },
  pro: { recipes: null },
  student: { recipes: null },
};

/** How many recipes this workspace may keep: null = no limit. A student is never limited, whatever the plan. */
export function fcRecipeLimit(plan: FcPlan, student: boolean): number | null {
  return student ? FC_LIMITS.student.recipes : FC_LIMITS[plan].recipes;
}

/* ------------------------------------------------------------------------------------------------------------------------------------
 * The API's shapes (/api/fc/v1, snake_case like the rest of the API) and their conversion for the engine — one conversion, used by the
 * server, the website and the app, so a recipe is read the same way everywhere. A computed `result` is the engine's own FcResult.
 * ---------------------------------------------------------------------------------------------------------------------------------- */

export interface FcPriceDTO {
  pack_qty: number;
  pack_unit: FcUnit;
  price_minor: number;
  supplier: string;
  /** the day of the price (yyyy-mm-dd), when given */
  bought_on: string | null;
  /** when it was entered */
  at: string;
}

export interface FcIngredientDTO {
  id: number;
  /** the workspace's own ingredient (not on the shared list) */
  own: boolean;
  name_bn: string;
  name_en: string;
  category: string;
  g_per_ml: number | null;
  g_per_piece: number | null;
  /** switched off by staff: kept for the recipes that use it, not offered for new lines */
  active: boolean;
  /** the price that counts for this workspace: its own, else the shared default */
  price: FcPriceDTO | null;
  price_source: "mine" | "default" | null;
  /** the shared default (Admin), shown next to one's own price */
  default_price: FcPriceDTO | null;
  /** its figures per 100 g; null when it has no calorie figure */
  nutrition: FcNutritionDTO | null;
}

/** An ingredient's figures per 100 g, as the API sends them: each one, or null where it is not known. */
export type FcNutritionDTO = Record<FcNutrient, number | null>;

export interface FcItemDTO {
  ingredient_id: number | null;
  recipe_id: number | null;
  qty: number;
  unit: FcUnit;
  note: string;
}

export interface FcCostDTO {
  kind: FcCostKind;
  label: string;
  per: "batch" | "piece" | "hour";
  amount_minor: number;
  hours: number | null;
}

export interface FcPricingDTO {
  mode: "markup" | "margin";
  pct: number;
  /** the step the suggested price is rounded up to (paisa: 100 = ৳1); 0 = to the paisa */
  round_to_minor: number;
  actual_minor: number | null;
}

export interface FcRecipeDTO {
  id: number;
  name: string;
  notes: string;
  yield_qty: number;
  yield_unit: FcUnit;
  yield_label: string;
  output_g: number | null;
  items: FcItemDTO[];
  costs: FcCostDTO[];
  pricing: FcPricingDTO;
  created_at: string;
  updated_at: string;
}

export interface FcRecipeSummaryDTO {
  id: number;
  name: string;
  yield_qty: number;
  yield_unit: FcUnit;
  yield_label: string;
  per_unit_minor: number | null;
  suggested_minor: number | null;
  complete: boolean;
  /** the calories of one yield unit when the yield is counted and every line has its figure; else null */
  kcal_per_unit: number | null;
  /** other recipes of the workspace use this one (it cannot be deleted while they do) */
  used_by: number;
  updated_at: string;
}

export interface FcMeDTO {
  plan: FcPlan;
  plan_until: string | null;
  /** a MAWAH student: a class bought on the website (or given by staff) — never limited */
  student: boolean;
  /** how many recipes may be kept; null = no limit */
  limit: number | null;
  used: number;
  currency: FcCurrency;
}

const priceOf = (p: FcPriceDTO | null): FcPrice | null => (p ? { packQty: p.pack_qty, packUnit: p.pack_unit, priceMinor: p.price_minor } : null);

/** An ingredient from the API, for the engine, named in the reader's language. */
export function fcIngredient(d: FcIngredientDTO, lang: Lang): FcIngredient {
  return {
    id: d.id,
    name: lang === "bn" ? d.name_bn || d.name_en : d.name_en || d.name_bn,
    gPerMl: d.g_per_ml,
    gPerPiece: d.g_per_piece,
    price: priceOf(d.price),
    nutrition: d.nutrition,
  };
}

/**
 * An ingredient's figures as stored and sent: null unless it has a calorie figure (without one, the others alone mean nothing to a total).
 * `row` has the database's columns (per 100 g).
 */
export function fcNutritionDTO(row: Partial<Record<FcNutrient, number | null>>): FcNutritionDTO | null {
  if (!figure(row.kcal)) return null;
  return Object.fromEntries(FC_NUTRIENTS.map((k) => [k, figure(row[k]) ? row[k] : null])) as FcNutritionDTO;
}

/** A recipe from the API (or a form shaped like it), for the engine. */
export function fcRecipe(d: Pick<FcRecipeDTO, "id" | "name" | "yield_qty" | "yield_unit" | "output_g" | "items" | "costs" | "pricing">): FcRecipe {
  return {
    id: d.id,
    name: d.name,
    yieldQty: d.yield_qty,
    yieldUnit: d.yield_unit,
    outputG: d.output_g,
    items: d.items.map((i) => ({ ingredientId: i.ingredient_id, recipeId: i.recipe_id, qty: i.qty, unit: i.unit })),
    costs: d.costs.map((c) => ({ kind: c.kind, label: c.label, per: c.per, amountMinor: c.amount_minor, hours: c.hours ?? undefined })),
    pricing: { mode: d.pricing.mode, pct: d.pricing.pct, roundToMinor: d.pricing.round_to_minor, actualMinor: d.pricing.actual_minor },
  };
}

/** Each unit's name for people, in both languages (the codes — g, kg, tbsp … — stay in the data). */
export const FC_UNIT_NAMES: Record<FcUnit, Record<Lang, string>> = {
  mg: { bn: "মিলিগ্রাম", en: "mg" },
  g: { bn: "গ্রাম", en: "g" },
  kg: { bn: "কেজি", en: "kg" },
  lb: { bn: "পাউন্ড", en: "lb" },
  oz: { bn: "আউন্স", en: "oz" },
  ml: { bn: "মিলি", en: "ml" },
  l: { bn: "লিটার", en: "l" },
  tsp: { bn: "চা চামচ", en: "tsp" },
  tbsp: { bn: "টেবিল চামচ", en: "tbsp" },
  cup: { bn: "কাপ", en: "cup" },
  piece: { bn: "পিস", en: "piece" },
  dozen: { bn: "ডজন", en: "dozen" },
};

/* ------------------------------------------------------------------------------------------------------------------------------------
 * What the screens share (the website and the Android app): costing against a workspace's book exactly as the server does, the numbers
 * people type, and the recipe form while one types — so a recipe is read, costed and saved the same way on every screen.
 * ---------------------------------------------------------------------------------------------------------------------------------- */

/** Everything the engine needs from a workspace: its ingredients (shared and own, each with the price that counts) and its recipes. */
export interface FcBook {
  ingredients: FcIngredientDTO[];
  recipes: FcRecipeDTO[];
}

/**
 * Cost one recipe against a workspace's book — the server, the website and the app all call this. The recipe as given (saved or not, a
 * new one with id 0) wins over the saved copy of the same id. Line names are in `lang`.
 */
export function fcCostWith(recipe: Parameters<typeof fcRecipe>[0], book: FcBook, lang: Lang = "en"): FcResult {
  return costRecipe(
    fcRecipe(recipe),
    book.ingredients.map((i) => fcIngredient(i, lang)),
    book.recipes.filter((r) => r.id !== recipe.id).map(fcRecipe),
  );
}

/** The calories and nutrients of one recipe against a workspace's book, like fcCostWith (the recipe as given wins over its saved copy). */
export function fcNutritionWith(recipe: Parameters<typeof fcRecipe>[0], book: FcBook): FcNutritionResult {
  return nutritionOf(
    fcRecipe(recipe),
    book.ingredients.map((i) => fcIngredient(i, "en")),
    book.recipes.filter((r) => r.id !== recipe.id).map(fcRecipe),
  );
}

/** A number people type ("120", "115.50", "১২০.৫০", "1,200"); null when it is not one, or not above zero unless `zero` is allowed. */
export function fcParseNumber(text: string, zero = false): number | null {
  const t = fromBnDigits(text.trim()).replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && (n > 0 || (zero && n === 0)) ? n : null;
}

/** Taka people type → paisa ("120.50" → 12050); null when it is not an amount. */
export function fcParseTaka(text: string): number | null {
  const n = fcParseNumber(text, true);
  return n === null ? null : Math.round(n * 100);
}

/**
 * The nutrition boxes as typed (per 100 g) → what the API takes. An empty box is "not known"; `bad` lists the boxes that are not a figure
 * (or are above what 100 g can hold) — and the calories, when other boxes are filled without them (the others alone mean nothing).
 */
export function fcNutritionFromBoxes(boxes: Partial<Record<FcNutrient, string>>): { nutrition: FcNutritionDTO | null; bad: FcNutrient[] } {
  const bad: FcNutrient[] = [];
  const out = Object.fromEntries(FC_NUTRIENTS.map((k) => [k, null])) as FcNutritionDTO;
  let any = false;
  for (const k of FC_NUTRIENTS) {
    const text = (boxes[k] ?? "").trim();
    if (!text) continue;
    const n = fcParseNumber(text, true);
    if (n === null || n > FC_NUTRIENT_MAX[k]) bad.push(k);
    else {
      out[k] = n;
      any = true;
    }
  }
  if (any && out.kcal === null && !bad.includes("kcal")) bad.unshift("kcal");
  return { nutrition: any && out.kcal !== null ? out : null, bad };
}

/** An ingredient's figures → the boxes to edit them in (empty where not known). */
export function fcNutritionBoxes(n: FcNutritionDTO | null | undefined): Record<FcNutrient, string> {
  return Object.fromEntries(FC_NUTRIENTS.map((k) => [k, n?.[k] == null ? "" : String(n[k])])) as Record<FcNutrient, string>;
}

/** Paisa → the taka to put back in a box ("120", "115.5"), in plain digits. */
export function fcTakaText(minor: number | null | undefined): string {
  return minor === null || minor === undefined ? "" : String(minor / 100);
}

/** The steps a suggested price can be rounded up to, in paisa: none, ৳1, ৳5, ৳10, ৳20, ৳50. */
export const FC_ROUND_STEPS = [0, 100, 500, 1000, 2000, 5000] as const;
export const FC_COST_KINDS: readonly FcCostKind[] = ["packaging", "labour", "energy", "other"];
export const FC_COST_PERS = ["batch", "piece", "hour"] as const;
export type FcCostPer = (typeof FC_COST_PERS)[number];

/** The units a line of this ingredient can be measured in (its price's kind, and others its density or piece weight reach); all without a price. */
export function fcUnitsFor(ing: FcIngredient | null): FcUnit[] {
  if (!ing?.price) return [...FC_UNIT_LIST];
  return FC_UNIT_LIST.filter((u) => unitCost(ing, u) !== null);
}

/** One line of the recipe form, as typed. `ref`: "i12" (ingredient 12), "r3" (recipe 3), "" (not chosen yet). */
export interface FcFormItem {
  ref: string;
  qty: string;
  unit: FcUnit;
  note: string;
}
export interface FcFormCost {
  kind: FcCostKind;
  label: string;
  per: FcCostPer;
  /** taka, as typed */
  amount: string;
  hours: string;
}
/** The recipe form while one types (text in the boxes); `roundTo` is one of FC_ROUND_STEPS. */
export interface FcRecipeForm {
  name: string;
  notes: string;
  yieldQty: string;
  yieldUnit: FcUnit;
  yieldLabel: string;
  outputG: string;
  items: FcFormItem[];
  costs: FcFormCost[];
  mode: "markup" | "margin";
  pct: string;
  roundTo: number;
  actual: string;
}

/** What POST/PUT /recipes takes. */
export type FcRecipeInputDTO = Omit<FcRecipeDTO, "id" | "created_at" | "updated_at">;

export const fcNewItem = (): FcFormItem => ({ ref: "", qty: "", unit: "g", note: "" });

export function fcEmptyForm(): FcRecipeForm {
  return { name: "", notes: "", yieldQty: "", yieldUnit: "piece", yieldLabel: "", outputG: "", items: [fcNewItem()], costs: [], mode: "markup", pct: "", roundTo: 0, actual: "" };
}

export function fcFormFromDTO(r: FcRecipeDTO): FcRecipeForm {
  return {
    name: r.name,
    notes: r.notes,
    yieldQty: String(r.yield_qty),
    yieldUnit: r.yield_unit,
    yieldLabel: r.yield_label,
    outputG: r.output_g === null ? "" : String(r.output_g),
    items: r.items.map((i) => ({ ref: i.ingredient_id !== null ? `i${i.ingredient_id}` : `r${i.recipe_id}`, qty: String(i.qty), unit: i.unit, note: i.note })),
    costs: r.costs.map((c) => ({ kind: c.kind, label: c.label, per: c.per, amount: fcTakaText(c.amount_minor), hours: c.hours === null ? "" : String(c.hours) })),
    mode: r.pricing.mode,
    pct: String(r.pricing.pct),
    roundTo: r.pricing.round_to_minor,
    actual: fcTakaText(r.pricing.actual_minor),
  };
}

/**
 * The form → what the API takes (and the engine reads). Lines with nothing chosen are left out; `rows[k]` is the form line the k-th line
 * sent came from, to put a problem (or the server's `items.k.qty`) back on the right line. A box that is not a number goes as 0, which
 * the engine and the server both report.
 */
export function fcFormToInput(f: FcRecipeForm): { input: FcRecipeInputDTO; rows: number[] } {
  const num = (s: string) => fcParseNumber(s) ?? 0;
  const rows: number[] = [];
  const items = f.items.flatMap((i, n) => {
    if (!/^[ir]\d+$/.test(i.ref)) return [];
    rows.push(n);
    const id = Number(i.ref.slice(1));
    return [{ ingredient_id: i.ref[0] === "i" ? id : null, recipe_id: i.ref[0] === "r" ? id : null, qty: num(i.qty), unit: i.unit, note: i.note.trim() }];
  });
  return {
    rows,
    input: {
      name: f.name.trim(),
      notes: f.notes.trim(),
      yield_qty: num(f.yieldQty),
      yield_unit: f.yieldUnit,
      yield_label: f.yieldLabel.trim(),
      output_g: fcParseNumber(f.outputG),
      items,
      costs: f.costs.map((c) => ({
        kind: c.kind,
        label: c.label.trim(),
        per: c.per,
        amount_minor: fcParseTaka(c.amount) ?? 0,
        hours: c.per === "hour" ? (fcParseNumber(c.hours, true) ?? 0) : null,
      })),
      pricing: { mode: f.mode, pct: fcParseNumber(f.pct, true) ?? 0, round_to_minor: f.roundTo, actual_minor: f.actual.trim() ? fcParseTaka(f.actual) : null },
    },
  };
}
