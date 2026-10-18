import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, agree, apiGet, PDF, registerStudent, useLang } from "./helpers";

/*
 * Admin → Materials. The owner could not find where to upload things for a class (the only upload was hidden inside a lesson)
 * and asked for one visible place with a choice of what is being added — video, PDF, ZIP, book, live class, link, private group
 * (a Facebook group asks the student for their profile link). These tests do it the way the owner does: choose the type, upload
 * or type, save — and then look from the other side: the public class page says what is included without giving anything away,
 * an enrolled student sees the materials with the "for your own learning only" notice, downloads a file, opens a link, asks to join
 * the group, and the owner approves. Runs after the admin and student specs.
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
let studentCtx: BrowserContext;
let student: Page;
const CLASS_SLUG = "free-taster-class";
const CLASS_TITLE = "Free Taster Class";
const drawer = () => admin.getByRole("dialog");

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
});
test.afterAll(async () => {
  await admin.context().close();
  await studentCtx?.close();
});

/** Opens "+ Add", picks the class and the type card; returns once the details are showing. */
async function startAdding(kind: RegExp) {
  await admin.goto("/admin/materials");
  await admin.getByRole("button", { name: "+ Add" }).click();
  await drawer().getByLabel("Which class is it for?").selectOption({ label: CLASS_TITLE });
  await drawer().getByRole("radio", { name: kind }).click();
  await expect(drawer().getByRole("heading", { name: "Details" })).toBeVisible();
}
const typeInto = async (label: string, value: string) => {
  const field = drawer().getByLabel(label, { exact: true });
  await field.click();
  await field.pressSequentially(value, { delay: 8 });
  await expect(field).toHaveValue(value);
};
const save = async () => {
  await drawer().getByRole("button", { name: "Save" }).click();
};

test("Materials is in the left menu, and \"+ Add\" asks what is being added with seven plainly-worded choices", async () => {
  await admin.goto("/admin/");
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Materials", exact: true }).click();
  await expect(admin.getByRole("heading", { level: 1, name: "Materials" })).toBeVisible();
  await admin.getByRole("button", { name: "+ Add" }).click();
  await expect(drawer().getByRole("heading", { name: "New material" })).toBeVisible();

  // nothing can be saved until the class and the type are chosen
  await expect(drawer().getByRole("button", { name: "Save" })).toBeDisabled();
  const cards = drawer().getByRole("radiogroup", { name: "What are you adding?" }).getByRole("radio");
  await expect(cards).toHaveCount(7);
  for (const [label, help] of [
    ["Video", "A recorded video"],
    ["PDF", "A PDF students download"],
    ["ZIP file pack", "Several files in one ZIP"],
    ["Book / e-book", "A book or e-book"],
    ["Live class", "A live class: the link"],
    ["Link", "Any web address"],
    ["Private group", "A Facebook group asks the student for their profile link first"],
  ]) {
    const card = drawer().getByRole("radio", { name: new RegExp(`^${label.replace("/", "\\/")}`) });
    await expect(card).toContainText(help);
  }
  // the details only appear once a type is chosen
  await expect(drawer().getByLabel("Title (English)")).toHaveCount(0);
  await drawer().getByLabel("Which class is it for?").selectOption({ label: CLASS_TITLE });
  await drawer().getByRole("radio", { name: /^PDF/ }).click();
  await expect(drawer().getByRole("radio", { name: /^PDF/ })).toBeChecked();
  await expect(drawer().getByLabel("Title (English)")).toBeVisible();
  await expect(drawer().getByText("Choose a file")).toBeVisible();
  await expect(drawer().getByRole("button", { name: "Save" })).toBeEnabled();
  await drawer().getByRole("button", { name: "Cancel" }).click();
});

test("a PDF: choose the type, upload the file (a web page dressed as a PDF is refused), type the title, save", async () => {
  await startAdding(/^PDF/);
  // a web page renamed .pdf is not a PDF
  await drawer().locator("#mat-file").setInputFiles({ name: "page.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
  await expect(drawer().getByRole("alert")).toContainText("That file type is not allowed.");
  // the real one
  await drawer().locator("#mat-file").setInputFiles({ name: "biryani.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(drawer().getByText(/Uploaded: biryani\.pdf/)).toBeVisible();
  await typeInto("Title (English)", "Biryani masala guide");
  await typeInto("Title (বাংলা)", "বিরিয়ানি মশলার গাইড");
  await typeInto("A line for the student (English, optional)", "Print it and keep it in the kitchen.");
  await save();
  await expect(admin.getByText("Saved.")).toBeVisible();

  const row = admin.getByRole("row").filter({ hasText: "Biryani masala guide" });
  await expect(row).toContainText("PDF");
  await expect(row).toContainText(CLASS_TITLE);
  await expect(row).toContainText("biryani.pdf");
  await expect(row).toContainText("Shown");
});

test("a link, a live class and a Facebook group: each shows only what it needs, and mistakes are explained", async () => {
  // a link
  await startAdding(/^Link/);
  await expect(drawer().getByText("Choose a file")).toHaveCount(0); // a link has no upload box
  await typeInto("Title (English)", "Tools sheet");
  await typeInto("Address (link)", "http://example.com/tools");
  await save();
  await expect(drawer().getByText("Please enter a valid web address.")).toBeVisible();
  await drawer().getByLabel("Address (link)").fill("https://example.com/tools");
  await save();
  await expect(admin.getByText("Saved.")).toBeVisible();

  // a live class
  await startAdding(/^Live class/);
  await typeInto("Title (English)", "Live Q&A with the chef");
  await drawer().getByLabel("Starts (Bangladesh time)").fill("2030-01-15T16:00");
  await drawer().getByLabel("Address (link)").fill("https://zoom.us/j/123456789");
  await save();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await expect(admin.getByRole("row").filter({ hasText: "Live Q&A with the chef" })).toContainText("2030");

  // a Facebook group: its link must be a Facebook link, and the screen says students will be asked for their profile
  await startAdding(/^Private group/);
  await expect(drawer().getByText("Students must send their Facebook profile link before they see this group's link")).toBeVisible();
  await typeInto("Title (English)", "Baking circle");
  await drawer().getByLabel("Facebook group link").fill("https://example.com/groups/baking");
  await save();
  await expect(drawer().getByText(/does not look like a Facebook group link/)).toBeVisible();
  await drawer().getByLabel("Facebook group link").fill("https://www.facebook.com/groups/mawah.baking.circle");
  await save();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await expect(admin.getByRole("row").filter({ hasText: "Baking circle" })).toContainText("asks for a Facebook profile link");
});

test("the list filters by type and class, and the accessibility scan passes with the form open", async () => {
  await admin.goto("/admin/materials");
  await expect(admin.getByRole("row").filter({ hasText: "Biryani masala guide" })).toHaveCount(1);
  await admin.getByRole("combobox", { name: "Type" }).selectOption({ label: "Link" });
  await expect(admin.getByRole("row").filter({ hasText: "Tools sheet" })).toHaveCount(1);
  await expect(admin.getByRole("row").filter({ hasText: "Biryani masala guide" })).toHaveCount(0);
  await admin.goto("/admin/materials");
  await admin.getByRole("button", { name: "+ Add" }).click();
  await drawer().getByRole("radio", { name: /^Live class/ }).click();
  const axe = await new AxeBuilder({ page: admin }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await drawer().getByRole("button", { name: "Cancel" }).click();
});

test("a visitor sees what the class includes — counts and titles — and not one link or file", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  const visitor = await ctx.newPage();
  await visitor.goto(`/en/courses/${CLASS_SLUG}`);
  const inc = visitor.locator("section[aria-labelledby=inc-h]");
  for (const line of ["1 PDF to download", "1 live class", "1 useful link", "A private community group"]) await expect(inc).toContainText(line);
  for (const title of ["Biryani masala guide", "Tools sheet", "Live Q&A with the chef", "Baking circle"]) await expect(inc).toContainText(title);
  await expect(inc).toContainText("Downloads are for your own use only");
  const html = await visitor.content();
  for (const secret of ["zoom.us", "mawah.baking.circle", "example.com/tools", "biryani.pdf", "materials/"]) expect(html, secret).not.toContain(secret);
  await visitor.goto(`/courses/${CLASS_SLUG}`);
  await expect(visitor.locator("section[aria-labelledby=inc-h]")).toContainText("ডাউনলোডের জন্য ১টি পিডিএফ");
  await ctx.close();
});

test("an enrolled student sees the materials with the notice, downloads the file, opens the link and the live class", async ({ browser }) => {
  studentCtx = await browser.newContext({ locale: "en-US" });
  await useLang(studentCtx, "en");
  student = await studentCtx.newPage();
  // the links open on other sites: stand in for them so the test never leaves this machine
  await studentCtx.route(/^https:\/\/(example\.com|zoom\.us|www\.facebook\.com)\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>elsewhere</title>" }));

  await registerStudent(student, { name: "Mina Baker" });
  // a student who is not enrolled yet gets nothing
  const early = await student.request.get(`/api/student/courses/${CLASS_SLUG}/materials`);
  expect(early.status()).toBe(403);
  await student.goto(`/app/checkout?c=${CLASS_SLUG}`);
  await agree(student);
  await student.getByRole("button", { name: "Enroll for free" }).click();
  await expect(student.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();

  await student.goto(`/app/learn/${CLASS_SLUG}`);
  const section = student.locator("#materials");
  await expect(section.getByRole("heading", { name: "Class materials" })).toBeVisible();
  // the notice the owner asked for
  await expect(section).toContainText("For your own learning only");
  await expect(section).toContainText("Please do not share, resell or re-upload them.");
  await expect(section.locator(".mat-card")).toHaveCount(4);

  // download: the real file arrives under its own name
  const pdf = section.locator(".mat-card", { hasText: "Biryani masala guide" });
  await expect(pdf).toContainText("Print it and keep it in the kitchen.");
  const [download] = await Promise.all([student.waitForEvent("download"), pdf.getByRole("link", { name: /^Download/ }).click()]);
  expect(download.suggestedFilename()).toBe("biryani.pdf");
  const bytes = Buffer.from(await (await import("node:fs/promises")).readFile((await download.path())!));
  expect(bytes.equals(PDF)).toBe(true);

  // a link opens in a new tab at the address only an enrolled student can get
  const tools = section.locator(".mat-card", { hasText: "Tools sheet" });
  const [popup] = await Promise.all([studentCtx.waitForEvent("page"), tools.getByRole("button", { name: /Open link/ }).click()]);
  await popup.waitForURL("https://example.com/tools");
  await popup.close();
  const live = section.locator(".mat-card", { hasText: "Live Q&A with the chef" });
  await expect(live).toContainText("(Bangladesh time)");
  await expect(live).toContainText("Upcoming");
  const [zoom] = await Promise.all([studentCtx.waitForEvent("page"), live.getByRole("button", { name: /Join live class/ }).click()]);
  await zoom.waitForURL("https://zoom.us/j/123456789");
  await zoom.close();

  // the list the page loaded carries no address and no file key
  const raw = await (await student.request.get(`/api/student/courses/${CLASS_SLUG}/materials`)).text();
  for (const secret of ["zoom.us", "example.com", "mawah.baking.circle", "materials/", "r2_key"]) expect(raw, secret).not.toContain(secret);
});

test("a private Facebook group: the student is asked for their profile link first, then can open the group", async () => {
  await student.goto(`/app/learn/${CLASS_SLUG}`);
  const group = student.locator(".mat-card", { hasText: "Baking circle" });
  await expect(group).toContainText("This group is private. Send us your Facebook profile link");
  // the group's link is not offered before the question is answered
  await expect(group.getByRole("button", { name: "Open the group" })).toHaveCount(0);

  const profile = group.getByLabel("Your Facebook profile link");
  await profile.fill("https://example.com/not-facebook");
  await group.getByRole("button", { name: "Ask to join" }).click();
  await expect(group.getByRole("alert")).toContainText("That does not look like a Facebook profile link");
  await profile.fill("https://www.facebook.com/mina.baker");
  await group.getByRole("button", { name: "Ask to join" }).click();
  await expect(group.getByRole("status")).toContainText("Request sent — we will approve you in the group soon.");

  const [popup] = await Promise.all([studentCtx.waitForEvent("page"), group.getByRole("button", { name: "Open the group" }).click()]);
  await popup.waitForURL("https://www.facebook.com/groups/mawah.baking.circle");
  await popup.close();

  const axe = await new AxeBuilder({ page: student }).include("#materials").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("the owner sees who asked, opens the profile, approves — and the student sees the answer", async () => {
  await admin.goto("/admin/materials");
  await admin.getByRole("link", { name: /^Group requests/ }).click();
  await expect(admin.getByRole("heading", { level: 1, name: "Group requests" })).toBeVisible();
  const row = admin.getByRole("row").filter({ hasText: "Mina Baker" });
  await expect(row).toContainText("Baking circle");
  await expect(row).toContainText("Waiting");
  await expect(row.getByRole("link", { name: /Open profile/ })).toHaveAttribute("href", "https://www.facebook.com/mina.baker");
  await expect(row.getByRole("link", { name: /Open profile/ })).toHaveAttribute("target", "_blank");
  await row.getByRole("button", { name: /Approve/ }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await expect(row).toContainText("Approved");

  await student.goto(`/app/learn/${CLASS_SLUG}`);
  await expect(student.locator(".mat-card", { hasText: "Baking circle" })).toContainText("You are approved. Welcome to the group!");

  // who downloaded and opened what is on record
  await admin.goto("/admin/materials/downloads");
  await expect(admin.getByRole("row").filter({ hasText: "Biryani masala guide" })).toContainText("Mina Baker");
  await expect(admin.getByRole("row").filter({ hasText: "Biryani masala guide" })).toContainText("Downloaded");
  await expect(admin.getByRole("row").filter({ hasText: "Tools sheet" })).toContainText("Opened");
  const list = await apiGet<{ items: { title_en: string; downloads: number }[] }>(admin, `/admin/materials?per_page=50`);
  expect(list.items.find((m) => m.title_en === "Biryani masala guide")!.downloads).toBe(1);
});

test("the student page in Bangla, and the class overview in the admin offers to add material and counts what is there", async () => {
  await student.goto(`/app/learn/${CLASS_SLUG}`);
  await student.getByRole("button", { name: "বাংলা" }).click();
  await expect(student.getByRole("heading", { name: "ক্লাসের ম্যাটেরিয়াল" })).toBeVisible();
  await expect(student.locator("#materials")).toContainText("শুধু আপনার নিজের শেখার জন্য");
  await expect(student.locator("#materials")).toContainText("অন্যকে দেবেন না, বিক্রি করবেন না");
  await student.getByRole("button", { name: "English" }).click();

  const classes = await apiGet<{ items: { id: number; slug: string }[] }>(admin, "/admin/courses?per_page=100");
  const id = classes.items.find((c) => c.slug === CLASS_SLUG)!.id;
  await admin.goto(`/admin/courses/${id}`);
  await expect(admin.getByRole("link", { name: /Add material/ })).toHaveAttribute("href", new RegExp(`/materials\\?course_id=${id}&add=1`));
  const kpi = admin.locator(".kpi", { hasText: "Materials" });
  await expect(kpi).toContainText("4");
  await expect(kpi).toContainText("1 files · 3 links, live classes, groups");
  // "Add material" opens the form for this class straight away
  await admin.getByRole("link", { name: /Add material/ }).click();
  await expect(drawer().getByRole("heading", { name: "New material" })).toBeVisible();
  await expect(drawer().getByLabel("Which class is it for?")).toHaveValue(String(id));
  await drawer().getByRole("button", { name: "Cancel" }).click();
});

test("switching a material off takes it from the class page and the student's list; the list fits a phone", async ({ browser }) => {
  await admin.goto("/admin/materials");
  const row = admin.getByRole("row").filter({ hasText: "Tools sheet" });
  await row.locator("label.switch").click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await expect(row).toContainText("Hidden");
  const visitor = await browser.newContext({ locale: "en-US" });
  const vp = await visitor.newPage();
  await vp.goto(`/en/courses/${CLASS_SLUG}`);
  await expect(vp.locator("section[aria-labelledby=inc-h]")).not.toContainText("Tools sheet");
  await expect(vp.locator("section[aria-labelledby=inc-h]")).not.toContainText("1 useful link");
  await student.goto(`/app/learn/${CLASS_SLUG}`);
  await expect(student.locator(".mat-card")).toHaveCount(3);
  await row.locator("label.switch").click();
  await expect(row).toContainText("Shown");
  await visitor.close();

  const phone = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await useLang(phone, "en");
  const pp = await phone.newPage();
  await adminLogin(pp);
  await pp.goto("/admin/materials");
  await expect(pp.getByRole("heading", { level: 1, name: "Materials" })).toBeVisible();
  expect(await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await student.goto(`/app/learn/${CLASS_SLUG}`);
  await student.setViewportSize({ width: 360, height: 740 });
  expect(await student.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await phone.close();
});
