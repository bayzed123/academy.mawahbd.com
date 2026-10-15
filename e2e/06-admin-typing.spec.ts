import { expect, test, type Locator, type Page } from "@playwright/test";
import { adminLogin, useLang } from "./helpers";

/*
 * Regression: in the admin the keyboard used to be "lost" after ONE character in every drawer form (instructors,
 * categories, blog, bundles, coupons, team …). The drawer set its focus up again on every re-render of its page —
 * and a form re-renders on every keystroke — so the caret went back to the button that had opened the drawer and
 * then to the first field. On a phone the on-screen keyboard closed after each letter.
 *
 * `fill()` hides this (it sets the whole value at once), so these tests TYPE key by key, like a person, and check that
 * every character arrives and that the caret never leaves the field. Runs after spec 02, which creates the owner.
 */
test.describe.configure({ mode: "serial" });

let page: Page;
const nav = (name: string) => page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name, exact: true });

/** Click into a field and type like a person; every key must land in THIS field. */
async function typeLikeAPerson(field: Locator, text: string) {
  await field.click();
  await field.clear(); // some fields already hold a saved value
  await field.pressSequentially(text, { delay: 30 });
  await expect(field).toHaveValue(text);
  await expect(field).toBeFocused();
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  page = await ctx.newPage();
  await adminLogin(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(", Owner");
});
test.afterAll(async () => page.context().close());

test("a drawer form keeps the caret while you type — English, Bangla, several fields in a row", async () => {
  await nav("Instructors").click();
  const add = page.getByRole("button", { name: "+ Add" });
  await add.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();

  // not the first field on purpose: the old bug sent the caret back to the first one after each letter
  await typeLikeAPerson(drawer.getByLabel("Headline (English)"), "Pastry chef and baking teacher");
  await typeLikeAPerson(drawer.getByLabel("Name (বাংলা) *"), "শেফ তানিয়া রহমান");
  await typeLikeAPerson(drawer.getByLabel("Name (English) *"), "Chef Tania Rahman");
  await typeLikeAPerson(drawer.getByLabel("About (English)"), "Ten years in professional kitchens.");

  // nothing was lost on the way: what was typed is what is saved
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Chef Tania Rahman/ })).toBeVisible();
  const saved = await (await page.request.get("/api/admin/instructors?q=Tania")).json();
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]).toMatchObject({
    name_bn: "শেফ তানিয়া রহমান",
    name_en: "Chef Tania Rahman",
    headline_en: "Pastry chef and baking teacher",
  });
});

test("closing a drawer hands the keyboard back to the button that opened it, and only then", async () => {
  const add = page.getByRole("button", { name: "+ Add" });
  await add.focus();
  await add.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  // opening puts the caret in the first field…
  await expect(drawer.getByLabel("Name (বাংলা) *")).toBeFocused();
  // …typing never moves it…
  await typeLikeAPerson(drawer.getByLabel("Name (English) *"), "Typed here");
  // …and Escape closes the drawer and returns focus to "+ Add" (keyboard users keep their place)
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(add).toBeFocused();
});

test("a coupon drawer (numbers, dates, text) and a team-member drawer accept typing too", async () => {
  await nav("Coupons").click();
  await page.getByRole("button", { name: "+ Add" }).click();
  let drawer = page.getByRole("dialog");
  await typeLikeAPerson(drawer.getByLabel("Code *"), "EID2026");
  await typeLikeAPerson(drawer.getByLabel("Internal note"), "Eid offer for returning students");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  await nav("Team").click();
  await page.getByRole("button", { name: "Add team member" }).click();
  drawer = page.getByRole("dialog");
  await typeLikeAPerson(drawer.getByLabel("Full name *"), "Nusrat Jahan");
  await typeLikeAPerson(drawer.getByLabel("Email *"), "nusrat.jahan@example.com");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("the class editor and the settings page (full pages, not drawers) accept typing too", async () => {
  await page.goto("/admin/courses/new");
  await typeLikeAPerson(page.getByLabel(/^Title \(English\)/), "Eid special sweets masterclass");
  await typeLikeAPerson(page.getByLabel(/^Title \(বাংলা\)/), "ঈদ স্পেশাল মিষ্টি মাস্টারক্লাস");

  await nav("Settings").click();
  await typeLikeAPerson(page.getByLabel("WhatsApp number"), "01711223344");
  await typeLikeAPerson(page.getByLabel("Facebook"), "https://facebook.com/mawahacademy");
});
