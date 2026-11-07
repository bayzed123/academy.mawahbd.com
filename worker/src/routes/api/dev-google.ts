import { Hono } from "hono";
import { isDev, type AppEnv } from "../../env";
import { HttpError, ok } from "../../lib/http";
import { DEV_WEBM } from "./dev-video";

/*
 * A stand-in for Google, for development and the automatic tests ONLY (it answers 404 anywhere else, and the real site can never be pointed at
 * it: worker/src/lib/ga4.ts only honours GOOGLE_API_BASE outside production). It lets the whole path — signing the note, the sign-in, the
 * report questions, the screen — be exercised without a Google account, and lets a test make "Google" say no in each of the ways it can
 * (see POST /api/dev/google/scenario). It checks only that the note is shaped as Google wants; the signature itself is checked in worker/test/analytics.test.ts.
 * It also stands in for Google Drive's `files.get`: which file it is — and so how Drive answers — is told by the file's id; and for Firebase Cloud
 * Messaging (the app's notifications, at the end of this file): it keeps what was "sent" and which phone is in which topic, for the tests to read
 * (GET /api/dev/google/push). A phone address starting DEV_gone_ is one Google does not know.
 */
export const devGoogle = new Hono<AppEnv>();

devGoogle.use("*", async (c, next) => {
  if (!isDev(c.env)) throw new HttpError(404, "not_found");
  return next();
});

const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/cloud-platform";
const PASS: Record<string, string> = { [ANALYTICS_SCOPE]: "dev-pass", [DRIVE_SCOPE]: "dev-drive-pass", [FCM_SCOPE]: "dev-fcm-pass" };
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
    typeof claims.scope === "string" &&
    claims.scope in PASS &&
    typeof claims.exp === "number" &&
    typeof claims.iat === "number" &&
    claims.exp > claims.iat &&
    note.split(".").length === 3 &&
    (note.split(".")[2] ?? "").length > 100;
  if (!shaped) return c.json({ error: "invalid_request", error_description: "The signed note is not shaped as Google asks." }, 400);
  if (scenario === "down") return c.json({ error: "backend_error" }, 503);
  if (scenario === "key_rejected") return c.json({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, 400);
  return c.json({ access_token: PASS[String(claims?.scope)], expires_in: 3600, token_type: "Bearer" });
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

/* ------------------------------------------------------------------------------------------------ Google Drive (files.get) */

interface DevFile {
  /** what Drive says the file is */
  mime: string;
  name: string;
  /** what `?alt=media` does: hand over the bytes (with this type), or refuse in one of the ways Drive refuses */
  media: { type: string; bytes: Uint8Array } | { refuse: "notFound" | "fileNotDownloadable" | "cannotDownloadFile" | "downloadQuotaExceeded" | "accessNotConfigured" };
  /** capabilities.canDownload (default true) */
  canDownload?: boolean;
}

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
const HTML = new TextEncoder().encode("<!doctype html><script>document.title='ran'</script><h1>not a video</h1>");

/** The id of a file starts with one of these words: that is how a test chooses what Drive does. (Real ids are 20–100 letters, digits, - and _.) */
const DEV_FILES: Record<string, DevFile> = {
  DEV_video_ok_: { mime: "video/webm", name: "Class 1 — dough.webm", media: { type: "video/webm", bytes: DEV_WEBM } },
  DEV_video_mov_: { mime: "video/quicktime", name: "Class 2 — shaping.mov", media: { type: "video/quicktime", bytes: DEV_WEBM } },
  DEV_video_octet_: { mime: "video/webm", name: "Class 3 — baking.webm", media: { type: "application/octet-stream", bytes: DEV_WEBM } },
  DEV_not_shared_: { mime: "", name: "", media: { refuse: "notFound" } },
  DEV_google_doc_: { mime: "application/vnd.google-apps.document", name: "Recipe notes", media: { refuse: "fileNotDownloadable" } },
  DEV_pdf_file_: { mime: "application/pdf", name: "Recipe card.pdf", media: { type: "application/pdf", bytes: PDF } },
  // a file that says it is a video and hands over a web page: the Worker must never pass that on
  DEV_html_file_: { mime: "video/webm", name: "Liar.webm", media: { type: "text/html", bytes: HTML } },
  DEV_download_off_: { mime: "video/webm", name: "Class 4 — no download.webm", canDownload: false, media: { refuse: "cannotDownloadFile" } },
  DEV_quota_video_: { mime: "video/webm", name: "Class 5 — popular.webm", media: { refuse: "downloadQuotaExceeded" } },
  DEV_api_off_: { mime: "video/webm", name: "Class 6.webm", media: { refuse: "accessNotConfigured" } },
};

const jsonReply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const driveError = (status: number, reason: string, message: string) => jsonReply({ error: { code: status, message, errors: [{ domain: "global", reason, message }] } }, status);

const REFUSALS = {
  notFound: () => driveError(404, "notFound", "File not found: dev."),
  fileNotDownloadable: () => driveError(403, "fileNotDownloadable", "Only files with binary content can be downloaded. Use Export with Docs Editors files."),
  cannotDownloadFile: () => driveError(403, "cannotDownloadFile", "The user does not have sufficient permissions to download this file."),
  downloadQuotaExceeded: () => driveError(403, "downloadQuotaExceeded", "The download quota for this file has been exceeded."),
  accessNotConfigured: () => driveError(403, "accessNotConfigured", "Google Drive API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=123456 then retry."),
} as const;

devGoogle.get("/drive/v3/files/:id", (c) => {
  if (c.req.header("authorization") !== "Bearer dev-drive-pass") return driveError(401, "authError", "Invalid Credentials");
  const id = c.req.param("id");
  const key = Object.keys(DEV_FILES).find((k) => id.startsWith(k));
  const file = key ? DEV_FILES[key] : undefined;
  if (!file) return REFUSALS.notFound();
  // a file that was not shared, and an API that is switched off, refuse everything — the file's details too
  if ("refuse" in file.media && (file.media.refuse === "notFound" || file.media.refuse === "accessNotConfigured")) return REFUSALS[file.media.refuse]();

  if (c.req.query("alt") !== "media") {
    const size = "bytes" in file.media ? file.media.bytes.length : undefined;
    return jsonReply({ id, name: file.name, mimeType: file.mime, ...(size !== undefined ? { size: String(size) } : {}), capabilities: { canDownload: file.canDownload !== false } }, 200);
  }
  if ("refuse" in file.media) return REFUSALS[file.media.refuse]();

  // the bytes, whole or the part asked for (Range: bytes=a-b | a- | -n), the way Drive hands them over
  const { type, bytes } = file.media;
  const total = bytes.length;
  const range = c.req.header("range");
  const base = { "Content-Type": type, "Accept-Ranges": "bytes" };
  if (!range) return new Response(bytes, { status: 200, headers: { ...base, "Content-Length": String(total) } });
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m || (m[1] === "" && m[2] === "")) return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  let start = m[1] === "" ? Math.max(0, total - Number(m[2])) : Number(m[1]);
  let end = m[1] === "" || m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  if (start >= total || start > end) return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  start = Math.max(0, start);
  end = Math.max(start, end);
  return new Response(bytes.slice(start, end + 1), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) } });
});

/* ------------------------------------------------------------------------------------------------ Firebase Cloud Messaging (the app's notifications) */

// one KV entry per notification sent and per (phone, topic): the app's calls come several at once, and a shared list would lose some
const SENT_PREFIX = "dev:push:sent:";
const TOPIC_PREFIX = "dev:push:topic:";
type Env = AppEnv["Bindings"];
const listAll = async (env: Env, prefix: string): Promise<string[]> => {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.KV.list({ prefix, cursor });
    names.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names.sort();
};
const fcmError = (status: number, statusText: string, message: string, reason?: string) =>
  jsonReply({ error: { code: status, message, status: statusText, details: reason ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] : [] } }, status);

/** What a test reads back: the notifications sent (oldest first) and each phone's topics. */
devGoogle.get("/push", async (c) => {
  const sentKeys = await listAll(c.env, SENT_PREFIX);
  const sent = (await Promise.all(sentKeys.map((k) => c.env.KV.get(k)))).flatMap((v) => (v ? [JSON.parse(v) as unknown] : []));
  const topics: Record<string, string[]> = {};
  for (const k of await listAll(c.env, TOPIC_PREFIX)) {
    const [token = "", topic = ""] = k.slice(TOPIC_PREFIX.length).split("|");
    (topics[token] ??= []).push(topic);
  }
  return c.json({ ok: true, sent, topics });
});
devGoogle.delete("/push", async (c) => {
  await Promise.all([...(await listAll(c.env, SENT_PREFIX)), ...(await listAll(c.env, TOPIC_PREFIX))].map((k) => c.env.KV.delete(k)));
  return c.json({ ok: true });
});

devGoogle.post("/fcm/v1/projects/:project/:action", async (c) => {
  if (c.req.param("action") !== "messages:send") return fcmError(404, "NOT_FOUND", "Not found");
  if (c.req.header("authorization") !== "Bearer dev-fcm-pass") return fcmError(401, "UNAUTHENTICATED", "Request had invalid authentication credentials.");
  const scenario = await scenarioOf(c);
  if (scenario === "api_disabled")
    return fcmError(403, "PERMISSION_DENIED", "Firebase Cloud Messaging API has not been used in project 123456 before or it is disabled.", "SERVICE_DISABLED");
  if (scenario === "no_access") return fcmError(403, "PERMISSION_DENIED", "Permission 'cloudmessaging.messages.create' denied on resource (or it may not exist).");
  if (scenario === "quota") return fcmError(429, "RESOURCE_EXHAUSTED", "Quota exceeded.");
  if (scenario === "down") return fcmError(503, "UNAVAILABLE", "The service is currently unavailable.");
  const body = (await c.req.json().catch(() => ({}))) as {
    validate_only?: boolean;
    message?: { topic?: string; condition?: string; notification?: { title?: string; body?: string }; data?: Record<string, unknown>; android?: { notification?: { channel_id?: string } } };
  };
  const m = body.message;
  const shaped =
    !!m &&
    (typeof m.topic === "string") !== (typeof m.condition === "string") &&
    !!m.notification?.title &&
    !!m.notification.body &&
    typeof m.data?.path === "string" &&
    Object.values(m.data).every((v) => typeof v === "string") &&
    m.android?.notification?.channel_id === "classes";
  if (!shaped) return fcmError(400, "INVALID_ARGUMENT", "Request contains an invalid argument.");
  const id = `${Date.now().toString().padStart(15, "0")}-${crypto.randomUUID()}`;
  const name = `projects/${c.req.param("project")}/messages/${id}`;
  if (body.validate_only) return c.json({ name });
  const record = { project: c.req.param("project"), ...(m.topic ? { topic: m.topic } : { condition: m.condition }), title: m.notification!.title, body: m.notification!.body, data: m.data };
  await c.env.KV.put(`${SENT_PREFIX}${id}`, JSON.stringify(record), { expirationTtl: 3600 });
  return c.json({ name });
});

devGoogle.post("/iid/:op", async (c) => {
  const op = c.req.param("op");
  if (op !== "v1:batchAdd" && op !== "v1:batchRemove") return jsonReply({ error: "NOT_FOUND" }, 404);
  if (c.req.header("authorization") !== "Bearer dev-fcm-pass" || c.req.header("access_token_auth") !== "true") return jsonReply({ error: "Unauthorized" }, 401);
  if ((await scenarioOf(c)) === "down") return jsonReply({ error: "Service unavailable" }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { to?: string; registration_tokens?: string[] };
  const topic = /^\/topics\/([A-Za-z0-9_.~%-]+)$/.exec(body.to ?? "")?.[1];
  if (!topic || !Array.isArray(body.registration_tokens) || !body.registration_tokens.length) return jsonReply({ error: "InvalidParameters" }, 400);
  const results = await Promise.all(
    body.registration_tokens.map(async (token) => {
      if (token.startsWith("DEV_gone_")) return { error: "NOT_FOUND" };
      const key = `${TOPIC_PREFIX}${token}|${topic}`;
      if (op === "v1:batchAdd") await c.env.KV.put(key, "1", { expirationTtl: 3600 });
      else await c.env.KV.delete(key);
      return {};
    }),
  );
  return c.json({ results });
});
