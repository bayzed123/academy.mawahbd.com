import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, agree, apiGet, apiPost, apiSend, registerStudent, STAFF, TEST_ADDRESS, uniqueEmail, uniquePhone, useLang } from "./helpers";

/*
 * Buying without an account. The owner's worry: a buyer sent to a log-in page first is a buyer lost. So a visitor gives a name, a mobile
 * number and an address (an e-mail only if they want to), pays, and is in — the student profile (with its own ID) is made for them, and the
 * receipt carries the link to choose a password for other phones. A buyer with no e-mail is known by the number and texted instead.
 * What must never happen: typing the e-mail (or the number) of an existing student opens that student's classes.
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

/** Name, mobile number and address are asked for; the e-mail only if `email` is given (it is optional). */
async function fillDetails(page: Page, d: { name: string; phone: string; email?: string; address?: string }) {
  await page.getByLabel(/^Full name/).fill(d.name);
  await page.getByLabel(/^Mobile number/).fill(d.phone);
  await page.getByLabel(/^Address/).fill(d.address ?? TEST_ADDRESS);
  if (d.email) await page.getByLabel(/^E-mail/).fill(d.email);
}

test("a visitor buys with a name, a number, an address and an e-mail — no log-in — and the class opens on that phone, with a student ID", async ({ browser }) => {
  const { ctx, page } = await visitor(browser);
  const email = uniqueEmail("guest");
  await page.goto("/en/courses/beginners-baking-class");
  await expect(page.getByText("No log-in needed — just your name, number and address").first()).toBeVisible();
  await page.getByRole("link", { name: /Enroll Now/ }).first().click();
  // straight to the checkout: no log-in page in between
  await expect(page).toHaveURL(/\/app\/checkout\?c=beginners-baking-class/);
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible(); // "Already a student?" and the header both offer it

  // nothing typed: the form says what is missing and nothing is created
  await page.getByText("Test payment").click();
  await agree(page);
  await page.getByRole("button", { name: /Pay ৳400/ }).click();
  await expect(page.getByText("This field is required.")).toHaveCount(3);
  expect((await apiGet<{ student: unknown }>(page, "/auth/me")).student).toBeNull();

  await fillDetails(page, { name: "Nusrat Jahan", phone: "01712345678", email });
  await agree(page);
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
  expect((await apiGet<{ items: { customer_address: string }[] }>(admin, `/admin/orders?q=${encodeURIComponent(email)}`)).items[0].customer_address).toBe(TEST_ADDRESS);
  const students = await adminStudents(email);
  expect(students).toHaveLength(1);
  expect(students[0].enrollments).toBe(1);

  // the receipt: the student ID and a link to choose a password; opened on another phone it asks for one and signs that phone in
  await expect.poll(async () => (await orderBox(email)).some((m) => /enrollment is confirmed/.test(m.subject))).toBe(true);
  const receipt = (await orderBox(email)).find((m) => /enrollment is confirmed/.test(m.subject))!;
  expect(receipt.text).toContain(code);
  // …and the same news by text message to the number
  await expect.poll(async () => (await orderBox("01712345678")).some((m) => m.text.includes(code))).toBe(true);
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
  await expect(again.page.locator("#email-err")).toContainText("An account with this email already exists.");
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
  await agree(page);
  await page.getByRole("button", { name: /Pay ৳400/ }).click();

  const panel = page.getByRole("region", { name: "You already have an account" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(made.email);
  // nothing was opened for the person who only typed the address
  expect((await apiGet<{ student: unknown }>(page, "/auth/me")).student).toBeNull();
  expect(await adminOrders(made.email)).toHaveLength(0);

  await panel.getByLabel("Password").fill("not-the-password-1");
  await panel.getByRole("button", { name: "Sign in and continue" }).click();
  await expect(panel.getByRole("alert")).toContainText("Wrong sign-in details");
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
  await agree(first.page);
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
  await agree(second.page);
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
  await agree(page);
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
  await agree(page);
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
  await expect(page.getByLabel(/^পুরো নাম/)).toBeVisible();
  await expect(page.getByLabel(/^মোবাইল নম্বর/)).toBeVisible();
  await expect(page.getByLabel(/^ঠিকানা/)).toBeVisible();
  await expect(page.getByLabel(/^ইমেইল \(ঐচ্ছিক\)/)).toBeVisible();
  await page.getByText("টেস্ট পেমেন্ট").click();
  await page.getByRole("button", { name: /৳৪০০/ }).last().click();
  await expect(page.getByText("এই ঘরটি পূরণ করা আবশ্যক।")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  await ctx.close();
});

test("no e-mail at all: a visitor gives a name, a number and an address, is texted, and signs in with the number or the student ID", async ({ browser }) => {
  const { ctx, page } = await visitor(browser);
  const phone = uniquePhone();
  await page.goto("/app/checkout?c=beginners-baking-class");
  // the e-mail box says it is optional; the other three say they are needed
  await expect(page.getByLabel(/^E-mail \(optional\)/)).toBeVisible();
  for (const label of [/^Full name/, /^Mobile number/, /^Address/]) await expect(page.getByLabel(label)).toHaveAttribute("aria-required", "true");

  await fillDetails(page, { name: "Tania Rahman", phone });
  await page.getByText("Test payment").click();
  await agree(page);
  await page.getByRole("button", { name: /Pay ৳400/ }).click();
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await expect(page.locator(".user-menu summary")).toContainText("Tania");
  const code = (await page.locator(".keep-account .student-code").textContent())!.trim();
  expect(code).toMatch(/^STU-\d{6,}$/);

  // the owner sees a student with no e-mail — never the made-up address — and the address that was typed
  const students = (await apiGet<{ items: { email: string; address: string; phone: string; enrollments: number }[] }>(admin, `/admin/students?q=${phone}`)).items;
  expect(students).toHaveLength(1);
  expect(students[0]).toMatchObject({ email: "", address: TEST_ADDRESS, phone, enrollments: 1 });
  await admin.goto(`/admin/students?q=${phone}`);
  const row = admin.getByRole("row", { name: /Tania Rahman/ });
  await expect(row).toContainText(code);
  await expect(row).toContainText(phone); // the number stands where the e-mail would be
  await expect(admin.locator("body")).not.toContainText("no-email.invalid");
  await row.click();
  await expect(admin.getByRole("dialog")).toContainText("No e-mail (signs in with the mobile number)");
  await expect(admin.getByRole("dialog")).toContainText("Dhanmondi");
  await expect(admin.getByRole("dialog")).not.toContainText("no-email.invalid");
  await admin.keyboard.press("Escape");

  // the receipt came by text message: the student ID, and a link to choose a password
  await expect.poll(async () => (await orderBox(phone)).some((m) => /payment received/.test(m.text))).toBe(true);
  const sms = (await orderBox(phone)).find((m) => /payment received/.test(m.text))!;
  expect(sms.text).toContain(code);
  const link = sms.text.match(/\/app\/reset\/[A-Za-z0-9_-]+/)![0];
  const other = await visitor(browser);
  await other.page.goto(link);
  await other.page.getByLabel("New password").fill("my-first-password-9");
  await other.page.getByRole("button", { name: "Save" }).click();
  await expect(other.page.getByRole("heading", { name: "My Learning" })).toBeVisible();
  await other.ctx.close();

  // later, on a fresh phone: the number, then the student ID, each with the password
  for (const who of [phone, code]) {
    const back = await visitor(browser);
    await back.page.goto("/app/login");
    await back.page.getByLabel("Mobile number, student ID or e-mail").fill(who);
    await back.page.getByLabel("Password").fill("my-first-password-9");
    await back.page.getByRole("button", { name: "Log in" }).last().click();
    await expect(back.page.getByRole("heading", { name: "My Learning" })).toBeVisible();
    await expect(back.page.getByText("Beginners Baking Class")).toBeVisible();
    await back.ctx.close();
  }

  // a forgotten password: ask by number, a 6-digit code comes by text message (no link in it), and the code changes it on the same page
  const forgot = await visitor(browser);
  await forgot.page.goto("/app/forgot");
  await forgot.page.getByLabel("Mobile number, student ID or e-mail").fill(phone);
  await forgot.page.getByRole("button", { name: "Send code" }).click();
  await expect(forgot.page.getByText("Check your messages")).toBeVisible();
  let text = "";
  await expect
    .poll(async () => {
      text = (await orderBox(phone)).map((m) => m.text).filter((t) => /password code is \d{6}/.test(t)).at(-1) ?? "";
      return text;
    })
    .toMatch(/password code is \d{6}/);
  expect(text).not.toMatch(/https?:|\/app\//);
  await forgot.page.getByLabel("6-digit code").fill(/(\d{6})/.exec(text)![1]);
  await forgot.page.getByLabel("New password").fill("my-second-password-9");
  await forgot.page.getByRole("button", { name: "Change password" }).click();
  await expect(forgot.page.getByRole("heading", { name: "My Learning" })).toBeVisible();
  await expect(forgot.page.getByText("Beginners Baking Class")).toBeVisible();
  await forgot.ctx.close();
  await ctx.close();
});

test("a number that already belongs to a student is not opened by typing it: the buyer is told to sign in", async ({ browser }) => {
  const phone = uniquePhone();
  const reg = await visitor(browser);
  await registerStudent(reg.page, { name: "Number Owner" });
  const mine = await apiGet<{ student: { name: string; phone: string; locale: string } }>(reg.page, "/auth/me");
  expect((await apiSend(reg.page, "PATCH", "/auth/profile", { name: mine.student.name, phone, address: TEST_ADDRESS, locale: mine.student.locale })).status).toBe(200);
  await reg.ctx.close();

  const { ctx, page } = await visitor(browser);
  await page.goto("/app/checkout?c=beginners-baking-class");
  await fillDetails(page, { name: "Someone Else", phone }); // no e-mail: the number is who they are
  await page.getByText("Test payment").click();
  await agree(page);
  await page.getByRole("button", { name: /Pay ৳400/ }).click();
  const panel = page.getByRole("region", { name: "You already have an account" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(phone);
  expect((await apiGet<{ student: unknown }>(page, "/auth/me")).student).toBeNull();
  await ctx.close();
});

test("a signed-in student with no address on file is asked for it — only for it — at checkout, and not again", async ({ browser }) => {
  const { ctx, page } = await visitor(browser);
  await registerStudent(page, { name: "No Address Yet", address: "" });
  await page.goto("/app/checkout?c=beginners-baking-class");
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  await expect(page.getByLabel(/^Full name/)).toHaveCount(0); // they have a name
  await expect(page.getByLabel(/^E-mail/)).toHaveCount(0); // and an e-mail
  await expect(page.getByLabel(/^Mobile number/)).toHaveValue("01712345678"); // the number on their profile
  await page.getByText("Test payment").click();
  await agree(page);
  await page.getByRole("button", { name: /Pay ৳400/ }).click();
  await expect(page.getByText("This field is required.")).toHaveCount(1);
  await page.getByLabel(/^Address/).fill("Flat 3, Road 1, Uttara, Dhaka");
  await agree(page);
  await page.getByRole("button", { name: /Pay ৳400/ }).click();
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();

  // kept on the profile for next time
  await page.goto("/app/profile");
  await expect(page.getByLabel(/^Address/)).toHaveValue("Flat 3, Road 1, Uttara, Dhaka");
  await page.goto("/app/checkout?c=free-taster-class");
  await expect(page.getByRole("heading", { name: "Your details" })).toHaveCount(0);
  await ctx.close();
});

test("a returning student whose profile has no address signs in in the middle of checkout: what was typed fills the gap, the payment goes on, nothing is asked twice", async ({ browser }) => {
  // a registered student with a password of their own, a number on file, and no address yet
  const reg = await visitor(browser);
  const made = await registerStudent(reg.page, { name: "Gap Filler", address: "" });
  await reg.ctx.close();

  const typedAddress = "Flat 9, Road 2, Mirpur, Dhaka";
  const { ctx, page } = await visitor(browser);
  await page.goto("/app/checkout?c=beginners-baking-class");
  await fillDetails(page, { name: "Someone Typed", phone: "01912345670", email: made.email, address: typedAddress });
  await page.getByText("Test payment").click();
  await agree(page);
  await page.getByRole("button", { name: /Pay ৳400/ }).click();

  const panel = page.getByRole("region", { name: "You already have an account" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Password").fill(made.password);
  await panel.getByRole("button", { name: "Sign in and continue" }).click();

  // no second stop to ask for the address again: the payment carries on with what was typed
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await expect(page.getByText("This field is required.")).toHaveCount(0);

  // the address typed above is now on the account (and on the order); the number already on file is kept, and so is the name
  const found = (await apiGet<{ items: { name: string; phone: string; address: string; enrollments: number }[] }>(admin, `/admin/students?q=${encodeURIComponent(made.email)}`)).items;
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ name: "Gap Filler", phone: "01712345678", address: typedAddress, enrollments: 1 });
  const orders = (await apiGet<{ items: { status: string; customer_address: string }[] }>(admin, `/admin/orders?q=${encodeURIComponent(made.email)}`)).items;
  expect(orders[0]).toMatchObject({ status: "paid", customer_address: typedAddress });
  await ctx.close();
});
