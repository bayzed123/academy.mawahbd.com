import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiPost, registerStudent, useLang } from "./helpers";

/*
 * Lesson videos in the website's own storage, in a real browser:
 *  - the owner picks a big 1080p phone video in a lesson's editor: the browser makes it 720p and smaller, uploads it in parts, and the
 *    lesson plays it — a student's player gets a 1280×720 MP4 that starts and skips at once, from the lesson's own address;
 *  - Admin → Video speed moves a Google Drive lesson over the same way (read through the website, remade as an MP4, stored).
 * The "phone video" is made in the browser for the test (Mediabunny, from node_modules). Set SHOTS_DIR to keep pictures. Runs after the
 * admin spec (the owner exists). The test's class is its own.
 */
test.describe.configure({ mode: "serial" });

const DRIVE_OK = "DEV_video_ok_0000000050";
const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view?usp=sharing`;
const shots = process.env.SHOTS_DIR;
const MEDIABUNNY = readFileSync(join(process.cwd(), "node_modules/mediabunny/dist/bundles/mediabunny.min.mjs"), "utf8");

let admin: Page;
let slug = "";
let courseId = 0;
let lessons: { upload: number; drive: number };

/**
 * A 1080p, 30 fps, 8 Mbit/s H.264 MP4 of a few seconds with its index at the end — the shape of a phone recording (only shorter), made in a
 * page of the site with the video library loaded from node_modules.
 */
async function phoneVideo(browser: Browser): Promise<Buffer> {
  const ctx = await browser.newContext({ bypassCSP: true });
  const page = await ctx.newPage();
  await page.route("**/__mediabunny.mjs", (r) => r.fulfill({ body: MEDIABUNNY, contentType: "text/javascript" }));
  await page.goto("/robots.txt");
  const b64 = await page.evaluate(async () => {
    const mb = await import("/__mediabunny.mjs" as string);
    const canvas = new OffscreenCanvas(1920, 1080);
    const g = canvas.getContext("2d")!;
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target });
    const source = new mb.CanvasSource(canvas, { codec: "avc", bitrate: 8_000_000 });
    output.addVideoTrack(source, { frameRate: 30 });
    await output.start();
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `hsl(${(i * 4) % 360} 70% 40%)`;
      g.fillRect(0, 0, 1920, 1080);
      g.fillStyle = "#ffb000";
      g.fillRect(200 + i * 15, 300, 240, 240);
      g.fillStyle = "#fff";
      g.font = "bold 120px sans-serif";
      g.fillText(`Frame ${i}`, 120, 900);
      await source.add(i / 30, 1 / 30);
    }
    await output.finalize();
    const blob = new Blob([target.buffer!]);
    return await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.readAsDataURL(blob);
    });
  });
  await ctx.close();
  return Buffer.from(b64, "base64");
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  slug = `own-videos-e2e-${Date.now().toString(36)}`;
  const made = await apiPost(admin, "/admin/courses", { title_bn: "নিজের ভিডিও", title_en: "Own Videos E2E", slug, price: 0, status: "published", short_bn: "", short_en: "", long_bn: "", long_en: "", banner_key: null, icon: "cake", category_id: null, instructor_id: null, level: null, details_url: null, featured: false, cert_enabled: true, seo_title_bn: "", seo_title_en: "", seo_desc_bn: "", seo_desc_en: "", sort: 100, launch_at: null });
  expect(made.status).toBe(201);
  courseId = (made.body as { item: { id: number } }).item.id;
  const mod = await apiPost(admin, `/admin/courses/${courseId}/modules`, { title_bn: "ভিডিও", title_en: "Videos", drip_days: 0 });
  const moduleId = (mod.body as { module: { id: number } }).module.id;
  const lesson = async (title: string, type: "video" | "external", external_url = "") => {
    const res = await apiPost(admin, `/admin/courses/${courseId}/lessons`, { module_id: moduleId, title_bn: "লেসন", title_en: title, type, stream_uid: "", external_url, body_bn: "", body_en: "", duration_sec: 0, is_preview: false });
    expect(res.status).toBe(201);
    return (res.body as { lesson: { id: number } }).lesson.id;
  };
  lessons = { upload: await lesson("Sponge from the phone", "video"), drive: await lesson("Icing from Drive", "external", driveUrl(DRIVE_OK)) };
});
test.afterAll(async () => admin.context().close());

async function student(browser: Browser) {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  expect((await apiPost(page, "/checkout", { agree: true, courses: [slug] })).status).toBe(201); // a free class: enrolled at once
  return { ctx, page };
}

/** The student's player: it has the video, its picture size and length, it plays and skips; every answer was an MP4 from our address. */
async function plays(page: Page, lessonId: number, size: { w: number; h: number }) {
  const answers: { status: number; type: string | null }[] = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname === `/api/student/lessons/${lessonId}/media`) answers.push({ status: r.status(), type: r.headers()["content-type"] ?? null });
  });
  await page.goto(`/app/learn/${slug}/${lessonId}`);
  const video = page.locator(".video-frame video");
  await expect(video).toBeVisible();
  expect(await video.getAttribute("src")).toMatch(new RegExp(`^/api/student/lessons/${lessonId}/media\\?v=[A-Za-z0-9_-]+$`));
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  const info = await video.evaluate((v: HTMLVideoElement) => ({ w: v.videoWidth, h: v.videoHeight, duration: v.duration, error: v.error?.code ?? null }));
  expect(info.error).toBeNull();
  expect({ w: info.w, h: info.h }).toEqual(size);
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
    v.currentTime = v.duration / 2;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(info.duration / 2 - 0.2);
  expect(answers.length).toBeGreaterThan(0);
  expect(answers.every((a) => (a.status === 200 || a.status === 206) && a.type === "video/mp4")).toBe(true);
  return info;
}

test("the owner uploads a big 1080p phone video in the lesson editor: it is made 720p and smaller, then a student plays it at once", async ({ browser }) => {
  test.setTimeout(240_000);
  const original = await phoneVideo(browser);
  await admin.goto(`/admin/courses/${courseId}/edit?tab=curriculum`);
  await admin.locator("button.lesson-title", { hasText: "Sponge from the phone" }).click();
  const box = admin.locator(".own-video");
  await expect(box).toContainText("Our video storage (plays without stopping)");
  // the internet drops in the middle of the upload: the part that was cut is sent again by itself, and the upload carries on
  let partSends = 0;
  await admin.route("**/api/admin/video-uploads/**/parts/*", (route) => (partSends++ === 0 ? route.abort("connectionreset") : route.continue()));
  await box.getByLabel("Upload video").setInputFiles({ name: "sponge.mp4", mimeType: "video/mp4", buffer: original });
  // it says what it is doing, then what it did
  await expect(box.getByRole("progressbar").first()).toBeVisible();
  await expect(box.getByText(/^Done: .* → .* \(720p\)\. Students now get this video\.$/)).toBeVisible({ timeout: 180_000 });
  await expect(box.getByText(/Plays from our storage · \d+ MB/)).toBeVisible();
  expect(partSends).toBeGreaterThanOrEqual(2);
  await admin.unroute("**/api/admin/video-uploads/**/parts/*");
  if (shots) await box.screenshot({ path: `${shots}/own-video-editor.png` });
  // the owner can watch it right there
  await box.getByRole("button", { name: "Play here" }).click();
  await expect.poll(() => box.locator("video").evaluate((v: HTMLVideoElement) => v.videoHeight), { timeout: 20_000 }).toBe(720);
  const axe = await new AxeBuilder({ page: admin }).include(".own-video").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await admin.keyboard.press("Escape");
  // the lesson list says where it plays from
  await expect(admin.locator(".lessons li", { hasText: "Sponge from the phone" })).toContainText("Our storage");

  const { ctx, page } = await student(browser);
  const info = await plays(page, lessons.upload, { w: 1280, h: 720 });
  expect(info.duration).toBeGreaterThan(2.5);
  if (shots) await page.screenshot({ path: `${shots}/own-video-student.png` });
  await ctx.close();
});

test("Admin → Video speed moves a Google Drive lesson to our storage: read through the website, remade as an MP4, and it plays from there", async ({ browser }) => {
  test.setTimeout(180_000);
  await admin.goto("/admin/video-speed");
  const panel = admin.locator(".panel", { has: admin.getByRole("heading", { name: "Our own storage: free, and plays without stopping" }) });
  await expect(panel).toBeVisible();
  const row = panel.locator(".vs-row", { hasText: "Icing from Drive" });
  await expect(row).toContainText("On Google Drive");
  // the lesson uploaded in the editor is listed as in our storage already
  await expect(panel.locator(".vs-row", { hasText: "Sponge from the phone" })).toContainText(/Plays from our storage · \d+ MB/);
  await row.getByRole("button", { name: "Move" }).click();
  await expect(row).toContainText(/Plays from our storage · \d+ MB/, { timeout: 120_000 });
  if (shots) await panel.screenshot({ path: `${shots}/own-video-speed.png` });

  const { ctx, page } = await student(browser);
  await plays(page, lessons.drive, { w: 96, h: 54 });
  await ctx.close();
});

test("a class material's video goes up in parts from Materials (no 95 MB limit), and enrolled students watch it in the class page", async ({ browser }) => {
  test.setTimeout(240_000);
  const original = await phoneVideo(browser);
  await admin.goto("/admin/materials");
  await admin.getByRole("button", { name: "+ Add" }).click();
  const drawer = admin.getByRole("dialog");
  await drawer.getByLabel("Which class is it for?").selectOption({ label: "Own Videos E2E" });
  await drawer.getByRole("radio", { name: /^Video/ }).click();
  await expect(drawer.getByText(/A video up to 4 GB/)).toBeVisible();
  // it goes in parts (each a request of its own), never as one big request
  const parts: string[] = [];
  admin.on("request", (r) => {
    if (/\/api\/admin\/material-uploads\/[^/]+\/parts\/\d+$/.test(new URL(r.url()).pathname)) parts.push(r.url());
  });
  await drawer.locator("#mat-file").setInputFiles({ name: "cloud-cake.mp4", mimeType: "video/mp4", buffer: original });
  await expect(drawer.getByText(/Uploaded: cloud-cake\.mp4/)).toBeVisible({ timeout: 180_000 });
  expect(parts.length).toBeGreaterThan(0);
  await drawer.getByLabel("Title (English)").fill("Full class recording");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();

  const { ctx, page } = await student(browser);
  await page.goto(`/app/learn/${slug}`);
  const card = page.locator(".mat-card", { hasText: "Full class recording" });
  const video = card.locator("video");
  await video.scrollIntoViewIfNeeded();
  await expect(video).toBeVisible();
  expect(await video.getAttribute("src")).toMatch(/^\/api\/student\/materials\/\d+\/media\?v=[A-Za-z0-9_-]+$/);
  // it plays (the same 720p the shrinking made)
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoHeight), { timeout: 20_000 }).toBe(720);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
  await expect(card.getByRole("link", { name: /Download/ })).toHaveCount(0);
  if (shots) await card.screenshot({ path: `${shots}/own-video-material.png` });
  await ctx.close();
});

