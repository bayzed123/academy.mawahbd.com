import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, TEST_ADDRESS, useLang } from "./helpers";

/*
 * Online payment, as the buyer and as the owner see it. The buyer picks "bKash, Nagad, Rocket or card — Secure online payment": the card must
 * show the real marks (not a bare wallet icon), and if the gateway turns the purchase away they must be told plainly — not "Something went
 * wrong" — and be offered the other way of paying right there. The owner needs a place that says why: Settings → Payments → "Check the
 * connection". SSLCommerz cannot be reached from a test, and this copy of the site has no store keys, so the gateway's answer is stood in
 * for in the browser (the Worker's side is tested in worker/test/payment-gateway.test.ts) and the owner's check is run for real — without
 * keys, which is the first thing it must explain. Runs after the admin spec (the owner exists).
 */
test.describe.configure({ mode: "serial" });

const MANUAL = { window_min: 20, numbers: { bkash: "01711111111", nagad: "", rocket: "" }, note_bn: "", note_en: "" };

/** The checkout page of a visitor, with the quote changed to offer the online payment as well (this site has no store keys, so it never would). */
async function checkout(browser: Browser, lang: "bn" | "en") {
  const ctx = await browser.newContext({ locale: lang === "bn" ? "bn-BD" : "en-US" });
  await useLang(ctx, lang);
  const page = await ctx.newPage();
  await page.route("**/api/checkout/quote", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { quote: { channels: string[]; manual: unknown } };
    body.quote.channels = ["sslcommerz", "manual"];
    body.quote.manual = MANUAL;
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/app/checkout?c=beginners-baking-class");
  return { ctx, page };
}

async function fillDetails(page: Page, lang: "bn" | "en") {
  const en = lang === "en";
  await page.getByLabel(en ? /^Full name/ : /^পুরো নাম/).fill("Rina Akter");
  await page.getByLabel(en ? /^Mobile number/ : /^মোবাইল নম্বর/).fill("01712345678");
  await page.getByLabel(en ? /^Address/ : /^ঠিকানা/).fill(TEST_ADDRESS);
}

test("the online option shows the real marks, spoken as one list, and the send-money option shows the three wallets", async ({ browser }) => {
  const { ctx, page } = await checkout(browser, "en");
  const online = page.locator("label.pay-opt", { hasText: "Secure online payment" });
  await expect(online).toBeVisible();
  await expect(online.getByRole("img", { name: "bKash, Nagad, Rocket, Visa, Mastercard" })).toBeVisible();
  const marks = online.locator(".pay-mark img");
  await expect(marks).toHaveCount(5);
  expect(await marks.evaluateAll((imgs) => imgs.map((i) => new URL((i as HTMLImageElement).src).pathname))).toEqual(["/pay/bkash.webp", "/pay/nagad.webp", "/pay/rocket.webp", "/pay/visa.svg", "/pay/mastercard.svg"]);
  // every picture really arrived (a wrong path would leave an empty box)
  await expect.poll(async () => marks.evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);

  const manual = page.locator("label.pay-opt", { hasText: "Send money manually" });
  await expect(manual.getByRole("img", { name: "bKash, Nagad, Rocket" })).toBeVisible();
  await expect(manual.locator(".pay-mark img")).toHaveCount(3);

  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);

  // on a phone the five marks wrap inside the card instead of pushing the page sideways
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await ctx.close();
});

test("when the gateway turns the purchase away the buyer is told plainly and can pay by sending money instead", async ({ browser }) => {
  const { ctx, page } = await checkout(browser, "en");
  let asked = 0;
  await page.route("**/api/checkout/guest", async (route) => {
    asked++;
    await route.fulfill({ status: 502, contentType: "application/json", json: { ok: false, error: { code: "gateway_error" } } });
  });
  await fillDetails(page, "en");
  await expect(page.locator("label.pay-opt input:checked")).toHaveValue("sslcommerz"); // the online option is the one chosen first
  await page.getByRole("button", { name: /^Pay ৳/ }).click();

  const alert = page.getByRole("alert").filter({ hasText: "Online payment could not be started" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Nothing was charged");
  await expect(alert).toContainText("You can also pay right now by sending money");
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  expect(asked).toBe(1);

  // one press moves to the other way of paying and clears the message
  await alert.getByRole("button", { name: "Pay by sending money instead" }).click();
  await expect(page.locator("label.pay-opt input:checked")).toHaveValue("manual");
  await expect(alert).toHaveCount(0);
  await expect(page.locator("#m-payer")).toBeVisible(); // the send-money form opens right there
  await ctx.close();
});

test("the same, in Bangla", async ({ browser }) => {
  const { ctx, page } = await checkout(browser, "bn");
  await page.route("**/api/checkout/guest", (route) => route.fulfill({ status: 502, contentType: "application/json", json: { ok: false, error: { code: "gateway_error" } } }));
  await fillDetails(page, "bn");
  await page.getByRole("button", { name: /পেমেন্ট করুন$/ }).click();
  const alert = page.getByRole("alert").filter({ hasText: "অনলাইন পেমেন্ট এই মুহূর্তে শুরু করা যায়নি" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("কোনো টাকা কাটা হয়নি");
  await expect(page.getByText("কিছু একটা সমস্যা হয়েছে")).toHaveCount(0);
  await alert.getByRole("button", { name: "সেন্ড মানি করে পেমেন্ট করুন" }).click();
  await expect(page.locator("label.pay-opt input:checked")).toHaveValue("manual");
  await ctx.close();
});

test("a failure that is not the gateway's (anything else) keeps the ordinary message and no send-money button", async ({ browser }) => {
  const { ctx, page } = await checkout(browser, "en");
  await page.route("**/api/checkout/guest", (route) => route.fulfill({ status: 500, contentType: "application/json", json: { ok: false, error: { code: "internal" } } }));
  await fillDetails(page, "en");
  await page.getByRole("button", { name: /^Pay ৳/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay by sending money instead" })).toHaveCount(0);
  await ctx.close();
});

test.describe("Settings → Payments → Check the connection", () => {
  let admin: Page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "en-US" });
    await useLang(ctx, "en");
    admin = await ctx.newPage();
    await adminLogin(admin);
    await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  });
  test.afterAll(async () => admin.context().close());

  test("says how things stand and — with no store keys on this copy of the site — explains what to do, without showing a key", async () => {
    await admin.goto("/admin/settings?tab=payments");
    const section = admin.getByRole("region", { name: "Online payment connection (SSLCommerz)" });
    await expect(section).toBeVisible();
    await expect(section.getByText("Test (sandbox) — no real money", { exact: true })).toBeVisible();
    await expect(section.getByText("sandbox.sslcommerz.com")).toBeVisible();
    await expect(section.getByText("Not set")).toHaveCount(2); // both keys
    await expect(section.getByText("Not asked yet")).toBeVisible();
    // the website address and the return addresses the owner may have to give SSLCommerz
    await expect(section.getByText("/api/payments/sslcommerz/ipn")).toBeVisible();
    await expect(section.getByText("/api/payments/sslcommerz/success")).toBeVisible();

    await section.getByRole("button", { name: "Check the connection" }).click();
    const said = section.getByRole("alert").filter({ hasText: "The store keys are not on the website yet" });
    await expect(said).toBeVisible();
    await expect(said).toContainText("SSLCOMMERZ_STORE_ID");
    await expect(said).toContainText("run Deploy again");

    // nothing secret anywhere on the screen
    await expect(admin.locator("body")).not.toContainText(/store[_ ]?passw\w*\s*[:=]\s*\S{6,}/i);
    const axe = await new AxeBuilder({ page: admin }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });

  test("the same, in Bangla, and the e-mail settings list the new kind of note", async () => {
    await admin.goto("/admin/settings?tab=payments");
    await admin.evaluate(() => localStorage.setItem("mawah_admin_lang", "bn"));
    await admin.reload();
    const section = admin.getByRole("region", { name: "অনলাইন পেমেন্টের সংযোগ (SSLCommerz)" });
    await expect(section).toBeVisible();
    await section.getByRole("button", { name: "সংযোগ পরীক্ষা করুন" }).click();
    await expect(section.getByRole("alert").filter({ hasText: "স্টোরের কী এখনো ওয়েবসাইটে দেওয়া হয়নি" })).toBeVisible();

    await admin.goto("/admin/settings?tab=email");
    await expect(admin.getByText("কোনো শিক্ষার্থী অনলাইন পেমেন্ট শুরু করতে না পারলে")).toBeVisible();
    await admin.evaluate(() => localStorage.setItem("mawah_admin_lang", "en"));
    await admin.reload();
    await expect(admin.getByText("a student cannot start the online payment")).toBeVisible();
  });
});
