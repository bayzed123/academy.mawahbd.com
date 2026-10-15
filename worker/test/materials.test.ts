import { describe, expect, it } from "vitest";
import { sniffMaterial } from "../src/lib/files";
import { cleanupOrphanUploads, facebookUrl, uploadNoteKey } from "../src/services/materials";
import { Client, env, json, loginStaff, registerStudent } from "./helpers";

/*
 * Admin → Materials: what a class gives its students beyond the lessons (files, links, live classes, private groups).
 * What the owner cannot check by eye, and these tests protect:
 *  - only the right people can add things, and a file is judged by its own bytes (a web page or a program renamed .pdf is refused);
 *  - the details of a file (name, type, size) come from what the upload measured, never from the form;
 *  - a student sees materials only for a class they are enrolled in, never an address or a file key in the list;
 *  - the file comes out only through the enrolment-checked download (and never through the public /media route);
 *  - every download is recorded; a private group's link comes after the student has said who they are on Facebook;
 *  - the public class page says what is included (a count and the titles) and never gives a link away.
 */

const bytes = (s: string) => new TextEncoder().encode(s);
const PDF = bytes("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, ...bytes("ftypisom"), 0, 0, 2, 0, ...bytes("isomiso2")]);
const AVIF = new Uint8Array([0, 0, 0, 0x18, ...bytes("ftypavif"), 0, 0, 0, 0, ...bytes("avifmif1")]);
const HTML = bytes("<html><body><script>alert(1)</script></body></html>");
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8Dwn+E/w38AEAAB/wGJp5ySAAAAAElFTkSuQmCC"), (c) => c.charCodeAt(0));

let seq = 0;
async function newClass() {
  const slug = `mat-${Date.now().toString(36)}${++seq}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, long_bn, long_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, 'ম্যাটেরিয়াল ক্লাস', ?, 'ছোট', 'Short', '', '', 400, 'published', 1, 1, '2026-01-01T00:00:00Z')`,
  )
    .bind(slug, `Material class ${slug}`)
    .run();
  return { id: res.meta.last_row_id as number, slug };
}
async function enrolled(courseId: number, status: "active" | "revoked" = "active") {
  const s = await registerStudent(new Client(), { name: "Material Student" });
  await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, ?, 'purchase')").bind(s.id, courseId, status).run();
  return s;
}
const upload = (admin: Client, courseId: number | string, name: string, body: Uint8Array, headers: Record<string, string> = {}) =>
  admin.fetch(`/api/admin/materials/upload?course_id=${courseId}&name=${encodeURIComponent(name)}`, { method: "POST", body, headers: { "content-type": "application/octet-stream", ...headers } });
async function uploaded(admin: Client, courseId: number, name: string, body: Uint8Array) {
  const res = await upload(admin, courseId, name, body);
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return (await json(res)) as { key: string; filename: string; mime: string; size_bytes: number };
}
const base = { kind: "pdf", title_bn: "", title_en: "Recipe guide", note_bn: "", note_en: "", r2_key: null, url: "", platform: null, starts_at: null, duration_min: null, active: true, sort: 100 };
async function make(admin: Client, courseId: number, over: Record<string, unknown> = {}) {
  const res = await admin.post("/api/admin/materials", { ...base, course_id: courseId, ...over });
  if (res.status !== 201) throw new Error(`create material failed: ${res.status} ${await res.text()}`);
  return (await json(res)).item as Record<string, any>;
}
async function until<T>(fn: () => Promise<T | null | false>, ms = 1500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const owner = async () => (await loginStaff("super_admin")).client;
const r2Count = async (prefix: string) => (await env.R2.list({ prefix })).objects.length;

describe("who can add materials", () => {
  it("anonymous visitors and students get nothing; everyone on the team can look; only the owner and content managers can change", async () => {
    const { id } = await newClass();
    expect((await new Client().get("/api/admin/materials")).status).toBe(401);
    expect((await upload(new Client(), id, "a.pdf", PDF)).status).toBe(401);
    const student = await registerStudent();
    expect((await student.client.get("/api/admin/materials")).status).toBe(401);

    for (const role of ["support", "viewer"] as const) {
      const { client } = await loginStaff(role);
      expect((await client.get("/api/admin/materials")).status, role).toBe(200);
      expect((await client.get("/api/admin/group-requests")).status).toBe(200);
      expect((await client.get("/api/admin/material-downloads")).status).toBe(200);
      expect((await client.post("/api/admin/materials", { ...base, course_id: id, kind: "link", url: "https://example.com/a" })).status, role).toBe(403);
      expect((await upload(client, id, "a.pdf", PDF)).status, role).toBe(403);
    }
    const cm = (await loginStaff("content_manager")).client;
    expect((await cm.post("/api/admin/materials", { ...base, course_id: id, kind: "link", url: "https://example.com/a" })).status).toBe(201);
  });
});

describe("what counts as a file (judged by its own bytes)", () => {
  it("accepts PDF, ZIP, Office, EPUB and video — and gives the file its real extension", () => {
    expect(sniffMaterial(PDF, "x.pdf")).toEqual({ mime: "application/pdf", ext: "pdf" });
    expect(sniffMaterial(PDF, "renamed.exe")).toEqual({ mime: "application/pdf", ext: "pdf" });
    expect(sniffMaterial(ZIP, "pack.zip")).toEqual({ mime: "application/zip", ext: "zip" });
    expect(sniffMaterial(ZIP, "plan.docx")?.mime).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(sniffMaterial(ZIP, "book.epub")).toEqual({ mime: "application/epub+zip", ext: "epub" });
    expect(sniffMaterial(ZIP, "weird.exe")).toEqual({ mime: "application/zip", ext: "zip" });
    expect(sniffMaterial(MP4, "class.mp4")).toEqual({ mime: "video/mp4", ext: "mp4" });
    expect(sniffMaterial(MP4, "class.mov")).toEqual({ mime: "video/quicktime", ext: "mov" });
    expect(sniffMaterial(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]), "x.webm")?.mime).toBe("video/webm");
  });
  it("refuses web pages, programs, pictures and picture-in-a-video-box formats", () => {
    expect(sniffMaterial(HTML, "page.pdf")).toBeNull();
    expect(sniffMaterial(EXE, "setup.pdf")).toBeNull();
    expect(sniffMaterial(PNG, "photo.pdf")).toBeNull();
    expect(sniffMaterial(AVIF, "clip.mp4")).toBeNull(); // AVIF shares the video "ftyp" box
    expect(sniffMaterial(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"), "logo.svg")).toBeNull();
    expect(sniffMaterial(new Uint8Array([]), "empty.pdf")).toBeNull();
  });
});

describe("uploading", () => {
  it("stores a PDF in the private bucket and says what it measured, not what the browser claimed", async () => {
    const admin = await owner();
    const { id } = await newClass();
    const res = await upload(admin, id, "Biryani recipes", PDF, { "content-type": "text/html" });
    expect(res.status).toBe(201);
    const up = await json(res);
    expect(up).toMatchObject({ filename: "Biryani recipes.pdf", mime: "application/pdf", size_bytes: PDF.length });
    expect(up.key).toMatch(new RegExp(`^materials/${id}/[A-Za-z0-9_-]{16,}$`));
    const object = await env.R2.get(up.key);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(PDF);
    const row = await env.DB.prepare("SELECT action, summary FROM activity_log WHERE action = 'materials.uploaded' ORDER BY id DESC LIMIT 1").first<{ summary: string }>();
    expect(row?.summary).toBe("Biryani recipes.pdf");
  });

  it("a file announced by its length is streamed in the same way", async () => {
    const admin = await owner();
    const { id } = await newClass();
    const res = await upload(admin, id, "pack.zip", ZIP, { "content-length": String(ZIP.length) });
    expect(res.status).toBe(201);
    expect((await json(res)).mime).toBe("application/zip");
  });

  it("a web page or a program dressed as a PDF is refused, and nothing is left in the bucket", async () => {
    const admin = await owner();
    const { id } = await newClass();
    for (const [name, data] of [["page.pdf", HTML], ["setup.pdf", EXE], ["photo.pdf", PNG]] as const) {
      const res = await upload(admin, id, name, data);
      expect(res.status, name).toBe(415);
      expect((await json(res)).error.code).toBe("unsupported_file_type");
    }
    expect(await r2Count(`materials/${id}/`)).toBe(0);
  });

  it("an empty file, a missing class and a huge file are each refused plainly", async () => {
    const admin = await owner();
    const { id } = await newClass();
    expect((await upload(admin, id, "a.pdf", new Uint8Array([]))).status).toBe(400);
    expect((await upload(admin, 999999, "a.pdf", PDF)).status).toBe(404);
    expect((await admin.fetch("/api/admin/materials/upload?name=a.pdf", { method: "POST", body: PDF })).status).toBe(400);
    // a file that says it is over the limit is turned away before a byte is stored
    const huge = await upload(admin, id, "big.zip", ZIP, { "content-length": String(200 * 1024 * 1024) });
    expect([413, 400]).toContain(huge.status);
    expect(await r2Count(`materials/${id}/`)).toBe(0);
  });
});

describe("saving a material", () => {
  it("a file material takes its name, type and size from the upload — whatever the form says", async () => {
    const admin = await owner();
    const { id } = await newClass();
    const up = await uploaded(admin, id, "Masala guide.pdf", PDF);
    const item = await make(admin, id, { r2_key: up.key, filename: "evil.exe", mime: "text/html", size_bytes: 1 });
    expect(item).toMatchObject({ kind: "pdf", r2_key: up.key, filename: "Masala guide.pdf", mime: "application/pdf", size_bytes: PDF.length, url: null, ask_profile: 0 });
  });

  it("a key that was never uploaded, someone else's upload, another class's upload and the wrong kind of file are refused", async () => {
    const admin = await owner();
    const other = await owner();
    const a = await newClass();
    const b = await newClass();
    const forged = `materials/${a.id}/${"A".repeat(24)}`;
    const r1 = await admin.post("/api/admin/materials", { ...base, course_id: a.id, r2_key: forged });
    expect(r1.status).toBe(422);
    expect((await json(r1)).error.fields.r2_key).toBe("upload_expired");

    const mine = await uploaded(admin, a.id, "a.pdf", PDF);
    expect((await other.post("/api/admin/materials", { ...base, course_id: a.id, r2_key: mine.key })).status).toBe(422); // not their upload
    const forB = await admin.post("/api/admin/materials", { ...base, course_id: b.id, r2_key: mine.key });
    expect(forB.status).toBe(422); // uploaded for another class

    const wrong = await admin.post("/api/admin/materials", { ...base, course_id: a.id, kind: "zip", r2_key: mine.key });
    expect((await json(wrong)).error.fields.r2_key).toBe("wrong_file_type");
    const video = await uploaded(admin, a.id, "clip.mp4", MP4);
    expect((await admin.post("/api/admin/materials", { ...base, course_id: a.id, kind: "pdf", r2_key: video.key })).status).toBe(422);
    expect((await admin.post("/api/admin/materials", { ...base, course_id: a.id, kind: "video", r2_key: video.key })).status).toBe(201);
    expect((await admin.post("/api/admin/materials", { ...base, course_id: a.id, kind: "book", r2_key: (await uploaded(admin, a.id, "b.pdf", PDF)).key })).status).toBe(201);
    expect((await admin.post("/api/admin/materials", { ...base, course_id: a.id, kind: "zip", r2_key: (await uploaded(admin, a.id, "z.zip", ZIP)).key })).status).toBe(201);
  });

  it("a file or a link — not both, not neither — and a link must be a plain https address", async () => {
    const admin = await owner();
    const { id } = await newClass();
    const up = await uploaded(admin, id, "a.pdf", PDF);
    const both = await admin.post("/api/admin/materials", { ...base, course_id: id, r2_key: up.key, url: "https://drive.google.com/x" });
    expect((await json(both)).error.fields.url).toBe("choose_one");
    const none = await admin.post("/api/admin/materials", { ...base, course_id: id });
    expect((await json(none)).error.fields.r2_key).toBe("required");

    for (const url of ["http://example.com/a", "javascript:alert(1)", "data:text/html,x", "//example.com/a", "https://user:pw@example.com/a", "ftp://example.com/a", "example.com/a"]) {
      expect((await admin.post("/api/admin/materials", { ...base, course_id: id, kind: "link", url })).status, url).toBe(422);
    }
    const ok = await make(admin, id, { kind: "video", url: "https://www.youtube.com/watch?v=abc" });
    expect(ok).toMatchObject({ r2_key: null, filename: null, url: "https://www.youtube.com/watch?v=abc" });
  });

  it("a live class needs an address and a start time; a plain link needs an address", async () => {
    const admin = await owner();
    const { id } = await newClass();
    const noTime = await admin.post("/api/admin/materials", { ...base, course_id: id, kind: "live", url: "https://zoom.us/j/1", platform: "zoom" });
    expect((await json(noTime)).error.fields.starts_at).toBe("required");
    const badPlatform = await admin.post("/api/admin/materials", { ...base, course_id: id, kind: "live", url: "https://zoom.us/j/1", platform: "carrier-pigeon", starts_at: "2026-12-01T10:00:00Z" });
    expect(badPlatform.status).toBe(422);
    const live = await make(admin, id, { kind: "live", url: "https://zoom.us/j/1", platform: "zoom", starts_at: "2026-12-01T16:00:00+06:00", duration_min: 90 });
    expect(live).toMatchObject({ kind: "live", platform: "zoom", starts_at: "2026-12-01T10:00:00.000Z", duration_min: 90 });
    expect((await admin.post("/api/admin/materials", { ...base, course_id: id, kind: "link", url: "" })).status).toBe(422);
    const link = await make(admin, id, { kind: "link", url: "https://example.com/tools", starts_at: "2026-12-01T10:00:00Z", platform: "zoom", duration_min: 30 });
    expect(link).toMatchObject({ platform: null, starts_at: null, duration_min: null }); // things that do not belong to a link are dropped
  });

  it("a private group needs a group link on its own platform; a Facebook group always asks for the student's profile link", async () => {
    const admin = await owner();
    const { id } = await newClass();
    const bad = await admin.post("/api/admin/materials", { ...base, course_id: id, kind: "group", platform: "facebook", url: "https://example.com/groups/x" });
    expect((await json(bad)).error.fields.url).toBe("must_be_facebook");
    expect((await admin.post("/api/admin/materials", { ...base, course_id: id, kind: "group", platform: "facebook", url: "https://facebook.com/" })).status).toBe(422); // no group in it
    const fb = await make(admin, id, { kind: "group", platform: "facebook", url: "https://www.facebook.com/groups/mawah.bakers" });
    expect(fb).toMatchObject({ platform: "facebook", ask_profile: 1 });
    const wa = await make(admin, id, { kind: "group", platform: "whatsapp", url: "https://chat.whatsapp.com/AbCdEf" });
    expect(wa).toMatchObject({ platform: "whatsapp", ask_profile: 0 });
    expect((await admin.post("/api/admin/materials", { ...base, course_id: id, kind: "group", platform: "whatsapp", url: "https://www.facebook.com/groups/x" })).status).toBe(422);
    const tg = await make(admin, id, { kind: "group", platform: "telegram", url: "https://t.me/mawah_bakers" });
    expect(tg.ask_profile).toBe(0);
    expect((await admin.post("/api/admin/materials", { ...base, course_id: id, kind: "group", platform: "orkut", url: "https://example.com/x" })).status).toBe(422);
  });

  it("needs a title in at least one language and a class that exists", async () => {
    const admin = await owner();
    const { id } = await newClass();
    const noTitle = await admin.post("/api/admin/materials", { ...base, course_id: id, kind: "link", url: "https://example.com/a", title_en: "", title_bn: "" });
    expect((await json(noTitle)).error.fields.title_en).toBe("required");
    expect((await make(admin, id, { kind: "link", url: "https://example.com/a", title_en: "", title_bn: "শুধু বাংলা" })).title_bn).toBe("শুধু বাংলা");
    expect((await admin.post("/api/admin/materials", { ...base, course_id: 999999, kind: "link", url: "https://example.com/a" })).status).toBe(422);
  });

  it("replacing the file deletes the old one; switching to a link too; deleting keeps the file and Restore brings it back", async () => {
    const admin = await owner();
    const { id } = await newClass();
    const first = await uploaded(admin, id, "v1.pdf", PDF);
    const item = await make(admin, id, { r2_key: first.key });
    const second = await uploaded(admin, id, "v2.pdf", PDF);
    expect((await admin.patch(`/api/admin/materials/${item.id}`, { r2_key: second.key })).status).toBe(200);
    await until(async () => (await env.R2.head(first.key)) === null);
    expect(await env.R2.head(second.key)).not.toBeNull();
    expect(await env.KV.get(uploadNoteKey(second.key))).toBeNull(); // the note about a saved upload is no longer needed

    expect((await admin.patch(`/api/admin/materials/${item.id}`, { r2_key: null, url: "https://drive.google.com/file/d/1" })).status).toBe(200);
    await until(async () => (await env.R2.head(second.key)) === null);

    const kept = await uploaded(admin, id, "keep.pdf", PDF);
    const m2 = await make(admin, id, { r2_key: kept.key });
    expect((await admin.del(`/api/admin/materials/${m2.id}`)).status).toBe(200);
    expect((await json(await admin.get(`/api/admin/materials?course_id=${id}`))).items.map((x: any) => x.id)).not.toContain(m2.id);
    expect((await json(await admin.get(`/api/admin/materials?course_id=${id}&deleted=1`))).items.map((x: any) => x.id)).toContain(m2.id);
    expect(await env.R2.head(kept.key)).not.toBeNull(); // the file is kept while it is in the trash
    expect((await admin.post(`/api/admin/materials/${m2.id}/restore`)).status).toBe(200);
  });

  it("the list says which class, how often it was fetched and how many group requests wait — and filters by class and type", async () => {
    const admin = await owner();
    const { id } = await newClass();
    const g = await make(admin, id, { kind: "group", platform: "facebook", url: "https://www.facebook.com/groups/lst" });
    await make(admin, id, { kind: "link", url: "https://example.com/l" });
    const s = await enrolled(id);
    await env.DB.prepare("INSERT INTO group_requests (material_id, course_id, student_id, profile_url) VALUES (?, ?, ?, 'https://facebook.com/x')").bind(g.id, id, s.id).run();
    const list = await json(await admin.get(`/api/admin/materials?course_id=${id}&sort=id`));
    expect(list.items).toHaveLength(2);
    const group = list.items.find((x: any) => x.kind === "group");
    expect(group).toMatchObject({ pending_requests: 1, downloads: 0, course_title_en: expect.stringContaining("Material class") });
    expect((await json(await admin.get(`/api/admin/materials?course_id=${id}&kind=link`))).items).toHaveLength(1);
    expect((await admin.get(`/api/admin/materials/export.csv?course_id=${id}`)).status).toBe(200);
  });
});

describe("what a student gets", () => {
  async function scene() {
    const admin = await owner();
    const cls = await newClass();
    const up = await uploaded(admin, cls.id, "Recipes.pdf", PDF);
    const file = await make(admin, cls.id, { title_en: "Recipe guide", r2_key: up.key, sort: 1 });
    const link = await make(admin, cls.id, { kind: "link", title_en: "Tools sheet", url: "https://example.com/private-sheet", sort: 2 });
    const live = await make(admin, cls.id, { kind: "live", title_en: "Live Q&A", url: "https://zoom.us/j/secret", platform: "zoom", starts_at: "2030-01-01T10:00:00Z", sort: 3 });
    const group = await make(admin, cls.id, { kind: "group", title_en: "Baking circle", platform: "facebook", url: "https://www.facebook.com/groups/secretcircle", sort: 4 });
    const hidden = await make(admin, cls.id, { kind: "link", title_en: "Switched off", url: "https://example.com/off", active: false, sort: 5 });
    const trashed = await make(admin, cls.id, { kind: "link", title_en: "In the trash", url: "https://example.com/trash", sort: 6 });
    await admin.del(`/api/admin/materials/${trashed.id}`);
    return { admin, cls, up, file, link, live, group, hidden, trashed };
  }

  it("is for enrolled students only — not visitors, not strangers, not people whose access was withdrawn", async () => {
    const { cls } = await scene();
    expect((await new Client().get(`/api/student/courses/${cls.slug}/materials`)).status).toBe(401);
    const stranger = await registerStudent();
    const r = await stranger.client.get(`/api/student/courses/${cls.slug}/materials`);
    expect(r.status).toBe(403);
    expect((await json(r)).error.code).toBe("not_enrolled");
    const revoked = await enrolled(cls.id, "revoked");
    expect((await revoked.client.get(`/api/student/courses/${cls.slug}/materials`)).status).toBe(403);
    expect((await stranger.client.get("/api/student/courses/no-such-class/materials")).status).toBe(404);
  });

  it("the list has the switched-on materials in the owner's order and not one address, file key or file name that could be used", async () => {
    const { cls, up } = await scene();
    const s = await enrolled(cls.id);
    const res = await s.client.get(`/api/student/courses/${cls.slug}/materials`);
    const text = await res.text();
    const list = JSON.parse(text).materials;
    expect(list.map((m: any) => m.title_en)).toEqual(["Recipe guide", "Tools sheet", "Live Q&A", "Baking circle"]);
    expect(list[0]).toMatchObject({ kind: "pdf", delivery: "file", filename: "Recipes.pdf", size_bytes: PDF.length });
    expect(list[1]).toMatchObject({ kind: "link", delivery: "link", filename: null });
    expect(list[2]).toMatchObject({ kind: "live", platform: "zoom", starts_at: "2030-01-01T10:00:00.000Z" });
    expect(list[3]).toMatchObject({ kind: "group", ask_profile: true, request: null });
    for (const secret of ["private-sheet", "zoom.us", "secretcircle", up.key, "materials/", "r2_key", "https://"]) expect(text, secret).not.toContain(secret);
  });

  it("a file downloads for an enrolled student with safe headers, and is never reachable through the public /media route", async () => {
    const { cls, file, up } = await scene();
    const s = await enrolled(cls.id);
    const res = await s.client.get(`/api/student/materials/${file.id}/download`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="Recipes.pdf"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-length")).toBe(String(PDF.length));
    // the public image route refuses the private folder
    expect((await new Client().get(`/media/${up.key}`)).status).toBe(404);
    expect((await s.client.get(`/media/${up.key}`)).status).toBe(404);
  });

  it("not enrolled (403), unknown (404), switched off or in the trash (404), a link (404) and a visitor (401) are all refused", async () => {
    const { cls, file, link, hidden, trashed } = await scene();
    const stranger = await registerStudent();
    const e = await stranger.client.get(`/api/student/materials/${file.id}/download`);
    expect(e.status).toBe(403);
    expect((await json(e)).error.code).toBe("not_enrolled");
    expect((await new Client().get(`/api/student/materials/${file.id}/download`)).status).toBe(401);
    const s = await enrolled(cls.id);
    expect((await s.client.get("/api/student/materials/999999/download")).status).toBe(404);
    expect((await s.client.get(`/api/student/materials/${hidden.id}/download`)).status).toBe(404);
    expect((await s.client.get(`/api/student/materials/${trashed.id}/download`)).status).toBe(404);
    expect((await s.client.get(`/api/student/materials/${link.id}/download`)).status).toBe(404); // a link is opened, not downloaded
    expect((await stranger.client.post(`/api/student/materials/${link.id}/open`, {})).status).toBe(403);
  });

  it("every download and every open is recorded, and the owner sees who fetched what", async () => {
    const { admin, cls, file, link } = await scene();
    const s = await enrolled(cls.id);
    await (await s.client.get(`/api/student/materials/${file.id}/download`)).arrayBuffer();
    const opened = await json(await s.client.post(`/api/student/materials/${link.id}/open`, {}));
    expect(opened.url).toBe("https://example.com/private-sheet");
    const log = await until(async () => {
      const r = await json(await admin.get(`/api/admin/material-downloads?course_id=${cls.id}`));
      return r.items.length >= 2 ? r : null;
    });
    expect(log.items.map((x: any) => `${x.action}:${x.material_title_en}`).sort()).toEqual(["download:Recipe guide", "open:Tools sheet"]);
    expect(log.items[0]).toMatchObject({ student_name: "Material Student", student_email: s.email });
    const list = await json(await admin.get(`/api/admin/materials?course_id=${cls.id}`));
    expect(list.items.find((x: any) => x.id === file.id).downloads).toBe(1);
    expect((await admin.get(`/api/admin/material-downloads/export.csv?course_id=${cls.id}`)).status).toBe(200);
  });

  it("a partial request (resume) is served as one range and counts as one download", async () => {
    const { admin, cls, file } = await scene();
    const s = await enrolled(cls.id);
    const part = await s.client.fetch(`/api/student/materials/${file.id}/download`, { headers: { range: "bytes=0-3" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-3/${PDF.length}`);
    expect(new TextDecoder().decode(await part.arrayBuffer())).toBe("%PDF");
    const rest = await s.client.fetch(`/api/student/materials/${file.id}/download`, { headers: { range: "bytes=4-" } });
    expect(rest.status).toBe(206);
    expect(new Uint8Array(await rest.arrayBuffer())).toEqual(PDF.slice(4));
    await until(async () => (await json(await admin.get(`/api/admin/material-downloads?material_id=${file.id}`))).items.length >= 1);
    await new Promise((r) => setTimeout(r, 60));
    expect((await json(await admin.get(`/api/admin/material-downloads?material_id=${file.id}`))).items).toHaveLength(1);
  });

  it("downloads are limited per hour so a scraper cannot empty the bucket", async () => {
    const { cls, file } = await scene();
    const s = await enrolled(cls.id);
    const me = await env.DB.prepare("SELECT id FROM students WHERE email = ?").bind(s.email).first<{ id: number }>();
    await env.KV.put(`matdl:${me!.id}:${Math.floor(Date.now() / 3_600_000)}`, "80", { expirationTtl: 300 });
    const res = await s.client.get(`/api/student/materials/${file.id}/download`);
    expect(res.status).toBe(429);
  });
});

describe("a private group", () => {
  async function groupScene(platform: "facebook" | "whatsapp" = "facebook") {
    const admin = await owner();
    const cls = await newClass();
    const group = await make(admin, cls.id, platform === "facebook"
      ? { kind: "group", title_en: "Baking circle", platform, url: "https://www.facebook.com/groups/circle" }
      : { kind: "group", title_en: "WhatsApp circle", platform, url: "https://chat.whatsapp.com/AbCdEf" });
    return { admin, cls, group };
  }

  it("the group link comes only after the student has given their Facebook profile link", async () => {
    const { cls, group } = await groupScene();
    const s = await enrolled(cls.id);
    const early = await s.client.post(`/api/student/materials/${group.id}/open`, {});
    expect(early.status).toBe(409);
    expect((await json(early)).error.code).toBe("profile_required");

    const empty = await s.client.post(`/api/student/materials/${group.id}/join`, { profile_url: "" });
    expect(empty.status).toBe(422);
    expect((await json(empty)).error.fields.profile_url).toBe("required");
    for (const profile of ["https://example.com/jane", "javascript:alert(1)", "https://facebook.com/", "https://evilfacebook.com/jane.doe"]) {
      const r = await s.client.post(`/api/student/materials/${group.id}/join`, { profile_url: profile });
      expect(r.status, profile).toBe(422);
      expect((await json(r)).error.fields.profile_url).toBe("must_be_facebook_profile");
    }

    const joined = await json(await s.client.post(`/api/student/materials/${group.id}/join`, { profile_url: "facebook.com/jane.doe" }));
    expect(joined).toMatchObject({ request: { status: "pending" }, url: "https://www.facebook.com/groups/circle" });
    const row = await env.DB.prepare("SELECT profile_url, status FROM group_requests WHERE material_id = ?").bind(group.id).first<{ profile_url: string; status: string }>();
    expect(row).toEqual({ profile_url: "https://facebook.com/jane.doe", status: "pending" }); // a bare address got its https
    expect((await json(await s.client.post(`/api/student/materials/${group.id}/open`, {}))).url).toBe("https://www.facebook.com/groups/circle");
    const list = (await json(await s.client.get(`/api/student/courses/${cls.slug}/materials`))).materials;
    expect(list[0].request).toEqual({ status: "pending" });
  });

  it("the owner sees who asked (waiting ones first), approves or declines, and the student sees the answer", async () => {
    const { admin, cls, group } = await groupScene();
    const a = await enrolled(cls.id);
    const b = await enrolled(cls.id);
    await a.client.post(`/api/student/materials/${group.id}/join`, { profile_url: "https://www.facebook.com/profile.php?id=100099" });
    await b.client.post(`/api/student/materials/${group.id}/join`, { profile_url: "https://www.facebook.com/bee.baker" });
    const list = await json(await admin.get(`/api/admin/group-requests?course_id=${cls.id}`));
    expect(list.items).toHaveLength(2);
    expect(list.items.every((x: any) => x.status === "pending")).toBe(true);
    expect(list.items[0]).toMatchObject({ student_name: "Material Student", material_title_en: "Baking circle", group_url: "https://www.facebook.com/groups/circle" });
    expect(list.items.map((x: any) => x.profile_url).sort()).toEqual(["https://www.facebook.com/bee.baker", "https://www.facebook.com/profile.php?id=100099"]);

    const target = list.items.find((x: any) => x.student_email === a.email);
    const approved = await admin.patch(`/api/admin/group-requests/${target.id}`, { status: "approved", note: "Added on Facebook" });
    expect(approved.status).toBe(200);
    expect((await json(approved)).item).toMatchObject({ status: "approved", note: "Added on Facebook" });
    const other = list.items.find((x: any) => x.student_email === b.email);
    await admin.patch(`/api/admin/group-requests/${other.id}`, { status: "rejected", note: "" });
    expect((await json(await a.client.get(`/api/student/courses/${cls.slug}/materials`))).materials[0].request).toEqual({ status: "approved" });
    expect((await json(await b.client.get(`/api/student/courses/${cls.slug}/materials`))).materials[0].request).toEqual({ status: "rejected" });
    // waiting ones first, answered ones after; and the filter works
    expect((await json(await admin.get(`/api/admin/group-requests?course_id=${cls.id}&status=approved`))).items).toHaveLength(1);
    expect((await admin.get(`/api/admin/group-requests/export.csv?course_id=${cls.id}`)).status).toBe(200);
    expect((await admin.patch("/api/admin/group-requests/999999", { status: "approved", note: "" })).status).toBe(404);
    expect((await admin.patch(`/api/admin/group-requests/${target.id}`, { status: "maybe", note: "" })).status).toBe(422);

    // saying the same thing again changes nothing; a different profile link asks the owner again
    await a.client.post(`/api/student/materials/${group.id}/join`, { profile_url: "https://www.facebook.com/profile.php?id=100099" });
    expect((await json(await a.client.get(`/api/student/courses/${cls.slug}/materials`))).materials[0].request).toEqual({ status: "approved" });
    await a.client.post(`/api/student/materials/${group.id}/join`, { profile_url: "https://www.facebook.com/new.profile" });
    expect((await json(await a.client.get(`/api/student/courses/${cls.slug}/materials`))).materials[0].request).toEqual({ status: "pending" });
    const asked = await env.DB.prepare("SELECT COUNT(*) AS n FROM group_requests WHERE material_id = ? AND student_id = (SELECT id FROM students WHERE email = ?)").bind(group.id, a.email).first<{ n: number }>();
    expect(asked?.n).toBe(1); // one request per student per group
  });

  it("only the team with write permission can answer; strangers cannot ask to join", async () => {
    const { cls, group } = await groupScene();
    const s = await enrolled(cls.id);
    await s.client.post(`/api/student/materials/${group.id}/join`, { profile_url: "https://www.facebook.com/x.y" });
    const id = (await env.DB.prepare("SELECT id FROM group_requests WHERE material_id = ?").bind(group.id).first<{ id: number }>())!.id;
    const support = (await loginStaff("support")).client;
    expect((await support.patch(`/api/admin/group-requests/${id}`, { status: "approved", note: "" })).status).toBe(403);
    const stranger = await registerStudent();
    expect((await stranger.client.post(`/api/student/materials/${group.id}/join`, { profile_url: "https://www.facebook.com/s.s" })).status).toBe(403);
  });

  it("a WhatsApp group has no profile question: the link opens straight away", async () => {
    const { cls, group } = await groupScene("whatsapp");
    const s = await enrolled(cls.id);
    expect((await json(await s.client.post(`/api/student/materials/${group.id}/open`, {}))).url).toBe("https://chat.whatsapp.com/AbCdEf");
    const joined = await json(await s.client.post(`/api/student/materials/${group.id}/join`, {}));
    expect(joined.url).toBe("https://chat.whatsapp.com/AbCdEf");
  });
});

describe("what a visitor sees on the class page", () => {
  it("says what is included — a count per kind and the titles — and never gives an address, a file or a file name away", async () => {
    const admin = await owner();
    const { id, slug } = await newClass();
    const before = await (await new Client().get(`/en/courses/${slug}`)).text();
    expect(before).not.toContain('class="inc-list"'); // nothing added: nothing claimed
    expect(before).not.toContain("your own use only");

    const f1 = await uploaded(admin, id, "secret-file-name.pdf", PDF);
    await make(admin, id, { title_en: "Biryani masala guide", r2_key: f1.key });
    await make(admin, id, { title_en: "Cake ratios", r2_key: (await uploaded(admin, id, "ratios.pdf", PDF)).key, sort: 2 });
    await make(admin, id, { kind: "live", title_en: "Live Q&A", url: "https://zoom.us/j/topsecret", platform: "zoom", starts_at: "2030-01-01T10:00:00Z" });
    await make(admin, id, { kind: "group", title_en: "Baking circle", platform: "facebook", url: "https://www.facebook.com/groups/hiddencircle" });
    await make(admin, id, { kind: "link", title_en: "Switched off link", url: "https://example.com/off", active: false });

    const en = await (await new Client().get(`/en/courses/${slug}`)).text();
    for (const line of ["2 PDFs to download", "1 live class", "A private community group"]) expect(en, line).toContain(line);
    for (const title of ["Biryani masala guide", "Cake ratios", "Live Q&amp;A", "Baking circle"]) expect(en, title).toContain(title);
    expect(en).not.toContain("Switched off link");
    expect(en).not.toContain("1 useful link");
    expect(en).toContain("Downloads are for your own use only");
    for (const secret of ["topsecret", "hiddencircle", "secret-file-name", f1.key, "example.com/off", "materials/"]) expect(en, secret).not.toContain(secret);

    const bn = await (await new Client().get(`/courses/${slug}`)).text();
    expect(bn).toContain("ডাউনলোডের জন্য ২টি পিডিএফ");
    expect(bn).toContain("১টি লাইভ ক্লাস");
    expect(bn).toContain("একটি প্রাইভেট কমিউনিটি গ্রুপ");
  });

  it("changes at once when the owner switches one off", async () => {
    const admin = await owner();
    const { id, slug } = await newClass();
    const m = await make(admin, id, { kind: "link", title_en: "Handy sheet", url: "https://example.com/sheet" });
    expect(await (await new Client().get(`/en/courses/${slug}`)).text()).toContain("1 useful link");
    await admin.patch(`/api/admin/materials/${m.id}`, { active: false });
    const after = await (await new Client().get(`/en/courses/${slug}`)).text();
    expect(after).not.toContain("1 useful link");
    expect(after).not.toContain("Handy sheet");
  });
});

describe("housekeeping", () => {
  it("an upload that was never saved is removed after two days; one that is in use stays", async () => {
    const admin = await owner();
    const { id } = await newClass();
    const lost = await uploaded(admin, id, "lost.pdf", PDF);
    const used = await uploaded(admin, id, "used.pdf", PDF);
    await make(admin, id, { r2_key: used.key });
    // nothing is touched while it is fresh
    expect(await cleanupOrphanUploads(env)).toBe(0);
    expect(await env.R2.head(lost.key)).not.toBeNull();
    // three days later the unsaved one goes (with its note), the saved one stays
    expect(await cleanupOrphanUploads(env, Date.now() + 3 * 86400 * 1000)).toBeGreaterThanOrEqual(1);
    expect(await env.R2.head(lost.key)).toBeNull();
    expect(await env.KV.get(uploadNoteKey(lost.key))).toBeNull();
    expect(await env.R2.head(used.key)).not.toBeNull();
  });
});

describe("Facebook links", () => {
  it("accepts a group or a profile on Facebook and nothing else", () => {
    for (const ok of ["https://www.facebook.com/groups/abc", "https://facebook.com/jane.doe", "https://m.facebook.com/profile.php?id=1000", "https://fb.com/jane", "https://www.facebook.com/people/Jane-Doe/100099"]) expect(facebookUrl(ok), ok).not.toBeNull();
    for (const bad of ["http://facebook.com/jane", "https://facebook.com/", "https://facebook.com", "https://evilfacebook.com/jane", "https://facebook.com.evil.test/jane", "https://user:pw@facebook.com/jane", "javascript:alert(1)", "facebook.com/jane", ""]) expect(facebookUrl(bad), bad).toBeNull();
  });
});
