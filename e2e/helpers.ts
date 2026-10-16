import { randomBytes } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";

/** Throwaway owner account for the local test database. The password is generated per run (playwright.config.ts) — nothing is stored. */
export const randomPassword = () => `Aa1-${randomBytes(9).toString("base64url")}`;
export const STAFF = { name: "Owner Test", email: "owner@e2e.test", password: process.env.E2E_OWNER_PASSWORD ?? randomPassword() };
export const SETUP_TOKEN = "dev-setup-token"; // from worker/.dev.vars.example (local only)

/**
 * The apps remember the language in localStorage; tests pick a starting language so selectors stay readable.
 * It only seeds the value when none is stored yet, so a language the test switches to survives reloads.
 */
export async function useLang(ctx: BrowserContext, lang: "bn" | "en") {
  await ctx.addInitScript((l) => {
    try {
      for (const key of ["mawah_lang", "mawah_admin_lang"]) if (!localStorage.getItem(key)) localStorage.setItem(key, l);
    } catch {
      /* storage unavailable */
    }
  }, lang);
}

let seq = 0;
let phoneSeq = Math.floor(Math.random() * 8_000_000) + 1_000_000;
/** A mobile number no other test uses (a number is a way to sign in, so tests must not share one). */
export const uniquePhone = () => `0171${String(phoneSeq++).padStart(7, "0")}`;
export const uniqueEmail = (prefix: string) => `${prefix}${Date.now().toString(36)}${++seq}@e2e.test`;

/** A real, valid 2x2 PNG (magic bytes the server checks). */
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8Dwn+E/w38AEAAB/wGJp5ySAAAAAElFTkSuQmCC", "base64");
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");

/** The box where a student types who they are on the sign-in and "forgot password" pages: a mobile number, a student ID or an e-mail. */
export const LOGIN_ID = /^Mobile number, student ID or e-mail|^মোবাইল নম্বর, স্টুডেন্ট আইডি বা ইমেইল/;

/** The address the test students buy with (buying asks for one; registering does not). */
export const TEST_ADDRESS = "House 12, Road 5, Dhanmondi, Dhaka";

/**
 * Registers through the form. The new student also gets an address on their profile — unless `address` is "" — so that buying does not stop
 * to ask for it (the checkout asks a signed-in student only for what their profile lacks).
 */
export async function registerStudent(page: Page, opts: { name?: string; email?: string; password?: string; address?: string } = {}) {
  const email = opts.email ?? uniqueEmail("student");
  const password = opts.password ?? randomPassword();
  await page.goto("/app/register");
  await page.getByLabel(/Full name|পুরো নাম/).fill(opts.name ?? "Test Student");
  await page.getByLabel(/^Email|^ইমেইল/).fill(email);
  await page.getByLabel(/Mobile number|মোবাইল নম্বর/).fill("01712345678");
  await page.getByLabel(/^Password|^পাসওয়ার্ড/).fill(password);
  await page.getByRole("button", { name: /Sign up|নিবন্ধন/ }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
  const address = opts.address ?? TEST_ADDRESS;
  if (address) {
    const me = (await apiGet<{ student: { name: string; phone: string; locale: string } }>(page, "/auth/me")).student;
    const res = await apiSend(page, "PATCH", "/auth/profile", { name: me.name, phone: me.phone, address, locale: me.locale });
    expect(res.status).toBe(200);
  }
  return { email, password };
}

export async function adminLogin(page: Page, creds: { email: string; password: string } = STAFF) {
  await page.goto("/admin/");
  await page.getByLabel(/^Email|^ইমেইল/).fill(creds.email);
  await page.getByLabel(/^Password|^পাসওয়ার্ড/).fill(creds.password);
  await page.getByRole("button", { name: /^Log in$|^লগইন$/ }).click();
}

/** Create the owner through the one-time setup form (only works while the site has no staff yet). */
export async function adminSetup(page: Page) {
  await page.goto("/admin/");
  await page.getByLabel(/Setup token|সেটআপ টোকেন/).fill(SETUP_TOKEN);
  await page.getByLabel(/Full name|পুরো নাম/).fill(STAFF.name);
  await page.getByLabel(/^Email|^ইমেইল/).fill(STAFF.email);
  await page.getByLabel(/^Password|^পাসওয়ার্ড/).fill(STAFF.password);
  await page.getByRole("button", { name: /Create owner account|মালিকের অ্যাকাউন্ট/ }).click();
}

/** JSON helper that runs in the page context (cookies included) — handy for arranging test data. */
export async function apiSend(page: Page, method: "POST" | "PATCH" | "PUT", path: string, json: unknown) {
  return page.evaluate(
    async ([m, p, body]) => {
      const res = await fetch(`/api${p}`, { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    [method, path, json] as const,
  );
}

export const apiPost = (page: Page, path: string, json: unknown) => apiSend(page, "POST", path, json);

export async function apiGet<T = unknown>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (p) => (await fetch(`/api${p}`)).json(), path) as Promise<T>;
}
