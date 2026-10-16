import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiPost, useLang } from "./helpers";

/*
 * Admin → Classes. The owner could not tell how to make an existing class Active or Inactive (there was only a "Status" menu
 * saying "Published"), and had no read-only page for a class — every click opened the editor. This follows the owner's two
 * wishes: one clear Active / Inactive switch that says what will happen, and a View mode with an Edit mode behind a button.
 * Runs after the student and review specs, so the class it uses (Beginners Baking Class) has a real student, a real sale and a
 * real review.
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
const SLUG = "beginners-baking-class";
const TITLE = "Beginners Baking Class";
const publicStatus = async () => (await admin.request.get(`/en/courses/${SLUG}`)).status();

/**
 * Type in the class search and wait until the table shows the answer. The old rows stay on screen while the new list loads,
 * and a click on one of them can be lost when the rows are swapped a moment later — so the test waits for the server's answer
 * (and for exactly that many rows) before it touches a row.
 */
async function searchClasses(text: string) {
  const answered = admin.waitForResponse((r) => r.url().includes("/api/admin/courses?") && new URL(r.url()).searchParams.get("q") === text && r.ok());
  await admin.getByPlaceholder("Search by class name").fill(text);
  const { items } = (await (await answered).json()) as { items: unknown[] };
  await expect(admin.locator("tbody tr")).toHaveCount(items.length);
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
});
test.afterAll(async () => admin.context().close());

test("the class list has one Active switch: it asks before hiding a class, says what happens to students, and switching on brings it back", async () => {
  await admin.goto("/admin/courses");
  await searchClasses("Beginners Baking");
  const row = admin.getByRole("row").filter({ hasText: TITLE });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Active");
  const toggle = row.getByRole("switch", { name: `Show ${TITLE} on the website` });
  await expect(toggle).toBeChecked();
  expect(await publicStatus()).toBe(200);

  // turning it off asks first, and tells the owner the students who already paid keep their access
  await row.locator("label.switch").click();
  const dialog = admin.getByRole("alertdialog");
  await expect(dialog).toContainText(`Make “${TITLE}” inactive?`);
  await expect(dialog).toContainText("Students who are already enrolled (1) keep their access");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(toggle).toBeChecked();
  expect(await publicStatus()).toBe(200); // cancelling changes nothing

  await row.locator("label.switch").click();
  await dialog.getByRole("button", { name: "Make inactive" }).click();
  await expect(admin.getByText(`“${TITLE}” is now inactive and hidden from the website.`)).toBeVisible();
  await expect(row).toContainText("Inactive");
  await expect(toggle).not.toBeChecked();
  expect(await publicStatus()).toBe(404); // gone from the website at once
  expect(await (await admin.request.get(`/api/courses?q=${SLUG}`)).json().then((b: { courses: unknown[] }) => b.courses.length)).toBe(0);

  // and back on: this class has lessons and nobody waiting, so there is nothing to ask
  await row.locator("label.switch").click();
  await expect(admin.getByText(`“${TITLE}” is now active on the website.`)).toBeVisible();
  await expect(row).toContainText("Active");
  expect(await publicStatus()).toBe(200);
});

test("turning on a class with no lessons asks first, because students who pay would find it empty", async () => {
  const slug = "empty-class-e2e";
  const made = await apiPost(admin, "/admin/courses", { title_bn: "ফাঁকা ক্লাস", title_en: "Empty Class E2E", slug, price: 300, status: "draft", short_bn: "", short_en: "", long_bn: "", long_en: "", banner_key: null, icon: "cake", category_id: null, instructor_id: null, level: null, details_url: null, featured: false, cert_enabled: true, seo_title_bn: "", seo_title_en: "", seo_desc_bn: "", seo_desc_en: "", sort: 100, launch_at: null });
  expect(made.status).toBe(201);
  await admin.goto("/admin/courses");
  await searchClasses("Empty Class E2E");
  const row = admin.getByRole("row").filter({ hasText: "Empty Class E2E" });
  await expect(row).toContainText("Inactive");
  await row.locator("label.switch").click();
  const dialog = admin.getByRole("alertdialog");
  await expect(dialog).toContainText("It has no lessons yet");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toContainText("Inactive");
  expect((await admin.request.get(`/en/courses/${slug}`)).status()).toBe(404);
  await row.locator("label.switch").click();
  await dialog.getByRole("button", { name: "Make active" }).click();
  await expect(row).toContainText("Active");
  expect((await admin.request.get(`/en/courses/${slug}`)).status()).toBe(200);
});

test("view mode: a click on a class opens a read-only overview with real numbers; Edit mode is one button away, and back", async () => {
  await admin.goto("/admin/courses");
  await searchClasses("Beginners Baking");
  await admin.getByRole("row").filter({ hasText: TITLE }).getByRole("cell").first().click(); // anywhere on the row
  await expect(admin).toHaveURL(/\/admin\/courses\/\d+$/);
  const id = Number(admin.url().match(/courses\/(\d+)/)![1]);
  await expect(admin.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(admin.getByText("Class overview")).toBeVisible(); // the "view mode" label
  await expect(admin.getByLabel("Visibility on the website")).toContainText("Active");
  await expect(admin.getByRole("switch", { name: "Active on the website" })).toBeChecked();

  // the numbers are the ones the rest of the admin reports: one paid sale of ৳360 (spec 04), one approved review (spec 07)
  const api = await apiGet<{ stats: { enrolled: number; revenue: number; rating_avg: number; rating_count: number; lessons: number }; reviews: { body: string }[] }>(admin, `/admin/courses/${id}/overview`);
  const kpi = (name: string) => admin.locator(".kpi").filter({ hasText: name });
  await expect(kpi("Students enrolled")).toContainText(String(api.stats.enrolled));
  await expect(kpi("Earned")).toContainText("৳360");
  expect(api.stats.revenue).toBe(360);
  // a rating only when reviews were approved — the page shows what the API counted, never a guess
  await expect(kpi("Student rating")).toContainText(api.stats.rating_count > 0 ? `${api.stats.rating_avg.toFixed(1)} ★` : "Not rated yet");
  await expect(kpi("Lessons")).toContainText(String(api.stats.lessons));
  await expect(admin.getByRole("heading", { name: "Curriculum" })).toBeVisible();
  await expect(admin.getByText("Meet your oven and tools")).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Latest reviews" })).toBeVisible();
  if (api.reviews.length > 0) await expect(admin.getByText(api.reviews[0].body, { exact: true })).toBeVisible();
  else await expect(admin.getByText("No reviews yet.")).toBeVisible();

  // nothing on this page can be typed into: it is a view
  await expect(admin.locator("main input[type=text], main textarea")).toHaveCount(0);

  // edit mode is a separate page with its own label, and a way back
  await admin.getByRole("link", { name: "Edit this class" }).first().click();
  await expect(admin).toHaveURL(new RegExp(`/admin/courses/${id}/edit$`));
  await expect(admin.getByText("Edit mode")).toBeVisible();
  await expect(admin.getByLabel("Title (English) *")).toHaveValue(TITLE);
  await admin.getByRole("link", { name: "← Class overview" }).click();
  await expect(admin).toHaveURL(new RegExp(`/admin/courses/${id}$`));

  // an old link to the curriculum tab still lands in the editor, on that tab
  await admin.goto(`/admin/courses/${id}?tab=curriculum`);
  await expect(admin).toHaveURL(new RegExp(`/admin/courses/${id}/edit\\?tab=curriculum`));
  await expect(admin.getByRole("button", { name: "+ Add module" })).toBeVisible();
});

test("the same switch on the overview page, and the editor's visibility menu explains each choice in plain words", async () => {
  await admin.goto("/admin/courses");
  await searchClasses("Beginners Baking");
  await admin.getByRole("row").filter({ hasText: TITLE }).getByRole("button", { name: "View" }).click();
  await expect(admin).toHaveURL(/\/admin\/courses\/\d+$/);
  await admin.getByRole("switch", { name: "Active on the website" }).locator("xpath=ancestor::label").click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Make inactive" }).click();
  await expect(admin.getByLabel("Visibility on the website")).toContainText("Inactive");
  await expect(admin.getByText("This class is hidden. Visitors cannot see it and nobody can buy it.")).toBeVisible();
  expect(await publicStatus()).toBe(404);

  // the editor's menu says what each choice does
  await admin.getByRole("link", { name: "Edit this class" }).first().click();
  const menu = admin.getByLabel("Visibility on the website");
  await expect(menu.locator("option")).toHaveText([
    "Inactive — hidden from the website",
    "Coming soon — visible, enrolment closed, visitors can ask to be told",
    "Active — on the website, open for enrolment",
    "Archived — hidden; students keep their access",
  ]);
  await menu.selectOption("published");
  await admin.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  expect(await publicStatus()).toBe(200);
});

test("the list and the overview pass the accessibility audit, and the list fits a phone", async ({ browser }) => {
  const audit = async (p: Page, label: string) => {
    const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`), label).toEqual([]);
  };
  await admin.goto("/admin/courses");
  await expect(admin.getByRole("row").nth(1)).toBeVisible();
  await audit(admin, "class list");
  await admin.getByRole("row").nth(1).getByRole("cell").first().click();
  await expect(admin.getByText("Class overview")).toBeVisible();
  await audit(admin, "class overview");

  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await useLang(ctx, "en");
  const phone = await ctx.newPage();
  await adminLogin(phone);
  await phone.goto("/admin/courses");
  await expect(phone.getByRole("switch").first()).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await ctx.close();
});
