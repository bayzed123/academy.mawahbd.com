import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, apiPost, registerStudent, useLang } from "./helpers";

/*
 * Class videos kept in Google Drive, played inside the student portal. A video in Drive is private, and a student sent to its Drive address saw
 * "You need permission". Now the owner shares the video with the website's own Google address, and the website hands the video to the student's
 * player. Google Drive is stood in for by the dev Worker itself (with a real, tiny, playable video), and the website holds a made-up Google key, so
 * everything between the browser and "Drive" is the real code. What is checked is what the owner and the students live: a student really sees and
 * hears a video start on the class page (no Drive address anywhere, nothing blocked by the page's security policy), a video the website cannot read
 * says it is being prepared (never a link to the owner's Drive), a failure is a plain message with "Try again", and the owner finds out in the lesson editor — in plain words,
 * with the address to share with — whether it will work. Runs after the admin spec (the owner exists).
 */
test.describe.configure({ mode: "serial" });

const DRIVE_OK = "DEV_video_ok_0000000001";
const DRIVE_PRIVATE = "DEV_not_shared_0000000001";
const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view?usp=sharing`;
const SERVICE_EMAIL = "reader@mawah-e2e.iam.gserviceaccount.com";

let admin: Page;
let slug = "";
let courseId = 0;
let lessons: { ok: number; privateOne: number; youtube: number };

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");

  // a free class with three link lessons: a Drive video the website can read, one it cannot, and a YouTube link
  slug = `drive-videos-e2e-${Date.now().toString(36)}`;
  const made = await apiPost(admin, "/admin/courses", { title_bn: "ড্রাইভ ক্লাস", title_en: "Drive Videos E2E", slug, price: 0, status: "published", short_bn: "", short_en: "", long_bn: "", long_en: "", banner_key: null, icon: "cake", category_id: null, instructor_id: null, level: null, details_url: null, featured: false, cert_enabled: true, seo_title_bn: "", seo_title_en: "", seo_desc_bn: "", seo_desc_en: "", sort: 100, launch_at: null });
  expect(made.status).toBe(201);
  courseId = (made.body as { item: { id: number } }).item.id;
  const mod = await apiPost(admin, `/admin/courses/${courseId}/modules`, { title_bn: "ভিডিও", title_en: "Videos", drip_days: 0 });
  expect(mod.status).toBe(201);
  const moduleId = (mod.body as { module: { id: number } }).module.id;
  const lesson = async (title: string, external_url: string) => {
    const res = await apiPost(admin, `/admin/courses/${courseId}/lessons`, { module_id: moduleId, title_bn: "লেসন", title_en: title, type: "external", stream_uid: "", external_url, body_bn: "", body_en: "", duration_sec: 180, is_preview: false });
    expect(res.status).toBe(201);
    return (res.body as { lesson: { id: number } }).lesson.id;
  };
  lessons = { ok: await lesson("Dough from Drive", driveUrl(DRIVE_OK)), privateOne: await lesson("Private from Drive", driveUrl(DRIVE_PRIVATE)), youtube: await lesson("From YouTube", "https://youtu.be/dQw4w9WgXcQ") };
});
test.afterAll(async () => admin.context().close());

async function student(browser: Browser, lang: "en" | "bn" = "en") {
  // signs up in English (the helper types into English labels); a student who prefers Bangla switches afterwards, as they would
  const ctx = await browser.newContext({ locale: lang === "bn" ? "bn-BD" : "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await registerStudent(page);
  expect((await apiPost(page, "/checkout", { agree: true, courses: [slug] })).status).toBe(201); // a free class: enrolled at once
  if (lang === "bn") await page.evaluate(() => localStorage.setItem("mawah_lang", "bn"));
  return { ctx, page };
}

test("a student watches a Drive video inside the class page — it starts, with no Drive address anywhere and nothing blocked", async ({ browser }) => {
  const { ctx, page } = await student(browser);
  const requests: { url: string; status: number; type: string | null; range: string | null }[] = [];
  const toGoogle: string[] = [];
  const blocked: string[] = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (/\/lessons\/\d+\/media$/.test(u.pathname)) requests.push({ url: u.pathname, status: r.status(), type: r.headers()["content-type"] ?? null, range: r.request().headers()["range"] ?? null });
    if (/google/.test(u.hostname)) toGoogle.push(r.url());
  });
  page.on("console", (m) => {
    if (/content security policy|refused to/i.test(m.text())) blocked.push(m.text());
  });

  await page.goto(`/app/learn/${slug}/${lessons.ok}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Dough from Drive");
  const video = page.locator(".video-frame video");
  await expect(video).toBeVisible();
  expect(await video.getAttribute("src")).toBe(`/api/student/lessons/${lessons.ok}/media`);
  await expect(page.locator(".video-frame iframe")).toHaveCount(0);

  // the browser's own player really got a video: it knows how long it is, it has a picture, and it has no error
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const info = await video.evaluate((v: HTMLVideoElement) => ({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, error: v.error?.code ?? null }));
  expect(info.error).toBeNull();
  expect(info.duration).toBeGreaterThan(2.5);
  expect(info.duration).toBeLessThan(3.5);
  expect({ w: info.width, h: info.height }).toEqual({ w: 96, h: 54 });

  // it can be played and skipped through
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
    v.currentTime = 1.5;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1);

  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((r) => (r.status === 200 || r.status === 206) && r.type === "video/webm")).toBe(true);
  // nothing went to Google from the student's browser, and the page never held the file's address
  expect(toGoogle).toEqual([]);
  const html = await page.content();
  expect(html).not.toContain(DRIVE_OK);
  expect(html).not.toContain("drive.google.com");
  expect(JSON.stringify(await apiGet(page, `/student/lessons/${lessons.ok}`))).not.toContain(DRIVE_OK);
  // the page's security policy let the video through
  expect(blocked).toEqual([]);

  // the lesson works like any other: it can be marked complete
  await page.getByRole("button", { name: "Mark as complete" }).click();
  await expect(page.getByRole("button", { name: "Completed" })).toBeVisible();
  await ctx.close();
});

test("a video the website cannot read yet says it is being prepared — never a link to Drive; YouTube is untouched", async ({ browser }) => {
  const { ctx, page } = await student(browser);
  await page.goto(`/app/learn/${slug}/${lessons.privateOne}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Private from Drive");
  await expect(page.locator(".video-frame video")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "This class video is being prepared" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the video" })).toHaveCount(0);
  expect(await page.content()).not.toContain("drive.google.com");
  expect(await page.content()).not.toContain(DRIVE_PRIVATE);
  // on a phone the words fit inside the frame
  await page.setViewportSize({ width: 360, height: 800 });
  const frame = (await page.locator(".video-frame").boundingBox())!;
  const note = (await page.locator(".video-frame .video-note p").boundingBox())!;
  expect(note.y + note.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`/app/learn/${slug}/${lessons.youtube}`);
  await expect(page.locator('.video-frame iframe[src^="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toHaveCount(1);
  await expect(page.locator(".video-frame video")).toHaveCount(0);
  await ctx.close();
});

test("a video that cannot start says so plainly, offers “Try again”, and plays once it can — in English and in Bangla", async ({ browser }) => {
  for (const lang of ["en", "bn"] as const) {
    const { ctx, page } = await student(browser, lang);
    let down = true;
    await page.route(/\/api\/student\/lessons\/\d+\/media$/, (route) => (down ? route.fulfill({ status: 503, contentType: "application/json", json: { ok: false, error: { code: "video_unavailable" } } }) : route.continue()));
    await page.goto(`/app/learn/${slug}/${lessons.ok}`);
    const note = page.getByRole("alert").filter({ hasText: lang === "en" ? "This video could not be played right now" : "এই মুহূর্তে ভিডিওটি চালানো যাচ্ছে না" });
    await expect(note).toBeVisible();
    await expect(page.locator(".video-frame video")).toHaveCount(0);
    // the explanation names nothing of Google or the file
    await expect(note).not.toContainText(/google|drive|quota/i);
    // on a 360 px phone the words wrap onto many lines: the button must still be inside the frame, not cut off by it
    await page.setViewportSize({ width: 360, height: 800 });
    const frame = (await page.locator(".video-frame").boundingBox())!;
    const retry = (await note.getByRole("button").boundingBox())!;
    expect(retry.y).toBeGreaterThanOrEqual(frame.y);
    expect(retry.y + retry.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
    expect(frame.width / frame.height).toBeLessThanOrEqual(16 / 9 + 0.01); // never squashed flatter than 16:9
    await page.setViewportSize({ width: 1440, height: 900 });

    down = false;
    await note.getByRole("button", { name: lang === "en" ? "Try again" : "আবার চেষ্টা করুন" }).click();
    const video = page.locator(".video-frame video");
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
    await expect(note).toHaveCount(0);
    await ctx.close();
  }
});

test("the video on a phone: it fits the 360 px screen, and the page passes the accessibility scan", async ({ browser }) => {
  const { ctx, page } = await student(browser);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/app/learn/${slug}/${lessons.ok}`);
  const video = page.locator(".video-frame video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const box = await video.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(360);
  expect(box!.width / box!.height).toBeGreaterThan(1.6); // still 16:9
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.getByLabel("Dough from Drive").first()).toBeVisible(); // the player has a name for screen readers
  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  await ctx.close();
});

test("someone who does not own the class gets nothing from the video address", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  const stranger = await page.request.get(`/api/student/lessons/${lessons.ok}/media`);
  expect(stranger.status()).toBe(401);
  await registerStudent(page); // signed in, but never bought this class
  const denied = await page.request.get(`/api/student/lessons/${lessons.ok}/media`);
  expect(denied.status()).toBe(403);
  expect(await denied.text()).not.toContain("webm");
  await ctx.close();
});

test.describe("the owner's lesson editor", () => {
  async function openLesson(title: string) {
    await admin.goto(`/admin/courses/${courseId}/edit?tab=curriculum`);
    await admin.locator("button.lesson-title", { hasText: title }).click();
    await expect(admin.getByRole("heading", { name: "Edit lesson" })).toBeVisible();
  }
  const panel = () => admin.getByRole("region", { name: "Google Drive video" });
  const url = () => admin.locator("#l-url"); // the link box, whatever the language

  test("a Drive link shows which address to share with, and “Check access” says what it found", async () => {
    await openLesson("Dough from Drive");
    await expect(panel()).toBeVisible();
    await expect(panel().getByText(SERVICE_EMAIL)).toBeVisible();
    await expect(panel().getByText("no Google sign-in")).toBeVisible();
    await expect(panel().getByText("Disable options to download, print, and copy")).toBeVisible();

    await panel().getByRole("button", { name: "Check access" }).click();
    await expect(panel().getByText("Ready — “Class 1 — dough.webm” will play inside the class page.")).toBeVisible();
    await expect(panel().getByText("video/webm")).toBeVisible();
    await expect(panel().getByRole("alert")).toHaveCount(0);

    // "Play here": the video in the box, exactly as a student will get it — it really plays
    const play = panel().getByRole("button", { name: "Play here" });
    await play.click();
    const preview = panel().locator(".drive-play video");
    await expect(preview).toHaveAttribute("src", `/api/admin/drive/media?url=${encodeURIComponent(driveUrl(DRIVE_OK))}`);
    await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
    await preview.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
    });
    await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
    expect(await preview.evaluate((v: HTMLVideoElement) => v.error?.code ?? null)).toBeNull();
    await panel().getByRole("button", { name: "Close the video" }).click();
    await expect(preview).toHaveCount(0);

    // a link typed over it is a new question: the old answer goes
    await url().fill(driveUrl(DRIVE_PRIVATE));
    await expect(panel().getByText("will play inside the class page")).toHaveCount(0);
    await panel().getByRole("button", { name: "Check access" }).click();
    const no = panel().getByRole("alert").filter({ hasText: "The website cannot see this file" });
    await expect(no).toBeVisible();
    await expect(no).toContainText("share it with the address shown above");
    await expect(no).toContainText("What Google said");
    await expect(no).toContainText("notFound");
    // and "Play here" on a video the website cannot read says so plainly in the box, pointing at "Check access"
    await play.click();
    await expect(panel().getByRole("alert").filter({ hasText: "could not be played here" })).toContainText("Check access");
    await panel().getByRole("button", { name: "Close the video" }).click();

    await url().fill(driveUrl("DEV_google_doc_0000000001"));
    await panel().getByRole("button", { name: "Check access" }).click();
    await expect(panel().getByRole("alert").filter({ hasText: "This file is not a video" })).toBeVisible();

    await url().fill(driveUrl("DEV_download_off_0000000001"));
    await panel().getByRole("button", { name: "Check access" }).click();
    await expect(panel().getByRole("alert").filter({ hasText: "Google will not hand this video to a Viewer" })).toBeVisible();

    await url().fill("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
    await panel().getByRole("button", { name: "Check access" }).click();
    await expect(panel().getByRole("alert").filter({ hasText: "This is a folder link, not a video" })).toBeVisible();

    await url().fill(driveUrl("DEV_video_mov_0000000001"));
    await panel().getByRole("button", { name: "Check access" }).click();
    await expect(panel().getByText("This kind of file may not play on every phone")).toBeVisible(); // the warning itself, not the format tip above it (which says the same words)

    // nothing secret on the screen, and the panel passes the accessibility scan
    await expect(admin.locator("body")).not.toContainText(/PRIVATE KEY/);
    const axe = await new AxeBuilder({ page: admin }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });

  test("a YouTube link shows none of it; and the panel reads in Bangla", async () => {
    await openLesson("From YouTube");
    await expect(panel()).toHaveCount(0);
    await url().fill("https://youtu.be/dQw4w9WgXcQ");
    await expect(panel()).toHaveCount(0);
    await url().fill(driveUrl(DRIVE_OK));
    await expect(panel()).toBeVisible(); // a Drive link typed in appears at once

    await admin.evaluate(() => localStorage.setItem("mawah_admin_lang", "bn"));
    await admin.reload();
    await admin.locator("button.lesson-title", { hasText: "লেসন" }).first().click();
    await url().fill(driveUrl(DRIVE_PRIVATE));
    const bn = admin.getByRole("region", { name: "গুগল ড্রাইভের ভিডিও" });
    await expect(bn).toBeVisible();
    await expect(bn.getByText(SERVICE_EMAIL)).toBeVisible();
    await bn.getByRole("button", { name: "অ্যাক্সেস পরীক্ষা করুন" }).click();
    await expect(bn.getByRole("alert").filter({ hasText: "ওয়েবসাইট এই ফাইলটি দেখতে পাচ্ছে না" })).toBeVisible();
    await admin.evaluate(() => localStorage.setItem("mawah_admin_lang", "en"));
  });

  test("on a 360 px phone the panel fits the screen", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 800 } });
    await useLang(ctx, "en");
    const phone = await ctx.newPage();
    await adminLogin(phone);
    await expect(phone.getByRole("heading", { level: 1 })).toContainText(", Owner");
    await phone.goto(`/admin/courses/${courseId}/edit?tab=curriculum`);
    await phone.locator("button.lesson-title", { hasText: "Dough from Drive" }).click();
    const section = phone.getByRole("region", { name: "Google Drive video" });
    await expect(section).toBeVisible();
    await section.getByRole("button", { name: "Check access" }).click();
    await expect(section.getByText("will play inside the class page")).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await ctx.close();
  });

  test("the lesson row and the activity log carry no Drive address; “Check access” leaves a mark that it happened", async () => {
    const log = await apiGet<{ items: { action: string; meta: string }[] }>(admin, "/admin/activity?per_page=50");
    const checks = log.items.filter((i) => i.action === "drive.checked");
    expect(checks.length).toBeGreaterThan(0);
    expect(JSON.stringify(checks)).not.toContain("DEV_");
  });
});

test.describe("a Drive video in the class's materials", () => {
  let mats: { ok: number; privateOne: number };
  const material = async (title_en: string, url: string) => {
    const res = await apiPost(admin, "/admin/materials", { course_id: courseId, kind: "video", title_bn: "ভিডিও", title_en, note_bn: "", note_en: "", r2_key: null, url, platform: null, starts_at: null, duration_min: null, active: true, sort: 100 });
    expect(res.status).toBe(201);
    return (res.body as { item: { id: number } }).item.id;
  };
  test.beforeAll(async () => {
    // the way the owner added the biryani class: the videos under Materials, each a Drive link
    mats = { ok: await material("Biryani part 1", driveUrl(DRIVE_OK)), privateOne: await material("Biryani part 2", driveUrl(DRIVE_PRIVATE)) };
  });

  test("plays right in its card — no new tab, no Drive address anywhere — and one the website cannot read says it is being prepared", async ({ browser }) => {
    const { ctx, page } = await student(browser);
    const toGoogle: string[] = [];
    page.on("request", (r) => {
      if (/google/.test(new URL(r.url()).hostname)) toGoogle.push(r.url());
    });
    const tabs: string[] = [];
    ctx.on("page", (p) => tabs.push(p.url()));

    await page.goto(`/app/learn/${slug}`);
    const section = page.locator("#materials");
    const ok = section.locator(".mat-card", { hasText: "Biryani part 1" });
    const video = ok.locator(".video-frame video");
    await expect(video).toBeVisible();
    expect(await video.getAttribute("src")).toBe(`/api/student/materials/${mats.ok}/media`);
    // a list of videos fetches nothing until one is pressed
    expect(await video.getAttribute("preload")).toBe("none");
    await expect(ok.getByRole("button", { name: /Watch video/ })).toHaveCount(0);

    // pressed: it really plays, and the website notes that this student watched it
    const played = page.waitForResponse((r) => r.url().endsWith(`/api/student/materials/${mats.ok}/play`) && r.request().method() === "POST");
    await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
    });
    expect((await played).status()).toBe(200);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
    expect(await video.evaluate((v: HTMLVideoElement) => v.error?.code ?? null)).toBeNull();

    const pending = section.locator(".mat-card", { hasText: "Biryani part 2" });
    await expect(pending.getByRole("status")).toContainText("This class video is being prepared");
    await expect(pending.locator("video")).toHaveCount(0);
    await expect(pending.getByRole("button")).toHaveCount(0);
    await expect(pending.getByRole("link")).toHaveCount(0);

    expect(tabs).toEqual([]);
    expect(toGoogle).toEqual([]);
    const html = await page.content();
    for (const secret of ["drive.google.com", DRIVE_OK, DRIVE_PRIVATE]) expect(html, secret).not.toContain(secret);

    // on a 360 px phone the video and the note fit the screen
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(video).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await ctx.close();
  });

  test("a Vimeo or YouTube video plays in its card too, in that site's own player — no new tab — after “Watch video”", async ({ browser }) => {
    const vimeo = await material("Biryani on Vimeo", "https://vimeo.com/123456789?share=copy");
    const youtube = await material("Biryani on YouTube", "https://youtu.be/dQw4w9WgXcQ");
    const { ctx, page } = await student(browser);
    const tabs: string[] = [];
    ctx.on("page", (p) => tabs.push(p.url()));
    // the players' own sites are not reached from the test machine: only the address the frame is given matters here
    await page.route(/player\.vimeo\.com|youtube-nocookie\.com/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>player</title>" }));
    await page.goto(`/app/learn/${slug}`);
    const section = page.locator("#materials");
    for (const [title, id, src] of [
      ["Biryani on Vimeo", vimeo, "https://player.vimeo.com/video/123456789?autoplay=1"],
      ["Biryani on YouTube", youtube, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1"],
    ] as const) {
      const card = section.locator(".mat-card", { hasText: title });
      await expect(card.locator("iframe")).toHaveCount(0); // nothing loads until it is pressed
      const opened = page.waitForResponse((r) => r.url().endsWith(`/api/student/materials/${id}/open`) && r.request().method() === "POST");
      await card.getByRole("button", { name: /Watch video/ }).click();
      expect((await opened).status()).toBe(200);
      const frame = card.locator(".video-frame iframe");
      await expect(frame).toHaveAttribute("src", src);
      await expect(frame).toHaveAttribute("title", title);
    }
    expect(tabs).toEqual([]);
    // on a 360 px phone the player fits the screen
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await ctx.close();
  });

  test("a video already in Materials: open its row, “Check access” and “Play here” are right under its link, and it plays in the admin", async () => {
    await admin.goto("/admin/materials");
    await admin.getByRole("row").filter({ hasText: "Biryani part 1" }).click();
    const drawer = admin.getByRole("dialog");
    await expect(drawer.locator("#mat-url")).toHaveValue(driveUrl(DRIVE_OK));
    const panel = drawer.getByRole("region", { name: "Google Drive video" });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Check access" }).click();
    await expect(panel.getByText("Ready — “Class 1 — dough.webm” will play inside the class page.")).toBeVisible();
    await panel.getByRole("button", { name: "Play here" }).click();
    const preview = panel.locator(".drive-play video");
    await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
    await preview.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
    });
    await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
    // on a phone the video fits the drawer
    await admin.setViewportSize({ width: 360, height: 800 });
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const box = (await preview.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(360);
    await admin.setViewportSize({ width: 1280, height: 800 });
    await drawer.getByRole("button", { name: "Cancel" }).click();
  });

  test("the owner's material editor shows the address to share with and “Check access”, as the lesson editor does", async () => {
    await admin.goto("/admin/materials");
    await admin.getByRole("button", { name: "+ Add" }).click();
    const drawer = admin.getByRole("dialog");
    await drawer.getByLabel("Which class is it for?").selectOption({ label: "Drive Videos E2E" });
    await drawer.getByRole("radio", { name: /^Video/ }).click();
    await drawer.getByRole("radio", { name: /Add a link instead/ }).click();
    const panel = drawer.getByRole("region", { name: "Google Drive video" });
    await expect(panel).toHaveCount(0); // nothing until a Drive link is there
    await drawer.locator("#mat-url").fill(driveUrl(DRIVE_OK));
    await expect(panel).toBeVisible();
    await expect(panel.getByText(SERVICE_EMAIL)).toBeVisible();
    await panel.getByRole("button", { name: "Check access" }).click();
    await expect(panel.getByText("Ready — “Class 1 — dough.webm” will play inside the class page.")).toBeVisible();
    await drawer.locator("#mat-url").fill(driveUrl(DRIVE_PRIVATE));
    await panel.getByRole("button", { name: "Check access" }).click();
    await expect(panel.getByRole("alert").filter({ hasText: "The website cannot see this file" })).toBeVisible();
    await drawer.locator("#mat-url").fill("https://youtu.be/dQw4w9WgXcQ");
    await expect(panel).toHaveCount(0);
    const axe = await new AxeBuilder({ page: admin }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });
});
