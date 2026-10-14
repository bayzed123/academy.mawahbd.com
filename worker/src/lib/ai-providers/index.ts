import type { Env } from "../../env";
import { decryptSecret } from "../crypto";
import { first } from "../db";
import { gemini } from "./gemini";
import { PROVIDER_IDS, type AiProvider, type ProviderId } from "./types";
import { workersAi } from "./workers-ai";

export * from "./types";

const REGISTRY: Record<ProviderId, AiProvider> = { workers_ai: workersAi, gemini };

export const getProvider = (id: string): AiProvider | null => (PROVIDER_IDS as readonly string[]).includes(id) ? REGISTRY[id as ProviderId] : null;

export interface ProviderRow {
  provider: ProviderId;
  enabled: number;
  is_active: number;
  model: string;
  temperature: number;
  max_tokens: number;
  key_hint: string | null;
  key_enc: string | null;
  last_test_at: string | null;
  last_test_ok: number | null;
  last_test_detail: string | null;
}

export const getProviderRow = (env: Env, id: string) => first<ProviderRow>(env.DB, "SELECT * FROM ai_provider_configs WHERE provider = ?", id);

/** Where a provider's key comes from: the admin-saved (encrypted) one wins, then the Wrangler secret. */
export async function resolveApiKey(env: Env, row: Pick<ProviderRow, "provider" | "key_enc">): Promise<{ key: string | null; source: "admin" | "secret" | "binding" | "none" }> {
  if (row.provider === "workers_ai") return { key: null, source: env.AI ? "binding" : "none" };
  if (row.key_enc) {
    const plain = await decryptSecret(row.key_enc, [env.APP_SECRET, env.APP_SECRET_PREVIOUS].filter((s): s is string => !!s));
    if (plain) return { key: plain, source: "admin" };
  }
  if (env.GEMINI_API_KEY) return { key: env.GEMINI_API_KEY, source: "secret" };
  return { key: null, source: "none" };
}

export const maskKey = (key: string) => `••••${key.slice(-4)}`;
