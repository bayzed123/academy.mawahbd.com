import { AiError, REQUEST_TIMEOUT_MS, type AiProvider, type ChatMessage } from "./types";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/** The key travels in a header (never in the URL) so it cannot end up in any logs. */
export const gemini: AiProvider = {
  id: "gemini",
  label: "Google Gemini",
  ready: (_env, apiKey) => !!apiKey,
  async complete(_env, settings, messages: ChatMessage[], apiKey) {
    if (!apiKey) throw new AiError("not_configured", "Gemini API key missing");
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const model = encodeURIComponent(settings.model.replace(/^models\//, ""));
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          // thinking models spend part of the budget reasoning: leave head-room so the visible answer is not cut short
          generationConfig: { temperature: settings.temperature, maxOutputTokens: settings.max_tokens + 800 },
        }),
      });
    } catch (err) {
      throw new AiError(err instanceof DOMException && err.name === "TimeoutError" ? "timeout" : "provider_error", "network");
    }
    const data = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) throw new AiError("provider_error", `gemini_${res.status}${data.error?.message ? `: ${data.error.message.slice(0, 160)}` : ""}`);
    if (data.promptFeedback?.blockReason) throw new AiError("blocked", data.promptFeedback.blockReason);
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) throw new AiError("bad_response", data.candidates?.[0]?.finishReason ?? "empty");
    return text;
  },
};
