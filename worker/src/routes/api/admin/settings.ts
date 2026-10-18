import { Hono } from "hono";
import { z } from "zod";
import { MANUAL_WINDOW_RANGE_MIN, NOTIFY_KINDS, readSslLogo, SSL_LOGO_MAX } from "@mawah/shared";
import { isDev, type AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { underHourlyCap } from "../../../lib/cap";
import { all } from "../../../lib/db";
import { HttpError, ok, parseBody } from "../../../lib/http";
import { MAIL_DOMAIN_REFUSED_KEY, MAIL_LAST_TEST_KEY, mailProblem, sendMail, testMail, type MailLastTest } from "../../../lib/mailer";
import { emailSchema, langSchema, requiredPhoneSchema, textSchema } from "../../../lib/schemas";
import { SMS_LAST_KEY, sendSms, smsBalance, smsConfigured, smsEndpoints, type SmsLast } from "../../../lib/sms";
import { testSms } from "../../../lib/smsText";
import { getSettings, SETTING_KEYS, setSetting, type SettingKey } from "../../../lib/settings";
import { requirePerm } from "../../../middleware/auth";
import { rateLimit } from "../../../middleware/ratelimit";
import { notices, notificationRecipients, sendNotice } from "../../../services/notify";
import { SSL_LAST_KEY, sslCheck, sslConfigured, sslHost, sslMode, sslReturnUrls, type SslLast } from "../../../services/payments/sslcommerz";

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
    // SSLCommerz's own logo, as SSLCommerz gave it (a link or its HTML): kept as pasted, but only when it holds an https picture on sslcommerz.com
    ssl_logo: z
      .string()
      .trim()
      .max(SSL_LOGO_MAX, "too_long")
      .refine((v) => v === "" || readSslLogo(v) !== null, "ssl_logo_invalid")
      .default(""),
  }),
  policies: z.object({
    refund_bn: long(20000),
    refund_en: long(20000),
    privacy_bn: long(20000),
    privacy_en: long(20000),
    terms_bn: long(20000),
    terms_en: long(20000),
    guide_bn: long(20000),
    guide_en: long(20000),
    order_bn: long(20000),
    order_en: long(20000),
    hotline_bn: long(20000),
    hotline_en: long(20000),
  }),
  about: z.object({ bn: long(20000), en: long(20000) }),
  // these IDs are injected into pages as script parameters, so they are validated strictly
  analytics: z.object({
    ga4: z.union([z.literal(""), z.string().regex(/^G-[A-Z0-9]{4,15}$/, "invalid_id")]),
    clarity: z.union([z.literal(""), z.string().regex(/^[a-z0-9]{6,16}$/, "invalid_id")]),
    meta_pixel: z.union([z.literal(""), z.string().regex(/^\d{5,20}$/, "invalid_id")]),
  }),
  chatbot: z.object({ enabled: z.boolean(), greeting_bn: textSchema(300), greeting_en: textSchema(300), faq_bn: long(6000), faq_en: long(6000) }),
  shop: z.object({ enabled: z.boolean(), url: urlOrEmpty, label_bn: textSchema(24), label_en: textSchema(24) }),
  notifications: z.object({
    emails: z.array(emailSchema).max(5, "too_long").transform((a) => [...new Set(a)]),
    off: z.array(z.enum(NOTIFY_KINDS)).max(NOTIFY_KINDS.length).transform((a) => [...new Set(a)]),
  }),
  // the sender ID is the short name the SMS company approved for the shop (letters and digits); empty = the company's own default
  sms: z.object({ enabled: z.boolean(), sender_id: z.string().trim().max(15, "too_long").regex(/^[A-Za-z0-9 ._-]*$/, "invalid_id"), with_email: z.boolean() }),
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

/* ------------------------------------------------------------------------------------------------
 * E-mail. Receipts, password resets and launch announcements go out through Resend, and from the outside there is no way to tell
 * whether it works: a message that is refused leaves no trace on the page. So the owner can send ONE test message to their own
 * address and read, in plain words, what Resend said. The key itself is never shown or returned — only whether one is set.
 * ---------------------------------------------------------------------------------------------- */

/** The sending address's domain — the one Resend must have verified. */
const senderDomain = (from: string) => from.match(/@([^>\s]+)>?\s*$/)?.[1]?.toLowerCase() ?? "";

settings.get("/settings/email", requirePerm("settings:read"), async (c) => {
  const [last, refusedAt, s] = await Promise.all([c.env.KV.get<MailLastTest>(MAIL_LAST_TEST_KEY, "json"), c.env.KV.get(MAIL_DOMAIN_REFUSED_KEY), getSettings(c.env, { fresh: true })]);
  const who = notificationRecipients(c.env, s);
  return ok(c, {
    configured: !!c.env.RESEND_API_KEY,
    provider: c.env.RESEND_API_KEY ? "resend" : isDev(c.env) ? "dev-outbox" : "none",
    from: c.env.MAIL_FROM,
    domain: senderDomain(c.env.MAIL_FROM),
    reply_to: c.env.MAIL_REPLY_TO ?? "",
    // the last time Resend turned a message away because the sending domain is not verified (cleared by a test that goes through the real domain)
    domain_refused_at: refusedAt,
    notify: { to: who.to, custom: who.custom, default_to: (c.env.NOTIFY_EMAIL ?? "").trim().toLowerCase(), off: s.notifications.off },
    last,
  });
});

const emailTestSchema = z.object({ lang: z.enum(["bn", "en"]).default("en") });

settings.post("/settings/email/test", requirePerm("settings:write"), rateLimit("RL_FORM"), async (c) => {
  const staff = c.get("staff")!;
  const { lang } = await parseBody(c, emailTestSchema);
  // a check, not a way to send mail: a few per hour per person, and only ever to the signed-in person's own address
  const used = `mailtest:${staff.id}:${Math.floor(Date.now() / 3_600_000)}`;
  const count = Number((await c.env.KV.get(used)) ?? 0);
  if (count >= 6) throw new HttpError(429, "rate_limited");
  await c.env.KV.put(used, String(count + 1), { expirationTtl: 3700 });

  const at = new Date().toISOString();
  const when = new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(new Date(at));
  const sent = await sendMail(c.env, { to: staff.email, ...testMail(lang, { name: staff.name, when }), owner: true });
  // a message that only got through Resend's test sender proves the key works, not that students' e-mails will arrive
  const viaSandbox = sent.ok && !!sent.viaSandbox;
  const problem = viaSandbox ? "domain_not_verified" : mailProblem(sent);
  const last: MailLastTest = { at, sent: sent.ok, provider: sent.provider, problem, by: staff.name, ...(viaSandbox ? { viaSandbox: true } : {}) };
  await c.env.KV.put(MAIL_LAST_TEST_KEY, JSON.stringify(last));
  if (sent.ok && !viaSandbox) await c.env.KV.delete(MAIL_DOMAIN_REFUSED_KEY); // it went through the real domain: the warning is over
  await audit(c, { action: "email.tested", entity: "settings", entityId: "email", meta: { ok: sent.ok, problem, provider: sent.provider } });
  return ok(c, { ...last, to: staff.email, from: c.env.MAIL_FROM, domain: senderDomain(c.env.MAIL_FROM), status: sent.status ?? null, detail: sent.detail ?? null });
});

/** "Send a test notification": one sample note to every address that gets notes, with what Resend said for each. */
settings.post("/settings/email/notify-test", requirePerm("settings:write"), rateLimit("RL_FORM"), async (c) => {
  const staff = c.get("staff")!;
  const used = `notifytest:${staff.id}:${Math.floor(Date.now() / 3_600_000)}`;
  const count = Number((await c.env.KV.get(used)) ?? 0);
  if (count >= 6) throw new HttpError(429, "rate_limited");
  await c.env.KV.put(used, String(count + 1), { expirationTtl: 3700 });
  const sent = await sendNotice(c.env, await getSettings(c.env, { fresh: true }), notices.test());
  const results = sent.map((r) => ({ to: r.to, sent: r.result.ok, via_sandbox: !!r.result.viaSandbox, problem: mailProblem(r.result), status: r.result.status ?? null, detail: r.result.detail ?? null }));
  await audit(c, { action: "email.notify_tested", entity: "settings", entityId: "email", meta: { to: results.length, sent: results.filter((r) => r.sent).length } });
  return ok(c, { results, domain: senderDomain(c.env.MAIL_FROM), from: c.env.MAIL_FROM });
});

/* ------------------------------------------------------------------------------------------------
 * SMS. A buyer who gave no e-mail is told by text message, and everyone else can be too. From the outside there is no way to tell whether the
 * SMS company accepts the key, so the owner can ask for the credit left and send ONE test message to a number they type, and read — in plain
 * words — what the company said. The key itself is never shown or returned: only whether one is set, and the host it goes to.
 * ---------------------------------------------------------------------------------------------- */

settings.get("/settings/sms", requirePerm("settings:read"), async (c) => {
  const [last, s] = await Promise.all([c.env.KV.get<SmsLast>(SMS_LAST_KEY, "json"), getSettings(c.env, { fresh: true })]);
  const configured = smsConfigured(c.env);
  return ok(c, {
    configured,
    key_set: !!c.env.SMS_API_KEY?.trim(),
    url_set: !!c.env.SMS_API_URL?.trim(),
    // where messages go, as a host name only (the key is part of some addresses, and never leaves the Worker)
    host: smsEndpoints(c.env.SMS_API_URL)?.origin.replace(/^https:\/\//, "") ?? null,
    provider: configured ? "sms" : isDev(c.env) ? "dev-outbox" : "none",
    enabled: s.sms.enabled,
    sender_id: s.sms.sender_id,
    with_email: s.sms.with_email,
    last,
  });
});

// Both checks cost the shop a request (and a test message costs credit): a few per hour per person (lib/cap.ts)

/* ------------------------------------------------------------------------------------------------
 * Online payment (SSLCommerz). When the gateway turns a student away, all the student can see is "could not start"; the reason — wrong keys,
 * another website registered for the store, a firewall — is in the gateway's own sentence. So the owner can ask the gateway for a session
 * (nothing is charged) and read, in plain words with the steps, what it said. The keys never leave the Worker: only whether they are set.
 * ---------------------------------------------------------------------------------------------- */

settings.get("/settings/payments/ssl", requirePerm("settings:read"), async (c) => {
  const [last, s] = await Promise.all([c.env.KV.get<SslLast>(SSL_LAST_KEY, "json"), getSettings(c.env, { fresh: true })]);
  return ok(c, {
    enabled: s.payments.sslcommerz,
    configured: sslConfigured(c.env),
    store_id_set: !!c.env.SSLCOMMERZ_STORE_ID?.trim(),
    password_set: !!c.env.SSLCOMMERZ_STORE_PASSWORD?.trim(),
    // live = real money, on the gateway's real address; test = the gateway's sandbox (keys of one kind do not open the other)
    mode: sslMode(c.env),
    host: sslHost(c.env),
    // the website address and the return addresses the gateway is given — the store has to be registered for them
    site: new URL(c.env.SITE_URL).host,
    return_urls: sslReturnUrls(c.env),
    last,
  });
});

settings.post("/settings/payments/ssl/check", requirePerm("settings:write"), rateLimit("RL_FORM"), async (c) => {
  await underHourlyCap(c, "sslcheck", 20);
  const r = await sslCheck(c.env);
  // the audit trail records that a check happened and how it ended — the gateway's words are in the answer, not in the trail
  await audit(c, { action: "payments.ssl_checked", entity: "settings", entityId: "payments", meta: { connected: r.connected, problem: r.connected ? null : r.problem, mode: r.mode } });
  // never `{ ok: false }`: the admin client reads that as a failed request, and the plain-words explanation would never be shown
  return ok(c, { ...r });
});

settings.post("/settings/sms/balance", requirePerm("settings:write"), rateLimit("RL_FORM"), async (c) => {
  await underHourlyCap(c, "smsbalance", 20);
  const r = await smsBalance(c.env);
  await audit(c, { action: "sms.balance_checked", entity: "settings", entityId: "sms", meta: { ok: r.ok, problem: r.problem ?? null } });
  // the answer is never `{ ok: false }`: the admin client reads that as a failed request, and the plain-words explanation would never be shown
  const { ok: read, ...rest } = r;
  return ok(c, { read, ...rest });
});

const smsTestSchema = z.object({ to: requiredPhoneSchema, lang: langSchema.default("en") });

settings.post("/settings/sms/test", requirePerm("settings:write"), rateLimit("RL_FORM"), async (c) => {
  const body = await parseBody(c, smsTestSchema);
  await underHourlyCap(c, "smstest", 6);
  const sender = (await getSettings(c.env, { fresh: true })).sms.sender_id;
  const sent = await sendSms(c.env, { to: body.to, text: testSms(body.lang) }, { sender });
  // the audit trail records that a test happened and how it ended — never the number or the company's words
  await audit(c, { action: "sms.tested", entity: "settings", entityId: "sms", meta: { ok: sent.ok, problem: sent.problem ?? null, provider: sent.provider } });
  const { ok: delivered, ...rest } = sent;
  return ok(c, { sent: delivered, ...rest, to: body.to });
});
