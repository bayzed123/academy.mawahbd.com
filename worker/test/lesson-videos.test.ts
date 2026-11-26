import { beforeEach, describe, expect, it } from "vitest";
import { LESSON_VIDEO_PART_BYTES } from "@mawah/shared";
import { Client, env, firstCourse, json, loginStaff, registerStudent } from "./helpers";

/*
 * A lesson's video in the website's own storage (services/lessonVideos.ts): the owner's browser sends it in parts, R2 joins them, and the
 * lesson then plays it through the address students (website and Android app) already use — only for people who may watch the lesson,
 * the whole file or any part of it. Taking it off plays the lesson's link again; deleting the lesson deletes the video.
 */

const bytes = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const DRIVE = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view";

let owner: Client;
let courseId = 0;
let lessonId = 0;

async function newLesson(type: "video" | "external" | "text" = "external", over: Record<string, unknown> = {}) {
  let mod = await env.DB.prepare("SELECT id FROM modules WHERE course_id = ? ORDER BY id LIMIT 1").bind(courseId).first<{ id: number }>();
  if (!mod) mod = (await json(await owner.post(`/api/admin/courses/${courseId}/modules`, { title_bn: "পর্ব ১", title_en: "Part 1" }))).module as { id: number };
  const res = await owner.post(`/api/admin/courses/${courseId}/lessons`, { module_id: mod.id, title_bn: "ভিডিও", title_en: "Video", type, ...(type === "external" ? { external_url: DRIVE } : {}), ...over });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await json(res)).lesson.id as number;
}

/** Sends a video the way the admin's browser does: start, every part (exact lengths), finish. */
async function upload(id: number, data: Uint8Array, duration: number | null = 95) {
  const start = await owner.post(`/api/admin/lessons/${id}/video-uploads`, { size: data.length });
  expect(start.status, await start.clone().text()).toBe(201);
  const { upload_id, part_bytes, parts } = await json(start);
  const done: { n: number; etag: string }[] = [];
  for (let n = 1; n <= parts; n++) {
    const chunk = data.slice((n - 1) * part_bytes, Math.min(data.length, n * part_bytes));
    const res = await owner.fetch(`/api/admin/video-uploads/${encodeURIComponent(upload_id)}/parts/${n}`, { method: "PUT", body: chunk, headers: { "content-type": "application/octet-stream", "content-length": String(chunk.length) } });
    expect(res.status, await res.clone().text()).toBe(200);
    done.push({ n, etag: (await json(res)).etag });
  }
  const fin = await owner.post(`/api/admin/video-uploads/${encodeURIComponent(upload_id)}/complete`, { parts: done, duration_sec: duration });
  expect(fin.status, await fin.clone().text()).toBe(200);
  return json(fin);
}

async function enrolledStudent() {
  const s = await registerStudent();
  await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, source) VALUES (?, ?, 'admin')").bind(s.id, courseId).run();
  return s.client;
}

beforeEach(async () => {
  owner = (await loginStaff("super_admin")).client;
  courseId = (await firstCourse()).id;
  lessonId = await newLesson();
});

describe("the owner uploads a lesson's video to our storage", () => {
  it("in parts of a fixed size: the lesson then plays it, through the same address as before, with its length filled in", async () => {
    const data = bytes(LESSON_VIDEO_PART_BYTES + 12345);
    const done = await upload(lessonId, data);
    expect(done).toMatchObject({ lesson_id: lessonId, video_bytes: data.length });
    expect(done.video_key).toMatch(new RegExp(`^videos/lesson-${lessonId}/[A-Za-z0-9_-]+\\.mp4$`));
    const row = (await env.DB.prepare("SELECT video_key, video_bytes, duration_sec FROM lessons WHERE id = ?").bind(lessonId).first<{ video_key: string; video_bytes: number; duration_sec: number }>())!;
    expect(row.video_bytes).toBe(data.length);
    expect(row.duration_sec).toBe(95);
    expect((await env.R2.head(row.video_key))?.httpMetadata?.contentType).toBe("video/mp4");
    // nothing left open
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM video_uploads WHERE lesson_id = ?").bind(lessonId).first<{ n: number }>())!.n).toBe(0);

    const student = await enrolledStudent();
    const lesson = (await json(await student.get(`/api/student/lessons/${lessonId}`))).lesson;
    expect(lesson.video).toBeNull();
    expect(lesson.external).toEqual({ url: "", embed_url: null, media_url: `/api/student/lessons/${lessonId}/media?v=${row.video_key.split("/").pop()!.replace(".mp4", "")}`, pending: false });

    // the whole file
    const whole = await student.get(lesson.external.media_url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-length")).toBe(String(data.length));
    expect(sameBytes(new Uint8Array(await whole.arrayBuffer()), data)).toBe(true);
  });

  it("hands on exactly the part a player asks for — from the start, from the middle, the end — and refuses a part past the end", async () => {
    const data = bytes(4000);
    await upload(lessonId, data);
    const student = await enrolledStudent();
    const media = `/api/student/lessons/${lessonId}/media`;
    const part = async (range: string) => student.fetch(media, { headers: { range } });

    const a = await part("bytes=0-99");
    expect(a.status).toBe(206);
    expect(a.headers.get("content-range")).toBe("bytes 0-99/4000");
    expect(a.headers.get("content-length")).toBe("100");
    expect(sameBytes(new Uint8Array(await a.arrayBuffer()), data.slice(0, 100))).toBe(true);

    const b = await part("bytes=3990-");
    expect(b.headers.get("content-range")).toBe("bytes 3990-3999/4000");
    expect(sameBytes(new Uint8Array(await b.arrayBuffer()), data.slice(3990))).toBe(true);

    const c = await part("bytes=-10");
    expect(c.headers.get("content-range")).toBe("bytes 3990-3999/4000");

    const d = await part("bytes=3995-9999"); // runs past the end: cut at it
    expect(d.headers.get("content-range")).toBe("bytes 3995-3999/4000");
    expect((await d.arrayBuffer()).byteLength).toBe(5);

    const e = await part("bytes=4000-");
    expect(e.status).toBe(416);
    expect(e.headers.get("content-range")).toBe("bytes */4000");
    expect((await part("bytes=5-1")).status).toBe(416);
  });

  it("only for people who may watch the lesson: not a stranger, not a student of another class; a free preview plays for anyone", async () => {
    await upload(lessonId, bytes(3000));
    expect((await new Client().get(`/api/student/lessons/${lessonId}/media`)).status).toBe(401);
    const other = await registerStudent();
    expect((await other.client.get(`/api/student/lessons/${lessonId}/media`)).status).toBe(403);
    expect((await new Client().get(`/api/preview/lessons/${lessonId}/media`)).status).toBe(401);
    // a free preview of the class: the preview address plays it for anyone
    await env.DB.prepare("UPDATE lessons SET is_preview = 1 WHERE id = ?").bind(lessonId).run();
    const preview = (await json(await new Client().get(`/api/preview/lessons/${lessonId}`))).lesson;
    expect(preview.external.media_url).toMatch(new RegExp(`^/api/preview/lessons/${lessonId}/media\\?v=`));
    const res = await new Client().get(preview.external.media_url);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(3000);
  });

  it("a part of the wrong length, a part number out of range, or a finish with a part missing is refused, and nothing changes", async () => {
    const data = bytes(LESSON_VIDEO_PART_BYTES + 10);
    const start = await json(await owner.post(`/api/admin/lessons/${lessonId}/video-uploads`, { size: data.length }));
    expect(start.parts).toBe(2);
    const put = (n: number, chunk: Uint8Array) =>
      owner.fetch(`/api/admin/video-uploads/${encodeURIComponent(start.upload_id)}/parts/${n}`, { method: "PUT", body: chunk, headers: { "content-length": String(chunk.length) } });
    expect((await put(1, data.slice(0, 1000))).status).toBe(422); // cut short
    expect((await put(3, data.slice(0, 10))).status).toBe(422);
    const one = await json(await put(1, data.slice(0, LESSON_VIDEO_PART_BYTES)));
    const fin = await owner.post(`/api/admin/video-uploads/${encodeURIComponent(start.upload_id)}/complete`, { parts: [{ n: 1, etag: one.etag }] });
    expect(fin.status).toBe(422);
    expect((await env.DB.prepare("SELECT video_key FROM lessons WHERE id = ?").bind(lessonId).first<{ video_key: string | null }>())!.video_key).toBeNull();
    // cancelled: gone
    expect((await owner.del(`/api/admin/video-uploads/${encodeURIComponent(start.upload_id)}`)).status).toBe(200);
    expect((await owner.post(`/api/admin/video-uploads/${encodeURIComponent(start.upload_id)}/complete`, { parts: [{ n: 1, etag: one.etag }] })).status).toBe(404);
  });

  it("a text lesson takes no video, a video too big is refused, and only staff who edit classes may upload", async () => {
    const text = await newLesson("text");
    expect((await owner.post(`/api/admin/lessons/${text}/video-uploads`, { size: 1000 })).status).toBe(422);
    expect((await owner.post(`/api/admin/lessons/${lessonId}/video-uploads`, { size: 5 * 1024 ** 3 })).status).toBe(413);
    expect((await (await loginStaff("viewer")).client.post(`/api/admin/lessons/${lessonId}/video-uploads`, { size: 1000 })).status).toBe(403);
    expect((await new Client().post(`/api/admin/lessons/${lessonId}/video-uploads`, { size: 1000 })).status).toBe(401);
  });

  it("a new copy replaces the old one (deleted from storage, with a new address); taking it off plays the Drive link again", async () => {
    const first = await upload(lessonId, bytes(2000, 1));
    const second = await upload(lessonId, bytes(2500, 2));
    expect(second.video_key).not.toBe(first.video_key);
    expect(await env.R2.head(first.video_key)).toBeNull();
    expect((await env.R2.head(second.video_key))?.size).toBe(2500);
    // the minutes the owner set are kept
    await env.DB.prepare("UPDATE lessons SET duration_sec = 600 WHERE id = ?").bind(lessonId).run();
    await upload(lessonId, bytes(100, 3), 30);
    expect((await env.DB.prepare("SELECT duration_sec FROM lessons WHERE id = ?").bind(lessonId).first<{ duration_sec: number }>())!.duration_sec).toBe(600);

    const now = (await env.DB.prepare("SELECT video_key FROM lessons WHERE id = ?").bind(lessonId).first<{ video_key: string }>())!.video_key;
    expect((await owner.del(`/api/admin/lessons/${lessonId}/video`)).status).toBe(200);
    expect(await env.R2.head(now)).toBeNull();
    const student = await enrolledStudent();
    const lesson = (await json(await student.get(`/api/student/lessons/${lessonId}`))).lesson;
    expect(lesson.external.media_url ?? "").not.toContain("?v=");
  });

  it("the owner can watch the copy in the admin, and deleting the lesson deletes its video", async () => {
    const done = await upload(lessonId, bytes(1500));
    const res = await owner.fetch(`/api/admin/lessons/${lessonId}/video/media`, { headers: { range: "bytes=0-9" } });
    expect(res.status).toBe(206);
    expect((await owner.del(`/api/admin/lessons/${lessonId}`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(await env.R2.head(done.video_key)).toBeNull();
  });

  it("Video speed lists the Drive lessons and what our storage holds", async () => {
    await upload(lessonId, bytes(1234));
    const other = await newLesson();
    const res = await json(await owner.get("/api/admin/video-storage"));
    const mine = res.lessons.find((l: { id: number }) => l.id === lessonId);
    const theirs = res.lessons.find((l: { id: number }) => l.id === other);
    expect(mine).toMatchObject({ stored: true, video_bytes: 1234, drive_url: DRIVE });
    expect(theirs).toMatchObject({ stored: false, video_bytes: 0, drive_url: DRIVE });
    expect(res.bytes).toBeGreaterThanOrEqual(1234);
  });
});
