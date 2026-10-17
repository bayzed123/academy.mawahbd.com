import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exports } from "cloudflare:workers";
import { DEV_WEBM } from "../src/routes/api/dev-video";
import { classifyDrive, DRIVE_LAST_KEY, driveCheck, driveInfo, driveReadable, driveRef, parseRange, type DriveProblem } from "../src/lib/drive";
import { DRIVE_SCOPE, endpoints, forgetPass, googleToken, parseServiceAccount, signedNote } from "../src/lib/ga4";
import { Client, env, json, loginStaff, registerStudent } from "./helpers";

/*
 * Class videos kept in Google Drive, played inside the student portal. A video in Drive is private, and a student sent to its Drive address sees "You
 * need permission". Now the owner shares the video with the website's own Google account, and the Worker hands the video to the student's player. What
 * the owner cannot see, and these tests protect: only a student who owns the class (or anyone, for a free preview) gets a video, and only the file the
 * owner put in that lesson — never one the student names; the video starts at once and can be skipped through (the "give me this part" requests
 * browsers make); nothing but video and audio is ever handed on under the website's address; a video that cannot be fetched says nothing of Google's
 * words; the Google key never comes out; the lesson page offers "play it here" only when it will work, and otherwise says the video is being prepared — a student is never sent to Drive;
 * and the owner's "Check access" explains each way it can fail. Google Drive is stood in for by the dev Worker itself (nothing leaves the machine).
 */

const PUBLIC = "https://academy.test";
const STAND_IN = `${PUBLIC}/api/dev/google`;
const e = env as unknown as Record<string, string | undefined | object>;

/** a made-up Drive id that tells the stand-in what to do (see dev-google.ts) — Drive ids are 20–100 letters, digits, - and _ */
const id = (kind: string, n = 1) => `DEV_${kind}_${String(n).padStart(10, "0")}`;
const OK = id("video_ok");
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

/* ------------------------------------------------------------------------------------------------ a key made for the tests */

let KEY: { file: string; email: string };
async function makeKey(email = "reader@mawah-test.iam.gserviceaccount.com") {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  return { file: JSON.stringify({ type: "service_account", project_id: "mawah-test", private_key_id: "kid-1", private_key: pem, client_email: email, client_id: "1" }), email };
}
beforeAll(async () => {
  KEY = await makeKey();
});

/* ------------------------------------------------------------------------------------------------ Google, stood in for */

interface Call {
  url: string;
  method: string;
  auth: string | null;
  range: string | null;
}
interface Google {
  calls: Call[];
  drive: Call[];
  tokens: number;
  /** the scope asked for in each sign-in */
  scopes: string[];
}

/** Send every call the Worker makes for "Google" to the dev Worker itself (that is what the dev server does), and note what was asked. */
function googleIsStoodIn(tamper?: (call: Call, n: number) => Response | undefined): Google {
  const g: Google = { calls: [], drive: [], tokens: 0, scopes: [] };
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(STAND_IN)) return real(input as never, init);
    const headers = new Headers(init?.headers);
    const call: Call = { url, method: init?.method ?? "GET", auth: headers.get("authorization"), range: headers.get("range") };
    g.calls.push(call);
    if (url.includes("/token")) {
      g.tokens++;
      const note = new URLSearchParams(String(init?.body ?? "")).get("assertion") ?? "";
      try {
        g.scopes.push(String((JSON.parse(atob(note.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(note.split(".")[1]!.length / 4) * 4, "="))) as { scope?: string }).scope));
      } catch {
        g.scopes.push("?");
      }
    } else if (url.includes("/drive/v3/")) g.drive.push(call);
    const forced = tamper?.(call, g.calls.length);
    if (forced) return forced;
    const target = new URL(url);
    // a new visitor for every call (each has its own address), so the stand-in never meets the per-address limit of the API
    return new Client().fetch(`${target.pathname}${target.search}`, { method: init?.method, body: init?.body as BodyInit, headers: init?.headers });
  }) as typeof fetch);
  return g;
}

const connected = <T>(fn: () => Promise<T>) => withEnv({ GOOGLE_SERVICE_ACCOUNT: KEY.file, GOOGLE_API_BASE: STAND_IN }, fn);

beforeEach(() => {
  forgetPass();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await env.KV.delete(DRIVE_LAST_KEY);
});

/* ------------------------------------------------------------------------------------------------ a class with videos in it */

let seq = 0;
interface LessonSpec {
  url?: string | null;
  type?: "external" | "text" | "video";
  preview?: boolean;
}
/** A published class (free, so a student can "buy" it with one call) with the given lessons in one module. */
async function makeClass(lessons: LessonSpec[], opts: { drip?: number; status?: string; price?: number } = {}) {
  const n = ++seq;
  const slug = `drive-test-${Date.now().toString(36)}-${n}`;
  const course = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `ড্রাইভ ক্লাস ${n}`, `Drive Class ${n}`, opts.price ?? 0, opts.status ?? "published")
    .run();
  const courseId = course.meta.last_row_id as number;
  const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort, drip_days) VALUES (?, 'মডিউল', 'Module', 1, ?)").bind(courseId, opts.drip ?? 0).run();
  const ids: number[] = [];
  let sort = 0;
  for (const l of lessons) {
    const r = await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, is_preview, sort) VALUES (?, ?, 'লেসন', ?, ?, ?, ?, ?)")
      .bind(courseId, mod.meta.last_row_id, `Lesson ${++sort}`, l.type ?? "external", l.url ?? null, l.preview ? 1 : 0, sort)
      .run();
    ids.push(r.meta.last_row_id as number);
  }
  return { courseId, slug, ids };
}

/** A student who owns the class. */
async function enrolled(courseId: number) {
  const s = await registerStudent();
  await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, source) VALUES (?, ?, 'admin')").bind(s.id, courseId).run();
  return s.client;
}

const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const errorCode = async (res: Response) => (await json(res)).error?.code;

/* ================================================================================================ reading a pasted link */

describe("the link the owner pastes", () => {
  const FILE = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  const file = (url: string) => expect(driveRef(url), url).toEqual({ kind: "file", id: FILE });

  it("finds the file in every shape a Drive link comes in", () => {
    file(`https://drive.google.com/file/d/${FILE}/view?usp=sharing`);
    file(`https://drive.google.com/file/d/${FILE}/view?usp=drivesdk`);
    file(`https://drive.google.com/file/d/${FILE}/preview`);
    file(`https://drive.google.com/file/d/${FILE}/edit`);
    file(`https://drive.google.com/file/d/${FILE}`);
    file(`https://drive.google.com/file/u/1/d/${FILE}/view`); // a link copied while signed in as a second account
    file(`https://drive.google.com/open?id=${FILE}`);
    file(`https://drive.google.com/uc?id=${FILE}`);
    file(`https://drive.google.com/uc?export=download&id=${FILE}`);
    file(`https://drive.usercontent.google.com/download?id=${FILE}&export=download&authuser=0`);
    file(`https://docs.google.com/file/d/${FILE}/edit`); // the old address
    file(`  https://drive.google.com/file/d/${FILE}/view  `); // with spaces around it
    file(`HTTPS://DRIVE.GOOGLE.COM/file/d/${FILE}/view`);
  });

  it("knows a folder, and a Google document, for what they are — neither is a video", () => {
    expect(driveRef(`https://drive.google.com/drive/folders/${FILE}?usp=sharing`)).toEqual({ kind: "folder" });
    expect(driveRef(`https://drive.google.com/drive/u/0/folders/${FILE}`)).toEqual({ kind: "folder" });
    expect(driveRef(`https://docs.google.com/document/d/${FILE}/edit`)).toEqual({ kind: "other" });
    expect(driveRef(`https://docs.google.com/spreadsheets/d/${FILE}/edit`)).toEqual({ kind: "other" });
    expect(driveRef(`https://docs.google.com/presentation/d/${FILE}/edit`)).toEqual({ kind: "other" });
    expect(driveRef("https://drive.google.com/drive/my-drive")).toEqual({ kind: "other" });
    expect(driveRef("https://drive.google.com/open?id=tooshort")).toEqual({ kind: "other" });
  });

  it("says nothing for an address that is not Google Drive — and never reads a file id out of someone else's address", () => {
    for (const bad of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://vimeo.com/123456789",
      "not a url",
      "",
      `http://drive.google.com/file/d/${FILE}/view`, // not https
      `https://evil.example/file/d/${FILE}/view`,
      `https://drive.google.com.evil.example/file/d/${FILE}/view`,
      `https://evil-drive.google.com.example/open?id=${FILE}`,
      `https://notdrive.google.com/file/d/${FILE}/view`,
      `https://google.com/file/d/${FILE}/view`,
      `javascript:alert(1)`,
    ]) {
      expect(driveRef(bad), bad).toBeNull();
    }
  });

  it("never takes a file id that is not plain letters, digits, - and _", () => {
    expect(driveRef(`https://drive.google.com/open?id=${FILE}/../../etc/passwd`)).toEqual({ kind: "other" });
    expect(driveRef(`https://drive.google.com/open?id=${FILE}%00x`)).toEqual({ kind: "other" });
    expect(driveRef(`https://drive.google.com/open?id=${"a".repeat(101)}`)).toEqual({ kind: "other" });
    expect(driveRef("https://drive.google.com/open?id=")).toEqual({ kind: "other" });
  });
});

describe("what a part-of-the-video request may be", () => {
  it("takes one range, in the three shapes a browser sends, and refuses everything else", () => {
    expect(parseRange(null)).toEqual({ ok: true, range: null });
    expect(parseRange("")).toEqual({ ok: true, range: null });
    expect(parseRange("bytes=0-")).toEqual({ ok: true, range: "bytes=0-" });
    expect(parseRange("bytes=0-99")).toEqual({ ok: true, range: "bytes=0-99" });
    expect(parseRange(" bytes=100-199 ")).toEqual({ ok: true, range: "bytes=100-199" });
    expect(parseRange("bytes=-500")).toEqual({ ok: true, range: "bytes=-500" });
    for (const bad of ["bytes=", "bytes=-", "bytes=5-2", "bytes=0-1,5-6", "items=0-5", "bytes=a-b", "bytes 0-5", "0-5", "bytes=0-5; evil"]) expect(parseRange(bad), bad).toEqual({ ok: false });
  });
});

describe("what a refusal from Drive means", () => {
  const cases: [number, string, DriveProblem][] = [
    [404, "notFound File not found: abc.", "no_access"],
    [403, "forbidden The caller does not have permission", "no_access"],
    [403, "insufficientFilePermissions The user does not have sufficient permissions for this file.", "no_access"],
    [403, "cannotDownloadFile The user does not have sufficient permissions to download this file.", "not_downloadable"],
    [403, "fileNotDownloadable Only files with binary content can be downloaded. Use Export with Docs Editors files.", "not_video"],
    [403, "downloadQuotaExceeded The download quota for this file has been exceeded.", "quota"],
    [403, "userRateLimitExceeded User Rate Limit Exceeded.", "quota"],
    [429, "Too many requests", "quota"],
    [403, "accessNotConfigured Google Drive API has not been used in project 123 before or it is disabled.", "api_disabled"],
    [403, "SERVICE_DISABLED", "api_disabled"],
    [401, "Invalid Credentials", "key_rejected"],
    [503, "backendError", "google_error"],
    [400, "badRequest", "other"],
  ];
  it.each(cases)("%s “%s” → %s", (status, said, problem) => {
    expect(classifyDrive(status, said)).toBe(problem);
  });
});

/* ================================================================================================ the same sign-in, for two kinds of access */

describe("signing in to Google for Drive", () => {
  it("asks for read-only Drive access (and the analytics note still asks for analytics only)", async () => {
    const parsed = parseServiceAccount(KEY.file);
    if (!parsed.ok) throw new Error("key");
    const claims = async (note: string) => JSON.parse(atob(note.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(note.split(".")[1]!.length / 4) * 4, "=")));
    expect((await claims(await signedNote(parsed.account, "https://x.test/token"))).scope).toBe("https://www.googleapis.com/auth/analytics.readonly");
    expect((await claims(await signedNote(parsed.account, "https://x.test/token", undefined, DRIVE_SCOPE))).scope).toBe("https://www.googleapis.com/auth/drive.readonly");
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.readonly");
  });

  it("keeps one pass for each kind of access: the same kind is signed for once, a different kind gets its own", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const a1 = await googleToken(env);
      const a2 = await googleToken(env);
      const d1 = await googleToken(env, DRIVE_SCOPE);
      const d2 = await googleToken(env, DRIVE_SCOPE);
      expect([a1, a2, d1, d2].every((r) => r.ok)).toBe(true);
      expect(g.tokens).toBe(2);
      expect(g.scopes).toEqual(["https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/drive.readonly"]);
      expect(a1.ok && d1.ok && a1.data !== d1.data).toBe(true); // the stand-in gives a different pass for each
    });
  });
});

/* ================================================================================================ looking at a file */

describe("what the website's account can see of a file", () => {
  it("reads its name, kind, size and whether it may be downloaded", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const r = await driveInfo(env, OK);
      expect(r).toEqual({ ok: true, data: { name: "Class 1 — dough.webm", mime: "video/webm", size: DEV_WEBM.length, can_download: true } });
      expect(g.drive).toHaveLength(1);
      expect(g.drive[0].url).toContain(`/drive/v3/files/${OK}?`);
      expect(g.drive[0].url).toContain("supportsAllDrives=true"); // files in a shared drive too
      expect(g.drive[0].auth).toBe("Bearer dev-drive-pass");
    });
  });

  it("says which of the ways it can fail it was", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const problem = async (file: string) => {
        const r = await driveCheck(env, viewUrl(file));
        return r.ok ? "ok" : r.problem;
      };
      expect(await problem(id("not_shared"))).toBe("no_access");
      expect(await problem(id("google_doc"))).toBe("not_video");
      expect(await problem(id("pdf_file"))).toBe("not_video");
      expect(await problem(id("download_off"))).toBe("not_downloadable");
      expect(await problem(id("api_off"))).toBe("api_disabled");
      expect(await problem(OK)).toBe("ok");
      // nothing to ask Google about
      const g = googleIsStoodIn();
      expect(await driveCheck(env, "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toMatchObject({ ok: false, problem: "folder" });
      expect(await driveCheck(env, "https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ ok: false, problem: "not_drive_file" });
      expect(await driveCheck(env, "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit")).toMatchObject({ ok: false, problem: "not_drive_file" });
      expect(g.calls).toHaveLength(0);
    });
  });

  it("tells a video that plays everywhere (MP4, WebM) from one that may not (MOV, MKV …)", async () => {
    await connected(async () => {
      googleIsStoodIn();
      expect(await driveCheck(env, viewUrl(OK))).toMatchObject({ ok: true, data: { playable: "likely", mime: "video/webm" } });
      expect(await driveCheck(env, viewUrl(id("video_mov")))).toMatchObject({ ok: true, data: { playable: "unsure", mime: "video/quicktime" } });
    });
  });

  it("with no key, or a key that is not one, never calls Google", async () => {
    const g = googleIsStoodIn();
    await withEnv({ GOOGLE_SERVICE_ACCOUNT: undefined, GOOGLE_API_BASE: STAND_IN }, async () => {
      expect(await driveCheck(env, viewUrl(OK))).toMatchObject({ ok: false, problem: "not_configured" });
      expect(await driveReadable(env, OK)).toBe(false);
    });
    await withEnv({ GOOGLE_SERVICE_ACCOUNT: "this is not a key file", GOOGLE_API_BASE: STAND_IN }, async () => {
      expect(await driveCheck(env, viewUrl(OK))).toMatchObject({ ok: false, problem: "key_invalid" });
    });
    expect(g.calls).toHaveLength(0);
  });

  it("signs in again, once, when Google no longer accepts the pass it was given", async () => {
    await connected(async () => {
      let first = true;
      const g = googleIsStoodIn((call) => {
        if (call.url.includes("/drive/v3/") && first) {
          first = false;
          return new Response(JSON.stringify({ error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
      });
      expect((await driveInfo(env, OK)).ok).toBe(true);
      expect(g.tokens).toBe(2);
      expect(g.drive).toHaveLength(2);
    });
  });

  it("a network failure is said as one, and never thrown", async () => {
    await connected(async () => {
      googleIsStoodIn((call) => {
        if (call.url.includes("/drive/v3/")) throw new TypeError("Network connection lost.");
      });
      expect(await driveInfo(env, OK)).toEqual({ ok: false, problem: "network", detail: "Network connection lost." });
    });
  });
});

/* ================================================================================================ "can the account play it?" — remembered */

describe("whether the lesson page may offer “play it here”", () => {
  it("says yes for a video the account can read, and remembers it (a few minutes) without asking again", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const file = id("video_ok", 71);
      expect(await driveReadable(env, file)).toBe(true);
      expect(await driveReadable(env, file)).toBe(true);
      expect(g.drive).toHaveLength(1);
      expect(await env.KV.get(`drive:readable:${file}`)).toBe("1");
    });
  });

  it("says no for what cannot be played, remembers that for a short while, and the owner's check makes it ask again at once", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      for (const kind of ["not_shared", "google_doc", "pdf_file", "download_off"]) {
        const file = id(kind, 72);
        expect(await driveReadable(env, file), kind).toBe(false);
        expect(await driveReadable(env, file), kind).toBe(false);
        expect(await env.KV.get(`drive:readable:${file}`), kind).toBe("0");
      }
      expect(g.drive).toHaveLength(4); // one look each, not two
    });
  });

  it("does not remember a problem that is Google's or the network's — the next look asks again", async () => {
    await connected(async () => {
      let down = true;
      const g = googleIsStoodIn((call) => (call.url.includes("/drive/v3/") && down ? new Response("down", { status: 503 }) : undefined));
      const file = id("video_ok", 73);
      expect(await driveReadable(env, file)).toBe(false);
      expect(await env.KV.get(`drive:readable:${file}`)).toBeNull();
      down = false;
      expect(await driveReadable(env, file)).toBe(true);
      expect(g.drive).toHaveLength(2);
    });
  });
});

/* ================================================================================================ the video, for the student's player */

describe("the video, for a student who owns the class", () => {
  it("starts at once: the whole file, as a video, never kept by a cache, with the file’s own address nowhere", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK) }]);
      const student = await enrolled(cls.courseId);
      const res = await student.get(`/api/student/lessons/${cls.ids[0]}/media`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("video/webm");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(res.headers.get("content-length")).toBe(String(DEV_WEBM.length));
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-disposition")).toBe("inline");
      // an API answer carries the closed-door policy: even if a page were handed on, it could do nothing
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(sameBytes(await bytesOf(res), DEV_WEBM)).toBe(true);
      // Google was asked for the file with the read-only pass and nothing else
      const media = g.drive.find((c) => c.url.includes("alt=media"))!;
      expect(media.url).toContain(`/drive/v3/files/${OK}?alt=media&supportsAllDrives=true`);
      expect(media.auth).toBe("Bearer dev-drive-pass");
      expect(media.range).toBeNull();
      expect(g.scopes).toEqual(["https://www.googleapis.com/auth/drive.readonly"]);
    });
  });

  it("can be skipped through: the part asked for comes back as a part, and Google is asked for the same part", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK) }]);
      const student = await enrolled(cls.courseId);
      const url = `/api/student/lessons/${cls.ids[0]}/media`;
      const total = DEV_WEBM.length;

      const first = await student.fetch(url, { headers: { Range: "bytes=0-99" } });
      expect(first.status).toBe(206);
      expect(first.headers.get("content-range")).toBe(`bytes 0-99/${total}`);
      expect(first.headers.get("content-length")).toBe("100");
      expect(sameBytes(await bytesOf(first), DEV_WEBM.slice(0, 100))).toBe(true);

      const rest = await student.fetch(url, { headers: { Range: "bytes=2000-" } });
      expect(rest.status).toBe(206);
      expect(rest.headers.get("content-range")).toBe(`bytes 2000-${total - 1}/${total}`);
      expect(sameBytes(await bytesOf(rest), DEV_WEBM.slice(2000))).toBe(true);

      const tail = await student.fetch(url, { headers: { Range: "bytes=-155" } });
      expect(tail.status).toBe(206);
      expect(sameBytes(await bytesOf(tail), DEV_WEBM.slice(total - 155))).toBe(true);

      expect(g.drive.filter((c) => c.url.includes("alt=media")).map((c) => c.range)).toEqual(["bytes=0-99", "bytes=2000-", "bytes=-155"]);
    });
  });

  it("answers a start beyond the end as Google does (416), and an odd request without troubling Google at all", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK) }]);
      const student = await enrolled(cls.courseId);
      const url = `/api/student/lessons/${cls.ids[0]}/media`;
      const beyond = await student.fetch(url, { headers: { Range: "bytes=99999-" } });
      expect(beyond.status).toBe(416);
      expect(beyond.headers.get("content-range")).toBe(`bytes */${DEV_WEBM.length}`);
      const asked = g.drive.length;
      for (const bad of ["bytes=5-2", "bytes=0-1,5-6", "items=0-5", "bytes=a-b"]) {
        const res = await student.fetch(url, { headers: { Range: bad } });
        expect(res.status, bad).toBe(416);
      }
      expect(g.drive.length).toBe(asked);
    });
  });

  it("serves the file the owner put in the lesson — never one the student names", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK) }]);
      const student = await enrolled(cls.courseId);
      const res = await student.get(`/api/student/lessons/${cls.ids[0]}/media?id=${id("pdf_file")}&file=${id("not_shared")}&url=${encodeURIComponent(viewUrl(id("google_doc")))}`);
      expect(res.status).toBe(200);
      expect(sameBytes(await bytesOf(res), DEV_WEBM)).toBe(true);
      expect(g.drive.every((c) => c.url.includes(`/files/${OK}?`))).toBe(true);
    });
  });

  it("hands on audio too, and a file whose type Drive does not know as a video (an unlabelled upload)", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(id("video_octet")) }]);
      const student = await enrolled(cls.courseId);
      const res = await student.get(`/api/student/lessons/${cls.ids[0]}/media`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("video/mp4");
    });
  });
});

describe("who may watch", () => {
  it("only a student who owns the class: a stranger is turned away, a student of another class is too, and Google is not asked for either", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK) }], { price: 500 }); // a paid class nobody has bought
      const url = `/api/student/lessons/${cls.ids[0]}/media`;
      expect((await new Client().get(url)).status).toBe(401);
      const { client: other } = await registerStudent();
      const denied = await other.get(url);
      expect(denied.status).toBe(403);
      expect(await errorCode(denied)).toBe("not_enrolled");
      expect(g.drive).toHaveLength(0);
    });
  });

  it("not before the module opens (drip), and not after the enrolment was taken away", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK) }], { drip: 7 });
      const student = await enrolled(cls.courseId);
      const locked = await student.get(`/api/student/lessons/${cls.ids[0]}/media`);
      expect(locked.status).toBe(403);
      expect(await errorCode(locked)).toBe("lesson_locked");

      const open = await makeClass([{ url: viewUrl(OK) }]);
      const s2 = await enrolled(open.courseId);
      expect((await s2.get(`/api/student/lessons/${open.ids[0]}/media`)).status).toBe(200);
      await env.DB.prepare("UPDATE enrollments SET status = 'revoked' WHERE course_id = ?").bind(open.courseId).run();
      expect((await s2.get(`/api/student/lessons/${open.ids[0]}/media`)).status).toBe(403);
    });
  });

  it("only a lesson that holds a Drive video: a YouTube link, a note, an empty lesson and one that is not there are all 404", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const cls = await makeClass([
        { url: "https://youtu.be/dQw4w9WgXcQ" },
        { type: "text", url: null },
        { url: null },
        { url: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
        { url: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit" },
      ]);
      const student = await enrolled(cls.courseId);
      for (const lessonId of [...cls.ids, 99999999]) expect((await student.get(`/api/student/lessons/${lessonId}/media`)).status, String(lessonId)).toBe(404);
      expect((await student.get("/api/student/lessons/abc/media")).status).toBe(404);
      expect(g.drive).toHaveLength(0);
    });
  });

  it("a class that was deleted plays nothing", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK) }]);
      const student = await enrolled(cls.courseId);
      await env.DB.prepare("UPDATE courses SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").bind(cls.courseId).run();
      expect((await student.get(`/api/student/lessons/${cls.ids[0]}/media`)).status).toBe(404);
    });
  });

  it("a free preview plays for anyone — a lesson that is not a preview does not, and neither does a preview of a class that is not on sale", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK), preview: true }, { url: viewUrl(OK) }], { price: 500 });
      const visitor = new Client();
      const ok = await visitor.get(`/api/preview/lessons/${cls.ids[0]}/media`);
      expect(ok.status).toBe(200);
      expect(sameBytes(await bytesOf(ok), DEV_WEBM)).toBe(true);
      expect((await visitor.fetch(`/api/preview/lessons/${cls.ids[0]}/media`, { headers: { Range: "bytes=0-9" } })).status).toBe(206);

      expect((await visitor.get(`/api/preview/lessons/${cls.ids[1]}/media`)).status).toBe(401);
      const { client: signedIn } = await registerStudent();
      expect((await signedIn.get(`/api/preview/lessons/${cls.ids[1]}/media`)).status).toBe(403);

      const draft = await makeClass([{ url: viewUrl(OK), preview: true }], { status: "draft" });
      expect((await visitor.get(`/api/preview/lessons/${draft.ids[0]}/media`)).status).toBe(401);
      expect(g.drive.filter((c) => c.url.includes("alt=media")).length).toBe(2);
    });
  });
});

describe("when the video cannot be fetched", () => {
  const code = async (file: string) => {
    const cls = await makeClass([{ url: viewUrl(file) }]);
    const student = await enrolled(cls.courseId);
    const res = await student.get(`/api/student/lessons/${cls.ids[0]}/media`);
    return { res, text: await res.clone().text(), status: res.status };
  };

  it("a file that was not shared, a document, a file that may not be downloaded — 404; Google’s quota or API trouble — 503; and none of Google’s words reach the student", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const answers = {
        not_shared: await code(id("not_shared")),
        google_doc: await code(id("google_doc")),
        download_off: await code(id("download_off")),
        quota_video: await code(id("quota_video")),
        api_off: await code(id("api_off")),
      };
      expect(Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.status]))).toEqual({ not_shared: 404, google_doc: 404, download_off: 404, quota_video: 503, api_off: 503 });
      for (const [k, v] of Object.entries(answers)) {
        expect(JSON.parse(v.text).error.code, k).toBe("video_unavailable");
        expect(v.text, k).not.toMatch(/quota|drive|google|permission|project|dev-drive-pass|private/i);
      }
    });
  });

  it("a file that says it is a video and is a web page (or a PDF) is never handed on", async () => {
    await connected(async () => {
      googleIsStoodIn();
      for (const kind of ["html_file", "pdf_file"]) {
        const { res, text, status } = await code(id(kind));
        expect(status, kind).toBe(404);
        expect(res.headers.get("content-type"), kind).not.toMatch(/html|pdf/);
        expect(text, kind).not.toMatch(/<script|%PDF|not a video/);
      }
    });
  });

  it("is noted for the owner (what went wrong, when) — once a minute at most — without the file or the student", async () => {
    await connected(async () => {
      googleIsStoodIn();
      await code(id("quota_video"));
      const first = await env.KV.get<{ at: string; problem: string; status: number }>(DRIVE_LAST_KEY, "json");
      expect(first).toMatchObject({ problem: "quota", status: 403 });
      expect(JSON.stringify(first)).not.toMatch(/DEV_|student|lesson/i);
      await code(id("quota_video", 2));
      expect((await env.KV.get<{ at: string }>(DRIVE_LAST_KEY, "json"))!.at).toBe(first!.at); // the same problem again within a minute: not written again
      await code(id("api_off"));
      expect((await env.KV.get<{ problem: string }>(DRIVE_LAST_KEY, "json"))!.problem).toBe("api_disabled");
    });
  });

  it("with no key on the website: 503, and Google is not asked", async () => {
    const g = googleIsStoodIn();
    await withEnv({ GOOGLE_SERVICE_ACCOUNT: undefined, GOOGLE_API_BASE: STAND_IN }, async () => {
      const cls = await makeClass([{ url: viewUrl(OK) }]);
      const student = await enrolled(cls.courseId);
      const res = await student.get(`/api/student/lessons/${cls.ids[0]}/media`);
      expect(res.status).toBe(503);
      expect(await errorCode(res)).toBe("video_unavailable");
    });
    expect(g.calls).toHaveLength(0);
  });

  it("signs in again, once, when Google no longer accepts the pass, and the student never notices", async () => {
    await connected(async () => {
      let first = true;
      const g = googleIsStoodIn((call) => {
        if (call.url.includes("alt=media") && first) {
          first = false;
          return new Response(JSON.stringify({ error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } }), { status: 401 });
        }
      });
      const cls = await makeClass([{ url: viewUrl(OK) }]);
      const student = await enrolled(cls.courseId);
      const res = await student.get(`/api/student/lessons/${cls.ids[0]}/media`);
      expect(res.status).toBe(200);
      expect(sameBytes(await bytesOf(res), DEV_WEBM)).toBe(true);
      expect(g.tokens).toBe(2);
    });
  });

  it("never lets the key, the pass or the private key out in an answer or a header", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const key = (JSON.parse(KEY.file) as { private_key: string }).private_key;
      const body = key.split("\n")[1]!;
      for (const file of [OK, id("not_shared"), id("quota_video"), id("api_off")]) {
        const cls = await makeClass([{ url: viewUrl(file) }]);
        const student = await enrolled(cls.courseId);
        const res = await student.get(`/api/student/lessons/${cls.ids[0]}/media`);
        const everything = `${[...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${new TextDecoder("latin1").decode(await bytesOf(res))}`;
        expect(everything).not.toContain(body);
        expect(everything).not.toContain("dev-drive-pass");
        expect(everything).not.toContain(KEY.email);
      }
    });
  });
});

/**
 * The rate limiter counts per clock minute (Miniflare's windows, like Cloudflare's, are aligned to the wall clock): a burst that runs across the
 * turn of a minute is counted in two windows, and its last request is not refused. A burst here takes about two seconds, so it starts only with
 * time to spare in the current minute — otherwise it waits for the next one (well inside the test's time limit).
 */
async function roomInThisMinute(needMs = 8_000) {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < needMs) await new Promise((r) => setTimeout(r, left + 100));
}

describe("limits", () => {
  it("a playing video asks many times: it has a limit of its own, apart from the rest of the API (which it does not use up)", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK) }]);
      const student = await enrolled(cls.courseId);
      const url = `/api/student/lessons/${cls.ids[0]}/media`;
      let refused = 0;
      let served = 0;
      await roomInThisMinute();
      for (let i = 0; i < 125; i++) {
        const res = await student.fetch(url, { headers: { Range: "bytes=0-9" } });
        if (res.status === 429) refused++;
        else if (res.status === 206) served++;
        await res.arrayBuffer();
      }
      expect(served).toBe(120);
      expect(refused).toBe(5);
      // the rest of the API was not touched by all that
      expect((await student.get("/api/student/courses")).status).toBe(200);
    });
  });

  it("and the rest of the API does not use up the video's", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK) }]);
      const student = await enrolled(cls.courseId);
      await roomInThisMinute();
      for (let i = 0; i < 125; i++) await (await student.get("/api/student/courses")).arrayBuffer();
      expect((await student.get("/api/student/courses")).status).toBe(429); // the ordinary limit is still the ordinary limit
      const res = await student.fetch(`/api/student/lessons/${cls.ids[0]}/media`, { headers: { Range: "bytes=0-9" } });
      expect(res.status).toBe(206);
    });
  });
});

/* ================================================================================================ the lesson page */

describe("what the lesson page offers", () => {
  const lessonOf = async (client: Client, lessonId: number, path = "student") => (await json(await client.get(`/api/${path}/lessons/${lessonId}`))).lesson;

  it("“play it here” for a Drive video the account can read — and the file’s own address nowhere in the page", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK) }]);
      const student = await enrolled(cls.courseId);
      const raw = await (await student.get(`/api/student/lessons/${cls.ids[0]}`)).text();
      const lesson = JSON.parse(raw).lesson;
      expect(lesson.external).toEqual({ url: "", embed_url: null, media_url: `/api/student/lessons/${cls.ids[0]}/media`, pending: false });
      expect(raw).not.toContain(OK);
      expect(raw).not.toContain("drive.google.com");
    });
  });

  it("never a link to Drive when the account cannot play it — not shared, a document, no download, a folder, no key: “being prepared” instead, and the owner is told why", async () => {
    const pending = { url: "", embed_url: null, media_url: null, pending: true };
    await connected(async () => {
      googleIsStoodIn();
      for (const [kind, problem] of [
        ["not_shared", "no_access"],
        ["google_doc", "not_video"],
        ["pdf_file", "not_video"],
        ["download_off", "not_downloadable"],
      ] as const) {
        const url = viewUrl(id(kind));
        const cls = await makeClass([{ url }]);
        const student = await enrolled(cls.courseId);
        await env.KV.delete(DRIVE_LAST_KEY);
        const raw = await (await student.get(`/api/student/lessons/${cls.ids[0]}`)).text();
        expect(JSON.parse(raw).lesson.external, kind).toEqual(pending);
        // nothing of the owner's Drive reaches the student: not the address, not the file's id
        expect(raw, kind).not.toContain("drive.google.com");
        expect(raw, kind).not.toContain(id(kind));
        // the lesson editor's "last time" line says why
        expect((await env.KV.get<{ problem: string }>(DRIVE_LAST_KEY, "json"))?.problem, kind).toBe(problem);
      }
      // a folder link is not a video either
      const folder = await makeClass([{ url: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345" }]);
      const s2 = await enrolled(folder.courseId);
      expect((await lessonOf(s2, folder.ids[0])).external).toEqual(pending);
    });
    const cls = await makeClass([{ url: viewUrl(OK) }]);
    const student = await enrolled(cls.courseId);
    await withEnv({ GOOGLE_SERVICE_ACCOUNT: undefined }, async () => {
      await env.KV.delete(DRIVE_LAST_KEY);
      expect((await lessonOf(student, cls.ids[0])).external).toEqual(pending);
      expect((await env.KV.get<{ problem: string }>(DRIVE_LAST_KEY, "json"))?.problem).toBe("not_configured");
    });
  });

  it("YouTube, Vimeo, other websites and Google Docs links are exactly what they were", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const doc = "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit";
      const cls = await makeClass([{ url: "https://youtu.be/dQw4w9WgXcQ" }, { url: "https://vimeo.com/123456789" }, { url: "https://example.com/recipe" }, { url: doc }]);
      const student = await enrolled(cls.courseId);
      expect((await lessonOf(student, cls.ids[0])).external).toEqual({ url: "https://youtu.be/dQw4w9WgXcQ", embed_url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", media_url: null, pending: false });
      expect((await lessonOf(student, cls.ids[1])).external).toMatchObject({ embed_url: "https://player.vimeo.com/video/123456789", media_url: null, pending: false });
      expect((await lessonOf(student, cls.ids[2])).external).toEqual({ url: "https://example.com/recipe", embed_url: null, media_url: null, pending: false });
      // a Google Doc is a page to read, not a Drive video: still a link (the owner shares it the way they want)
      expect((await lessonOf(student, cls.ids[3])).external).toEqual({ url: doc, embed_url: null, media_url: null, pending: false });
      expect(g.calls).toHaveLength(0);
    });
  });

  it("a free preview points at the preview address, which a visitor may use", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(OK), preview: true }], { price: 500 });
      const visitor = new Client();
      const lesson = await lessonOf(visitor, cls.ids[0], "preview");
      expect(lesson.external.media_url).toBe(`/api/preview/lessons/${cls.ids[0]}/media`);
      expect((await visitor.get(lesson.external.media_url)).status).toBe(200);
    });
  });

  it("asks Google once for a few minutes, not for every page that opens; the owner’s check makes it look again at once", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const cls = await makeClass([{ url: viewUrl(id("not_shared", 81)) }]);
      const student = await enrolled(cls.courseId);
      const staff = (await loginStaff("super_admin")).client;
      for (let i = 0; i < 3; i++) await lessonOf(student, cls.ids[0]);
      expect(g.drive).toHaveLength(1);
      // the owner shares the file (here: the stand-in is told it is now a shared video by changing the lesson to one), then presses “Check access”
      await env.DB.prepare("UPDATE lessons SET external_url = ? WHERE id = ?").bind(viewUrl(OK), cls.ids[0]).run();
      expect((await lessonOf(student, cls.ids[0])).external.media_url).toBe(`/api/student/lessons/${cls.ids[0]}/media`);
      // the same file, remembered as “no”, forgotten by the check
      await env.KV.put(`drive:readable:${id("video_ok", 82)}`, "0", { expirationTtl: 60 });
      await env.DB.prepare("UPDATE lessons SET external_url = ? WHERE id = ?").bind(viewUrl(id("video_ok", 82)), cls.ids[0]).run();
      expect((await lessonOf(student, cls.ids[0])).external.media_url).toBeNull();
      expect((await staff.post("/api/admin/drive/check", { url: viewUrl(id("video_ok", 82)) })).status).toBe(200);
      expect((await lessonOf(student, cls.ids[0])).external.media_url).toBe(`/api/student/lessons/${cls.ids[0]}/media`);
    });
  });
});

/* ================================================================================================ the owner's screen */

describe("Admin → the lesson editor: which address to share with, and “Check access”", () => {
  const owner = async () => (await loginStaff("super_admin")).client;

  it("says whether the website has a Google key and which address a video is shared with — never the key", async () => {
    await connected(async () => {
      const admin = await owner();
      const res = await admin.get("/api/admin/drive");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ ok: true, configured: true, email: KEY.email, last: null });
      expect(text).not.toContain("PRIVATE KEY");
      expect(text).not.toContain((JSON.parse(KEY.file) as { private_key: string }).private_key.split("\n")[1]!);
    });
    await withEnv({ GOOGLE_SERVICE_ACCOUNT: undefined }, async () => {
      expect(await json(await (await owner()).get("/api/admin/drive"))).toEqual({ ok: true, configured: false, email: null, last: null });
    });
  });

  it("shows the last time a student’s video could not be fetched", async () => {
    await connected(async () => {
      await env.KV.put(DRIVE_LAST_KEY, JSON.stringify({ at: "2026-10-16T10:00:00.000Z", problem: "quota", status: 403 }));
      expect((await json(await (await owner()).get("/api/admin/drive"))).last).toEqual({ at: "2026-10-16T10:00:00.000Z", problem: "quota", status: 403 });
    });
  });

  it("“Check access”: a video that is ready says what it found", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const res = await (await owner()).post("/api/admin/drive/check", { url: viewUrl(OK) });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ ok: true, ready: true, name: "Class 1 — dough.webm", mime: "video/webm", size: DEV_WEBM.length, can_download: true, playable: "likely", email: KEY.email });
    });
  });

  it("explains each way it can fail, with Google’s words, and the address to share with — as an answer the screen can show (never an error)", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const admin = await owner();
      const check = async (url: string) => {
        const res = await admin.post("/api/admin/drive/check", { url });
        expect(res.status, url).toBe(200);
        return json(res);
      };
      expect(await check(viewUrl(id("not_shared")))).toMatchObject({ ok: true, ready: false, problem: "no_access", detail: expect.stringContaining("notFound"), status: 404, email: KEY.email });
      expect(await check(viewUrl(id("google_doc")))).toMatchObject({ ready: false, problem: "not_video" });
      expect(await check(viewUrl(id("download_off")))).toMatchObject({ ready: false, problem: "not_downloadable" });
      expect(await check(viewUrl(id("api_off")))).toMatchObject({ ready: false, problem: "api_disabled" });
      expect(await check("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toMatchObject({ ready: false, problem: "folder" });
      expect(await check("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ ready: false, problem: "not_drive_file" });
      expect(await check(viewUrl(id("video_mov")))).toMatchObject({ ready: true, playable: "unsure" });
    });
    await withEnv({ GOOGLE_SERVICE_ACCOUNT: undefined }, async () => {
      expect(await json(await (await owner()).post("/api/admin/drive/check", { url: viewUrl(OK) }))).toMatchObject({ ready: false, problem: "not_configured", email: null });
    });
  });

  it("asks for a link, and not for a book", async () => {
    await connected(async () => {
      const admin = await owner();
      const empty = await admin.post("/api/admin/drive/check", { url: "   " });
      expect(empty.status).toBe(422);
      expect((await json(empty)).error.fields.url).toBe("required");
      const long = await admin.post("/api/admin/drive/check", { url: `https://drive.google.com/${"a".repeat(2100)}` });
      expect(long.status).toBe(422);
      expect((await admin.post("/api/admin/drive/check", {})).status).toBe(422);
    });
  });

  it("a content manager may press it and read; support and a read-only viewer may read only; a stranger and a student may do neither", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      expect((await (await loginStaff("content_manager")).client.post("/api/admin/drive/check", { url: viewUrl(OK) })).status).toBe(200);
      for (const role of ["support", "viewer"] as const) {
        const client = (await loginStaff(role)).client;
        expect((await client.get("/api/admin/drive")).status, role).toBe(200);
        expect((await client.post("/api/admin/drive/check", { url: viewUrl(OK) })).status, role).toBe(403);
      }
      const stranger = new Client();
      expect((await stranger.get("/api/admin/drive")).status).toBe(401);
      expect((await stranger.post("/api/admin/drive/check", { url: viewUrl(OK) })).status).toBe(401);
      const { client: student } = await registerStudent();
      expect((await student.get("/api/admin/drive")).status).toBe(401);
      expect((await student.post("/api/admin/drive/check", { url: viewUrl(OK) })).status).toBe(401);
      expect(g.drive.length).toBe(1); // only the content manager's press reached Google
    });
  });

  it("leaves a mark in the activity log that a check happened and how it ended — never the link", async () => {
    await connected(async () => {
      googleIsStoodIn();
      const admin = await owner();
      await admin.post("/api/admin/drive/check", { url: viewUrl(id("not_shared", 91)) });
      const row = await env.DB.prepare("SELECT meta, summary FROM activity_log WHERE action = 'drive.checked' ORDER BY id DESC LIMIT 1").first<{ meta: string; summary: string }>();
      expect(row!.meta).toBe(JSON.stringify({ ready: false, problem: "no_access" }));
      expect(`${row!.meta}${row!.summary}`).not.toContain("DEV_");
    });
  });

  it("is a check, not a way to hammer Google: sixty an hour per person", async () => {
    await connected(async () => {
      const g = googleIsStoodIn();
      const { client, email } = await loginStaff("super_admin");
      const staff = await env.DB.prepare("SELECT id FROM staff WHERE email = ?").bind(email).first<{ id: number }>();
      await env.KV.put(`drivecheck:${staff!.id}:${Math.floor(Date.now() / 3_600_000)}`, "59", { expirationTtl: 300 });
      expect((await client.post("/api/admin/drive/check", { url: viewUrl(OK) })).status).toBe(200); // the sixtieth
      const refused = await client.post("/api/admin/drive/check", { url: viewUrl(OK) });
      expect(refused.status).toBe(429);
      expect(await errorCode(refused)).toBe("rate_limited");
      expect(g.drive).toHaveLength(1);
    });
  });
});

describe("the stand-in for Google Drive (development and tests only)", () => {
  it("answers 404 on the real site", async () => {
    await withEnv({ ENVIRONMENT: "production", SITE_URL: PUBLIC }, async () => {
      const res = await exports.default.fetch(new Request(`${PUBLIC}/api/dev/google/drive/v3/files/${OK}?alt=media`, { headers: { "cf-connecting-ip": "10.9.9.9", authorization: "Bearer dev-drive-pass" } }));
      expect(res.status).toBe(404);
    });
  });

  it("refuses a request without the pass, and points the Worker at itself only outside production", async () => {
    const stand = new Client();
    expect((await stand.get(`/api/dev/google/drive/v3/files/${OK}`)).status).toBe(401);
    const ok = await stand.fetch(`/api/dev/google/drive/v3/files/${OK}`, { headers: { authorization: "Bearer dev-drive-pass" } });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ id: OK, mimeType: "video/webm", capabilities: { canDownload: true } });
    // a Worker on the real site ignores GOOGLE_API_BASE: it talks to Google
    await withEnv({ ENVIRONMENT: "production", GOOGLE_API_BASE: "https://evil.example" }, async () => {
      expect(endpoints(env).drive).toBe("https://www.googleapis.com/drive/v3");
    });
  });
});
