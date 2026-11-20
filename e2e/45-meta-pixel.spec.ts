import { expect, test, type Browser, type Page } from "@playwright/test";
import { adminLogin, agree, apiSend, uniqueEmail, useLang } from "./helpers";

/*
 * Meta Pixel, as a visitor's browser runs it. Meta itself is never reached: the request for Meta's script is answered with an empty one, and
 * `window.fbq` is a recorder put in place before the page's own code, so what the page tells Meta is read exactly as Meta's script would get
 * it. What must hold: the moments that make an ad pay — the class looked at, the checkout started, the purchase — reach Meta (they used to
 * go to Google only), the purchase carries the event ID the server's Conversions API report uses ("purchase." + the order's code) so Meta
 * counts it once, it is counted once however often the order page is opened, and nothing the buyer typed goes to Meta from the browser.
 * A visitor from an ad keeps the click (the _fbc cookie) from the page itself. Runs after the admin spec; the Pixel is switched off at the end.
 */
test.describe.configure({ mode: "serial" });

const PIXEL = "123456789012";
const DESKTOP_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CLASS = "beginners-baking-class";

let admin: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  expect((await apiSend(admin, "PUT", "/admin/settings/analytics", { ga4: "", clarity: "", meta_pixel: PIXEL, meta_capi_test: "" })).status).toBe(200);
});
test.afterAll(async () => {
  await apiSend(admin, "PUT", "/admin/settings/analytics", { ga4: "", clarity: "", meta_pixel: "", meta_capi_test: "" });
  await admin.context().close();
});

type Call = { args: unknown[]; path: string };
async function visitor(browser: Browser) {
  const ctx = await browser.newContext({ locale: "en-US", userAgent: DESKTOP_CHROME, extraHTTPHeaders: { "cf-ipcountry": "BD" } });
  await useLang(ctx, "en");
  const calls: Call[] = [];
  await ctx.exposeFunction("__fbq", (args: unknown[], path: string) => void calls.push({ args, path }));
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    // the recorder stands where Meta's snippet would put fbq (the snippet leaves an fbq that is already there alone)
    const rec = (...args: unknown[]) => (window as unknown as { __fbq?: (a: unknown[], p: string) => void }).__fbq?.(JSON.parse(JSON.stringify(args)), location.pathname);
    (window as unknown as { fbq: unknown }).fbq = rec;
  });
  // Meta's script is never fetched for real (the recorder is already there, so the page's snippet does not load it — answered anyway)
  await ctx.route(/connect\.facebook\.net/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "/* a stand-in for Meta's script */" }));
  return { ctx, page: await ctx.newPage(), calls };
}
const tracked = (calls: Call[], name: string) => calls.filter((c) => c.args[0] === "track" && c.args[1] === name);
async function waitTracked(calls: Call[], name: string) {
  await expect.poll(() => tracked(calls, name).length, { timeout: 10_000 }).toBeGreaterThan(0);
  return tracked(calls, name)[0];
}

test("the class looked at, the checkout and the purchase reach Meta — the purchase with the server's event ID, once, with nothing personal", async ({ browser }) => {
  test.setTimeout(90_000);
  const v = await visitor(browser);
  await v.page.goto(`/en/courses/${CLASS}`);
  await expect.poll(() => v.calls.some((c) => c.args[0] === "init" && c.args[1] === PIXEL), { timeout: 10_000 }).toBe(true);
  await waitTracked(v.calls, "PageView");
  const view = await waitTracked(v.calls, "ViewContent");
  expect(view.args[2]).toMatchObject({ currency: "BDT", value: 400, content_type: "product", content_ids: [CLASS] });

  await v.page.getByRole("link", { name: /Enroll Now/ }).first().click();
  await expect(v.page).toHaveURL(/\/app\/checkout\?c=beginners-baking-class/);
  expect((await waitTracked(v.calls, "InitiateCheckout")).args[2]).toMatchObject({ currency: "BDT", value: 400, content_ids: [CLASS], num_items: 1 });

  const buyer = { name: "Pixel Buyer", phone: "01711000777", email: uniqueEmail("pixel") };
  await v.page.getByLabel(/^Full name/).fill(buyer.name);
  await v.page.getByLabel(/^Mobile number/).fill(buyer.phone);
  await v.page.getByLabel(/^Address/).fill("House 12, Road 5, Dhanmondi, Dhaka");
  await v.page.getByLabel(/^E-mail/).fill(buyer.email);
  await v.page.getByText("Test payment").click();
  await agree(v.page);
  await v.page.getByRole("button", { name: /Pay ৳400/ }).click();
  await waitTracked(v.calls, "AddPaymentInfo");
  await waitTracked(v.calls, "CompleteRegistration");

  await v.page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(v.page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  const sale = await waitTracked(v.calls, "Purchase");
  const code = /\/app\/orders\/([a-z2-7]{20})/.exec(v.page.url())?.[1];
  expect(code).toBeTruthy();
  expect(sale.args[2]).toMatchObject({ currency: "BDT", value: 400, content_ids: [CLASS], order_id: code, num_items: 1 });
  expect(sale.args[3], "the same ID as the server's report, so Meta counts it once").toEqual({ eventID: `purchase.${code}` });

  // the server was told the visitor may be counted (it reports the purchase too)
  expect((await v.ctx.cookies()).find((c) => c.name === "mawah_measure")?.value).toBe("on");
  // nothing the buyer typed went to Meta from the browser
  const everything = JSON.stringify(v.calls);
  for (const secret of [buyer.name, buyer.phone, buyer.email, "Dhanmondi"]) expect(everything, secret).not.toContain(secret);

  await v.page.reload();
  await expect(v.page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await v.page.waitForTimeout(2600);
  expect(tracked(v.calls, "Purchase"), "opening the order again does not count it twice").toHaveLength(1);
  await v.ctx.close();
});

test("a free class is not a purchase: enrolling reaches Meta as FreeClassEnroll — no Purchase, no checkout, nothing an ad counts as a sale", async ({ browser }) => {
  test.setTimeout(90_000);
  const v = await visitor(browser);
  await v.page.goto("/app/checkout?c=free-taster-class");
  await expect(v.page.getByText("This class is free")).toBeVisible();
  await expect.poll(() => v.calls.some((c) => c.args[0] === "init" && c.args[1] === PIXEL), { timeout: 10_000 }).toBe(true);
  await v.page.getByLabel(/^Full name/).fill("Free Pixel Learner");
  await v.page.getByLabel(/^Mobile number/).fill("01711000778");
  await v.page.getByLabel(/^Address/).fill("House 12, Road 5, Dhanmondi, Dhaka");
  await v.page.getByLabel(/^E-mail/).fill(uniqueEmail("pixelfree"));
  await agree(v.page);
  await v.page.getByRole("button", { name: "Enroll for free" }).click();
  await expect(v.page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();

  await expect.poll(() => v.calls.filter((c) => c.args[0] === "trackCustom" && c.args[1] === "FreeClassEnroll").length, { timeout: 10_000 }).toBe(1);
  const enrol = v.calls.find((c) => c.args[0] === "trackCustom")!;
  expect(enrol.args[2]).toMatchObject({ content_ids: ["free-taster-class"], num_items: 1 });
  expect(enrol.args[2], "no money in it").not.toHaveProperty("value");
  for (const sale of ["Purchase", "InitiateCheckout", "AddPaymentInfo", "AddToCart"]) expect(tracked(v.calls, sale), sale).toHaveLength(0);
  await v.ctx.close();
});

test("a visitor from a Facebook ad keeps the click as Meta's _fbc cookie, set by the page itself", async ({ browser }) => {
  const v = await visitor(browser);
  await v.page.goto("/en?fbclid=IwAR0E2EClick123abc");
  const fbc = (await v.ctx.cookies()).find((c) => c.name === "_fbc");
  expect(fbc?.value).toMatch(/^fb\.1\.\d{13}\.IwAR0E2EClick123abc$/);
  await v.ctx.close();
});

test("the owner's screen: the Conversions API box says what is missing, and a saved token is only ever shown by its last four characters", async () => {
  await admin.goto("/admin/settings?tab=analytics");
  const box = admin.locator(".meta-capi");
  await expect(box).toContainText("Meta Conversions API (server)");
  await expect(box).toContainText("Not set up");
  const token = `EAAB${"e2eTok3n".repeat(8)}`;
  await box.getByLabel("Conversions API access token").fill(token);
  await box.getByRole("button", { name: "Save token" }).click();
  await expect(box).toContainText(`Access token saved (••••${token.slice(-4)})`);
  await expect(box).toContainText("Working");
  await expect(box.getByRole("button", { name: "Send a test event" })).toBeDisabled(); // no test code yet
  expect(await admin.content()).not.toContain(token);
  await box.getByRole("button", { name: "Delete" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(box).toContainText("Not set up");
});
