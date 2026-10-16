import { Hono } from "hono";
import type { AppEnv, Ctx } from "../../../env";
import { audit } from "../../../lib/audit";
import { csvResponse, toCsv } from "../../../lib/csv";
import { checkConnection, forgetPass, GA4_LAST_KEY, parseServiceAccount, propertyId, type Ga4Problem } from "../../../lib/ga4";
import { HttpError, ok } from "../../../lib/http";
import { getSettings } from "../../../lib/settings";
import { trackingFor } from "../../../lib/tracking";
import { requirePerm } from "../../../middleware/auth";
import { buildRealtime, buildReport, RANGE_KEYS, type AnalyticsReport, type NotConnected, type Realtime, type RangeKey } from "../../../services/analytics";

/*
 * Admin → Analytics. Reads the shop's Google Analytics numbers with the service-account key (lib/ga4.ts). Reports are kept for ten minutes (the
 * numbers Google gives are not live anyway, and every question costs Google quota); "who is on the site now" for half a minute. The key never
 * reaches this screen: it shows whether one is set, the account's e-mail address (which the owner must add in Google Analytics) and the words
 * Google used when it said no. A refused question is an ANSWER here (status 200, `connected: false`), never an error, so the screen can explain it.
 */
export const analytics = new Hono<AppEnv>();

const LAST_KEY = GA4_LAST_KEY;
const reportKey = (r: RangeKey) => `ga4:report:${r}`;
const LIVE_KEY = "ga4:live";
const REPORT_TTL_S = 600;
// Cloudflare KV cannot keep anything for less than 60 seconds, so the answer is stored for a minute and used for half of it
const LIVE_TTL_S = 60;
const LIVE_FRESH_MS = 30_000;

interface Last {
  at: string;
  ok: boolean;
  problem: Ga4Problem | null;
  detail: string | null;
}

async function remember(c: Ctx, okay: boolean, problem?: Ga4Problem, detail?: string): Promise<void> {
  const last: Last = { at: new Date().toISOString(), ok: okay, problem: okay ? null : (problem ?? "other"), detail: okay ? null : (detail ?? null) };
  await c.env.KV.put(LAST_KEY, JSON.stringify(last)).catch(() => undefined);
}

/** Both of the buttons that call Google cost quota: a few per hour per person. */
async function underHourlyCap(c: Ctx, name: string, max: number): Promise<void> {
  const used = `${name}:${c.get("staff")!.id}:${Math.floor(Date.now() / 3_600_000)}`;
  const count = Number((await c.env.KV.get(used)) ?? 0);
  if (count >= max) throw new HttpError(429, "rate_limited");
  await c.env.KV.put(used, String(count + 1), { expirationTtl: 3700 });
}

analytics.get("/analytics/status", requirePerm("analytics:read"), async (c) => {
  const settings = await getSettings(c.env, { fresh: true });
  const key = parseServiceAccount(c.env.GA4_SERVICE_ACCOUNT_JSON);
  return ok(c, {
    measurement_id: settings.analytics.ga4 || null,
    // do the pages of the real site carry the tag? (they never do on a developer's machine or on the free fallback address)
    tag_live: !!trackingFor(c.env, c.env.SITE_URL, settings).ga4,
    property_id: propertyId(c.env) || null,
    stream_id: (c.env.GA_STREAM_ID ?? "").replace(/\D/g, "") || null,
    key_set: key.ok || key.problem === "key_invalid",
    key_problem: key.ok ? null : key.problem === "key_invalid" ? ("key_invalid" as const) : null,
    // not a secret: it is the address the owner adds under Google Analytics → Admin → Property access management
    service_email: key.ok ? key.account.client_email : null,
    last: await c.env.KV.get<Last>(LAST_KEY, "json"),
  });
});

const rangeOf = (c: Ctx): RangeKey => {
  const asked = c.req.query("range") as RangeKey | undefined;
  return asked && RANGE_KEYS.includes(asked) ? asked : "28d";
};

/** The report for a range: the one kept for ten minutes, or a fresh answer from Google (kept, if it worked). */
async function reportFor(c: Ctx, range: RangeKey): Promise<AnalyticsReport | NotConnected> {
  const cached = await c.env.KV.get<AnalyticsReport>(reportKey(range), "json");
  if (cached) return cached;
  const report = await buildReport(c.env, range);
  if (report.connected) {
    await c.env.KV.put(reportKey(range), JSON.stringify(report), { expirationTtl: REPORT_TTL_S });
    await remember(c, true);
  } else await remember(c, false, report.problem, report.detail);
  return report;
}

analytics.get("/analytics/report", requirePerm("analytics:read"), async (c) => ok(c, { report: await reportFor(c, rangeOf(c)) }));

/** The class table as a spreadsheet file (the same figures as on the screen). */
analytics.get("/analytics/classes.csv", requirePerm("analytics:read"), async (c) => {
  const range = rangeOf(c);
  const report = await reportFor(c, range);
  if (!report.connected) throw new HttpError(409, "analytics_not_connected");
  return csvResponse(
    `classes-${range}-${report.from}_${report.to}`,
    toCsv(report.classes.map((k) => ({ ...k, title: k.title_en || k.title_bn || k.slug })) as unknown as Record<string, unknown>[], [
      { key: "title", label: "Class" },
      { key: "slug", label: "Address name" },
      { key: "views", label: "Page views" },
      { key: "people", label: "People" },
      { key: "seconds_per_person", label: "Seconds on page per person" },
      { key: "carts", label: "Pressed Enroll now" },
      { key: "checkouts", label: "Opened checkout" },
      { key: "ga_purchases", label: "Paid (Google saw)" },
      { key: "paid_sales", label: "Paid sales (shop records)" },
      { key: "revenue", label: "Money (BDT, shop records)" },
    ]),
  );
});

analytics.get("/analytics/realtime", requirePerm("analytics:read"), async (c) => {
  const cached = await c.env.KV.get<Realtime>(LIVE_KEY, "json");
  if (cached && Date.now() - Date.parse(cached.fetched_at) < LIVE_FRESH_MS) return ok(c, { live: cached });
  const live = await buildRealtime(c.env);
  if (live.connected) await c.env.KV.put(LIVE_KEY, JSON.stringify(live), { expirationTtl: LIVE_TTL_S });
  return ok(c, { live });
});

/** "Check the connection": sign in again and ask the smallest question there is; say how it ended, in the owner's terms. */
analytics.post("/analytics/check", requirePerm("analytics:manage"), async (c) => {
  await underHourlyCap(c, "ga4check", 20);
  forgetPass();
  const r = await checkConnection(c.env);
  await remember(c, r.ok, r.ok ? undefined : r.problem, r.ok ? undefined : r.detail);
  await audit(c, { action: "analytics.checked", entity: "settings", entityId: "analytics", meta: { ok: r.ok, problem: r.ok ? null : r.problem } });
  // never `{ ok: false }`: the admin client reads that as a failed request and would not show the explanation
  return ok(c, r.ok ? { connected: true } : { connected: false, problem: r.problem, detail: r.detail, status: r.status });
});

/** Forget what was kept, so the next look asks Google again. */
analytics.post("/analytics/refresh", requirePerm("analytics:manage"), async (c) => {
  await underHourlyCap(c, "ga4refresh", 30);
  await Promise.all([...RANGE_KEYS.map((r) => c.env.KV.delete(reportKey(r))), c.env.KV.delete(LIVE_KEY)]);
  return ok(c, {});
});
