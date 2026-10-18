import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiSend, useLang } from "./helpers";

/*
 * The policy and help pages a buyer (and SSLCommerz) looks for: refund, privacy, terms, how to order, the user guide and the hotline — in
 * both languages, readable on a phone, linked from every page's footer, and each ending with how to reach the shop (Settings → Contact).
 * Runs after the admin spec (the owner exists).
 */

const PAGES: [string, string][] = [
  ["/how-to-order", "কীভাবে অর্ডার করবেন"],
  ["/guide", "ব্যবহার নির্দেশিকা"],
  ["/hotline", "হট লাইন"],
  ["/policies/refund", "রিফান্ড নীতি"],
  ["/policies/privacy", "গোপনীয়তা নীতি"],
  ["/policies/terms", "ব্যবহারের শর্তাবলি"],
  ["/en/how-to-order", "How to order"],
  ["/en/guide", "User guide"],
  ["/en/hotline", "Hotline"],
  ["/en/policies/refund", "Refund policy"],
  ["/en/policies/privacy", "Privacy policy"],
  ["/en/policies/terms", "Terms of use"],
];

type Contact = { whatsapp: string; phone: string; email: string; facebook: string; youtube: string; instagram: string };

test("each policy and help page reads in both languages with headings, passes the accessibility scan, fits a phone, and ends with how to reach us", async ({ browser }) => {
  // the contact details the pages show (and put back as they were afterwards)
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const admin = await ctx.newPage();
  await adminLogin(admin);
  const before = (await apiGet<{ settings: { contact: Contact } }>(admin, "/admin/settings")).settings.contact;
  expect((await apiSend(admin, "PUT", "/admin/settings/contact", { ...before, phone: "09613-754321", whatsapp: "+880 13 0405 0584", email: "info@mawahbd.com" })).status).toBe(200);

  try {
    const page = await ctx.newPage();
    for (const [path, title] of PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title }), path).toBeVisible();
      await expect(page.locator(".prose :is(h2, h3)").first(), path).toBeVisible(); // a page of sections, not one block of text
      await expect(page.locator(".prose"), path).not.toContainText("**"); // Markdown is shown as a page
      const box = page.locator(".page-contact");
      await expect(box.getByRole("link", { name: /09613-754321/ }), path).toHaveAttribute("href", "tel:09613754321");
      await expect(box.getByRole("link", { name: /WhatsApp|হোয়াটসঅ্যাপ/ }), path).toHaveAttribute("href", /^https:\/\/wa\.me\/8801304050584/);
      await expect(box.getByRole("link", { name: /info@mawahbd\.com/ }), path).toHaveAttribute("href", "mailto:info@mawahbd.com");
      const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path} ${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
    }
    // the hotline page shows the numbers first
    await page.goto("/hotline");
    const first = await page.locator(".page-contact").boundingBox();
    const words = await page.locator(".prose").boundingBox();
    expect(first!.y).toBeLessThan(words!.y);

    // a phone: nothing wider than the screen
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of ["/how-to-order", "/hotline", "/en/policies/terms"]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), path).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // every page's footer links them
    await page.goto("/en/courses");
    const footer = page.locator("footer");
    for (const name of ["How to order", "User guide", "Hotline", "Refund policy", "Privacy policy", "Terms of use"]) await expect(footer.getByRole("link", { name, exact: true })).toBeVisible();
    await footer.getByRole("link", { name: "How to order", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/how-to-order$/);
  } finally {
    expect((await apiSend(admin, "PUT", "/admin/settings/contact", before)).status).toBe(200);
    await ctx.close();
  }
});
