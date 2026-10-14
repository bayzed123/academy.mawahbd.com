import type { Env } from "../../env";

export const PROVIDER_IDS = ["workers_ai", "gemini"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderSettings {
  model: string;
  temperature: number;
  max_tokens: number;
}

export class AiError extends Error {
  constructor(
    public code: "not_configured" | "provider_error" | "bad_response" | "timeout" | "blocked",
    detail = "",
  ) {
    super(detail || code);
  }
}

/**
 * One adapter per AI vendor behind a single interface, so the chatbot (and the admin "switch provider" control)
 * never needs to know which one is active. `apiKey` is resolved by the caller from the encrypted admin setting or
 * the Wrangler secret and is never logged.
 */
export interface AiProvider {
  id: ProviderId;
  label: string;
  /** true when the provider can run at all (a binding exists, or a key was supplied) */
  ready(env: Env, apiKey: string | null): boolean;
  complete(env: Env, settings: ProviderSettings, messages: ChatMessage[], apiKey: string | null): Promise<string>;
}

export const REQUEST_TIMEOUT_MS = 25_000;
