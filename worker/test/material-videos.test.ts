import { describe, expect, it } from "vitest";
import { LESSON_VIDEO_PART_BYTES } from "@mawah/shared";
import { Client, env, json, loginStaff, registerStudent } from "./helpers";

/*
 * A class material's video sent in parts (services/materialUploads.ts): a long recording is not held to the 95 MB one request carries —
 * the owner's 182 MB phone video went up this way. Once saved, an uploaded video is watched inside the class page (website and Android
 * app), from our storage, by enrolled students only — no longer offered as a download.
 */

const bytes = (s: string) => new TextEncoder().encode(s);
/** an MP4's first bytes ("ftyp" box), then filler: enough for the file check */
const mp4 = (size: number) => {
  const b = new Uint8Array(size);
  b.set([0, 0, 0, 0x18, ...bytes("ftypisom"), 0, 0, 2, 0, ...bytes("isomiso2")]);
  for (let i = 24; i < size; i++) b[i] = (i * 7) % 251;
  return b;
};

let seq = 0;
async function newClass() {
  const slug = `matvid-${Date.now().toString(36)}${++seq}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, long_bn, long_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, 'ভিডিও ক্লাস', ?, 'ছোট', 'Short', '', '', 400, 'published', 1, 1, '2026-01-01T00:00:00Z')`,
  )
    .bind(slug, `Video class ${slug}`)
    .run();
  return res.meta.last_row_id as number;
}

/** Sends a file the way the admin's browser does: start, every part (exact lengths), finish. */
async function sendInParts(admin: Client, courseId: number, name: string, data: Uint8Array) {
  const start = await admin.post("/api/admin/materials/video-uploads", { course_id: courseId, size: data.length, name });
  expect(start.status, await start.clone().text()).toBe(201);
  const { upload_id, part_bytes, parts } = await json(start);
  const done: { n: number; etag: string }[] = [];
  for (let n = 1; n <= parts; n++) {
    const chunk = data.slice((n - 1) * part_bytes, Math.min(data.length, n * part_bytes));
    const res = await admin.fetch(`/api/admin/material-uploads/${encodeURIComponent(upload_id)}/parts/${n}`, { method: "PUT", body: chunk, headers: { "content-type": "application/octet-stream", "content-length": String(chunk.length) } });
    expect(res.status, await res.clone().text()).toBe(200);
    done.push({ n, etag: (await json(res)).etag });
  }
  return { upload_id, finish: () => admin.post(`/api/admin/material-uploads/${encodeURIComponent(upload_id)}/complete`, { parts: done }) };
}

const base = { title_bn: "", title_en: "Full class recording", note_bn: "", note_en: "", url: "", platform: null, starts_at: null, duration_min: null, active: true, sort: 100 };

describe("a material's video bigger than one request can carry", () => {
  it("goes up in parts, is saved as the class's video, and enrolled students watch it in the class page (not a download)", async () => {
    const { client: admin } = await loginStaff("super_admin");
    const courseId = await newClass();
    const data = mp4(LESSON_VIDEO_PART_BYTES + 5000); // more than one part
    const up = await sendInParts(admin, courseId, "Brazilian Cloud Cake.mp4", data);
    const fin = await up.finish();
    expect(fin.status, await fin.clone().text()).toBe(201);
    const file = await json(fin);
    expect(file).toMatchObject({ filename: "Brazilian Cloud Cake.mp4", mime: "video/mp4", size_bytes: data.length });
    expect(file.key).toMatch(new RegExp(`^materials/${courseId}/[A-Za-z0-9_-]{16,64}$`));

    const saved = await admin.post("/api/admin/materials", { ...base, kind: "video", course_id: courseId, r2_key: file.key });
    expect(saved.status, await saved.clone().text()).toBe(201);
    const id = (await json(saved)).item.id as number;

    const s = await registerStudent(new Client());
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'purchase')").bind(s.id, courseId).run();
    const slug = (await env.DB.prepare("SELECT slug FROM courses WHERE id = ?").bind(courseId).first<{ slug: string }>())!.slug;
    const list = (await json(await s.client.get(`/api/student/courses/${slug}/materials`))).materials as { id: number; delivery: string; media_url: string | null }[];
    const mine = list.find((m) => m.id === id)!;
    expect(mine.delivery).toBe("play");
    expect(mine.media_url).toBe(`/api/student/materials/${id}/media?v=${file.key.split("/").pop()}`);
    // the Android app asks for the address when the student presses play
    expect((await json(await s.client.post(`/api/student/materials/${id}/play`))).media_url).toBe(mine.media_url);

    const part = await s.client.fetch(mine.media_url!, { headers: { range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-type")).toBe("video/mp4");
    expect(part.headers.get("content-range")).toBe(`bytes 0-99/${data.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(data.slice(0, 100));
    // not enrolled: nothing
    expect((await (await registerStudent(new Client())).client.get(mine.media_url!)).status).toBe(403);
  });

  it("only a video is kept: anything else sent in parts is refused and deleted", async () => {
    const { client: admin } = await loginStaff("super_admin");
    const courseId = await newClass();
    const up = await sendInParts(admin, courseId, "notes.mp4", bytes("%PDF-1.4\n" + "x".repeat(3000)));
    const fin = await up.finish();
    expect(fin.status).toBe(415);
    const keys = await env.R2.list({ prefix: `materials/${courseId}/` });
    expect(keys.objects).toHaveLength(0);
  });

  it("an upload is its starter's: someone else cannot add to it or finish it; too big, or a class that does not exist, is refused", async () => {
    const { client: admin } = await loginStaff("super_admin");
    const courseId = await newClass();
    const start = await json(await admin.post("/api/admin/materials/video-uploads", { course_id: courseId, size: 5000, name: "a.mp4" }));
    const other = (await loginStaff("super_admin")).client;
    const chunk = mp4(5000);
    expect((await other.fetch(`/api/admin/material-uploads/${encodeURIComponent(start.upload_id)}/parts/1`, { method: "PUT", body: chunk, headers: { "content-length": "5000" } })).status).toBe(404);
    expect((await admin.fetch(`/api/admin/material-uploads/${encodeURIComponent(start.upload_id)}/parts/1`, { method: "PUT", body: chunk.slice(0, 10), headers: { "content-length": "10" } })).status).toBe(422);
    expect((await admin.post("/api/admin/materials/video-uploads", { course_id: courseId, size: 5 * 1024 ** 3, name: "big.mp4" })).status).toBe(413);
    expect((await admin.post("/api/admin/materials/video-uploads", { course_id: 999999, size: 5000, name: "a.mp4" })).status).toBe(404);
    expect((await (await loginStaff("viewer")).client.post("/api/admin/materials/video-uploads", { course_id: courseId, size: 5000, name: "a.mp4" })).status).toBe(403);
    expect((await admin.del(`/api/admin/material-uploads/${encodeURIComponent(start.upload_id)}`)).status).toBe(200);
  });
});
