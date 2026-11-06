import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, useLang } from "./helpers";

/*
 * Free classes for the Android app (Admin → Android app): the owner adds a class, chooses "Android app only — free" under "Where is this
 * class shown?", and it is free in the app and never on the website. The same page makes the test account Google Play's reviewers sign in
 * with, and edits the app's notice. Runs after the admin spec (the owner exists).
 */
const TITLE = "Free Sponge Basics";

test("the owner makes a free class for the Android app: no price, never on the website, listed under Android app", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const admin = await ctx.newPage();
  await adminLogin(admin);

  await admin.goto("/admin/app");
  await expect(admin.getByRole("heading", { level: 1, name: "Android app" })).toBeVisible();
  expect((await new AxeBuilder({ page: admin }).include("main").analyze()).violations).toEqual([]);
  await admin.getByRole("link", { name: "Add a free class" }).click();
  await expect(admin).toHaveURL(/\/admin\/courses\/new\?channel=app$/);

  // the new class is already an app class: no price to type, and the visibility menu speaks of the app
  const where = admin.getByLabel("Where is this class shown?");
  await expect(where).toHaveValue("app");
  await expect(admin.getByLabel("Price", { exact: true })).toHaveCount(0);
  await expect(admin.getByText(/Free in the Android app: no price and no checkout/)).toBeVisible();
  await admin.getByLabel("Title (বাংলা)").fill("ফ্রি স্পঞ্জ বেসিকস");
  await admin.getByLabel("Title (English)").fill(TITLE);
  await admin.getByLabel("Visibility in the Android app").selectOption("published");
  await admin.getByRole("button", { name: "Save" }).click();
  // a class without lessons is published only on purpose
  await admin.getByRole("alertdialog").getByRole("button", { name: "Publish anyway" }).click();
  await expect(admin).toHaveURL(/\/admin\/courses\/\d+\/edit\?tab=curriculum$/);
  const id = Number(admin.url().match(/courses\/(\d+)\/edit/)![1]);
  const { item } = await apiGet<{ item: { slug: string; price: number; channel: string; status: string } }>(admin, `/admin/courses/${id}`);
  expect(item).toMatchObject({ channel: "app", price: 0, status: "published" });

  // the website knows nothing of it
  expect((await admin.request.get(`/en/courses/${item.slug}`)).status()).toBe(404);
  expect(await (await admin.request.get("/en/courses")).text()).not.toContain(TITLE);
  // the app lists it
  const appList = await (await admin.request.get("/api/app/courses")).json();
  expect(appList.courses.map((c: { slug: string }) => c.slug)).toContain(item.slug);

  // the class list marks it, and has no "view on the website" link for it
  await admin.goto("/admin/courses?channel=app");
  const row = admin.getByRole("row").filter({ hasText: TITLE });
  await expect(row).toContainText("App · free");
  await expect(row.getByRole("link", { name: "View on website" })).toHaveCount(0);
  await expect(row.getByRole("switch", { name: `Show ${TITLE} in the Android app` })).toBeChecked();

  await admin.goto("/admin/app");
  await expect(admin.locator(".app-classes")).toContainText(TITLE);
  await ctx.close();
});

test("the Google Play test account is made on the Android app page, its password shown once, and it signs in to the app", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const admin = await ctx.newPage();
  await adminLogin(admin);
  await admin.goto("/admin/app");
  await admin.getByRole("button", { name: "Make the test account" }).click();
  const secret = admin.locator(".review-secret");
  await expect(secret).toContainText("Copy it now: it is shown only this once.");
  const [code, password] = await secret.locator("code.secret").allTextContents();
  expect(code).toMatch(/^STU-\d{6}$/);
  expect(password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

  // the reviewer signs in to the app with the student ID and that password (the app's own sign-in, a token)
  const signIn = await admin.request.post("/api/auth/login", { data: { identifier: code, password, client: "app" } });
  expect(signIn.status()).toBe(200);
  // after a reload the password is gone from the page, the student ID stays
  await admin.reload();
  await expect(admin.getByText(code)).toBeVisible();
  await expect(admin.getByText(password)).toHaveCount(0);
  await expect(admin.getByRole("button", { name: "New password" })).toBeVisible();
  await ctx.close();
});

test("the app's notice is saved on the Android app page and reaches the app", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const admin = await ctx.newPage();
  await adminLogin(admin);
  await admin.goto("/admin/app");
  await admin.getByLabel("Notice (Bangla)").fill("নতুন ফ্রি ক্লাস এসেছে");
  await admin.getByLabel("Notice (English)").fill("A new free class is here");
  const on = admin.getByRole("switch", { name: "Show the notice" });
  await on.locator("xpath=ancestor::label").click();
  await expect(on).toBeChecked();
  await admin.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  // (/api/site may be kept for 30 seconds by a browser or the app: asked fresh here, as a phone opening the app would)
  const notice = async () => ((await (await admin.request.get("/api/site")).json()) as { site: { app_notice: unknown } }).site.app_notice;
  expect(await notice()).toEqual({ bn: "নতুন ফ্রি ক্লাস এসেছে", en: "A new free class is here" });
  // off again: the words are kept, the app shows no notice
  await on.locator("xpath=ancestor::label").click();
  await expect(on).not.toBeChecked();
  await admin.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.").last()).toBeVisible();
  await expect.poll(notice).toBeNull();
  await ctx.close();
});
