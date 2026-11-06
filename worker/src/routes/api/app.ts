import { Hono } from "hono";
import type { AppEnv, Ctx } from "../../env";
import { audit } from "../../lib/audit";
import { first, nowIso, run } from "../../lib/db";
import { forbidden, notFound, ok } from "../../lib/http";
import { loadStudent, requireStudent } from "../../middleware/auth";
import { rateLimit } from "../../middleware/ratelimit";
import { getCourseBySlug, getCurriculum, listCourses } from "../../services/catalog";

/*
 * The Android app's free classes (Admin → Classes → "Where is this class shown?" → Android app). They are free there and nowhere else:
 * the website never lists, shows or sells them (services/catalog.ts ON_WEBSITE). A student joins one with a tap — the class is theirs at
 * once, with no order, because nothing is bought — and studies it with the same lesson screens as any other class.
 */
export const appRoutes = new Hono<AppEnv>();

/** Every live free class, in the order staff set. Only live ones: a draft or "coming soon" app class is not shown yet. */
appRoutes.get("/courses", async (c) => {
  const { items, total } = await listCourses(c.env, { channel: "app", perPage: 60 });
  c.header("Cache-Control", "public, max-age=60, s-maxage=120");
  return ok(c, { courses: items, total });
});

/** A live free class by its address — so a draft or a class sold on the website is "not found" here. */
async function liveAppClass(c: Ctx) {
  const course = await getCourseBySlug(c.env, c.req.param("slug") ?? "", { channel: "app" });
  if (!course || course.status !== "published") throw notFound();
  return course;
}

/** One free class: what it teaches and its lessons' titles, and — for a signed-in student — whether it is theirs already. */
appRoutes.get("/courses/:slug", loadStudent, async (c) => {
  const course = await liveAppClass(c);
  const me = c.get("student");
  const [curriculum, enrollment] = await Promise.all([
    getCurriculum(c.env, course.id),
    me ? first<{ status: string }>(c.env.DB, "SELECT status FROM enrollments WHERE student_id = ? AND course_id = ?", me.id, course.id) : Promise.resolve(null),
  ]);
  return ok(c, { course, curriculum, joined: enrollment?.status === "active", revoked: enrollment?.status === "revoked" });
});

/**
 * Join a free class. Doing it twice changes nothing. A class staff took back from this student (Admin → Students) stays taken back: joining
 * again is not a way around that.
 */
appRoutes.post("/courses/:slug/join", requireStudent, rateLimit("RL_FORM"), async (c) => {
  const me = c.get("student")!;
  const course = await liveAppClass(c);
  const had = await first<{ status: string }>(c.env.DB, "SELECT status FROM enrollments WHERE student_id = ? AND course_id = ?", me.id, course.id);
  if (had?.status === "revoked") throw forbidden("enrollment_revoked");
  if (!had) {
    const res = await run(
      c.env.DB,
      `INSERT INTO enrollments (student_id, course_id, order_id, status, source, enrolled_at) VALUES (?, ?, NULL, 'active', 'free', ?)
       ON CONFLICT(student_id, course_id) DO NOTHING`,
      me.id,
      course.id,
      nowIso(),
    );
    if ((res.meta.changes ?? 0) > 0) await audit(c, { action: "enrollment.joined_free", entity: "course", entityId: course.id, summary: course.title_en, meta: { via: "app" } });
  }
  return ok(c, { joined: true, slug: course.slug });
});
