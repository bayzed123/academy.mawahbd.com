import { HttpError } from "./http";
import type { Ctx } from "../env";

/**
 * A button that asks another company something (a check, a test message) is limited per person per hour: a few presses are normal, a hundred is a
 * mistake or an attack. Counts this press, and refuses (429) once `max` have been made.
 */
export async function underHourlyCap(c: Ctx, name: string, max: number): Promise<void> {
  const used = `${name}:${c.get("staff")!.id}:${Math.floor(Date.now() / 3_600_000)}`;
  const count = Number((await c.env.KV.get(used)) ?? 0);
  if (count >= max) throw new HttpError(429, "rate_limited");
  await c.env.KV.put(used, String(count + 1), { expirationTtl: 3700 });
}
