import { Hono, type Context } from "hono";
import type { Lang } from "@mawah/shared";
import type { AppEnv } from "../env";
import { all, first } from "../lib/db";
import { HttpError } from "../lib/http";
import { pageCtxFor } from "../lib/pagectx";
import { cachedPage, renderHtml } from "../lib/render";
import { checkRateLimit } from "../middleware/ratelimit";
import {
  approvedReviews,
  coursesByInstructor,
  getCourseBySlug,
  getCurriculum,
  getInstructorBySlug,
  listCourses,
  listInstructors,
  publishedCounts,
  relatedCourses,
  reviewSummary,
  reviewsByInstructor,
  shortName,
  type CourseSort,
} from "../services/catalog";
import { liveBanners } from "../services/banners";
import { certificateByCode } from "../services/learning";
import { CoursesPage } from "../views/pages/courses";
import { CoursePage, RelatedFragment, ReviewList } from "../views/pages/course";
import { HomePage } from "../views/pages/home";
import {
  AboutPage,
  BlogListPage,
  BlogPostPage,
  CertificatePage,
  ContactPage,
  ErrorPage,
  InstructorPage,
  PolicyPage,
  VerifyPage,
  type PostRow,
} from "../views/pages/misc";

const SORTS: CourseSort[] = ["featured", "new", "price_asc", "price_desc"];
const POST_COLS =
  "slug, title_bn, title_en, excerpt_bn, excerpt_en, body_bn, body_en, cover_key, seo_title_bn, seo_title_en, seo_desc_bn, seo_desc_en, published_at, updated_at";

type C = Context<AppEnv>;

/** One router instance per language: Bangla at "/", English under "/en". */
export function pageRoutes(lang: Lang) {
  const r = new Hono<AppEnv>();
  const flashOf = (c: C) => c.req.query("n");

  r.get("/", async (c) => {
    const flash = flashOf(c);
    return cachedPage(c, { ttl: 120, bypass: !!flash }, async () => {
      const ctx = await pageCtxFor(c, lang, "/");
      const [feat, beginners, instructors, counts, minRow, reviews, posts, banners] = await Promise.all([
        listCourses(c.env, { featuredOnly: true, perPage: 9 }),
        listCourses(c.env, { level: "beginner", perPage: 4 }),
        listInstructors(c.env),
        publishedCounts(c.env),
        first<{ p: number | null }>(c.env.DB, "SELECT MIN(price) AS p FROM courses WHERE deleted_at IS NULL AND status = 'published' AND price > 0"),
        all<{ id: number; rating: number; body: string; reply: string | null; created_at: string; name: string; course_slug: string; title_bn: string; title_en: string }>(
          c.env.DB,
          `SELECT r.id, r.rating, r.body, r.reply, r.created_at, s.name, c.slug AS course_slug, c.title_bn, c.title_en
           FROM reviews r JOIN students s ON s.id = r.student_id JOIN courses c ON c.id = r.course_id
           WHERE r.status = 'approved' AND r.body <> '' AND c.deleted_at IS NULL AND c.status IN ('published','coming_soon')
           ORDER BY r.rating DESC, r.created_at DESC LIMIT 3`,
        ),
        all<PostRow>(c.env.DB, `SELECT ${POST_COLS} FROM blog_posts WHERE status = 'published' AND deleted_at IS NULL ORDER BY published_at DESC LIMIT 3`),
        liveBanners(c.env, "hero", 8),
      ]);
      let featured = feat.items;
      if (featured.length === 0) featured = (await listCourses(c.env, { perPage: 9 })).items;
      return renderHtml(
        c,
        ctx,
        <HomePage
          ctx={ctx}
          data={{
            banners,
            featured,
            beginners: beginners.items,
            instructors: instructors.slice(0, 3),
            reviews: reviews.map(({ name, title_bn, title_en, ...rest }) => ({ ...rest, author: shortName(name), course_title_bn: title_bn, course_title_en: title_en })),
            posts,
            classCount: counts.courses,
            minPrice: minRow?.p ?? 0,
            flash,
          }}
        />,
        { cache: "no-store" },
      );
    });
  });

  r.get("/courses", async (c) => {
    const q = c.req.query();
    const page = Math.min(500, Math.max(1, Math.floor(Number(q.page) || 1)));
    const sort = (SORTS as string[]).includes(q.sort ?? "") ? (q.sort as CourseSort) : "featured";
    const level = q.level === "beginner" ? "beginner" : undefined;
    const cat = q.cat && /^[a-z0-9-]{1,60}$/.test(q.cat) ? q.cat : undefined;
    const search = q.q?.trim().slice(0, 80) || undefined;
    return cachedPage(c, { ttl: 120, keep: ["cat", "sort", "page", "level"], bypass: !!search }, async () => {
      const ctx = await pageCtxFor(c, lang, "/courses");
      const perPage = 12;
      const { items, total } = await listCourses(c.env, { category: cat, q: search, sort, page, perPage, level });
      return renderHtml(c, ctx, <CoursesPage ctx={ctx} data={{ courses: items, total, page, perPage, cat, q: search, sort, level }} />);
    });
  });

  r.get("/search", (c) => c.redirect(`${lang === "en" ? "/en" : ""}/courses?q=${encodeURIComponent((c.req.query("q") ?? "").slice(0, 80))}`, 302));

  r.get("/courses/:slug", async (c) => {
    const slug = c.req.param("slug");
    const flash = flashOf(c);
    return cachedPage(c, { ttl: 180, bypass: !!flash }, async () => {
      const ctx = await pageCtxFor(c, lang, `/courses/${slug}`);
      const course = await getCourseBySlug(c.env, slug);
      if (!course) return renderHtml(c, ctx, <ErrorPage ctx={ctx} status={404} />, { status: 404 });
      const [curriculum, reviews, summary] = await Promise.all([getCurriculum(c.env, course.id), approvedReviews(c.env, course.id), reviewSummary(c.env, course.id)]);
      return renderHtml(c, ctx, <CoursePage ctx={ctx} data={{ course, curriculum, reviews, summary, flash }} />);
    });
  });

  r.get("/instructors/:slug", async (c) =>
    cachedPage(c, { ttl: 300 }, async () => {
      const ctx = await pageCtxFor(c, lang, `/instructors/${c.req.param("slug")}`);
      const instructor = await getInstructorBySlug(c.env, c.req.param("slug"));
      if (!instructor) return renderHtml(c, ctx, <ErrorPage ctx={ctx} status={404} />, { status: 404 });
      const [courses, reviews] = await Promise.all([coursesByInstructor(c.env, instructor.id), reviewsByInstructor(c.env, instructor.id)]);
      return renderHtml(c, ctx, <InstructorPage ctx={ctx} instructor={instructor} courses={courses} reviews={reviews} />);
    }),
  );

  r.get("/blog", async (c) =>
    cachedPage(c, { ttl: 300 }, async () => {
      const ctx = await pageCtxFor(c, lang, "/blog");
      const posts = await all<PostRow>(c.env.DB, `SELECT ${POST_COLS} FROM blog_posts WHERE status = 'published' AND deleted_at IS NULL ORDER BY published_at DESC LIMIT 60`);
      return renderHtml(c, ctx, <BlogListPage ctx={ctx} posts={posts} />);
    }),
  );

  r.get("/blog/:slug", async (c) =>
    cachedPage(c, { ttl: 300 }, async () => {
      const ctx = await pageCtxFor(c, lang, `/blog/${c.req.param("slug")}`);
      const post = await first<PostRow>(c.env.DB, `SELECT ${POST_COLS} FROM blog_posts WHERE slug = ? AND status = 'published' AND deleted_at IS NULL`, c.req.param("slug"));
      if (!post) return renderHtml(c, ctx, <ErrorPage ctx={ctx} status={404} />, { status: 404 });
      return renderHtml(c, ctx, <BlogPostPage ctx={ctx} post={post} />);
    }),
  );

  r.get("/about", (c) =>
    cachedPage(c, { ttl: 600 }, async () => {
      const ctx = await pageCtxFor(c, lang, "/about");
      return renderHtml(c, ctx, <AboutPage ctx={ctx} />);
    }),
  );

  r.get("/contact", (c) => {
    const flash = flashOf(c);
    return cachedPage(c, { ttl: 600, bypass: !!flash }, async () => {
      const ctx = await pageCtxFor(c, lang, "/contact");
      return renderHtml(c, ctx, <ContactPage ctx={ctx} flash={flash} />);
    });
  });

  r.get("/policies/:kind", (c) => {
    const kind = c.req.param("kind");
    return cachedPage(c, { ttl: 600 }, async () => {
      const ctx = await pageCtxFor(c, lang, `/policies/${kind}`);
      if (kind !== "refund" && kind !== "privacy" && kind !== "terms") return renderHtml(c, ctx, <ErrorPage ctx={ctx} status={404} />, { status: 404 });
      return renderHtml(c, ctx, <PolicyPage ctx={ctx} kind={kind} />);
    });
  });

  /* Certificate lookups are never cached and are rate-limited: the code (60 bits) is the credential. */
  const verify = async (c: C, rawCode: string | undefined) => {
    const code = rawCode?.trim().slice(0, 40) || undefined;
    const ctx = await pageCtxFor(c, lang, code ? `/verify/${rawCode}` : "/verify");
    if (code && !(await checkRateLimit(c.env, "RL_FORM", `RL_FORM:verify:${c.get("ip")}`))) {
      throw new HttpError(429, "rate_limited");
    }
    const cert = code ? await certificateByCode(c.env, code) : undefined;
    return renderHtml(c, ctx, <VerifyPage ctx={ctx} code={code} cert={cert} />);
  };
  r.get("/verify", (c) => verify(c, c.req.query("code")));
  r.get("/verify/:code", (c) => verify(c, c.req.param("code")));

  r.get("/certificate/:code", async (c) => {
    const code = c.req.param("code");
    if (!(await checkRateLimit(c.env, "RL_FORM", `RL_FORM:cert:${c.get("ip")}`))) throw new HttpError(429, "rate_limited");
    const ctx = await pageCtxFor(c, lang, `/certificate/${code}`);
    const cert = await certificateByCode(c.env, code);
    if (!cert || cert.revoked_at) return renderHtml(c, ctx, <ErrorPage ctx={ctx} status={404} />, { status: 404 });
    return renderHtml(c, ctx, <CertificatePage ctx={ctx} cert={cert} />);
  });

  return r;
}

/** Lazy-loaded HTML fragments for the course page (language comes from ?lang=). */
export const fragmentRoutes = new Hono<AppEnv>();

/**
 * Reviews are part of the class page itself now (so search engines and no-script visitors get them). This route stays so
 * that a page cached before the release can still fill its reviews instead of showing "Loading…" for the cache's lifetime.
 */
fragmentRoutes.get("/reviews/:slug", async (c) => {
  const lang: Lang = c.req.query("lang") === "en" ? "en" : "bn";
  return cachedPage(c, { ttl: 180, keep: ["lang"] }, async () => {
    const ctx = await pageCtxFor(c, lang, "/");
    const course = await getCourseBySlug(c.env, c.req.param("slug"));
    if (!course) throw new HttpError(404, "not_found");
    const reviews = await approvedReviews(c.env, course.id, 12);
    const body = await (reviews.length ? <ReviewList ctx={ctx} reviews={reviews} /> : <p class="muted">{ctx.t("reviews.empty.title")}</p>).toString();
    return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" } });
  });
});

fragmentRoutes.get("/related/:slug", async (c) => {
  const lang: Lang = c.req.query("lang") === "en" ? "en" : "bn";
  return cachedPage(c, { ttl: 180, keep: ["lang"] }, async () => {
    const ctx = await pageCtxFor(c, lang, "/");
    const course = await getCourseBySlug(c.env, c.req.param("slug"));
    if (!course) throw new HttpError(404, "not_found");
    const body = await (<RelatedFragment ctx={ctx} courses={await relatedCourses(c.env, course, 3)} />).toString();
    return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" } });
  });
});

