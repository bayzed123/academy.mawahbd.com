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
    const nested = o.result as Record<string, unknown> | undefined;
    if (nested && typeof nested.response === "string") return nested.response;
  }
  throw new AiError("bad_response");
}

export const workersAi: AiProvider = {
  id: "workers_ai",
  label: "Cloudflare Workers AI",
  ready: (env) => !!env.AI,
  async complete(env, settings, messages) {
    if (!env.AI) throw new AiError("not_configured", "AI binding missing");
    try {
      const out = await env.AI.run(settings.model as never, { messages, max_tokens: settings.max_tokens, temperature: settings.temperature } as never);
      const text = extractText(out).trim();
      if (!text) throw new AiError("bad_response", "empty");
      return text;
    } catch (err) {
      if (err instanceof AiError) throw err;
      throw new AiError("provider_error", err instanceof Error ? err.message.slice(0, 200) : "workers_ai");
    }
  },
};
