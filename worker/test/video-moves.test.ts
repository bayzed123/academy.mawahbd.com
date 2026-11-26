import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEV_WEBM } from "../src/routes/api/dev-video";
import { forgetPass } from "../src/lib/ga4";
import { MAX_AT_ONCE } from "../src/services/videoMoves";
import { Client, env, json, loginStaff, registerStudent } from "./helpers";

/*
 * Admin → Video speed (services/videoMoves.ts): lessons whose video is a Google Drive file are copied into Cloudflare Stream, a few at a time,
 * each from a one-time address of the website's own that hands on only that file; once Stream can play a copy, its lesson plays from Stream
 * (the quality steps down on a slow phone instead of stopping). Google is the Worker's own stand-in (routes/api/dev-google.ts); Stream is a
 * stand-in made here, which records what it was asked and is told when a copy is "ready".
 */

const PUBLIC = "https://academy.test";
const STAND_IN = `${PUBLIC}/api/dev/google`;
const e = env as unknown as Record<string, string | undefined | object>;
const fileId = (kind: string, n: number) => `DEV_${kind}_${String(n).padStart(10, "0")}`;
const viewUrl = (file: string) => `https://drive.google.com/file/d/${file}/view?usp=sharing`;

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

let KEY = "";
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  KEY = JSON.stringify({ type: "service_account", project_id: "mawah-test", private_key_id: "kid-1", private_key: pem, client_email: "reader@mawah-test.iam.gserviceaccount.com", client_id: "1" });
});

/** Every call the Worker makes for "Google" goes to the dev Worker's own stand-in. */
function googleIsStoodIn() {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(STAND_IN)) return real(input as never, init);
    const target = new URL(url);
    return new Client().fetch(`${target.pathname}${target.search}`, { method: init?.method, body: init?.body as BodyInit, headers: init?.headers });
  }) as typeof fetch);
}

/** Cloudflare Stream, stood in for: it remembers what it was asked to copy, and the test says when a copy is ready or broken. */
function fakeStream() {
  let n = 0;
  const videos = new Map<string, { url: string; ready: boolean; state: string; duration: number; deleted: boolean; params: unknown }>();
  const s = {
    videos,
    /** the next upload is refused with this error name (QuotaReachedError …) */
    refuse: null as string | null,
    /** …and these words */
    refuseWith: "Stream said no",
    /** answer an upload the REST way (`uid`, not `id`) */
    restShape: false,
    uploads: () => [...videos.values()],
    async upload(url: string, params?: unknown) {
      if (s.refuse) {
        const err = new Error(s.refuseWith);
        err.name = s.refuse;
        throw err;
      }
      const id = (++n).toString(16).padStart(32, "c");
      videos.set(id, { url, ready: false, state: "downloading", duration: 0, deleted: false, params });
      return s.restShape ? { uid: id } : { id };
    },
    video(id: string) {
      return {
        async details() {
          const v = videos.get(id);
          if (!v || v.deleted) {
            const err = new Error("gone");
            err.name = "NotFoundError";
            throw err;
          }
          return { id, readyToStream: v.ready, duration: v.duration, status: { state: v.ready ? "ready" : v.state, errorReasonCode: v.state === "error" ? "ERR_NON_VIDEO" : "", errorReasonText: "" } };
        },
        async delete() {
          const v = videos.get(id);
          if (v) v.deleted = true;
        },
        async generateToken() {
          return `signed-${id}`;
        },
      };
    },
    ready(id: string, seconds: number) {
      Object.assign(videos.get(id)!, { ready: true, duration: seconds });
    },
    broken(id: string) {
      Object.assign(videos.get(id)!, { state: "error" });
    },
  };
  return s;
}
type FakeStream = ReturnType<typeof fakeStream>;

const withStream = <T>(stream: FakeStream | undefined, fn: () => Promise<T>) =>
  withEnv({ GOOGLE_SERVICE_ACCOUNT: KEY, GOOGLE_API_BASE: STAND_IN, STREAM: stream, STREAM_CUSTOMER_CODE: "abc123" }, fn);

beforeEach(() => forgetPass());
afterEach(async () => {
  vi.restoreAllMocks();
  await env.KV.delete("vmoves:blocked");
});

let seq = 0;
/** A published class with these lessons (a Drive link, or another kind) in one module. */
async function makeClass(urls: (string | null)[]) {
  const n = ++seq;
  const course = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, 'ভিডিও ক্লাস', ?, 0, 'published', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(`speed-test-${Date.now().toString(36)}-${n}`, `Speed Class ${n}`)
    .run();
  const courseId = course.meta.last_row_id as number;
  const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort) VALUES (?, 'মডিউল', 'Module', 1)").bind(courseId).run();
  const ids: number[] = [];
  for (const [i, url] of urls.entries()) {
    const r = await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, sort) VALUES (?, ?, 'লেসন', ?, ?, ?, ?)")
      .bind(courseId, mod.meta.last_row_id, `Lesson ${i + 1}`, url ? "external" : "text", url, i)
      .run();
    ids.push(r.meta.last_row_id as number);
  }
  return { courseId, ids };
}
const lesson = (id: number) => env.DB.prepare("SELECT type, stream_uid, external_url, duration_sec FROM lessons WHERE id = ?").bind(id).first<{ type: string; stream_uid: string | null; external_url: string | null; duration_sec: number }>();
type Row = { id: number; on_stream: boolean; move: { state: string; problem: string | null; minutes: number | null } | null };
const rowsOf = (body: { lessons: Row[] }, ids: number[]) => ids.map((id) => body.lessons.find((l) => l.id === id));

describe("Video speed", () => {
  it("lists the Drive lessons; five copy at a time, each from a one-time address that hands on only its own Drive file", async () => {
    const stream = fakeStream();
    googleIsStoodIn();
    await withStream(stream, async () => {
      const files = Array.from({ length: 7 }, (_, i) => fileId("video_ok", 100 + i));
      const cls = await makeClass([...files.map(viewUrl), null, "https://youtu.be/dQw4w9WgXcQ"]);
      const drive = cls.ids.slice(0, 7);
      const { client } = await loginStaff("content_manager");

      const before = await json<{ configured: boolean; lessons: Row[] }>(await client.get("/api/admin/video-moves"));
      expect(before.configured).toBe(true);
      expect(rowsOf(before, drive).every((r) => r && !r.on_stream && r.move === null)).toBe(true);
      // the text lesson and the YouTube one are not Drive videos
      expect(before.lessons.some((l) => l.id === cls.ids[7] || l.id === cls.ids[8])).toBe(false);

      const started = await client.post("/api/admin/video-moves", { lessons: drive });
      expect(started.status).toBe(200);
      expect((await json<{ queued: number }>(started)).queued).toBe(7);
      expect(stream.uploads()).toHaveLength(MAX_AT_ONCE);
      const states = rowsOf(await json(await client.get("/api/admin/video-moves")), drive).map((r) => r!.move!.state);
      expect(states.filter((s) => s === "copying")).toHaveLength(5);
      expect(states.filter((s) => s === "queued")).toHaveLength(2);
      // asked again: nothing is queued twice
      expect((await json<{ queued: number }>(await client.post("/api/admin/video-moves", { lessons: drive }))).queued).toBe(0);

      // each copy is made from the website's own one-time address, which hands on that lesson's Drive file — and nothing without the token
      const [first] = stream.uploads();
      expect(first.url.startsWith(`${new URL(env.SITE_URL).origin}/api/video-source/`)).toBe(true); // the website's own address
      expect(first.url).toMatch(/\/api\/video-source\/[a-z0-9]{40}$/);
      expect(first.params).toMatchObject({ requireSignedURLs: true, meta: { lesson: String(drive[0]), from: "google-drive" } });
      const part = await new Client().fetch(new URL(first.url).pathname, { headers: { Range: "bytes=0-99" } });
      expect(part.status).toBe(206);
      expect(new Uint8Array(await part.arrayBuffer())).toEqual(DEV_WEBM.slice(0, 100));
      expect((await new Client().get(`/api/video-source/${"x".repeat(40)}`)).status).toBe(404);
      expect((await new Client().get("/api/video-source/short")).status).toBe(404);

      // Stream finishes the first copy: the lesson plays from Stream (the Drive link kept), its address is closed, the next copy starts
      const uid = [...stream.videos.keys()][0];
      stream.ready(uid, 481);
      const after = await json<{ lessons: Row[] }>(await client.get("/api/admin/video-moves"));
      expect(rowsOf(after, [drive[0]])[0]).toMatchObject({ on_stream: true, move: { state: "ready", minutes: 8 } });
      expect(await lesson(drive[0])).toEqual({ type: "video", stream_uid: uid, external_url: viewUrl(files[0]), duration_sec: 481 });
      expect((await new Client().fetch(new URL(first.url).pathname)).status).toBe(404);
      expect(stream.uploads()).toHaveLength(6);

      // a student now gets Stream's signed player for that lesson
      const s = await registerStudent();
      await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, source) VALUES (?, ?, 'admin')").bind(s.id, cls.courseId).run();
      const got = (await json<{ lesson: { video: { embed_url: string } | null; external: unknown } }>(await s.client.get(`/api/student/lessons/${drive[0]}`))).lesson;
      expect(got.video?.embed_url).toBe(`https://customer-abc123.cloudflarestream.com/signed-${uid}/iframe?preload=metadata`);
      expect(got.external).toBeNull();

      // a copy Stream could not convert fails, says so, and the lesson keeps playing from Drive
      const second = [...stream.videos.keys()][1];
      stream.broken(second);
      const broken = rowsOf(await json(await client.get("/api/admin/video-moves")), [drive[1]])[0]!;
      expect(broken).toMatchObject({ on_stream: false, move: { state: "failed", problem: "stream_rejected" } });
      expect((await lesson(drive[1]))!.type).toBe("external");

      // switched back: Drive again, and the Stream copy deleted (no longer counted in Stream's storage)
      const undo = await client.post(`/api/admin/video-moves/${drive[0]}/undo`);
      expect(undo.status).toBe(200);
      expect(await lesson(drive[0])).toMatchObject({ type: "external", stream_uid: null, external_url: viewUrl(files[0]) });
      expect(stream.videos.get(uid)!.deleted).toBe(true);
      expect((await client.post(`/api/admin/video-moves/${drive[0]}/undo`)).status).toBe(409);
      // and it can be moved again
      expect((await json<{ queued: number }>(await client.post("/api/admin/video-moves", { lessons: [drive[0], drive[1]] }))).queued).toBe(2);
    });
  });

  it("Stream's storage full (or never bought) pauses the queue and says so, instead of failing every lesson", async () => {
    const stream = fakeStream();
    googleIsStoodIn();
    await withStream(stream, async () => {
      const cls = await makeClass([viewUrl(fileId("video_ok", 201)), viewUrl(fileId("video_ok", 202))]);
      const { client } = await loginStaff("super_admin");
      stream.refuse = "QuotaReachedError";
      const body = await json<{ blocked: { problem: string } | null; lessons: Row[] }>(await client.post("/api/admin/video-moves", { lessons: cls.ids }));
      expect(body.blocked).toMatchObject({ problem: "stream_quota" });
      expect(rowsOf(body, cls.ids).map((r) => r!.move!.state)).toEqual(["queued", "queued"]);
      expect(stream.uploads()).toHaveLength(0);
      // storage bought: once the pause is over the queue moves on by itself
      stream.refuse = null;
      await env.KV.delete("vmoves:blocked");
      const later = await json<{ blocked: unknown; lessons: Row[] }>(await client.get("/api/admin/video-moves"));
      expect(later.blocked).toBeNull();
      expect(rowsOf(later, cls.ids).map((r) => r!.move!.state)).toEqual(["copying", "copying"]);
    });
  });

  it("an account whose Stream was never bought pauses the queue with that reason, though Stream only says so in words; other refusals keep Cloudflare's own words", async () => {
    const stream = fakeStream();
    googleIsStoodIn();
    await withStream(stream, async () => {
      const cls = await makeClass([viewUrl(fileId("video_ok", 501)), viewUrl(fileId("video_ok", 502)), viewUrl(fileId("video_ok", 503))]);
      const { client } = await loginStaff("super_admin");
      // a plain error, no special name: the words say the account has no Stream plan
      stream.refuse = "Error";
      stream.refuseWith = "Stream is not available: this account does not have an active Stream subscription";
      const paused = await json<{ blocked: { problem: string; detail: string } | null; lessons: Row[] }>(await client.post("/api/admin/video-moves", { lessons: [cls.ids[0]] }));
      expect(paused.blocked).toMatchObject({ problem: "stream_quota" });
      expect(paused.blocked!.detail).toContain("does not have an active Stream subscription");
      expect(rowsOf(paused, [cls.ids[0]])[0]!.move!.state).toBe("queued");
      await env.KV.delete("vmoves:blocked");

      // anything else fails that lesson, with Cloudflare's words kept (anything key-like cut out)
      stream.refuse = "InternalError";
      stream.refuseWith = `Something broke while fetching (request ${"a1b2c3d4".repeat(6)})`;
      const failed = rowsOf(await json(await client.post("/api/admin/video-moves", { lessons: [cls.ids[1]] })), [cls.ids[1]])[0] as Row & { move: { detail: string } };
      expect(failed.move).toMatchObject({ state: "failed", problem: "stream_error" });
      expect(failed.move.detail).toBe("InternalError: Something broke while fetching (request …)");

      // Stream answering the REST way (`uid`) is understood too
      stream.refuse = null;
      stream.restShape = true;
      await env.KV.delete("vmoves:blocked");
      const started = rowsOf(await json(await client.post("/api/admin/video-moves", { lessons: [cls.ids[2]] })), [cls.ids[2]])[0]!;
      expect(started.move!.state).toBe("copying");
      const uid = [...stream.videos.keys()].at(-1)!;
      stream.ready(uid, 60);
      expect(rowsOf(await json(await client.get("/api/admin/video-moves")), [cls.ids[2]])[0]).toMatchObject({ on_stream: true });
      expect((await lesson(cls.ids[2]))!.stream_uid).toBe(uid);
    });
  });

  it("a Drive file the website cannot read fails with the reason, and nothing is sent to Stream", async () => {
    const stream = fakeStream();
    googleIsStoodIn();
    await withStream(stream, async () => {
      const cls = await makeClass([viewUrl(fileId("not_shared", 301)), viewUrl(fileId("pdf_file", 302))]);
      const { client } = await loginStaff("super_admin");
      const body = await json<{ lessons: Row[] }>(await client.post("/api/admin/video-moves", { lessons: cls.ids }));
      expect(rowsOf(body, cls.ids).map((r) => r!.move)).toMatchObject([
        { state: "failed", problem: "drive_no_access" },
        { state: "failed", problem: "drive_not_video" },
      ]);
      expect(stream.uploads()).toHaveLength(0);
    });
  });

  it("without Stream the page says so and nothing can be queued; only people who may edit classes move videos", async () => {
    googleIsStoodIn();
    await withStream(undefined, async () => {
      const cls = await makeClass([viewUrl(fileId("video_ok", 401))]);
      const { client } = await loginStaff("super_admin");
      expect((await json<{ configured: boolean }>(await client.get("/api/admin/video-moves"))).configured).toBe(false);
      expect((await client.post("/api/admin/video-moves", { lessons: cls.ids })).status).toBe(503);
    });
    await withStream(fakeStream(), async () => {
      for (const role of ["support", "viewer"] as const) {
        const { client } = await loginStaff(role);
        expect((await client.post("/api/admin/video-moves", { all: true })).status, role).toBe(403);
      }
      expect((await new Client().get("/api/admin/video-moves")).status).toBe(401);
    });
  });
});
