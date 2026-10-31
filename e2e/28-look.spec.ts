import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminLogin, agree, apiGet, apiSend, offerAnswered, TEST_ADDRESS, uniquePhone, useLang } from "./helpers";

/*
 * The dark look's working parts, in a real browser. The owner sets a countdown in Settings → Announcement bar. Visitors of a landing
 * page see it tick at the top in both languages (never on the home page), press its Join button, and see the bar go away at the end;
 * the owner can switch it off and on again. The look is flat and still: no glow, pulse or bounce anywhere. For visitors who have not asked for less motion, sections, headings and cards
 * rise 20px and fade in as they come into view (Framer Motion), and a card lifts under the pointer with an orange edge; once everything
 * is in, the page passes the accessibility scan. The class slider moves with its arrows and a mouse drag, and a drag opens nothing. The
 * talk-to-us button opens a card with WhatsApp, Messenger and the assistant, and a "back to the top" button above it appears down the
 * page. A paid order gets its check mark and confetti, and in My Learning the class's card rises in (Framer Motion).
 * The other specs run with reduced motion (playwright.config.ts); these turn it on where they need it. Runs after the admin spec (the owner exists).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
let contact: Record<string, unknown>;
/** a published landing page's address: the countdown bar is for the landing pages only */
let lp = "";
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  contact = (await apiGet<{ settings: { contact: Record<string, unknown> } }>(admin, "/admin/settings")).settings.contact;
  const made = await apiSend(admin, "POST", "/admin/landing", { title_bn: "ঈদের অফারের পাতা", title_en: `Eid offer page ${Date.now().toString(36)}`, description_bn: "", description_en: "", status: "draft" });
  const { id, slug } = (made.body as { item: { id: number; slug: string } }).item;
  const block = { type: "text", heading_bn: "অফার", heading_en: "The offer", body_bn: "তিনটি ক্লাস একসাথে।", body_en: "Three classes together." };
  expect((await apiSend(admin, "PUT", `/admin/landing/${id}/blocks`, { blocks: [block] })).status).toBe(200);
  expect((await apiSend(admin, "PATCH", `/admin/landing/${id}`, { status: "published" })).status).toBe(200);
  lp = slug;
});
test.afterAll(async () => {
  await apiSend(admin, "PUT", "/admin/settings/announcement", { bn: "", en: "" });
  await apiSend(admin, "PUT", "/admin/settings/contact", contact);
  await admin.context().close();
});

/** A minute of Bangladesh time, as the date-and-time box takes it. */
const dhakaLocal = (ms: number) => new Date(ms + 6 * 3600_000).toISOString().slice(0, 16);
async function axe(page: Page, scope?: string) {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]);
  const r = await (scope ? builder.include(scope) : builder).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
}

test("the owner sets a countdown; visitors of a landing page see it tick at the top, press Join now, and the bar goes away at the end; the home page never shows it", async ({ browser }) => {
  await admin.goto("/admin/settings");
  const form = admin.locator("form").filter({ has: admin.getByLabel("Countdown to (Bangladesh time)") });
  await form.getByLabel("Announcement (English)").fill("Eid offer: a special price on every class");
  await form.getByLabel("Announcement (বাংলা)").fill("ঈদ অফার: সব ক্লাসে বিশেষ দাম");
  await form.getByLabel("Countdown to (Bangladesh time)").fill(dhakaLocal(Date.now() + ((2 * 24 + 3) * 60 + 30) * 60_000));
  await expect(form.getByText(/^The bar counts down to /)).toBeVisible();
  await form.getByLabel("Button link").fill("/courses");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved").first()).toBeVisible();

  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  await page.clock.install();
  await page.goto(`/en/l/${lp}`);
  const timer = page.getByRole("timer", { name: /^The offer ends / });
  await expect(timer).toBeVisible();
  await expect(page.locator(".topbar-text")).toHaveText("Eid offer: a special price on every class");
  await expect(timer.locator('[data-cd="d"]')).toHaveText("02");
  await expect(timer.locator('[data-cd="h"]')).toHaveText("03");
  // it ticks
  const secs = timer.locator('[data-cd="s"]');
  const before = await secs.textContent();
  await page.clock.runFor(1000);
  await expect(secs).not.toHaveText(before!);
  // it stays at the top, with the header, while the page scrolls
  await page.mouse.wheel(0, 2500);
  await expect(page.locator(".topbar")).toBeInViewport();
  await axe(page, ".top");
  // the button goes where the owner said, in the visitor's language
  await expect(page.getByRole("link", { name: "Join now" })).toHaveAttribute("href", "/en/courses");
  // the landing pages only: the home page stays clean
  const home = await ctx.newPage();
  await home.goto("/en");
  await expect(home.locator(".site-header")).toBeVisible();
  await expect(home.locator(".topbar, .announce")).toHaveCount(0);
  await expect(home.locator("html")).not.toHaveClass(/has-topbar/);
  await home.close();
  // at the end of the offer the bar goes away by itself
  await page.clock.fastForward(60 * 3600_000); // 60 hours: past the end
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator("html")).not.toHaveClass(/has-topbar/);
  await ctx.close();

  // Bangla, on a 360 px phone: Bangla digits; the owner's words above the timer and its button, which share one row; all of it centred;
  // nothing wider than the screen
  const bn = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 760 } });
  await useLang(bn, "bn");
  await offerAnswered(bn);
  const phone = await bn.newPage();
  await phone.goto(`/l/${lp}`);
  const bnTimer = phone.getByRole("timer", { name: /^অফার শেষ হবে / });
  await expect(bnTimer.locator('[data-cd="d"]')).toHaveText("০২");
  const join = phone.getByRole("link", { name: "এখনই ভর্তি হোন" });
  await expect(join).toHaveAttribute("href", "/courses");
  const [a, b] = await Promise.all([bnTimer.boundingBox(), join.boundingBox()]);
  expect(Math.abs(a!.y + a!.height / 2 - (b!.y + b!.height / 2))).toBeLessThan(8);
  const words = phone.locator(".topbar-text");
  await expect(words).toHaveText("ঈদ অফার: সব ক্লাসে বিশেষ দাম");
  const [w, row] = await Promise.all([words.boundingBox(), phone.locator(".cd-row").boundingBox()]);
  expect(w!.y + w!.height).toBeLessThanOrEqual(row!.y + 1);
  for (const box of [w!, row!]) expect(Math.abs(box.x + box.width / 2 - 180)).toBeLessThan(3);
  // a jump to a part of the landing page lands just below the sticky top, however tall the bar is on this phone
  await expect.poll(() => phone.evaluate(() => document.documentElement.style.getPropertyValue("--top-h"))).toMatch(/^\d+px$/);
  const landing = await phone.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    document.body.append(Object.assign(document.createElement("div"), { style: "height:2000px" })); // room below, whatever the page's length
    const part = document.querySelector(".lp-text")!;
    part.scrollIntoView();
    return part.getBoundingClientRect().top - document.querySelector(".top")!.getBoundingClientRect().bottom;
  });
  expect(landing).toBeGreaterThanOrEqual(0);
  expect(landing).toBeLessThan(24);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await axe(phone, ".top");
  await bn.close();
});

test("the owner switches the countdown bar off and on again in Settings (Active / Inactive); its words and time stay for next time", async ({ browser }) => {
  const words = "Eid offer: a special price on every class";
  expect((await apiSend(admin, "PUT", "/admin/settings/announcement", { bn: "ঈদ অফার: সব ক্লাসে বিশেষ দাম", en: words, ends_at: dhakaLocal(Date.now() + 2 * 24 * 3600_000), link: "/courses" })).status).toBe(200);
  await admin.goto("/admin/settings");
  const form = admin.locator("form").filter({ has: admin.getByLabel("Countdown to (Bangladesh time)") });
  const on = form.getByRole("switch", { name: "Show the bar on the landing pages" });
  const save = () =>
    Promise.all([
      admin.waitForResponse((r) => r.url().endsWith("/api/admin/settings/announcement") && r.request().method() === "PUT" && r.ok()),
      form.getByRole("button", { name: "Save" }).click(),
    ]);
  await expect(on).toBeChecked();
  await expect(form.getByText("Active", { exact: true })).toBeVisible();
  await on.locator("xpath=ancestor::label").click();
  await expect(on).not.toBeChecked();
  await expect(form.getByText("Inactive", { exact: true })).toBeVisible();
  await save();

  // visitors of the landing page: no bar at all
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  await page.goto(`/en/l/${lp}`);
  await expect(page.locator(".site-header")).toBeVisible();
  await expect(page.locator(".topbar, .announce")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/has-topbar/);
  // the words and the time are still there for next time
  await admin.reload();
  await expect(form.getByLabel("Announcement (English)")).toHaveValue(words);
  await expect(form.getByLabel("Countdown to (Bangladesh time)")).not.toHaveValue("");
  await expect(on).not.toBeChecked();

  // on again: the same bar, ticking
  await on.locator("xpath=ancestor::label").click();
  await expect(form.getByText("Active", { exact: true })).toBeVisible();
  await save();
  await page.reload();
  await expect(page.getByRole("timer", { name: /^The offer ends / })).toBeVisible();
  await expect(page.locator(".topbar-text")).toHaveText(words);
  await ctx.close();
});

test("with motion on, sections and cards rise in as they come into view, buttons stay still and flat, a card lifts under the pointer, and the page passes the scan", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", reducedMotion: "no-preference" });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text())); // a style the security policy refused would show here
  await page.goto("/en");
  await expect(page.locator("html")).toHaveClass(/\bmotion\b/);
  const cta = page.getByRole("link", { name: "Browse classes" });
  // a solid orange button: no glow, no pulse; the floating buttons do not bounce
  expect(await cta.evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).boxShadow, getComputedStyle(el).backgroundImage])).toEqual(["none", "none", "none"]);
  expect(await cta.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 87, 34)");
  expect(await page.locator(".floats .fab").last().evaluate((el) => getComputedStyle(el, "::before").animationName)).toBe("none");
  // the page is one flat colour: no picture, gradient or pattern behind the hero
  expect(await page.locator(".hero").evaluate((el) => [getComputedStyle(el).backgroundImage, getComputedStyle(el, "::before").content])).toEqual(["none", "none"]);
  // what is on screen at once is never hidden; what is further down waits for the visitor, 20px lower and transparent
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("opacity", "1");
  const how = page.locator(".sec-head", { hasText: "How it works" });
  await expect(how).toHaveClass(/\brv\b/);
  await expect(how).toHaveCSS("opacity", "0");
  await expect(how).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 20)");
  for (let y = 0; y < 9000; y += 500) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(80);
  }
  await expect(page.locator(".rv")).toHaveCount(0, { timeout: 15_000 });
  await expect(how).toHaveCSS("opacity", "1");
  await expect(how).toHaveCSS("transform", "none");
  // the animation leaves nothing behind: every element is back to its own CSS (so a card's hover works)
  expect(await page.locator("main [style*='opacity'], main [style*='transform']").count()).toBe(0);
  const card = page.locator(".grid>.card").first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await expect(card).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -6)");
  await expect(card).toHaveCSS("border-top-color", "rgba(255, 87, 34, 0.55)");
  // the pointer on the main button: a small, crisp shadow — only then
  await cta.scrollIntoViewIfNeeded();
  await cta.hover();
  await expect(cta).toHaveCSS("box-shadow", "rgba(255, 87, 34, 0.55) 0px 4px 12px -4px");
  expect(errors).toEqual([]);
  await page.mouse.move(0, 0);
  await axe(page);
  // a pulsing button stays exactly where it is: it can be pressed
  await page.mouse.wheel(0, -20_000);
  await cta.click();
  await expect(page).toHaveURL(/\/en\/courses$/);
  await ctx.close();
});

test("the class slider moves with its arrows and with a mouse drag, and a drag opens nothing", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 780 } });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  await page.goto("/en");
  const slider = page.getByRole("region", { name: "New to the kitchen? Start here" });
  await slider.scrollIntoViewIfNeeded();
  const track = slider.locator(".car-track");
  const prev = slider.getByRole("button", { name: "Show the previous ones" });
  const next = slider.getByRole("button", { name: "Show more" });
  await expect(next).toBeVisible();
  await expect(prev).toBeDisabled();
  await next.click();
  await expect.poll(() => track.evaluate((t) => t.scrollLeft)).toBeGreaterThan(100);
  await expect(prev).toBeEnabled();
  const at = await track.evaluate((t) => t.scrollLeft);
  // the whole row on screen, clear of the sticky header; the drag starts and ends on the cards' picture links
  await track.evaluate((t) => t.scrollIntoView({ block: "center" }));
  const box = (await track.boundingBox())!;
  const y = box.y + 120;
  await page.mouse.move(box.x + box.width * 0.75, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => track.evaluate((t) => t.scrollLeft)).toBeGreaterThan(at + 50);
  await expect(page).toHaveURL(/\/en$/); // the drag ended on a card's link, and opened nothing
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await ctx.close();
});

test("the talk-to-us button opens a card with WhatsApp, Messenger and the assistant; Escape or a click elsewhere closes it", async ({ browser }) => {
  await apiSend(admin, "PUT", "/admin/settings/contact", { ...contact, whatsapp: "01711000000", facebook: "https://www.facebook.com/mawahacademy", messenger: "" });
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  await page.goto("/en");
  const open = page.locator("summary.fab-help");
  await expect(open).toHaveAttribute("aria-label", "Talk to us: WhatsApp, Messenger or our assistant");
  const card = page.getByRole("group", { name: "Talk to us" });
  await expect(card).toBeHidden();
  await open.click();
  await expect(card).toBeVisible();
  const ms = card.getByRole("link", { name: /^Messenger/ });
  await expect(ms).toHaveAttribute("href", "https://m.me/mawahacademy");
  await expect(ms).toHaveAttribute("target", "_blank");
  await expect(card.getByRole("link", { name: /^WhatsApp/ })).toHaveAttribute("href", /^https:\/\/wa\.me\/8801711000000\?text=/); // typed 017…: WhatsApp needs the country code
  await expect(card.getByRole("button", { name: /^AI assistant/ })).toBeVisible();
  // the card stays inside the screen, above its button
  const [c, b] = await Promise.all([card.boundingBox(), open.boundingBox()]);
  expect(c!.y + c!.height).toBeLessThanOrEqual(b!.y);
  expect(c!.x).toBeGreaterThanOrEqual(0);
  // Escape closes it and gives the focus back to the button; a click elsewhere closes it too
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await expect(card).toBeVisible();
  await page.locator("h1").click();
  await expect(card).toBeHidden();
  // the assistant opens its window, and the round buttons step aside so they never cover its Send button
  await open.click();
  await card.getByRole("button", { name: /^AI assistant/ }).click();
  const chat = page.getByRole("dialog", { name: /assistant/i });
  await expect(chat).toBeVisible();
  await expect(card).toBeHidden();
  await expect(page.locator(".floats")).toBeHidden();
  await chat.getByRole("button", { name: /close/i }).click();
  await expect(page.locator(".floats")).toBeVisible();
  await page.goto("/");
  await page.locator("summary.fab-help").click();
  await expect(page.getByRole("group", { name: "আমাদের সাথে কথা বলুন" }).getByRole("link", { name: /^মেসেঞ্জার/ })).toBeVisible();
  await ctx.close();
});

test("the back-to-the-top button appears once the visitor is well down the page and takes them back up, and the focus too from the keyboard", async ({ browser }) => {
  await apiSend(admin, "PUT", "/admin/settings/contact", { ...contact, whatsapp: "01711000000" });
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 390, height: 844 } });
  await useLang(ctx, "bn");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  await page.goto("/");
  const toTop = page.getByRole("link", { name: "উপরে ফিরে যান" });
  await expect(toTop).toBeHidden(); // at the top of the page there is nothing to go back to
  const down = () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const scrolled = () => page.evaluate(() => Math.round(window.scrollY));
  await down();
  await expect(toTop).toBeVisible();
  // it floats above the talk-to-us button, in the same column
  const [a, b] = await Promise.all([toTop.boundingBox(), page.locator(".floats > :last-child").boundingBox()]);
  expect(a!.y + a!.height).toBeLessThan(b!.y);
  expect(Math.abs(a!.x + a!.width / 2 - (b!.x + b!.width / 2))).toBeLessThan(2);
  await toTop.click();
  await expect.poll(scrolled).toBe(0);
  await expect(toTop).toBeHidden();
  await expect(page).toHaveURL(/\/$/); // no "#top" left in the address
  // from the keyboard, the focus goes back up too: the next Tab starts at the top of the page
  await down();
  await expect(toTop).toBeVisible();
  await toTop.focus();
  await page.keyboard.press("Enter");
  await expect.poll(scrolled).toBe(0);
  await expect(page.locator(".site-header .brand")).toBeFocused();
  await ctx.close();
});

test("a paid order: the check mark draws itself, with a burst of confetti", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", reducedMotion: "no-preference" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/app/checkout?c=beginners-baking-class");
  await page.getByLabel(/^Full name/).fill("Mitu Akter");
  await page.getByLabel(/^Mobile number/).fill(uniquePhone());
  await page.getByLabel(/^Address/).fill(TEST_ADDRESS);
  await page.getByText("Test payment").click();
  await agree(page);
  await page.getByRole("button", { name: /^Pay ৳400/ }).click();
  await page.getByRole("button", { name: "Simulate successful payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  const mark = page.locator(".success-mark");
  await expect(mark).toBeVisible();
  expect(await mark.locator("path").evaluate((el) => getComputedStyle(el).animationName)).toBe("sm-draw");
  await expect(mark.locator(".confetti i")).toHaveCount(14);
  expect(await mark.locator(".confetti i").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("sm-burst");
  await axe(page, "main");
  // My Learning: the class's card rises into view (Framer Motion) and ends exactly in place; under the pointer it lifts 6px
  await page.goto("/app/");
  const card = page.locator(".grid .card", { hasText: "Beginners Baking Class" });
  await expect(card).toBeVisible();
  const cell = card.locator("xpath=.."); // the block that rises in: the card's own wrapper in the grid
  await expect(cell).toHaveClass(/\breveal\b/);
  await expect(cell).toHaveCSS("opacity", "1");
  await expect(cell).toHaveCSS("transform", "none");
  await card.hover();
  await expect(card).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -6)");
  await ctx.close();
});
