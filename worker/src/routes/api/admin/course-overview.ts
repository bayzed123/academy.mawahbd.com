import { Hono } from "hono";
import type { AppEnv } from "../../../env";
import { all, first } from "../../../lib/db";
import { intParam, notFound, ok } from "../../../lib/http";
import { requirePerm } from "../../../middleware/auth";

/**
 * Admin → Classes → a class's read-only "View" page. One request returns the numbers an owner looks at before deciding what to do
 * with a class: how many students, how much it earned, how it is rated, who is waiting for it, and what is still missing.
 * Everything is counted from real rows — nothing here is estimated.
 */
export const courseOverview = new Hono<AppEnv>();

courseOverview.get("/courses/:id/overview", requirePerm("courses:read"), async (c) => {
  const id = intParam(c, "id");
  const course = await first<{ id: number; status: string; lesson_count: number; duration_sec: number; rating_avg: number; rating_count: number }>(
    c.env.DB,
    "SELECT id, status, lesson_count, duration_sec, rating_avg, rating_count FROM courses WHERE id = ?",
    id,
  );
  if (!course) throw notFound();
  const [enrol, sales, reviewsWaiting, waiting, shape, reviews] = await Promise.all([
    first<{ active: number; ever: number }>(c.env.DB, "SELECT COALESCE(SUM(status = 'active'), 0) AS active, COUNT(*) AS ever FROM enrollments WHERE course_id = ?", id),
    first<{ revenue: number; orders: number }>(
      c.env.DB,
      `SELECT COALESCE(SUM(oi.price), 0) AS revenue, COUNT(DISTINCT o.id) AS orders
       FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.course_id = ? AND o.status = 'paid'`,
      id,
    ),
    first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM reviews WHERE course_id = ? AND status = 'pending'", id),
    first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM notify_signups WHERE course_id = ? AND notified_at IS NULL", id),
    first<{ modules: number; previews: number }>(
      c.env.DB,
      "SELECT (SELECT COUNT(*) FROM modules WHERE course_id = ?1) AS modules, (SELECT COUNT(*) FROM lessons WHERE course_id = ?1 AND is_preview = 1) AS previews",
      id,
    ),
    all<{ id: number; rating: number; body: string; status: string; created_at: string; student_name: string }>(
      c.env.DB,
      `SELECT r.id, r.rating, r.body, r.status, r.created_at, s.name AS student_name
       FROM reviews r JOIN students s ON s.id = r.student_id WHERE r.course_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 3`,
      id,
    ),
  ]);
  return ok(c, {
    stats: {
      enrolled: enrol?.active ?? 0,
      ever_enrolled: enrol?.ever ?? 0,
      revenue: sales?.revenue ?? 0,
      paid_orders: sales?.orders ?? 0,
      rating_avg: course.rating_avg,
      rating_count: course.rating_count,
      reviews_waiting: reviewsWaiting?.n ?? 0,
      waiting: waiting?.n ?? 0,
      modules: shape?.modules ?? 0,
      lessons: course.lesson_count,
      previews: shape?.previews ?? 0,
      minutes: Math.round(course.duration_sec / 60),
    },
    reviews,
  });
});
