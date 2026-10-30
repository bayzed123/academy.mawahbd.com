import { beforeEach, describe, expect, it } from "vitest";
import { videoEmbed, videoThumb, videoWatchUrl } from "@mawah/shared";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * The home page's videos (the owner's fifth round: "some marketing videos, YouTube links, with an active / inactive switch"). Admin → Home
 * videos keeps YouTube and Vimeo addresses, each with a title in both languages and its own on/off switch; the home page shows the ones
 * switched on, in their order, as a picture with a play button that plays the video right there (marketing/site.js puts the video site's
 * own player in its place). Without JavaScript the picture is a link to the video's own page. With none switched on there is no section.
 */
const YT = "dQw4w9WgXcQ";
const body = async (path: string) => {
  const page = await (await new Client().get(path)).text();
  return page.slice(page.indexOf("<body"));
};
const section = (page: string) => /<section class="section" id="videos" aria-labelledby="videos-h">([\s\S]*?)<\/section>/.exec(page)?.[1] ?? null;

// the tests of this file share one database: each starts with no videos
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM home_videos").run();
});

async function add(admin: Client, video: Record<string, unknown>) {
  const res = await admin.post("/api/admin/videos", { title_bn: "", title_en: "", active: true, sort: 100, ...video });
  expect(res.status, JSON.stringify(video)).toBe(201);
  return (await json(res)).item as { id: number; active: number };
}

describe("Admin → Home videos", () => {
  it("keeps only an address the home page can play — YouTube or Vimeo — and only the owner and content managers change them", async () => {
    const admin = (await loginStaff("super_admin")).client;
    for (const url of ["https://www.facebook.com/watch/?v=1234567890123456", "https://example.com/our-video.mp4", "javascript:alert(1)", "https://www.youtube.com/watch?v=short", "not a link"]) {
      const res = await admin.post("/api/admin/videos", { url, title_bn: "", title_en: "", active: true, sort: 1 });
      expect(res.status, url).toBe(422);
      expect((await json(res)).error.fields, url).toMatchObject({ url: "video_site" });
    }
    const empty = await admin.post("/api/admin/videos", { url: "", title_bn: "", title_en: "", active: true, sort: 1 });
    expect((await json(empty)).error.fields).toMatchObject({ url: "required" });

    const video = await add(admin, { url: `https://youtu.be/${YT}`, title_en: "Inside our kitchen", title_bn: "আমাদের রান্নাঘর" });
    expect(video.active).toBe(1);
    // the list for the admin page, with its on/off filter
    const on = await json(await admin.get("/api/admin/videos?active=1"));
    expect(on.items.map((v: { id: number }) => v.id)).toContain(video.id);

    // support staff can look, but not change
    const support = (await loginStaff("support")).client;
    expect((await support.get("/api/admin/videos")).status).toBe(200);
    expect((await support.post("/api/admin/videos", { url: `https://youtu.be/${YT}`, title_bn: "", title_en: "", active: true, sort: 1 })).status).toBe(403);
    expect((await support.patch(`/api/admin/videos/${video.id}`, { active: false })).status).toBe(403);
    expect((await new Client().get("/api/admin/videos")).status).toBe(401);
  });
});

describe("the home page's videos", () => {
  it("are not on the page while none is switched on", async () => {
    expect(section(await body("/en"))).toBeNull();
    const admin = (await loginStaff("super_admin")).client;
    await add(admin, { url: `https://youtu.be/${YT}`, active: false });
    expect(section(await body("/en"))).toBeNull();
    expect(section(await body("/"))).toBeNull();
  });

  it("show the ones switched on, in their order, as a picture with a play button that plays the video right there", async () => {
    const admin = (await loginStaff("super_admin")).client;
    const yt = await add(admin, { url: `https://www.youtube.com/watch?v=${YT}&t=10s`, title_en: "Inside our kitchen", title_bn: "আমাদের রান্নাঘর", sort: 2 });
    await add(admin, { url: "https://vimeo.com/123456789/abcdef1234", title_en: "A student's cake", title_bn: "", sort: 1 });
    await add(admin, { url: "https://youtu.be/aaaaaaaaaaa", title_en: "Switched off", active: false, sort: 0 });

    const en = section(await body("/en")) ?? "";
    expect(en, "the section is on the page").not.toBe("");
    expect(en).toContain('<h2 id="videos-h">Watch our <span class="hl">videos</span></h2>');
    expect(en).toContain('<ul class="vids n2">');
    expect(en).not.toContain("Switched off");
    expect(en).not.toContain("aaaaaaaaaaa");
    // the player is rebuilt from the checked id (YouTube's privacy-enhanced site), and only made when the visitor presses play
    expect(en).toContain(
      `<div class="vid" data-player="https://www.youtube-nocookie.com/embed/${YT}?autoplay=1" data-title="Inside our kitchen"><a class="vid-play" href="https://www.youtube.com/watch?v=${YT}" target="_blank" rel="noopener noreferrer" aria-label="Play the video: Inside our kitchen"><img src="https://i.ytimg.com/vi/${YT}/hqdefault.jpg" alt="" loading="lazy" decoding="async" width="480" height="360"/>`,
    );
    expect(en).not.toContain("<iframe");
    // a Vimeo video has no picture to show before it plays (its play button stands on the dark tile); an unlisted one keeps its hash
    expect(en).toContain('<div class="vid" data-player="https://player.vimeo.com/video/123456789?h=abcdef1234&amp;autoplay=1" data-title="A student&#39;s cake"><a class="vid-play" href="https://vimeo.com/123456789/abcdef1234"');
    // in the owner's order: the smaller number first
    expect(en.indexOf("A student&#39;s cake")).toBeLessThan(en.indexOf("Inside our kitchen"));

    // in Bangla: the Bangla title, else the English one
    const bn = section(await body("/"));
    expect(bn).toContain('data-title="আমাদের রান্নাঘর"');
    expect(bn).toContain('aria-label="ভিডিও চালান: আমাদের রান্নাঘর"');
    expect(bn).toContain('data-title="A student&#39;s cake"');

    // switched off from the list (no form to open): gone from the page at once
    expect((await admin.patch(`/api/admin/videos/${yt.id}`, { active: false })).status).toBe(200);
    const after = section(await body("/en"));
    expect(after).toContain('<ul class="vids n1">');
    expect(after).not.toContain("Inside our kitchen");
  });

  it("never put the owner's words into the page as markup", async () => {
    const admin = (await loginStaff("super_admin")).client;
    await add(admin, { url: `https://youtu.be/${YT}`, title_en: '<script>alert(1)</script>" onmouseover="x', title_bn: "" });
    const page = await body("/en");
    expect(page).not.toContain("<script>alert(1)");
    expect(page).not.toContain('" onmouseover="x');
    expect(section(page)).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("are allowed by the page's policy: YouTube's pictures, and players only from YouTube's privacy-enhanced site and Vimeo", async () => {
    const csp = (await new Client().get("/en")).headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/img-src [^;]*https:\/\/i\.ytimg\.com/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/www\.youtube-nocookie\.com [^;]*https:\/\/player\.vimeo\.com/);
    expect(csp).not.toMatch(/frame-src [^;]*facebook/);
  });
});

describe("a video's picture and its own page", () => {
  it("come from the checked video id, never from the pasted text", () => {
    for (const url of [`https://youtu.be/${YT}`, `https://www.youtube.com/watch?v=${YT}&list=x`, `https://m.youtube.com/shorts/${YT}`, `https://www.youtube.com/live/${YT}?si=abc`]) {
      expect(videoThumb(url), url).toBe(`https://i.ytimg.com/vi/${YT}/hqdefault.jpg`);
      expect(videoWatchUrl(url), url).toBe(`https://www.youtube.com/watch?v=${YT}`);
    }
    expect(videoThumb("https://vimeo.com/123456789")).toBeNull();
    expect(videoWatchUrl("https://vimeo.com/123456789")).toBe("https://vimeo.com/123456789");
    expect(videoWatchUrl("https://player.vimeo.com/video/123456789?h=abcdef1234")).toBe("https://vimeo.com/123456789/abcdef1234");
    // a Facebook video plays only in the student app and the admin; a link that is not a video gives nothing
    expect(videoEmbed("https://www.facebook.com/watch/?v=1234567890123456")?.site).toBe("facebook");
    expect(videoWatchUrl("https://www.facebook.com/watch/?v=1234567890123456")).toBeNull();
    for (const bad of ["https://example.com/x", "javascript:alert(1)", `https://youtu.be.evil.example/${YT}`]) {
      expect(videoThumb(bad), bad).toBeNull();
      expect(videoWatchUrl(bad), bad).toBeNull();
    }
  });
});
