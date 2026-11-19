import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../../env";
import { API_KEY_SHAPE, cleanApiKey } from "../../../lib/ai-providers";
import { audit } from "../../../lib/audit";
import { encryptSecret } from "../../../lib/crypto";
import { nowIso, run } from "../../../lib/db";
import { HttpError, ok, parseBody } from "../../../lib/http";
import { getSettings } from "../../../lib/settings";
import { requirePerm } from "../../../middleware/auth";
import { capiToken, lastResult, sendTestEvent, TOKEN_KEY } from "../../../services/metaCapi";

/**
 * Admin → Settings → Analytics → Meta Conversions API: the access token (saved encrypted, never shown again — only its last four
 * characters), whether it is set up, Meta's latest answer, and "Send a test event" (marked with the test code, so it shows only in
 * Events Manager → Test events).
 */
export const metaAdmin = new Hono<AppEnv>();

async function status(c: { env: AppEnv["Bindings"] }) {
  const [s, t, last] = await Promise.all([getSettings(c.env, { fresh: true }), capiToken(c.env), lastResult(c.env)]);
  const pixel = s.analytics.meta_pixel.trim();
  return { pixel: pixel || null, token: { source: t.source, hint: t.hint }, ready: !!pixel && !!t.token, test_code: s.analytics.meta_capi_test || null, last };
}

metaAdmin.get("/analytics/meta", requirePerm("settings:read"), async (c) => ok(c, { meta: await status(c) }));

metaAdmin.put("/analytics/meta/token", requirePerm("settings:write"), async (c) => {
  // pasted however it was copied (spaces, a line break, quotes); Meta's tokens are long runs of letters and digits
  const body = await parseBody(c, z.object({ token: z.string().max(4000, "invalid_key").transform(cleanApiKey).pipe(z.string().min(40, "invalid_key").regex(API_KEY_SHAPE, "invalid_key")) }));
  const value = JSON.stringify({ enc: await encryptSecret(body.token, c.env.APP_SECRET), hint: `••••${body.token.slice(-4)}` });
  await run(
    c.env.DB,
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    TOKEN_KEY,
    value,
    nowIso(),
    c.get("staff")!.id,
  );
  await audit(c, { action: "meta_capi.token_saved", entity: "settings", entityId: TOKEN_KEY }); // the token itself is never logged
  return ok(c, { meta: await status(c) });
});

metaAdmin.delete("/analytics/meta/token", requirePerm("settings:write"), async (c) => {
  await run(c.env.DB, "DELETE FROM settings WHERE key = ?", TOKEN_KEY);
  await audit(c, { action: "meta_capi.token_removed", entity: "settings", entityId: TOKEN_KEY });
  return ok(c, { meta: await status(c) });
});

metaAdmin.post("/analytics/meta/test", requirePerm("settings:write"), async (c) => {
  const body = await parseBody(c, z.object({ test_code: z.string().trim().max(40).optional() }));
  const code = body.test_code || (await getSettings(c.env, { fresh: true })).analytics.meta_capi_test;
  // never a test without the code: it would count as a real purchase
  if (!code || !/^[A-Za-z0-9_-]{4,40}$/.test(code)) throw new HttpError(422, "validation", "validation", { test_code: "required" });
  const result = await sendTestEvent(c.env, code, c.env.SITE_URL);
  await audit(c, { action: "meta_capi.test", entity: "settings", entityId: TOKEN_KEY, summary: result.ok ? "ok" : "failed", meta: { detail: result.detail } });
  return ok(c, { result, meta: await status(c) });
});
