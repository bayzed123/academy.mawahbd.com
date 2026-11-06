import { describe, expect, it } from "vitest";
import { convert, costRecipe, fcMoney, fcRecipeLimit, roundMinor, toBase, unitCost, type FcIngredient, type FcRecipe } from "@mawah/shared/foodcost";

/*
 * FoodCost Pro's calculation engine (shared/src/foodcost.ts) — the one the website, the Android app and the server all run. What it must
 * never get wrong: a unit turned into another, a pack price shared out per gram or per piece, the lines adding up to the total shown, the
 * cost of each piece, markup told apart from margin, a suggested price that is never below the margin asked for, a recipe inside a recipe
 * shared out by how much of it is used — and a number it cannot stand behind (no price, weight against volume with no density, a recipe
 * that uses itself) reported as a problem, never guessed. The figures below are worked out by hand.
 */

const tk = (taka: number) => Math.round(taka * 100);
const ing = (id: string, name: string, price: FcIngredient["price"], more: Partial<FcIngredient> = {}): FcIngredient => ({ id, name, price, ...more });

// a pantry for the tests (example prices, not market prices)
const FLOUR = ing("flour", "Flour", { packQty: 1, packUnit: "kg", priceMinor: tk(120) }, { gPerMl: 0.53 });
const SUGAR = ing("sugar", "Sugar", { packQty: 1, packUnit: "kg", priceMinor: tk(140) });
const BUTTER = ing("butter", "Butter", { packQty: 500, packUnit: "g", priceMinor: tk(550) });
const EGG = ing("egg", "Egg", { packQty: 1, packUnit: "dozen", priceMinor: tk(150) }, { gPerPiece: 50 });
const MILK = ing("milk", "Milk", { packQty: 1, packUnit: "l", priceMinor: tk(100) }, { gPerMl: 1.03 });
const VANILLA = ing("vanilla", "Vanilla", null);
const PANTRY = [FLOUR, SUGAR, BUTTER, EGG, MILK, VANILLA];

/** 12 cupcakes: ৳490 of ingredients, ৳10 a box each, 2 hours at ৳100, ৳50 of gas, ৳30 more = ৳890 a batch. */
const CUPCAKES: FcRecipe = {
  id: "cupcakes",
  name: "Vanilla cupcakes",
  yieldQty: 12,
  yieldUnit: "piece",
  items: [
    { ingredientId: "flour", qty: 500, unit: "g" }, // ৳60
    { ingredientId: "sugar", qty: 400, unit: "g" }, // ৳56
    { ingredientId: "butter", qty: 250, unit: "g" }, // ৳275
    { ingredientId: "egg", qty: 6, unit: "piece" }, // ৳75
    { ingredientId: "milk", qty: 240, unit: "ml" }, // ৳24
  ],
  costs: [
    { kind: "packaging", label: "Box", per: "piece", amountMinor: tk(10) }, // ৳120
    { kind: "labour", per: "hour", amountMinor: tk(100), hours: 2 }, // ৳200
    { kind: "energy", label: "Gas", per: "batch", amountMinor: tk(50) },
    { kind: "other", label: "Cleaning", per: "batch", amountMinor: tk(30) },
  ],
  pricing: { mode: "markup", pct: 50, roundToMinor: tk(5), actualMinor: tk(120) },
};

describe("units", () => {
  it("turn into grams, millilitres and pieces (metric spoons and cup)", () => {
    expect(toBase(1.5, "kg")).toBe(1500);
    expect(toBase(250, "mg")).toBe(0.25);
    expect(toBase(2, "l")).toBe(2000);
    expect([toBase(1, "tsp"), toBase(1, "tbsp"), toBase(1, "cup")]).toEqual([5, 15, 240]);
    expect(toBase(2, "dozen")).toBe(24);
    expect(toBase(1, "lb")).toBeCloseTo(453.592, 3);
    expect(toBase(1, "oz")).toBeCloseTo(28.3495, 4);
  });

  it("weight and volume meet only through a density, pieces and weight only through the weight of one piece", () => {
    expect(convert(1, "cup", "mass", FLOUR)).toBeCloseTo(127.2, 6); // 240 ml × 0.53 g/ml
    expect(convert(1, "cup", "mass", SUGAR)).toBeNull(); // no density: never a guess
    expect(convert(3, "piece", "mass", EGG)).toBe(150);
    expect(convert(100, "g", "count", EGG)).toBe(2);
    expect(convert(1, "piece", "volume", { gPerPiece: 50, gPerMl: 1.04 })).toBeCloseTo(48.077, 3);
    expect(convert(1, "piece", "volume", { gPerPiece: 50 })).toBeNull();
    expect(convert(1, "kg", "mass", {})).toBe(1000);
  });

  it("a pack price is shared out for any unit the ingredient can be measured in", () => {
    expect(unitCost(FLOUR, "g")).toBeCloseTo(12, 9); // ৳120 a kg = 12 paisa a gram
    expect(unitCost(FLOUR, "cup")).toBeCloseTo(1526.4, 6); // 127.2 g
    expect(unitCost(EGG, "piece")).toBeCloseTo(1250, 9); // ৳150 a dozen = ৳12.50 an egg
    expect(unitCost(EGG, "g")).toBeCloseTo(25, 9); // through 50 g an egg
    expect(unitCost(SUGAR, "cup")).toBeNull();
    expect(unitCost(VANILLA, "tsp")).toBeNull();
    expect(unitCost(ing("x", "X", { packQty: 0, packUnit: "kg", priceMinor: 100 }), "g")).toBeNull();
  });
});

describe("costing a recipe", () => {
  it("adds up the lines, the extra costs, the batch and each piece — the figures worked out by hand", () => {
    const r = costRecipe(CUPCAKES, PANTRY);
    expect(r.lines.map((l) => [l.name, l.costMinor])).toEqual([
      ["Flour", tk(60)],
      ["Sugar", tk(56)],
      ["Butter", tk(275)],
      ["Egg", tk(75)],
      ["Milk", tk(24)],
    ]);
    expect(r.ingredientsMinor).toBe(tk(490));
    expect([r.packagingMinor, r.labourMinor, r.energyMinor, r.otherMinor]).toEqual([tk(120), tk(200), tk(50), tk(30)]);
    expect(r.batchMinor).toBe(tk(890));
    expect(r.perUnitMinor).toBe(7417); // ৳890 ÷ 12 = ৳74.1666…
    // the shares of the ingredients' cost, to one decimal
    expect(r.lines.map((l) => l.sharePct)).toEqual([12.2, 11.4, 56.1, 15.3, 4.9]);
    expect(r.complete).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("suggests a price for the markup or the margin, rounded up to the step — and the two are not the same thing", () => {
    // 50% markup: ৳74.17 × 1.5 = ৳111.25, up to the next ৳5: ৳115
    expect(costRecipe(CUPCAKES, PANTRY).suggestedMinor).toBe(tk(115));
    // 40% margin: ৳74.1667 ÷ 0.6 = ৳123.61, up to the next taka: ৳124
    expect(costRecipe({ ...CUPCAKES, pricing: { mode: "margin", pct: 40, roundToMinor: 100 } }, PANTRY).suggestedMinor).toBe(tk(124));
    // to the paisa when no step is given
    expect(costRecipe({ ...CUPCAKES, pricing: { mode: "margin", pct: 40 } }, PANTRY).suggestedMinor).toBe(12362);

    // on a cost of ৳100: a 25% markup is ৳125, a 25% margin is ৳133.34 — the common mistake
    const hundred: FcRecipe = { id: "h", name: "H", yieldQty: 1, yieldUnit: "piece", items: [], costs: [{ kind: "other", per: "batch", amountMinor: tk(100) }] };
    expect(costRecipe({ ...hundred, pricing: { mode: "markup", pct: 25 } }, []).suggestedMinor).toBe(tk(125));
    expect(costRecipe({ ...hundred, pricing: { mode: "margin", pct: 25 } }, []).suggestedMinor).toBe(13334);
    // never below the margin asked for: rounded up, not to the nearest
    const m = costRecipe({ ...hundred, pricing: { mode: "margin", pct: 25, roundToMinor: tk(10) } }, []);
    expect(m.suggestedMinor).toBe(tk(140));
    expect(((m.suggestedMinor! - tk(100)) / m.suggestedMinor!) * 100).toBeGreaterThanOrEqual(25);
  });

  it("an actual price gives the real profit, margin and markup", () => {
    const r = costRecipe(CUPCAKES, PANTRY);
    // ৳120 − ৳74.1667 = ৳45.83 a piece, ৳550 a batch; 45.83 / 120 = 38.2% margin; 45.83 / 74.17 = 61.8% markup
    expect(r.actual).toEqual({ priceMinor: tk(120), profitMinor: 4583, profitBatchMinor: tk(550), marginPct: 38.2, markupPct: 61.8 });
    // sold at a loss: the numbers go below zero, they are not hidden
    const loss = costRecipe({ ...CUPCAKES, pricing: { mode: "markup", pct: 0, actualMinor: tk(60) } }, PANTRY);
    expect(loss.actual!.profitMinor).toBe(-1417);
    expect(loss.actual!.marginPct).toBe(-23.6);
  });

  it("an ingredient measured another way than it is sold: by the cup through its density, by weight through an egg's weight", () => {
    const r = costRecipe(
      {
        id: "pancakes",
        name: "Pancakes",
        yieldQty: 8,
        yieldUnit: "piece",
        items: [
          { ingredientId: "flour", qty: 2, unit: "cup" }, // 254.4 g → ৳30.528
          { ingredientId: "egg", qty: 100, unit: "g" }, // 2 eggs → ৳25
          { ingredientId: "milk", qty: 0.5, unit: "l" }, // ৳50
          { ingredientId: "butter", qty: 2, unit: "tbsp" }, // no density for butter
        ],
        costs: [],
      },
      PANTRY,
    );
    expect(r.lines.map((l) => [l.costMinor, l.problem ?? null])).toEqual([
      [3053, null],
      [tk(25), null],
      [tk(50), null],
      [0, "unit_mismatch"],
    ]);
    expect(r.ingredientsMinor).toBe(3053 + tk(75));
    expect(r.complete).toBe(false); // the butter is missing from the total, and it says so
    expect(r.problems).toEqual([{ code: "unit_mismatch", line: 3 }]);
  });

  it("a line it cannot cost is reported, and the rest still is: no price, an unknown ingredient, a quantity that is not a number", () => {
    const r = costRecipe(
      {
        id: "r",
        name: "R",
        yieldQty: 4,
        yieldUnit: "piece",
        items: [
          { ingredientId: "vanilla", qty: 1, unit: "tsp" },
          { ingredientId: "nope", qty: 1, unit: "g" },
          { ingredientId: "flour", qty: 0, unit: "g" },
          { ingredientId: "flour", qty: Number.NaN, unit: "g" },
          { ingredientId: "sugar", qty: 100, unit: "g" },
        ],
        costs: [],
      },
      PANTRY,
    );
    expect(r.problems).toEqual([
      { code: "no_price", line: 0 },
      { code: "unknown_ingredient", line: 1 },
      { code: "bad_qty", line: 2 },
      { code: "bad_qty", line: 3 },
    ]);
    expect(r.ingredientsMinor).toBe(tk(14));
    expect(r.complete).toBe(false);
  });

  it("checks the yield, the costs and the percentages instead of trusting them", () => {
    const base: FcRecipe = { id: "b", name: "B", yieldQty: 0, yieldUnit: "piece", items: [{ ingredientId: "sugar", qty: 100, unit: "g" }], costs: [] };
    const noYield = costRecipe({ ...base, pricing: { mode: "markup", pct: 20 } }, PANTRY);
    expect(noYield.problems).toContainEqual({ code: "bad_yield" });
    expect([noYield.perUnitMinor, noYield.suggestedMinor, noYield.complete]).toEqual([null, null, false]);

    const ok = { ...base, yieldQty: 2 };
    const costs = costRecipe(
      {
        ...ok,
        costs: [
          { kind: "other", per: "batch", amountMinor: -5 },
          { kind: "other", per: "batch", amountMinor: 12.5 },
          { kind: "labour", per: "hour", amountMinor: 100, hours: -1 },
        ],
      },
      PANTRY,
    );
    expect(costs.problems).toEqual([
      { code: "bad_cost", cost: 0 },
      { code: "bad_cost", cost: 1 },
      { code: "bad_cost", cost: 2 },
    ]);
    expect(costs.complete).toBe(false);

    expect(costRecipe({ ...ok, pricing: { mode: "margin", pct: 100 } }, PANTRY).problems).toEqual([{ code: "bad_margin" }]);
    expect(costRecipe({ ...ok, pricing: { mode: "markup", pct: -10 } }, PANTRY).problems).toEqual([{ code: "bad_pct" }]);
    // a price that cannot be worked out leaves the cost whole
    const priceOnly = costRecipe({ ...ok, pricing: { mode: "margin", pct: 120, actualMinor: 99.5 } }, PANTRY);
    expect(priceOnly.problems).toEqual([{ code: "bad_margin" }, { code: "bad_price" }]);
    expect([priceOnly.suggestedMinor, priceOnly.actual, priceOnly.complete]).toEqual([null, null, true]);
  });

  it("a cost for each piece needs a yield in pieces; a cost by the hour is the rate times the hours", () => {
    const frosting: FcRecipe = {
      id: "f",
      name: "Frosting",
      yieldQty: 800,
      yieldUnit: "g",
      items: [{ ingredientId: "butter", qty: 250, unit: "g" }],
      costs: [
        { kind: "packaging", per: "piece", amountMinor: tk(5) },
        { kind: "energy", per: "hour", amountMinor: tk(30), hours: 0.25 },
      ],
    };
    const r = costRecipe(frosting, PANTRY);
    expect(r.problems).toEqual([{ code: "per_piece_needs_count", cost: 0 }]);
    expect(r.energyMinor).toBe(750);
    expect(r.batchMinor).toBe(tk(275) + 750);
    // by the gram, for a yield in grams
    expect(r.perUnitMinor).toBe(roundMinor((tk(275) + 750) / 800));
    // counted in dozens: each piece is still each piece
    const dozens = costRecipe({ ...CUPCAKES, yieldQty: 1, yieldUnit: "dozen" }, PANTRY);
    expect(dozens.packagingMinor).toBe(tk(120));
    expect(dozens.perUnitMinor).toBe(tk(890)); // one dozen
  });
});

describe("recipes inside recipes", () => {
  const BUTTERCREAM: FcRecipe = {
    id: "buttercream",
    name: "Buttercream",
    yieldQty: 800,
    yieldUnit: "g",
    items: [
      { ingredientId: "butter", qty: 250, unit: "g" }, // ৳275
      { ingredientId: "sugar", qty: 500, unit: "g" }, // ৳70
    ],
    costs: [{ kind: "labour", per: "hour", amountMinor: tk(100), hours: 0.5 }], // ৳50
  }; // ৳395 for 800 g

  it("shares out the other recipe's whole batch by how much of it is used — by weight, or by its own pieces", () => {
    const cake: FcRecipe = { ...CUPCAKES, id: "cake", items: [...CUPCAKES.items, { recipeId: "buttercream", qty: 200, unit: "g" }] };
    const r = costRecipe(cake, PANTRY, [BUTTERCREAM]);
    expect(r.lines.at(-1)).toMatchObject({ kind: "recipe", name: "Buttercream", costMinor: 9875 }); // ¼ of ৳395
    expect(r.ingredientsMinor).toBe(tk(490) + 9875);
    expect(r.complete).toBe(true);

    const macarons: FcRecipe = { id: "mac", name: "Macarons", yieldQty: 24, yieldUnit: "piece", outputG: 360, items: [{ ingredientId: "sugar", qty: 300, unit: "g" }], costs: [] }; // ৳42
    expect(costRecipe({ ...cake, items: [{ recipeId: "mac", qty: 6, unit: "piece" }] }, PANTRY, [macarons]).ingredientsMinor).toBe(tk(10.5));
    // a counted recipe used by weight, through its finished weight
    expect(costRecipe({ ...cake, items: [{ recipeId: "mac", qty: 90, unit: "g" }] }, PANTRY, [macarons]).ingredientsMinor).toBe(tk(10.5));
    // …and without one, it cannot be: a problem, not a guess
    const unweighed = costRecipe({ ...cake, items: [{ recipeId: "mac", qty: 90, unit: "g" }] }, PANTRY, [{ ...macarons, outputG: null }]);
    expect(unweighed.problems).toEqual([{ code: "unit_mismatch", line: 0 }]);
  });

  it("a recipe that ends up using itself is reported, never followed for ever; one with a problem passes it on", () => {
    const a: FcRecipe = { id: "a", name: "A", yieldQty: 1, yieldUnit: "kg", items: [{ recipeId: "b", qty: 100, unit: "g" }], costs: [] };
    const b: FcRecipe = { id: "b", name: "B", yieldQty: 1, yieldUnit: "kg", items: [{ recipeId: "a", qty: 100, unit: "g" }], costs: [] };
    const r = costRecipe(a, PANTRY, [b]);
    expect(r.complete).toBe(false);
    expect(r.problems).toEqual([{ code: "sub_recipe_problem", line: 0 }]);
    expect(costRecipe({ ...a, items: [{ recipeId: "a", qty: 1, unit: "g" }] }, PANTRY).problems).toEqual([{ code: "cycle", line: 0 }]);
    expect(costRecipe({ ...a, items: [{ recipeId: "zzz", qty: 1, unit: "g" }] }, PANTRY).problems).toEqual([{ code: "unknown_recipe", line: 0 }]);

    // the sub-recipe's own missing price: its known part is counted, and the line says so
    const vanillaCream: FcRecipe = { ...BUTTERCREAM, id: "vc", items: [...BUTTERCREAM.items, { ingredientId: "vanilla", qty: 1, unit: "tsp" }] };
    const withIt = costRecipe({ ...CUPCAKES, items: [{ recipeId: "vc", qty: 400, unit: "g" }] }, PANTRY, [vanillaCream]);
    expect(withIt.lines[0]).toMatchObject({ costMinor: tk(197.5), problem: "sub_recipe_problem" });
  });

  it("stops at six recipes deep", () => {
    const chain: FcRecipe[] = Array.from({ length: 8 }, (_, i) => ({
      id: `r${i}`,
      name: `R${i}`,
      yieldQty: 1,
      yieldUnit: "kg" as const,
      items: i < 7 ? [{ recipeId: `r${i + 1}`, qty: 500, unit: "g" as const }] : [{ ingredientId: "sugar", qty: 1, unit: "kg" as const }],
      costs: [],
    }));
    const r = costRecipe(chain[0], PANTRY, chain);
    expect(r.complete).toBe(false);
    expect(r.problems).toEqual([{ code: "sub_recipe_problem", line: 0 }]);
    // five deep is fine: ৳140 halved four times
    expect(costRecipe(chain[3], PANTRY, chain).ingredientsMinor).toBe(tk(140) / 16);
  });
});

describe("money and plans", () => {
  it("money is shown in taka and paisa, in Bangla or English digits, grouped the Bangladeshi way", () => {
    expect(fcMoney(7417, "en")).toBe("৳74.17");
    expect(fcMoney(7417, "bn")).toBe("৳৭৪.১৭");
    expect(fcMoney(tk(120), "en")).toBe("৳120");
    expect(fcMoney(tk(123456.05), "en")).toBe("৳1,23,456.05");
    expect(fcMoney(tk(123456.05), "bn")).toBe("৳১,২৩,৪৫৬.০৫");
    expect(fcMoney(-1417, "en")).toBe("-৳14.17");
    expect(fcMoney(250, "en", "USD")).toBe("$2.50");
    expect(fcMoney(99, "en", "GBP")).toBe("£0.99");
  });

  it("rounds half up, without the noise of floating point", () => {
    expect(roundMinor(12.5)).toBe(13);
    expect(roundMinor(12.4999999999)).toBe(13);
    expect(roundMinor(0.1 * 3 * 100)).toBe(30);
    expect(roundMinor(12.49)).toBe(12);
  });

  it("a free workspace keeps 3 recipes, a MAWAH student or a Pro one any number", () => {
    expect(fcRecipeLimit("free", false)).toBe(3);
    expect(fcRecipeLimit("free", true)).toBeNull();
    expect(fcRecipeLimit("pro", false)).toBeNull();
  });
});
