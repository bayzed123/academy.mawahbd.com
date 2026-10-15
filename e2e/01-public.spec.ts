import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { useLang } from "./helpers";

/* The public, cacheable, server-rendered marketing site. */
test.describe("public site", () => {
  test("Bangla home page: 26 real classes, prices, no fabricated numbers", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/মাওয়াহ একাডেমি/);
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");
    // the catalogue holds the 26 launch classes (+ the dev-only "free taster" class)
    const all = await (await request.get("/api/courses?per_page=60")).json();
    expect(all.courses).toHaveLength(27);
    expect(all.courses.some((c: { price: number }) => c.price === 3550)).toBe(true);
    // the grid pages through them 12 at a time; each card has a Read More link and a price button or a Coming Soon badge
    await page.goto("/courses");
    const cards = page.locator("article.card");
    await expect(cards).toHaveCount(12);
    await expect(page.getByRole("navigation", { name: "pagination" })).toBeVisible();
    await expect(cards.first().getByRole("link", { name: "বিস্তারিত পড়ুন" })).toBeVisible();
    await page.goto("/courses?page=3");
    await expect(cards).toHaveCount(3); // 27 = 12 + 12 + 3
    await expect(page.locator("body")).not.toContainText(/\d+\s*(students|শিক্ষার্থী) (enrolled|ভর্তি)/i);
  });

  test("English route, language toggle and hreflang", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator('link[rel="alternate"][hreflang="bn"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(1);
    await page.getByRole("link", { name: "বাংলা" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  });

  test("class detail page has structured data and a working buy path", async ({ page }) => {
    await useLang(page.context(), "en");
    await page.goto("/en/courses/beginners-baking-class");
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const course = ld.map((t) => JSON.parse(t)).flatMap((x) => (Array.isArray(x) ? x : [x["@graph"] ?? x]).flat()).find((x) => x["@type"] === "Course");
    expect(course.offers.priceCurrency).toBe("BDT");
    expect(Number(course.offers.price)).toBe(400);
    expect(course.aggregateRating).toBeUndefined(); // only real ratings may ever be published
    await page.getByRole("link", { name: /Enroll Now/ }).first().click();
    // no log-in page in between: a visitor is asked for a name, a number and an e-mail instead — a buyer sent to log in first is a buyer lost
    await expect(page).toHaveURL(/\/app\/checkout\?c=beginners-baking-class/);
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  });

  test("no fabricated social proof anywhere in the API or pages", async ({ page, request }) => {
    const body = await (await request.get("/api/courses?per_page=60")).json();
    expect(body.courses.every((c: { rating_count: number; rating_avg: number }) => c.rating_count === 0 && c.rating_avg === 0)).toBe(true);
    await page.goto("/courses");
    await expect(page.locator("body")).not.toContainText(/trending|bestseller|only \d+ left|\d+ (people|students) (are )?(watching|viewing)/i);
  });

  test("security & caching headers", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("default-src 'none'");
    expect(h["content-security-policy"]).not.toContain("unsafe-inline");
    expect(h["content-security-policy"]).not.toContain("unsafe-eval");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"] ?? h["content-security-policy"]).toBeTruthy();
    expect(h["referrer-policy"]).toBeTruthy();
    const api = await request.get("/api/courses");
    expect(api.headers()["cache-control"]).toContain("max-age");
    const priv = await request.get("/api/student/courses");
    expect(priv.status()).toBe(401);
    expect(priv.headers()["cache-control"]).toContain("no-store");
  });

  test("robots, sitemap and 404", async ({ request, page }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain("Sitemap:");
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("/courses/beginners-baking-class");
    const res = await page.goto("/this-page-does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("link").first()).toBeVisible();
  });

  test("performance budget: lean HTML, no render-blocking third parties, fonts self-hosted", async ({ page }) => {
    const requests: { url: string; type: string; size: number }[] = [];
    page.on("response", async (r) => {
      const len = Number((await r.allHeaders())["content-length"] ?? 0);
      requests.push({ url: r.url(), type: r.request().resourceType(), size: len });
    });
    await page.goto("/", { waitUntil: "networkidle" });
    const external = requests.filter((r) => !r.url.startsWith("http://localhost:8788"));
    expect(external).toEqual([]); // zero third-party requests before the visitor interacts
    const html = await (await page.request.get("/")).text();
    expect(Buffer.byteLength(html)).toBeLessThan(110_000);
    const scripts = requests.filter((r) => r.type === "script");
    expect(scripts.length).toBeLessThanOrEqual(2); // site.js (+ chat.js only on demand)
  });

  test("accessibility: no serious or critical axe violations (home, class, search)", async ({ page }) => {
    for (const path of ["/", "/courses/beginners-baking-class", "/courses?q=cake", "/contact"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
    }
  });
});
