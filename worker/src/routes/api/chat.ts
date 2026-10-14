import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { HttpError, ok, parseBody } from "../../lib/http";
import { langSchema } from "../../lib/schemas";
import { getSettings } from "../../lib/settings";
import { loadStudent } from "../../middleware/auth";
import { rateLimit } from "../../middleware/ratelimit";
import { dhakaDayStamp } from "@mawah/shared";
import { answerQuestion } from "../../services/chatbot";

export const chatRoutes = new Hono<AppEnv>();

const chatSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .min(1)
    .max(12),
  lang: langSchema.default("bn"),
  course_id: z.number().int().positive().optional(),
});

// generous for a real conversation, hostile to scripts that would burn the AI quota
const PER_IP_PER_DAY = 80;
const SITE_PER_DAY = 4000;

async function underDailyCaps(c: { env: AppEnv["Bindings"] }, ip: string): Promise<boolean> {
  const day = dhakaDayStamp();
  const ipKey = `chat:ip:${day}:${ip}`;
  const siteKey = `chat:all:${day}`;
  const [mine, all] = await Promise.all([c.env.KV.get(ipKey), c.env.KV.get(siteKey)]);
  if (Number(mine ?? 0) >= PER_IP_PER_DAY || Number(all ?? 0) >= SITE_PER_DAY) return false;
  // approximate counters (KV is eventually consistent) — a cost guard, not a security boundary
  await Promise.all([
    c.env.KV.put(ipKey, String(Number(mine ?? 0) + 1), { expirationTtl: 172_800 }),
    c.env.KV.put(siteKey, String(Number(all ?? 0) + 1), { expirationTtl: 172_800 }),
  ]);
  return true;
}

chatRoutes.post("/", loadStudent, rateLimit("RL_CHAT"), async (c) => {
  const settings = await getSettings(c.env);
  if (!settings.chatbot.enabled) throw new HttpError(503, "chat_disabled");
  const body = await parseBody(c, chatSchema);
  if (!(await underDailyCaps(c, c.get("ip")))) throw new HttpError(429, "rate_limited");
  const out = await answerQuestion(c.env, {
    messages: body.messages,
    lang: body.lang,
    courseId: body.course_id ?? null,
    studentId: c.get("student")?.id ?? null,
  });
  return ok(c, out);
});
