import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminLogin, apiGet, offerAnswered, PNG, useLang } from "./helpers";

/*
 * The home page's videos, end to end (the owner's fifth round). The owner adds a YouTube video in Admin → Home videos — a Facebook link is
 * refused in plain words — and a visitor sees it on the home page in both languages and plays it right there: the video site's own player
 * takes the picture's place, on the same page. Switched off in the admin's list, it leaves the home page. The video sites are stood in for
 * here: the test machine does not reach the internet.
 */
test.describe.configure({ mode: "serial" });

const YT = "dQw4w9WgXcQ";
const TITLE = `Inside our kitchen ${Date.now().toString(36)}`;
let admin: Page;
const drawer = () => admin.getByRole("dialog");

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
});
test.afterAll(async () => {
  const left = await apiGet<{ items: { id: number }[] }>(admin, `/admin/videos?q=${encodeURIComponent(TITLE)}`);
  for (const v of left.items) await admin.evaluate((id) => fetch(`/api/admin/videos/${id}`, { method: "DELETE" }), v.id);
  await admin.context().close();
});

/** YouTube's player and pictures, stood in for. */
async function videoSites(page: Page) {
  await page.route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Player</title><p>The video plays here.</p>" }));
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ contentType: "image/png", body: PNG }));
}

test("the owner adds a YouTube video in Admin → Home videos; a Facebook link is refused in plain words", async () => {
  await videoSites(admin);
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Home videos", exact: true }).click();
  await expect(admin.getByRole("heading", { level: 1, name: "Home videos" })).toBeVisible();
  await admin.getByRole("button", { name: "+ Add" }).click();
  const address = drawer().getByLabel(/^Video address/); // a required field: its label ends with *
  await address.fill("https://www.facebook.com/watch/?v=1234567890123456");
  await drawer().getByLabel("Title (English)", { exact: true }).fill(TITLE);
  await drawer().getByLabel("Title (Bangla)", { exact: true }).fill("আমাদের রান্নাঘর");
  await expect(drawer().getByRole("switch", { name: "On the home page" })).toBeChecked();
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(drawer().getByText("Use a YouTube or Vimeo video's address: the website plays those right there.")).toBeVisible();

  await address.fill(`https://www.youtube.com/watch?v=${YT}`);
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  const row = admin.getByRole("row").filter({ hasText: TITLE });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".vid-cell img")).toHaveAttribute("src", `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`);
  await expect(row.getByRole("switch", { name: `Show ${TITLE} on the home page` })).toBeChecked();
});

test("a visitor sees it on the home page and plays it right there, in both languages", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  await videoSites(page);
  await page.goto("/en");
  const videos = page.locator("#videos");
  await expect(videos.getByRole("heading", { level: 2, name: "Watch our videos" })).toBeVisible();
  const play = videos.getByRole("link", { name: `Play the video: ${TITLE}` });
  await play.scrollIntoViewIfNeeded();
  const scan = await new AxeBuilder({ page }).include("#videos").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await play.click();
  const player = videos.locator(`iframe[title="${TITLE}"]`);
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("src", `https://www.youtube-nocookie.com/embed/${YT}?autoplay=1`);
  await expect(player).toHaveAttribute("allowfullscreen", "");
  await expect(page.frameLocator(`iframe[title="${TITLE}"]`).getByText("The video plays here.")).toBeVisible();
  await expect(play).toHaveCount(0);
  await expect(page).toHaveURL(/\/en$/); // still the home page: no new tab, no other site
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME"); // the keyboard is in the player

  await page.goto("/");
  await expect(page.locator("#videos").getByRole("link", { name: "ভিডিও চালান: আমাদের রান্নাঘর" })).toBeVisible();
  await ctx.close();
});

test("switched off in the admin's list, it leaves the home page", async ({ browser }) => {
  const row = admin.getByRole("row").filter({ hasText: TITLE });
  const toggle = row.getByRole("switch", { name: `Show ${TITLE} on the home page` });
  await row.locator("label.switch").click(); // the switch's own box is drawn by its label
  await expect(toggle).not.toBeChecked();
  await expect(row).toContainText("Off");

  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  await videoSites(page);
  await page.goto("/en");
  await expect(page.getByRole("link", { name: `Play the video: ${TITLE}` })).toHaveCount(0);
  await ctx.close();
});
