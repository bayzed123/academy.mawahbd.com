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

type Quote = { channels: string[]; manual: unknown; ssl_ways: { via: string; logo: string | null }[] | null };
/**
 * The checkout page of a visitor, with the quote changed to offer the online payment as well (this site has no store keys, so it never would).
 * `patch` changes the quote further (what SSLCommerz offered last time).
 */
async function checkout(browser: Browser, lang: "bn" | "en", patch?: (q: Quote) => void) {
  const ctx = await browser.newContext({ locale: lang === "bn" ? "bn-BD" : "en-US" });
  await useLang(ctx, lang);
  const page = await ctx.newPage();
  await page.route("**/api/checkout/quote", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { quote: Quote };
    body.quote.channels = ["sslcommerz", "manual"];
    body.quote.manual = MANUAL;
    patch?.(body.quote);
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

/* ---------------------------------------------------------------------------------------- paying by tapping a logo */

const GW = "https://sandbox.sslcommerz.com/gwprocess/v4";
const ALL = `${GW}/gw.php?Q=PAY&SESSIONKEY=e2e`;
const way = (name: string, group: string, gw: string) => ({ name, group, logo: `${GW}/image/gw/${gw}.png`, url: `${GW}/bankgw/indexhtmlotp.php?SESSIONKEY=e2e&cardname=${gw}` });
const WAYS = [
  way("bKash", "mobile", "bkash"),
  way("Nagad", "mobile", "nagad"),
  way("DBBL Mobile Banking", "mobile", "dbblmobilebanking"),
  way("Upay", "mobile", "upay"),
  way("VISA", "card", "visacard"),
  way("MASTER", "card", "mastercard"),
  way("City Touch", "bank", "city"),
];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8Dwn+E/w38AEAAB/wGJp5ySAAAAAElFTkSuQmCC", "base64");

/**
 * The Worker's answer to "Pay" with SSLCommerz's list of ways to pay (this copy of the site has no store keys; the Worker's side is in
 * worker/test/payment-gateway.test.ts), and SSLCommerz's pictures and pages stood in for — the test never leaves this machine.
 */
async function sslcommerzAnswers(ctx: import("@playwright/test").BrowserContext, page: Page) {
  await page.route("**/api/checkout/guest", (route) =>
    route.fulfill({ status: 201, contentType: "application/json", json: { ok: true, order: { public_id: "ORD-E2E-WAYS", status: "pending", total: 1850 }, redirect_url: ALL, pay_methods: WAYS } }),
  );
  await ctx.route("https://sandbox.sslcommerz.com/**", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith(".png")) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    return route.fulfill({ status: 200, contentType: "text/html", body: `<title>SSLCommerz ${u.searchParams.get("cardname") ?? "all"}</title>` });
  });
}

test("after Pay the buyer taps the way they pay — SSLCommerz's own logos, on this website, wallets first — and goes straight to it", async ({ browser }) => {
  const { ctx, page } = await checkout(browser, "en");
  await sslcommerzAnswers(ctx, page);
  await fillDetails(page, "en");
  await page.getByRole("button", { name: /^Pay ৳/ }).click();

  const heading = page.getByRole("heading", { level: 1, name: "Choose your payment method" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused(); // a new step: the reader is taken to it
  await expect(page.getByText("You pay ৳1,850 on that service’s own secure page")).toBeVisible();
  const groups = page.locator(".pay-group");
  await expect(groups.locator("h2")).toHaveText(["Mobile banking", "Cards", "Internet banking"]);
  await expect(groups.nth(0).getByRole("link")).toHaveText(["bKash", "Nagad", "DBBL Mobile Banking", "Upay"]);
  await expect(groups.nth(1).getByRole("link")).toHaveText(["VISA", "MASTER"]);
  await expect(groups.nth(2).getByRole("link")).toHaveText(["City Touch"]);
  for (const w of WAYS) await expect(page.getByRole("link", { name: w.name, exact: true })).toHaveAttribute("href", w.url);
  // SSLCommerz's pictures really show (the page's security policy lets them in)
  const logos = page.locator(".pay-method img");
  await expect(logos).toHaveCount(WAYS.length);
  await expect.poll(() => logos.evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.getByRole("link", { name: "All ways to pay (SSLCommerz page)" })).toHaveAttribute("href", ALL);
  await expect(page.getByText("never on this website")).toBeVisible();

  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  // on a phone the logos wrap, two or more to a row, and nothing is wider than the screen
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const [first, second] = await Promise.all([page.locator(".pay-method").nth(0).boundingBox(), page.locator(".pay-method").nth(1).boundingBox()]);
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
  await page.setViewportSize({ width: 1280, height: 900 });

  // "Change how to pay" goes back to the form, with what was typed still there
  await page.getByRole("button", { name: "Change how to pay" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await expect(page.getByLabel(/^Full name/)).toHaveValue("Rina Akter");

  // tapping bKash goes straight to bKash's payment at SSLCommerz — not to SSLCommerz's list
  await page.getByRole("button", { name: /^Pay ৳/ }).click();
  await page.getByRole("link", { name: "bKash", exact: true }).click();
  await page.waitForURL(/cardname=bkash$/);
  await expect(page).toHaveTitle("SSLCommerz bkash");
  await ctx.close();
});

test("the same choice, in Bangla", async ({ browser }) => {
  const { ctx, page } = await checkout(browser, "bn");
  await sslcommerzAnswers(ctx, page);
  await fillDetails(page, "bn");
  await page.getByRole("button", { name: /পেমেন্ট করুন$/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "পেমেন্ট মাধ্যম বেছে নিন" })).toBeVisible();
  await expect(page.locator(".pay-group h2")).toHaveText(["মোবাইল ব্যাংকিং", "কার্ড", "ইন্টারনেট ব্যাংকিং"]);
  await expect(page.getByRole("link", { name: "সব উপায় দেখুন (SSLCommerz পেজ)" })).toHaveAttribute("href", ALL);
  await expect(page.getByRole("button", { name: "পেমেন্টের ধরন বদলান" })).toBeVisible();
  await ctx.close();
});

/* ------------------------------------------------------------------- the ways of paying, as soon as the online payment is chosen */

const TILES = ["Pay with bKash", "Pay with Nagad", "Pay with Rocket", "Pay with Upay", "Pay with Visa", "Pay with Mastercard", "Pay with American Express"];

test("as soon as the online payment is chosen its ways of paying show as logo buttons — wallets first — and tapping bKash pays with bKash", async ({ browser }) => {
  const { ctx, page } = await checkout(browser, "en");
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/checkout/guest", (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 201, contentType: "application/json", json: { ok: true, order: { public_id: "ORD-E2E-TAP", status: "pending", total: 1850 }, redirect_url: `${GW}/bankgw/indexhtmlotp.php?SESSIONKEY=e2e&cardname=bkash`, pay_methods: [] } });
  });
  await ctx.route("https://sandbox.sslcommerz.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<title>SSLCommerz ${new URL(route.request().url()).searchParams.get("cardname") ?? "all"}</title>` }));

  // shown right away, before anything is pressed: SSLCommerz has never been asked here, so all of them
  const tiles = page.getByRole("group", { name: "Tap how you will pay" });
  await expect(tiles).toBeVisible();
  await expect(tiles.getByText("Your PIN or card number is typed only there")).toBeVisible();
  await expect(tiles.locator("h4")).toHaveText(["Mobile banking", "Cards"]);
  await expect(tiles.getByRole("button")).toHaveCount(TILES.length);
  for (const [i, name] of TILES.entries()) await expect(tiles.getByRole("button").nth(i)).toHaveAccessibleName(name);
  // our own pictures for the five we have them for, and they really arrive
  const pics = tiles.locator(".pay-logo img");
  expect(await pics.evaluateAll((imgs) => imgs.map((i) => new URL((i as HTMLImageElement).src).pathname))).toEqual(["/pay/bkash.webp", "/pay/nagad.webp", "/pay/rocket.webp", "/pay/visa.svg", "/pay/mastercard.svg"]);
  await expect.poll(() => pics.evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);

  // only for the online payment
  await page.locator("label.pay-opt", { hasText: "Send money manually" }).click();
  await expect(tiles).toHaveCount(0);
  await page.locator("label.pay-opt", { hasText: "Secure online payment" }).click();
  await expect(tiles).toBeVisible();

  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  // a phone: two or more to a row, nothing wider than the screen
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const [one, two] = await Promise.all([tiles.getByRole("button").nth(0).boundingBox(), tiles.getByRole("button").nth(1).boundingBox()]);
  expect(Math.abs(one!.y - two!.y)).toBeLessThan(2);
  await page.setViewportSize({ width: 1280, height: 900 });

  // the details are checked first: nothing is sent without them
  await tiles.getByRole("button", { name: "Pay with bKash" }).click();
  await expect(page.getByLabel(/^Full name/)).toBeFocused();
  expect(sent).toHaveLength(0);

  await fillDetails(page, "en");
  await tiles.getByRole("button", { name: "Pay with bKash" }).click();
  await page.waitForURL(/cardname=bkash$/);
  await expect(page).toHaveTitle("SSLCommerz bkash");
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ channel: "sslcommerz", via: "bkash", name: "Rina Akter" });
  await ctx.close();
});

test("a way SSLCommerz does not offer the shop brings its list, saying so", async ({ browser }) => {
  const { ctx, page } = await checkout(browser, "en");
  await page.route("**/api/checkout/guest", (route) =>
    route.fulfill({ status: 201, contentType: "application/json", json: { ok: true, order: { public_id: "ORD-E2E-MISS", status: "pending", total: 1850 }, redirect_url: ALL, pay_methods: WAYS.filter((w) => w.name !== "Nagad"), via_missing: "nagad" } }),
  );
  await ctx.route("https://sandbox.sslcommerz.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await fillDetails(page, "en");
  await page.getByRole("button", { name: "Pay with Nagad" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Choose your payment method" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Nagad cannot be used for this payment right now" })).toBeVisible();
  await expect(page.getByRole("link", { name: "bKash", exact: true })).toBeVisible();
  await ctx.close();
});

test("the buttons are what SSLCommerz offered the shop last time, with SSLCommerz's picture where we have none — and they read in Bangla", async ({ browser }) => {
  const upay = `${GW}/image/gw/upay.png`;
  const { ctx, page } = await checkout(browser, "bn", (q) => {
    q.ssl_ways = [
      { via: "bkash", logo: null },
      { via: "upay", logo: upay },
      { via: "visa", logo: null },
    ];
  });
  await ctx.route("https://sandbox.sslcommerz.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  const tiles = page.getByRole("group", { name: "যে মাধ্যমে পেমেন্ট করবেন, সেটিতে চাপুন" });
  await expect(tiles).toBeVisible();
  await expect(tiles.locator("h4")).toHaveText(["মোবাইল ব্যাংকিং", "কার্ড"]);
  await expect(tiles.getByRole("button")).toHaveCount(3);
  await expect(tiles.getByRole("button").nth(0)).toHaveAccessibleName("bKash দিয়ে পেমেন্ট");
  await expect(tiles.getByRole("button").nth(1)).toHaveAccessibleName("Upay দিয়ে পেমেন্ট");
  await expect(tiles.getByRole("button").nth(2)).toHaveAccessibleName("Visa দিয়ে পেমেন্ট");
  const upayPic = tiles.getByRole("button").nth(1).locator("img");
  await expect(upayPic).toHaveAttribute("src", upay);
  await expect.poll(() => upayPic.evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)).toBe(true); // the page's security policy lets it in
  await ctx.close();
});

test("when SSLCommerz sends no list, Pay goes to SSLCommerz's own page as before", async ({ browser }) => {
  const { ctx, page } = await checkout(browser, "en");
  await page.route("**/api/checkout/guest", (route) =>
    route.fulfill({ status: 201, contentType: "application/json", json: { ok: true, order: { public_id: "ORD-E2E-ALL", status: "pending", total: 1850 }, redirect_url: ALL, pay_methods: [] } }),
  );
  await ctx.route("https://sandbox.sslcommerz.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>SSLCommerz all</title>" }));
  await fillDetails(page, "en");
  await page.getByRole("button", { name: /^Pay ৳/ }).click();
  await page.waitForURL(ALL);
  await expect(page).toHaveTitle("SSLCommerz all");
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
