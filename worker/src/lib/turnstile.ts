import type { Env } from "../env";

/** Cloudflare Turnstile (free, privacy-friendly CAPTCHA). Disabled unless TURNSTILE_SECRET is configured. */
export function turnstileEnabled(env: Env): boolean {
  return !!env.TURNSTILE_SECRET && !!env.TURNSTILE_SITE_KEY;
}

export async function verifyTurnstile(env: Env, token: string | undefined, ip: string): Promise<boolean> {
  if (!turnstileEnabled(env)) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET as string, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
