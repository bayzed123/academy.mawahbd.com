import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, uniquePhone, useLang } from "./helpers";

/*
 * Text messages and students known only by a mobile number — as the owner sees them. The SMS company cannot be reached from a test, so the
 * site is in its "test mode" here: messages are kept in a box instead of sent, and Settings → SMS says so. What is checked is what the owner
 * needs to find and trust: where to set it up, what each screen says, that nothing secret is shown, and that a student with no e-mail can be
 * added, found, given a way in by text, and never shows a made-up address. Runs after the admin spec (the owner exists).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
});
test.afterAll(async () => admin.context().close());

const outbox = async (to: string) => (await apiGet<{ messages: { text: string; sms?: boolean }[] }>(admin, `/dev/outbox?to=${encodeURIComponent(to)}`)).messages;

test("Settings → SMS: says what is connected, keeps the sender name, and sends a test message to the number typed", async () => {
  await admin.goto("/admin/settings?tab=sms");
  await expect(admin.getByRole("heading", { name: "Text messages (SMS)" })).toBeVisible();
  // this copy of the site has no SMS secrets: it is in test mode, and says so (and where to add the two secrets)
  await expect(admin.getByText("Test mode", { exact: true })).toBeVisible();
  await expect(admin.getByText("Key (SMS_API_KEY)")).toBeVisible();
  await expect(admin.getByText("Address (SMS_API_URL)")).toBeVisible();
  await expect(admin.getByText("No message sent yet")).toBeVisible();

  // the sender name is saved and comes back; a name the company cannot take is refused with the reason
  await admin.getByLabel("Sender name (sender ID)").fill("MAWAH");
  await admin.getByRole("button", { name: "Save" }).first().click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await admin.reload();
  await expect(admin.getByLabel("Sender name (sender ID)")).toHaveValue("MAWAH");
  await admin.getByLabel("Sender name (sender ID)").fill("not<valid>");
  await admin.getByRole("button", { name: "Save" }).first().click();
  await expect(admin.getByRole("alert").first()).toBeVisible();
  await admin.getByLabel("Sender name (sender ID)").fill("MAWAH");
  await admin.getByRole("button", { name: "Save" }).first().click();

  // a test message to a number: refused when it is not a number, kept (test mode) when it is
  const phone = uniquePhone();
  await admin.getByLabel("Send a test message to this number").fill("12345");
  await admin.getByRole("button", { name: "Send test message" }).click();
  await expect(admin.getByText("valid mobile number").first()).toBeVisible();
  await admin.getByLabel("Send a test message to this number").fill(phone);
  await admin.getByRole("button", { name: "Send test message" }).click();
  await expect(admin.getByText("Test mode: the message was kept, not sent.")).toBeVisible();
  await expect.poll(async () => (await outbox(phone)).some((m) => m.sms && /test message/.test(m.text))).toBe(true);

  // checking the credit without the secrets says what to do, in plain words
  await admin.getByRole("button", { name: "Check my SMS credit" }).click();
  await expect(admin.getByRole("alert").filter({ hasText: "SMS is not connected yet" })).toBeVisible();
  await expect(admin.getByText("SMS_API_KEY", { exact: false }).first()).toBeVisible();

  // nothing secret anywhere on the screen
  await expect(admin.locator("body")).not.toContainText(/api[_-]?key\s*[:=]\s*\S{12,}/i);
  const axe = await new AxeBuilder({ page: admin }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
});

test("the dashboard has an SMS card that links to the settings", async () => {
  await admin.goto("/admin/");
  const card = admin.locator(".health-card", { hasText: "SMS" });
  await expect(card).toBeVisible();
  await card.click();
  await expect(admin).toHaveURL(/\/admin\/settings\?tab=sms/);
  await expect(admin.getByRole("heading", { name: "Text messages (SMS)" })).toBeVisible();
});

test("a student known only by a mobile number can be added, found by the number, and given a way in by text message", async () => {
  const phone = uniquePhone();
  await admin.goto("/admin/students?add=1");
  const drawer = admin.getByRole("dialog", { name: "Add a student" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Full name").fill("Old Student");
  // the e-mail box says it may stay empty
  await expect(drawer.getByText("Can be left empty if you write a mobile number")).toBeVisible();

  // neither an e-mail nor a number: the form says one of them is needed
  await drawer.getByRole("button", { name: "Add student" }).click();
  await expect(drawer.getByText("Write an e-mail or a mobile number.")).toBeVisible();

  await drawer.getByLabel("Mobile number").fill(phone);
  await drawer.getByLabel("Address", { exact: true }).fill("Madhubagh, Moghbazar, Dhaka");
  await drawer.getByRole("button", { name: "Add student" }).click();
  await expect(drawer.getByText("Old Student was added.")).toBeVisible();

  // a way in: a text to the number (there is no e-mail to send to), or a link to pass on
  await expect(drawer.getByRole("button", { name: "E-mail a link to choose a password" })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Text a link to choose a password" }).click();
  await expect.poll(async () => (await outbox(phone)).some((m) => m.sms && /(Choose a password|পাসওয়ার্ড দিতে)/.test(m.text))).toBe(true);

  // found by the number, listed with the number where the e-mail would be, and the made-up address is nowhere
  await admin.goto(`/admin/students?q=${phone}`);
  const row = admin.getByRole("row", { name: /Old Student/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText(phone);
  await expect(admin.locator("body")).not.toContainText("no-email.invalid");
  await row.click();
  const page = admin.getByRole("dialog");
  await expect(page).toContainText("No e-mail (signs in with the mobile number)");
  await expect(page).toContainText("Madhubagh");
  await expect(page.getByRole("button", { name: "Text a link to choose a password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "E-mail a link to choose a password" })).toHaveCount(0);
  await admin.keyboard.press("Escape");

  // the same number twice is refused, with the reason on the number
  await admin.goto("/admin/students?add=1");
  const again = admin.getByRole("dialog", { name: "Add a student" });
  await again.getByLabel("Full name").fill("Same Number");
  await again.getByLabel("Mobile number").fill(phone);
  await again.getByRole("button", { name: "Add student" }).click();
  await expect(again.getByText("is already here")).toBeVisible();
});

test("importing a list: a line with only a mobile number is accepted, a line with neither is explained", async () => {
  const phone = uniquePhone();
  const sheet = ["name,email,phone,address", `Phone Only,,${phone},"Road 4, Mirpur, Dhaka"`, "Nothing Given,,,"].join("\n");
  await admin.goto("/admin/students/import");
  await expect(admin.getByText("Only the name and either an e-mail or a mobile number are needed")).toBeVisible();
  await admin.getByLabel("Paste here: copy the cells in your sheet, including the first line").fill(sheet);
  await admin.getByRole("button", { name: "Check my list" }).click();
  await expect(admin.getByText("1 new")).toBeVisible();
  await expect(admin.getByText("1 with a problem")).toBeVisible();
  await expect(admin.getByText("needs an e-mail or a mobile number")).toBeVisible();
  await expect(admin.locator("body")).not.toContainText("no-email.invalid");

  await admin.getByRole("button", { name: "Add 1 lines" }).click();
  await expect(admin.getByText("Done", { exact: true })).toBeVisible();
  await expect(admin.getByText(/1 new students added/)).toBeVisible();

  const found = (await apiGet<{ items: { name: string; email: string; address: string }[] }>(admin, `/admin/students?q=${phone}`)).items;
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ name: "Phone Only", email: "", address: "Road 4, Mirpur, Dhaka" });
});
