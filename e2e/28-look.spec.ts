import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminLogin, agree, apiGet, apiSend, TEST_ADDRESS, uniquePhone, useLang } from "./helpers";

/*
 * The dark look's working parts, in a real browser. The owner sets a countdown in Settings → Announcement bar. Visitors see it tick at the
 * top in both languages, press its Join button, and see the bar go away at the end. The look is flat and still: no glow, pulse or
 * bounce anywhere. For visitors who have not asked for less motion, sections, headings and cards rise 20px and fade in as they come into
 * view (Framer Motion), and a card lifts under the pointer with an orange edge; once everything is in, the page passes the accessibility
 * scan. The class slider moves with its arrows and a mouse drag, and a drag opens nothing. The Messenger button floats with WhatsApp. A
 * paid order gets its check mark and confetti, and in My Learning the class's card rises in (Framer Motion).
 * The other specs run with reduced motion (playwright.config.ts); these turn it on where they need it. Runs after the admin spec (the owner exists).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
let contact: Record<string, unknown>;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  contact = (await apiGet<{ settings: { contact: Record<string, unknown> } }>(admin, "/admin/settings")).settings.contact;
});
test.afterAll(async () => {
  await apiSend(admin, "PUT", "/admin/settings/announcement", { bn: "", en: "" });
  await apiSend(admin, "PUT", "/admin/settings/contact", contact);
  await admin.context().close();
});

/**
 * The banners spec leaves an offer pop-up on the home page: a second after arrival it covers the page (as it should) and the page stops
 * scrolling. These tests look at what is under it, so a visitor here has already answered it, the way the pop-up itself remembers.
 */
async function offerAnswered(ctx: BrowserContext) {
  const html = await (await ctx.request.get("/en")).text();
  const tag = /<div class="offer"[^>]*>/.exec(html)?.[0];
  if (!tag) return;
  const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
  const [id, v, days] = [attr("data-id"), attr("data-v"), attr("data-days")];
  expect(id, "the pop-up names itself").toMatch(/^\d+$/);
  await ctx.addInitScript(
    ([key, value, persist]) => {
      try {
        (persist ? localStorage : sessionStorage).setItem(key, value);
      } catch {
        /* no storage: the pop-up simply shows */
      }
    },
    [`mawah_offer_${id}`, JSON.stringify({ v, t: Date.now() }), Number(days) > 0] as const,
  );
}

/** A minute of Bangladesh time, as the date-and-time box takes it. */
const dhakaLocal = (ms: number) => new Date(ms + 6 * 3600_000).toISOString().slice(0, 16);
async function axe(page: Page, scope?: string) {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]);
  const r = await (scope ? builder.include(scope) : builder).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
}

test("the owner sets a countdown; visitors see it tick at the top, press Join now, and the bar goes away at the end", async ({ browser }) => {
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
  await page.goto("/en");
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
  // at the end of the offer the bar goes away by itself
  await page.clock.fastForward(60 * 3600_000); // 60 hours: past the end
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator("html")).not.toHaveClass(/has-topbar/);
  await ctx.close();

  // Bangla, on a 360 px phone: Bangla digits, the timer and its button on one row, nothing wider than the screen
  const bn = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 760 } });
  await useLang(bn, "bn");
  await offerAnswered(bn);
  const phone = await bn.newPage();
  await phone.goto("/");
  const bnTimer = phone.getByRole("timer", { name: /^অফার শেষ হবে / });
  await expect(bnTimer.locator('[data-cd="d"]')).toHaveText("০২");
  const join = phone.getByRole("link", { name: "এখনই ভর্তি হোন" });
  await expect(join).toHaveAttribute("href", "/courses");
  const [a, b] = await Promise.all([bnTimer.boundingBox(), join.boundingBox()]);
  expect(Math.abs(a!.y + a!.height / 2 - (b!.y + b!.height / 2))).toBeLessThan(8);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await axe(phone, ".top");
  await bn.close();
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
  expect(await page.locator(".fab-chat").evaluate((el) => getComputedStyle(el, "::before").animationName)).toBe("none");
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

test("the Messenger button floats with WhatsApp once the Facebook page is set, in both languages", async ({ browser }) => {
  await apiSend(admin, "PUT", "/admin/settings/contact", { ...contact, whatsapp: "01711000000", facebook: "https://www.facebook.com/mawahacademy" });
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  await page.goto("/en");
  const ms = page.getByRole("link", { name: "Chat on Messenger" });
  await expect(ms).toHaveAttribute("href", "https://m.me/mawahacademy");
  await expect(ms).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Chat on WhatsApp" }).last()).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "মেসেঞ্জারে কথা বলুন" })).toBeVisible();
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
  // My Learning: the class's card rises into view (Framer Motion) and ends exactly in place; under the pointer it lifts 8px
  await page.goto("/app/");
  const card = page.locator(".grid .card", { hasText: "Beginners Baking Class" });
  await expect(card).toBeVisible();
  const cell = page.locator(".grid>.reveal").filter({ has: card });
  await expect(cell).toHaveCSS("opacity", "1");
  await expect(cell).toHaveCSS("transform", "none");
  await card.hover();
  await expect(card).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -6)");
  await ctx.close();
});
