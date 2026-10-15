import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiPost, registerStudent, STAFF, uniqueEmail, useLang } from "./helpers";

/*
 * Buying without an account. The owner's worry: a buyer sent to a log-in page first is a buyer lost. So a visitor gives a name, a mobile
 * number and an e-mail, pays, and is in — the student profile (with its own ID) is made for them, and the receipt carries the link to choose
 * a password for other phones. What must never happen: typing the e-mail of an existing student opens that student's classes.
 * Runs after the admin spec (the owner exists).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  void STAFF;
});
test.afterAll(async () => admin.context().close());

async function visitor(browser: Browser, over: Parameters<Browser["newContext"]>[0] = {}) {
  const ctx = await browser.newContext({ locale: "en-US", ...over });
  await useLang(ctx, "en");
  return { ctx, page: await ctx.newPage() };
}

const orderBox = async (to: string) => (await apiGet<{ messages: { subject: string; text: string }[] }>(admin, `/dev/outbox?to=${encodeURIComponent(to)}`)).messages;
const adminOrders = async (email: string) => (await apiGet<{ items: { status: string; customer_name: string; customer_phone: string; id: number }[] }>(admin, `/admin/orders?q=${encodeURIComponent(email)}`)).items;
const adminStudents = async (email: string) => (await apiGet<{ items: { email: string; enrollments: number }[] }>(admin, `/admin/students?q=${encodeURIComponent(email)}`)).items;

async function fillDetails(page: Page, d: { name: string; phone: string; email: string }) {
  await page.getByLabel("Full name", { exact: true }).fill(d.name);
  await page.getByLabel("Mobile number", { exact: true }).fill(d.phone);
  await page.getByLabel("E-mail", { exact: true }).fill(d.email);
}

test("a visitor buys with a name, a number and an e-mail — no log-in — and the class opens on that phone, with a student ID", async ({ browser }) => {
  const { ctx, page } = await visitor(browser);
  const email = uniqueEmail("guest");
  await page.goto("/en/courses/beginners-baking-class");
  await expect(page.getByText("No log-in needed — just your name, number and e-mail").first()).toBeVisible();
  await page.getByRole("link", { name: /Enroll Now/ }).first().click();
  // straight to the checkout: no log-in page in between
  await expect(page).toHaveURL(/\/app\/checkout\?c=beginners-baking-class/);
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible(); // "Already a student?" and the header both offer it

  // nothing typed: the form says what is missing and nothing is created
  await page.getByText("Test payment").click();
  await page.getByRole("button", { name: /Pay ৳400/ }).click();
  await expect(page.getByText("This field is required.")).toHaveCount(3);
  expect((await apiGet<{ student: unknown }>(page, "/auth/me")).student).toBeNull();

  await fillDetails(page, { name: "Nusrat Jahan", phone: "01712345678", email });
  await page.getByRole("button", { name: /Pay ৳400/ }).click();
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();

  // signed in as the person they typed, with their own student ID and a prompt to keep the account
  await expect(page.locator(".user-menu summary")).toContainText("Nusrat");
  await expect(page.getByText("Keep your account")).toBeVisible();
  const code = (await page.locator(".keep-account .student-code").textContent())!.trim();
  expect(code).toMatch(/^STU-\d{6,}$/);
  await page.getByRole("link", { name: "Start learning" }).click();
  await expect(page.getByRole("heading", { name: "Beginners Baking Class" })).toBeVisible();

  // the owner: the payment is there with the details typed, and the buyer is now a student
  const orders = await adminOrders(email);
  expect(orders[0]).toMatchObject({ status: "paid", customer_name: "Nusrat Jahan", customer_phone: "01712345678" });
  const students = await adminStudents(email);
  expect(students).toHaveLength(1);
  expect(students[0].enrollments).toBe(1);

  // the receipt: the student ID and a link to choose a password; opened on another phone it asks for one and signs that phone in
  await expect.poll(async () => (await orderBox(email)).some((m) => /enrollment is confirmed/.test(m.subject))).toBe(true);
  const receipt = (await orderBox(email)).find((m) => /enrollment is confirmed/.test(m.subject))!;
  expect(receipt.text).toContain(code);
  const link = receipt.text.match(/\/app\/reset\/[A-Za-z0-9_-]+/)![0];
  const other = await visitor(browser);
  await other.page.goto(link);
  await expect(other.page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await other.page.getByLabel("New password").fill("my-first-password-9");
  await other.page.getByRole("button", { name: "Save" }).click();
  await expect(other.page.getByRole("heading", { name: "My Learning" })).toBeVisible();
  await expect(other.page.getByText("Beginners Baking Class")).toBeVisible();
  await expect(other.page.getByText("Keep your account")).toHaveCount(0); // it has a password now
  await other.page.goto("/app/profile");
  await expect(other.page.getByLabel("Student ID")).toHaveValue(code);
  await other.ctx.close();

  // someone who bought and then tries to "register" with the same e-mail is told their account is ready, not left at a dead end
  const again = await visitor(browser);
  await again.page.goto("/app/register");
  await again.page.getByLabel("Full name").fill("Nusrat Jahan");
  await again.page.getByLabel(/^Email/).fill(email);
  await again.page.getByLabel(/^Password/).fill("another-password-9");
  await again.page.getByRole("button", { name: "Sign up" }).click();
  await expect(again.page.locator("#email-err")).toHaveText("An account with this email already exists.");
  await expect(again.page.getByText("Bought a class here before?")).toBeVisible();
  await expect(again.page.getByRole("link", { name: "Forgot your password?" })).toBeVisible();
  await again.ctx.close();
  await ctx.close();
});

test("an e-mail that already belongs to a student is not opened: the buyer signs in on the spot and the payment goes on", async ({ browser }) => {
  // a registered student, with a password of their own
  const reg = await visitor(browser);
  const made = await registerStudent(reg.page, { name: "Another One" });
  await reg.ctx.close();

  const { ctx, page } = await visitor(browser);
  await page.goto("/app/checkout?c=beginners-baking-class");
  await fillDetails(page, { name: "Someone Else", phone: "01812345678", email: made.email });
  await page.getByText("Test payment").click();
  await page.getByRole("button", { name: /Pay ৳400/ }).click();

  const panel = page.getByRole("region", { name: "You already have an account" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(made.email);
  // nothing was opened for the person who only typed the address
  expect((await apiGet<{ student: unknown }>(page, "/auth/me")).student).toBeNull();
  expect(await adminOrders(made.email)).toHaveLength(0);

  await panel.getByLabel("Password").fill("not-the-password-1");
  await panel.getByRole("button", { name: "Sign in and continue" }).click();
  await expect(panel.getByRole("alert")).toContainText("Wrong email or password.");
  await panel.getByLabel("Password").fill(made.password);
  await panel.getByRole("button", { name: "Sign in and continue" }).click();

  // signed in as the owner of the account, and the payment carries on without asking again
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await expect(page.locator(".user-menu summary")).toContainText("Another");
  await expect(page.getByText("Keep your account")).toHaveCount(0); // this account already has a password
  const orders = await adminOrders(made.email);
  expect(orders[0]).toMatchObject({ status: "paid", customer_name: "Another One" }); // the account's own name, not the typed one
  await ctx.close();
});

test("a visitor who started to buy and came back on another phone gets the same account — and is not asked to sign in", async ({ browser }) => {
  const email = uniqueEmail("comeback");
  const first = await visitor(browser);
  await first.page.goto("/app/checkout?c=beginners-baking-class");
  await fillDetails(first.page, { name: "First Try", phone: "01911111111", email });
  await first.page.getByText("Test payment").click();
  await first.page.getByRole("button", { name: /Pay ৳400/ }).click();
  await expect(first.page.getByRole("button", { name: "Simulate successful payment" })).toBeVisible(); // reached the payment page, did not pay
  expect(await adminStudents(email)).toHaveLength(0); // not a student yet: nothing paid
  expect((await adminOrders(email))[0]).toMatchObject({ status: "pending", customer_name: "First Try", customer_phone: "01911111111" });

  // the owner can follow up: the order shows a WhatsApp link to the number they typed, with the message already written
  await admin.goto(`/admin/orders?q=${encodeURIComponent(email)}`);
  await admin.getByRole("row", { name: new RegExp(email) }).click();
  const followUp = admin.getByRole("link", { name: "Follow up on WhatsApp" });
  await expect(followUp).toBeVisible();
  const wa = await followUp.getAttribute("href");
  expect(wa).toMatch(/^https:\/\/wa\.me\/8801911111111\?text=/);
  expect(decodeURIComponent(wa!.split("?text=")[1])).toContain("First");

  const second = await visitor(browser);
  await second.page.goto("/app/checkout?c=beginners-baking-class");
  await fillDetails(second.page, { name: "Second Try", phone: "01922222222", email });
  await second.page.getByText("Test payment").click();
  await second.page.getByRole("button", { name: /Pay ৳400/ }).click();
  await expect(second.page.getByText("You already have an account")).toHaveCount(0);
  await second.page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(second.page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();

  const orders = await adminOrders(email);
  expect(orders.map((o) => o.status).sort()).toEqual(["paid", "pending"]); // the first online attempt is left to the housekeeping job (a payment may still arrive for it)
  expect(orders.find((o) => o.status === "paid")).toMatchObject({ customer_name: "Second Try", customer_phone: "01922222222" });
  expect(await adminStudents(email)).toHaveLength(1);
  await first.ctx.close();
  await second.ctx.close();
});

test("a free class: details, one button, enrolled — and the profile exists", async ({ browser }) => {
  const { ctx, page } = await visitor(browser);
  const email = uniqueEmail("free");
  await page.goto("/app/checkout?c=free-taster-class");
  await expect(page.getByText("This class is free")).toBeVisible();
  await fillDetails(page, { name: "Free Learner", phone: "01612345678", email });
  await page.getByRole("button", { name: "Enroll for free" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await page.goto("/app/");
  await expect(page.getByText("Free Taster Class")).toBeVisible();
  expect((await adminStudents(email))[0].enrollments).toBe(1);
  await ctx.close();
});

test("a send-money payment as a visitor: details first, then the open order with its countdown, proof, and the owner's approval opens the class", async ({ browser }) => {
  const { ctx, page } = await visitor(browser);
  const email = uniqueEmail("sendmoney");
  await page.goto("/app/checkout?c=traditional-aurosh-biryani-online-class");
  await fillDetails(page, { name: "Send Money", phone: "01712121212", email });
  await page.getByText("Send money manually").click();
  await page.getByLabel("Your number — the one you will send money from").fill("01712121212");
  await page.getByRole("button", { name: "Continue — show payment details" }).click();
  await expect(page).toHaveURL(/\/app\/orders\/[a-z2-7]{20}/);
  await expect(page.getByRole("timer")).toContainText(/left to pay/);
  await page.getByLabel("Transaction ID (TrxID)").fill("G7H8J9K1L2");
  await page.getByRole("button", { name: "I have paid — send for checking" }).click();
  await expect(page.getByRole("heading", { name: "We are verifying your payment" })).toBeVisible();

  // staff see a payment waiting, with the visitor's details; approving opens the class on the phone that is still signed in
  const waiting = (await adminOrders(email))[0];
  expect(waiting).toMatchObject({ status: "awaiting_verification", customer_name: "Send Money" });
  expect((await apiPost(admin, `/admin/orders/${waiting.id}/approve`, {})).status).toBe(200);
  await page.goto("/app/");
  await expect(page.getByText("Traditional Aurosh Biryani Online Class")).toBeVisible();
  await expect(page.getByText("Keep your account")).toBeVisible();
  await ctx.close();
});

test("the details form reads well in Bangla, fits a 360 px phone and passes the accessibility scan", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await useLang(ctx, "bn");
  const page = await ctx.newPage();
  await page.goto("/app/checkout?c=beginners-baking-class");
  await expect(page.getByRole("heading", { name: "আপনার তথ্য" })).toBeVisible();
  await expect(page.getByLabel("পুরো নাম", { exact: true })).toBeVisible();
  await expect(page.getByLabel("মোবাইল নম্বর", { exact: true })).toBeVisible();
  await expect(page.getByLabel("ইমেইল", { exact: true })).toBeVisible();
  await page.getByText("টেস্ট পেমেন্ট").click();
  await page.getByRole("button", { name: /৳৪০০/ }).last().click();
  await expect(page.getByText("এই ঘরটি পূরণ করা আবশ্যক।")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  await ctx.close();
});
