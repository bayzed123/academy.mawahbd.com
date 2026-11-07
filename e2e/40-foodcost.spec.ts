import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiPost, registerStudent, useLang } from "./helpers";

/*
 * FoodCost for students (docs/foodcost.md): a recipe costed while one types, by the same engine the server runs; saved and read back with
 * the server's own numbers; what cannot be costed said in words; Free keeps 3 recipes (said plainly, never anything about buying); one's
 * own price replacing the Dhaka average for oneself; in Bangla on a phone. Runs after the admin spec (the owner exists).
 */
const STAMP = Date.now().toString(36);
const FLOUR = `Flour ${STAMP}`;
const EGG = `Egg ${STAMP}`;
const VANILLA = `Vanilla ${STAMP}`;

const serious = async (page: Page) => (await new AxeBuilder({ page }).include("main").analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");

// the owner's Dhaka averages: flour ৳120 a kg, eggs ৳150 a dozen; vanilla has no price yet. Made once per worker (a worker restarted after a
// failure loads this file again, with a new stamp, and makes its own)
test.beforeAll(async ({ browser }) => {
  const staff = await browser.newContext({ locale: "en-US" });
  const admin = await staff.newPage();
  await adminLogin(admin);
  await admin.goto("/admin/");
  for (const body of [
    { name_en: FLOUR, name_bn: `ময়দা ${STAMP}`, category: "Flour", g_per_ml: 0.53, price: { pack_qty: 1, pack_unit: "kg", price_minor: 12000 } },
    { name_en: EGG, name_bn: `ডিম ${STAMP}`, category: "Dairy & eggs", g_per_piece: 50, price: { pack_qty: 1, pack_unit: "dozen", price_minor: 15000 } },
    { name_en: VANILLA, name_bn: `ভ্যানিলা ${STAMP}`, category: "Flavour" },
  ])
    expect((await apiPost(admin, "/admin/fc/ingredients", body)).status).toBe(201);
  await staff.close();
});

test("a student costs cupcakes while typing, saves them, and the list shows the server's own numbers; Free keeps 3", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);

  await page.goto("/app/foodcost");
  await expect(page.getByRole("heading", { level: 1, name: "FoodCost" })).toBeVisible();
  await expect(page.getByText("Free: 0 of 3 recipes saved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No recipes yet" })).toBeVisible();
  expect(await serious(page)).toEqual([]);

  await page.getByRole("link", { name: "New recipe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New recipe" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(`Cupcakes ${STAMP}`);
  await page.getByLabel("How many").fill("12");
  await page.getByLabel("Called").fill("cupcake");
  // flour by the gram (its price is per kg), eggs by the piece (their price is per dozen): the unit follows what is chosen
  await page.getByLabel("Line 1", { exact: true }).selectOption({ label: FLOUR });
  await expect(page.locator("#fc-u0")).toHaveValue("g");
  await page.locator("#fc-q0").fill("500");
  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Line 2", { exact: true }).selectOption({ label: EGG });
  await expect(page.locator("#fc-u1")).toHaveValue("piece");
  await page.locator("#fc-q1").fill("6");
  const result = page.locator(".fc-result");
  await expect(result).toContainText("৳135"); // ingredients: ৳60 + ৳75
  // a box for each cupcake, two hours at ৳100
  await page.getByRole("button", { name: "Packaging" }).click();
  await page.locator("#fc-ca0").fill("10");
  await page.getByRole("button", { name: "Labour" }).click();
  await page.locator("#fc-ca1").fill("100");
  await page.locator("#fc-ch1").fill("2");
  await expect(result.getByRole("definition").first()).toHaveText("৳455");
  await expect(result).toContainText("৳37.92 / cupcake");
  // a 40% margin rounded up to ৳5, and a real price of ৳60
  await page.getByLabel(/^Margin/).check();
  await page.getByLabel("Profit (%)").fill("40");
  await page.getByLabel("Round the price up to").selectOption({ label: "৳5" });
  await page.getByLabel(/^Your price for each cupcake/).fill("60");
  await expect(result).toContainText("৳65 / cupcake");
  await expect(result).toContainText("৳22.08"); // profit on each
  await expect(result).toContainText("৳265"); // on the batch
  await expect(result).toContainText("36.8%");
  expect(await serious(page)).toEqual([]);

  await page.getByRole("button", { name: "Save the recipe" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/foodcost\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: `Cupcakes ${STAMP}` })).toBeVisible();

  // Download PDF: the browser's print window (stood in for here) prints a copy of the result made for paper, which only printing shows
  await page.evaluate(() => {
    const w = window as unknown as { printed: number };
    w.printed = 0;
    window.print = () => void w.printed++;
  });
  await page.getByRole("button", { name: "Download PDF" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await expect(page.getByText("The print window opens: choose “Save as PDF” there.", { exact: false })).toBeVisible();
  const paper = page.locator(".fcr");
  await expect(paper).toBeHidden(); // on the screen, the page stays as it was
  expect(await page.title()).toBe(`FoodCost — Cupcakes ${STAMP}`); // the name the browser offers for the file
  await page.emulateMedia({ media: "print" });
  await expect(paper).toBeVisible();
  await expect(page.locator("#root")).toBeHidden(); // nothing of the app is printed: no menu, no buttons, no form
  await expect(paper.getByRole("heading", { level: 1 })).toHaveText(`Cupcakes ${STAMP}`);
  await expect(paper).toContainText("MAWAH Academy · FoodCost");
  await expect(paper.locator(".fcr-sub")).toContainText("Makes 12 cupcake");
  const figs = paper.locator(".fcr-figs");
  await expect(figs).toContainText("৳37.92 / cupcake");
  await expect(figs).toContainText("৳65 / cupcake");
  await expect(figs).toContainText("৳455");
  const lines = paper.locator("table").first().locator("tbody tr");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText(FLOUR);
  await expect(lines.first()).toContainText("500 g");
  await expect(lines.first()).toContainText("৳60");
  await expect(lines.nth(1)).toContainText("৳75");
  await expect(paper).toContainText("৳22.08"); // the profit on each, at the real price of ৳60
  await expect(paper).toContainText("36.8%");
  await expect(paper).toContainText("Made with FoodCost on mawahacademy.com");
  // the print style is one the site's security rules allow (by its fingerprint), so the paper really is styled: black on white, even at night
  const h1 = await paper.getByRole("heading", { level: 1 }).evaluate((h) => ({ size: getComputedStyle(h).fontSize, color: getComputedStyle(h).color }));
  expect(h1).toEqual({ size: "26.6667px", color: "rgb(23, 18, 15)" });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
  // and the PDF itself, kept with the test's results
  const file = test.info().outputPath("recipe-en.pdf");
  await page.pdf({ path: file, format: "A4", preferCSSPageSize: true, printBackground: true });
  await test.info().attach("recipe-en.pdf", { path: file, contentType: "application/pdf" });
  await page.emulateMedia({ media: null });
  // a change to the recipe takes the paper copy away: printing the page later prints the page
  await page.getByLabel("How many").fill("24");
  await expect(page.locator(".fcr-host")).toHaveCount(0);
  await page.getByLabel("How many").fill("12");

  // the list is the server's costing of what was saved
  await page.getByRole("link", { name: "FoodCost" }).first().click();
  const row = page.getByRole("link", { name: new RegExp(`Cupcakes ${STAMP}`) });
  await expect(row).toContainText("৳37.92 / cupcake");
  await expect(row).toContainText("৳65 / cupcake");
  await expect(page.getByText("Free: 1 of 3 recipes saved.")).toBeVisible();

  // a line with no price, and one with no amount: said in words, and the total says it is only part of the cost
  await page.getByRole("link", { name: "New recipe" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(`Vanilla syrup ${STAMP}`);
  await page.getByLabel("How many").fill("1");
  await page.getByLabel("Line 1", { exact: true }).selectOption({ label: `${VANILLA} (no price)` });
  await page.locator("#fc-q0").fill("5");
  await expect(page.getByText(`Line 1: ${VANILLA} has no price yet. Press “Set price” on the line.`).first()).toBeVisible();
  await expect(result).toContainText("This is only part of the cost:");
  await page.locator("#fc-q0").fill("");
  await expect(page.getByText("Line 1: type how much.").first()).toBeVisible();
  await page.locator("#fc-q0").fill("5");
  // …and its price is set right there on the line, without leaving the recipe: the pack starts in kg, as the line is weighed
  const vanilla = page.locator(".fc-line").first();
  await expect(vanilla).toContainText("No price yet");
  await vanilla.getByRole("button", { name: "Set price" }).click();
  const box = vanilla.getByRole("group", { name: `Set price: ${VANILLA}` });
  await expect(box.getByLabel("Unit")).toHaveValue("kg");
  await box.getByLabel("Pack size").fill("50");
  await box.getByLabel("Unit").selectOption("g");
  await box.getByLabel("Price (৳)").fill("250");
  await box.getByLabel("Price (৳)").press("Enter"); // Enter saves the price, not the recipe
  await expect(page.getByText("Price saved.")).toBeVisible();
  await expect(vanilla).toContainText("Price: ৳250 for 50 g · My price");
  await expect(result).not.toContainText("This is only part of the cost:");
  await expect(result.getByRole("definition").first()).toHaveText("৳25"); // 5 g of a ৳250 pack of 50 g
  await expect(page).toHaveURL(/\/app\/foodcost\/new$/);
  await expect(vanilla.getByRole("button", { name: "Change price" })).toBeVisible();

  // Free keeps 3: two more saved, then the fourth is refused in plain words (nothing about buying)
  for (const n of [2, 3]) expect((await apiPost(page, "/fc/v1/recipes", { name: `Recipe ${n} ${STAMP}`, yield_qty: 1, yield_unit: "piece", items: [] })).status).toBe(201);
  await page.getByRole("button", { name: "Save the recipe" }).click();
  await expect(page.getByText("Free accounts keep 3 recipes. Delete one to save a new one.")).toBeVisible();
  await page.goto("/app/foodcost");
  await expect(page.getByText("Free: 3 of 3 recipes saved. Delete one to save a new one.")).toBeVisible();

  // a copy is refused the same way; deleting one (asked first) makes room
  await page.getByRole("link", { name: new RegExp(`Recipe 3 ${STAMP}`) }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("Recipe deleted.")).toBeVisible();
  await expect(page.getByText("Free: 2 of 3 recipes saved.")).toBeVisible();
  await ctx.close();
});

test("one's own price replaces the Dhaka average for oneself (back in one tap), and one's own ingredient is one's own", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  await page.goto("/app/foodcost/ingredients");
  await expect(page.getByRole("heading", { level: 1, name: "Ingredients & prices" })).toBeVisible();
  await page.getByLabel("Search ingredients").fill(STAMP);
  const flour = page.locator(".fc-ing", { hasText: FLOUR });
  await expect(flour).toContainText("৳120 for 1 kg");
  await expect(flour).toContainText("৳0.12 / g");
  await expect(flour).toContainText("Dhaka average");
  expect(await serious(page)).toEqual([]);

  await flour.getByRole("button", { name: `Set my price — ${FLOUR}` }).click();
  await flour.getByLabel("Price (৳)").fill("110");
  await flour.getByLabel("Where (optional)").fill("Karwan Bazar");
  await flour.getByRole("button", { name: "Save the price" }).click();
  await expect(page.getByText("Price saved.")).toBeVisible();
  await expect(flour).toContainText("৳110 for 1 kg");
  await expect(flour).toContainText("My price");
  await expect(flour).toContainText("Dhaka average: ৳120 for 1 kg");
  // a recipe costs at one's own price at once
  const { ingredients } = await apiGet<{ ingredients: { id: number; name_en: string }[] }>(page, "/fc/v1/ingredients");
  const flourId = ingredients.find((i) => i.name_en === FLOUR)!.id;
  const made = await apiPost(page, "/fc/v1/recipes", { name: `Bread ${STAMP}`, yield_qty: 1, yield_unit: "piece", items: [{ ingredient_id: flourId, qty: 1, unit: "kg" }] });
  expect(made.status).toBe(201);
  await page.goto(`/app/foodcost/${made.body.recipe.id}`);
  await expect(page.locator(".fc-result")).toContainText("৳110 / piece");

  await page.goto("/app/foodcost/ingredients");
  await page.getByLabel("Search ingredients").fill(STAMP);
  await flour.getByRole("button", { name: `Use the Dhaka average — ${FLOUR}` }).click();
  await expect(page.getByText("Back to the Dhaka average.")).toBeVisible();
  await expect(flour).toContainText("৳120 for 1 kg");

  // one's own ingredient, with its price
  await page.getByRole("button", { name: "Add my own ingredient" }).click();
  await page.getByLabel("Name in English").fill(`Home ghee ${STAMP}`);
  const form = page.locator(".fc-add");
  await form.getByLabel("Pack size").fill("1");
  await form.getByLabel("Unit").selectOption("l");
  await form.getByLabel("Price (৳)").fill("1500");
  await form.getByRole("button", { name: "Add the ingredient" }).click();
  await expect(page.getByText("Ingredient added.")).toBeVisible();
  const own = page.locator("section", { has: page.getByRole("heading", { name: "My own ingredients" }) });
  await expect(own).toContainText(`Home ghee ${STAMP}`);
  await expect(own).toContainText("৳1,500 for 1 l");
  await ctx.close();
});

test("in Bangla on a 360 px phone: the tab, the list and the editor speak Bangla, with Bangla digits, and nothing is wider than the screen", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  await useLang(ctx, "bn");
  const page = await ctx.newPage();
  await registerStudent(page);
  await page.getByRole("navigation").last().getByRole("link", { name: "ফুডকস্ট" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "ফুডকস্ট" })).toBeVisible();
  await expect(page.getByText("ফ্রি: ৩টির মধ্যে ০টি রেসিপি সেভ করা আছে।")).toBeVisible();
  await page.getByRole("link", { name: "নতুন রেসিপি" }).click();
  await page.getByLabel("কতটি").fill("১২");
  await page.getByLabel("লাইন ১", { exact: true }).selectOption({ label: `ময়দা ${STAMP}` });
  await page.locator("#fc-q0").fill("৫০০");
  await expect(page.locator(".fc-result")).toContainText("৳৬০");
  await expect(page.locator(".fc-result")).toContainText("৳৫ / পিস");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  expect(await serious(page)).toEqual([]);
  await ctx.close();
});

test("the starter list is ready, and a recipe's calories show beside its cost: each line, one cupcake, the batch — in Bangla on a phone too", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  // the common ingredients are there from the start, with their calories per 100 g and a Dhaka market price (the owner can change it)
  await page.goto("/app/foodcost/ingredients");
  await page.getByLabel("Search ingredients").fill("maida");
  const maida = page.locator(".fc-ing", { hasText: "All-purpose flour (maida)" });
  await expect(maida).toContainText("364 kcal per 100 g");
  await expect(maida).toContainText("৳170 for 2 kg");
  await expect(maida).toContainText("Dhaka average");

  await page.goto("/app/foodcost/new");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(`Plain cupcakes ${STAMP}`);
  await page.getByLabel("How many").fill("12");
  await page.getByLabel("Called").fill("cupcake");
  await page.getByLabel("Line 1", { exact: true }).selectOption({ label: "All-purpose flour (maida)" });
  await page.locator("#fc-q0").fill("500");
  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Line 2", { exact: true }).selectOption({ label: "Egg" });
  // eggs are sold by the dozen: they are counted by the piece
  await expect(page.locator("#fc-u1")).toHaveValue("piece");
  await page.locator("#fc-q1").fill("6");
  // 500 g of flour 1,820 kcal + 6 eggs (300 g) 429 kcal = 2,249 kcal: 187 a cupcake
  await expect(page.locator(".fc-line").first()).toContainText("1,820 kcal");
  const food = page.locator(".fc-food");
  await expect(food).toContainText("Calories per cupcake");
  await expect(food).toContainText("187 kcal");
  await expect(food).toContainText("2,249 kcal");
  await expect(food).toContainText("Protein");
  // and the cost from the Dhaka prices at once: 500 g of a ৳170 2-kg pack ৳42.50 + 6 of a ৳150 dozen ৳75 = ৳117.50, ৳9.79 a cupcake
  await expect(page.locator(".fc-line").first()).toContainText("Price: ৳170 for 2 kg · Dhaka average");
  await expect(page.locator(".fc-result").getByRole("definition").first()).toHaveText("৳117.50");
  await expect(page.locator(".fc-result")).toContainText("৳9.79 / cupcake");
  await expect(page.locator(".fc-result")).not.toContainText("This is only part of the cost:");
  // an ingredient with no calorie figure is named, never guessed
  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Line 3", { exact: true }).selectOption({ label: `${VANILLA} (no price)` });
  await page.locator("#fc-q2").fill("5");
  await expect(food).toContainText(`Line 3: ${VANILLA} has no calorie figure.`);
  await page.getByRole("button", { name: "Remove line 3" }).click();
  await expect(food).not.toContainText("has no calorie figure");
  expect(await serious(page)).toEqual([]);
  await page.getByRole("button", { name: "Save the recipe" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.getByRole("link", { name: "FoodCost" }).first().click();
  await expect(page.getByRole("link", { name: new RegExp(`Plain cupcakes ${STAMP}`) })).toContainText("187 kcal");
  await ctx.close();

  const bn = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  await useLang(bn, "bn");
  const phone = await bn.newPage();
  await registerStudent(phone);
  const { ingredients } = await apiGet<{ ingredients: { id: number; name_en: string }[] }>(phone, "/fc/v1/ingredients");
  const id = (en: string) => ingredients.find((i) => i.name_en === en)!.id;
  const made = await apiPost(phone, "/fc/v1/recipes", {
    name: `কাপকেক ${STAMP}`,
    yield_qty: 12,
    yield_unit: "piece",
    items: [
      { ingredient_id: id("All-purpose flour (maida)"), qty: 500, unit: "g" },
      { ingredient_id: id("Egg"), qty: 6, unit: "piece" },
    ],
  });
  expect(made.status).toBe(201);
  await phone.goto(`/app/foodcost/${made.body.recipe.id}`);
  const bnFood = phone.locator(".fc-food");
  await expect(bnFood.getByRole("heading", { name: "ক্যালরি ও পুষ্টি" })).toBeVisible();
  await expect(bnFood).toContainText("১৮৭ ক্যালরি");
  await expect(bnFood).toContainText("প্রোটিন");
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  expect(await serious(phone)).toEqual([]);
  // the PDF in Bangla, from a phone: Bangla words and digits, the Dhaka prices, the calories
  await phone.evaluate(() => {
    window.print = () => undefined;
  });
  await phone.getByRole("button", { name: "PDF ডাউনলোড" }).click();
  await phone.emulateMedia({ media: "print" });
  const paper = phone.locator(".fcr");
  await expect(paper).toBeVisible();
  await expect(paper.getByRole("heading", { level: 1 })).toHaveText(`কাপকেক ${STAMP}`);
  await expect(paper).toContainText("মাওয়াহ একাডেমি · ফুডকস্ট");
  await expect(paper.locator(".fcr-sub")).toContainText("১২ পিস হয়");
  await expect(paper.locator(".fcr-figs")).toContainText("৳৯.৭৯ / পিস");
  await expect(paper.locator(".fcr-figs")).toContainText("১৮৭ ক্যালরি");
  await expect(paper.locator("table").first().locator("tbody tr").first()).toContainText("৳৪২.৫০");
  await expect(paper).toContainText("ঢাকার গড় দাম");
  const file = test.info().outputPath("recipe-bn.pdf");
  await phone.pdf({ path: file, format: "A4", preferCSSPageSize: true, printBackground: true });
  await test.info().attach("recipe-bn.pdf", { path: file, contentType: "application/pdf" });
  await phone.emulateMedia({ media: null });
  await bn.close();
});
