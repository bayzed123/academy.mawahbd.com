import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiPost, STAFF, useLang } from "./helpers";

/*
 * Two things the owner asked for. (1) The footer's "We accept" row shows the real marks — the owner's bKash, Nagad and Rocket
 * pictures plus Visa and Mastercard — sharp, small, with the developer credit and the rights line under it. (2) A way to see
 * whether e-mail really goes out: Settings → E-mail → "Send me a test e-mail", with the answer in plain words. Resend itself is
 * not reachable from a test, so the failure texts are checked by answering the button's request the way the Worker would.
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
});
test.afterAll(async () => admin.context().close());

test("the footer shows the five payment marks as real, sharp pictures with the developer credit under them — English and Bangla", async ({ browser }) => {
  for (const [lang, path, names, accept, rights, developed] of [
    ["en-US", "/en", ["bKash", "Nagad", "Rocket", "Visa", "Mastercard"], "We accept", "All rights reserved.", "Developed by"],
    ["bn-BD", "/", ["বিকাশ", "নগদ", "রকেট", "ভিসা", "মাস্টারকার্ড"], "আমরা গ্রহণ করি", "সর্বস্বত্ব সংরক্ষিত", "ডেভেলপ করেছেন"],
  ] as const) {
    const ctx = await browser.newContext({ locale: lang, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(path);
    const row = page.getByRole("list", { name: accept });
    await row.scrollIntoViewIfNeeded();
    const imgs = row.locator("img");
    await expect(imgs).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      const img = imgs.nth(i);
      await expect(img).toHaveAttribute("alt", names[i]);
      // loaded for real (the owner's pictures, not a broken link) …
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      // … shown small (24px tall) from a file at least twice that tall, so it stays sharp on a phone
      expect(await img.evaluate((el: HTMLImageElement) => Math.round(el.getBoundingClientRect().height))).toBe(24);
      if (!(await img.getAttribute("src"))!.endsWith(".svg")) expect(await img.evaluate((el: HTMLImageElement) => el.naturalHeight)).toBeGreaterThanOrEqual(48);
    }
    // each mark sits on a white badge so the different colours read on the black footer
    expect(await row.locator("li").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");

    const bottom = page.locator(".foot-bottom");
    await expect(bottom).toContainText(rights);
    await expect(bottom).toContainText(developed);
    const credit = bottom.getByRole("link", { name: /Sayad Bayezid/ });
    await expect(credit).toHaveAttribute("href", "https://sayadbayezid.com");
    await expect(credit).toHaveAttribute("target", "_blank");
    await expect(credit).toHaveAttribute("rel", "noopener noreferrer");
    await ctx.close();
  }
});

test("the footer fits a phone and passes the accessibility scan", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/en");
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  for (const img of await page.locator(".pay-logos img").all()) {
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const box = await img.boundingBox();
    expect(box!.x + box!.width, "inside the screen").toBeLessThanOrEqual(360);
  }
  const axe = await new AxeBuilder({ page }).include(".site-footer").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await ctx.close();
});

test("Settings → E-mail: the test button works, says where the message went, and remembers the result", async () => {
  await admin.goto("/admin/settings?tab=email");
  await expect(admin.getByRole("heading", { name: "E-mail sending" })).toBeVisible();
  // this is a test copy of the site: no Resend key, so the message goes to the local test inbox
  await expect(admin.getByText("Local test inbox")).toBeVisible();
  await expect(admin.getByText(`It goes to your own address (${STAFF.email}) only.`)).toBeVisible();

  await admin.getByRole("button", { name: "Send me a test e-mail" }).click();
  await expect(admin.getByText("Saved in the local test inbox")).toBeVisible();
  await expect(admin.getByText(/Worked — /)).toBeVisible();

  // it really was addressed to the signed-in person
  const box = await apiGet<{ messages: { to: string; subject: string }[] }>(admin, `/dev/outbox?to=${encodeURIComponent(STAFF.email)}`);
  expect(box.messages.at(-1)).toMatchObject({ to: STAFF.email });
  expect(box.messages.at(-1)!.subject).toContain("Test e-mail");

  // the dashboard's "Connect email" first step now leads to this tab
  await admin.goto("/admin/");
  const step = admin.locator("ol.steps li", { hasText: "Connect email" });
  await expect(step.getByRole("link", { name: "Do it" })).toHaveAttribute("href", /settings\?tab=email/);
});

test("a refusal is explained in plain words with the steps, in English and Bangla — and Resend's own words are shown", async () => {
  const refuse = (body: Record<string, unknown>) =>
    admin.route("**/api/admin/settings/email/test", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, at: new Date().toISOString(), by: "Owner Test", to: STAFF.email, from: "MAWAH Academy <no-reply@mawahacademy.com>", domain: "mawahacademy.com", ...body }) }),
    );

  await refuse({ sent: false, provider: "resend", problem: "domain_not_verified", status: 403, detail: "The mawahacademy.com domain is not verified. Please, add and verify your domain on https://resend.com/domains" });
  await admin.goto("/admin/settings?tab=email");
  await admin.getByRole("button", { name: "Send me a test e-mail" }).click();
  const alert = admin.getByRole("alert");
  await expect(alert).toContainText("Resend does not know mawahacademy.com yet");
  await expect(alert).toContainText("Add Domain");
  await expect(alert).toContainText("DNS only");
  await expect(alert).toContainText("Resend says: The mawahacademy.com domain is not verified.");
  await expect(alert).toContainText("(403)");
  await expect(alert).toContainText("press “Send me a test e-mail” again");

  const axe = await new AxeBuilder({ page: admin }).include(".panel").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // another refusal replaces the first one (a key that Resend does not accept)
  await admin.unroute("**/api/admin/settings/email/test");
  await refuse({ sent: false, provider: "resend", problem: "key_invalid", status: 401, detail: "API key is invalid" });
  await admin.getByRole("button", { name: "Send me a test e-mail" }).click();
  await expect(admin.getByRole("alert")).toContainText("Resend did not accept the key");
  await expect(admin.getByRole("alert")).not.toContainText("Add Domain");

  // the same screen in Bangla
  await admin.unroute("**/api/admin/settings/email/test");
  await refuse({ sent: false, provider: "resend", problem: "domain_not_verified", status: 403, detail: "The mawahacademy.com domain is not verified." });
  await admin.getByRole("banner").getByRole("button", { name: "বাংলা" }).click();
  await expect(admin.getByRole("heading", { name: "ইমেইল পাঠানো" })).toBeVisible();
  await admin.getByRole("button", { name: "আমাকে একটি পরীক্ষামূলক ইমেইল পাঠান" }).click();
  await expect(admin.getByRole("alert")).toContainText("Resend এখনো mawahacademy.com চেনে না");
  await expect(admin.getByRole("alert")).toContainText("Resend বলছে:");
  await admin.unroute("**/api/admin/settings/email/test");
  await admin.getByRole("banner").getByRole("button", { name: "English" }).click();
});

test.describe("Settings → E-mail → Notifications to you", () => {
  const OWNER_INBOX = "mawahacademy@gmail.com";
  const panel = () => admin.locator(".notify-panel");
  const inbox = async (to: string) => (await apiGet<{ messages: { to: string; subject: string; text?: string; owner?: boolean; replyTo?: string }[] }>(admin, `/dev/outbox?to=${encodeURIComponent(to)}`)).messages;

  test("by default every kind is on and everything goes to the shop's Gmail; the test notification arrives there", async () => {
    await admin.goto("/admin/settings?tab=email");
    await expect(panel().getByRole("heading", { name: "Notifications to you" })).toBeVisible();
    await expect(panel().getByText(`Now going to: ${OWNER_INBOX}`)).toBeVisible();

    // all ten kinds are switched on, each with a sentence that says what it is
    const switches = panel().getByRole("switch");
    await expect(switches).toHaveCount(10);
    for (const sw of await switches.all()) await expect(sw).toBeChecked();
    await expect(panel().getByRole("switch", { name: "a payment needs my check" })).toBeChecked();
    await expect(panel().getByText("A student sent a TrxID or a screenshot for a send-money payment.")).toBeVisible();

    const before = (await inbox(OWNER_INBOX)).length;
    await panel().getByRole("button", { name: "Send a test notification" }).click();
    await expect(panel().getByText(`Sent to ${OWNER_INBOX}.`)).toBeVisible();
    const after = await inbox(OWNER_INBOX);
    expect(after.length).toBe(before + 1);
    const note = after.at(-1)!;
    expect(note.subject).toContain("TEST");
    expect(note.text).toContain("This is only a test");
    expect(note.owner).toBe(true);
  });

  test("another address replaces the default, a bad one is explained, a kind can be switched off and on, and the default comes back", async () => {
    await admin.goto("/admin/settings?tab=email");
    const field = panel().getByLabel("Send notifications to");

    // a mistyped address is refused with a plain sentence, and nothing is saved
    await field.fill("not-an-address");
    await panel().getByRole("button", { name: "Save the addresses" }).click();
    await expect(panel().getByText("Please enter a valid email address.")).toBeVisible();
    await expect(panel().getByText(`Now going to: ${OWNER_INBOX}`)).toBeVisible();

    // two addresses: both get the test note
    await field.fill("second@e2e.test, third@e2e.test");
    await panel().getByRole("button", { name: "Save the addresses" }).click();
    await expect(panel().getByText("Now going to: second@e2e.test, third@e2e.test")).toBeVisible();
    const [secondBefore, thirdBefore] = [(await inbox("second@e2e.test")).length, (await inbox("third@e2e.test")).length];
    await panel().getByRole("button", { name: "Send a test notification" }).click();
    await expect(panel().getByText("Sent to second@e2e.test.")).toBeVisible();
    await expect(panel().getByText("Sent to third@e2e.test.")).toBeVisible();
    expect((await inbox("second@e2e.test")).at(-1)!.subject).toContain("TEST");
    expect(await inbox("second@e2e.test")).toHaveLength(secondBefore + 1);
    expect(await inbox("third@e2e.test")).toHaveLength(thirdBefore + 1);

    // a kind is switched off: it is saved (a reload shows it), and the other nine stay on
    await panel().locator("label.switch", { hasText: "someone sends a message" }).click();
    await expect(panel().getByRole("switch", { name: "someone sends a message" })).not.toBeChecked();
    await admin.reload();
    await expect(panel().getByRole("switch", { name: "someone sends a message" })).not.toBeChecked();
    await expect(panel().getByRole("switch", { checked: true })).toHaveCount(9);
    expect((await apiGet<{ notify: { off: string[] } }>(admin, "/admin/settings/email")).notify.off).toEqual(["contact_message"]);

    // …and back on; an empty list means "use the shop's Gmail again"
    await panel().locator("label.switch", { hasText: "someone sends a message" }).click();
    await expect(panel().getByRole("switch", { checked: true })).toHaveCount(10);
    await panel().getByLabel("Send notifications to").fill("");
    await panel().getByRole("button", { name: "Save the addresses" }).click();
    await expect(panel().getByText(`Now going to: ${OWNER_INBOX}`)).toBeVisible();
  });

  test("a message from the contact page reaches the shop's Gmail with the sender's details, and replies go to the Gmail", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "en-US" });
    const visitor = await ctx.newPage();
    await visitor.goto("/en");
    const sent = await apiPost(visitor, "/contact", { name: "Notice Tester", email: "notice-tester@e2e.test", phone: "", message: "Is there a beginners class in Chattogram?", lang: "en" });
    expect(sent.status).toBe(200);
    await ctx.close();

    await expect
      .poll(async () => (await inbox(OWNER_INBOX)).some((m) => m.subject.includes("Notice Tester")), { message: "the owner's copy of the contact message" })
      .toBe(true);
    const note = (await inbox(OWNER_INBOX)).filter((m) => m.subject.includes("Notice Tester")).at(-1)!;
    expect(note.text).toContain("notice-tester@e2e.test");
    expect(note.text).toContain("Is there a beginners class in Chattogram?");
    expect(note.text).toContain("/admin/messages");
    // the sender also got the usual thank-you note
    await expect.poll(async () => (await inbox("notice-tester@e2e.test")).length).toBeGreaterThan(0);
  });

  test("the panel is readable in Bangla and passes the accessibility scan", async () => {
    await admin.goto("/admin/settings?tab=email");
    await expect(panel().getByRole("heading", { name: "Notifications to you" })).toBeVisible();
    const axe = await new AxeBuilder({ page: admin }).include(".notify-panel").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

    await admin.getByRole("banner").getByRole("button", { name: "বাংলা" }).click();
    await expect(panel().getByRole("heading", { name: "আপনার কাছে নোটিফিকেশন" })).toBeVisible();
    await expect(panel().getByRole("switch", { name: "পেমেন্ট আমার যাচাইয়ের অপেক্ষায় থাকলে" })).toBeChecked();
    await expect(panel().getByRole("button", { name: "একটি পরীক্ষামূলক নোটিফিকেশন পাঠান" })).toBeVisible();
    await admin.getByRole("banner").getByRole("button", { name: "English" }).click();
    await expect(panel().getByRole("heading", { name: "Notifications to you" })).toBeVisible();
  });
});
