import { GA_EVENTS } from "@mawah/shared";
import type { Env } from "../env";
import { all } from "../lib/db";
import { runRealtime, runReport, type Failure, type Ga4Problem, type Table } from "../lib/ga4";

/*
 * The numbers behind Admin → Analytics: what Google Analytics saw, put next to what the shop's own records say. Every figure shown is a figure
 * Google (or the shop's database) returned — nothing is estimated or filled in, and a panel Google could not answer says so instead of showing zeros.
 */

export type RangeKey = "today" | "7d" | "28d" | "90d";
export const RANGE_KEYS: readonly RangeKey[] = ["today", "7d", "28d", "90d"];
const RANGES: Record<RangeKey, { start: string; end: string; days: number }> = {
  today: { start: "today", end: "today", days: 1 },
  "7d": { start: "6daysAgo", end: "today", days: 7 },
  "28d": { start: "27daysAgo", end: "today", days: 28 },
  "90d": { start: "89daysAgo", end: "today", days: 90 },
};

export interface ClassRow {
  slug: string;
  /** null = a page Google saw that is not a class of the shop any more (renamed or removed) */
  id: number | null;
  title_bn: string;
  title_en: string;
  status: string | null;
  views: number;
  people: number;
  /** average time spent on the class page, per person, in seconds */
  seconds_per_person: number;
  /** Google's own shop counters for this class: seen, put in the basket ("Enroll now"), checkout opened, bought */
  item_views: number;
  carts: number;
  checkouts: number;
  ga_purchases: number;
  /** the shop's own records for the same days: paid sales and the money they brought */
  paid_sales: number;
  revenue: number;
}

export interface Bucket {
  name: string;
  sessions: number;
  users: number;
}

export interface AnalyticsReport {
  connected: true;
  range: RangeKey;
  fetched_at: string;
  /** the shop's own days (Dhaka calendar) the "your records" figures cover */
  from: string;
  to: string;
  overview: { users: number; new_users: number; sessions: number; page_views: number; engagement_rate: number; avg_session_sec: number } | null;
  daily: { date: string; page_views: number; users: number }[];
  classes: ClassRow[];
  events: { event: string; count: number; users: number }[];
  sources: Bucket[];
  devices: Bucket[];
  countries: Bucket[];
  searches: { term: string; count: number }[];
  promotions: { name: string; views: number; clicks: number }[];
  pages: { path: string; views: number; users: number }[];
  /** panels Google could not answer while the others worked */
  problems: { section: string; problem: Ga4Problem; detail?: string }[];
}

export interface NotConnected {
  connected: false;
  problem: Ga4Problem;
  detail?: string;
  status?: number;
}

export interface Realtime {
  connected: true;
  fetched_at: string;
  /** people on the site in the last 30 minutes (Google's own definition) */
  active_users: number;
  pages: { title: string; users: number }[];
}

const DHAKA_MS = 6 * 3600 * 1000;
const dhakaDate = (ms = Date.now()) => new Date(ms + DHAKA_MS).toISOString().slice(0, 10);

/** `/courses/x`, `/en/courses/x` and the same with a trailing slash — the pages a class is read on. */
const CLASS_PAGE = "^/(en/)?courses/[^/]+/?$";
const slugOf = (path: string) => (path.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "").toLowerCase();

const dateRanges = (r: RangeKey) => [{ startDate: RANGES[r].start, endDate: RANGES[r].end }];
const desc = (name: string) => [{ metric: { metricName: name }, desc: true }];
const only = (field: string, value: string) => ({ filter: { fieldName: field, stringFilter: { matchType: "EXACT", value } } });

/** Questions asked of Google for one range — each answered (or refused) on its own, so one bad field blanks one panel, not the screen. */
function questions(range: RangeKey) {
  const dr = dateRanges(range);
  return {
    overview: { dateRanges: dr, metrics: ["activeUsers", "newUsers", "sessions", "screenPageViews", "engagementRate", "averageSessionDuration"].map((name) => ({ name })) },
    daily: { dateRanges: dr, dimensions: [{ name: "date" }], metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }], orderBys: [{ dimension: { dimensionName: "date" } }], limit: 100 },
    classes: {
      dateRanges: dr,
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "userEngagementDuration" }],
      dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "FULL_REGEXP", value: CLASS_PAGE } } },
      orderBys: desc("screenPageViews"),
      limit: 200,
    },
    items: {
      dateRanges: dr,
      dimensions: [{ name: "itemId" }],
      metrics: ["itemsViewed", "itemsAddedToCart", "itemsCheckedOut", "itemsPurchased"].map((name) => ({ name })),
      orderBys: desc("itemsViewed"),
      limit: 200,
    },
    events: {
      dateRanges: dr,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: GA_EVENTS.map((e) => e.name) } } },
      limit: 100,
    },
    sources: { dateRanges: dr, dimensions: [{ name: "sessionSourceMedium" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }], orderBys: desc("sessions"), limit: 10 },
    devices: { dateRanges: dr, dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }], orderBys: desc("sessions"), limit: 5 },
    countries: { dateRanges: dr, dimensions: [{ name: "country" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }], orderBys: desc("sessions"), limit: 10 },
    searches: {
      dateRanges: dr,
      dimensions: [{ name: "searchTerm" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: only("eventName", "view_search_results"),
      orderBys: desc("eventCount"),
      limit: 15,
    },
    promotions: {
      dateRanges: dr,
      dimensions: [{ name: "itemPromotionName" }],
      metrics: [{ name: "itemsViewedInPromotion" }, { name: "itemsClickedInPromotion" }],
      orderBys: desc("itemsViewedInPromotion"),
      limit: 15,
    },
    pages: {
      dateRanges: dr,
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      dimensionFilter: { notExpression: { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: "/admin" } } } },
      orderBys: desc("screenPageViews"),
      limit: 15,
    },
  };
}

const row = (t: Table | undefined, i: number) => t?.rows[i];

/** The shop's own sales per class for the same days (paid orders, money only — a free enrolment is not a sale), keyed by class id. */
async function ownSales(env: Env, from: string, to: string): Promise<Map<number, { sales: number; revenue: number }>> {
  const rows = await all<{ course_id: number; sales: number; revenue: number }>(
    env.DB,
    `SELECT oi.course_id, COUNT(*) AS sales, COALESCE(SUM(oi.price), 0) AS revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'paid' AND date(o.paid_at, '+6 hours') BETWEEN ? AND ? AND oi.price > 0 GROUP BY oi.course_id`,
    from,
    to,
  );
  return new Map(rows.map((r) => [r.course_id, { sales: r.sales, revenue: r.revenue }]));
}

/** Failures that mean "nothing will work until the owner fixes the setup" (as opposed to one panel Google would not answer). */
const SETUP_PROBLEMS: ReadonlySet<Ga4Problem> = new Set(["not_configured", "key_invalid", "key_rejected", "api_disabled", "no_access", "property_missing", "network", "quota", "google_error"]);

export async function buildReport(env: Env, range: RangeKey): Promise<AnalyticsReport | NotConnected> {
  const q = questions(range);
  const keys = Object.keys(q) as (keyof typeof q)[];
  // the overview goes first and alone: if the setup is not right, one answer says so, instead of ten identical refusals
  const first = await runReport(env, q.overview);
  if (!first.ok && SETUP_PROBLEMS.has(first.problem)) return { connected: false, problem: first.problem, detail: first.detail, status: first.status };
  const rest = await Promise.all(keys.filter((k) => k !== "overview").map(async (k) => [k, await runReport(env, q[k])] as const));
  const got = new Map<string, Table | Failure>([["overview", first.ok ? first.data : first], ...rest.map(([k, a]) => [k, a.ok ? a.data : a] as const)]);
  const table = (k: string) => {
    const v = got.get(k);
    return v && !("ok" in v) ? (v as Table) : undefined;
  };
  const problems = [...got.entries()].flatMap(([section, v]) => ("ok" in v && v.ok === false ? [{ section, problem: v.problem, detail: v.detail }] : []));

  const days = RANGES[range].days;
  const from = dhakaDate(Date.now() - (days - 1) * 86_400_000);
  const to = dhakaDate();
  const [courses, sales] = await Promise.all([
    all<{ id: number; slug: string; title_bn: string; title_en: string; status: string }>(env.DB, "SELECT id, slug, title_bn, title_en, status FROM courses WHERE deleted_at IS NULL"),
    ownSales(env, from, to),
  ]);

  // class pages: Bangla and English pages of one class are one row
  const byClass = new Map<string, ClassRow>();
  const blank = (slug: string): ClassRow => {
    const c = courses.find((x) => x.slug.toLowerCase() === slug);
    const s = c ? sales.get(c.id) : undefined;
    return { slug, id: c?.id ?? null, title_bn: c?.title_bn ?? "", title_en: c?.title_en ?? "", status: c?.status ?? null, views: 0, people: 0, seconds_per_person: 0, item_views: 0, carts: 0, checkouts: 0, ga_purchases: 0, paid_sales: s?.sales ?? 0, revenue: s?.revenue ?? 0 };
  };
  const seconds = new Map<string, number>();
  for (const r of table("classes")?.rows ?? []) {
    const slug = slugOf(r.dimensions[0] ?? "");
    if (!slug) continue;
    const c = byClass.get(slug) ?? blank(slug);
    c.views += r.metrics[0] ?? 0;
    c.people += r.metrics[1] ?? 0; // a person who read the class in both languages counts once in each
    seconds.set(slug, (seconds.get(slug) ?? 0) + (r.metrics[2] ?? 0));
    byClass.set(slug, c);
  }
  for (const r of table("items")?.rows ?? []) {
    const slug = (r.dimensions[0] ?? "").toLowerCase();
    // only ids that are classes of the shop (banners are sent as items too: "hero-1", "offer-3")
    if (!courses.some((x) => x.slug.toLowerCase() === slug)) continue;
    const c = byClass.get(slug) ?? blank(slug);
    [c.item_views, c.carts, c.checkouts, c.ga_purchases] = [r.metrics[0] ?? 0, r.metrics[1] ?? 0, r.metrics[2] ?? 0, r.metrics[3] ?? 0];
    byClass.set(slug, c);
  }
  // every class on sale is listed, also one nobody has opened — that is worth knowing — and any class that sold in these days
  for (const c of courses) {
    const slug = c.slug.toLowerCase();
    if (!byClass.has(slug) && (["published", "coming_soon"].includes(c.status) || sales.has(c.id))) byClass.set(slug, blank(slug));
  }
  const classes = [...byClass.values()]
    .map((c) => ({ ...c, seconds_per_person: c.people ? Math.round((seconds.get(c.slug) ?? 0) / c.people) : 0 }))
    .sort((a, b) => b.views - a.views || b.paid_sales - a.paid_sales || a.slug.localeCompare(b.slug));

  const ov = row(table("overview"), 0)?.metrics;
  const bucket = (k: string): Bucket[] => (table(k)?.rows ?? []).map((r) => ({ name: r.dimensions[0] ?? "", sessions: r.metrics[0] ?? 0, users: r.metrics[1] ?? 0 }));
  return {
    connected: true,
    range,
    fetched_at: new Date().toISOString(),
    from,
    to,
    overview: ov ? { users: ov[0] ?? 0, new_users: ov[1] ?? 0, sessions: ov[2] ?? 0, page_views: ov[3] ?? 0, engagement_rate: ov[4] ?? 0, avg_session_sec: ov[5] ?? 0 } : null,
    daily: (table("daily")?.rows ?? []).map((r) => ({ date: r.dimensions[0] ?? "", page_views: r.metrics[0] ?? 0, users: r.metrics[1] ?? 0 })),
    classes,
    events: (table("events")?.rows ?? []).map((r) => ({ event: r.dimensions[0] ?? "", count: r.metrics[0] ?? 0, users: r.metrics[1] ?? 0 })),
    sources: bucket("sources"),
    devices: bucket("devices"),
    countries: bucket("countries"),
    searches: (table("searches")?.rows ?? []).filter((r) => r.dimensions[0] && r.dimensions[0] !== "(not set)").map((r) => ({ term: r.dimensions[0] ?? "", count: r.metrics[0] ?? 0 })),
    promotions: (table("promotions")?.rows ?? []).filter((r) => r.dimensions[0] && r.dimensions[0] !== "(not set)").map((r) => ({ name: r.dimensions[0] ?? "", views: r.metrics[0] ?? 0, clicks: r.metrics[1] ?? 0 })),
    pages: (table("pages")?.rows ?? []).map((r) => ({ path: r.dimensions[0] ?? "", views: r.metrics[0] ?? 0, users: r.metrics[1] ?? 0 })),
    problems,
  };
}

/** Who is on the site right now (Google's "realtime": the last 30 minutes) and which pages they are reading. */
export async function buildRealtime(env: Env): Promise<Realtime | NotConnected> {
  const a = await runRealtime(env, { dimensions: [{ name: "unifiedScreenName" }], metrics: [{ name: "activeUsers" }], metricAggregations: ["TOTAL"], orderBys: desc("activeUsers"), limit: 10 });
  if (!a.ok) return { connected: false, problem: a.problem, detail: a.detail, status: a.status };
  return {
    connected: true,
    fetched_at: new Date().toISOString(),
    active_users: a.data.totals?.[0] ?? a.data.rows.reduce((sum, r) => sum + (r.metrics[0] ?? 0), 0),
    pages: a.data.rows.map((r) => ({ title: r.dimensions[0] ?? "", users: r.metrics[0] ?? 0 })),
  };
}
