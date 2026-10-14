import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { apiGet, apiPost, registerStudent, uniqueEmail, useLang } from "./helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
let creds: { email: string; password: string };

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  page = await ctx.newPage();
});
test.afterAll(async () => page.context().close());

test("guests are sent to log in and brought back; registration, validation and logout work", async () => {
  await page.goto("/app/learn/beginners-baking-class");
  await expect(page).toHaveURL(/\/app\/login\?next=%2Flearn%2Fbeginners-baking-class/);

  // weak password / bad e-mail are rejected with readable messages
  await page.goto("/app/register");
  await page.getByLabel("Full name").fill("Rabeya Khatun");
  await page.getByLabel(/^Email/).fill("not-an-email");
  await page.getByLabel(/^Password/).fill("short");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Please enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();

  creds = await registerStudent(page, { name: "Rabeya Khatun" });
  await expect(page.getByRole("heading", { name: "My Learning" })).toBeVisible();
  await expect(page.getByText("You have not enrolled in any class yet")).toBeVisible();

  await page.locator(".user-menu summary").click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/app\/login/);
  await page.getByLabel(/^Email/).fill(creds.email);
  await page.getByLabel(/^Password/).fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).last().click();
  await expect(page.getByRole("alert")).toContainText("Wrong email or password");
  await page.getByLabel(/^Password/).fill(creds.password);
  await page.getByRole("button", { name: "Log in" }).last().click();
  await expect(page.getByRole("heading", { name: "My Learning" })).toBeVisible();
});

test("a free class enrolls instantly; finishing it issues a verifiable certificate", async () => {
  await page.goto("/app/checkout?c=free-taster-class");
  await expect(page.getByText("This class is free")).toBeVisible();
  await page.getByRole("button", { name: "Enroll for free" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "Start learning" }).click();
  await page.getByRole("link", { name: "Welcome" }).first().click();
  await page.getByRole("button", { name: "Mark as complete" }).click();
  await expect(page.getByText("Congratulations! Your certificate is ready.").first()).toBeVisible();

  await page.goto("/app/certificates");
  const code = (await page.locator(".cert-card code").first().textContent())!.trim();
  expect(code).toMatch(/^MWH-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // anyone can verify it on the public site (no login) — sloppy typing still works
  const anon = await page.context().browser()!.newContext();
  const vp = await anon.newPage();
  await vp.goto(`/en/verify/${code.toLowerCase().replaceAll("-", " ")}`);
  await expect(vp.getByText("This certificate is genuine")).toBeVisible();
  await expect(vp.locator("body")).toContainText("Rabeya Khatun");
  await vp.goto("/en/verify/MWH-ZZZZ-ZZZZ-ZZZZ");
  await expect(vp.getByText("No certificate was found for this code")).toBeVisible();
  await expect(vp.locator("body")).not.toContainText("Rabeya Khatun"); // a wrong code reveals nothing
  await anon.close();

  // printable certificate page, with a QR code that points at the verification URL
  await page.goto(`/en/certificate/${code}`);
  await expect(page.locator("svg").first()).toBeVisible();
  await expect(page.locator("body")).toContainText("Rabeya Khatun");
});

test("a paid class: test gateway -> webhook-confirmed enrollment -> lessons, progress, Q&A, review", async () => {
  await page.goto("/app/checkout?c=beginners-baking-class");
  await expect(page.getByText("৳400").first()).toBeVisible();
  // coupon: invalid then valid
  await page.getByLabel("Have a coupon code?").fill("NOPE");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("This coupon code is not valid.")).toBeVisible();
  await page.getByLabel("Have a coupon code?").fill("welcome10");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Coupon WELCOME10 applied.")).toBeVisible();
  await expect(page.locator(".sum-row.total")).toContainText("৳360"); // 10% off 400
  await page.getByText("Test payment").click();
  await page.getByRole("button", { name: /Pay ৳360/ }).click();
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await expect(page.locator("body")).toContainText(/INV-MWH-\d{8}-\d{4}/);

  await page.getByRole("link", { name: "Start learning" }).click();
  await expect(page.getByRole("heading", { name: "Beginners Baking Class" })).toBeVisible();
  await page.getByRole("link", { name: "Start" }).first().click();
  await expect(page.getByText("What you need")).toBeVisible();
  await page.getByRole("button", { name: "Mark as complete" }).click();
  await expect(page.getByRole("button", { name: "Completed" })).toBeVisible();

  // ask a question under the lesson
  await page.getByLabel("Ask a question").first().fill("Can I use salted butter?");
  await page.getByRole("button", { name: "Ask a question" }).click();
  await expect(page.getByText("Question sent. We will answer soon.")).toBeVisible();
  await expect(page.getByText("waiting for an answer")).toBeVisible();

  // review: only enrolled students can; it waits for the owner's approval
  await page.goto("/app/learn/beginners-baking-class");
  await page.getByRole("button", { name: "5" }).click();
  await page.getByLabel("Tell others what you liked (optional)").fill("Clear and easy to follow.");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Waiting for approval")).toBeVisible();
  const publicCourse = await (await page.request.get("/api/courses/beginners-baking-class")).json();
  expect(publicCourse.reviews).toHaveLength(0); // not public until approved
  expect(publicCourse.course.rating_count).toBe(0);
});

test("manual send-money: own number first, a countdown with our details, proof by TrxID, a WhatsApp message ready, a clear waiting state", async () => {
  await page.goto("/app/checkout?c=traditional-aurosh-biryani-online-class");
  await page.getByText("Send money manually").click();
  // step 1 asks only for the service and the student's own number; the owner's number appears once they commit
  await expect(page.getByText("You get our number and 20 minutes to send the money.")).toBeVisible();
  await expect(page.locator(".copy-row")).toHaveCount(0);
  await page.getByLabel("Your number — the one you will send money from").fill("123");
  await page.getByRole("button", { name: "Continue — show payment details" }).click();
  await expect(page.getByText("Please enter a valid Bangladeshi mobile number.")).toBeVisible();
  await page.getByLabel("Your number — the one you will send money from").fill("01712345678");
  await page.getByRole("button", { name: "Continue — show payment details" }).click();

  // the open order: the amount, the countdown, the owner's number to copy, the reference code
  await expect(page).toHaveURL(/\/app\/orders\/[a-z2-7]{20}/);
  await expect(page.getByRole("heading", { name: /^Send ৳[\d,]+ now$/ })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText(/(19|20):\d\d left to pay/);
  await expect(page.locator(".copy-row code").first()).toHaveText("01799990000");
  await expect(page.getByText("You are paying from 01712345678")).toBeVisible();

  // proof: nothing at all, then a TrxID that is not one, then the real one
  const send = page.getByRole("button", { name: "I have paid — send for checking" });
  await send.click();
  await expect(page.getByText("Enter the transaction ID or add a screenshot.")).toBeVisible();
  await page.getByLabel("Transaction ID (TrxID)").fill("x");
  await send.click();
  await expect(page.getByText("Please enter the transaction ID exactly as in the message.")).toBeVisible();
  await page.getByLabel("Transaction ID (TrxID)").fill("A1B2C3D4E5");
  await send.click();
  await expect(page.getByRole("heading", { name: "We are verifying your payment" })).toBeVisible();
  await expect(page.getByText("TrxID A1B2C3D4E5")).toBeVisible();

  // a WhatsApp message to the team is ready: the owner's number (typed 017… in Settings) with its country code, and the payment facts
  const wa = await page.getByRole("link", { name: "Send the details on WhatsApp too" }).getAttribute("href");
  expect(wa).toMatch(/^https:\/\/wa\.me\/8801711112222\?text=/);
  const text = decodeURIComponent(wa!.split("?text=")[1]);
  expect(text).toContain("TrxID: A1B2C3D4E5");
  expect(text).toContain("from 01712345678");
  expect(text).toMatch(/Order: [A-Z2-7]{8}/);
  expect(text).toContain("৳");

  await page.goto("/app/");
  await expect(page.getByText("Your payment is being verified")).toBeVisible();
  // the class stays locked until staff approve
  const locked = await apiGet<{ ok: boolean; error?: { code: string } }>(page, "/student/courses/traditional-aurosh-biryani-online-class");
  expect(locked.ok).toBe(false);
});

test("manual send-money: after the 20 minutes the page says so, and proof is still accepted (the money may already be on its way)", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const p = await ctx.newPage();
  await registerStudent(p, { name: "Late Payer" });
  const started = await apiPost(p, "/checkout", { courses: ["beginners-baking-class"], channel: "manual", manual: { method: "bkash", payer_number: "01812345678" } });
  expect(started.status).toBe(201);
  const id: string = started.body.order.public_id;
  await p.clock.install();
  await p.goto(`/app/orders/${id}`);
  await expect(p.getByRole("timer")).toContainText(/\d\d:\d\d left to pay/);
  await p.clock.fastForward("21:00");
  await expect(p.getByText("Time is up").first()).toBeVisible();
  await expect(p.getByRole("link", { name: "Start again" })).toBeVisible();
  await p.clock.resume();
  await p.getByLabel("Transaction ID (TrxID)").fill("LATE1234AB");
  await p.getByRole("button", { name: "I have paid — send for checking" }).click();
  await expect(p.getByRole("heading", { name: "We are verifying your payment" })).toBeVisible();
  await ctx.close();
});

test("a free preview lesson is watchable without an account, and leads to enrollment", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const p = await ctx.newPage();
  const detail = await (await p.request.get("/api/courses/beginners-baking-class")).json();
  const previewId = detail.curriculum[0].lessons.find((l: { is_preview: boolean }) => l.is_preview).id;
  await p.goto(`/app/preview/${previewId}?c=beginners-baking-class`);
  await expect(p.getByText("Free preview")).toBeVisible();
  await expect(p.getByText("What you need")).toBeVisible();
  // non-preview lessons stay private
  const lockedId = detail.curriculum[0].lessons.find((l: { is_preview: boolean }) => !l.is_preview).id;
  expect((await p.request.get(`/api/preview/lessons/${lockedId}`)).status()).toBe(401); // "log in", not the content
  expect((await p.request.get(`/api/student/lessons/${lockedId}`)).status()).toBe(401);
  await p.getByRole("link", { name: "Enroll Now" }).click();
  await expect(p).toHaveURL(/login/);
  await ctx.close();
});

test("language toggle switches the whole app to Bangla and remembers it", async () => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "বাংলা" }).click();
  await expect(page.getByRole("heading", { name: "আমার ক্লাস" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await page.reload();
  await expect(page.getByRole("heading", { name: "আমার ক্লাস" })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
});

test("profile: change password signs out other sessions; reset-by-email flow", async ({ browser }) => {
  const other = await browser.newContext({ locale: "en-US" });
  await useLang(other, "en");
  const op = await other.newPage();
  await op.goto("/app/login");
  await op.getByLabel(/^Email/).fill(creds.email);
  await op.getByLabel(/^Password/).fill(creds.password);
  await op.getByRole("button", { name: "Log in" }).last().click();
  await expect(op.getByRole("heading", { name: "My Learning" })).toBeVisible();

  await page.goto("/app/profile");
  await page.getByLabel("Current password").fill(creds.password);
  await page.getByLabel("New password").fill("brand-new-password-1");
  await page.getByRole("button", { name: "Save" }).last().click();
  await expect(page.getByText("Password changed.")).toBeVisible();
  creds.password = "brand-new-password-1";
  // the other device lost its session immediately
  expect((await op.request.get("/api/student/courses")).status()).toBe(401);
  await other.close();

  // forgot password: a link is emailed (dev outbox), it works once
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const fp = await ctx.newPage();
  await fp.goto("/app/forgot");
  await fp.getByLabel(/^Email/).fill(creds.email);
  await fp.getByRole("button", { name: "Send reset link" }).click();
  await expect(fp.getByText("Check your inbox")).toBeVisible();
  const mails = await (await fp.request.get(`/api/dev/outbox?to=${encodeURIComponent(creds.email)}`)).json();
  const link = mails.messages.map((m: { text: string }) => m.text.match(/https?:\/\/\S+\/app\/reset\/\S+/)?.[0]).find(Boolean) as string;
  expect(link).toBeTruthy();
  await fp.goto(new URL(link).pathname);
  await fp.getByLabel("New password").fill("after-reset-password-1");
  await fp.getByRole("button", { name: "Save" }).click();
  await expect(fp.getByText("Your password has been changed.")).toBeVisible();
  await fp.goto(new URL(link).pathname); // the same link cannot be used twice
  await fp.getByLabel("New password").fill("another-password-123");
  await fp.getByRole("button", { name: "Save" }).click();
  await expect(fp.getByRole("alert")).toBeVisible();
  await ctx.close();
});

test("student app accessibility: no serious or critical axe violations", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const p = await ctx.newPage();
  const email = uniqueEmail("a11y");
  await registerStudent(p, { email });
  // an open manual payment, so its screen (countdown, copy buttons, the file picker) is checked too
  const started = await apiPost(p, "/checkout", { courses: ["beginners-baking-class"], channel: "manual", manual: { method: "bkash", payer_number: "01712345678" } });
  expect(started.status).toBe(201);
  for (const path of ["/app/", "/app/profile", "/app/orders", "/app/checkout?c=beginners-baking-class", `/app/orders/${started.body.order.public_id}`, "/app/login"]) {
    if (path === "/app/login") {
      await p.locator(".user-menu summary").click();
      await p.getByRole("button", { name: "Log out" }).click();
    }
    await p.goto(path);
    await p.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 140)}`)).toEqual([]);
  }
  await ctx.close();
  void apiPost;
});
