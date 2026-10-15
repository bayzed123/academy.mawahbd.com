import { describe, expect, it } from "vitest";
import { refreshCourseRating } from "../src/services/catalog";
import { Client, env, json, loginStaff, registerStudent } from "./helpers";

const text = (res: Response) => res.text();

/*
 * Trust & discovery: the Shop link, honest ratings and reviews, and the instructor badge.
 * The rule these tests protect: every number on the page comes from real, approved reviews — a class nobody has
 * reviewed says "No reviews yet" and invites the first one, it never shows a made-up score.
 */

async function newClass(slug: string, instructorId = 1) {
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, long_bn, long_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, 'রিভিউ ক্লাস', ?, 'ছোট', 'Short', '', '', 500, 'published', 1, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `Review class ${slug}`, instructorId)
    .run();
  return res.meta.last_row_id as number;
}

/** A real student, enrolled in the class, who has left a review in the given state. */
async function review(courseId: number, rating: number, status: "approved" | "pending" | "rejected", body = "") {
  const { id } = await registerStudent(new Client(), { name: `Reviewer ${rating}` });
  const enrollment = await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'admin')").bind(id, courseId).run();
  await env.DB.prepare("INSERT INTO reviews (course_id, student_id, enrollment_id, rating, body, status) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(courseId, id, enrollment.meta.last_row_id, rating, body, status)
    .run();
}

async function newInstructor(slug: string) {
  const res = await env.DB.prepare("INSERT INTO instructors (slug, name_bn, name_en, headline_bn, headline_en, active) VALUES (?, 'নতুন শেফ', ?, '', 'Pastry chef', 1)")
    .bind(slug, `Chef ${slug}`)
    .run();
  return res.meta.last_row_id as number;
}

describe("ratings and reviews on the class page", () => {
  it("a class nobody has reviewed says so honestly and invites the first review", async () => {
    const slug = `unrated-${Date.now()}`;
    await newClass(slug);
    const html = await text(await new Client().get(`/en/courses/${slug}`));
    expect(html).toContain('id="reviews"');
    expect(html).toContain("No reviews yet");
    expect(html).toContain("Be the first to review");
    expect(html).toContain(`href="/app/review/${slug}"`); // the button leads to the review page of the student app
    expect(html).toContain('href="#reviews"'); // the rating line near the title jumps down to the section
    expect(html).toContain("Be the first to rate");
    expect(html).not.toContain("aggregateRating"); // search engines are not told about ratings that do not exist
    expect(html).not.toContain("data-fragment=\"/_f/reviews"); // reviews are part of the page, not a script-loaded extra

    const bn = await text(await new Client().get(`/courses/${slug}`));
    expect(bn).toContain("এখনো কোনো রিভিউ নেই");
    expect(bn).toContain("প্রথম রিভিউটি আপনি দিন");
  });

  it("approved reviews drive the stars, the summary, the breakdown and the structured data — pending and rejected ones do not", async () => {
    const slug = `rated-${Date.now()}`;
    const id = await newClass(slug);
    await review(id, 5, "approved", "Loved the mishti recipes");
    await review(id, 5, "approved", "Clear steps, great teacher");
    await review(id, 4, "approved", "Good pace");
    await review(id, 1, "pending", "WAITING-FOR-MODERATION");
    await review(id, 1, "rejected", "REJECTED-REVIEW-TEXT");
    await refreshCourseRating(env, id);

    const html = await text(await new Client().get(`/en/courses/${slug}`));
    expect(html).toContain("Loved the mishti recipes");
    expect(html).toContain("Good pace");
    expect(html).not.toContain("WAITING-FOR-MODERATION");
    expect(html).not.toContain("REJECTED-REVIEW-TEXT");
    expect(html).toContain("4.7"); // (5 + 5 + 4) / 3, rounded to one decimal
    expect(html).toContain("Based on 3 student reviews");
    expect(html).toContain('aria-label="Ratings by number of stars"');
    expect(html).toContain('<rect class="rev-bar-fg" width="67%"'); // two of three are 5-star
    expect(html).toContain('<rect class="rev-bar-fg" width="33%"'); // one of three is 4-star
    expect(html).toContain("Write a review"); // and students can still add theirs
    expect(html).not.toContain("No reviews yet");
    expect(html).toMatch(/"aggregateRating":\{[^}]*"ratingValue":4\.67[^}]*"ratingCount":3/);

    const bn = await text(await new Client().get(`/courses/${slug}`));
    expect(bn).toContain("৪.৭");
    expect(bn).toContain("৩টি শিক্ষার্থীর রিভিউর ভিত্তিতে");
  });

  it("the class cards show the same real rating — and an unrated class shows no stars at all", async () => {
    const rated = `card-rated-${Date.now()}`;
    const unrated = `card-unrated-${Date.now()}`;
    const ratedId = await newClass(rated);
    await newClass(unrated);
    await review(ratedId, 4, "approved", "Nice");
    await refreshCourseRating(env, ratedId);
    const list = await text(await new Client().get("/en/courses?per_page=100"));
    const card = (slug: string) => list.split("</article>").find((c) => c.includes(`/courses/${slug}"`)) ?? "";
    expect(card(rated)).toContain("4.0");
    expect(card(unrated)).not.toMatch(/class="rating"/);
  });

  it("an approval is visible at once: the moderation endpoint refreshes the average and the page", async () => {
    const slug = `moderated-${Date.now()}`;
    const id = await newClass(slug);
    await review(id, 3, "pending", "MODERATE-ME-PLEASE");
    const before = await text(await new Client().get(`/en/courses/${slug}`));
    expect(before).not.toContain("MODERATE-ME-PLEASE");
    expect(before).toContain("No reviews yet");

    const admin = (await loginStaff("super_admin")).client;
    const pending = await json(await admin.get(`/api/admin/reviews?status=pending&course_id=${id}`));
    expect(pending.items).toHaveLength(1);
    expect((await admin.post(`/api/admin/reviews/${pending.items[0].id}/moderate`, { status: "approved" })).status).toBe(200);

    const after = await text(await new Client().get(`/en/courses/${slug}`));
    expect(after).toContain("MODERATE-ME-PLEASE");
    expect(after).toContain("Based on 1 student review");
    const row = await env.DB.prepare("SELECT rating_avg, rating_count FROM courses WHERE id = ?").bind(id).first<{ rating_avg: number; rating_count: number }>();
    expect(row).toEqual({ rating_avg: 3, rating_count: 1 });
  });

  it("the review page of the student app is a real route (the buttons lead there)", async () => {
    const res = await new Client().get("/app/review/beginners-baking-class");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("instructor rating badge", () => {
  it("an instructor with no reviewed classes shows the badge and an honest 'Not rated yet'", async () => {
    const slug = `fresh-chef-${Date.now()}`;
    await newInstructor(slug);
    const html = await text(await new Client().get(`/en/instructors/${slug}`));
    expect(html).toContain("MAWAH Academy instructor");
    expect(html).toContain("Not rated yet");
    expect(html).not.toMatch(/rating-badge"[^>]*><svg[^>]*>.*<b>/s);
  });

  it("the rating is the review-weighted average of the instructor's published classes, and it shows on the class page and the cards too", async () => {
    const slug = `rated-chef-${Date.now()}`;
    const instructorId = await newInstructor(slug);
    const a = await newClass(`chef-a-${Date.now()}`, instructorId);
    const b = await newClass(`chef-b-${Date.now()}`, instructorId);
    const draft = await newClass(`chef-draft-${Date.now()}`, instructorId);
    await env.DB.prepare("UPDATE courses SET status = 'draft' WHERE id = ?").bind(draft).run();
    await review(a, 5, "approved");
    await review(a, 5, "approved");
    await review(b, 2, "approved");
    await review(draft, 1, "approved"); // a hidden class never moves the public number
    for (const id of [a, b, draft]) await refreshCourseRating(env, id);

    const html = await text(await new Client().get(`/en/instructors/${slug}`));
    expect(html).toContain("MAWAH Academy instructor");
    expect(html).toContain("4.0"); // (5 + 5 + 2) / 3 reviews
    expect(html).toContain("3 reviews");
    expect(html).toContain("2 classes"); // the draft is not counted

    const courseSlug = (await env.DB.prepare("SELECT slug FROM courses WHERE id = ?").bind(a).first<{ slug: string }>())!.slug;
    const classPage = await text(await new Client().get(`/en/courses/${courseSlug}`));
    expect(classPage).toContain("MAWAH Academy instructor");
    expect(classPage).toContain("3 reviews");
  });
});

describe("what students say about an instructor", () => {
  it("shows the latest approved reviews on their live classes, each linking to its class — and says so honestly when there are none", async () => {
    const empty = `quiet-chef-${Date.now()}`;
    await newInstructor(empty);
    const none = await text(await new Client().get(`/en/instructors/${empty}`));
    expect(none).toContain("What students say about Chef");
    expect(none).toContain("No student reviews yet");

    const slug = `talked-about-${Date.now()}`;
    const instructorId = await newInstructor(slug);
    const live = await newClass(`talk-live-${Date.now()}`, instructorId);
    const hidden = await newClass(`talk-hidden-${Date.now()}`, instructorId);
    await env.DB.prepare("UPDATE courses SET status = 'draft' WHERE id = ?").bind(hidden).run();
    await review(live, 5, "approved", "The mishti was perfect");
    await review(live, 2, "pending", "NOT-APPROVED-YET");
    await review(hidden, 5, "approved", "REVIEW-OF-A-HIDDEN-CLASS");
    const html = await text(await new Client().get(`/en/instructors/${slug}`));
    expect(html).toContain("The mishti was perfect");
    expect(html).toMatch(/<a href="\/en\/courses\/talk-live-\d+">Review class talk-live-\d+<\/a>/);
    expect(html).not.toContain("NOT-APPROVED-YET");
    expect(html).not.toContain("REVIEW-OF-A-HIDDEN-CLASS");
    expect(html).not.toContain("No student reviews yet");
  });
});

describe("shop link", () => {
  const shopLinks = (html: string) => (html.match(/href="https:\/\/mawahbd\.com"[^>]*>/g) ?? []).length;

  it("is in the menu, the mobile menu, the footer, the class list and the home page — opening a new tab safely", async () => {
    const home = await text(await new Client().get("/en"));
    expect(shopLinks(home)).toBeGreaterThanOrEqual(4); // header, mobile menu, footer, home tile
    expect(home).toContain('target="_blank"');
    expect(home).toMatch(/href="https:\/\/mawahbd\.com"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*href="https:\/\/mawahbd\.com"/);
    expect(home).toContain("opens in a new tab");
    expect(home).toContain("mawahbd.com"); // the tile says where it goes

    const list = await text(await new Client().get("/en/courses"));
    expect(list).toContain('class="pill pill-shop"');
    expect(shopLinks(list)).toBeGreaterThanOrEqual(4);

    const bn = await text(await new Client().get("/"));
    expect(bn).toContain("দোকান");
  });

  it("the owner can rename it or switch it off, and a bad address is refused", async () => {
    const admin = (await loginStaff("super_admin")).client;
    const current = (await json(await admin.get("/api/admin/settings"))).settings.shop;
    expect(current).toMatchObject({ enabled: true, url: "https://mawahbd.com" });
    try {
      expect((await admin.put("/api/admin/settings/shop", { ...current, url: "javascript:alert(1)" })).status).toBe(422);
      expect((await admin.put("/api/admin/settings/shop", { ...current, url: "mawahbd.com" })).status).toBe(422); // must be a full https:// address

      expect((await admin.put("/api/admin/settings/shop", { ...current, label_en: "Our Store" })).status).toBe(200);
      expect(await text(await new Client().get("/en"))).toContain("Our Store");
      expect((await json(await new Client().get("/api/site"))).site.shop).toEqual({ url: "https://mawahbd.com", label_bn: current.label_bn, label_en: "Our Store" });

      expect((await admin.put("/api/admin/settings/shop", { ...current, enabled: false })).status).toBe(200);
      const off = await text(await new Client().get("/en"));
      expect(shopLinks(off)).toBe(0);
      expect(off).not.toContain('class="tile tile-shop"');
      expect((await json(await new Client().get("/api/site"))).site.shop).toBeNull();
    } finally {
      await admin.put("/api/admin/settings/shop", current);
    }
    expect(shopLinks(await text(await new Client().get("/en")))).toBeGreaterThanOrEqual(4);
  });

  it("only staff who may change settings can edit it", async () => {
    const viewer = (await loginStaff("viewer")).client;
    expect((await viewer.put("/api/admin/settings/shop", { enabled: false, url: "https://mawahbd.com", label_bn: "দোকান", label_en: "Shop" })).status).toBe(403);
  });
});
