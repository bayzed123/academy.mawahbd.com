import { describe, expect, it } from "vitest";
import { costRecipe, fcCostWith, fcIngredient, fcRecipe, type FcIngredientDTO, type FcRecipeDTO } from "@mawah/shared/foodcost";
import { Client, env, json, loginStaff, registerStudent } from "./helpers";

/*
 * FoodCost Pro's API (/api/fc/v1) and Admin → FoodCost. What must never go wrong: a workspace is its owner's alone (another student's
 * recipes, ingredients and prices are "not found"); one's own price replaces staff's default for oneself only; a saved recipe is costed by
 * the same engine the screens run; Free keeps 3 recipes and the limit holds, a MAWAH student (a website class) and Pro have none — a free
 * app class unlocks nothing; a recipe cannot use itself, nor something that is not the workspace's; deleting the account deletes it all.
 */

const tk = (taka: number) => Math.round(taka * 100);
const roundHalf = (minor: number, n: number) => Math.round(minor / n);

async function student() {
  const s = await registerStudent();
  const id = s.body.student.id as number;
  return { client: s.client, id };
}
const fc = (path: string) => `/api/fc/v1${path}`;
const del = (c: Client, path: string) => c.fetch(path, { method: "DELETE" });

/** A shared ingredient with a default price, as staff add it in Admin → FoodCost. */
async function shared(admin: Client, name: string, price: { pack_qty: number; pack_unit: string; price_minor: number } | null, more: Record<string, unknown> = {}) {
  const res = await admin.post("/api/admin/fc/ingredients", { name_en: name, name_bn: `${name} (বাংলা)`, category: "Baking", ...more, price });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await json(res)).item as { id: number; default_price: { price_minor: number } | null };
}

const cupcakes = (flour: number, egg: number) => ({
  name: "Vanilla cupcakes",
  yield_qty: 12,
  yield_unit: "piece",
  yield_label: "cupcake",
  items: [
    { ingredient_id: flour, qty: 500, unit: "g" },
    { ingredient_id: egg, qty: 6, unit: "piece" },
  ],
  costs: [
    { kind: "packaging", label: "Box", per: "piece", amount_minor: tk(10) },
    { kind: "labour", per: "hour", amount_minor: tk(100), hours: 2 },
  ],
  pricing: { mode: "margin", pct: 40, round_to_minor: tk(5), actual_minor: tk(60) },
});

describe("a workspace of one's own", () => {
  it("is made the first time FoodCost is opened, on the Free plan, and needs a student login", async () => {
    expect((await new Client().get(fc("/me"))).status).toBe(401);
    const { client, id } = await student();
    expect((await json(await client.get(fc("/me")))).me).toEqual({ plan: "free", plan_until: null, student: false, limit: 3, used: 0, currency: "BDT" });
    // once, however often it is opened
    await client.get(fc("/me"));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM fc_workspaces WHERE student_id = ?").bind(id).first<{ n: number }>())!.n).toBe(1);
  });
});

describe("ingredients and prices", () => {
  it("staff's default price counts until one sets one's own — for oneself only — and going back to the default is one tap", async () => {
    const admin = (await loginStaff()).client;
    const flour = await shared(admin, `Flour ${Date.now()}`, { pack_qty: 1, pack_unit: "kg", price_minor: tk(120) }, { g_per_ml: 0.53 });
    const a = await student();
    const b = await student();
    const find = async (c: Client) => ((await json(await c.get(fc("/ingredients")))).ingredients as FcIngredientDTO[]).find((i) => i.id === flour.id)!;

    expect(await find(a.client)).toMatchObject({ own: false, active: true, g_per_ml: 0.53, price_source: "default", price: { pack_qty: 1, pack_unit: "kg", price_minor: tk(120) } });
    const set = await a.client.put(fc(`/prices/${flour.id}`), { pack_qty: 2, pack_unit: "kg", price_minor: tk(220), supplier: "Karwan Bazar", bought_on: "2026-11-05" });
    expect(set.status, await set.clone().text()).toBe(200);
    expect((await json(set)).ingredient).toMatchObject({ price_source: "mine", price: { pack_qty: 2, price_minor: tk(220), supplier: "Karwan Bazar", bought_on: "2026-11-05" }, default_price: { price_minor: tk(120) } });
    // someone else still has staff's default
    expect((await find(b.client)).price_source).toBe("default");
    // every change is kept
    await a.client.put(fc(`/prices/${flour.id}`), { pack_qty: 1, pack_unit: "kg", price_minor: tk(115) });
    const history = await json(await a.client.get(fc(`/prices/${flour.id}`)));
    expect(history.history.map((p: { price_minor: number }) => p.price_minor)).toEqual([tk(115), tk(220)]);
    expect(history.default_price.price_minor).toBe(tk(120));
    // back to the default
    expect((await json(await del(a.client, fc(`/prices/${flour.id}`)))).ingredient).toMatchObject({ price_source: "default", price: { price_minor: tk(120) } });
    // a price is checked: a unit that does not exist, nothing for a pack, paisa that are not whole
    for (const bad of [{ pack_qty: 1, pack_unit: "bucket", price_minor: 100 }, { pack_qty: 0, pack_unit: "kg", price_minor: 100 }, { pack_qty: 1, pack_unit: "kg", price_minor: 12.5 }]) {
      expect((await a.client.put(fc(`/prices/${flour.id}`), bad)).status, JSON.stringify(bad)).toBe(422);
    }
  });

  it("one's own price history keeps the newest 50 changes, and staff's default history is not touched", async () => {
    const admin = (await loginStaff()).client;
    const flour = await shared(admin, `Flour ${Date.now()}`, { pack_qty: 1, pack_unit: "kg", price_minor: tk(120) });
    const a = await student();
    await a.client.put(fc(`/prices/${flour.id}`), { pack_qty: 1, pack_unit: "kg", price_minor: tk(100) });
    const ws = (await env.DB.prepare("SELECT id FROM fc_workspaces WHERE student_id = ?").bind(a.id).first<{ id: number }>())!.id;
    const count = async (workspace: number | null) =>
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM fc_prices WHERE ingredient_id = ? AND workspace_id IS ?").bind(flour.id, workspace).first<{ n: number }>())!.n;
    // 60 older changes, then one more
    await env.DB.batch(
      Array.from({ length: 60 }, (_, i) => env.DB.prepare("INSERT INTO fc_prices (ingredient_id, workspace_id, pack_qty, pack_unit, price_minor) VALUES (?, ?, 1, 'kg', ?)").bind(flour.id, ws, tk(50 + i))),
    );
    const last = await a.client.put(fc(`/prices/${flour.id}`), { pack_qty: 1, pack_unit: "kg", price_minor: tk(130) });
    expect((await json(last)).ingredient).toMatchObject({ price_source: "mine", price: { price_minor: tk(130) } });
    expect(await count(ws)).toBe(50);
    expect(await count(null)).toBe(1);
  });

  it("one's own ingredients are one's own: added with a price, changed, deleted when unused — and the shared ones are staff's", async () => {
    const admin = (await loginStaff()).client;
    const flour = await shared(admin, `Flour ${Date.now()}`, { pack_qty: 1, pack_unit: "kg", price_minor: tk(120) });
    const a = await student();
    const b = await student();
    const add = await a.client.post(fc("/ingredients"), { name_en: "Home-made ghee", category: "Fat", g_per_ml: 0.91, price: { pack_qty: 1, pack_unit: "l", price_minor: tk(1500) } });
    expect(add.status, await add.clone().text()).toBe(201);
    const ghee = (await json(add)).ingredient as FcIngredientDTO;
    expect(ghee).toMatchObject({ own: true, name_en: "Home-made ghee", price_source: "mine", price: { pack_unit: "l", price_minor: tk(1500) } });
    expect((await a.client.post(fc("/ingredients"), { category: "Fat" })).status).toBe(422); // a name in one language at least
    // nobody else sees it, or can change it
    expect(((await json(await b.client.get(fc("/ingredients")))).ingredients as FcIngredientDTO[]).some((i) => i.id === ghee.id)).toBe(false);
    expect((await b.client.put(fc(`/ingredients/${ghee.id}`), { name_en: "Mine now" })).status).toBe(404);
    expect((await b.client.put(fc(`/prices/${ghee.id}`), { pack_qty: 1, pack_unit: "l", price_minor: 1 })).status).toBe(404);
    // staff's ingredients cannot be changed or deleted from here
    expect((await a.client.put(fc(`/ingredients/${flour.id}`), { name_en: "Mine" })).status).toBe(403);
    expect((await del(a.client, fc(`/ingredients/${flour.id}`))).status).toBe(403);
    expect((await a.client.put(fc(`/ingredients/${ghee.id}`), { name_en: "Ghee", g_per_ml: 0.92 })).status).toBe(200);
    // used by a recipe: not deleted; unused again: deleted
    const r = await json(await a.client.post(fc("/recipes"), { name: "Laddu", yield_qty: 10, yield_unit: "piece", items: [{ ingredient_id: ghee.id, qty: 100, unit: "ml" }] }));
    expect((await del(a.client, fc(`/ingredients/${ghee.id}`))).status).toBe(409);
    await del(a.client, fc(`/recipes/${r.recipe.id}`));
    expect((await del(a.client, fc(`/ingredients/${ghee.id}`))).status).toBe(200);
  });
});

describe("recipes", () => {
  it("are costed by the same engine the screens run, kept with their lines, and are their owner's alone", async () => {
    const admin = (await loginStaff()).client;
    const flour = await shared(admin, `Flour ${Date.now()}`, { pack_qty: 1, pack_unit: "kg", price_minor: tk(120) });
    const a = await student();
    const egg = (await json(await a.client.post(fc("/ingredients"), { name_en: "Egg", g_per_piece: 50, price: { pack_qty: 1, pack_unit: "dozen", price_minor: tk(150) } }))).ingredient;

    const made = await a.client.post(fc("/recipes"), cupcakes(flour.id, egg.id));
    expect(made.status, await made.clone().text()).toBe(201);
    const { recipe, result } = (await json(made)) as { recipe: FcRecipeDTO; result: ReturnType<typeof costRecipe> };
    // ৳60 of flour + ৳75 of eggs + ৳120 of boxes + ৳200 of labour = ৳455 → ৳37.92 a cupcake; a 40% margin is ৳63.19, up to ৳65
    expect(result).toMatchObject({ ingredientsMinor: tk(135), packagingMinor: tk(120), labourMinor: tk(200), batchMinor: tk(455), perUnitMinor: 3792, suggestedMinor: tk(65), complete: true });
    expect(result.actual).toMatchObject({ priceMinor: tk(60), profitMinor: 2208, profitBatchMinor: tk(265) });
    // exactly what the website and the app work out from the same data
    const ingredients = ((await json(await a.client.get(fc("/ingredients")))).ingredients as FcIngredientDTO[]).map((i) => fcIngredient(i, "en"));
    expect(costRecipe(fcRecipe(recipe), ingredients)).toEqual(result);
    expect(recipe).toMatchObject({ name: "Vanilla cupcakes", yield_label: "cupcake", items: [{ ingredient_id: flour.id, qty: 500, unit: "g", recipe_id: null }, { ingredient_id: egg.id, qty: 6, unit: "piece" }] });

    // the list shows each recipe's cost and price
    const list = await json(await a.client.get(fc("/recipes")));
    expect(list.recipes).toEqual([expect.objectContaining({ id: recipe.id, per_unit_minor: 3792, suggested_minor: tk(65), complete: true, used_by: 0 })]);
    expect(list.me).toMatchObject({ used: 1, limit: 3 });

    // changed: the lines are replaced, the costing follows
    const changed = await json(await a.client.put(fc(`/recipes/${recipe.id}`), { ...cupcakes(flour.id, egg.id), yield_qty: 24 }));
    expect(changed.result.perUnitMinor).toBe(roundHalf(tk(455) + tk(120), 24)); // the boxes are for 24 now
    expect(changed.recipe.items).toHaveLength(2);

    // another student: not found, whatever they try
    const b = await student();
    for (const [method, path] of [["GET", `/recipes/${recipe.id}`], ["PUT", `/recipes/${recipe.id}`], ["DELETE", `/recipes/${recipe.id}`], ["POST", `/recipes/${recipe.id}/duplicate`]] as const) {
      const res = await b.client.fetch(fc(path), { method, ...(method === "PUT" ? { json: cupcakes(flour.id, flour.id) } : {}) });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // nor can they use A's own ingredient or A's recipe in theirs
    const theft = await b.client.post(fc("/recipes"), { name: "Copy", yield_qty: 1, yield_unit: "piece", items: [{ ingredient_id: egg.id, qty: 1, unit: "piece" }] });
    expect((await json(theft)).error.fields).toEqual({ "items.0": "not_found" });
    const theft2 = await b.client.post(fc("/recipes"), { name: "Copy", yield_qty: 1, yield_unit: "piece", items: [{ recipe_id: recipe.id, qty: 1, unit: "piece" }] });
    expect((await json(theft2)).error.fields).toEqual({ "items.0": "not_found" });
  });

  it("the book holds what the screens cost with while one types — the plan, every ingredient, one's own recipes in full — and costs as the server does", async () => {
    const admin = (await loginStaff()).client;
    const flour = await shared(admin, `Flour ${Date.now()}`, { pack_qty: 1, pack_unit: "kg", price_minor: tk(120) });
    const a = await student();
    const b = await student();
    const roti = await json(await a.client.post(fc("/recipes"), { name: "Roti", yield_qty: 10, yield_unit: "piece", items: [{ ingredient_id: flour.id, qty: 500, unit: "g" }] }));
    await b.client.post(fc("/recipes"), { name: "Not yours", yield_qty: 1, yield_unit: "piece", items: [] });
    const book = await json(await a.client.get(fc("/book")));
    expect(book.me).toMatchObject({ plan: "free", used: 1, limit: 3 });
    expect(book.recipes).toEqual([expect.objectContaining({ id: roti.recipe.id, name: "Roti", items: [expect.objectContaining({ ingredient_id: flour.id, qty: 500, unit: "g" })] })]);
    expect((book.ingredients as FcIngredientDTO[]).find((i) => i.id === flour.id)).toMatchObject({ price_source: "default", price: { price_minor: tk(120) } });
    // what a screen works out from the book is exactly what the server says
    expect(fcCostWith(roti.recipe, book)).toEqual(roti.result);
    expect((await new Client().get(fc("/book"))).status).toBe(401);
  });

  it("checks what is typed: a name, a yield, one thing per line, the costs and a margin under 100%", async () => {
    const a = await student();
    const base = { name: "X", yield_qty: 1, yield_unit: "piece", items: [] };
    const fields = async (body: unknown) => (await json(await a.client.post(fc("/recipes"), body))).error?.fields;
    expect(await fields({ ...base, name: "" })).toMatchObject({ name: "required" });
    expect(await fields({ ...base, yield_qty: 0 })).toMatchObject({ yield_qty: "required" });
    expect(await fields({ ...base, yield_unit: "bowl" })).toMatchObject({ yield_unit: "invalid_unit" });
    expect(await fields({ ...base, items: [{ qty: 1, unit: "g" }] })).toMatchObject({ "items.0.ingredient_id": "required" });
    expect(await fields({ ...base, items: [{ ingredient_id: 1, recipe_id: 1, qty: 1, unit: "g" }] })).toMatchObject({ "items.0.ingredient_id": "required" });
    expect(await fields({ ...base, costs: [{ kind: "labour", per: "hour", amount_minor: 100 }] })).toMatchObject({ "costs.0.hours": "required" });
    expect(await fields({ ...base, pricing: { mode: "margin", pct: 100 } })).toMatchObject({ "pricing.pct": "bad_margin" });
    expect((await a.client.post(fc("/recipes"), base)).status).toBe(201);
  });

  it("a recipe may use another one — never itself, through any chain — and one in use is not deleted", async () => {
    const admin = (await loginStaff()).client;
    const butter = await shared(admin, `Butter ${Date.now()}`, { pack_qty: 500, pack_unit: "g", price_minor: tk(550) });
    const a = await student();
    const cream = await json(await a.client.post(fc("/recipes"), { name: "Buttercream", yield_qty: 800, yield_unit: "g", items: [{ ingredient_id: butter.id, qty: 400, unit: "g" }] })); // ৳440
    const cake = await json(await a.client.post(fc("/recipes"), { name: "Cake", yield_qty: 8, yield_unit: "piece", items: [{ recipe_id: cream.recipe.id, qty: 200, unit: "g" }] }));
    expect(cake.result.ingredientsMinor).toBe(tk(110)); // a quarter of the buttercream
    // the buttercream made to use the cake: a recipe using itself, refused
    const loop = await a.client.put(fc(`/recipes/${cream.recipe.id}`), { name: "Buttercream", yield_qty: 800, yield_unit: "g", items: [{ recipe_id: cake.recipe.id, qty: 1, unit: "piece" }] });
    expect(loop.status).toBe(422);
    expect((await json(loop)).error.fields).toEqual({ items: "fc_cycle" });
    const self = await a.client.put(fc(`/recipes/${cream.recipe.id}`), { name: "Buttercream", yield_qty: 800, yield_unit: "g", items: [{ recipe_id: cream.recipe.id, qty: 1, unit: "g" }] });
    expect((await json(self)).error.fields).toEqual({ items: "fc_cycle" });
    // in use: not deleted, and it says by which
    const refused = await del(a.client, fc(`/recipes/${cream.recipe.id}`));
    expect(refused.status).toBe(409);
    expect((await json(refused)).error.fields).toEqual({ used_by: "Cake" });
    expect((await json(await a.client.get(fc("/recipes")))).recipes.find((r: { id: number }) => r.id === cream.recipe.id).used_by).toBe(1);
    // the cake gone, the buttercream can go
    expect((await del(a.client, fc(`/recipes/${cake.recipe.id}`))).status).toBe(200);
    expect((await del(a.client, fc(`/recipes/${cream.recipe.id}`))).status).toBe(200);
  });
});

describe("plans and limits", () => {
  const recipe = (n: number) => ({ name: `Recipe ${n}`, yield_qty: 1, yield_unit: "piece", items: [] });

  it("Free keeps 3 recipes: a fourth or a copy is refused, deleting one makes room", async () => {
    const a = await student();
    const ids: number[] = [];
    for (let n = 1; n <= 3; n++) ids.push((await json(await a.client.post(fc("/recipes"), recipe(n)))).recipe.id);
    const fourth = await a.client.post(fc("/recipes"), recipe(4));
    expect(fourth.status).toBe(403);
    expect((await json(fourth)).error.code).toBe("fc_limit");
    expect((await a.client.post(fc(`/recipes/${ids[0]}/duplicate`))).status).toBe(403);
    // two at the same moment cannot both slip past the limit
    await del(a.client, fc(`/recipes/${ids[0]}`));
    const both = await Promise.all([a.client.post(fc("/recipes"), recipe(5)), a.client.post(fc("/recipes"), recipe(6))]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 403]);
    expect((await json(await a.client.get(fc("/me")))).me).toMatchObject({ used: 3, limit: 3 });
    // a copy is a recipe like any other
    await del(a.client, fc(`/recipes/${ids[1]}`));
    const copy = await a.client.post(fc(`/recipes/${ids[2]}/duplicate`));
    expect(copy.status).toBe(201);
    expect((await json(copy)).recipe.name).toBe("Recipe 3 (copy)");
  });

  it("no limit (Pro, a MAWAH student) still stops at 2,000 recipes, told it has too many and never the Free limit", async () => {
    const a = await student();
    await a.client.get(fc("/me"));
    const ws = (await env.DB.prepare("SELECT id FROM fc_workspaces WHERE student_id = ?").bind(a.id).first<{ id: number }>())!.id;
    await env.DB.prepare("UPDATE fc_workspaces SET plan = 'pro', plan_source = 'admin' WHERE id = ?").bind(ws).run();
    await env.DB.prepare(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000) INSERT INTO fc_recipes (workspace_id, name, yield_qty, yield_unit) SELECT ?, 'Recipe ' || i, 1, 'piece' FROM n",
    )
      .bind(ws)
      .run();
    const over = await a.client.post(fc("/recipes"), recipe(2001));
    expect(over.status).toBe(409);
    expect((await json(over)).error.code).toBe("fc_too_many");
    expect((await json(await a.client.get(fc("/me")))).me).toMatchObject({ plan: "pro", limit: null, used: 2000 });
  });

  it("a MAWAH student (a class of the website) has no limit; a free class of the Android app unlocks nothing", async () => {
    const a = await student();
    const websiteClass = await env.DB.prepare("SELECT id FROM courses WHERE channel = 'website' ORDER BY id LIMIT 1").first<{ id: number }>();
    // an app class, joined free: still Free
    await env.DB.prepare("UPDATE courses SET channel = 'app' WHERE id = (SELECT MAX(id) FROM courses)").run();
    const freeClass = await env.DB.prepare("SELECT MAX(id) AS id FROM courses").first<{ id: number }>();
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'free')").bind(a.id, freeClass!.id).run();
    expect((await json(await a.client.get(fc("/me")))).me).toMatchObject({ student: false, limit: 3 });
    // a class bought on the website: no limit
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'purchase')").bind(a.id, websiteClass!.id).run();
    expect((await json(await a.client.get(fc("/me")))).me).toMatchObject({ student: true, limit: null });
    for (let n = 1; n <= 4; n++) expect((await a.client.post(fc("/recipes"), recipe(n))).status).toBe(201);
    // the class taken back: Free again (the recipes stay; new ones wait for room)
    await env.DB.prepare("UPDATE enrollments SET status = 'revoked' WHERE student_id = ? AND course_id = ?").bind(a.id, websiteClass!.id).run();
    expect((await json(await a.client.get(fc("/me")))).me).toMatchObject({ student: false, limit: 3, used: 4 });
    expect((await a.client.post(fc("/recipes"), recipe(5))).status).toBe(403);
    await env.DB.prepare("UPDATE courses SET channel = 'website' WHERE id = ?").bind(freeClass!.id).run();
  });

  it("the owner can give a workspace Pro, for good or until a day; nobody else can; a Pro that ran out is Free again", async () => {
    const a = await student();
    await a.client.get(fc("/me"));
    const wsId = (await env.DB.prepare("SELECT id FROM fc_workspaces WHERE student_id = ?").bind(a.id).first<{ id: number }>())!.id;
    const cm = (await loginStaff("content_manager")).client;
    expect((await cm.put(`/api/admin/fc/workspaces/${wsId}/plan`, { plan: "pro" })).status).toBe(403);
    const owner = (await loginStaff()).client;
    expect((await owner.put(`/api/admin/fc/workspaces/${wsId}/plan`, { plan: "pro", until: "2020-01-01" })).status).toBe(422);
    expect((await owner.put(`/api/admin/fc/workspaces/${wsId}/plan`, { plan: "pro", until: "2099-12-31" })).status).toBe(200);
    expect((await json(await a.client.get(fc("/me")))).me).toMatchObject({ plan: "pro", plan_until: "2099-12-31T23:59:59Z", limit: null });
    // the list shows who has it — never their recipes
    const list = (await json(await owner.get("/api/admin/fc/workspaces"))).items as { id: number; plan_now: string; code: string; recipes: number }[];
    expect(list.find((w) => w.id === wsId)).toMatchObject({ plan_now: "pro", code: `STU-${String(a.id).padStart(6, "0")}`, recipes: 0 });
    // run out
    await env.DB.prepare("UPDATE fc_workspaces SET plan_until = '2020-01-01T00:00:00Z' WHERE id = ?").bind(wsId).run();
    expect((await json(await a.client.get(fc("/me")))).me).toMatchObject({ plan: "free", plan_until: null, limit: 3 });
    expect((await owner.put(`/api/admin/fc/workspaces/${wsId}/plan`, { plan: "free" })).status).toBe(200);
  });
});

describe("Admin → FoodCost", () => {
  it("keeps the shared list: default prices with their history, switched off (never deleted), a pasted list added or updated", async () => {
    const cm = (await loginStaff("content_manager")).client;
    const stamp = Date.now();
    const sugar = await shared(cm, `Sugar ${stamp}`, { pack_qty: 1, pack_unit: "kg", price_minor: tk(140) });
    expect(sugar.default_price!.price_minor).toBe(tk(140));
    await cm.post(`/api/admin/fc/ingredients/${sugar.id}/price`, { pack_qty: 1, pack_unit: "kg", price_minor: tk(135), supplier: "Dhaka average" });
    const history = await json(await cm.get(`/api/admin/fc/ingredients/${sugar.id}/prices`));
    expect(history.history.map((p: { price_minor: number }) => p.price_minor)).toEqual([tk(135), tk(140)]);
    // a recipe uses it; switched off, it still costs that recipe, and is no longer offered
    const a = await student();
    const r = await json(await a.client.post(fc("/recipes"), { name: "Syrup", yield_qty: 1, yield_unit: "l", items: [{ ingredient_id: sugar.id, qty: 500, unit: "g" }] }));
    const off = await cm.put(`/api/admin/fc/ingredients/${sugar.id}`, { name_en: `Sugar ${stamp}`, active: false });
    expect((await json(off)).item).toMatchObject({ active: false, used_in: 1 });
    expect((await json(await a.client.get(fc(`/recipes/${r.recipe.id}`)))).result.ingredientsMinor).toBe(tk(67.5));
    expect(((await json(await a.client.get(fc("/ingredients")))).ingredients as FcIngredientDTO[]).find((i) => i.id === sugar.id)!.active).toBe(false);

    // a pasted list: one new, one known (updated, not doubled), one with a price, one with no name
    const rows = [
      { name_en: `Cocoa ${stamp}`, name_bn: `কোকো ${stamp}`, category: "Baking", price: { pack_qty: 250, pack_unit: "g", price_minor: tk(450) } },
      { name_en: `sugar ${stamp}`, g_per_ml: 0.85 },
      { category: "Nameless" },
    ];
    const res = await cm.post("/api/admin/fc/ingredients/import", { rows });
    expect(await json(res)).toMatchObject({ added: 1, updated: 1, priced: 1, errors: [{ row: 2, code: "required" }] });
    const items = (await json(await cm.get("/api/admin/fc/ingredients"))).items as { id: number; name_en: string; g_per_ml: number | null; default_price: { price_minor: number } | null }[];
    expect(items.filter((i) => i.name_en.toLowerCase() === `sugar ${stamp}`)).toEqual([expect.objectContaining({ g_per_ml: 0.85 })]);
    const cocoa = items.find((i) => i.name_en === `Cocoa ${stamp}`)!;
    expect(cocoa.default_price!.price_minor).toBe(tk(450));
    // the same list again: nothing doubled, and a price that did not change is not saved again
    expect(await json(await cm.post("/api/admin/fc/ingredients/import", { rows }))).toMatchObject({ added: 0, updated: 2, priced: 0 });
    expect((await json(await cm.get(`/api/admin/fc/ingredients/${cocoa.id}/prices`))).history).toHaveLength(1);

    // a Viewer reads, never writes; Support does not keep the list
    const viewer = (await loginStaff("viewer")).client;
    expect((await viewer.get("/api/admin/fc/ingredients")).status).toBe(200);
    expect((await viewer.post("/api/admin/fc/ingredients", { name_en: "No" })).status).toBe(403);
    expect((await (await loginStaff("support")).client.post("/api/admin/fc/ingredients", { name_en: "No" })).status).toBe(403);
  });

  it("a name twice in one pasted list is one ingredient, filled in by the later rows; a list longer than 200 rows is refused", async () => {
    const cm = (await loginStaff("content_manager")).client;
    const stamp = Date.now();
    const res = await cm.post("/api/admin/fc/ingredients/import", {
      rows: [
        { name_en: `Butter ${stamp}`, name_bn: `মাখন ${stamp}`, price: { pack_qty: 200, pack_unit: "g", price_minor: tk(260) } },
        { name_bn: `মাখন ${stamp}`, g_per_ml: 0.91 }, // the same butter, by its Bangla name only
        { name_en: `butter ${stamp}`, category: "Dairy", price: { pack_qty: 200, pack_unit: "g", price_minor: tk(250) } }, // and by its English name
      ],
    });
    expect(await json(res)).toMatchObject({ added: 1, updated: 2, priced: 2, errors: [] });
    const items = (await json(await cm.get("/api/admin/fc/ingredients"))).items as { id: number; name_bn: string; g_per_ml: number | null; category: string; default_price: { price_minor: number } | null }[];
    const butter = items.filter((i) => i.name_bn === `মাখন ${stamp}`);
    expect(butter).toEqual([expect.objectContaining({ g_per_ml: 0.91, category: "Dairy", default_price: expect.objectContaining({ price_minor: tk(250) }) })]);
    // both prices are in its history, the newest first
    const history = await json(await cm.get(`/api/admin/fc/ingredients/${butter[0].id}/prices`));
    expect(history.history.map((p: { price_minor: number }) => p.price_minor)).toEqual([tk(250), tk(260)]);

    const long = await cm.post("/api/admin/fc/ingredients/import", { rows: Array.from({ length: 201 }, (_, i) => ({ name_en: `Too many ${stamp} ${i}` })) });
    expect(long.status).toBe(422);
    expect((await json(long)).error.fields).toMatchObject({ rows: "too_many" });
  });
});

describe("deleting the account", () => {
  it("deletes the FoodCost workspace and everything in it", async () => {
    const admin = (await loginStaff()).client;
    const flour = await shared(admin, `Flour ${Date.now()}`, { pack_qty: 1, pack_unit: "kg", price_minor: tk(120) });
    const s = await registerStudent(new Client(), { password: "a-long-password-1" });
    const id = s.body.student.id as number;
    const own = (await json(await s.client.post(fc("/ingredients"), { name_en: "Mine", price: { pack_qty: 1, pack_unit: "kg", price_minor: 100 } }))).ingredient;
    await s.client.put(fc(`/prices/${flour.id}`), { pack_qty: 1, pack_unit: "kg", price_minor: tk(99) });
    await s.client.post(fc("/recipes"), { name: "R", yield_qty: 1, yield_unit: "piece", items: [{ ingredient_id: own.id, qty: 1, unit: "g" }, { ingredient_id: flour.id, qty: 1, unit: "g" }] });
    const wsId = (await env.DB.prepare("SELECT id FROM fc_workspaces WHERE student_id = ?").bind(id).first<{ id: number }>())!.id;

    expect((await s.client.post("/api/auth/delete-account", { confirm: true, password: "a-long-password-1" })).status).toBe(200);
    const left = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM fc_workspaces WHERE id = ?1) + (SELECT COUNT(*) FROM fc_recipes WHERE workspace_id = ?1) + (SELECT COUNT(*) FROM fc_ingredients WHERE workspace_id = ?1)
            + (SELECT COUNT(*) FROM fc_prices WHERE workspace_id = ?1) + (SELECT COUNT(*) FROM fc_recipe_items i WHERE NOT EXISTS (SELECT 1 FROM fc_recipes r WHERE r.id = i.recipe_id)) AS n`,
    )
      .bind(wsId)
      .first<{ n: number }>();
    expect(left!.n).toBe(0);
    // staff's shared ingredient and its default price are untouched
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM fc_prices WHERE ingredient_id = ? AND workspace_id IS NULL").bind(flour.id).first<{ n: number }>())!.n).toBe(1);
  });
});

