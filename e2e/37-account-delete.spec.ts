import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiPost, registerStudent, useLang } from "./helpers";

/*
 * Deleting an account (Google Play asks for it in the app and on a web page): the public page explains it and its button opens the profile,
 * where the student deletes the account with their password and a tick; or the owner deletes it in Admin → Students when the student asks.
 * Runs after the admin spec (the owner exists).
 */

test("a student deletes their own account from the website: the public page, the profile, the password and the tick", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  const { email, password } = await registerStudent(page);

  // the address given to Google Play: what is deleted and kept, and a button to the profile
  await page.goto("/en/account/delete");
  await expect(page.getByRole("heading", { level: 1, name: "Delete your account" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What we keep, and why" })).toBeVisible();
  await page.getByRole("link", { name: "Delete my account" }).first().click();
  await expect(page).toHaveURL(/\/app\/profile\?delete=1$/);

  const form = page.locator("form#delete");
  await expect(form.getByRole("heading", { name: "Delete my account" })).toBeInViewport();
  const button = form.getByRole("button", { name: "Delete my account" });
  await expect(button).toBeDisabled();
  expect((await new AxeBuilder({ page }).include("form#delete").analyze()).violations).toEqual([]);

  await form.getByLabel("Your password").fill("not-my-password-1");
  await form.getByLabel(/I understand/).check();
  await button.click();
  await expect(form.getByText("That is not your password.")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/profile/);

  await form.getByLabel("Your password").fill(password);
  await button.click();
  await expect(page).toHaveURL(/\/app\/deleted$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your account was deleted" })).toBeVisible();
  expect((await apiGet<{ student: unknown }>(page, "/auth/me")).student).toBeNull();
  // the old e-mail and password open nothing any more
  expect((await apiPost(page, "/auth/login", { identifier: email, password })).status).toBe(401);
  await ctx.close();
});

test("the owner deletes an account when the student asks: a reason is needed, then the student leaves the list", async ({ browser }) => {
  const studentCtx = await browser.newContext({ locale: "en-US" });
  await useLang(studentCtx, "en");
  const student = await studentCtx.newPage();
  const { email } = await registerStudent(student, { name: "Delete Me Dina" });

  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const admin = await ctx.newPage();
  await adminLogin(admin);
  await admin.goto(`/admin/students?q=${encodeURIComponent(email)}`);
  await admin.getByRole("row", { name: new RegExp(email) }).click();
  const drawer = admin.getByRole("dialog", { name: "Delete Me Dina" });
  await drawer.getByRole("button", { name: "Delete account" }).click();

  const ask = admin.getByRole("alertdialog");
  await expect(ask).toContainText("This cannot be undone");
  const confirm = ask.getByRole("button", { name: "Delete account" });
  await expect(confirm).toBeDisabled(); // the reason must be written first
  await ask.getByLabel(/Who asked, and how/).fill("WhatsApp message from the student");
  await confirm.click();
  await expect(admin.getByText("The account was deleted.")).toBeVisible();
  await expect(admin.getByRole("dialog", { name: "Deleted account" }).getByText(/This account was deleted on/)).toBeVisible();

  // gone from the list, and signed out on the student's own browser
  await admin.goto(`/admin/students?q=${encodeURIComponent(email)}`);
  await expect(admin.getByRole("row", { name: new RegExp(email) })).toHaveCount(0);
  expect((await apiGet<{ student: unknown }>(student, "/auth/me")).student).toBeNull();
  await ctx.close();
  await studentCtx.close();
});
