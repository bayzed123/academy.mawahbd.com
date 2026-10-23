import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, useLang } from "./helpers";

/*
 * SSLCommerz's own logo. SSLCommerz asks every shop to show its picture (one image with the logos of the ways to pay) and gives the shop the
 * link — the website must not invent one. The owner pastes what SSLCommerz gave in Settings → Payments, sees at once whether it is right, and
 * the picture then takes the place of the small marks at the bottom of every page and on the online choice at checkout. The picture itself is
 * never fetched here (the address is a made-up file on SSLCommerz's server, and this machine cannot reach SSLCommerz): what is checked is that
 * the right address is on the page, where it should be, without breaking the layout on a phone. The Worker's side (what is accepted, the
 * price answer, the security policy) is in worker/test/ssl-logo.test.ts. Runs after the admin spec (the owner exists); puts things back after.
 */
test.describe.configure({ mode: "serial" });

const LOGO = "https://securepay.sslcommerz.com/public/image/test-pay-with-logos.png";
const SNIPPET = `<a href="https://www.sslcommerz.com/" target="_blank" title="SSLCommerz"><img style="width:100%;height:auto;" src="${LOGO}" /></a>`;

let admin: Page;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
});
test.afterAll(async () => admin.context().close());

const box = () => admin.getByLabel("SSLCommerz logo", { exact: true });
async function save() {
  const done = admin.waitForResponse((r) => r.url().endsWith("/api/admin/settings/payments") && r.request().method() === "PUT");
  await admin.getByRole("button", { name: "Save", exact: true }).click();
  return (await done).status();
}

test("the owner pastes what SSLCommerz gave: a wrong link is explained at once, SSLCommerz's picture is shown before saving", async () => {
  await admin.goto("/admin/settings?tab=payments");
  await expect(box()).toBeVisible();
  await expect(admin.getByText("SSLCommerz asks every shop to show its logo")).toBeVisible();

  // a picture from anywhere else: said before saving, and refused by the server
  await box().fill("https://example.com/our-own-logos.png");
  await expect(admin.locator(".ssl-preview .err-text")).toHaveText(/not an SSLCommerz picture link/);
  expect(await save()).toBe(422);
  await expect(admin.locator("#pn-ssl-logo-err")).toHaveText(/not an SSLCommerz picture link/);
  await expect(admin.locator(".ssl-preview .err-text"), "said once, not twice").toHaveCount(0);

  // SSLCommerz's own code: the picture as it will show, then saved
  await box().fill(SNIPPET);
  await expect(admin.locator(".ssl-preview img")).toHaveAttribute("src", LOGO);
  await expect(admin.locator(".ssl-preview img")).toHaveAttribute("alt", "SSLCommerz logo");
  expect(await save()).toBe(200);
  await admin.reload();
  await expect(box()).toHaveValue(SNIPPET);

  const axe = await new AxeBuilder({ page: admin }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
});

test("every page shows SSLCommerz's picture in place of the small marks, linked to SSLCommerz, in both languages and on a phone", async ({ browser }) => {
  for (const [lang, path, alt] of [
    ["en", "/en", "Pay through SSLCommerz"],
    ["bn", "/courses", "SSLCommerz-এর মাধ্যমে পেমেন্ট"],
  ] as const) {
    const ctx = await browser.newContext({ locale: lang === "bn" ? "bn-BD" : "en-US", viewport: { width: 360, height: 800 } });
    await useLang(ctx, lang);
    const page = await ctx.newPage();
    await page.goto(path);
    const logo = page.locator("footer .ssl-logo img");
    await expect(logo).toHaveAttribute("src", LOGO);
    await expect(logo).toHaveAttribute("alt", alt);
    await expect(page.locator("footer .ssl-logo a")).toHaveAttribute("href", "https://www.sslcommerz.com/");
    await expect(page.locator("footer .pay-logos")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${lang}: nothing wider than the phone`).toBe(true);
    await ctx.close();
  }
});

test("at checkout the online choice shows SSLCommerz's picture instead of the small marks; send-money keeps its three wallets", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 800 } });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  // this copy of the site has no store keys, so it never offers online payment by itself: the price answer is changed to offer it, as the
  // live site would with the logo saved above (the Worker's side of this is in worker/test/ssl-logo.test.ts)
  await page.route("**/api/checkout/quote", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { quote: { channels: string[]; manual: unknown; ssl_logo: string | null } };
    body.quote.channels = ["manual", "sslcommerz"];
    body.quote.manual = { window_min: 20, numbers: { bkash: "01711111111", nagad: "", rocket: "" }, note_bn: "", note_en: "" };
    body.quote.ssl_logo = LOGO;
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/app/checkout?c=beginners-baking-class");
  const online = page.locator("label.pay-opt", { hasText: "Secure online payment" });
  await expect(online.locator(".pay-ssl img")).toHaveAttribute("src", LOGO);
  await expect(online.locator(".pay-ssl img")).toHaveAttribute("alt", "Pay through SSLCommerz");
  await expect(online.locator(".pay-mark")).toHaveCount(0);
  const manual = page.locator("label.pay-opt", { hasText: "Send money manually" });
  await expect(manual.locator(".pay-mark img")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await ctx.close();
});

test("emptied again, nothing of SSLCommerz's is shown and the small marks come back", async ({ browser }) => {
  await admin.goto("/admin/settings?tab=payments");
  await box().fill("");
  await expect(admin.locator(".ssl-preview")).toHaveCount(0);
  expect(await save()).toBe(200);
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en");
  await expect(page.locator("footer .ssl-logo")).toHaveCount(0);
  await expect(page.locator("footer .pay-logos img")).toHaveCount(5);
  await ctx.close();
});
