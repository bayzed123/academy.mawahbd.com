import { Hono } from "hono";
import type { AppEnv, Ctx } from "../../../env";
import { csvResponse, toCsv } from "../../../lib/csv";
import { all, first } from "../../../lib/db";
import { HttpError, ok } from "../../../lib/http";
import { requirePerm } from "../../../middleware/auth";

export const reports = new Hono<AppEnv>();

/* All dates are Dhaka calendar days (UTC+6, no daylight saving) — what the owner sees on a calendar. */
const DHAKA_MS = 6 * 3600 * 1000;
const dhakaDate = (ms = Date.now()) => new Date(ms + DHAKA_MS).toISOString().slice(0, 10);
const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function range(c: Ctx) {
  const q = c.req.query();
  const to = isDay(q.to) ? q.to : dhakaDate();
  const from = isDay(q.from) ? q.from : dhakaDate(Date.parse(to) - 29 * 86_400_000 + 0);
  if (from > to) throw new HttpError(422, "validation", "validation", { from: "invalid_range" });
  if (Date.parse(to) - Date.parse(from) > 800 * 86_400_000) throw new HttpError(422, "validation", "validation", { from: "range_too_long" });
  return { from, to, group: q.group === "month" ? ("month" as const) : ("day" as const) };
}

const PAID_IN_RANGE = "o.status = 'paid' AND date(o.paid_at, '+6 hours') BETWEEN ? AND ?";

async function revenueReport(c: Ctx) {
  const { from, to, group } = range(c);
  const fmt = group === "month" ? "%Y-%m" : "%Y-%m-%d";
  const db = c.env.DB;
  const [series, totals, byCourse, byMethod, byCoupon, refunds] = await Promise.all([
    all<{ period: string; orders: number; revenue: number; discounts: number }>(
      db,
      `SELECT strftime('${fmt}', o.paid_at, '+6 hours') AS period, COUNT(*) AS orders, SUM(o.total) AS revenue, SUM(o.discount) AS discounts
       FROM orders o WHERE ${PAID_IN_RANGE} GROUP BY period ORDER BY period`,
      from,
      to,
    ),
    first<{ orders: number; revenue: number; discounts: number; students: number }>(
      db,
      `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue, COALESCE(SUM(o.discount), 0) AS discounts, COUNT(DISTINCT o.student_id) AS students
       FROM orders o WHERE ${PAID_IN_RANGE}`,
      from,
      to,
    ),
    all(
      db,
      `SELECT oi.course_id, c.title_en, c.title_bn, COUNT(*) AS sales, SUM(oi.price) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN courses c ON c.id = oi.course_id
       WHERE ${PAID_IN_RANGE} GROUP BY oi.course_id ORDER BY revenue DESC, sales DESC LIMIT 50`,
      from,
      to,
    ),
    all(
      db,
      `SELECT COALESCE(o.method, o.gateway, 'other') AS method, COUNT(*) AS orders, SUM(o.total) AS revenue
       FROM orders o WHERE ${PAID_IN_RANGE} GROUP BY 1 ORDER BY revenue DESC`,
      from,
      to,
    ),
    all(
      db,
      `SELECT o.coupon_code AS code, COUNT(*) AS orders, SUM(o.discount) AS discount_total
       FROM orders o WHERE ${PAID_IN_RANGE} AND o.coupon_code IS NOT NULL GROUP BY o.coupon_code ORDER BY orders DESC LIMIT 20`,
      from,
      to,
    ),
    first<{ orders: number; amount: number }>(
      db,
      `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS amount FROM orders o WHERE o.status = 'refunded' AND date(o.refunded_at, '+6 hours') BETWEEN ? AND ?`,
      from,
      to,
    ),
  ]);
  const t = totals ?? { orders: 0, revenue: 0, discounts: 0, students: 0 };
  return {
    from,
    to,
    group,
    totals: { ...t, average_order: t.orders ? Math.round(t.revenue / t.orders) : 0 },
    refunds: refunds ?? { orders: 0, amount: 0 },
    series,
    by_course: byCourse,
    by_method: byMethod,
    by_coupon: byCoupon,
  };
}

reports.get("/reports/revenue", requirePerm("reports:revenue"), async (c) => ok(c, await revenueReport(c)));

reports.get("/reports/revenue.csv", requirePerm("reports:revenue"), async (c) => {
  const r = await revenueReport(c);
  return csvResponse(
    `revenue-${r.from}_${r.to}`,
    toCsv(r.series as unknown as Record<string, unknown>[], [
      { key: "period", label: r.group === "month" ? "Month" : "Date" },
      { key: "orders", label: "Paid orders" },
      { key: "revenue", label: "Revenue (BDT)" },
      { key: "discounts", label: "Discounts (BDT)" },
    ]),
  );
});

interface LearningRow {
  id: number;
  title_en: string;
  title_bn: string;
  status: string;
  lesson_count: number;
  rating_avg: number;
  rating_count: number;
  enrolled: number;
  completed: number;
  lessons_done: number;
  reviews_pending: number;
  questions_open: number;
}

async function learningReport(c: Ctx) {
  const rows = await all<LearningRow>(
    c.env.DB,
    `SELECT c.id, c.title_en, c.title_bn, c.status, c.lesson_count, c.rating_avg, c.rating_count,
       (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS enrolled,
       (SELECT COUNT(*) FROM certificates ce WHERE ce.course_id = c.id AND ce.revoked_at IS NULL) AS completed,
       (SELECT COUNT(*) FROM lesson_progress lp JOIN enrollments e ON e.student_id = lp.student_id AND e.course_id = lp.course_id AND e.status = 'active' WHERE lp.course_id = c.id) AS lessons_done,
       (SELECT COUNT(*) FROM reviews r WHERE r.course_id = c.id AND r.status = 'pending') AS reviews_pending,
       (SELECT COUNT(*) FROM lesson_questions q WHERE q.course_id = c.id AND q.status = 'open') AS questions_open
     FROM courses c WHERE c.deleted_at IS NULL AND c.status IN ('published','archived') ORDER BY enrolled DESC, c.sort`,
  );
  return rows.map((r) => {
    const total = r.enrolled * r.lesson_count;
    return {
      ...r,
      completion_pct: r.enrolled ? Math.round((r.completed / r.enrolled) * 100) : 0,
      avg_progress_pct: total ? Math.min(100, Math.round((r.lessons_done / total) * 100)) : 0,
    };
  });
}

reports.get("/reports/learning", requirePerm("reports:learning"), async (c) => {
  const items = await learningReport(c);
  const top = items.filter((i) => i.rating_count > 0).sort((a, b) => b.rating_avg - a.rating_avg || b.rating_count - a.rating_count).slice(0, 5);
  return ok(c, { items, top_rated: top });
});

reports.get("/reports/learning.csv", requirePerm("reports:learning"), async (c) =>
  csvResponse(
    "learning",
    toCsv(await learningReport(c) as unknown as Record<string, unknown>[], [
      { key: "title_en", label: "Class" },
      { key: "status", label: "Status" },
      { key: "enrolled", label: "Active students" },
      { key: "completed", label: "Completed (certificates)" },
      { key: "completion_pct", label: "Completion %" },
      { key: "avg_progress_pct", label: "Average progress %" },
      { key: "rating_avg", label: "Rating" },
      { key: "rating_count", label: "Reviews" },
      { key: "reviews_pending", label: "Reviews waiting" },
      { key: "questions_open", label: "Open questions" },
    ]),
  ),
);

/** One row per enrollment — handy for the owner's own spreadsheet. */
reports.get("/reports/enrollments.csv", requirePerm("reports:learning"), async (c) => {
  const { from, to } = range(c);
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT e.enrolled_at, e.status, e.source, s.name AS student, s.email, c.title_en AS course,
       (SELECT COUNT(*) FROM lesson_progress lp WHERE lp.student_id = e.student_id AND lp.course_id = e.course_id) AS lessons_done, c.lesson_count
     FROM enrollments e JOIN students s ON s.id = e.student_id JOIN courses c ON c.id = e.course_id
     WHERE date(e.enrolled_at, '+6 hours') BETWEEN ? AND ? ORDER BY e.enrolled_at DESC LIMIT 20000`,
    from,
    to,
  );
  return csvResponse(
    `enrollments-${from}_${to}`,
    toCsv(rows, [
      { key: "enrolled_at", label: "Enrolled (UTC)" },
      { key: "student", label: "Student" },
      { key: "email", label: "Email" },
      { key: "course", label: "Class" },
      { key: "source", label: "Source" },
      { key: "status", label: "Status" },
      { key: "lessons_done", label: "Lessons done" },
      { key: "lesson_count", label: "Lessons total" },
    ]),
  );
});
