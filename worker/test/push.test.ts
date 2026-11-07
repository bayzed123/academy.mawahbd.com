import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyPush, fcmBody, pushSetup } from "../src/lib/fcm";
import { forgetPass } from "../src/lib/ga4";
import { resetSettingsCache } from "../src/lib/settings";
import { AUTO_TEXT } from "../src/services/push";
import { Client, firstCourse, json, loginStaff, registerStudent } from "./helpers";

/*
 * The Android app's notifications (services/push.ts, lib/fcm.ts). Nothing here talks to Google: the Worker's own stand-in
 * (routes/api/dev-google.ts) answers the sign-in, the sends and the topic changes — the test hands the Worker's calls to it — and the key it
 * signs with is made here, in memory, for the test.
 */

const BASE = "https://academy.test/api/dev/google";
const e = env as unknown as Record<string, string | undefined | object>;

async function withEnv<T>(over: Record<string, string | object | undefined>, fn: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(over).map((k) => [k, e[k]]));
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete e[k];
      else e[k] = v;
    }
  }
}

async function makeKey(over: Record<string, unknown> = {}) {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ type: "service_account", project_id: "mawah-test", private_key_id: "kid-1", private_key: pem, client_email: "sender@mawah-test.iam.gserviceaccount.com", client_id: "1", ...over });
}

let KEY = "";
beforeAll(async () => {
  KEY = await makeKey();
});

let n = 0;
/** an address of the shape Google gives a copy of the app */
const token = (name = "phone") => `${name}_${n++}_${crypto.randomUUID().replace(/-/g, "")}:APA91b${"Q".repeat(60)}`;
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

/** Every call the Worker makes to "Google" goes to its own stand-in; the others are left alone. */
function standIn() {
  const calls: string[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as never, init);
    if (req.url.startsWith(BASE)) {
      calls.push(`${req.method} ${req.url.slice(BASE.length)}`);
      const headers = new Headers(req.headers);
      headers.set("cf-connecting-ip", `10.250.${n % 250}.${(n++ % 250) + 1}`);
      return exports.default.fetch(new Request(req, { headers }));
    }
    return real(input as never, init);
  }) as typeof fetch);
  return calls;
}

/** Notifications set up: a key that names its project, and "Google" at the stand-in. */
const ready = <T>(fn: () => Promise<T>) => withEnv({ GOOGLE_SERVICE_ACCOUNT: KEY, FIREBASE_SERVICE_ACCOUNT: undefined, GOOGLE_API_BASE: BASE }, fn);

interface Sent {
  project: string;
  topic?: string;
  condition?: string;
  title: string;
  body: string;
  data: Record<string, string>;
}
const google = async () => json<{ sent: Sent[]; topics: Record<string, string[]> }>(await exports.default.fetch(new Request(`${BASE}/push`)));
const scenario = (s: string) => exports.default.fetch(new Request(`${BASE}/scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: s }) }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** waitUntil work finishes just after the answer: look again for a while */
async function eventually<T>(look: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const got = await look();
    if (got) return got;
    if (Date.now() > until) throw new Error("it never happened");
    await sleep(40);
  }
}
const device = (t: string) => env.DB.prepare("SELECT token, student_id, lang, topics FROM push_devices WHERE token = ?").bind(t).first<{ token: string; student_id: number | null; lang: string; topics: string }>();
const sendsOf = (kind: string, courseId: number) =>
  env.DB.prepare("SELECT * FROM push_sends WHERE kind = ? AND course_id = ? ORDER BY id").bind(kind, courseId).all<{ id: number; status: string; problem: string | null; path: string; audience: string; title_en: string; body_bn: string }>().then((r) => r.results);

beforeEach(async () => {
  forgetPass();
  resetSettingsCache();
  await exports.default.fetch(new Request(`${BASE}/push`, { method: "DELETE" }));
  await scenario("ok");
  // one staff notification a minute: each test starts without the last one's
  await env.DB.prepare("DELETE FROM push_sends WHERE kind = 'manual'").run();
  await env.DB.prepare("DELETE FROM settings WHERE key = 'push'").run();
});
afterEach(() => {
  vi.restoreAllMocks();
  forgetPass();
});

/* ------------------------------------------------------------------------------------------------ classes and students */

let made = 0;
const classBody = (over: Record<string, unknown> = {}) => ({
  title_bn: "ফ্রি কেক ক্লাস",
  title_en: `Free Cake Class ${made++}`,
  short_bn: "",
  short_en: "",
  long_bn: "",
  long_en: "",
  banner_key: null,
  icon: "cake",
  category_id: 1,
  instructor_id: 1,
  level: "beginner",
  price: 0,
  status: "published",
  channel: "app",
  details_url: null,
  featured: false,
  cert_enabled: false,
  seo_title_bn: "",
  seo_title_en: "",
  seo_desc_bn: "",
  seo_desc_en: "",
  sort: 1,
  launch_at: null,
  ...over,
});

async function makeClass(staff: Client, over: Record<string, unknown> = {}) {
  const res = await staff.post("/api/admin/courses", classBody(over));
  expect(res.status).toBe(201);
  return (await json(res)).item as { id: number; slug: string; title_en: string; title_bn: string; status: string };
}

/** A student signed in the way the app signs in (a token, no cookie). */
async function appStudent() {
  const { email } = await registerStudent(undefined, { password: "push-student-pass" });
  const body = await json(await new Client().post("/api/auth/login", { identifier: email, password: "push-student-pass", client: "app" }));
  return { id: body.student.id as number, token: body.token as string };
}

const checkIn = (t: string, lang: "bn" | "en", student?: string, previous?: string) =>
  new Client().fetch("/api/app/push", { method: "POST", json: { token: t, lang, ...(previous ? { previous } : {}) }, headers: student ? bearer(student) : {} });

/* ================================================================================================ the setup */

describe("which key the notifications are sent with", () => {
  it("names what is missing, prefers the Firebase project's own key, and never falls back from a broken one", async () => {
    expect(pushSetup({} as never)).toMatchObject({ ok: false, problem: "not_configured" });
    expect(pushSetup({ GOOGLE_SERVICE_ACCOUNT: "not a key" } as never)).toMatchObject({ ok: false, problem: "key_invalid" });
    const noProject = JSON.stringify({ ...JSON.parse(KEY), project_id: undefined });
    expect(pushSetup({ GOOGLE_SERVICE_ACCOUNT: noProject } as never)).toMatchObject({ ok: false, problem: "no_project" });
    expect(pushSetup({ GOOGLE_SERVICE_ACCOUNT: KEY } as never)).toMatchObject({ ok: true, setup: { project: "mawah-test", email: "sender@mawah-test.iam.gserviceaccount.com" } });
    const firebase = await makeKey({ project_id: "mawah-academy-app", client_email: "firebase-adminsdk-x@mawah-academy-app.iam.gserviceaccount.com" });
    expect(pushSetup({ GOOGLE_SERVICE_ACCOUNT: KEY, FIREBASE_SERVICE_ACCOUNT: firebase } as never)).toMatchObject({ ok: true, setup: { project: "mawah-academy-app" } });
    // the key file in base64 works the same
    expect(pushSetup({ FIREBASE_SERVICE_ACCOUNT: btoa(firebase) } as never)).toMatchObject({ ok: true, setup: { project: "mawah-academy-app" } });
    // a Firebase key that is broken is named so, rather than quietly using another
    expect(pushSetup({ GOOGLE_SERVICE_ACCOUNT: KEY, FIREBASE_SERVICE_ACCOUNT: '{"project_info":{}}' } as never)).toMatchObject({ ok: false, problem: "key_invalid" });
  });

  it("builds the message Google wants: topic or condition, the words, what a tap opens, the channel, how long it waits", () => {
    const body = fcmBody({ to: { condition: "'class-3' in topics && 'lang-bn' in topics" }, title: "নতুন লেসন", body: "ক্রিম", path: "/course/cake", data: { kind: "new_lessons" }, tag: "class-3", ttlSeconds: 60 }) as {
      message: Record<string, any>;
    };
    expect(body.message).toEqual({
      condition: "'class-3' in topics && 'lang-bn' in topics",
      notification: { title: "নতুন লেসন", body: "ক্রিম" },
      data: { kind: "new_lessons", path: "/course/cake" },
      android: { priority: "HIGH", ttl: "60s", notification: { channel_id: "classes", color: "#FF5722", tag: "class-3" } },
    });
    expect(fcmBody({ to: { topic: "lang-en" }, title: "t", body: "b", path: "/" }, true)).toMatchObject({ validate_only: true, message: { topic: "lang-en", android: { ttl: "604800s" } } });
    // Google keeps a message 28 days at most
    expect((fcmBody({ to: { topic: "lang-en" }, title: "t", body: "b", path: "/", ttlSeconds: 90 * 86_400 }) as any).message.android.ttl).toBe(`${28 * 86_400}s`);
  });

  it("names each way Google says no in words the owner can act on", () => {
    const err = (code: number, status: string, message: string, reason?: string) => ({ error: { code, status, message, details: reason ? [{ reason }] : [] } });
    expect(classifyPush(401, err(401, "UNAUTHENTICATED", "bad credentials"), "").problem).toBe("key_rejected");
    expect(classifyPush(403, err(403, "PERMISSION_DENIED", "Firebase Cloud Messaging API has not been used in project 1 before or it is disabled.", "SERVICE_DISABLED"), "").problem).toBe("api_disabled");
    expect(classifyPush(403, err(403, "PERMISSION_DENIED", "Permission 'cloudmessaging.messages.create' denied"), "").problem).toBe("no_permission");
    expect(classifyPush(404, err(404, "NOT_FOUND", "Requested entity was not found."), "").problem).toBe("project_missing");
    expect(classifyPush(429, err(429, "RESOURCE_EXHAUSTED", "Quota"), "").problem).toBe("quota");
    expect(classifyPush(400, err(400, "INVALID_ARGUMENT", "bad"), "").problem).toBe("bad_message");
    expect(classifyPush(503, {}, "unavailable").problem).toBe("google_error");
    // anything shaped like a key is cut out of what is shown
    expect(classifyPush(400, err(400, "INVALID_ARGUMENT", `token ${"A".repeat(60)} is bad`), "").detail).not.toContain("A".repeat(40));
  });
});

/* ================================================================================================ phones */

describe("a phone that allowed notifications", () => {
  it("is added to its language's news; signing in adds its classes; another language and signing out change only the difference", async () => {
    await ready(async () => {
      const calls = standIn();
      const t = token();
      expect(await json(await checkIn(t, "bn"))).toMatchObject({ ok: true, registered: true });
      expect((await google()).topics[t]).toEqual(["lang-bn"]);
      expect(await device(t)).toMatchObject({ student_id: null, lang: "bn", topics: '["lang-bn"]' });

      // a student who studies a class signs in on it
      const { client: staff } = await loginStaff("content_manager");
      const cls = await makeClass(staff);
      const me = await appStudent();
      expect((await new Client().fetch(`/api/app/courses/${cls.slug}/join`, { method: "POST", json: {}, headers: bearer(me.token) })).status).toBe(200);
      calls.length = 0;
      await checkIn(t, "bn", me.token);
      expect((await google()).topics[t]).toEqual([`class-${cls.id}`, "lang-bn"]);
      expect(calls.filter((c) => c.startsWith("POST /iid"))).toEqual(["POST /iid/v1:batchAdd"]); // only the class was added
      expect((await device(t))!.student_id).toBe(me.id);

      // the same again changes nothing at Google
      calls.length = 0;
      await checkIn(t, "bn", me.token);
      expect(calls.filter((c) => c.startsWith("POST /iid"))).toEqual([]);

      // English now
      await checkIn(t, "en", me.token);
      expect((await google()).topics[t]).toEqual([`class-${cls.id}`, "lang-en"]);
      // signed out: the news stays, the class goes
      await checkIn(t, "en");
      expect((await google()).topics[t]).toEqual(["lang-en"]);
      expect(await device(t)).toMatchObject({ student_id: null, lang: "en", topics: '["lang-en"]' });
    });
  });

  it("a new address from Google replaces the old one; an address Google does not know is not kept; a malformed one is refused", async () => {
    await ready(async () => {
      standIn();
      const old = token("old");
      const fresh = token("new");
      await checkIn(old, "bn");
      await checkIn(fresh, "bn", undefined, old);
      expect(await device(old)).toBeNull();
      expect(await device(fresh)).not.toBeNull();

      const gone = token("DEV_gone");
      expect(await json(await checkIn(gone, "bn"))).toMatchObject({ registered: false });
      expect(await device(gone)).toBeNull();

      expect((await checkIn("short", "bn")).status).toBe(422);
      expect((await checkIn(`${token()}<script>`, "bn")).status).toBe(422);
      expect((await new Client().post("/api/app/push", { token: token(), lang: "fr" })).status).toBe(422);
    });
  });

  it("many phones behind one address (a mobile network) checking in at once are all taken", async () => {
    await ready(async () => {
      standIn();
      const shared = new Client("10.77.0.1");
      const phones = Array.from({ length: 12 }, () => token("cgnat"));
      for (const t of phones) expect((await shared.post("/api/app/push", { token: t, lang: "bn" })).status).toBe(200);
      for (const t of phones) expect(await device(t)).not.toBeNull();
    });
  });

  it("turning notifications off takes the phone off everything and forgets it", async () => {
    await ready(async () => {
      standIn();
      const t = token();
      await checkIn(t, "bn");
      expect((await google()).topics[t]).toEqual(["lang-bn"]);
      expect((await new Client().post("/api/app/push/off", { token: t })).status).toBe(200);
      expect((await google()).topics[t]).toBeUndefined();
      expect(await device(t)).toBeNull();
      // an address it never knew: nothing to do, and no error
      expect((await new Client().post("/api/app/push/off", { token: token() })).status).toBe(200);
    });
  });

  it("joining a free class in the app adds the student's phones to that class at once", async () => {
    await ready(async () => {
      standIn();
      const { client: staff } = await loginStaff("content_manager");
      const cls = await makeClass(staff);
      const me = await appStudent();
      const t = token();
      await checkIn(t, "bn", me.token);
      expect((await google()).topics[t]).toEqual(["lang-bn"]);
      await new Client().fetch(`/api/app/courses/${cls.slug}/join`, { method: "POST", json: {}, headers: bearer(me.token) });
      await eventually(async () => (await google()).topics[t]?.includes(`class-${cls.id}`));
      expect(JSON.parse((await device(t))!.topics)).toEqual(expect.arrayContaining([`class-${cls.id}`, "lang-bn"]));
    });
  });

  it("before notifications are set up nothing is kept (Google cannot vouch for the address); the phone is set up at its next check-in", async () => {
    const t = token();
    await withEnv({ GOOGLE_SERVICE_ACCOUNT: undefined, FIREBASE_SERVICE_ACCOUNT: undefined }, async () => {
      expect(await json(await checkIn(t, "bn"))).toMatchObject({ registered: true });
      expect(await device(t)).toBeNull();
    });
    await ready(async () => {
      standIn();
      await checkIn(t, "bn");
      expect((await google()).topics[t]).toEqual(["lang-bn"]);
    });
  });

  it("a topic Google would not add is tried again next time (what is written down is what Google did)", async () => {
    await ready(async () => {
      standIn();
      const t = token();
      await scenario("down");
      expect(await json(await checkIn(t, "bn"))).toMatchObject({ registered: true });
      expect(await device(t)).toMatchObject({ topics: "[]" });
      await scenario("ok");
      await checkIn(t, "bn");
      expect(await device(t)).toMatchObject({ topics: '["lang-bn"]' });
    });
  });

  it("deleting the account unlinks its phones (they keep the news they allowed)", async () => {
    await ready(async () => {
      standIn();
      const { email } = await registerStudent(undefined, { password: "push-delete-pass" });
      const login = await json(await new Client().post("/api/auth/login", { identifier: email, password: "push-delete-pass", client: "app" }));
      const t = token();
      await checkIn(t, "bn", login.token);
      expect((await device(t))!.student_id).toBe(login.student.id);
      const del = await new Client().fetch("/api/auth/delete-account", { method: "POST", json: { confirm: true, password: "push-delete-pass" }, headers: bearer(login.token) });
      expect(del.status).toBe(200);
      expect((await device(t))!.student_id).toBeNull();
    });
  });
});

/* ================================================================================================ staff's own notifications */

const push = (staff: Client, over: Record<string, unknown> = {}) =>
  staff.post("/api/admin/app/push", { audience: "all", course_id: null, title_bn: "নতুন অফার নয়, নতুন রেসিপি", body_bn: "আজ সন্ধ্যায় লাইভ", title_en: "Live tonight", body_en: "Join us at 8 pm", ...over });

describe("Admin → Android app → Send a notification", () => {
  it("goes to every phone in its own language, opens Home without a class, is written down and logged", async () => {
    await ready(async () => {
      standIn();
      const { client } = await loginStaff("content_manager");
      const res = await push(client);
      expect(res.status).toBe(200);
      const { send } = await json(res);
      expect(send).toMatchObject({ kind: "manual", audience: "all", status: "sent", problem: null, path: "/" });
      const { sent } = await google();
      expect(sent).toHaveLength(2);
      expect(sent.find((s) => s.topic === "lang-bn")).toMatchObject({ project: "mawah-test", title: "নতুন অফার নয়, নতুন রেসিপি", body: "আজ সন্ধ্যায় লাইভ", data: { kind: "manual", path: "/" } });
      expect(sent.find((s) => s.topic === "lang-en")).toMatchObject({ title: "Live tonight", body: "Join us at 8 pm" });
      const logged = await env.DB.prepare("SELECT summary FROM activity_log WHERE action = 'push.sent' AND entity_id = ?").bind(String(send.id)).first<{ summary: string }>();
      expect(logged?.summary).toBe("Live tonight");
      // a second one within a minute is almost always a double click
      expect((await json(await push(client))).error).toMatchObject({ code: "push_too_soon" });
      expect((await google()).sent).toHaveLength(2);
    });
  });

  it("to one class's students: only phones in that class AND that language, and a tap opens the class", async () => {
    await ready(async () => {
      standIn();
      const { client } = await loginStaff("super_admin");
      const cls = await makeClass(client);
      // the class's own announcement goes out just after it is saved: let it, then start counting
      await eventually(async () => (await sendsOf("new_class", cls.id)).length === 1);
      await exports.default.fetch(new Request(`${BASE}/push`, { method: "DELETE" }));
      const res = await push(client, { audience: "class", course_id: cls.id });
      expect((await json(res)).send).toMatchObject({ audience: "class", path: `/course/${cls.slug}`, status: "sent" });
      const { sent } = await google();
      expect(sent.map((s) => s.condition).sort()).toEqual([`'class-${cls.id}' in topics && 'lang-bn' in topics`, `'class-${cls.id}' in topics && 'lang-en' in topics`]);
    });
  });

  it("for everyone a class must be one the app shows: a free app class, or a website class with a free demo", async () => {
    await ready(async () => {
      standIn();
      const { client } = await loginStaff("super_admin");
      const free = await makeClass(client);
      expect((await json(await push(client, { course_id: free.id }))).send.path).toBe(`/free/${free.slug}`);
      await env.DB.prepare("DELETE FROM push_sends WHERE kind = 'manual'").run();

      const website = await makeClass(client, { channel: "website", price: 1500 });
      const noDemo = await push(client, { course_id: website.id });
      expect(noDemo.status).toBe(422);
      expect((await json(noDemo)).error.fields).toEqual({ course_id: "not_in_app" });
      await env.DB.prepare("UPDATE courses SET demo_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' WHERE id = ?").bind(website.id).run();
      expect((await json(await push(client, { course_id: website.id }))).send.path).toBe(`/demo/${website.slug}`);
      await env.DB.prepare("DELETE FROM push_sends WHERE kind = 'manual'").run();

      const draft = await makeClass(client, { status: "draft" });
      expect((await json(await push(client, { course_id: draft.id }))).error.fields).toEqual({ course_id: "not_live" });
      expect((await json(await push(client, { audience: "class", course_id: null }))).error.fields).toEqual({ course_id: "required" });
      expect((await push(client, { title_bn: "", title_en: "x".repeat(66) })).status).toBe(422);
    });
  });

  it("only staff who may publish classes send; nothing is sent before notifications are set up", async () => {
    await ready(async () => {
      standIn();
      for (const role of ["viewer", "support"] as const) expect((await push((await loginStaff(role)).client)).status).toBe(403);
      expect((await push(new Client())).status).toBe(401);
    });
    await withEnv({ GOOGLE_SERVICE_ACCOUNT: undefined, FIREBASE_SERVICE_ACCOUNT: undefined }, async () => {
      const res = await push((await loginStaff()).client);
      expect(res.status).toBe(409);
      expect((await json(res)).error.code).toBe("push_not_ready");
    });
  });

  it("when Google says no, the send is written down as failed with the reason, and the page shows it", async () => {
    await ready(async () => {
      standIn();
      const { client } = await loginStaff();
      await scenario("api_disabled");
      const { send } = await json(await push(client));
      expect(send).toMatchObject({ status: "failed", problem: "api_disabled" });
      const page = await json(await client.get("/api/admin/app"));
      expect(page.push.recent[0]).toMatchObject({ id: send.id, status: "failed", problem: "api_disabled", staff_name: "Test super_admin" });
    });
  });

  it("Check the connection asks Google to check a message in full and delivers nothing", async () => {
    await ready(async () => {
      standIn();
      const { client } = await loginStaff("content_manager");
      expect(await json(await client.post("/api/admin/app/push/check"))).toMatchObject({ connected: true, project: "mawah-test", account: "sender@mawah-test.iam.gserviceaccount.com" });
      expect((await google()).sent).toEqual([]);
      await scenario("no_access");
      expect(await json(await client.post("/api/admin/app/push/check"))).toMatchObject({ connected: false, problem: "no_permission" });
      await scenario("key_rejected");
      forgetPass();
      expect(await json(await client.post("/api/admin/app/push/check"))).toMatchObject({ connected: false, problem: "key_rejected" });
    });
    await withEnv({ GOOGLE_SERVICE_ACCOUNT: undefined, FIREBASE_SERVICE_ACCOUNT: undefined }, async () => {
      expect(await json(await (await loginStaff()).client.post("/api/admin/app/push/check"))).toMatchObject({ connected: false, problem: "not_configured" });
    });
  });

  it("the page shows whether it is set up, how many phones get notifications, and the automatic switches", async () => {
    await ready(async () => {
      standIn();
      const { client } = await loginStaff();
      const me = await appStudent();
      await checkIn(token(), "bn", me.token);
      await checkIn(token(), "en");
      const { push: p } = await json(await client.get("/api/admin/app"));
      expect(p).toMatchObject({ ready: true, problem: null, project: "mawah-test", account: "sender@mawah-test.iam.gserviceaccount.com", auto: { new_class: true, new_lessons: true } });
      expect(p.phones).toBeGreaterThanOrEqual(2);
      expect(p.signed_in).toBeGreaterThanOrEqual(1);
    });
    await withEnv({ GOOGLE_SERVICE_ACCOUNT: undefined, FIREBASE_SERVICE_ACCOUNT: undefined }, async () => {
      const { push: p } = await json(await (await loginStaff("viewer")).client.get("/api/admin/app"));
      expect(p).toMatchObject({ ready: false, problem: "not_configured", project: null, account: null });
    });
  });
});

/* ================================================================================================ the automatic ones */

describe("notifications that go out by themselves", () => {
  it("one of the app's free classes going live tells everyone once; a website class is not announced in the app", async () => {
    await ready(async () => {
      standIn();
      const { client } = await loginStaff("content_manager");
      const cls = await makeClass(client);
      const [row] = await eventually(async () => {
        const r = await sendsOf("new_class", cls.id);
        return r.length ? r : null;
      });
      expect(row).toMatchObject({ status: "sent", audience: "all", path: `/free/${cls.slug}`, title_en: "A new free class is here" });
      const { sent } = await google();
      expect(sent.find((s) => s.topic === "lang-bn")).toMatchObject({ title: "নতুন ফ্রি ক্লাস এসেছে", body: `${cls.title_bn} — অ্যাপে এখনই শুরু করুন।`, data: { kind: "new_class", path: `/free/${cls.slug}` } });
      expect(sent.find((s) => s.topic === "lang-en")).toMatchObject({ body: `${cls.title_en} — start it now in the app.` });

      // saved again, taken down and put back: never a second time
      await client.patch(`/api/admin/courses/${cls.id}`, { short_en: "Now with pictures" });
      await client.patch(`/api/admin/courses/${cls.id}`, { status: "archived" });
      await client.patch(`/api/admin/courses/${cls.id}`, { status: "published" });
      await sleep(300);
      expect(await sendsOf("new_class", cls.id)).toHaveLength(1);

      // a draft goes live later: announced then
      const later = await makeClass(client, { status: "draft" });
      await sleep(200);
      expect(await sendsOf("new_class", later.id)).toHaveLength(0);
      await client.patch(`/api/admin/courses/${later.id}`, { status: "published" });
      await eventually(async () => (await sendsOf("new_class", later.id)).length === 1);

      const website = await makeClass(client, { channel: "website", price: 1500 });
      await sleep(300);
      expect(await sendsOf("new_class", website.id)).toHaveLength(0);
    });
  });

  it("a new lesson in a live class tells its students once in 12 hours; a class without students, a draft, or the switch off sends nothing", async () => {
    await ready(async () => {
      standIn();
      const { client } = await loginStaff("content_manager");
      const cls = await makeClass(client);
      const me = await appStudent();
      await new Client().fetch(`/api/app/courses/${cls.slug}/join`, { method: "POST", json: {}, headers: bearer(me.token) });
      const mod = await json(await client.post(`/api/admin/courses/${cls.id}/modules`, { title_bn: "শুরু", title_en: "Start", drip_days: 0 }));
      await eventually(async () => (await sendsOf("new_class", cls.id)).length === 1);
      await exports.default.fetch(new Request(`${BASE}/push`, { method: "DELETE" }));

      const lesson = (title_en: string) => client.post(`/api/admin/courses/${cls.id}/lessons`, { module_id: mod.module.id, title_bn: "ক্রিম তৈরি", title_en, type: "text" });
      expect((await lesson("Making the cream")).status).toBe(201);
      const [row] = await eventually(async () => {
        const r = await sendsOf("new_lessons", cls.id);
        return r.length ? r : null;
      });
      expect(row).toMatchObject({ status: "sent", audience: "class", path: `/course/${cls.slug}`, body_bn: "ক্রিম তৈরি" });
      const { sent } = await google();
      expect(sent.find((s) => s.condition?.includes("lang-en"))).toMatchObject({
        condition: `'class-${cls.id}' in topics && 'lang-en' in topics`,
        title: `New lesson: ${cls.title_en}`,
        body: "Making the cream",
        data: { kind: "new_lessons", path: `/course/${cls.slug}` },
      });

      // a teacher adding several lessons in an evening sends one
      expect((await lesson("Decorating")).status).toBe(201);
      await sleep(300);
      expect(await sendsOf("new_lessons", cls.id)).toHaveLength(1);

      // the owner switched them off
      await env.DB.prepare("UPDATE push_sends SET created_at = '2020-01-01T00:00:00Z' WHERE kind = 'new_lessons' AND course_id = ?").bind(cls.id).run();
      expect((await client.put("/api/admin/settings/push", { new_class: true, new_lessons: false })).status).toBe(403); // a content manager cannot
      expect((await (await loginStaff("super_admin")).client.put("/api/admin/settings/push", { new_class: true, new_lessons: false })).status).toBe(200);
      resetSettingsCache();
      expect((await lesson("Boxing")).status).toBe(201);
      await sleep(300);
      expect(await sendsOf("new_lessons", cls.id)).toHaveLength(1);

      // no students, or not live: nothing to tell
      await env.DB.prepare("DELETE FROM settings WHERE key = 'push'").run();
      resetSettingsCache();
      const empty = await makeClass(client);
      const m2 = await json(await client.post(`/api/admin/courses/${empty.id}/modules`, { title_bn: "শুরু", title_en: "Start", drip_days: 0 }));
      await client.post(`/api/admin/courses/${empty.id}/lessons`, { module_id: m2.module.id, title_bn: "ক", title_en: "A", type: "text" });
      const draft = await makeClass(client, { status: "draft" });
      const m3 = await json(await client.post(`/api/admin/courses/${draft.id}/modules`, { title_bn: "শুরু", title_en: "Start", drip_days: 0 }));
      await client.post(`/api/admin/courses/${draft.id}/lessons`, { module_id: m3.module.id, title_bn: "ক", title_en: "A", type: "text" });
      await sleep(300);
      expect(await sendsOf("new_lessons", empty.id)).toHaveLength(0);
      expect(await sendsOf("new_lessons", draft.id)).toHaveLength(0);
    });
  });

  it("the switches are saved on their own, so saving the app's notice never turns them back on", async () => {
    const { client } = await loginStaff();
    expect((await client.put("/api/admin/settings/push", { new_class: false, new_lessons: true })).status).toBe(200);
    expect((await client.put("/api/admin/settings/app", { notice_on: false, notice_bn: "", notice_en: "" })).status).toBe(200);
    expect((await json(await client.get("/api/admin/app"))).push.auto).toEqual({ new_class: false, new_lessons: true });
    expect((await client.put("/api/admin/settings/push", { new_class: "yes" })).status).toBe(422);
  });

  it("the automatic texts speak of classes and lessons only — never of buying", () => {
    const texts = [AUTO_TEXT.new_class({ bn: "কেক", en: "Cake" }), AUTO_TEXT.new_lessons({ bn: "কেক", en: "Cake" }, { bn: "ক্রিম", en: "Cream" })];
    for (const t of texts) {
      for (const v of Object.values(t)) {
        expect(v).not.toMatch(/\b(buy|purchase|price|pay|enrol(l)?|upgrade|subscribe|premium|unlock|website|taka|৳)\b|কিনুন|ক্রয়|দাম|টাকা|ভর্তি|ওয়েবসাইট/i);
      }
    }
  });
});

it("the stand-in is never there on the real site", async () => {
  await withEnv({ ENVIRONMENT: "production" }, async () => {
    expect((await exports.default.fetch(new Request(`${BASE}/push`))).status).toBe(404);
  });
  // (and lib/ga4.ts endpoints() ignores GOOGLE_API_BASE there — test/analytics.test.ts)
  expect((await firstCourse()).id).toBeGreaterThan(0);
});
