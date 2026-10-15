import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, useLang } from "./helpers";

/*
 * Admin → FAQ. Visitors had no FAQ anywhere. The owner now writes the questions (Bangla and English) in the admin and they show
 * on the FAQ page, as a short band on the home page and on class pages. These tests add questions the way the owner does — by
 * typing — and then look at the website the way a visitor does: the question is there at once, in the right place and the right
 * language, the accordion works from the keyboard, hiding a question takes it off the site, and nothing overflows on a phone.
 * Runs after the admin and student specs (the owner and the classes exist).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
const drawer = () => admin.getByRole("dialog");
const SITE_Q = "Can a friend pay for me from their phone?";
const CLASS_Q = "Do I need a special pan for this class?";
const CLASS_SLUG = "beginners-baking-class";

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
});
test.afterAll(async () => admin.context().close());

/** Click into a field and type like a person; every key must land in THIS field and the caret must stay there. */
async function typeInto(label: string, value: string) {
  const field = drawer().getByLabel(label, { exact: true });
  await field.click();
  await field.pressSequentially(value, { delay: 10 });
  await expect(field).toHaveValue(value);
  await expect(field).toBeFocused();
}

const visitor = async (browser: import("@playwright/test").Browser, opts: { width?: number } = {}) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: opts.width ?? 1280, height: 900 } });
  return { ctx, page: await ctx.newPage() };
};

test("the owner types a question and an answer, shows it on the home page too, and it is on the website at once", async ({ browser }) => {
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "FAQ", exact: true }).click();
  await expect(admin.getByRole("heading", { level: 1, name: "FAQ" })).toBeVisible();
  // the ten starter questions are there to edit
  await expect(admin.getByRole("row").filter({ hasText: "How do I join a class?" })).toHaveCount(1);

  await admin.getByRole("button", { name: "+ Add" }).click();
  // a site-wide question: no class to pick
  await expect(drawer().getByLabel("Class", { exact: true })).toHaveCount(0);
  await drawer().getByLabel("Topic", { exact: true }).selectOption("payment");
  await typeInto("Question (English)", SITE_Q);
  await typeInto("Answer (English)", "Yes. Ask them to send the money to our number and **tell us the TrxID**. See [how to pay](/contact).");
  await drawer().locator("label.switch", { hasText: "Show on the home page" }).click();
  await expect(drawer().getByRole("switch", { name: "Show on the home page" })).toBeChecked();
  await drawer().getByLabel("Order", { exact: true }).fill("1"); // first on the home page and in its topic
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();

  const row = admin.getByRole("row").filter({ hasText: SITE_Q });
  await expect(row).toContainText("Payment");
  await expect(row).toContainText("Home page");
  await expect(row).toContainText("Shown");

  const v = await visitor(browser);
  // FAQ page: under Payment, first, with the answer formatted and the relative link on the English site
  await v.page.goto("/en/faq");
  const payment = v.page.locator("#topic-payment");
  await expect(payment.locator(".faq-item").first().locator("summary")).toContainText(SITE_Q);
  await payment.locator(".faq-item").first().locator("summary").click();
  const answer = payment.locator(".faq-item").first().locator(".faq-a");
  await expect(answer.locator("strong")).toHaveText("tell us the TrxID");
  await expect(answer.getByRole("link", { name: "how to pay" })).toHaveAttribute("href", "/en/contact");
  // home page: the band shows it first
  await v.page.goto("/en");
  await expect(v.page.locator("#faq .faq-item").first().locator("summary")).toContainText(SITE_Q);
  // Bangla site: nothing was written in Bangla, so the English text is shown rather than an empty box
  await v.page.goto("/faq");
  await expect(v.page.locator("#topic-payment .faq-item").first().locator("summary")).toContainText(SITE_Q);
  await v.ctx.close();
});

test("a question for one class shows on that class first, and nowhere else", async ({ browser }) => {
  await admin.goto("/admin/faqs");
  await admin.getByRole("button", { name: "+ Add" }).click();
  await drawer().getByLabel("Where it shows", { exact: true }).selectOption({ label: "One class only" });
  // a class question needs a class, and the topic / home-page choices (site-wide only) go away
  await expect(drawer().getByLabel("Topic", { exact: true })).toHaveCount(0);
  await expect(drawer().getByRole("switch", { name: "Show on the home page" })).toHaveCount(0);
  await drawer().getByLabel("Class", { exact: true }).selectOption({ label: "Beginners Baking Class" });
  await typeInto("Question (English)", CLASS_Q);
  await typeInto("Answer (English)", "No. Any normal baking tray works.");
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  const row = admin.getByRole("row").filter({ hasText: CLASS_Q });
  await expect(row).toContainText("One class only");
  await expect(row).toContainText("Beginners Baking Class");

  const v = await visitor(browser);
  await v.page.goto(`/en/courses/${CLASS_SLUG}`);
  const items = v.page.locator("#faq .faq-item");
  await expect(items.first().locator("summary")).toContainText(CLASS_Q);
  expect(await items.count()).toBeGreaterThan(1); // topped up with the home-page questions, so a buyer always finds the basics
  // another class does not have it
  const { courses } = await apiGet<{ courses: { slug: string }[] }>(v.page, "/courses");
  const other = courses.find((c) => c.slug !== CLASS_SLUG)!;
  await v.page.goto(`/en/courses/${other.slug}`);
  await expect(v.page.locator("#faq")).not.toContainText(CLASS_Q);
  // and it is not on the FAQ page, which is for site-wide questions
  await v.page.goto("/en/faq");
  await expect(v.page.getByText(CLASS_Q)).toHaveCount(0);
  await v.ctx.close();
});

test("the accordion works from the keyboard: Enter and Space open and close a question", async ({ browser }) => {
  const v = await visitor(browser);
  await v.page.goto("/en/faq");
  const first = v.page.locator(".faq-item").first();
  const summary = first.locator("summary");
  await summary.focus();
  await expect(first).not.toHaveAttribute("open", "");
  await v.page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("open", "");
  await v.page.keyboard.press("Enter");
  await expect(first).not.toHaveAttribute("open", "");
  await v.page.keyboard.press("Space");
  await expect(first).toHaveAttribute("open", "");
  // Tab moves on to the next question
  await v.page.keyboard.press("Tab");
  await expect(v.page.locator(".faq-item").nth(1).locator("summary")).toBeFocused();
  await v.ctx.close();
});

test("the switch in the list hides a question from the website at once, and showing it again brings it back", async ({ browser }) => {
  await admin.goto("/admin/faqs");
  await admin.getByPlaceholder("Search questions").fill("friend pay");
  const row = admin.getByRole("row").filter({ hasText: SITE_Q });
  await expect(row).toHaveCount(1);
  const toggle = row.getByRole("switch", { name: `Show “${SITE_Q}” on the website` });
  await expect(toggle).toBeChecked();

  const v = await visitor(browser);
  await row.locator("label.switch").click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await expect(row).toContainText("Hidden");
  await expect(toggle).not.toBeChecked();
  await v.page.goto("/en/faq");
  await expect(v.page.getByText(SITE_Q)).toHaveCount(0);
  await v.page.goto("/en");
  await expect(v.page.locator("#faq")).not.toContainText(SITE_Q);

  await row.locator("label.switch").click();
  await expect(row).toContainText("Shown");
  await v.page.goto("/en/faq");
  await expect(v.page.getByText(SITE_Q)).toHaveCount(1);
  await v.ctx.close();
});

test("deleting a question removes it everywhere; it can be brought back from the trash", async ({ browser }) => {
  await admin.goto("/admin/faqs");
  await admin.getByPlaceholder("Search questions").fill("special pan");
  const row = admin.getByRole("row").filter({ hasText: CLASS_Q });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(admin.getByRole("alertdialog")).toContainText(`Delete “${CLASS_Q}”?`);
  await admin.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(admin.getByText("Deleted.")).toBeVisible();
  await expect(admin.getByRole("row").filter({ hasText: CLASS_Q })).toHaveCount(0);
  const v = await visitor(browser);
  await v.page.goto(`/en/courses/${CLASS_SLUG}`);
  await expect(v.page.locator("#faq")).not.toContainText(CLASS_Q);

  // it is in the trash, and Restore puts it back on the class page
  await admin.getByRole("button", { name: "Trash", exact: true }).click();
  const trashed = admin.getByRole("row").filter({ hasText: CLASS_Q });
  await expect(trashed).toHaveCount(1);
  await trashed.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(admin.getByText("Restored.")).toBeVisible();
  await v.page.goto(`/en/courses/${CLASS_SLUG}`);
  await expect(v.page.locator("#faq .faq-item").first().locator("summary")).toContainText(CLASS_Q);
  await v.ctx.close();
});

test("the FAQ page and the home band pass the accessibility scan and fit a phone with nothing sideways", async ({ browser }) => {
  const v = await visitor(browser);
  for (const path of ["/en/faq", "/en", "/faq"]) {
    await v.page.goto(path);
    await v.page.locator(".faq-item").first().locator("summary").click(); // an open answer is scanned too
    const axe = await new AxeBuilder({ page: v.page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.filter((x) => x.impact === "serious" || x.impact === "critical").map((x) => `${path}: ${x.id}`)).toEqual([]);
  }
  await v.ctx.close();

  const phone = await visitor(browser, { width: 360 });
  for (const path of ["/en/faq", "/faq", "/en"]) {
    await phone.page.goto(path);
    await expect(phone.page.locator(".faq-item").first()).toBeVisible();
    expect(await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
  await phone.ctx.close();
});

test("the header: every link on one line beside the logo from 1180px, and the menu button holds them below that (no wrapped labels in either language)", async ({ browser }) => {
  for (const lang of ["en", "bn"] as const) {
    const ctx = await browser.newContext({ locale: lang === "en" ? "en-US" : "bn-BD" });
    const page = await ctx.newPage();
    for (const width of [900, 1100, 1180, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(lang === "en" ? "/en" : "/");
      const nav = page.locator(".nav-links");
      const menu = page.locator(".menu > summary");
      if (width >= 1180) {
        await expect(nav).toBeVisible();
        await expect(menu).toBeHidden();
        // each link is one line: no taller than a single line of text with its padding
        const tallest = await nav.locator("a").evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().height)));
        expect(tallest, `${lang} @${width}`).toBeLessThan(48);
        expect(await page.locator(".nav").evaluate((e) => e.getBoundingClientRect().height)).toBeLessThan(90);
        await expect(nav.getByRole("link", { name: lang === "en" ? "FAQ" : "সচরাচর জিজ্ঞাসা" })).toBeVisible();
      } else {
        await expect(nav).toBeHidden();
        await expect(menu).toBeVisible();
        await menu.click();
        await expect(page.locator(".menu-panel").getByRole("link", { name: lang === "en" ? "FAQ" : "সচরাচর জিজ্ঞাসা" })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${lang} @${width} overflow`).toBe(0);
    }
    await ctx.close();
  }
});
