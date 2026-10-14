import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../../env";
import { getProvider, getProviderRow, maskKey, PROVIDER_IDS, resolveApiKey, type ProviderRow } from "../../../lib/ai-providers";
import { audit } from "../../../lib/audit";
import { encryptSecret } from "../../../lib/crypto";
import { all, first, nowIso, run } from "../../../lib/db";
import { HttpError, notFound, ok, parseBody } from "../../../lib/http";
import { getSettings } from "../../../lib/settings";
import { requirePerm } from "../../../middleware/auth";
import { runProviderTest } from "../../../services/chatbot";
import { dhakaDayStamp } from "@mawah/shared";

/**
 * Admin -> AI Chatbot. Pick the provider and model, save/replace an API key, run a live connection test.
 * A saved key is encrypted at rest and never returned: the screen only ever sees a masked hint (••••abcd).
 */
export const chatbot = new Hono<AppEnv>();

async function present(c: { env: AppEnv["Bindings"] }, row: ProviderRow) {
  const provider = getProvider(row.provider)!;
  const { key, source } = await resolveApiKey(c.env, row);
  return {
    provider: row.provider,
    label: provider.label,
    enabled: !!row.enabled,
    is_active: !!row.is_active,
    model: row.model,
    temperature: row.temperature,
    max_tokens: row.max_tokens,
    configured: provider.ready(c.env, key),
    key_source: source,
    key_hint: source === "admin" ? row.key_hint : source === "secret" && key ? maskKey(key) : null,
    needs_key: row.provider !== "workers_ai",
    last_test_at: row.last_test_at,
    last_test_ok: row.last_test_ok === null ? null : !!row.last_test_ok,
    last_test_detail: row.last_test_detail,
  };
}

chatbot.get("/chatbot", requirePerm("chatbot:read"), async (c) => {
  const [rows, settings, open, usage] = await Promise.all([
    all<ProviderRow>(c.env.DB, "SELECT * FROM ai_provider_configs ORDER BY provider"),
    getSettings(c.env, { fresh: true }),
    first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM chat_escalations WHERE status = 'open'"),
    c.env.KV.get(`chat:all:${dhakaDayStamp()}`),
  ]);
  return ok(c, {
    providers: await Promise.all(rows.map((r) => present(c, r))),
    chat_enabled: settings.chatbot.enabled,
    open_escalations: open?.n ?? 0,
    messages_today: Number(usage ?? 0),
  });
});

const providerSchema = z.object({
  enabled: z.boolean(),
  model: z.string().trim().min(2).max(120).regex(/^[\w@./:+-]+$/, "invalid_model"),
  temperature: z.number().min(0).max(1.5),
  max_tokens: z.number().int().min(50).max(2000),
});

async function requireRow(id: string): Promise<never | void> {
  if (!(PROVIDER_IDS as readonly string[]).includes(id)) throw notFound();
}

chatbot.put("/chatbot/providers/:provider", requirePerm("chatbot:write"), async (c) => {
  const id = c.req.param("provider");
  await requireRow(id);
  const body = await parseBody(c, providerSchema.partial());
  const sets: string[] = [];
  const params: (string | number)[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
  }
  if (body.enabled === false) await run(c.env.DB, "UPDATE ai_provider_configs SET is_active = 0 WHERE provider = ?", id);
  if (sets.length) await run(c.env.DB, `UPDATE ai_provider_configs SET ${sets.join(", ")}, updated_at = ?, updated_by = ? WHERE provider = ?`, ...params, nowIso(), c.get("staff")!.id, id);
  await audit(c, { action: "chatbot.provider_updated", entity: "chatbot", entityId: id, meta: { fields: Object.keys(body) } });
  return ok(c, { provider: await present(c, (await getProviderRow(c.env, id))!) });
});

chatbot.put("/chatbot/providers/:provider/key", requirePerm("chatbot:write"), async (c) => {
  const id = c.req.param("provider");
  await requireRow(id);
  if (id === "workers_ai") throw new HttpError(400, "no_key_needed");
  const body = await parseBody(c, z.object({ api_key: z.string().trim().min(20, "invalid_key").max(300, "invalid_key").regex(/^[\w-]+$/, "invalid_key") }));
  await run(
    c.env.DB,
    "UPDATE ai_provider_configs SET key_enc = ?, key_hint = ?, last_test_at = NULL, last_test_ok = NULL, last_test_detail = NULL, updated_at = ?, updated_by = ? WHERE provider = ?",
    await encryptSecret(body.api_key, c.env.APP_SECRET),
    maskKey(body.api_key),
    nowIso(),
    c.get("staff")!.id,
    id,
  );
  await audit(c, { action: "chatbot.key_saved", entity: "chatbot", entityId: id }); // the key itself is never logged
  return ok(c, { provider: await present(c, (await getProviderRow(c.env, id))!) });
});

chatbot.delete("/chatbot/providers/:provider/key", requirePerm("chatbot:write"), async (c) => {
  const id = c.req.param("provider");
  await requireRow(id);
  await run(c.env.DB, "UPDATE ai_provider_configs SET key_enc = NULL, key_hint = NULL, last_test_at = NULL, last_test_ok = NULL, last_test_detail = NULL, updated_at = ? WHERE provider = ?", nowIso(), id);
  await audit(c, { action: "chatbot.key_removed", entity: "chatbot", entityId: id });
  return ok(c, { provider: await present(c, (await getProviderRow(c.env, id))!) });
});

chatbot.post("/chatbot/providers/:provider/test", requirePerm("chatbot:write"), async (c) => {
  const id = c.req.param("provider");
  await requireRow(id);
  const row = (await getProviderRow(c.env, id))!;
  const result = await runProviderTest(c.env, row);
  await audit(c, { action: "chatbot.tested", entity: "chatbot", entityId: id, summary: result.ok ? "ok" : result.detail });
  return ok(c, { result, provider: await present(c, (await getProviderRow(c.env, id))!) });
});

/** Make one provider the live one. Refuses a provider that cannot run, so a click can never silence the chatbot by accident. */
chatbot.post("/chatbot/providers/:provider/activate", requirePerm("chatbot:write"), async (c) => {
  const id = c.req.param("provider");
  await requireRow(id);
  const row = (await getProviderRow(c.env, id))!;
  const { key } = await resolveApiKey(c.env, row);
  if (!getProvider(id)!.ready(c.env, key)) throw new HttpError(409, "not_configured");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE ai_provider_configs SET is_active = 0 WHERE is_active = 1"),
    c.env.DB.prepare("UPDATE ai_provider_configs SET is_active = 1, enabled = 1, updated_at = ?, updated_by = ? WHERE provider = ?").bind(nowIso(), c.get("staff")!.id, id),
  ]);
  await audit(c, { action: "chatbot.activated", entity: "chatbot", entityId: id });
  return ok(c);
});
