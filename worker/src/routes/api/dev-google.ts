import { Hono } from "hono";
import { isDev, type AppEnv } from "../../env";
import { HttpError, ok } from "../../lib/http";

/*
 * A stand-in for Google, for development and the automatic tests ONLY (it answers 404 anywhere else, and the real site can never be pointed at
 * it: worker/src/lib/ga4.ts only honours GOOGLE_API_BASE outside production). It lets the whole path — signing the note, the sign-in, the
 * report questions, the screen — be exercised without a Google account, and lets a test make "Google" say no in each of the ways it can
 * (see POST /api/dev/google/scenario). It checks only that the note is shaped as Google wants; the signature itself is checked in worker/test/analytics.test.ts.
 */
export const devGoogle = new Hono<AppEnv>();

devGoogle.use("*", async (c, next) => {
  if (!isDev(c.env)) throw new HttpError(404, "not_found");
  return next();
});

const SCENARIO_KEY = "dev:google:scenario";
type Scenario = "ok" | "key_rejected" | "api_disabled" | "no_access" | "quota" | "down";

devGoogle.post("/scenario", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { scenario?: Scenario };
  const scenario = (["ok", "key_rejected", "api_disabled", "no_access", "quota", "down"] as const).find((s) => s === body.scenario) ?? "ok";
  await c.env.KV.put(SCENARIO_KEY, scenario, { expirationTtl: 3600 });
  return ok(c, { scenario });
});

const scenarioOf = async (c: { env: AppEnv["Bindings"] }): Promise<Scenario> => ((await c.env.KV.get(SCENARIO_KEY)) as Scenario | null) ?? "ok";

const part = (jwt: string, i: number): Record<string, unknown> | null => {
  try {
    const text = jwt.split(".")[i] ?? "";
    return JSON.parse(atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=")));
  } catch {
    return null;
  }
};

devGoogle.post("/token", async (c) => {
  const scenario = await scenarioOf(c);
  const form = await c.req.formData().catch(() => null);
  const note = String(form?.get("assertion") ?? "");
  const header = part(note, 0);
  const claims = part(note, 1);
  const shaped =
    form?.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer" &&
    header?.alg === "RS256" &&
    typeof claims?.iss === "string" &&
    claims.scope === "https://www.googleapis.com/auth/analytics.readonly" &&
    typeof claims.exp === "number" &&
    typeof claims.iat === "number" &&
    claims.exp > claims.iat &&
    note.split(".").length === 3 &&
    (note.split(".")[2] ?? "").length > 100;
  if (!shaped) return c.json({ error: "invalid_request", error_description: "The signed note is not shaped as Google asks." }, 400);
  if (scenario === "down") return c.json({ error: "backend_error" }, 503);
  if (scenario === "key_rejected") return c.json({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, 400);
  return c.json({ access_token: "dev-pass", expires_in: 3600, token_type: "Bearer" });
});

type Req = {
  dimensions?: { name: string }[];
  metrics?: { name: string }[];
  dimensionFilter?: { filter?: { fieldName?: string; stringFilter?: { value?: string }; inListFilter?: { values?: string[] } } };
};

/** A table in the shape the Analytics Data API answers with: headers, then rows of strings. */
const table = (dimensions: string[], metrics: string[], rows: [string[], number[]][], totals?: number[]) => ({
  dimensionHeaders: dimensions.map((name) => ({ name })),
  metricHeaders: metrics.map((name) => ({ name, type: "TYPE_INTEGER" })),
  rows: rows.map(([d, m]) => ({ dimensionValues: d.map((value) => ({ value })), metricValues: m.map((value) => ({ value: String(value) })) })),
  ...(totals ? { totals: [{ dimensionValues: [], metricValues: totals.map((value) => ({ value: String(value) })) }] } : {}),
  rowCount: rows.length,
});

function answer(kind: string, body: Req) {
  const dims = (body.dimensions ?? []).map((d) => d.name);
  const mets = (body.metrics ?? []).map((m) => m.name);
  const dim = dims[0] ?? "";
  if (kind === "runRealtimeReport") {
    return table(dims, mets, [[["Beginners Baking Class | MAWAH Academy"], [3]], [["MAWAH Academy"], [2]]], [5]);
  }
  switch (dim) {
    case "":
      return { ...table([], mets, [[[], mets.map((m) => ({ activeUsers: 140, newUsers: 90, sessions: 210, screenPageViews: 700, engagementRate: 0.62, averageSessionDuration: 95 })[m] ?? 0)]]) };
    case "date":
      return table(dims, mets, [[["20261014"], [120, 40]], [["20261015"], [260, 70]], [["20261016"], [320, 90]]]);
    case "pagePath":
      // the class pages (a filter on them was asked for) or the top pages
      return body.dimensionFilter?.filter?.stringFilter?.value?.includes("courses")
        ? table(dims, mets, [[["/courses/beginners-baking-class"], [120, 60, 3600]], [["/en/courses/beginners-baking-class"], [30, 15, 600]], [["/courses/a-class-that-was-renamed"], [7, 4, 120]]])
        : table(dims, mets, [[["/"], [300, 150]], [["/courses/beginners-baking-class"], [120, 60]]]);
    case "itemId":
      return table(dims, mets, [[["beginners-baking-class"], [100, 20, 10, 4]], [["hero-1"], [50, 0, 0, 0]]]);
    case "eventName":
      return table(dims, mets, [[["view_item"], [150, 70]], [["add_to_cart"], [20, 15]], [["begin_checkout"], [10, 8]], [["purchase"], [4, 4]], [["contact_click"], [12, 9]]]);
    case "sessionSourceMedium":
      return table(dims, mets, [[["google / organic"], [100, 80]], [["facebook / referral"], [60, 50]], [["(direct) / (none)"], [50, 40]]]);
    case "deviceCategory":
      return table(dims, mets, [[["mobile"], [170, 110]], [["desktop"], [40, 30]]]);
    case "country":
      return table(dims, mets, [[["Bangladesh"], [180, 120]], [["United Kingdom"], [20, 15]]]);
    case "searchTerm":
      return table(dims, mets, [[["cake"], [9]], [["(not set)"], [3]]]);
    case "itemPromotionName":
      return table(dims, mets, [[["Learn to bake in Bangla"], [80, 6]]]);
    default:
      return table(dims, mets, []);
  }
}

devGoogle.post("/v1beta/properties/:spec", async (c) => {
  const scenario = await scenarioOf(c);
  const [, kind = ""] = c.req.param("spec").split(":");
  if (c.req.header("authorization") !== "Bearer dev-pass") return c.json({ error: { code: 401, message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED" } }, 401);
  if (scenario === "api_disabled")
    return c.json({ error: { code: 403, status: "PERMISSION_DENIED", message: "Google Analytics Data API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=123456 then retry." } }, 403);
  if (scenario === "no_access") return c.json({ error: { code: 403, status: "PERMISSION_DENIED", message: "User does not have sufficient permissions for this property." } }, 403);
  if (scenario === "quota") return c.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Exhausted property tokens for a project per hour." } }, 429);
  if (scenario === "down") return c.json({ error: { code: 503, status: "UNAVAILABLE", message: "The service is currently unavailable." } }, 503);
  if (kind !== "runReport" && kind !== "runRealtimeReport") return c.json({ error: { code: 404, message: "Not found", status: "NOT_FOUND" } }, 404);
  return c.json(answer(kind, (await c.req.json().catch(() => ({}))) as Req));
});
