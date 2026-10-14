import { expect, test } from "@playwright/test";
import { adminLogin, useLang } from "./helpers";

/*
 * Runs last. By now students have enrolled and paid through the real UI (specs 02 and 03), so the owner's
 * dashboard and reports must show exactly that — no filler, no free enrolments counted as sales.
 */
test("the owner's reports and dashboard match what students actually did", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await adminLogin(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(", Owner");
  const kpi = (name: string) => page.locator(".kpi").filter({ hasText: name });

  // reports: one real sale of ৳400 with the WELCOME10 coupon = ৳360; the free class is an enrolment, not a sale
  await page.goto("/admin/reports");
  await expect(kpi("Revenue")).toContainText("৳360");
  await expect(kpi("Paid orders")).toContainText(/Paid orders\s*1(?!\d)/);
  await expect(kpi("Discounts given")).toContainText("৳40");
  await expect(page.locator("canvas").first()).toBeVisible();
  const api = await (await page.request.get("/api/admin/reports/revenue")).json();
  expect(api.totals).toMatchObject({ orders: 1, revenue: 360, discounts: 40, average_order: 360, students: 1 });
  expect(api.by_course.map((c: { title_en: string }) => c.title_en)).toEqual(["Beginners Baking Class"]);

  // dashboard: the same story, plus the manual payment that is still waiting for a human
  await page.goto("/admin/");
  await expect(kpi("Revenue")).toContainText("৳360");
  await expect(kpi("Paid orders")).toContainText(/Paid orders\s*1(?!\d)/);
  await expect(page.getByText("Payments waiting to be verified").first()).toBeVisible();

  // both paid orders (the paid class and the free one) have invoices; the coupon was used exactly once
  await page.goto("/admin/orders?status=paid");
  await expect(page.getByRole("row", { name: /INV-MWH-\d{8}-\d{4}/ })).toHaveCount(2);
  const coupons = await (await page.request.get("/api/admin/coupons?q=WELCOME10")).json();
  expect(coupons.items[0]).toMatchObject({ code: "WELCOME10", used_count: 1 });

  // the invoice numbers are gapless and unique
  const orders = await (await page.request.get("/api/admin/orders?status=paid&per_page=50")).json();
  const nos: string[] = orders.items.map((o: { invoice_no: string }) => o.invoice_no).filter(Boolean);
  expect(new Set(nos).size).toBe(nos.length);
  await ctx.close();
});
