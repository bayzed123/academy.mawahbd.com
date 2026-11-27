import { expect, test } from "@playwright/test";
import { adminLogin, apiPost, registerStudent, useLang } from "./helpers";

/*
 * A signed-in student who already has a class sees "Start the class" instead of "Enroll" for it — on the class list's card, on the class
 * page and in the bar at the bottom — and it opens the lessons. A class they do not have still says Enroll. Runs after the admin spec.
 */
test("a class the student has says “Start the class” and opens the lessons; the others still say Enroll", async ({ browser }) => {
  const actx = await browser.newContext({ locale: "en-US" });
  await useLang(actx, "en");
  const admin = await actx.newPage();
  await adminLogin(admin);
  const slug = `owned-e2e-${Date.now().toString(36)}`;
  const made = await apiPost(admin, "/admin/courses", { title_bn: "নিজের ক্লাস", title_en: "Owned Class E2E", slug, price: 0, status: "published", short_bn: "", short_en: "", long_bn: "", long_en: "", banner_key: null, icon: "cake", category_id: null, instructor_id: null, level: null, details_url: null, featured: false, cert_enabled: true, seo_title_bn: "", seo_title_en: "", seo_desc_bn: "", seo_desc_en: "", sort: 1, launch_at: null });
  expect(made.status).toBe(201);
  const courseId = (made.body as { item: { id: number } }).item.id;
  const mod = await apiPost(admin, `/admin/courses/${courseId}/modules`, { title_bn: "শুরু", title_en: "Start", drip_days: 0 });
  await apiPost(admin, `/admin/courses/${courseId}/lessons`, { module_id: (mod.body as { module: { id: number } }).module.id, title_bn: "লেসন", title_en: "Lesson one", type: "text", stream_uid: "", external_url: "", body_bn: "পড়ুন", body_en: "Read this", duration_sec: 60, is_preview: false });
  await actx.close();

  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  expect((await apiPost(page, "/checkout", { agree: true, courses: [slug] })).status).toBe(201); // a free class: theirs at once

  // the class page: the buy box says Start the class and goes to the lessons
  await page.goto(`/en/courses/${slug}`);
  const start = page.getByRole("link", { name: "Start the class" }).first();
  await expect(start).toBeVisible();
  await expect(start).toHaveAttribute("href", `/app/learn/${slug}`);
  await expect(page.locator(`a[href*="/app/checkout?c=${slug}"]`)).toHaveCount(0);

  // the class list: this card says Start the class; another class still says Enroll
  await page.goto("/en/courses");
  const card = page.locator("article", { has: page.locator(`a[href$="/courses/${slug}"]`) }).first();
  await expect(card.getByRole("link", { name: "Start the class" })).toHaveAttribute("href", `/app/learn/${slug}`);
  await expect(page.getByRole("link", { name: /Enroll Now/ }).first()).toBeVisible();

  await start.page().goto(`/en/courses/${slug}`);
  await page.getByRole("link", { name: "Start the class" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/learn/${slug}`));
  await ctx.close();
});
