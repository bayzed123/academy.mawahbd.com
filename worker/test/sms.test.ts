import { afterEach, describe, expect, it, vi } from "vitest";
import { allowVisitorSms, SMS_LAST_KEY, sendSms, smsBalance, smsEndpoints, smsProblem } from "../src/lib/sms";
import { getSettings, setSetting } from "../src/lib/settings";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * Text messages. The shop sends them through a Bangladeshi SMS company, and from outside there is no way to tell whether the company accepts
 * the key: a refused message leaves no trace on any page. So the owner can ask for the credit left and send one test message, and read —
 * in plain words — what the company said. These tests stand in for the company (nothing here talks to it) and protect what the owner cannot
 * see: the key never comes back out (not in an answer, a log, the last result or the audit trail), every kind of refusal turns into the
 * right problem, a message that cannot be sent never throws, visitors cannot run up the bill, and only the owner can press the buttons.
 */

// A made-up key, built here so no key-shaped text sits in the source. It only has to look like one.
const FAKE_KEY = `sms${"-"}${"k".repeat(24)}`;
const HOST = "https://sms.example.test";
const e = env as { SMS_API_KEY?: string; SMS_API_URL?: string };

interface Call {
  url: string;
  method: string;
  body: Record<string, any> | null;
}

/** Pretend the SMS company is at the other end: every request to its host gets `reply(call)`. Returns the calls it received. */
function companySays(reply: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${HOST}/`)) return real(input as RequestInfo, init);
    const raw = init?.body ? String(init.body) : "";
    const call: Call = { url, method: init?.method ?? "GET", body: raw ? JSON.parse(raw) : null };
    calls.push(call);
    return reply(call, calls.length);
  });
  return calls;
}
const says = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const withSecrets = (url = HOST) => {
  e.SMS_API_KEY = FAKE_KEY;
  e.SMS_API_URL = url;
};

afterEach(async () => {
  e.SMS_API_KEY = undefined;
  e.SMS_API_URL = undefined;
  vi.restoreAllMocks();
  await env.KV.delete(SMS_LAST_KEY); // the last result lives in KV: start every test with none
  await setSetting(env, "sms", { enabled: true, sender_id: "", with_email: true }, null);
});

const owner = async () => (await loginStaff("super_admin")).client;
const outboxTo = async (to: string) => (await json(await new Client().get(`/api/dev/outbox?to=${encodeURIComponent(to)}`))).messages as { text: string; sms?: boolean }[];

describe("where the company is", () => {
  it("accepts its website address, its sending address, or one of its example links — and nothing that is not https", () => {
    expect(smsEndpoints("https://msg.example.test")).toEqual({ origin: "https://msg.example.test", send: "https://msg.example.test/smsapi" });
    expect(smsEndpoints("  https://msg.example.test/  ")).toEqual({ origin: "https://msg.example.test", send: "https://msg.example.test/smsapi" });
    expect(smsEndpoints("https://msg.example.test/smsapi")).toEqual({ origin: "https://msg.example.test", send: "https://msg.example.test/smsapi" });
    expect(smsEndpoints("https://msg.example.test/v2/send/")).toEqual({ origin: "https://msg.example.test", send: "https://msg.example.test/v2/send" });
    // one of the company's example links (which carry a key in them) is only used to find the host
    expect(smsEndpoints("https://msg.example.test/miscapi/ABCDEF/getBalance")).toEqual({ origin: "https://msg.example.test", send: "https://msg.example.test/smsapi" });

    // a bare name (the leading https:// left off) is taken as https
    expect(smsEndpoints("msg.example.test")).toEqual({ origin: "https://msg.example.test", send: "https://msg.example.test/smsapi" });
    expect(smsEndpoints("msg.example.test/smsapi")).toEqual({ origin: "https://msg.example.test", send: "https://msg.example.test/smsapi" });

    // the key travels with every request: never over plain http, never to something that is not a host name
    for (const bad of ["http://msg.example.test", "ftp://msg.example.test", "not a url", "", "   ", "https://localhost", "localhost", undefined]) {
      expect(smsEndpoints(bad), String(bad)).toBeNull();
    }
  });
});

describe("sending a message", () => {
  it("with no secrets set (development), keeps it in the outbox instead of sending it", async () => {
    const r = await sendSms(env, { to: "01711000001", text: "Hello from the shop" });
    expect(r).toMatchObject({ ok: true, provider: "dev-outbox" });
    const box = await outboxTo("01711000001");
    expect(box.at(-1)).toMatchObject({ text: "Hello from the shop", sms: true });
  });

  it("sends one request in the company's JSON format, with the number in 880 form and the sender name when there is one", async () => {
    withSecrets();
    const calls = companySays(() => says(200, { response_code: 202, message: "SMS Submitted Successfully", message_id: "m-1" }));
    const r = await sendSms(env, { to: "01711223344", text: "Your class is open" }, { sender: "MAWAH" });
    expect(r).toMatchObject({ ok: true, provider: "sms", id: "m-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${HOST}/smsapi`);
    expect(calls[0].body).toMatchObject({ api_key: FAKE_KEY, contacts: "8801711223344", msg: "Your class is open", type: "text", senderid: "MAWAH" });
    // nothing was kept in the outbox: it went to the company
    expect((await outboxTo("01711223344")).some((m) => m.text === "Your class is open")).toBe(false);
  });

  it("marks a message with Bangla letters as unicode, and leaves the sender out when none is set", async () => {
    withSecrets();
    const calls = companySays(() => says(200, { response_code: 202 }));
    await sendSms(env, { to: "01711223344", text: "মাওয়াহ একাডেমি: আপনার ক্লাস খোলা হয়েছে" });
    expect(calls[0].body?.type).toBe("unicode");
    expect(calls[0].body).not.toHaveProperty("senderid");
  });

  it("tries again as a plain web address when the company's address does not take JSON (404, 405, 415)", async () => {
    withSecrets();
    const calls = companySays((_, n) => (n === 1 ? says(405, "Method Not Allowed") : says(200, { response_code: 202 })));
    const r = await sendSms(env, { to: "01711223344", text: "Hi" });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    const second = new URL(calls[1].url);
    expect(second.searchParams.get("contacts")).toBe("8801711223344");
    expect(second.searchParams.get("msg")).toBe("Hi");
  });

  it("tries once more as a plain web address when the answer is “a required field is missing” — the company never read the JSON body", async () => {
    withSecrets();
    const calls = companySays((_, n) => (n === 1 ? says(200, { response_code: 1003, error_message: "Required fields missing" }) : says(200, { response_code: 202 })));
    const r = await sendSms(env, { to: "01711223344", text: "Hi" }, { sender: "MAWAH" });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    expect(new URL(calls[1].url).searchParams.get("senderid")).toBe("MAWAH");
  });

  it("turns every kind of refusal into the right problem, in the company's words", async () => {
    const cases: [number, unknown, string][] = [
      [200, { response_code: 1007, error_message: "Insufficient balance" }, "no_balance"],
      [200, { response_code: 1032, error_message: "IP is not whitelisted" }, "ip_blocked"],
      [200, { response_code: 1002, error_message: "Invalid senderId" }, "sender_rejected"],
      [200, { response_code: 1003, error_message: "Required fields missing" }, "sender_rejected"], // the only field the shop may leave out is the sender ID
      [200, { response_code: 1012, error_message: "Masking SMS must be sent in Bengali" }, "masking_bangla"],
      [200, { response_code: 1011, error_message: "Invalid API key" }, "key_rejected"],
      [401, "Unauthorized", "key_rejected"],
      [200, { response_code: 1001, error_message: "Invalid mobile number" }, "number_rejected"],
      [503, "Service Unavailable", "provider_error"],
      [200, { response_code: 9999, error_message: "Something odd" }, "other"],
    ];
    for (const [status, body, problem] of cases) {
      withSecrets();
      companySays(() => says(status, body));
      const r = await sendSms(env, { to: "01711223344", text: "Hi" });
      expect(r.ok, JSON.stringify(body)).toBe(false);
      expect(r.problem, JSON.stringify(body)).toBe(problem);
      expect(r.detail).toBeTruthy();
      vi.restoreAllMocks();
    }
  });

  it("reads the other ways companies say yes or no (success flag, status word, plain text)", async () => {
    withSecrets();
    for (const [body, ok] of [
      [{ success: true }, true],
      [{ success: false, message: "bad" }, false],
      [{ status: "Success" }, true],
      [{ status: "failed" }, false],
      [{ error: 0, message: "queued" }, true],
      [{ error: 1, message: "no" }, false],
      ["SMS Submitted Successfully", true],
      ["Invalid request", false],
    ] as [unknown, boolean][]) {
      companySays(() => says(200, body));
      expect((await sendSms(env, { to: "01711223344", text: "Hi" })).ok, JSON.stringify(body)).toBe(ok);
      vi.restoreAllMocks();
    }
  });

  it("says so, and does not throw, when the company cannot be reached, or the address is not https, or nothing is set up", async () => {
    withSecrets();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));
    expect(await sendSms(env, { to: "01711223344", text: "Hi" })).toMatchObject({ ok: false, problem: "network" });
    vi.restoreAllMocks();

    withSecrets("http://sms.example.test");
    expect(await sendSms(env, { to: "01711223344", text: "Hi" })).toMatchObject({ ok: false, problem: "url_invalid" });

    // on the real site (not development) with no secrets there is nothing to send with — and nothing is quietly kept instead
    e.SMS_API_KEY = undefined;
    e.SMS_API_URL = undefined;
    const prod = { ENVIRONMENT: "production" } as never;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await sendSms(prod, { to: "01711223344", text: "Hi" })).toMatchObject({ ok: false, provider: "none", problem: "not_configured" });
  });

  it("never lets the key out: not in the result, the last-result note, the logs or the company's echo of it", async () => {
    withSecrets();
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // some companies repeat the request back in their error
    companySays(() => says(200, { response_code: 1011, error_message: `Invalid API key ${FAKE_KEY} for this account` }));
    const r = await sendSms(env, { to: "01711223344", text: "Hi" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(log.mock.calls)).not.toContain(FAKE_KEY);
    const last = await env.KV.get(SMS_LAST_KEY);
    expect(last).toBeTruthy();
    expect(last).not.toContain(FAKE_KEY);
    expect(JSON.parse(last!)).toMatchObject({ ok: false, problem: "key_rejected" });

    // …and a network error that names the address with the key in it
    vi.restoreAllMocks();
    withSecrets(`${HOST}/smsapi`);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`failed to reach ${HOST}/miscapi/${FAKE_KEY}/getBalance`));
    expect(JSON.stringify(await sendSms(env, { to: "01711223344", text: "Hi" }))).not.toContain(FAKE_KEY);
    expect(JSON.stringify(await smsBalance(env))).not.toContain(FAKE_KEY);
  });

  it("also cuts out a key that has characters a web address rewrites (an error may quote the address the request went to)", async () => {
    const odd = `ab+cd/ef=${"q".repeat(10)}`;
    e.SMS_API_KEY = odd;
    e.SMS_API_URL = HOST;
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`failed: ${HOST}/smsapi?api_key=${encodeURIComponent(odd)}&contacts=1`));
    const r = JSON.stringify(await sendSms(env, { to: "01711223344", text: "Hi" }));
    expect(r).not.toContain(odd);
    expect(r).not.toContain(encodeURIComponent(odd));
    expect(r).not.toContain(odd.slice(0, 6) + "%");
  });

  it("keeps the result of the last real message, so the owner can see whether messages are going out", async () => {
    withSecrets();
    companySays(() => says(200, { response_code: 202 }));
    await sendSms(env, { to: "01711223344", text: "Hi" });
    expect(JSON.parse((await env.KV.get(SMS_LAST_KEY))!)).toMatchObject({ ok: true, problem: null });
    vi.restoreAllMocks();
    companySays(() => says(200, { response_code: 1007, error_message: "Insufficient balance" }));
    await sendSms(env, { to: "01711223344", text: "Hi" });
    expect(JSON.parse((await env.KV.get(SMS_LAST_KEY))!)).toMatchObject({ ok: false, problem: "no_balance" });
  });

  it("classifies a refusal from the status and the words alone", () => {
    expect(smsProblem(undefined, "")).toBe("network");
    expect(smsProblem(403, "")).toBe("key_rejected");
    expect(smsProblem(500, "oops")).toBe("provider_error");
    expect(smsProblem(200, "Not enough credit")).toBe("no_balance");
    expect(smsProblem(200, "1012 Masking SMS must be Bangla")).toBe("masking_bangla");
  });
});

describe("the credit left", () => {
  it("reads the number whether the company answers in plain text or in JSON — and never mistakes a status code for it", async () => {
    withSecrets();
    for (const [body, expected] of [
      ["Balance: 1,245.50", 1245.5],
      ["245", 245],
      [{ response_code: 202, balance: "310.25" }, 310.25],
      [{ response_code: 202, data: { credit: 99 } }, 99],
      [{ balance: 12 }, 12],
    ] as [unknown, number][]) {
      const calls = companySays(() => says(200, body));
      const r = await smsBalance(env);
      expect(r, JSON.stringify(body)).toMatchObject({ ok: true, balance: expected });
      expect(calls[0].url).toBe(`${HOST}/miscapi/${FAKE_KEY}/getBalance`);
      vi.restoreAllMocks();
    }
  });

  it("says what is wrong when the company refuses, or answers with no number", async () => {
    withSecrets();
    companySays(() => says(200, { response_code: 1011, error_message: "Invalid API key" }));
    expect(await smsBalance(env)).toMatchObject({ ok: false, balance: null, problem: "key_rejected" });
    vi.restoreAllMocks();
    companySays(() => says(401, "Unauthorized"));
    expect(await smsBalance(env)).toMatchObject({ ok: false, problem: "key_rejected" });
    vi.restoreAllMocks();
    companySays(() => says(200, { response_code: 202, message: "ok" }));
    expect(await smsBalance(env)).toMatchObject({ ok: false, balance: null });
    vi.restoreAllMocks();
    e.SMS_API_KEY = undefined;
    expect(await smsBalance(env)).toMatchObject({ ok: false, problem: "not_configured" });
  });
});

describe("what a visitor may set off", () => {
  it("allows a few messages per number per hour, and counts each number on its own", async () => {
    const number = `0171${String(Date.now()).slice(-7)}`;
    const other = `0181${String(Date.now()).slice(-7)}`;
    expect([await allowVisitorSms(env, number), await allowVisitorSms(env, number), await allowVisitorSms(env, number)]).toEqual([true, true, true]);
    expect(await allowVisitorSms(env, number)).toBe(false);
    expect(await allowVisitorSms(env, other)).toBe(true);
  });
});

describe("Settings → SMS", () => {
  it("the status is for the team to read; only the owner can check the credit or send a test", async () => {
    expect((await new Client().get("/api/admin/settings/sms")).status).toBe(401);
    for (const role of ["content_manager", "support", "viewer"] as const) {
      const { client } = await loginStaff(role);
      expect((await client.get("/api/admin/settings/sms")).status, role).toBe(200);
      expect((await client.post("/api/admin/settings/sms/balance", {})).status, role).toBe(403);
      expect((await client.post("/api/admin/settings/sms/test", { to: "01711223344" })).status, role).toBe(403);
      expect((await client.put("/api/admin/settings/sms", { enabled: true, sender_id: "", with_email: true })).status, role).toBe(403);
    }
    expect((await new Client().post("/api/admin/settings/sms/test", { to: "01711223344" })).status).toBe(401);
  });

  it("says whether the secrets are set and where messages go — and never shows the key or the rest of the address", async () => {
    const admin = await owner();
    const before = await json(await admin.get("/api/admin/settings/sms"));
    expect(before).toMatchObject({ configured: false, key_set: false, url_set: false, host: null, provider: "dev-outbox", enabled: true, sender_id: "", with_email: true, last: null });

    withSecrets(`${HOST}/miscapi/${FAKE_KEY}/getBalance`);
    const raw = await (await admin.get("/api/admin/settings/sms")).text();
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).not.toContain("/miscapi");
    expect(JSON.parse(raw)).toMatchObject({ configured: true, key_set: true, url_set: true, host: "sms.example.test", provider: "sms" });
  });

  it("checks the credit on request, and says in plain words what is wrong", async () => {
    const admin = await owner();
    withSecrets();
    companySays(() => says(200, "Balance: 245"));
    expect(await json(await admin.post("/api/admin/settings/sms/balance", {}))).toMatchObject({ read: true, balance: 245 });
    vi.restoreAllMocks();

    companySays(() => says(200, { response_code: 1011, error_message: `Invalid API key ${FAKE_KEY}` }));
    const res = await admin.post("/api/admin/settings/sms/balance", {});
    const text = await res.text();
    expect(text).not.toContain(FAKE_KEY);
    expect(JSON.parse(text)).toMatchObject({ read: false, problem: "key_rejected" });

    e.SMS_API_KEY = undefined;
    e.SMS_API_URL = undefined;
    expect(await json(await admin.post("/api/admin/settings/sms/balance", {}))).toMatchObject({ read: false, problem: "not_configured" });
  });

  it("sends one test message to the number typed, with the sender name from the settings; a bad number is refused before anything is sent", async () => {
    const admin = await owner();
    expect((await admin.put("/api/admin/settings/sms", { enabled: true, sender_id: "MAWAH", with_email: true })).status).toBe(200);

    // development: it lands in the outbox
    const dev = await json(await admin.post("/api/admin/settings/sms/test", { to: "+8801711000009", lang: "en" }));
    expect(dev).toMatchObject({ sent: true, provider: "dev-outbox", to: "01711000009" });
    expect((await outboxTo("01711000009")).at(-1)?.text).toContain("test message");

    // with the company: one request, to that number, with the sender name
    withSecrets();
    const calls = companySays(() => says(200, { response_code: 202 }));
    expect(await json(await admin.post("/api/admin/settings/sms/test", { to: "01711000010", lang: "bn" }))).toMatchObject({ sent: true, provider: "sms" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ contacts: "8801711000010", senderid: "MAWAH", type: "unicode" });

    // a number that is not a number
    const bad = await admin.post("/api/admin/settings/sms/test", { to: "12345" });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields).toHaveProperty("to");
    expect(calls).toHaveLength(1);
  });

  it("a refused test shows up on the dashboard until a later message goes through; the audit trail records that it happened, not the number", async () => {
    const admin = await owner();
    const sms = async () => (await json(await admin.get("/api/admin/health"))).checks.find((c: { key: string }) => c.key === "sms") as { status: string; issues: string[] };

    expect(await sms()).toMatchObject({ status: "warn", issues: ["sms_not_configured"] });
    withSecrets();
    companySays(() => says(200, { response_code: 1007, error_message: "Insufficient balance" }));
    const number = "01711000077";
    expect(await json(await admin.post("/api/admin/settings/sms/test", { to: number }))).toMatchObject({ sent: false, problem: "no_balance" });
    expect(await sms()).toMatchObject({ status: "warn", issues: ["sms_last_failed"] });
    expect(await json(await admin.get("/api/admin/settings/sms"))).toMatchObject({ last: { ok: false, problem: "no_balance" } });

    vi.restoreAllMocks();
    companySays(() => says(200, { response_code: 202 }));
    await admin.post("/api/admin/settings/sms/test", { to: number });
    expect(await sms()).toMatchObject({ status: "ok", issues: [] });

    const rows = await env.DB.prepare("SELECT summary, meta FROM activity_log WHERE action = 'sms.tested' ORDER BY id DESC LIMIT 2").all<{ summary: string; meta: string }>();
    expect(rows.results).toHaveLength(2);
    for (const r of rows.results) expect(`${r.summary} ${r.meta}`).not.toContain(number);
    expect(JSON.parse(rows.results[1].meta)).toMatchObject({ ok: false, problem: "no_balance" });
  });

  it("keeps the sender name and the two switches, checks the sender name, and stops a flood of tests", async () => {
    const admin = await owner();
    expect((await admin.put("/api/admin/settings/sms", { enabled: false, sender_id: "My Shop", with_email: false })).status).toBe(200);
    expect(await json(await admin.get("/api/admin/settings/sms"))).toMatchObject({ enabled: false, sender_id: "My Shop", with_email: false });
    expect((await getSettings(env, { fresh: true })).sms).toEqual({ enabled: false, sender_id: "My Shop", with_email: false });

    for (const bad of ["x".repeat(16), "bad<name>", "নাম"]) {
      const res = await admin.put("/api/admin/settings/sms", { enabled: true, sender_id: bad, with_email: true });
      expect(res.status, bad).toBe(422);
    }

    // a test costs credit: six an hour per person
    const tester = await owner();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await tester.post("/api/admin/settings/sms/test", { to: "01711000088" })).status);
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    expect(codes.slice(6)).toEqual([429, 429]);
  });
});
