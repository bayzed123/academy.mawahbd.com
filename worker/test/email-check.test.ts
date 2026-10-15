import { afterEach, describe, expect, it, vi } from "vitest";
import { mailProblem, type MailResult } from "../src/lib/mailer";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * Admin → Settings → E-mail. Receipts, password resets and launch announcements go out through Resend, and from outside there is
 * no way to tell whether that works: a refused message leaves no trace on the page. So the owner can send ONE test message to
 * their own address and read what Resend said. These tests stand in for Resend (nothing here talks to it) and protect what the
 * owner cannot see: only the right people can press the button, the message only ever goes to the signed-in person, every refusal
 * Resend can give turns into the right plain-words problem, the key itself never comes back out, and a failed test shows up in
 * the dashboard's health card until a later one succeeds.
 */

// A made-up key, built here so no key-shaped text sits in the source. It only has to look like one.
const FAKE_KEY = `re${"_"}${"x".repeat(32)}`;
const e = env as { RESEND_API_KEY?: string; MAIL_FROM: string };

/** Pretend Resend is at the other end: the next send gets this answer. Returns the calls Resend would have received. */
function resendSays(status: number, body: unknown) {
  const calls: { url: string; auth: string | null; payload: Record<string, any> }[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.resend.com/")) return real(input as RequestInfo, init);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization"), payload: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}
const withKey = () => {
  e.RESEND_API_KEY = FAKE_KEY;
};
afterEach(async () => {
  e.RESEND_API_KEY = undefined;
  vi.restoreAllMocks();
  await env.KV.delete("mail:last-test"); // the last test's result lives in KV: start every test with none
  await env.KV.delete("mail:domain-refused"); // so does "Resend turned a message away because the domain is not verified"
});

const owner = async () => (await loginStaff("super_admin")).client;

describe("who can use it", () => {
  it("only the owner (Super Admin) can send a test; anyone on the team can look at the status; strangers get nothing", async () => {
    expect((await new Client().post("/api/admin/settings/email/test", { lang: "en" })).status).toBe(401);
    expect((await new Client().get("/api/admin/settings/email")).status).toBe(401);

    for (const role of ["content_manager", "support", "viewer"] as const) {
      const { client } = await loginStaff(role);
      expect((await client.post("/api/admin/settings/email/test", { lang: "en" })).status, role).toBe(403);
      expect((await client.get("/api/admin/settings/email")).status, role).toBe(200);
    }
    expect((await (await owner()).post("/api/admin/settings/email/test", { lang: "en" })).status).toBe(200);
  });

  it("the status says whether a key is set — and never shows it", async () => {
    const admin = await owner();
    const before = await json(await admin.get("/api/admin/settings/email"));
    expect(before).toMatchObject({ configured: false, from: e.MAIL_FROM });
    withKey();
    const raw = await (await admin.get("/api/admin/settings/email")).text();
    expect(JSON.parse(raw)).toMatchObject({ configured: true, provider: "resend" });
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).not.toContain("x".repeat(20));
  });
});

describe("a test message", () => {
  it("in development with no key it goes to the local test inbox, addressed to the signed-in person only", async () => {
    const { client, email } = await loginStaff("super_admin");
    const res = await json(await client.post("/api/admin/settings/email/test", { lang: "en" }));
    expect(res).toMatchObject({ ok: true, sent: true, provider: "dev-outbox", problem: null, to: email });
    const box = await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(email)}`));
    const mail = box.messages.at(-1);
    expect(mail.subject).toContain("Test e-mail");
    expect(mail.to).toBe(email);
    expect(mail.html).toContain("MAWAH Academy");

    const bn = await json(await client.post("/api/admin/settings/email/test", { lang: "bn" }));
    expect(bn.sent).toBe(true);
    const mailBn = (await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(email)}`))).messages.at(-1);
    expect(mailBn.subject).toContain("পরীক্ষামূলক ইমেইল");
  });

  it("with a key, Resend gets exactly one message: from the site's address, to the signed-in person, with the key only in the header", async () => {
    const { client, email } = await loginStaff("super_admin");
    withKey();
    const calls = resendSays(200, { id: "abc" });
    const res = await json(await client.post("/api/admin/settings/email/test", { lang: "en" }));
    expect(res).toMatchObject({ ok: true, sent: true, provider: "resend", problem: null, to: email, from: e.MAIL_FROM });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].auth).toBe(`Bearer ${FAKE_KEY}`);
    expect(calls[0].payload).toMatchObject({ from: e.MAIL_FROM, to: [email] });
    expect(calls[0].payload.subject).toContain("Test e-mail");
    expect(JSON.stringify(res)).not.toContain(FAKE_KEY);
  });

  it("an unknown language is refused, and no message is sent", async () => {
    const admin = await owner();
    withKey();
    const calls = resendSays(200, {});
    expect((await admin.post("/api/admin/settings/email/test", { lang: "fr" })).status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("it is a check, not a way to send mail: six an hour per person, then it asks to wait", async () => {
    const { client } = await loginStaff("super_admin");
    for (let i = 0; i < 6; i++) expect((await client.post("/api/admin/settings/email/test", { lang: "en" })).status, `send ${i + 1}`).toBe(200);
    const seventh = await client.post("/api/admin/settings/email/test", { lang: "en" });
    expect(seventh.status).toBe(429);
    expect((await json(seventh)).error.code).toBe("rate_limited");
  });

  it("the audit trail records that a test was sent and whether it worked — not the message", async () => {
    const { client } = await loginStaff("super_admin");
    withKey();
    resendSays(403, { statusCode: 403, name: "validation_error", message: "The example.com domain is not verified." });
    await client.post("/api/admin/settings/email/test", { lang: "en" });
    const row = await env.DB.prepare("SELECT action, entity, meta FROM activity_log WHERE action = 'email.tested' ORDER BY id DESC LIMIT 1").first<{ action: string; entity: string; meta: string }>();
    expect(row?.entity).toBe("settings");
    expect(JSON.parse(row!.meta)).toMatchObject({ ok: false, problem: "domain_not_verified", provider: "resend" });
    expect(row!.meta).not.toContain("example.com");
  });
});

describe("what the owner is told when it fails", () => {
  const cases: [string, number, Record<string, unknown>, string][] = [
    ["the sending domain is not verified at Resend", 403, { statusCode: 403, name: "validation_error", message: "The mawahacademy.com domain is not verified. Please, add and verify your domain on https://resend.com/domains" }, "domain_not_verified"],
    ["Resend's testing mode (only to your own address, until a domain is verified)", 403, { statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address. To send emails to other recipients, please verify a domain at resend.com/domains" }, "domain_not_verified"],
    ["the key is not valid", 403, { statusCode: 403, name: "invalid_api_key", message: "API key is invalid" }, "key_invalid"],
    ["no key reached Resend", 401, { statusCode: 401, name: "missing_api_key", message: "Missing API key in the authorization header." }, "key_invalid"],
    ["the key may not send", 401, { statusCode: 401, name: "restricted_api_key", message: "This API key is restricted to only send emails" }, "key_restricted"],
    ["the sender address is malformed", 422, { statusCode: 422, name: "invalid_from_address", message: "Invalid `from` field." }, "from_invalid"],
    ["the sending limit is reached", 429, { statusCode: 429, name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." }, "rate_limited"],
    ["Resend is having a bad day", 503, { statusCode: 503, name: "application_error", message: "Something went wrong" }, "provider_error"],
    ["something else", 400, { statusCode: 400, name: "validation_error", message: "The `to` field must be a valid email." }, "other"],
  ];
  for (const [name, status, body, problem] of cases) {
    it(`${name} → ${problem}`, async () => {
      const { client } = await loginStaff("super_admin");
      withKey();
      resendSays(status, body);
      const res = await json(await client.post("/api/admin/settings/email/test", { lang: "en" }));
      // the request itself worked (200): the answer is in the body, so the screen can explain it
      expect(res).toMatchObject({ ok: true, sent: false, provider: "resend", problem, status });
      expect(res.detail).toBe(body.message);
    });
  }

  it("Resend's own words are shown, but anything key-shaped in them is not", async () => {
    const { client } = await loginStaff("super_admin");
    withKey();
    resendSays(401, { statusCode: 401, name: "invalid_api_key", message: `API key ${FAKE_KEY} is invalid` });
    const res = await json(await client.post("/api/admin/settings/email/test", { lang: "en" }));
    expect(res.problem).toBe("key_invalid");
    expect(res.detail).toBe("API key re_… is invalid");
    expect(JSON.stringify(res)).not.toContain(FAKE_KEY);
  });

  it("when Resend cannot be reached at all, that is what it says", async () => {
    const { client } = await loginStaff("super_admin");
    withKey();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));
    const res = await json(await client.post("/api/admin/settings/email/test", { lang: "en" }));
    expect(res).toMatchObject({ sent: false, provider: "resend", problem: "network", status: null });
  });

  it("with no key on a live site, it says the key is missing", async () => {
    const before = env.ENVIRONMENT;
    (env as { ENVIRONMENT: string }).ENVIRONMENT = "production"; // a live site has no local test inbox
    try {
      const { client } = await loginStaff("super_admin"); // signed in as on the live site (its cookies differ)
      const res = await json(await client.post("/api/admin/settings/email/test", { lang: "en" }));
      expect(res).toMatchObject({ sent: false, provider: "none", problem: "key_missing" });
    } finally {
      (env as { ENVIRONMENT: string }).ENVIRONMENT = before;
    }
  });
});

describe("the last test and the dashboard", () => {
  it("is remembered, and a failed test turns the e-mail health card to a warning until a later one succeeds", async () => {
    const { client } = await loginStaff("super_admin");
    withKey();
    const health = async () => (await json(await client.get("/api/admin/health"))).checks.find((h: any) => h.key === "email");
    expect(await health()).toMatchObject({ status: "ok", issues: [] }); // a key, never tested: nothing to complain about

    resendSays(403, { statusCode: 403, name: "validation_error", message: "The mawahacademy.com domain is not verified." });
    await client.post("/api/admin/settings/email/test", { lang: "en" });
    expect(await health()).toMatchObject({ status: "warn", issues: ["email_test_failed"] });
    const status = await json(await client.get("/api/admin/settings/email"));
    expect(status.last).toMatchObject({ sent: false, problem: "domain_not_verified", provider: "resend" });
    expect(typeof status.last.by).toBe("string");

    vi.restoreAllMocks();
    resendSays(200, { id: "ok" });
    await client.post("/api/admin/settings/email/test", { lang: "en" });
    expect(await health()).toMatchObject({ status: "ok", issues: [] });
    expect((await json(await client.get("/api/admin/settings/email"))).last).toMatchObject({ sent: true, problem: null });
  });
});

describe("mailProblem (the table the screen relies on)", () => {
  const r = (over: Partial<MailResult>): MailResult => ({ ok: false, provider: "resend", ...over });
  it("maps every kind of refusal, and nothing for a message that was sent", () => {
    expect(mailProblem({ ok: true, provider: "resend" })).toBeNull();
    expect(mailProblem({ ok: true, provider: "dev-outbox" })).toBeNull();
    expect(mailProblem(r({ provider: "none" }))).toBe("key_missing");
    expect(mailProblem(r({ error: "connection reset" }))).toBe("network");
    expect(mailProblem(r({ status: 403, code: "validation_error", detail: "The x.com domain is not verified" }))).toBe("domain_not_verified");
    expect(mailProblem(r({ status: 401, code: "restricted_api_key" }))).toBe("key_restricted");
    expect(mailProblem(r({ status: 401, code: "missing_api_key" }))).toBe("key_invalid");
    expect(mailProblem(r({ status: 403, code: "invalid_api_key" }))).toBe("key_invalid");
    expect(mailProblem(r({ status: 422, code: "invalid_from_address" }))).toBe("from_invalid");
    expect(mailProblem(r({ status: 429 }))).toBe("rate_limited");
    expect(mailProblem(r({ status: 500 }))).toBe("provider_error");
    expect(mailProblem(r({ status: 418 }))).toBe("other");
  });
});
