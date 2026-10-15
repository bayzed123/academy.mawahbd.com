import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, uniqueEmail, useLang } from "./helpers";

/*
 * The owner adds students who studied before the website (or paid in cash) by hand, and brings in whole lists from a spreadsheet:
 * with the classes they have, the day they really joined, and the payment they made — written down as a normal paid order on that day,
 * with no e-mail to anyone. A student added this way has no password: the team gives them a link to choose one.
 * Runs after the admin spec (the owner exists).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
const handEmail = uniqueEmail("hand");
// a transaction ID can pay for one order only, so every run (and every retry) needs its own
const trx = (tag: string) => `${tag}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e6)}`;
const handTrx = trx("H");

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
});
test.afterAll(async () => admin.context().close());

const students = async (q: string, extra = "") => (await apiGet<{ items: { id: number; email: string; source: string; phone: string | null; enrollments: number; notes: string }[] }>(admin, `/admin/students?q=${encodeURIComponent(q)}${extra}`)).items;
const orders = async (q: string) => (await apiGet<{ items: { status: string; total: number; paid_at: string | null; invoice_no: string | null; method: string | null; gateway_txn: string | null }[] }>(admin, `/admin/orders?q=${encodeURIComponent(q)}`)).items;

test("add a student by hand with a class, the day they really joined and the payment they made — then give them a way in", async ({ browser }) => {
  await admin.goto("/admin/students");
  await expect(admin.getByRole("heading", { level: 1, name: "Students" })).toBeVisible();
  await admin.getByRole("button", { name: "Add student" }).click();
  const drawer = admin.getByRole("dialog", { name: "Add a student" });
  await expect(drawer).toBeVisible();

  // nothing typed: the form says what is missing
  await drawer.getByRole("button", { name: "Add student" }).click();
  await expect(drawer.getByText("This field is required.").first()).toBeVisible();

  await drawer.getByLabel("Full name").fill("Rokeya Begum");
  await drawer.getByLabel("Email").fill(handEmail);
  await drawer.getByLabel("Mobile number").fill("০১৭১২৩৪৫৬৭৮"); // Bangla digits are understood
  await drawer.getByLabel("Private note").fill("Old WhatsApp group member");
  await drawer.getByLabel("Beginners Baking Class").check();
  await drawer.getByLabel("Has had access since").fill("2024-03-15");
  await drawer.locator("label.switch", { hasText: "They paid for these classes" }).click();
  await drawer.getByLabel("Amount paid (৳)").fill("400");
  await drawer.getByLabel("Paid by").selectOption("bkash");
  await drawer.getByLabel("Transaction ID (optional)").fill(handTrx);
  await drawer.getByRole("button", { name: "Add student" }).click();

  await expect(drawer.getByText("Rokeya Begum was added.")).toBeVisible();
  const code = (await drawer.locator(".student-code").textContent())!.trim();
  expect(code).toMatch(/^STU-\d{6,}$/);

  // written down properly: the number in the usual form, the note kept, how they joined, and a paid order on the day it was really paid
  const [row] = await students(handEmail);
  expect(row).toMatchObject({ source: "admin", phone: "01712345678", enrollments: 1, notes: "Old WhatsApp group member" });
  const [order] = await orders(handEmail);
  expect(order).toMatchObject({ status: "paid", total: 400, method: "bkash", gateway_txn: handTrx });
  expect(order.paid_at).toMatch(/^2024-03-15T/);
  expect(order.invoice_no).toMatch(/^INV-MWH-20240315-\d{4}$/);

  // no password yet: a link to choose one, to send on WhatsApp — opened on the student's own phone it sets the password and signs them in
  await drawer.getByRole("button", { name: "Get a sign-in link to send myself" }).click();
  const link = await drawer.locator("#invite-link").inputValue();
  expect(link).toMatch(/\/app\/reset\/[A-Za-z0-9_-]{20,}$/);
  const phone = await browser.newContext({ locale: "en-US" });
  await useLang(phone, "en");
  const p = await phone.newPage();
  await p.goto(link);
  await p.getByLabel("New password").fill("a-brand-new-password-5");
  await p.getByRole("button", { name: "Save" }).click();
  await expect(p.getByRole("heading", { name: "My Learning" })).toBeVisible();
  await expect(p.getByText("Beginners Baking Class")).toBeVisible();
  await phone.close();

  // the list knows how they joined and finds them by their student ID
  await drawer.getByRole("button", { name: "Open the student" }).click();
  const detail = admin.getByRole("dialog", { name: "Rokeya Begum" });
  await expect(detail.getByText(code)).toBeVisible();
  await expect(detail.getByText("Added by the team")).toBeVisible();
  await expect(detail.getByText("Old WhatsApp group member")).toBeVisible();
  await expect(detail.getByText("Get a sign-in link to send myself")).toHaveCount(0); // they have a password now
  expect((await students(code.toLowerCase())).map((s) => s.email)).toEqual([handEmail]);
});

test("a class can be opened later for a student, from a past day", async () => {
  await admin.goto(`/admin/students?q=${encodeURIComponent(handEmail)}`);
  await admin.getByRole("row", { name: new RegExp(handEmail) }).click();
  const detail = admin.getByRole("dialog", { name: "Rokeya Begum" });
  await detail.getByRole("button", { name: "Open class" }).click();
  const grant = admin.getByRole("dialog", { name: "Open a class for Rokeya Begum" });
  // what they have already is shown, and cannot be ticked twice
  await expect(grant.getByLabel("Beginners Baking Class")).toBeDisabled();
  await grant.getByLabel("Free Taster Class").check();
  await grant.getByLabel("Has had access since").fill("2024-05-01");
  await grant.getByRole("button", { name: "Open the classes" }).click();
  await expect(detail.getByText("Free Taster Class")).toBeVisible();
  expect((await students(handEmail))[0].enrollments).toBe(2);
});

test("import a list: check it line by line, see the problem lines, then add the good ones in small parts", async () => {
  const newOne = uniqueEmail("imp1");
  const paying = uniqueEmail("imp2");
  const bad = uniqueEmail("imp3");
  const importTrx = trx("I");
  const csv = [
    "name,email,phone,language,classes,enrolled_on,amount,paid_on,method,txn_id,notes",
    `Nasrin Akter,${newOne},01811111111,bn,,,,,,,Imported plain`,
    `Shirin Sultana,${paying},01822222222,en,beginners-baking-class,15/03/2024,400,15/03/2024,bKash,${importTrx},Paid before the site`,
    `Bad Line,${bad},01833333333,bn,no-such-class,,,,,,`,
    `Rokeya Begum,${handEmail},,,free-taster-class,,,,,,`,
  ].join("\n");

  await admin.goto("/admin/students/import");
  await expect(admin.getByRole("heading", { level: 1, name: "Add students from a list" })).toBeVisible();

  // the template and the names of the classes are on the page
  const [template] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("button", { name: "Download the template (CSV)" }).click()]);
  expect(template.suggestedFilename()).toBe("students-template.csv");
  await expect(admin.getByRole("region", { name: "Your classes and the names to write" }).getByText("beginners-baking-class")).toBeVisible();

  await admin.getByLabel("Paste here: copy the cells in your sheet, including the first line").fill(csv);
  await expect(admin.getByText("Found 4 lines.")).toBeVisible();
  await admin.getByRole("button", { name: "Check my list" }).click();

  await expect(admin.getByText("2 new")).toBeVisible();
  await expect(admin.getByText("1 already registered")).toBeVisible();
  await expect(admin.getByText("1 with a problem")).toBeVisible();
  await expect(admin.getByText("1 payments will be written down (৳400)")).toBeVisible();
  await expect(admin.getByText("“no-such-class” is not one of your classes")).toBeVisible();
  // nothing is saved by checking
  expect(await students(newOne)).toHaveLength(0);

  await admin.locator("label.switch", { hasText: "Show only the lines with a problem" }).click();
  await expect(admin.locator(".imp-table tbody tr")).toHaveCount(1);
  await admin.locator("label.switch", { hasText: "Show only the lines with a problem" }).click();
  await expect(admin.locator(".imp-table tbody tr")).toHaveCount(4);

  await admin.getByRole("button", { name: "Add 3 lines" }).click();
  await expect(admin.getByText("Done", { exact: true })).toBeVisible();
  await expect(admin.getByText("2 new students added, 1 existing students updated, 1 classes opened, 1 payments written down (৳400).")).toBeVisible();
  await expect(admin.getByText("1 lines were not added.")).toBeVisible();

  // the lines with a problem come back as a file to fix and import again
  const [fix] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("button", { name: "Download the problem lines" }).first().click()]);
  expect(fix.suggestedFilename()).toBe("students-to-fix.csv");
  const body = await (await fix.createReadStream()).toArray();
  const text = Buffer.concat(body as Buffer[]).toString("utf8");
  expect(text).toContain(bad);
  expect(text).toContain("is not one of your classes");
  expect(text).not.toContain(newOne);

  // what was saved
  expect((await students(newOne))[0]).toMatchObject({ source: "import", notes: "Imported plain", phone: "01811111111", enrollments: 0 });
  expect((await students(paying))[0]).toMatchObject({ source: "import", enrollments: 1 });
  expect(await students(bad)).toHaveLength(0);
  expect((await orders(paying))[0]).toMatchObject({ status: "paid", total: 400, method: "bkash", gateway_txn: importTrx });
  expect((await orders(paying))[0].paid_at).toMatch(/^2024-03-15T/);
  expect((await students(handEmail))[0].enrollments).toBe(2); // the class in the list was already there (opened by hand a moment ago): nothing doubled, nobody added twice
  // …and importing the same list again changes nothing
  await admin.getByRole("button", { name: "Import another list" }).click();
  await admin.getByLabel("Paste here: copy the cells in your sheet, including the first line").fill(csv);
  await admin.getByRole("button", { name: "Check my list" }).click();
  await expect(admin.getByText("0 new")).toBeVisible();
  await expect(admin.getByText("0 payments will be written down (৳0)")).toBeVisible();
});

test("the list of students says how each person joined, in Bangla too, and the import page passes the accessibility scan", async () => {
  await admin.goto("/admin/students?source=import");
  await expect(admin.getByRole("cell", { name: "Imported from a list" }).first()).toBeVisible();

  await admin.goto("/admin/students/import");
  await expect(admin.getByRole("heading", { level: 1, name: "Add students from a list" })).toBeVisible();
  const axe = await new AxeBuilder({ page: admin }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);

  await admin.getByRole("banner").getByRole("button", { name: "বাংলা" }).click();
  await expect(admin.getByRole("heading", { level: 1, name: "তালিকা থেকে শিক্ষার্থী যোগ করুন" })).toBeVisible();
  await admin.goto("/admin/students?add=1");
  await expect(admin.getByRole("dialog", { name: "শিক্ষার্থী যোগ করুন" })).toBeVisible();
  await admin.keyboard.press("Escape");
  await admin.getByRole("banner").getByRole("button", { name: "English" }).click();
});

test("on a 360 px phone the student list, the add form and the import page fit the screen", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await useLang(ctx, "en");
  const phone = await ctx.newPage();
  await adminLogin(phone);
  await expect(phone.getByRole("heading", { level: 1 })).toContainText(", Owner");
  const sideways = () => phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await phone.goto("/admin/students");
  await expect(phone.getByRole("heading", { level: 1, name: "Students" })).toBeVisible();
  await expect(phone.getByRole("button", { name: "Add student" })).toBeVisible();
  expect(await sideways()).toBe(0);

  await phone.getByRole("button", { name: "Add student" }).click();
  const drawer = phone.getByRole("dialog", { name: "Add a student" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Beginners Baking Class").check();
  await drawer.locator("label.switch", { hasText: "They paid for these classes" }).click();
  await expect(drawer.getByLabel("Amount paid (৳)")).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  expect(await sideways()).toBe(0);
  await phone.keyboard.press("Escape");

  await phone.goto("/admin/students/import");
  await expect(phone.getByRole("heading", { level: 1, name: "Add students from a list" })).toBeVisible();
  expect(await sideways()).toBe(0);
  await ctx.close();
});
