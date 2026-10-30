import { describe, expect, it } from "vitest";
import { VIDEO_CSS } from "../src/generated/assets";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * A class's demo class (the owner's fifth round: "before enrolling, an option to watch a demo class on the class page — under the picture
 * and the description, the video, playing nicely when pressed"). Admin → Classes → Demo class keeps a YouTube or Vimeo address with a title
 * and a few lines; the class page shows them under its description, the video as a picture with a play button that plays right there
 * (marketing/site.js), and the price box offers "Watch the demo class", which goes down to it and starts it.
 */
let seq = 0;
async function makeClass(demo: Record<string, string> = {}) {
  const slug = `demo-class-${Date.now().toString(36)}-${seq++}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, long_bn, long_en, price, status, category_id, instructor_id, published_at,
                          demo_url, demo_title_bn, demo_title_en, demo_text_bn, demo_text_en)
     VALUES (?, 'স্পঞ্জ কেক ক্লাস', 'Sponge Cake Class', '', '', 'বাংলা বিবরণ', 'The class, described.', 900, 'published', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, ?, ?, ?, ?)`,
  )
    .bind(slug, demo.url ?? "", demo.title_bn ?? "", demo.title_en ?? "", demo.text_bn ?? "", demo.text_en ?? "")
    .run();
  return { id: res.meta.last_row_id as number, slug };
}
const page = async (path: string) => {
  const html = await (await new Client().get(path)).text();
  return html.slice(html.indexOf("<body"));
};
const demoOf = (html: string) => /<section class="demo" id="demo" aria-labelledby="demo-h">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? null;

describe("a class's demo class", () => {
  it("is kept by Admin → Classes only as a YouTube or Vimeo address — or none", async () => {
    const c = await makeClass();
    const admin = (await loginStaff("super_admin")).client;
    for (const url of ["https://www.facebook.com/watch/?v=1234567890123456", "https://example.com/demo.mp4", "javascript:alert(1)"]) {
      const res = await admin.patch(`/api/admin/courses/${c.id}`, { demo_url: url });
      expect(res.status, url).toBe(422);
      expect((await json(res)).error.fields, url).toMatchObject({ demo_url: "video_site" });
    }
    const ok = await admin.patch(`/api/admin/courses/${c.id}`, { demo_url: "https://youtu.be/dQw4w9WgXcQ", demo_title_en: "Demo: the sponge base", demo_text_en: "Watch us make the base." });
    expect(ok.status).toBe(200);
    expect((await json(ok)).item).toMatchObject({ demo_url: "https://youtu.be/dQw4w9WgXcQ", demo_title_en: "Demo: the sponge base" });
    expect(demoOf(await page(`/en/courses/${c.slug}`))).not.toBeNull();
    expect(await (await new Client().get(`/en/courses/${c.slug}`)).text()).toContain(`<style>${VIDEO_CSS}</style>`); // the player's styles come with it
    // emptied: gone from the page, and its styles with it
    expect((await admin.patch(`/api/admin/courses/${c.id}`, { demo_url: "" })).status).toBe(200);
    expect(demoOf(await page(`/en/courses/${c.slug}`))).toBeNull();
    expect(await (await new Client().get(`/en/courses/${c.slug}`)).text()).not.toContain(VIDEO_CSS);
    // only those who may edit classes
    const support = (await loginStaff("support")).client;
    expect((await support.patch(`/api/admin/courses/${c.id}`, { demo_url: "https://youtu.be/dQw4w9WgXcQ" })).status).toBe(403);
  });

  it("shows under the class's description with its own words, as a picture with a play button that plays right there", async () => {
    const c = await makeClass({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s",
      title_en: "Demo: the sponge base",
      title_bn: "ডেমো: স্পঞ্জের বেস",
      text_en: "Watch us make the base, step by step.",
      text_bn: "দেখুন ধাপে ধাপে বেস তৈরি।",
    });
    const en = await page(`/en/courses/${c.slug}`);
    // the picture, then the description, then the demo — then what the class includes
    const about = en.indexOf('aria-labelledby="about-h"');
    const demoAt = en.indexOf('<section class="demo" id="demo"');
    expect(about).toBeGreaterThan(0);
    expect(demoAt).toBeGreaterThan(about);
    expect(en.indexOf('aria-labelledby="inc-h"')).toBeGreaterThan(demoAt);
    const demo = demoOf(en)!;
    expect(demo).toContain('<h2 id="demo-h">Watch a <span class="hl">demo class</span></h2>');
    expect(demo).toContain('<p class="demo-text">Watch us make the base, step by step.</p>');
    // the player is rebuilt from the checked id (YouTube's privacy-enhanced site) and made only when the visitor presses play
    expect(demo).toContain(
      '<div class="vid" data-player="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1" data-title="Demo: the sponge base"><a class="vid-play" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer" aria-label="Play the demo class: Demo: the sponge base"><img src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" alt=""',
    );
    expect(demo).toContain('<span class="vid-tag" aria-hidden="true">Free demo</span>');
    expect(demo).toContain('<p class="vid-title">Demo: the sponge base</p>');
    expect(demo).not.toContain("<iframe");
    // the price box offers it before the Enroll button's alternatives
    expect(en).toContain('<a class="btn btn-outline btn-block" href="#demo" data-play-demo="true">');
    expect(en).toContain("Watch the demo class</a>");

    const bn = demoOf(await page(`/courses/${c.slug}`))!;
    expect(bn).toContain('<h2 id="demo-h"><span class="hl">ডেমো ক্লাস</span> দেখুন</h2>');
    expect(bn).toContain('<p class="demo-text">দেখুন ধাপে ধাপে বেস তৈরি।</p>');
    expect(bn).toContain('aria-label="ডেমো ক্লাস চালান: ডেমো: স্পঞ্জের বেস"');
    expect(bn).toContain(">ফ্রি ডেমো</span>");
  });

  it("says a short default line and names the class when the owner wrote no words; a Vimeo demo has no picture before it plays", async () => {
    const c = await makeClass({ url: "https://vimeo.com/123456789/abcdef1234" });
    const demo = demoOf(await page(`/en/courses/${c.slug}`))!;
    expect(demo).toContain('<p class="demo-text">See how this class is taught before you enroll. Press play: it plays right here.</p>');
    expect(demo).toContain('data-player="https://player.vimeo.com/video/123456789?h=abcdef1234&amp;autoplay=1" data-title="Watch a demo class: Sponge Cake Class"');
    expect(demo).toContain('href="https://vimeo.com/123456789/abcdef1234"');
    expect(demo).not.toContain("<img");
  });

  it("is not on a page without one — nor for an address the public pages cannot play, and the owner's words are never markup", async () => {
    const none = await page(`/en/courses/${(await makeClass()).slug}`);
    expect(demoOf(none)).toBeNull();
    expect(none).not.toContain("data-play-demo");
    // an address saved before the check (or by hand) that is not YouTube or Vimeo: no section, no button
    const fb = await page(`/en/courses/${(await makeClass({ url: "https://www.facebook.com/watch/?v=1234567890123456" })).slug}`);
    expect(demoOf(fb)).toBeNull();
    expect(fb).not.toContain("data-play-demo");
    const x = await page(`/en/courses/${(await makeClass({ url: "https://youtu.be/dQw4w9WgXcQ", title_en: '<script>alert(1)</script>" onmouseover="x', text_en: "<b>bold</b>" })).slug}`);
    expect(x).not.toContain("<script>alert(1)");
    expect(x).not.toContain('" onmouseover="x');
    expect(demoOf(x)).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
});
