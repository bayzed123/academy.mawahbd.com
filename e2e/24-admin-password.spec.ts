import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiPost, uniqueEmail, useLang } from "./helpers";

/*
 * Every team member — the owner too — can change their own password from the admin (right panel → "Change password"): the current one is
 * asked first, the new one must differ, other phones and computers are signed out, and the old password stops working at once.
 * Runs after the admin spec (the owner exists); it changes the password of a team member it makes, never the owner's.
 */

test("a team member changes their own password: the current one first, then a different one; the old one stops working and other devices are signed out", async ({ browser }) => {
  // the owner adds a team member (who chooses their own password at first sign-in, as before)
  const ownerCtx = await browser.newContext({ locale: "en-US" });
  await useLang(ownerCtx, "en");
  const owner = await ownerCtx.newPage();
  await adminLogin(owner);
  const email = uniqueEmail("pw-change");
  const made = await apiPost(owner, "/admin/staff", { name: "Password Pia", email, role: "content_manager" });
  expect(made.status).toBe(201);
  const temp = (made.body as { temp_password: string }).temp_password;
  await ownerCtx.close();

  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await adminLogin(page, { email, password: temp });
  await page.getByLabel("Temporary password").fill(temp);
  await page.getByLabel("New password").fill("first-own-secret-11");
  await page.getByRole("button", { name: "Save" }).click();

  // a second device, signed in with the same password
  const other = await browser.newContext({ locale: "en-US" });
  await useLang(other, "en");
  const phone = await other.newPage();
  await adminLogin(phone, { email, password: "first-own-secret-11" });
  await expect(phone.getByRole("navigation", { name: "Admin" })).toBeVisible();

  // right panel → Change password
  await page.locator(".account").getByRole("link", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/admin\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "My account" })).toBeVisible();
  await expect(page.locator(".kv-grid")).toContainText("Password Pia");
  await expect(page.locator(".kv-grid")).toContainText(email);
  await expect(page.locator(".kv-grid")).toContainText("Content Manager");

  const save = page.getByRole("button", { name: "Change password" });
  await save.click();
  await expect(page.getByText("This field is required.")).toHaveCount(2);
  await expect(page.getByLabel("Current password")).toBeFocused();

  await page.getByLabel("Current password").fill("not-my-password-00");
  await page.getByLabel("New password").fill("second-own-secret-22");
  await save.click();
  await expect(page.getByText("That is not your current password.")).toBeVisible();
  await expect(page.getByLabel("Current password")).toBeFocused();

  await page.getByLabel("Current password").fill("first-own-secret-11");
  await page.getByLabel("New password").fill("first-own-secret-11");
  await save.click();
  await expect(page.getByText("Please choose a different password.")).toBeVisible();

  await page.getByLabel("New password").fill("second-own-secret-22");
  await save.click();
  await expect(page.getByText("Password changed. Use the new one from now on.")).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveValue("");
  await expect(page.getByLabel("New password")).toHaveValue("");
  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);

  // this device stays signed in; the other one is signed out
  expect(((await apiGet<{ staff: { email: string } | null }>(page, "/admin/auth/me")).staff ?? { email: "" }).email).toBe(email);
  // ("me" answers a signed-out caller with no one, not an error; a page that needs a sign-in refuses it)
  expect(((await (await phone.request.get("/api/admin/auth/me")).json()) as { staff: unknown }).staff).toBeNull();
  expect((await phone.request.get("/api/admin/dashboard")).status()).toBe(401);
  await phone.reload();
  await expect(phone.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  await other.close();

  // the old password no longer works; the new one does
  const fresh = await browser.newContext({ locale: "en-US" });
  await useLang(fresh, "en");
  const again = await fresh.newPage();
  await adminLogin(again, { email, password: "first-own-secret-11" });
  await expect(again.getByText("Wrong email or password.")).toBeVisible();
  await adminLogin(again, { email, password: "second-own-secret-22" });
  await expect(again.getByRole("navigation", { name: "Admin" })).toBeVisible();
  await fresh.close();
  await ctx.close();
});

test("in Bangla on a 360 px phone: the account page and its form fit", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "bn-BD", viewport: { width: 360, height: 800 } });
  await useLang(ctx, "bn");
  const page = await ctx.newPage();
  await adminLogin(page);
  await page.goto("/admin/account");
  await expect(page.getByRole("heading", { level: 1, name: "আমার অ্যাকাউন্ট" })).toBeVisible();
  await expect(page.getByLabel("বর্তমান পাসওয়ার্ড")).toBeVisible();
  await expect(page.getByLabel("নতুন পাসওয়ার্ড")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await ctx.close();
});
