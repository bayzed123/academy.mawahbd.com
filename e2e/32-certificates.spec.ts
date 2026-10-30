import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { adminLogin, apiGet, apiPost, registerStudent, useLang } from "./helpers";

/*
 * Certificates, end to end (the owner's fifth round: "still not to see any certificate design… students can download it"). A class taught
 * live has no lessons in the app to finish, so the owner issues its certificates from Admin → Certificates; the student finds theirs in the
 * student app and downloads it as a picture (PNG) or a PDF (the browser's own print window: Save as PDF). The owner can also open a sample
 * of the design.
 */
test.describe.configure({ mode: "serial" });

const TAG = Date.now().toString(36);
const TITLE = `Live cake class ${TAG}`;
const NAME = "Tahmina Sultana";
let admin: Page;
let student: Page;
let courseId: number;

test.beforeAll(async ({ browser }) => {
  const actx = await browser.newContext({ locale: "en-US", acceptDownloads: true });
  await useLang(actx, "en");
  admin = await actx.newPage();
  await adminLogin(admin);
  const made = await apiPost(admin, "/admin/courses", {
    title_bn: `লাইভ কেক ক্লাস ${TAG}`,
    title_en: TITLE,
    short_bn: "",
    short_en: "Taught live.",
    long_bn: "",
    long_en: "",
    banner_key: null,
    icon: "cake",
    category_id: null,
    instructor_id: null,
    level: null,
    price: 700,
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

  // a student who joined the live class (the owner enrolled them)
  const sctx = await browser.newContext({ locale: "en-US", acceptDownloads: true });
  await useLang(sctx, "en");
  student = await sctx.newPage();
  await registerStudent(student, { name: NAME });
  const me = (await apiGet<{ student: { id: number } }>(student, "/auth/me")).student;
  expect((await apiPost(admin, `/admin/students/${me.id}/enroll`, { course_ids: [courseId] })).status).toBe(200);
});
test.afterAll(async () => {
  await student.context().close();
  await admin.context().close();
});

test("the owner issues the certificates of a class taught live, from Admin → Certificates", async () => {
  await admin.goto("/admin/certificates");
  await admin.getByRole("button", { name: "Issue certificates" }).click();
  const drawer = admin.getByRole("dialog");
  await drawer.getByLabel("Class", { exact: true }).selectOption(String(courseId));
  await expect(drawer.getByText("1 enrolled · 0 already have a certificate.")).toBeVisible();
  await expect(drawer.getByText("This class has no lessons in the app, so you issue its certificates here.")).toBeVisible();
  await expect(drawer.getByRole("radio", { name: "Everyone enrolled who has none yet (1)" })).toBeChecked();
  await expect(drawer.getByRole("radio", { name: "Only those who finished every lesson in the app (0)" })).toBeDisabled();
  await drawer.getByRole("button", { name: "Issue 1" }).click();
  await expect(admin.getByText("Certificates issued: 1.")).toBeVisible();
  const row = admin.getByRole("row").filter({ hasText: NAME });
  await expect(row).toHaveCount(1);
  await expect(row.locator("code")).toHaveText(/^MWH-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // the design itself: a sample, marked as one
  const [sample] = await Promise.all([admin.waitForEvent("popup"), admin.getByRole("link", { name: "See the design" }).first().click()]);
  await expect(sample).toHaveURL(/\/en\/certificate\/sample$/);
  await expect(sample.getByText("This is a sample of our certificate.")).toBeVisible();
  await sample.close();
});

test("the student downloads it as a picture and as a PDF, from the student app", async () => {
  await student.goto("/app/certificates");
  const card = student.locator(".cert-card").filter({ hasText: TITLE });
  await expect(card).toHaveCount(1);
  const code = (await card.locator("code").textContent())!.trim();
  await expect(card.getByRole("link", { name: "PDF" })).toHaveAttribute("href", `/en/certificate/${code}?print=1`);
  await expect(card.getByRole("link", { name: "Picture" })).toHaveAttribute("href", `/en/certificate/${code}?download=png`);

  // the certificate's own page: the drawing, the buttons, and nothing serious for the accessibility scan
  const page = student;
  await page.addInitScript(() => {
    const w = window as unknown as { printed: number };
    w.printed = 0;
    window.print = () => {
      w.printed++;
    };
  });
  await page.goto(`/en/certificate/${code}`);
  await expect(page.getByRole("img", { name: `Certificate of Completion: ${NAME}` })).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(scan.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // the picture: the whole certificate, twice the drawing's size, made in the browser from the same drawing
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download picture" }).click()]);
  expect(download.suggestedFilename()).toBe(`MAWAH-certificate-${code}.png`);
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2246, 1588]);
  expect(png.length).toBeGreaterThan(100_000); // the drawing, its fonts and the logo — not an empty sheet

  // the PDF: the browser's own print window, where "Save as PDF" sets Bangla letters right
  await page.getByRole("button", { name: "Download PDF" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  // the app's buttons open the page and do it at once
  await page.goto(`/en/certificate/${code}?print=1`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  const [auto] = await Promise.all([page.waitForEvent("download"), page.goto(`/en/certificate/${code}?download=png`)]);
  expect(auto.suggestedFilename()).toBe(`MAWAH-certificate-${code}.png`);
});
