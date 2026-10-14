import type { MiddlewareHandler } from "hono";
import type { AppEnv, Ctx, Env } from "../env";
import { HttpError } from "../lib/http";

export type LimiterName = "RL_AUTH" | "RL_CHECKOUT" | "RL_CHAT" | "RL_FORM" | "RL_API";

/** Fallback limits (per 60 s window) used only when the Rate Limiting binding is not configured. */
const FALLBACK: Record<LimiterName, number> = { RL_AUTH: 10, RL_CHECKOUT: 15, RL_CHAT: 12, RL_FORM: 8, RL_API: 120 };

/** True when the caller is within limits. Uses the native Rate Limiting binding; falls back to a KV counter. */
export async function checkRateLimit(env: Env, name: LimiterName, key: string): Promise<boolean> {
  const limiter = env[name];
  if (limiter) {
    const { success } = await limiter.limit({ key });
    return success;
  }
  // Approximate fixed-window counter (not atomic — a safety net, not the primary control).
  const window = Math.floor(Date.now() / 60_000);
  const kvKey = `rl:${name}:${window}:${key}`;
  const count = Number((await env.KV.get(kvKey)) ?? 0);
  if (count >= FALLBACK[name]) return false;
  await env.KV.put(kvKey, String(count + 1), { expirationTtl: 90 });
  return true;
}

/** Rate-limit by client IP (+ optional extra discriminator such as the target e-mail address). */
export function rateLimit(name: LimiterName, extra?: (c: Ctx) => string | undefined): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const suffix = extra?.(c);
    const key = `${name}:${c.get("ip")}${suffix ? `:${suffix}` : ""}`;
    if (!(await checkRateLimit(c.env, name, key))) {
      c.header("Retry-After", "60");
      throw new HttpError(429, "rate_limited");
    }
    await next();
  };
}
