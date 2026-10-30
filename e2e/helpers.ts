import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { expect, type BrowserContext, type Page } from "@playwright/test";

/** Throwaway owner account for the local test database. The password is generated per run (playwright.config.ts) — nothing is stored. */
export const randomPassword = () => `Aa1-${randomBytes(9).toString("base64url")}`;
export const STAFF = { name: "Owner Test", email: "owner@e2e.test", password: process.env.E2E_OWNER_PASSWORD ?? randomPassword() };
export const SETUP_TOKEN = "dev-setup-token"; // from worker/.dev.vars.example (local only)

/**
 * The apps remember the language in localStorage; tests pick a starting language so selectors stay readable.
 * It only seeds the value when none is stored yet, so a language the test switches to survives reloads.
 */
/**
 * Draw every section of a public page now, as a visitor scrolling through it would see them. Sections further down are drawn only
 * when someone scrolls near them (content-visibility: auto, marketing/site.css), and until then each counts as 640px tall. The
 * accessibility scan cannot tell: it sees their content spill onto the next section and reports buttons "covered" that nobody
 * ever sees covered. A scan that cannot scroll first (a pop-up holds the page still) draws the page with this.
 */
export async function drawWholePage(page: Page) {
  await page.evaluate(() => document.querySelectorAll<HTMLElement>("main>section").forEach((s) => s.style.setProperty("content-visibility", "visible")));
}

/**
 * The banners spec leaves an offer pop-up on the home page: a second after arrival it covers the page (as it should) and the page stops
 * scrolling. These tests look at what is under it, so a visitor here has already answered it, the way the pop-up itself remembers.
 */
export async function offerAnswered(ctx: BrowserContext) {
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
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/**
 * A real photo-sized PNG: a colour gradient with a little noise, so the browser's WebP copy is clearly smaller than the file and the
 * picture is cut down to the sizes the site stores. A different `seed` is a different picture (so a different stored name).
 */
export function photoPng(width: number, height: number, seed: number) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  let rnd = Math.imul(seed + 1, 2654435761) >>> 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0;
      const noise = (rnd >>> 24) % 24;
      const at = y * stride + 1 + x * 3;
      raw[at] = (((x * 255) / width) + seed * 60 + noise) & 255;
      raw[at + 1] = (((y * 255) / height) + noise) & 255;
      raw[at + 2] = ((((x + y) * 255) / (width + height)) + seed * 90 + noise) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");

/** The box where a student types who they are on the sign-in and "forgot password" pages: a mobile number, a student ID or an e-mail. */
export const LOGIN_ID = /^Mobile number, student ID or e-mail|^মোবাইল নম্বর, স্টুডেন্ট আইডি বা ইমেইল/;

/** The address the test students buy with (buying asks for one; registering does not). */
/** The checkout's tick box (terms, privacy policy, refund & cancellation policy): blank until the buyer ticks it; every purchase ticks it first. */
export const AGREE = /^I have read and agree to the|^আমি .*পড়েছি এবং এতে সম্মত/;
export async function agree(page: Page) {
  await page.getByRole("checkbox", { name: AGREE }).check();
}

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
  // wait for the server's answer (and its sign-in cookie) before going on: a test that opens another page straight after pressing the button
  // left before the cookie arrived and landed, signed out, on the login form — a race that failed a deploy once
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/admin/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: /^Log in$|^লগইন$/ }).click();
  await answered;
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
