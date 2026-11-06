import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, useLang } from "./helpers";

/*
 * Admin → FoodCost (docs/foodcost.md): the owner keeps the shared ingredient list every user's recipes start from, with its default prices —
 * the current Dhaka average — added one by one or pasted from a spreadsheet, each price kept in the history; and sees who uses FoodCost.
 * Runs after the admin spec (the owner exists).
 */
const STAMP = Date.now().toString(36);
const FLOUR = `Flour ${STAMP}`;

test("the owner adds an ingredient with its Dhaka price, changes the price (the old one is kept), and pastes a list", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const admin = await ctx.newPage();
  await adminLogin(admin);

  await admin.goto("/admin/foodcost");
  await expect(admin.getByRole("heading", { level: 1, name: "FoodCost" })).toBeVisible();
  expect((await new AxeBuilder({ page: admin }).include("main").analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  // one by one: names in both languages, the density, the first price
  await admin.getByRole("button", { name: "Add an ingredient" }).click();
  const drawer = admin.getByRole("dialog");
  await drawer.getByLabel("Name in Bangla").fill(`ময়দা ${STAMP}`);
  await drawer.getByLabel("Name in English").fill(FLOUR);
  await drawer.getByLabel("Category", { exact: true }).fill("Flour");
  await drawer.getByLabel("Grams in 1 ml (density)").fill("0.53");
  await drawer.getByLabel("Pack size").fill("1");
  await drawer.getByLabel("Unit", { exact: true }).selectOption("kg");
  await drawer.getByLabel("Price (৳)").fill("120");
  await drawer.getByLabel("Where (market or shop)").fill("Karwan Bazar");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(admin.getByText("Saved.").first()).toBeVisible();
  const row = admin.getByRole("row", { name: new RegExp(FLOUR) });
  await expect(row).toContainText("৳120 for 1 kg");
  await expect(row).toContainText("৳0.12 a g"); // what a gram comes to, as recipes use it
  await expect(row).toContainText("0.53 g/ml");
  await expect(row.getByText("On", { exact: true })).toBeVisible();

  // a new price: the newest counts, the old one stays in the history
  await row.getByRole("button", { name: `Edit — ${FLOUR}` }).click();
  await drawer.getByLabel("Price (৳)").fill("115.50");
  await drawer.getByRole("button", { name: "Save the new price" }).click();
  await expect(admin.getByText("New price saved. The old one stays in the history.")).toBeVisible();
  const history = drawer.locator("ul.plain-list li");
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText("৳115.50 for 1 kg");
  await expect(history.nth(1)).toContainText("৳120 for 1 kg");
  await drawer.getByRole("button", { name: "Close" }).first().click();
  await expect(row).toContainText("৳115.50 for 1 kg");

  // a pasted list: tab-separated, as copied from a spreadsheet; a known name is updated, a wrong unit is named
  await admin.getByRole("tab", { name: "Paste a list" }).click();
  const pasted = [`চিনি ${STAMP}\tSugar ${STAMP}\tSugar\t1\tkg\t140\t0.85\t`, `ডিম ${STAMP}\tEgg ${STAMP}\tDairy & eggs\t1\tdozen\t150\t\t50`, `\t${FLOUR}\t\t\t\t\t0.55\t`, `লবণ\tSalt ${STAMP}\t\t1\tbag\t40`].join("\n");
  await admin.getByLabel("Paste your list").fill(pasted);
  await admin.getByRole("button", { name: "Read the list" }).click();
  await expect(admin.getByText("3 rows read. Check them, then add them.")).toBeVisible();
  await expect(admin.getByText("Row 4: unknown unit “bag”")).toBeVisible();
  await admin.getByRole("button", { name: "Add to the ingredient list" }).click();
  await expect(admin.getByText("2 added, 1 updated, 2 prices saved.")).toBeVisible();
  // back on the list: the egg priced per piece, the flour's density updated (not a second flour)
  await expect(admin.getByRole("row", { name: new RegExp(`Egg ${STAMP}`) })).toContainText("৳12.50 a piece");
  await expect(admin.getByRole("row", { name: new RegExp(FLOUR) })).toHaveCount(1);
  await expect(admin.getByRole("row", { name: new RegExp(FLOUR) })).toContainText("0.55 g/ml");
  const { items } = await apiGet<{ items: { name_en: string }[] }>(admin, "/admin/fc/ingredients");
  expect(items.filter((i) => i.name_en === FLOUR)).toHaveLength(1);

  // the users: nobody's recipes, only the plan and how many
  await admin.getByRole("tab", { name: "Users" }).click();
  await expect(admin.getByText("Only the plan and how many recipes are shown here — never anyone's recipes or prices.")).toBeVisible();
  await ctx.close();
});

test("a list longer than the server takes at once (200 rows) is sent in parts, and all of it is added", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const admin = await ctx.newPage();
  await adminLogin(admin);
  await admin.goto("/admin/foodcost");
  await admin.getByRole("tab", { name: "Paste a list" }).click();
  const lines = Array.from({ length: 205 }, (_, i) => `\tBulk ${STAMP} ${i + 1}\tBulk\t1\tkg\t${100 + i}`);
  await admin.getByLabel("Paste your list").fill(lines.join("\n"));
  await admin.getByRole("button", { name: "Read the list" }).click();
  await expect(admin.getByText("205 rows read. Check them, then add them.")).toBeVisible();
  await admin.getByRole("button", { name: "Add to the ingredient list" }).click();
  await expect(admin.getByText("205 added, 0 updated, 205 prices saved.")).toBeVisible();
  const { items } = await apiGet<{ items: { name_en: string }[] }>(admin, "/admin/fc/ingredients");
  expect(items.filter((i) => i.name_en.startsWith(`Bulk ${STAMP} `))).toHaveLength(205);
  await ctx.close();
});

test("in Bangla, the page and the units speak Bangla", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD" });
  await useLang(ctx, "bn");
  const admin = await ctx.newPage();
  await adminLogin(admin);
  await admin.goto("/admin/foodcost");
  await expect(admin.getByRole("heading", { level: 1, name: "ফুডকস্ট" })).toBeVisible();
  await expect(admin.getByRole("row", { name: new RegExp(`ময়দা ${STAMP}`) })).toContainText("১ কেজি ৳১১৫.৫০");
  await ctx.close();
});
