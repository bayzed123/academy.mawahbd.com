import { AiError, type AiProvider } from "./types";

/** Text out of the several shapes Workers AI models answer with. */
export function extractText(out: unknown): string {
  if (typeof out === "string") return out;
  if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    if (typeof o.response === "string") return o.response;
    const choices = o.choices as { message?: { content?: unknown }; text?: unknown }[] | undefined;
    const content = choices?.[0]?.message?.content ?? choices?.[0]?.text;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : ((p as { text?: string }).text ?? ""))).join("");
    // a reasoning model that spent its whole budget thinking answers with no content at all
    if (choices?.[0] && (content === null || content === undefined)) return "";
    const nested = o.result as Record<string, unknown> | undefined;
    if (nested && typeof nested.response === "string") return nested.response;
  }
  throw new AiError("bad_response");
}

/**
 * Models that think before they answer (Gemma 4, Qwen 3, QwQ, GLM, DeepSeek R1, Kimi). Left on, the thinking uses up the answer's budget and
 * the reply comes back empty ("bad_response: empty"); a support answer needs no long reasoning, so it is switched off for them.
 */
export const THINKING_MODEL = /gemma-4|qwen3|qwq|glm-|deepseek-r1|kimi/i;

/** What the model is sent: the conversation, the limits, and — for a thinking model — thinking switched off (with room to spare). */
export function workersAiInput(model: string, messages: unknown[], maxTokens: number, temperature: number): Record<string, unknown> {
  const thinks = THINKING_MODEL.test(model);
  return {
    messages,
    max_tokens: thinks ? maxTokens + 400 : maxTokens,
    temperature,
    ...(thinks ? { chat_template_kwargs: { enable_thinking: false, thinking: false } } : {}),
  };
}

export const workersAi: AiProvider = {
  id: "workers_ai",
  label: "Cloudflare Workers AI",
  ready: (env) => !!env.AI,
  async complete(env, settings, messages) {
    if (!env.AI) throw new AiError("not_configured", "AI binding missing");
    try {
      const out = await env.AI.run(settings.model as never, workersAiInput(settings.model, messages, settings.max_tokens, settings.temperature) as never);
      const text = extractText(out).trim();
      if (!text) throw new AiError("bad_response", THINKING_MODEL.test(settings.model) ? "empty: the model used its whole budget thinking — raise Max answer length" : "empty");
      return text;
    } catch (err) {
      if (err instanceof AiError) throw err;
      throw new AiError("provider_error", err instanceof Error ? err.message.slice(0, 200) : "workers_ai");
    }
  },
};
