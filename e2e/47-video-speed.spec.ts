import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, useLang } from "./helpers";

/*
 * Admin → Video speed, in a real browser. This copy of the site has no Cloudflare Stream (the local server leaves it out), so the page says
 * so plainly and offers nothing to press; what moving does is covered by worker/test/video-moves.test.ts. The page is in the menu, passes
 * the accessibility scan and fits a phone. Runs after the admin spec (the owner exists).
 */
test("Video speed is in the menu, says plainly that Stream is not connected here, and fits a phone", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const admin = await ctx.newPage();
  await adminLogin(admin);
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Video speed" }).click();
  await expect(admin).toHaveURL(/\/admin\/video-speed$/);
  await expect(admin.getByRole("heading", { level: 1, name: "Video speed" })).toBeVisible();
  await expect(admin.locator("p.notice[role=status]")).toContainText("Cloudflare Stream is not connected to the website yet");
  await expect(admin.getByText("Why videos stop, and the fix")).toBeVisible();
  await expect(admin.getByText(/\$5 a month for each 1,000 minutes/)).toBeVisible();
  await expect(admin.getByRole("button", { name: /Move all to Stream/ })).toHaveCount(0);
  await expect(admin.getByRole("button", { name: /^Move to Stream/ })).toHaveCount(0);

  const axe = await new AxeBuilder({ page: admin }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);

  // in Bangla, on a phone
  await admin.setViewportSize({ width: 360, height: 740 });
  await admin.getByRole("button", { name: "বাংলা" }).first().click();
  await expect(admin.getByRole("heading", { level: 1, name: "ভিডিও স্পিড" })).toBeVisible();
  expect(await admin.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await ctx.close();
});
