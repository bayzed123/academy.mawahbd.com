import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminLogin, apiPost, offerAnswered, useLang } from "./helpers";

/*
 * A class's demo class, end to end (the owner's fifth round: "before enrolling, an option to watch a demo class on the class page"). The
 * owner puts a YouTube address in the class editor's Demo class box — a Facebook link is refused in plain words, and the editor confirms
 * the video plays on the class page — and a visitor sees the demo under the class's description and starts it with one press of "Watch the
 * demo class" in the price box, on the same page. The video site is stood in for: the test machine does not reach the internet.
 */
test.describe.configure({ mode: "serial" });

const TAG = Date.now().toString(36);
const TITLE = `Sponge cake live ${TAG}`;
let admin: Page;
let courseId: number;
let slug: string;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  // a class taught live: on sale, with no lessons in the app
  const made = await apiPost(admin, "/admin/courses", {
    title_bn: `স্পঞ্জ কেক লাইভ ${TAG}`,
    title_en: TITLE,
    short_bn: "",
    short_en: "A live class.",
    long_bn: "",
    long_en: "What the class is about.",
    banner_key: null,
    icon: "cake",
    category_id: null,
    instructor_id: null,
    level: null,
    price: 900,
    status: "published",
    details_url: null,
    featured: false,
    cert_enabled: true,
    seo_title_bn: "",
    seo_title_en: "",
    seo_desc_bn: "",
    seo_desc_en: "",
    sort: 100,
    launch_at: null,
  });
  expect(made.status).toBe(201);
  courseId = made.body.item.id;
  slug = made.body.item.slug;
});
test.afterAll(async () => {
  await admin.evaluate((id) => fetch(`/api/admin/courses/${id}`, { method: "DELETE" }), courseId);
  await admin.context().close();
});

/** YouTube's player, stood in for. */
async function videoSites(page: Page) {
  await page.route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Player</title><p>The demo plays here.</p>" }));
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ status: 404, body: "" }));
}

test("the owner adds a demo class in the class editor; a Facebook link is refused in plain words, a YouTube one is checked there", async () => {
  await videoSites(admin);
  await admin.goto(`/admin/courses/${courseId}/edit`);
  await expect(admin.getByRole("heading", { level: 3, name: "Demo class" })).toBeVisible();
  const address = admin.getByLabel("Demo class video (YouTube or Vimeo)", { exact: true });
  await address.fill("https://www.facebook.com/watch/?v=1234567890123456");
  await admin.getByRole("button", { name: "Save" }).click();
  // a class already on sale: saving asks nothing — the address is refused, in words the owner can act on
  await expect(admin.getByText("Use a YouTube or Vimeo video's address: the website plays those right there.")).toBeVisible();

  await address.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(admin.getByText("This plays inside the class page, in YouTube's own player.")).toBeVisible();
  await admin.getByLabel("Demo title (English)", { exact: true }).fill("Demo: the sponge base");
  await admin.getByLabel("Demo title (Bangla)", { exact: true }).fill("ডেমো: স্পঞ্জের বেস");
  await admin.getByLabel("A few lines about the demo (English)", { exact: true }).fill("Watch us make the base, step by step.");
  await admin.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByRole("alertdialog")).toHaveCount(0);
  await expect(admin.getByText("Saved.")).toBeVisible();
});

test("a visitor sees the demo under the class's description and starts it with one press, on the same page, in both languages", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  await offerAnswered(ctx);
  const page = await ctx.newPage();
  await videoSites(page);
  await page.goto(`/en/courses/${slug}`);
  const demo = page.locator("#demo");
  await expect(demo.getByRole("heading", { level: 2, name: "Watch a demo class" })).toBeVisible();
  await expect(demo.getByText("Watch us make the base, step by step.")).toBeVisible();
  // under the description, before what the class includes
  const [about, at, includes] = await Promise.all([
    page.getByRole("heading", { level: 2, name: "About this class" }).boundingBox(),
    demo.boundingBox(),
    page.getByRole("heading", { level: 2, name: "This class includes" }).boundingBox(),
  ]);
  expect(about!.y).toBeLessThan(at!.y);
  expect(at!.y).toBeLessThan(includes!.y);
  await demo.scrollIntoViewIfNeeded();
  const scan = await new AxeBuilder({ page }).include("#demo").include("aside.buy").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("aside.buy").getByRole("link", { name: "Watch the demo class" }).click();
  const player = demo.locator('iframe[title="Demo: the sponge base"]');
  await expect(player).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1");
  await expect(page.frameLocator('iframe[title="Demo: the sponge base"]').getByText("The demo plays here.")).toBeVisible();
  await expect(player).toBeInViewport();
  await expect(page).toHaveURL(new RegExp(`/en/courses/${slug}$`)); // the same page: no new tab, no other site

  await page.goto(`/courses/${slug}`);
  await expect(page.locator("#demo").getByRole("link", { name: "ডেমো ক্লাস চালান: ডেমো: স্পঞ্জের বেস" })).toBeVisible();
  await expect(page.locator("aside.buy").getByRole("link", { name: "ডেমো ক্লাস দেখুন" })).toBeVisible();
  await ctx.close();
});
