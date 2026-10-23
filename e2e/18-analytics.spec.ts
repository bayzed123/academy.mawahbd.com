import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, agree, apiGet, apiSend, STAFF, uniqueEmail, useLang } from "./helpers";

/*
 * Counting visits (Google Analytics 4) and the Admin → Analytics screen.
 *
 * Google itself is never reached: the browser's request for Google's tag is answered here by an empty script, and what the page tells the tag is
 * read from `window.dataLayer` — exactly what the real tag would be given. The numbers on the admin screen come from a stand-in for Google that the
 * Worker serves to itself (worker/src/routes/api/dev-google.ts) and a made-up service-account key created by scripts/e2e-server.mjs for this run.
 *
 * The browsers here must look like real visitors: a test browser (navigator.webdriver, "HeadlessChrome") is never counted on purpose, so that
 * test runs, Lighthouse and uptime checks cannot add made-up visits to the owner's numbers — one test below checks exactly that.
 * Runs after the other specs (the owner exists); the measurement ID is switched off again at the end.
 */
test.describe.configure({ mode: "serial" });

const GA_ID = "G-E2ETEST01";
const DESKTOP_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CLASS = "beginners-baking-class";
const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]; // the same rules every other screen is held to

let admin: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  void STAFF;
});
test.afterAll(async () => {
  await apiSend(admin, "PUT", "/admin/settings/analytics", { ga4: "", clarity: "", meta_pixel: "" }); // leave the shop as it was found
  await admin.context().close();
});

interface Wish {
  country?: string;
  dnt?: boolean;
  gpc?: boolean;
}

/** A visitor with a normal browser (not a test browser), optionally in another country, optionally asking not to be tracked. Google's tag is a stand-in. */
async function visitor(browser: Browser, wish: Wish = {}) {
  const ctx: BrowserContext = await browser.newContext({ locale: "en-US", userAgent: DESKTOP_CHROME, extraHTTPHeaders: wish.country ? { "cf-ipcountry": wish.country } : undefined });
  await useLang(ctx, "en");
  await ctx.addInitScript((w) => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    if (w.dnt) Object.defineProperty(navigator, "doNotTrack", { get: () => "1" });
    if (w.gpc) Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true });
  }, wish);
  // everything the pages give to the tag, kept here too: a redirect to a payment page throws the page's own copy away with the page
  const log: unknown[][] = [];
  const paths: string[] = []; // the page each entry was given on
  await ctx.exposeFunction("__ga", (entry: unknown[], path: string) => {
    log.push(entry);
    paths.push(path);
  });
  await ctx.addInitScript(() => {
    const layer: unknown[] = [];
    const push = layer.push.bind(layer);
    layer.push = (...items: unknown[]) => {
      for (const item of items) (window as unknown as { __ga?: (e: unknown[], p: string) => void }).__ga?.(Array.from(item as ArrayLike<unknown>), location.pathname);
      return push(...items);
    };
    (window as unknown as { dataLayer: unknown[] }).dataLayer = layer;
  });
  const seen = { tag: 0 };
  await ctx.route(/(googletagmanager|google-analytics|analytics\.google)\.com/, (route) => {
    seen.tag++;
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "/* a stand-in for Google's tag */" });
  });
  return { ctx, page: await ctx.newPage(), seen, log, paths };
}

interface Hit {
  name: string;
  params: Record<string, any>;
}
const layer = (page: Page) => page.evaluate(() => (((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []) as ArrayLike<unknown>[]).map((a) => Array.from(a)));
const hits = async (page: Page): Promise<Hit[]> => (await layer(page)).filter((a) => a[0] === "event").map((a) => ({ name: String(a[1]), params: (a[2] as Record<string, any>) ?? {} }));
const named = async (page: Page, name: string) => (await hits(page)).filter((h) => h.name === name);
/** Waits for one event to have been given to the tag, and returns the first of them. */
const wait = async (page: Page, name: string) => {
  await expect.poll(async () => (await named(page, name)).length, { message: `the page should have told Google about "${name}"` }).toBeGreaterThan(0);
  return (await named(page, name))[0]!;
};
/** The same, from the record kept across page loads. */
const logged = (v: { log: unknown[][] }, name: string): Hit[] => v.log.filter((a) => a[0] === "event" && a[1] === name).map((a) => ({ name, params: (a[2] as Record<string, any>) ?? {} }));
const waitLogged = async (v: { log: unknown[][] }, name: string) => {
  await expect.poll(() => logged(v, name).length, { message: `the pages should have told Google about "${name}"` }).toBeGreaterThan(0);
  return logged(v, name)[0]!;
};
/** Clicks must not leave the page, or what it told the tag would be lost with it; the script has already seen the click (it listens first). */
const stay = (page: Page) => page.evaluate(() => document.addEventListener("click", (e) => e.preventDefault()));

test("the owner types the measurement ID in Settings → Analytics, and the shop starts to carry the tag", async () => {
  await admin.goto("/admin/settings?tab=analytics");
  await admin.getByLabel("Google Analytics 4").fill(GA_ID);
  await admin.getByRole("button", { name: /^Save/ }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  // the dashboard's strip says what is missing: the tag works, the Google key (set up for these tests) is there too
  await admin.goto("/admin/");
  await expect(admin.locator(".health-card", { hasText: "Analytics" })).toBeVisible();
  await admin.goto("/admin/settings?tab=analytics");
  await expect(admin.getByRole("link", { name: /See the numbers/ })).toBeVisible();

  const { ctx, page, seen } = await visitor((admin.context().browser())!);
  const res = await page.goto(`/en/courses/${CLASS}`);
  expect(res!.headers()["content-security-policy"]).toContain("https://www.googletagmanager.com");
  await expect(page.locator(`meta[name="mawah:ga4"]`)).toHaveAttribute("content", GA_ID);
  await expect.poll(() => seen.tag).toBeGreaterThan(0);
  await ctx.close();
});

test("a visitor's looking and choosing is counted — the list of classes, the one chosen, the page, Enroll now, the contact buttons — with nothing personal in it", async ({ browser }) => {
  const { ctx, page, seen } = await visitor(browser, { country: "BD" });
  await page.goto("/en/courses");

  // Google's tag is asked for after the page is done, set up without ad features
  await expect.poll(() => seen.tag).toBeGreaterThan(0);
  const config = (await layer(page)).find((a) => a[0] === "config")!;
  expect(config[1]).toBe(GA_ID);
  expect(config[2]).toMatchObject({ transport_type: "beacon", allow_google_signals: false, allow_ad_personalization_signals: false });

  // the list of classes came on screen
  const list = await wait(page, "view_item_list");
  expect(list.params.item_list_id).toBe("classes");
  expect(list.params.items.length).toBeGreaterThan(5);
  expect(list.params.items[0]).toMatchObject({ index: 1, quantity: 1 });
  expect(list.params.items[0].item_id).toMatch(/^[a-z0-9-]+$/);
  expect(typeof list.params.items[0].price).toBe("number");

  // one class was chosen from the list
  await stay(page);
  await page.locator(`[data-ga-item] a[href$="/courses/${CLASS}"]`).first().click();
  const chosen = await wait(page, "select_item");
  expect(chosen.params.items[0]).toMatchObject({ item_id: CLASS, item_name: "Beginners Baking Class", price: 400, index: expect.any(Number), item_list_id: "classes" });

  // the class page itself: opened, then "Enroll now" (the price is the class's own; the currency is taka)
  const second = await visitor(browser, { country: "BD" });
  await second.page.goto(`/en/courses/${CLASS}`);
  const opened = await wait(second.page, "view_item");
  expect(opened.params).toMatchObject({ currency: "BDT", value: 400 });
  expect(opened.params.items[0]).toMatchObject({ item_id: CLASS, item_name: "Beginners Baking Class", price: 400, quantity: 1 });
  await stay(second.page);
  await second.page.getByRole("link", { name: /Enroll Now/ }).first().click();
  const cart = await wait(second.page, "add_to_cart");
  expect(cart.params).toMatchObject({ currency: "BDT", value: 400 });
  expect(cart.params.items[0].item_id).toBe(CLASS);
  expect(typeof cart.params.placement).toBe("string");

  // the buttons that reach a person, and the language switch
  await second.page.locator('a[href^="https://wa.me/"]').first().click();
  expect((await wait(second.page, "contact_click")).params.method).toBe("whatsapp");
  await second.page.locator("a.lang-toggle").first().click();
  expect((await wait(second.page, "language_switch")).params).toMatchObject({ from: "en", to: "bn" });

  // a question sent through the contact form: counted as a lead — and not one letter of what was typed goes to Google
  const third = await visitor(browser, { country: "BD" });
  await third.page.goto("/en/contact");
  const typed = { name: "Privacy Tester", email: uniqueEmail("private"), phone: "01712345678", message: "Please call me about the baking class tonight" };
  await third.page.getByLabel(/^Your name/).fill(typed.name);
  await third.page.getByLabel("Email", { exact: true }).fill(typed.email);
  await third.page.getByLabel(/^Mobile/).fill(typed.phone);
  await third.page.getByLabel("How can we help?").fill(typed.message);
  await third.page.getByRole("button", { name: "Send message" }).click();
  const lead = await wait(third.page, "generate_lead");
  expect(lead.params.lead_type).toBe("contact");
  const everything = JSON.stringify(await layer(third.page));
  for (const secret of [typed.name, typed.email, typed.phone, typed.message, "Privacy", "tonight"]) expect(everything, secret).not.toContain(secret);

  for (const v of [{ ctx }, second, third]) await v.ctx.close();
});

test("nobody is counted who asked not to be — Do Not Track, Global Privacy Control — and test browsers are not visitors", async ({ browser, page }) => {
  for (const wish of [{ dnt: true }, { gpc: true }] as Wish[]) {
    const v = await visitor(browser, { country: "BD", ...wish });
    await v.page.goto("/en/courses");
    await expect.poll(() => v.page.evaluate(() => typeof (window as unknown as { mawahTrack?: unknown }).mawahTrack)).toBe("function"); // the script ran…
    await v.page.waitForTimeout(2600); // …and had every chance (it starts when the browser is idle, at the latest after two seconds)
    expect(v.seen.tag, JSON.stringify(wish)).toBe(0);
    expect(await layer(v.page), JSON.stringify(wish)).toEqual([]);
    await v.ctx.close();
  }

  // the browser this test runs in announces itself as automated (navigator.webdriver): Lighthouse, uptime checks and these tests never add visits
  let asked = 0;
  page.on("request", (r) => {
    if (/googletagmanager|google-analytics/.test(r.url())) asked++;
  });
  await page.goto("/en/courses");
  await page.waitForTimeout(2600);
  expect(asked).toBe(0);
  expect(await layer(page)).toEqual([]);
});

test("visitors in Europe and the UK are asked first: nothing is counted until they accept, and the answer is remembered", async ({ browser }) => {
  const yes = await visitor(browser, { country: "DE" });
  await yes.page.goto("/en/courses");
  const bar = yes.page.getByRole("region", { name: "Cookies and visit counting" });
  await expect(bar).toBeVisible();
  expect(yes.seen.tag, "nothing is asked of Google before the answer").toBe(0);
  expect(await layer(yes.page)).toEqual([]);
  const scan = await new AxeBuilder({ page: yes.page }).withTags(WCAG).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 160)).join(" | ")}`), "the question passes the accessibility scan").toEqual([]);

  await bar.getByRole("button", { name: "Accept" }).click();
  await expect(bar).toBeHidden();
  await expect.poll(() => yes.seen.tag).toBeGreaterThan(0);
  expect((await layer(yes.page)).some((a) => a[0] === "config")).toBe(true);
  await wait(yes.page, "view_item_list"); // what was seen before the answer is not lost
  const before = yes.seen.tag;
  await yes.page.reload();
  await expect(yes.page.getByRole("region", { name: "Cookies and visit counting" })).toHaveCount(0); // asked once
  await expect.poll(() => yes.seen.tag).toBeGreaterThan(before);

  // a "no" is final too: no tag, no events, no second question
  const no = await visitor(browser, { country: "GB" });
  await no.page.goto("/en/courses");
  const bar2 = no.page.getByRole("region", { name: "Cookies and visit counting" });
  await expect(bar2).toBeVisible();
  await bar2.getByRole("button", { name: "No thanks" }).click();
  await expect(bar2).toBeHidden();
  await no.page.reload();
  await no.page.waitForTimeout(2600);
  await expect(no.page.getByRole("region", { name: "Cookies and visit counting" })).toHaveCount(0);
  expect(no.seen.tag).toBe(0);
  expect(await layer(no.page)).toEqual([]);

  // the banner is in Bangla for a Bangla page
  const bn = await visitor(browser, { country: "FR" });
  await bn.page.goto("/courses");
  await expect(bn.page.getByRole("region", { name: "কুকি ও ভিজিট গোনা" })).toBeVisible();
  for (const v of [yes, no, bn]) await v.ctx.close();
});

test("anyone can stop being counted from the footer, and start again — the choice outlasts the visit", async ({ browser }) => {
  const v = await visitor(browser, { country: "BD" });
  await v.page.goto("/en");
  const stop = v.page.getByRole("button", { name: "Stop counting my visits" });
  await expect(stop).toBeVisible();
  await expect.poll(() => v.seen.tag).toBeGreaterThan(0);

  await stop.click();
  await expect(v.page.getByText("Your visits are no longer counted on this device.")).toBeAttached();
  await expect(v.page.getByRole("button", { name: "Count my visits again" })).toBeVisible();
  expect(await v.page.evaluate((id) => (window as unknown as Record<string, unknown>)[`ga-disable-${id}`], GA_ID)).toBe(true); // Google's own switch
  const count = (await layer(v.page)).length;
  await stay(v.page);
  await v.page.locator('a[href^="https://wa.me/"]').first().click();
  expect((await layer(v.page)).length, "a click after the choice tells Google nothing").toBe(count);

  const asked = v.seen.tag;
  await v.page.reload();
  await v.page.waitForTimeout(2600);
  expect(v.seen.tag, "the next visit does not even ask for the tag").toBe(asked);
  await expect(v.page.getByRole("button", { name: "Count my visits again" })).toBeVisible();

  await v.page.getByRole("button", { name: "Count my visits again" }).click();
  await expect(v.page.getByText("Thank you — your visits are counted again.")).toBeAttached();
  await expect.poll(() => v.seen.tag).toBeGreaterThan(asked);
  await v.ctx.close();
});

test("a visitor who says no the moment the page is open is never counted, even though the script was just about to start", async ({ browser }) => {
  const v = await visitor(browser, { country: "BD" });
  // the script starts when the browser is idle: hold that moment back until the test lets it go, so that the choice can be made first
  await v.ctx.addInitScript(() => {
    const held: (() => void)[] = [];
    (window as unknown as Record<string, unknown>).requestIdleCallback = (fn: () => void) => held.push(fn);
    (window as unknown as Record<string, unknown>).__letItStart = () => held.splice(0).forEach((fn) => fn());
  });
  await v.page.goto("/en");
  await v.page.getByRole("button", { name: "Stop counting my visits" }).click();
  await expect(v.page.getByText("Your visits are no longer counted on this device.")).toBeAttached();
  await v.page.evaluate(() => (window as unknown as { __letItStart: () => void }).__letItStart());
  await v.page.waitForTimeout(800);
  expect(v.seen.tag, "the tag is never asked for").toBe(0);
  expect(await layer(v.page)).toEqual([]);
  await v.ctx.close();
});

test("when the page cannot tell which country the visitor is in (cookies blocked, a page taken out of the browser's memory) the visitor is asked first", async ({ browser }) => {
  const v = await visitor(browser, { country: "BD" });
  await v.ctx.addInitScript(() => {
    // as if the country cookie never arrived
    const own = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    Object.defineProperty(document, "cookie", { configurable: true, get: () => own.get!.call(document).replace(/mawah_geo=[^;]*;?\s*/g, ""), set: (x: string) => own.set!.call(document, x) });
  });
  await v.page.goto("/en/courses");
  const bar = v.page.getByRole("region", { name: "Cookies and visit counting" });
  await expect(bar).toBeVisible();
  await v.page.waitForTimeout(500);
  expect(v.seen.tag, "nothing is counted before the answer").toBe(0);
  expect(await layer(v.page)).toEqual([]);
  await bar.getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => v.seen.tag).toBeGreaterThan(0);
  await v.ctx.close();
});

test("a no given in Europe is still a no when the visitor is somewhere else the next time", async ({ browser }) => {
  const v = await visitor(browser, { country: "DE" });
  await v.page.goto("/en/courses");
  const bar = v.page.getByRole("region", { name: "Cookies and visit counting" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "No thanks" }).click();
  await expect(bar).toBeHidden();

  // the visitor has travelled: the shop now sees Bangladesh (the country cookie is corrected by the server)
  await v.ctx.setExtraHTTPHeaders({ "cf-ipcountry": "BD" });
  await v.page.goto("/en/courses");
  await expect.poll(async () => (await v.ctx.cookies()).find((c) => c.name === "mawah_geo")?.value).toBe("row");
  await v.page.waitForTimeout(2600);
  expect(v.seen.tag, "the no travels with the visitor").toBe(0);
  expect(await layer(v.page)).toEqual([]);
  await expect(v.page.getByRole("region", { name: "Cookies and visit counting" })).toHaveCount(0); // and is not asked again
  await expect(v.page.getByRole("button", { name: "Count my visits again" })).toBeVisible(); // but can change their mind in the footer
  await v.ctx.close();
});

test("the address of a certificate check is reported without the code in it, and without anything that looks like the visitor's own details — the check itself is still counted", async ({ browser }) => {
  const v = await visitor(browser, { country: "BD" });
  const code = "MWH-7K3M-9P2Q-XR4T";
  await v.page.goto(`/en/verify/${code}?utm_source=newsletter&email=someone@example.com`);
  const result = await wait(v.page, "certificate_verify");
  expect(["found", "not_found"]).toContain(result.params.result);
  const config = (await layer(v.page)).find((a) => a[0] === "config")!;
  const reported = String((config[2] as Record<string, unknown>).page_location);
  expect(reported).not.toContain(code);
  expect(reported).not.toContain("someone");
  expect(decodeURIComponent(reported)).toContain("/en/verify/(code)");
  expect(decodeURIComponent(reported)).toContain("email=(removed)");
  expect(reported, "campaign tags are what Google reads: they stay").toContain("utm_source=newsletter");
  expect(JSON.stringify(v.log)).not.toContain(code);

  // an ordinary page is reported as it is (the tag then uses the address itself)
  const plain = await visitor(browser, { country: "BD" });
  await plain.page.goto("/en/courses");
  await expect.poll(() => plain.seen.tag).toBeGreaterThan(0);
  const plainConfig = (await layer(plain.page)).find((a) => a[0] === "config")!;
  expect(Object.keys(plainConfig[2] as object)).not.toContain("page_location");
  await v.ctx.close();
  await plain.ctx.close();
});

test("the student app carries the tag, the admin never does — and a purchase is counted once, with the class under the same name as on the website", async ({ browser }) => {
  const v = await visitor(browser, { country: "BD" });
  // the app's page and its policy
  const shell = await v.page.goto("/app/login");
  expect(shell!.headers()["content-security-policy"]).toContain("https://www.googletagmanager.com");
  await expect(v.page.locator(`meta[name="mawah:ga4"]`)).toHaveAttribute("content", GA_ID);
  // …but never the admin: not in the page, not in its policy, not as a request
  await v.page.goto("/admin/");
  await expect(v.page.getByRole("button", { name: /^Log in$/ })).toBeVisible();
  await expect(v.page.locator(`meta[name="mawah:ga4"]`)).toHaveCount(0);
  const adminShell = await v.page.goto("/admin/");
  expect(adminShell!.headers()["content-security-policy"]).not.toContain("googletagmanager");

  // the page behind a password link has a secret in its address: never counted, no referrer passed on
  const secretPage = await v.page.goto("/app/reset/a-one-time-secret-token");
  await expect(v.page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  expect(secretPage!.headers()["referrer-policy"]).toBe("no-referrer");
  expect(secretPage!.headers()["content-security-policy"]).not.toContain("googletagmanager");
  await expect(v.page.locator(`meta[name="mawah:ga4"]`)).toHaveCount(0);
  await v.page.waitForTimeout(2600);
  expect(v.log.filter((_, i) => v.paths[i]!.startsWith("/app/reset/")), "nothing was told to Google on that page").toEqual([]);

  // buying as a guest, the way a visitor does
  await v.page.goto(`/en/courses/${CLASS}`);
  await v.page.getByRole("link", { name: /Enroll Now/ }).first().click();
  await expect(v.page).toHaveURL(/\/app\/checkout\?c=beginners-baking-class/);
  const begin = await waitLogged(v, "begin_checkout");
  expect(begin.params).toMatchObject({ currency: "BDT", value: 400 });
  expect(begin.params.items[0]).toMatchObject({ item_id: CLASS, item_name: "Beginners Baking Class", price: 400 });

  // a coupon that does not work is counted — but not what was typed in the box (it takes anything that is pasted into it)
  await v.page.getByLabel("Have a coupon code?").fill("secret-word-99");
  await v.page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(v.page.locator(".err-text")).toBeVisible();
  const failed = await waitLogged(v, "coupon_failed");
  expect(Object.keys(failed.params)).toEqual(["reason"]);
  expect(JSON.stringify(v.log).toLowerCase()).not.toContain("secret-word-99");
  await v.page.getByLabel("Have a coupon code?").fill("");

  const buyer = { name: "Counting Buyer", phone: "01711000555", email: uniqueEmail("counted") };
  await v.page.getByLabel(/^Full name/).fill(buyer.name);
  await v.page.getByLabel(/^Mobile number/).fill(buyer.phone);
  await v.page.getByLabel(/^Address/).fill("House 12, Road 5, Dhanmondi, Dhaka");
  await v.page.getByLabel(/^E-mail/).fill(buyer.email);
  await v.page.getByText("Test payment").click();
  await agree(v.page);
  await v.page.getByRole("button", { name: /Pay ৳400/ }).click();
  const payment = await waitLogged(v, "add_payment_info");
  expect(payment.params).toMatchObject({ currency: "BDT", value: 400 });
  expect(payment.params.items[0].item_id).toBe(CLASS);
  expect((await waitLogged(v, "sign_up")).params.method).toBe("checkout");

  await v.page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(v.page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  const sale = await waitLogged(v, "purchase");
  expect(sale.params).toMatchObject({ currency: "BDT", value: 400 });
  expect(sale.params.transaction_id).toMatch(/^[A-Za-z0-9_-]{8,}$/);
  expect(sale.params.items).toHaveLength(1);
  // the same name for the class as on the public pages, so Admin → Analytics can put the two together
  expect(sale.params.items[0]).toMatchObject({ item_id: CLASS, item_name: "Beginners Baking Class", price: 400 });

  // nothing the buyer typed went to Google
  const everything = JSON.stringify(v.log);
  for (const secret of [buyer.name, buyer.phone, buyer.email, "Dhanmondi", "Counting"]) expect(everything, secret).not.toContain(secret);

  // opening the order again (a reload, a bookmark) does not count the sale twice
  await v.page.reload();
  await expect(v.page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await v.page.waitForTimeout(2600);
  expect(logged(v, "purchase")).toHaveLength(1); // still the one
  await v.ctx.close();
});

test.describe("Admin → Analytics", () => {
  const setScenario = (scenario: string) => apiSend(admin, "POST", "/dev/google/scenario", { scenario });

  test.beforeEach(async () => {
    await setScenario("ok");
    await apiSend(admin, "POST", "/admin/analytics/refresh", {});
  });
  test.afterAll(async () => {
    await setScenario("ok");
  });

  test("shows how people see the classes: Google's numbers next to the shop's own sales, in both languages and on a phone, and passes the accessibility scan", async () => {
    await admin.goto("/admin/analytics");
    await expect(admin.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();

    // the connection is in order and says whose address to add in Google Analytics
    await admin.getByText("Connection to Google").click();
    await expect(admin.getByText("reader@mawah-e2e.iam.gserviceaccount.com")).toBeVisible();
    await expect(admin.getByText(`On — ${GA_ID}`)).toBeVisible();
    await expect(admin.getByText("559265538")).toBeVisible();

    // the totals Google gave
    const kpis = admin.getByRole("region", { name: /^From / });
    await expect(kpis).toContainText("Visitors");
    await expect(kpis).toContainText("140");
    await expect(kpis).toContainText("700");

    // one row for the class — its two language pages together — with Google's counters beside the shop's own sales
    const row = admin.getByTestId("an-classes").locator("tr", { hasText: "Beginners Baking Class" });
    await expect(row.locator("td").nth(1)).toHaveText("150");
    await expect(row.locator("td").nth(5)).toHaveText("10"); // opened checkout
    await expect(row.locator("td").nth(6)).toHaveText("4"); // bought, as Google saw it (a free enrolment counts too)
    // a class nobody opened is listed too, and says so; a page that is no longer a class is shown as that
    await expect(admin.getByTestId("an-classes").getByText("Nobody opened it").first()).toBeVisible();
    await expect(admin.getByTestId("an-classes").getByText("a-class-that-was-renamed")).toBeVisible();
    // the purchase I made in the test above is in the shop's own records
    const sales = await apiGet<{ report: { classes: { slug: string; paid_sales: number }[] } }>(admin, "/admin/analytics/report?range=28d");
    expect(sales.report.classes.find((c) => c.slug === CLASS)!.paid_sales).toBeGreaterThan(0);

    // the other panels
    await expect(admin.getByText("How people see your classes")).toBeVisible();
    await expect(admin.getByText("google / organic")).toBeVisible();
    await expect(admin.getByText("Learn to bake in Bangla")).toBeVisible();
    await expect(admin.getByRole("cell", { name: "Opened a class page" })).toBeVisible();
    await expect(admin.getByText("Beginners Baking Class | MAWAH Academy")).toBeVisible(); // reading it right now
    await expect(admin.locator("ul.plain li", { hasText: /^cake · 9$/ })).toBeVisible(); // what visitors searched for
    // the table as a spreadsheet
    const csv = await apiGet<unknown>(admin, "/admin/analytics/report?range=7d");
    expect(csv).toBeTruthy();
    const file = await admin.request.get("/api/admin/analytics/classes.csv?range=28d");
    expect(file.status()).toBe(200);
    expect(await file.text()).toContain("Beginners Baking Class");

    const scan = await new AxeBuilder({ page: admin }).withTags(WCAG).analyze();
    expect(scan.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);

    // another range, and Bangla
    await admin.getByRole("tab", { name: /7/ }).click();
    await expect(admin.getByTestId("an-classes")).toBeVisible();
    await admin.evaluate(() => localStorage.setItem("mawah_admin_lang", "bn"));
    await admin.reload();
    await expect(admin.getByRole("heading", { level: 1, name: "অ্যানালিটিক্স" })).toBeVisible();
    await expect(admin.getByText("মানুষ আপনার ক্লাস কীভাবে দেখছে")).toBeVisible();
    await admin.evaluate(() => localStorage.setItem("mawah_admin_lang", "en"));

    // on a phone the table scrolls inside its own box; the page does not
    await admin.setViewportSize({ width: 360, height: 800 });
    await admin.reload();
    await expect(admin.getByTestId("an-classes")).toBeVisible();
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await admin.setViewportSize({ width: 1440, height: 900 });
  });

  test("a person who may not see the shop's money gets the same table without that column", async () => {
    await admin.route("**/api/admin/analytics/report**", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.report.money = false;
      for (const c of body.report.classes) c.revenue = null;
      await route.fulfill({ response: res, json: body });
    });
    try {
      await admin.goto("/admin/analytics");
      const table = admin.getByTestId("an-classes");
      await expect(table).toBeVisible();
      await expect(table.locator("tr", { hasText: "Beginners Baking Class" }).locator("td").nth(1)).toHaveText("150"); // the rest of the table is there
      await expect(table.getByRole("columnheader", { name: "Money" })).toHaveCount(0);
      await expect(table.locator("thead th")).toHaveCount(await table.locator("tbody tr").first().locator("td").count());
    } finally {
      await admin.unroute("**/api/admin/analytics/report**");
    }
    // …and with the money (the owner's own view) the column is there
    await admin.goto("/admin/analytics");
    await expect(admin.getByTestId("an-classes").getByRole("columnheader", { name: "Money" })).toBeVisible();
  });

  test("explains each way Google can say no, in plain words, with what to do next — and checking again after fixing it brings the numbers back", async () => {
    const cases: [string, string, RegExp][] = [
      ["api_disabled", "The Analytics Data API is switched off", /Google Analytics Data API has not been used in project/],
      ["no_access", "The account cannot see your Analytics yet", /User does not have sufficient permissions/],
      ["key_rejected", "Google did not accept the key", /Invalid JWT Signature/],
      ["quota", "Too many questions for now", /Exhausted property tokens/],
      ["down", "Google had a problem", /./],
    ];
    for (const [scenario, title, google] of cases) {
      await setScenario(scenario);
      await apiSend(admin, "POST", "/admin/analytics/refresh", {});
      await admin.goto("/admin/analytics");
      // a key Google no longer accepts shows only when the Worker signs in again (the pass it already holds works for up to an hour): "Check the connection" does that
      if (scenario === "key_rejected") {
        await admin.getByText("Connection to Google").click(); // while all is well the connection is folded away
        await admin.getByRole("button", { name: "Check the connection" }).click();
      }
      const note = admin.getByRole("alert");
      await expect(note, scenario).toContainText(title);
      if (scenario !== "down") await expect(note, scenario).toContainText(google); // Google's own words are shown too
      await expect(admin.getByRole("button", { name: "Check the connection" })).toBeVisible();
      // the steps to follow are on the screen
      await expect(admin.getByText("How to connect (once, about ten minutes)")).toBeVisible();
      // the page shows no numbers while Google says no, and no key material anywhere
      await expect(admin.getByTestId("an-classes")).toHaveCount(0);
      const text = await admin.locator("main").innerText();
      expect(text).not.toContain("PRIVATE KEY");
    }
    // no_access names the address to add
    await setScenario("no_access");
    await apiSend(admin, "POST", "/admin/analytics/refresh", {});
    await admin.goto("/admin/analytics");
    await expect(admin.getByRole("alert")).toContainText("reader@mawah-e2e.iam.gserviceaccount.com");

    // fixed: press the button, and the numbers come back without leaving the page
    await setScenario("ok");
    await admin.getByRole("button", { name: "Check the connection" }).click();
    await expect(admin.getByText("Connected — Google answered.")).toBeVisible();
    await expect(admin.getByTestId("an-classes")).toBeVisible();
    // the dashboard's strip no longer complains
    await admin.goto("/admin/");
    await expect(admin.locator(".health-card", { hasText: "Analytics" })).toContainText(/Working|Notice/);
  });

  test("before the key exists the screen says what to do, step by step, and nothing breaks", async () => {
    // what the Worker answers while the secret GOOGLE_SERVICE_ACCOUNT is not set (its own logic is tested in worker/test/analytics.test.ts);
    // this test is about how the screen shows it
    await admin.route("**/api/admin/analytics/status", (route) =>
      route.fulfill({ json: { ok: true, measurement_id: GA_ID, tag_live: true, property_id: "559265538", stream_id: "16139065386", key_set: false, key_problem: null, service_email: null, last: null } }),
    );
    await admin.route("**/api/admin/analytics/report**", (route) => route.fulfill({ json: { ok: true, report: { connected: false, problem: "not_configured" } } }));
    await admin.goto("/admin/analytics");
    await expect(admin.getByRole("alert")).toContainText("Google is not connected yet");
    await expect(admin.getByText("Not set", { exact: true })).toBeVisible();
    await expect(admin.getByText("Not asked yet")).toBeVisible();
    const steps = admin.locator(".an-steps li");
    await expect(steps).toHaveCount(5);
    await expect(steps.nth(3)).toContainText("GOOGLE_SERVICE_ACCOUNT");
    // the one setting in Google Analytics that keeps the private links of live classes and groups from being reported
    await expect(admin.getByText(/“Outbound clicks” off/)).toBeVisible();
    await expect(admin.getByText("Account e-mail to add in Google Analytics")).toHaveCount(0); // there is no account yet
    const scan = await new AxeBuilder({ page: admin }).withTags(WCAG).analyze();
    expect(scan.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    await admin.unroute("**/api/admin/analytics/status");
    await admin.unroute("**/api/admin/analytics/report**");
  });
});
