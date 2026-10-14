import { Hono } from "hono";
import { z } from "zod";
import { MANUAL_WINDOW_RANGE_MIN } from "@mawah/shared";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { all } from "../../../lib/db";
import { HttpError, ok, parseBody } from "../../../lib/http";
import { emailSchema, textSchema } from "../../../lib/schemas";
import { getSettings, SETTING_KEYS, setSetting, type SettingKey } from "../../../lib/settings";
import { requirePerm } from "../../../middleware/auth";

/** Every business setting (contacts, payment options, policies, analytics …) is edited here — nothing needs a redeploy. */
export const settings = new Hono<AppEnv>();

const urlOrEmpty = z.union([z.literal(""), z.string().trim().max(300).refine((v) => /^https?:\/\//i.test(v), "invalid_url")]);
const bdNumber = z.string().trim().max(20).regex(/^[0-9+\- ]*$/, "invalid_phone");
const long = (n: number) => z.string().max(n);

const SCHEMAS: Record<SettingKey, z.ZodType> = {
  contact: z.object({
    whatsapp: bdNumber,
    phone: bdNumber,
    email: z.union([z.literal(""), emailSchema]),
    facebook: urlOrEmpty,
    youtube: urlOrEmpty,
    instagram: urlOrEmpty,
  }),
  announcement: z.object({ bn: textSchema(200), en: textSchema(200) }),
  payments: z.object({
    sslcommerz: z.boolean(),
    bkash_direct: z.boolean(),
    manual: z.boolean(),
    manual_numbers: z.object({ bkash: bdNumber, nagad: bdNumber, rocket: bdNumber }),
    manual_note_bn: textSchema(500),
    manual_note_en: textSchema(500),
    manual_window_min: z.number().int().min(MANUAL_WINDOW_RANGE_MIN.min).max(MANUAL_WINDOW_RANGE_MIN.max).optional(),
  }),
  policies: z.object({ refund_bn: long(20000), refund_en: long(20000), privacy_bn: long(20000), privacy_en: long(20000), terms_bn: long(20000), terms_en: long(20000) }),
  about: z.object({ bn: long(20000), en: long(20000) }),
  // these IDs are injected into pages as script parameters, so they are validated strictly
  analytics: z.object({
    ga4: z.union([z.literal(""), z.string().regex(/^G-[A-Z0-9]{4,15}$/, "invalid_id")]),
    clarity: z.union([z.literal(""), z.string().regex(/^[a-z0-9]{6,16}$/, "invalid_id")]),
    meta_pixel: z.union([z.literal(""), z.string().regex(/^\d{5,20}$/, "invalid_id")]),
  }),
  chatbot: z.object({ enabled: z.boolean(), greeting_bn: textSchema(300), greeting_en: textSchema(300), faq_bn: long(6000), faq_en: long(6000) }),
  onboarding: z.object({ dismissed: z.boolean() }),
};

settings.get("/settings", requirePerm("settings:read"), async (c) => {
  const [data, meta] = await Promise.all([
    getSettings(c.env, { fresh: true }),
    all<{ key: string; updated_at: string; updated_by_name: string | null }>(
      c.env.DB,
      "SELECT s.key, s.updated_at, st.name AS updated_by_name FROM settings s LEFT JOIN staff st ON st.id = s.updated_by",
    ),
  ]);
  return ok(c, { settings: data, meta });
});

settings.put("/settings/:key", requirePerm("settings:write"), async (c) => {
  const key = c.req.param("key") as SettingKey;
  if (!(SETTING_KEYS as string[]).includes(key)) throw new HttpError(404, "not_found");
  const value = (await parseBody(c, SCHEMAS[key])) as Record<string, unknown>;
  await setSetting(c.env, key, value, c.get("staff")!.id);
  // the audit entry names what changed, never the content (policies / contact details can be long or personal)
  await audit(c, { action: "settings.updated", entity: "settings", entityId: key, meta: { keys: Object.keys(value) } });
  return ok(c, { settings: await getSettings(c.env, { fresh: true }) });
});
