import { Hono } from "hono";
import type { AppEnv, Env } from "../../../env";
import { activeProvider } from "../../../services/chatbot";
import { all, first } from "../../../lib/db";
import { GA4_LAST_KEY } from "../../../lib/ga4";
import { ok } from "../../../lib/http";
import { MAIL_DOMAIN_REFUSED_KEY, MAIL_LAST_TEST_KEY } from "../../../lib/mailer";
import { getSettings } from "../../../lib/settings";
import { SMS_LAST_KEY, smsConfigured, type SmsLast } from "../../../lib/sms";
import { requirePerm } from "../../../middleware/auth";
import { REAL_STUDENT } from "../../../services/guests";
import { can } from "@mawah/shared";

export const dashboard = new Hono<AppEnv>();

const DHAKA_MS = 6 * 3600 * 1000;
const days = (n: number): string[] => {
  const base = Date.now() + DHAKA_MS;
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
};
const months = (n: number): string[] => {
  const now = new Date(Date.now() + DHAKA_MS);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
};
const fill = (labels: string[], rows: { period: string; v: number }[]) => {
  const map = new Map(rows.map((r) => [r.period, Number(r.v)]));
  return labels.map((period) => ({ period, value: map.get(period) ?? 0 }));
};

export type HealthStatus = "ok" | "warn" | "error" | "info";
export interface HealthCheck {
  key: "database" | "storage" | "payments" | "email" | "sms" | "analytics" | "video" | "chatbot" | "security";
  status: HealthStatus;
  /** machine codes the admin UI translates, e.g. ["sslcommerz_keys_missing"] */
  issues: string[];
}

/**
 * Live health checks for the strip at the top of the dashboard: each says green / amber / red and lists exactly what to fix.
 * They look at configuration and cheap probes only — nothing here changes data or calls a paid API.
 */
export async function runHealthChecks(env: Env): Promise<HealthCheck[]> {
  const settings = await getSettings(env, { fresh: true });
  const checks: HealthCheck[] = [];

  let db: HealthStatus = "ok";
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch {
    db = "error";
  }
  checks.push({ key: "database", status: db, issues: db === "ok" ? [] : ["database_unreachable"] });

  let storage: HealthStatus = "ok";
  try {
    await env.R2.head("health/probe");
  } catch {
    storage = "error";
  }
  checks.push({ key: "storage", status: storage, issues: storage === "ok" ? [] : ["storage_unreachable"] });

  const pay: string[] = [];
  let payStatus: HealthStatus = "ok";
  const flag = (s: HealthStatus) => {
    if (s === "error" || (s === "warn" && payStatus !== "error")) payStatus = s;
  };
  if (!settings.payments.sslcommerz && !settings.payments.manual && !settings.payments.bkash_direct) {
    pay.push("no_payment_method");
    flag("error");
  }
  if (settings.payments.sslcommerz && !(env.SSLCOMMERZ_STORE_ID && env.SSLCOMMERZ_STORE_PASSWORD)) {
    pay.push("sslcommerz_keys_missing");
    flag("warn");
  }
  if (settings.payments.bkash_direct && !(env.BKASH_APP_KEY && env.BKASH_APP_SECRET && env.BKASH_USERNAME && env.BKASH_PASSWORD)) {
    pay.push("bkash_keys_missing");
    flag("warn");
  }
  const n = settings.payments.manual_numbers;
  if (settings.payments.manual && !(n.bkash || n.nagad || n.rocket)) {
    pay.push("manual_numbers_missing");
    flag("warn");
  }
  if (env.ENVIRONMENT === "production" && env.PAYMENT_MODE === "sandbox") {
    pay.push("sandbox_mode");
    flag("warn");
  }
  checks.push({ key: "payments", status: payStatus, issues: pay });

  // e-mail: a key is set — and if the owner's last test message failed, say so (a key alone proves nothing)
  const mail: string[] = [];
  const [lastMailTest, domainRefused] = env.RESEND_API_KEY ? await Promise.all([env.KV.get<{ sent: boolean }>(MAIL_LAST_TEST_KEY, "json"), env.KV.get(MAIL_DOMAIN_REFUSED_KEY)]) : [null, null];
  if (!env.RESEND_API_KEY) mail.push("email_not_configured");
  else if (lastMailTest && !lastMailTest.sent) mail.push("email_test_failed");
  else if (domainRefused) mail.push("email_domain_unverified"); // Resend refused a message in the last days because the sending domain is not verified
  checks.push({ key: "email", status: mail.length ? "warn" : "ok", issues: mail });
  // text messages: the secrets are set — and if the last message the company was given did not go through, say so
  const sms: string[] = [];
  if (!smsConfigured(env)) sms.push("sms_not_configured");
  else if ((await env.KV.get<SmsLast>(SMS_LAST_KEY, "json"))?.ok === false) sms.push("sms_last_failed");
  checks.push({ key: "sms", status: sms.length ? "warn" : "ok", issues: sms });
  // counting visits: the tag needs the ID (Settings → Analytics); the numbers inside this admin need the Google key (Analytics) — and a look that failed is said
  const ga: string[] = [];
  let gaStatus: HealthStatus = "ok";
  if (!settings.analytics.ga4) {
    ga.push("analytics_no_id");
    gaStatus = "warn";
  } else if (!env.GOOGLE_SERVICE_ACCOUNT) {
    ga.push("analytics_key_missing");
    gaStatus = "info";
  } else if ((await env.KV.get<{ ok: boolean }>(GA4_LAST_KEY, "json"))?.ok === false) {
    ga.push("analytics_last_failed");
    gaStatus = "warn";
  }
  checks.push({ key: "analytics", status: gaStatus, issues: ga });
  checks.push({ key: "video", status: env.STREAM ? "ok" : "warn", issues: env.STREAM ? [] : ["stream_not_configured"] });

  const chat: string[] = [];
  let chatStatus: HealthStatus = "ok";
  if (!settings.chatbot.enabled) {
    chat.push("chat_disabled");
    chatStatus = "info";
  } else {
    const active = await activeProvider(env);
    const row = await first<{ provider: string; last_test_ok: number | null }>(env.DB, "SELECT provider, last_test_ok FROM ai_provider_configs WHERE is_active = 1");
    if (!row) {
      chat.push("no_active_provider");
      chatStatus = "warn";
    } else if (!active) {
      chat.push("provider_not_ready");
      chatStatus = "error";
    } else if (row.last_test_ok === 0) {
      chat.push("last_test_failed");
      chatStatus = "warn";
    } else if (row.last_test_ok === null) {
      chat.push("never_tested");
      chatStatus = "info";
    }
  }
  checks.push({ key: "chatbot", status: chatStatus, issues: chat });

  const sec: string[] = [];
  const staffCount = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM staff");
  if (env.SETUP_TOKEN && (staffCount?.n ?? 0) > 0) sec.push("setup_token_still_set");
  if (env.ENVIRONMENT === "production" && env.ALLOW_MOCK_PAYMENTS === "true") sec.push("mock_payments_flag_set");
  if (!env.TURNSTILE_SECRET) sec.push("turnstile_off");
  checks.push({ key: "security", status: sec.some((s) => s !== "turnstile_off") ? "warn" : sec.length ? "info" : "ok", issues: sec });
  return checks;
}

/** Cheap counters for the sidebar badges (polled every minute) — the full dashboard is only loaded on the dashboard page. */
dashboard.get("/badges", requirePerm("dashboard:read"), async (c) => {
  const n = async (sql: string) => (await first<{ n: number }>(c.env.DB, sql))?.n ?? 0;
  const [orders, reviews, questions, messages, handoffs] = await Promise.all([
    n("SELECT COUNT(*) AS n FROM orders WHERE status = 'awaiting_verification'"),
    n("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"),
    n("SELECT COUNT(*) AS n FROM lesson_questions WHERE status = 'open'"),
    n("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'"),
    n("SELECT COUNT(*) AS n FROM chat_escalations WHERE status = 'open'"),
  ]);
  return ok(c, { orders, reviews, questions, messages: messages + handoffs });
});

dashboard.get("/health", requirePerm("dashboard:read"), async (c) => ok(c, { checks: await runHealthChecks(c.env) }));

dashboard.get("/dashboard", requirePerm("dashboard:read"), async (c) => {
  const db = c.env.DB;
  const me = c.get("staff")!;
  const d30 = days(30);
  const m12 = months(12);
  const since30 = d30[0];
  const since60 = new Date(Date.parse(since30) - 30 * 86_400_000).toISOString().slice(0, 10);
  const showMoney = can(me.role, "reports:revenue");

  const count = async (sql: string, ...p: (string | number)[]) => (await first<{ n: number }>(db, sql, ...p))?.n ?? 0;

  const [
    rev30, revPrev, orders30, studentsTotal, students30, enrollmentsActive, pendingVerify, openQuestions, pendingReviews, newMessages, openEscalations,
    live, soon, emptyTotal, revDaily, enrollDaily, revMonthly, topCourses, recentEnrollments, recentOrders, emptyClasses, waiting, firstRun,
  ] = await Promise.all([
    first<{ v: number }>(db, "SELECT COALESCE(SUM(total), 0) AS v FROM orders WHERE status = 'paid' AND date(paid_at, '+6 hours') >= ?", since30),
    first<{ v: number }>(db, "SELECT COALESCE(SUM(total), 0) AS v FROM orders WHERE status = 'paid' AND date(paid_at, '+6 hours') >= ? AND date(paid_at, '+6 hours') < ?", since60, since30),
    count("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND total > 0 AND date(paid_at, '+6 hours') >= ?", since30), // free enrolments are not sales
    count(`SELECT COUNT(*) AS n FROM students s WHERE ${REAL_STUDENT}`),
    count(`SELECT COUNT(*) AS n FROM students s WHERE ${REAL_STUDENT} AND date(s.created_at, '+6 hours') >= ?`, since30),
    count("SELECT COUNT(*) AS n FROM enrollments WHERE status = 'active'"),
    count("SELECT COUNT(*) AS n FROM orders WHERE status = 'awaiting_verification'"),
    count("SELECT COUNT(*) AS n FROM lesson_questions WHERE status = 'open'"),
    count("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'"),
    count("SELECT COUNT(*) AS n FROM chat_escalations WHERE status = 'open'"),
    count("SELECT COUNT(*) AS n FROM courses WHERE deleted_at IS NULL AND status = 'published'"),
    count("SELECT COUNT(*) AS n FROM courses WHERE deleted_at IS NULL AND status = 'coming_soon'"),
    count("SELECT COUNT(*) AS n FROM courses WHERE deleted_at IS NULL AND status = 'published' AND lesson_count = 0"),
    all<{ period: string; v: number }>(db, "SELECT strftime('%Y-%m-%d', paid_at, '+6 hours') AS period, SUM(total) AS v FROM orders WHERE status = 'paid' AND date(paid_at, '+6 hours') >= ? GROUP BY period", since30),
    all<{ period: string; v: number }>(db, "SELECT strftime('%Y-%m-%d', enrolled_at, '+6 hours') AS period, COUNT(*) AS v FROM enrollments WHERE date(enrolled_at, '+6 hours') >= ? GROUP BY period", since30),
    all<{ period: string; v: number }>(db, "SELECT strftime('%Y-%m', paid_at, '+6 hours') AS period, SUM(total) AS v FROM orders WHERE status = 'paid' AND strftime('%Y-%m', paid_at, '+6 hours') >= ? GROUP BY period", m12[0]),
    all(
      db,
      `SELECT c.id, c.title_en, c.title_bn, COUNT(*) AS sales, SUM(oi.price) AS revenue FROM order_items oi
       JOIN orders o ON o.id = oi.order_id JOIN courses c ON c.id = oi.course_id
       WHERE o.status = 'paid' AND oi.price > 0 AND date(o.paid_at, '+6 hours') >= ? GROUP BY c.id ORDER BY sales DESC, revenue DESC LIMIT 5`,
      since30,
    ),
    all(
      db,
      `SELECT e.id, e.enrolled_at, e.source, s.name AS student_name, c.title_en, c.title_bn FROM enrollments e
       JOIN students s ON s.id = e.student_id JOIN courses c ON c.id = e.course_id ORDER BY e.enrolled_at DESC, e.id DESC LIMIT 8`,
    ),
    all(db, "SELECT id, public_id, invoice_no, status, total, customer_name, method, created_at FROM orders ORDER BY created_at DESC, id DESC LIMIT 8"),
    all<{ id: number; title_en: string; title_bn: string }>(db, "SELECT id, title_en, title_bn FROM courses WHERE deleted_at IS NULL AND status = 'published' AND lesson_count = 0 ORDER BY sort LIMIT 6"),
    all<{ id: number; title_en: string; title_bn: string; waiting: number }>(
      db,
      `SELECT c.id, c.title_en, c.title_bn, COUNT(*) AS waiting FROM notify_signups n JOIN courses c ON c.id = n.course_id
       WHERE n.notified_at IS NULL AND c.deleted_at IS NULL GROUP BY c.id ORDER BY waiting DESC LIMIT 5`,
    ),
    getSettings(c.env, { fresh: true }),
  ]);

  const attention = [
    { key: "manual_payments", severity: "high", count: pendingVerify, href: "/orders?status=awaiting_verification" },
    { key: "classes_without_lessons", severity: "high", count: emptyTotal, href: "/courses", items: emptyClasses },
    { key: "reviews_pending", severity: "medium", count: pendingReviews, href: "/reviews?status=pending" },
    { key: "questions_open", severity: "medium", count: openQuestions, href: "/questions?status=open" },
    { key: "messages_new", severity: "medium", count: newMessages, href: "/messages?status=new" },
    { key: "escalations_open", severity: "medium", count: openEscalations, href: "/messages?tab=handoffs" },
    { key: "launch_audience", severity: "info", count: waiting.reduce((a, w) => a + w.waiting, 0), href: "/signups", items: waiting },
  ].filter((a) => a.count > 0);

  // first-run guided checklist: every step is derived from real data, so it ticks itself off as the owner works
  const [instructorReady, lessonReady, staffCount, health] = await Promise.all([
    count("SELECT COUNT(*) AS n FROM instructors WHERE deleted_at IS NULL AND active = 1 AND photo_key IS NOT NULL AND (length(bio_bn) > 0 OR length(bio_en) > 0)"),
    count("SELECT COUNT(*) AS n FROM courses WHERE deleted_at IS NULL AND status = 'published' AND lesson_count > 0"),
    count("SELECT COUNT(*) AS n FROM staff WHERE active = 1"),
    runHealthChecks(c.env),
  ]);
  const hs = (k: HealthCheck["key"]) => health.find((h) => h.key === k)?.status;
  const onboarding = {
    dismissed: firstRun.onboarding.dismissed,
    steps: [
      { key: "contacts", done: !!(firstRun.contact.whatsapp || firstRun.contact.phone || firstRun.contact.email), href: "/settings" },
      { key: "payments", done: hs("payments") === "ok", href: "/settings" },
      { key: "instructor", done: instructorReady > 0, href: "/instructors" },
      { key: "lessons", done: lessonReady > 0, href: "/courses" },
      { key: "policies", done: !!(firstRun.policies.refund_bn || firstRun.policies.refund_en), href: "/settings" },
      { key: "email", done: hs("email") === "ok", href: "/settings?tab=email" },
      { key: "chatbot", done: hs("chatbot") === "ok" || hs("chatbot") === "info", href: "/chatbot" },
      { key: "team", done: staffCount > 1, href: "/staff", optional: true },
    ],
  };

  return ok(c, {
    kpis: {
      revenue_30d: showMoney ? (rev30?.v ?? 0) : null,
      revenue_prev_30d: showMoney ? (revPrev?.v ?? 0) : null,
      orders_30d: orders30,
      students_total: studentsTotal,
      students_30d: students30,
      enrollments_active: enrollmentsActive,
      classes_live: live,
      classes_coming_soon: soon,
      pending_verifications: pendingVerify,
      open_questions: openQuestions,
      pending_reviews: pendingReviews,
      new_messages: newMessages,
    },
    charts: {
      revenue_daily: showMoney ? fill(d30, revDaily) : null,
      revenue_monthly: showMoney ? fill(m12, revMonthly) : null,
      enrollments_daily: fill(d30, enrollDaily),
    },
    top_classes: topCourses,
    recent_enrollments: recentEnrollments,
    recent_orders: can(me.role, "orders:read") ? recentOrders : [],
    attention,
    onboarding,
  });
});
