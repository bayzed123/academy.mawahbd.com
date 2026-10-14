import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, adminSetup, apiGet, apiPost, PDF, PNG, randomPassword, registerStudent, STAFF, uniqueEmail, useLang } from "./helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
const nav = (name: string) => page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name, exact: true });
// a drawer has an "×" button in its header and a "Close" button in its footer — either closes it
const closeDrawer = () => page.getByRole("button", { name: "Close" }).last().click();

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  page = await ctx.newPage();
});
test.afterAll(async () => page.context().close());

test("first run: the one-time setup form creates the owner, then locks itself", async () => {
  await page.goto("/admin/");
  await expect(page.getByRole("heading", { name: "Create the first admin" })).toBeVisible();
  await adminSetup(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(", Owner");
  // the setup endpoint is now permanently closed
  const again = await apiPost(page, "/admin/auth/setup", { setup_token: "dev-setup-token", name: "Evil", email: "evil@e2e.test", password: randomPassword() });
  expect(again.status).toBe(409);
  // wrong password is rejected, and does not reveal whether the e-mail exists
  const other = await page.context().browser()!.newContext({ locale: "en-US" });
  await useLang(other, "en");
  const p2 = await other.newPage();
  await adminLogin(p2, { email: STAFF.email, password: "wrong-password" });
  await expect(p2.getByRole("alert")).toContainText("Wrong email or password");
  await other.close();
});

test("dashboard: honest numbers, health strip, first-run checklist and 'needs attention'", async () => {
  await page.goto("/admin/");
  await expect(page.getByRole("region", { name: "System health" })).toContainText("Database");
  await expect(page.getByRole("region", { name: "System health" }).getByText("Working").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "First steps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention today" })).toBeVisible();
  // 26 launch classes are published with no lessons yet: the dashboard says so instead of letting students find empty classes
  await expect(page.getByText("Published classes with no lessons yet")).toBeVisible();
  // nothing is invented: no sales yet => zero, not filler
  await expect(page.locator(".kpi").filter({ hasText: "Paid orders" })).toContainText("0");
  // every area of the sidebar is reachable for the Super Admin
  for (const name of ["Classes", "Instructors", "Orders", "Students", "Reviews", "Questions", "Blog", "Coupons", "Bundles", "Certificates", "Notify lists", "Messages", "AI Chatbot", "Reports", "Team", "Settings", "Activity log", "Help & guide"]) {
    await expect(nav(name)).toBeVisible();
  }
});

test("instructor with a photo: upload is compressed, stored by content hash and served", async () => {
  await nav("Instructors").click();
  await page.getByRole("button", { name: "+ Add" }).click();
  await page.getByLabel("Name (বাংলা) *").fill("শেফ রুমানা");
  await page.getByLabel("Name (English) *").fill("Chef Rumana");
  await page.getByLabel("Headline (English)").fill("Pastry chef");
  await page.getByLabel("Photo").setInputFiles({ name: "chef.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator(".thumb img")).toBeVisible();
  const src = await page.locator(".thumb img").getAttribute("src");
  expect(src).toMatch(/^\/media\/photos\/[a-f0-9]{32}\.(png|webp)$/);
  expect((await page.request.get(src!)).status()).toBe(200);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Chef Rumana/ })).toBeVisible();
});

test("settings validate on the server and apply immediately", async () => {
  await nav("Settings").click();
  await page.getByLabel("WhatsApp number").fill("01711112222");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Saved.")).toBeVisible();
  // analytics IDs are injected into pages: junk is refused
  await page.getByRole("tab", { name: "Analytics" }).click();
  await page.getByLabel("Microsoft Clarity").fill('abc"onload=x');
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.getByLabel("Microsoft Clarity").fill("");
  // payments: manual send-money needs a receiving number before students can use it
  await page.getByRole("tab", { name: "Payments" }).click();
  await page.getByLabel("bKash number to receive money").fill("01799990000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
});

test("create a class, add curriculum + a downloadable file, reorder, and the publish-without-lessons guard", async () => {
  await nav("Classes").click();
  await page.getByRole("button", { name: "+ Add" }).click();
  await expect(page).toHaveURL(/\/admin\/courses\/new/);
  await page.getByLabel("Title (বাংলা) *").fill("পিৎজা মাস্টারক্লাস");
  await page.getByLabel("Title (English) *").fill("Pizza Masterclass E2E");
  await page.getByLabel("Short description (English)").fill("Make pizza at home.");
  await page.getByLabel("Price").fill("750");
  await page.getByLabel("Status").selectOption("published");
  await page.getByRole("button", { name: "Save" }).click();
  // a published class with no lessons asks for confirmation: students who pay would find it empty
  await expect(page.getByRole("alertdialog")).toContainText("This class has no lessons yet");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByLabel("Status").selectOption("draft");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/admin\/courses\/\d+\?tab=curriculum/);

  // module
  await page.getByRole("button", { name: "+ Add module" }).click();
  await page.getByLabel("Title (বাংলা) *").fill("ডো তৈরি");
  await page.getByLabel("Title (English) *").fill("Dough");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Dough" })).toBeVisible();

  // lesson 1 (written notes) + a PDF recipe card
  await page.getByRole("button", { name: "+ Add lesson" }).click();
  await page.getByRole("radio", { name: "Written notes" }).click();
  await page.getByLabel("Title (বাংলা) *").fill("উপকরণ");
  await page.getByLabel("Title (English) *").fill("Ingredients");
  await page.getByLabel("Lesson content — English").fill("## You need\n- flour\n- yeast");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Lesson saved — you can now attach files.")).toBeVisible();
  await page.getByLabel("Add a file").setInputFiles({ name: "recipe-card.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByRole("link", { name: "recipe-card.pdf" })).toBeVisible();
  // a non-PDF disguised as a PDF is refused by the server (magic-byte check)
  await page.getByLabel("Add a file").setInputFiles({ name: "evil.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ\u0000\u0000 not a pdf") });
  await expect(page.getByText("That file type is not allowed.")).toBeVisible();
  await closeDrawer();

  // lesson 2, then move it up
  await page.getByRole("button", { name: "+ Add lesson" }).click();
  await page.getByRole("radio", { name: "Written notes" }).click();
  await page.getByLabel("Title (বাংলা) *").fill("ময়দা মাখা");
  await page.getByLabel("Title (English) *").fill("Kneading");
  await page.getByLabel("Lesson content — English").fill("Knead for 10 minutes.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Lesson saved — you can now attach files.")).toBeVisible();
  await closeDrawer();
  const titles = () => page.locator(".lessons .lesson-title").allTextContents();
  expect(await titles()).toEqual(["Ingredients", "Kneading"]);
  await page.locator(".lessons li").nth(1).getByRole("button", { name: "Move up" }).click();
  await expect.poll(titles).toEqual(["Kneading", "Ingredients"]);

  // publish: now it has lessons, so no warning
  await page.getByRole("tab", { name: "Details" }).click();
  await page.getByLabel("Status").selectOption("published");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const res = await page.request.get("/api/courses/pizza-masterclass-e2e");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.course.price).toBe(750);
  expect(JSON.stringify(body.curriculum)).toContain("Kneading"); // titles only
  expect(JSON.stringify(body.curriculum)).not.toContain("flour"); // never the lesson content
});

test("manual payment: the student waits, support verifies, access opens exactly once; refund closes it", async ({ browser }) => {
  // a student buys by manual send-money
  const sctx = await browser.newContext({ locale: "en-US" });
  await useLang(sctx, "en");
  const sp = await sctx.newPage();
  const { email } = await registerStudent(sp, { name: "Manual Payer" });
  await sp.goto("/app/checkout?c=pizza-masterclass-e2e");
  await sp.getByText("Send money manually").click();
  await expect(sp.locator(".num-list")).toContainText("01799990000"); // the number the owner entered in Settings
  await sp.getByLabel("Transaction ID (TrxID)").fill("8N7A6D5E4C");
  await sp.getByLabel("Number you sent from").fill("01712345678");
  await sp.getByRole("button", { name: "I have sent the money" }).click();
  await expect(sp.getByRole("heading", { name: "We are verifying your payment" })).toBeVisible();
  // a second order cannot reuse the same transaction id
  const dup = await apiPost(sp, "/checkout", { courses: ["pizza-masterclass-e2e"], channel: "manual", manual: { method: "bkash", trx_id: "8N7A6D5E4C", payer_number: "01712345678" } });
  expect([409, 400]).toContain(dup.status);

  // the dashboard counts it and the sidebar shows a badge
  await page.goto("/admin/orders?status=awaiting_verification");
  await expect(page.getByRole("cell", { name: email })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: /^Orders\s*1$/ })).toBeVisible(); // the sidebar badge counts it
  await page.getByRole("row", { name: new RegExp(email) }).click();
  await expect(page.getByText("Check this payment")).toBeVisible();
  await page.getByRole("button", { name: "Approve payment" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve payment" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.locator(".slide").getByText(/INV-MWH-\d{8}-\d{4}/).first()).toBeVisible();

  // student: now enrolled and can open the lesson
  await sp.goto("/app/");
  await expect(sp.getByRole("heading", { name: "Pizza Masterclass E2E" })).toBeVisible();
  await sp.goto("/app/learn/pizza-masterclass-e2e");
  await sp.getByRole("link", { name: "Ingredients" }).click();
  await expect(sp.getByText("You need")).toBeVisible();
  // the PDF is downloadable by the enrolled student, not by an anonymous visitor
  const resId = (await apiGet<{ lesson: { resources: { id: number }[] } }>(sp, `/student/lessons/${await sp.evaluate(() => location.pathname.split("/").pop())}`)).lesson.resources[0].id;
  expect((await sp.request.get(`/api/student/resources/${resId}/download`)).status()).toBe(200);
  const anon = await browser.newContext();
  expect((await anon.request.get(`/api/student/resources/${resId}/download`)).status()).toBe(401);
  await anon.close();

  // refund (Super Admin): access is closed
  await closeDrawer();
  await page.goto("/admin/orders?status=paid");
  await page.getByRole("row", { name: new RegExp(email) }).click();
  await page.getByRole("button", { name: "Refund" }).click();
  const dlg = page.getByRole("alertdialog");
  await expect(dlg.getByRole("button", { name: "Refund" })).toBeDisabled(); // a reason is mandatory
  await dlg.getByLabel("Reason").fill("Customer changed their mind");
  await dlg.getByRole("button", { name: "Refund" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await sp.goto("/app/learn/pizza-masterclass-e2e");
  await expect(sp.getByText("You are not enrolled in this class yet.")).toBeVisible();
  await sctx.close();
});

test("coming-soon notify list: visitors sign up, publishing emails them once", async ({ browser }) => {
  // create the class through the UI form
  await page.goto("/admin/courses/new");
  await page.getByLabel("Title (বাংলা) *").fill("শীঘ্রই আসছে ক্লাস");
  await page.getByLabel("Title (English) *").fill("Soon Class E2E");
  await page.getByLabel("Price").fill("500");
  await page.getByLabel("Status").selectOption("coming_soon");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/admin\/courses\/\d+\?tab=curriculum/);
  const courseId = Number(page.url().match(/courses\/(\d+)/)![1]);

  const vctx = await browser.newContext({ locale: "en-US" });
  const v = await vctx.newPage();
  await v.goto("/en/courses/soon-class-e2e");
  await expect(v.getByRole("link", { name: /Enroll Now/ })).toHaveCount(0); // no buy path for a class that is not open
  const email = uniqueEmail("waiting");
  await v.locator('form[action="/api/notify"]').first().getByRole("textbox").fill(email);
  await v.locator('form[action="/api/notify"]').first().getByRole("button").click();
  await expect(v.locator("[data-status]").first()).toContainText(/.+/);

  await nav("Notify lists").click();
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  await page.goto(`/admin/courses/${courseId}`);
  await page.getByLabel("Status").selectOption("published");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish anyway" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect
    .poll(async () => {
      const mails = await (await vctx.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`)).json();
      return mails.messages.length;
    })
    .toBe(1);
  await vctx.close();
});

test("team: a Support member gets a temporary password, must change it, and sees only what the role allows", async ({ browser }) => {
  await nav("Team").click();
  await page.getByRole("button", { name: "+ Add team member" }).click();
  const email = uniqueEmail("support");
  await page.getByLabel("Full name *").fill("Support Sam");
  await page.getByLabel("Email *").fill(email);
  await page.getByRole("dialog", { name: "Add team member" }).getByLabel("Role").selectOption("support");
  await page.getByRole("button", { name: "Create account" }).click();
  const temp = (await page.locator("code.secret").textContent())!.trim();
  expect(temp.length).toBeGreaterThanOrEqual(12);
  await page.getByRole("button", { name: "I have saved it" }).click();

  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const sp = await ctx.newPage();
  await adminLogin(sp, { email, password: temp });
  await expect(sp.getByRole("heading", { name: "Choose your own password" })).toBeVisible();
  await sp.getByLabel("Temporary password").fill(temp);
  await sp.getByLabel("New password").fill("my-own-long-secret-1");
  await sp.getByRole("button", { name: "Save" }).click();
  const snav = sp.getByRole("navigation", { name: "Admin" });
  await expect(snav.getByRole("link", { name: /^Orders/ })).toBeVisible();
  await expect(snav.getByRole("link", { name: "Team", exact: true })).toHaveCount(0);
  await expect(snav.getByRole("link", { name: "Settings", exact: true })).toBeVisible(); // read-only for Support
  // direct URL access is refused, not just hidden
  await sp.goto("/admin/staff");
  await expect(sp.getByRole("heading", { name: "You do not have permission to do this." })).toBeVisible();
  expect((await apiPost(sp, "/admin/orders/1/refund", { reason: "x" })).status).toBe(403);
  await ctx.close();

  // deactivating ends their access immediately
  await page.goto("/admin/staff");
  await page.getByRole("row", { name: /Support Sam/ }).getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByRole("row", { name: /Support Sam/ })).toContainText("Deactivated");
});

test("AI chatbot screen: a saved key is masked and never shown again; a failing test is reported honestly", async () => {
  await nav("AI Chatbot").click();
  const gemini = page.locator(".provider").filter({ hasText: "Google Gemini" });
  await gemini.getByLabel("API key").fill("fake-e2e-key-not-a-secret-0123456789");
  await gemini.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Key saved securely.")).toBeVisible();
  await expect(gemini).toContainText("ends with ••••6789");
  await expect(page.locator("body")).not.toContainText("fake-e2e-key-not-a-secret");
  expect(await page.content()).not.toContain("fake-e2e-key-not-a-secret");
  // the connection test runs a real round trip: offline here, so it must fail visibly (never pretend to work)
  await gemini.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/Test failed/)).toBeVisible();
  await expect(gemini).toContainText("Last test");
});

test("reports, activity log, CSV exports and the help centre", async () => {
  await nav("Reports").click();
  await expect(page.getByRole("heading", { name: "Revenue over time" })).toBeVisible();
  // the only sale so far was refunded, so the report says exactly that: no revenue, one refund, no chart of nothing
  await expect(page.locator(".kpi").filter({ hasText: "Revenue" })).toContainText("৳0");
  await expect(page.locator(".kpi").filter({ hasText: "Refunds" })).toContainText("৳750 (1)");
  await expect(page.getByText("No data for this period.").first()).toBeVisible();
  const csv = await page.request.get("/api/admin/orders/export.csv");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect([...(await csv.body()).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

  await nav("Activity log").click();
  await expect(page.getByRole("cell", { name: /staff\.setup/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /order\.approved/ })).toBeVisible();

  await nav("Help & guide").click();
  await expect(page.getByText("What should I do first?")).toBeVisible();
});

test("admin accessibility: no serious or critical axe violations on the main screens", async () => {
  for (const path of ["/admin/", "/admin/courses", "/admin/orders", "/admin/settings", "/admin/chatbot"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 140)}`)).toEqual([]);
  }
});
