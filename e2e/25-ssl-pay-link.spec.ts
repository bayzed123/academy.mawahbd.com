import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, agree, apiGet, apiSend, registerStudent, useLang } from "./helpers";

/*
 * The shop's SSLCommerz payment link. The owner pastes the link from the SSLCommerz panel in Settings → Payments; at checkout it is one more way
 * under manual payment. The student pays on SSLCommerz's own page — never reached from the test machine: what is checked is the link the
 * page offers — sends the transaction ID, and staff approve it like a send-money payment. Runs after the admin spec (the owner exists) and puts
 * the payment settings back afterwards. The Worker's side is in worker/test/pay-link.test.ts.
 */
test.describe.configure({ mode: "serial" });

const LINK = "https://invoice.sslcommerz.com/invoice-form?refer=0TESTREF00000";
const CLASS = "beginners-baking-class";
type Payments = Record<string, unknown>;

let admin: Page;
let before: Payments;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  before = (await apiGet<{ settings: { payments: Payments } }>(admin, "/admin/settings")).settings.payments;
});
test.afterAll(async () => {
  await apiSend(admin, "PUT", "/admin/settings/payments", before);
  await admin.context().close();
});

const box = () => admin.getByLabel("SSLCommerz payment link (optional)");
async function save() {
  const done = admin.waitForResponse((r) => r.url().endsWith("/api/admin/settings/payments") && r.request().method() === "PUT");
  await admin.getByRole("button", { name: "Save", exact: true }).click();
  return (await done).status();
}

test("the owner pastes the payment link from the SSLCommerz panel; a link to anywhere else is refused in plain words", async () => {
  await admin.goto("/admin/settings?tab=payments");
  await expect(box()).toBeVisible();
  await expect(admin.getByText("The payment link from your SSLCommerz panel")).toBeVisible();

  await box().fill("https://example.net/pay-us");
  expect(await save()).toBe(422);
  await expect(admin.locator("#pn-link-err")).toHaveText(/not an SSLCommerz payment link/);

  await box().fill(`  ${LINK}  `);
  expect(await save()).toBe(200);
  await admin.reload();
  await expect(box()).toHaveValue(LINK);

  const axe = await new AxeBuilder({ page: admin }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
});

test("a student pays on the link: the page to pay on, the order code, SSLCommerz's transaction ID; staff see where it was paid and approve", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const sp = await ctx.newPage();
  const { email } = await registerStudent(sp, { name: "Link Payer" });
  const tabs: string[] = [];
  const onTab = (p: Page) => tabs.push(p.url());
  ctx.on("page", onTab);

  await sp.goto(`/app/checkout?c=${CLASS}`);
  await sp.getByText("Send money manually").click();
  await expect(sp.getByText("Pay to our number, or by card or mobile banking on SSLCommerz's payment page")).toBeVisible();
  await sp.getByLabel("Which service will you pay with?").selectOption({ label: "Card or mobile banking (SSLCommerz's payment page)" });
  await expect(sp.getByText("You get SSLCommerz's payment page and 20 minutes to pay.")).toBeVisible();
  await sp.getByLabel("Your mobile number — give the same one on SSLCommerz's page").fill("01712345678");
  await agree(sp);
  await sp.getByRole("button", { name: "Continue — show payment details" }).click();

  // the open order: SSLCommerz's page to pay on (a new tab, nothing sent along), the amount, the order code to write in the form
  await expect(sp).toHaveURL(/\/app\/orders\/[a-z2-7]{20}/);
  await expect(sp.getByText("Open SSLCommerz's payment page:")).toBeVisible();
  const pay = sp.getByRole("link", { name: /Open the payment page/ });
  await expect(pay).toHaveAttribute("href", LINK);
  await expect(pay).toHaveAttribute("target", "_blank");
  await expect(pay).toHaveAttribute("rel", /noopener/);
  await expect(sp.getByText(/^Pay exactly ৳[\d,]+ there — by card, bKash, Nagad or any way the page offers\.$/)).toBeVisible();
  await expect(sp.locator(".copy-row code")).toHaveText(/^[A-Z2-7]{8}$/); // the order code, and no number to send money to
  await expect(sp.getByText("Your mobile number: 01712345678")).toBeVisible();
  await expect(sp.getByText("It is on SSLCommerz's receipt")).toBeVisible();
  expect(tabs).toEqual([]); // nothing opened by itself: SSLCommerz's page opens only when the student taps the button
  ctx.off("page", onTab); // the accessibility scan works in a blank page of its own
  const axe = await new AxeBuilder({ page: sp }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  ctx.on("page", onTab);

  // SSLCommerz's transaction ID is longer than a wallet's and in mixed case
  await sp.getByLabel("Transaction ID (TrxID)").fill("2410231520531hYp6gZXZ4hjQ6vx");
  await sp.getByRole("button", { name: "I have paid — send for checking" }).click();
  await expect(sp.getByRole("heading", { name: "We are verifying your payment" })).toBeVisible();
  await expect(sp.getByText("TrxID 2410231520531HYP6GZXZ4HJQ6VX")).toBeVisible();
  const wa = await sp.getByRole("link", { name: "Send the details on WhatsApp too" }).getAttribute("href");
  expect(decodeURIComponent(wa!.split("?text=")[1])).toContain("SSLCommerz's payment page");
  expect(tabs).toEqual([]);

  // staff: the order says it was paid on the SSLCommerz payment link; approving opens the class
  await admin.goto("/admin/orders?status=awaiting_verification");
  await admin.getByRole("row", { name: new RegExp(email) }).click();
  await expect(admin.locator(".slide").getByText("SSLCommerz payment link", { exact: true })).toBeVisible();
  await expect(admin.locator(".slide").getByText("2410231520531HYP6GZXZ4HJQ6VX", { exact: true })).toBeVisible();
  await expect(admin.locator(".slide").getByText(/^Look for transaction 2410231520531HYP6GZXZ4HJQ6VX of ৳[\d,]+ \(mobile number 01712345678\) in your SSLCommerz panel/)).toBeVisible();
  await admin.getByRole("button", { name: "Approve payment" }).click();
  await expect(admin.getByRole("alertdialog")).toContainText("Only approve after you saw transaction 2410231520531HYP6GZXZ4HJQ6VX for ৳");
  await expect(admin.getByRole("alertdialog")).toContainText("in your SSLCommerz panel.");
  await admin.getByRole("alertdialog").getByRole("button", { name: "Approve payment" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await sp.goto("/app/");
  await expect(sp.getByRole("heading", { name: "Beginners Baking Class" })).toBeVisible();
  await ctx.close();
});

test("in Bangla on a 360 px phone: the choice, the page to pay on and the steps fit", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 800 } });
  // the sign-up helper reads the English form; the student then switches the site to Bangla
  await useLang(ctx, "en");
  const sp = await ctx.newPage();
  await registerStudent(sp, { name: "লিংক পেয়ার" });
  await sp.evaluate(() => localStorage.setItem("mawah_lang", "bn"));
  await sp.goto(`/app/checkout?c=${CLASS}`);
  await sp.getByText("ম্যানুয়ালি সেন্ড মানি").click();
  await sp.getByLabel("কোন সার্ভিস দিয়ে পাঠাবেন?").selectOption({ label: "কার্ড বা মোবাইল ব্যাংকিং (SSLCommerz-এর পেমেন্ট পেজ)" });
  await sp.getByLabel("আপনার মোবাইল নম্বর — SSLCommerz-এর পেজেও এই নম্বরটিই দিন").fill("01712345678");
  await agree(sp);
  await sp.getByRole("button", { name: /^এগিয়ে যান/ }).click();
  await expect(sp.getByRole("link", { name: /পেমেন্ট পেজ খুলুন/ })).toHaveAttribute("href", LINK);
  await expect(sp.getByText("SSLCommerz-এর পেমেন্ট পেজ খুলুন:")).toBeVisible();
  expect(await sp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await ctx.close();
});
