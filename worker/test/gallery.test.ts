import { beforeEach, describe, expect, it } from "vitest";
import { MAX_CLASS_PICTURES } from "@mawah/shared";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * A class's extra pictures (Admin → a class → Pictures) and how the class page shows them. The owner uploads pictures and
 * chooses their order and captions; these tests protect what the owner cannot see by eye: who may change them, that a picture
 * can only be one the upload endpoint really stored in a public folder, that the order and the limit hold, that another
 * class's pictures cannot be reached through this class, and that the page shows exactly the owner's pictures — as plain links
 * that work without a script, with the captions escaped, the structured data complete, and no extra script on a class that has none.
 */

const text = (res: Response) => res.text();
let seq = 0;
let hexSeq = 0;
const SLUG = () => `gallery-class-${Date.now().toString(36)}-${++seq}`;

/** A published class; `banner` is its main picture (a key as the upload endpoint would give it). */
async function makeCourse(over: { banner?: string | null; status?: string } = {}) {
  const slug = SLUG();
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, price, status, banner_key, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, 'ছোট বিবরণ', 'Short blurb', 700, ?, ?, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `ছবির ক্লাস ${seq}`, `Picture Class ${seq}`, over.status ?? "published", over.banner === undefined ? null : over.banner)
    .run();
  return { id: res.meta.last_row_id as number, slug, title_en: `Picture Class ${seq}`, title_bn: `ছবির ক্লাস ${seq}` };
}

/** A picture stored the way the upload endpoint stores it: a content-hashed key under a public folder. */
async function stored(folder = "gallery", ext = "webp") {
  const key = `${folder}/${(++hexSeq).toString(16).padStart(32, "0")}.${ext}`;
  await env.R2.put(key, new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]), { httpMetadata: { contentType: "image/webp" } });
  return key;
}

async function owner() {
  return (await loginStaff("super_admin")).client;
}
async function add(admin: Client, courseId: number, over: Record<string, unknown> = {}) {
  const image_key = (over.image_key as string | undefined) ?? (await stored());
  const res = await admin.post(`/api/admin/courses/${courseId}/images`, { image_key, caption_bn: "", caption_en: "", ...over });
  if (res.status !== 201) throw new Error(`add picture failed: ${res.status} ${await res.text()}`);
  return (await json(res)).item as { id: number; image_key: string; thumb_key: string | null; sort: number };
}
const listed = async (admin: Client, courseId: number) => (await json(await admin.get(`/api/admin/courses/${courseId}/images`))) as { items: { id: number; image_key: string; caption_en: string; caption_bn: string }[]; max: number };

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM course_images").run();
});

describe("who may change a class's pictures, and what a picture may be", () => {
  it("owners and content managers can; viewers can look but not change; strangers cannot even look", async () => {
    const c = await makeCourse();
    const admin = await owner();
    const content = (await loginStaff("content_manager")).client;
    const viewer = (await loginStaff("viewer")).client;
    const key = await stored();
    expect((await content.post(`/api/admin/courses/${c.id}/images`, { image_key: key, caption_bn: "", caption_en: "" })).status).toBe(201);
    expect((await viewer.get(`/api/admin/courses/${c.id}/images`)).status).toBe(200);
    expect((await viewer.post(`/api/admin/courses/${c.id}/images`, { image_key: key, caption_bn: "", caption_en: "" })).status).toBe(403);
    const first = (await listed(admin, c.id)).items[0];
    expect((await viewer.patch(`/api/admin/courses/${c.id}/images/${first.id}`, { caption_bn: "", caption_en: "x" })).status).toBe(403);
    expect((await viewer.del(`/api/admin/courses/${c.id}/images/${first.id}`)).status).toBe(403);
    expect((await viewer.post(`/api/admin/courses/${c.id}/images/order`, { ids: [first.id] })).status).toBe(403);
    expect((await new Client().get(`/api/admin/courses/${c.id}/images`)).status).toBe(401);
  });

  it("a picture is only a file the upload endpoint stored under a public folder — never an address, never a made-up name", async () => {
    const c = await makeCourse();
    const admin = await owner();
    const hex = "ab".repeat(16);
    for (const bad of [`https://evil.example/${hex}.png`, `gallery/../${hex}.webp`, `gallery/short.webp`, `gallery/${hex}.svg`, `resources/${hex}.png`, `lessons/${hex}.webp`, `javascript:alert(1)`, "", `gallery/${hex}.webp/../../x`]) {
      const res = await admin.post(`/api/admin/courses/${c.id}/images`, { image_key: bad, caption_bn: "", caption_en: "" });
      expect(res.status, bad).toBe(422);
    }
    // well formed, but nothing was ever uploaded under that name: it would show a broken picture to every visitor
    const ghost = await admin.post(`/api/admin/courses/${c.id}/images`, { image_key: `gallery/${hex}.webp`, caption_bn: "", caption_en: "" });
    expect(ghost.status).toBe(422);
    expect((await json(ghost)).error.fields).toMatchObject({ image_key: "invalid_image" });
    // the small copy is checked the same way
    const noThumb = await admin.post(`/api/admin/courses/${c.id}/images`, { image_key: await stored(), thumb_key: `gallery/${"cd".repeat(16)}.webp`, caption_bn: "", caption_en: "" });
    expect(noThumb.status).toBe(422);
    expect((await json(noThumb)).error.fields).toMatchObject({ thumb_key: "invalid_image" });
    expect((await listed(admin, c.id)).items).toHaveLength(0);
    // a class that does not exist
    expect((await admin.post("/api/admin/courses/999999/images", { image_key: await stored(), caption_bn: "", caption_en: "" })).status).toBe(404);
    expect((await admin.get("/api/admin/courses/999999/images")).status).toBe(404);
  });

  it("the upload endpoint takes the gallery folder, and what it stores can be added and then served publicly with an immutable cache", async () => {
    const c = await makeCourse();
    const admin = await owner();
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const up = await admin.fetch("/api/admin/media/image?folder=gallery", { method: "POST", body: JPEG, headers: { "content-type": "image/jpeg" } });
    expect(up.status).toBe(201);
    const { key, url } = await json(up);
    expect(key).toMatch(/^gallery\/[a-f0-9]{32}\.jpg$/);
    await add(admin, c.id, { image_key: key });
    const served = await new Client().get(url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("cache-control")).toContain("immutable");
    // a folder that is not public is still not served
    await env.R2.put(`resources/${"ee".repeat(16)}.webp`, new Uint8Array([1, 2, 3]));
    expect((await new Client().get(`/media/resources/${"ee".repeat(16)}.webp`)).status).toBe(404);
  });
});

describe("adding, captions, order and removal", () => {
  it("pictures keep the order they were added in, and the order can be changed — only with exactly this class's pictures", async () => {
    const c = await makeCourse();
    const other = await makeCourse();
    const admin = await owner();
    const a = await add(admin, c.id, { caption_en: "A" });
    const b = await add(admin, c.id, { caption_en: "B" });
    const d = await add(admin, c.id, { caption_en: "D" });
    const foreign = await add(admin, other.id, { caption_en: "Other class" });
    expect(a.sort).toBeLessThan(b.sort);
    expect(b.sort).toBeLessThan(d.sort);
    const first = await listed(admin, c.id);
    expect(first.max).toBe(MAX_CLASS_PICTURES);
    expect(first.items.map((p) => p.caption_en)).toEqual(["A", "B", "D"]);

    const reversed = await admin.post(`/api/admin/courses/${c.id}/images/order`, { ids: [d.id, b.id, a.id] });
    expect(reversed.status).toBe(200);
    expect((await listed(admin, c.id)).items.map((p) => p.caption_en)).toEqual(["D", "B", "A"]);

    // a missing one, an extra one, a repeated one and another class's picture are all refused — and nothing changes
    for (const ids of [[d.id, b.id], [d.id, b.id, a.id, foreign.id], [d.id, d.id, a.id], [foreign.id, b.id, a.id], []]) {
      expect((await admin.post(`/api/admin/courses/${c.id}/images/order`, { ids })).status, JSON.stringify(ids)).toBe(422);
    }
    expect((await listed(admin, c.id)).items.map((p) => p.caption_en)).toEqual(["D", "B", "A"]);
    expect((await listed(admin, other.id)).items.map((p) => p.caption_en)).toEqual(["Other class"]);
  });

  it("captions in both languages are saved and come back; a picture of another class cannot be reached through this one", async () => {
    const c = await makeCourse();
    const other = await makeCourse();
    const admin = await owner();
    const mine = await add(admin, c.id);
    const theirs = await add(admin, other.id, { caption_en: "Not yours" });
    expect((await admin.patch(`/api/admin/courses/${c.id}/images/${mine.id}`, { caption_bn: "আমাদের রান্নাঘর", caption_en: "Our kitchen" })).status).toBe(200);
    expect((await listed(admin, c.id)).items[0]).toMatchObject({ caption_bn: "আমাদের রান্নাঘর", caption_en: "Our kitchen" });
    expect((await admin.patch(`/api/admin/courses/${c.id}/images/${theirs.id}`, { caption_bn: "", caption_en: "Taken" })).status).toBe(404);
    expect((await admin.del(`/api/admin/courses/${c.id}/images/${theirs.id}`)).status).toBe(404);
    expect((await listed(admin, other.id)).items[0].caption_en).toBe("Not yours");
    // too long a caption is refused with the reason
    const long = await admin.patch(`/api/admin/courses/${c.id}/images/${mine.id}`, { caption_bn: "", caption_en: "x".repeat(161) });
    expect(long.status).toBe(422);
  });

  it("a picture can be removed once; the others stay; every change is in the activity log", async () => {
    const c = await makeCourse();
    const admin = await owner();
    const a = await add(admin, c.id, { caption_en: "Keep" });
    const b = await add(admin, c.id, { caption_en: "Drop" });
    await admin.patch(`/api/admin/courses/${c.id}/images/${a.id}`, { caption_bn: "", caption_en: "Keep (edited)" });
    await admin.post(`/api/admin/courses/${c.id}/images/order`, { ids: [b.id, a.id] });
    expect((await admin.del(`/api/admin/courses/${c.id}/images/${b.id}`)).status).toBe(200);
    expect((await admin.del(`/api/admin/courses/${c.id}/images/${b.id}`)).status).toBe(404);
    expect((await listed(admin, c.id)).items.map((p) => p.caption_en)).toEqual(["Keep (edited)"]);
    for (const action of ["gallery.added", "gallery.captioned", "gallery.reordered", "gallery.removed"]) {
      const log = await json(await admin.get(`/api/admin/activity?action=${action}`));
      expect(log.items.length, action).toBeGreaterThan(0);
    }
  });

  it("a class shows at most the limit: the next picture is refused and nothing is added", async () => {
    const c = await makeCourse();
    const admin = await owner();
    for (let i = 0; i < MAX_CLASS_PICTURES; i++) await env.DB.prepare("INSERT INTO course_images (course_id, image_key, sort) VALUES (?, ?, ?)").bind(c.id, `gallery/${(1000 + i).toString(16).padStart(32, "0")}.webp`, (i + 1) * 10).run();
    const res = await admin.post(`/api/admin/courses/${c.id}/images`, { image_key: await stored(), caption_bn: "", caption_en: "" });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("gallery_full");
    expect((await listed(admin, c.id)).items).toHaveLength(MAX_CLASS_PICTURES);
  });
});

describe("the class page", () => {
  it("a class with only its main picture is unchanged: a plain picture, no grid, no viewer, no extra script", async () => {
    const main = await stored("banners");
    const c = await makeCourse({ banner: main });
    const html = await text(await new Client().get(`/en/courses/${c.slug}`));
    expect(html).toContain(`src="/media/${main}" alt="${c.title_en}"`);
    expect(html).not.toContain('class="gal-grid"'); // (the stylesheet is inlined in every page, so the markup is what is checked)
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("data-gallery-item");
    expect(html).not.toMatch(/\/assets\/gallery\.[a-f0-9]+\.js/);
  });

  it("shows the owner's pictures in the owner's order as links that work without a script, opens the main one in the viewer too, and loads the viewer's script", async () => {
    const main = await stored("banners");
    const c = await makeCourse({ banner: main });
    const admin = await owner();
    const big1 = await stored();
    const small1 = await stored();
    const big2 = await stored();
    await add(admin, c.id, { image_key: big1, thumb_key: small1, caption_en: "The bakery counter", caption_bn: "বেকারির কাউন্টার" });
    await add(admin, c.id, { image_key: big2, caption_en: "", caption_bn: "" });
    const res = await new Client().get(`/en/courses/${c.slug}`);
    expect(res.status).toBe(200);
    const html = await text(res);

    // the grid: the small copy is shown, the large one is where the link goes; no caption → a plain description with the position
    const grid = html.slice(html.indexOf('class="gal-grid"'), html.indexOf("</ul>", html.indexOf('class="gal-grid"')));
    expect(grid.indexOf(`href="/media/${big1}"`)).toBeGreaterThan(-1);
    expect(grid.indexOf(`href="/media/${big1}"`)).toBeLessThan(grid.indexOf(`href="/media/${big2}"`));
    expect(grid).toContain(`src="/media/${small1}" alt="The bakery counter"`);
    expect(grid).toContain(`data-caption="The bakery counter"`);
    expect(grid).toContain(`src="/media/${big2}"`); // no small copy: the large one is used
    expect(grid).toContain(`alt="${c.title_en} — picture 3 of 3"`);
    expect(grid).toContain('loading="lazy"');

    // the main picture is the first stop of the viewer and says so
    expect(html).toContain(`class="gal-main" href="/media/${main}"`);
    expect(html).toContain('aria-label="See all 3 pictures of this class"');
    // the viewer: a modal dialog with labelled buttons, and its script only here
    expect(html).toContain('<dialog class="lb" data-lightbox="true"');
    for (const label of ["Close", "Previous picture", "Next picture"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toMatch(/<script src="\/assets\/gallery\.[a-f0-9]+\.js" defer="">/);
    expect(html).not.toMatch(/\/assets\/banners\.[a-f0-9]+\.js/);
    // images come from this site only (the strict CSP allows no other source)
    expect(res.headers.get("content-security-policy")).toContain("img-src 'self'");
  });

  it("reads in Bangla with Bangla digits and the Bangla captions", async () => {
    const main = await stored("banners");
    const c = await makeCourse({ banner: main });
    const admin = await owner();
    await add(admin, c.id, { caption_en: "Counter", caption_bn: "বেকারির কাউন্টার" });
    await add(admin, c.id, {});
    const html = await text(await new Client().get(`/courses/${c.slug}`));
    expect(html).toContain('aria-label="এই ক্লাসের সব ৩টি ছবি দেখুন"');
    expect(html).toContain('alt="বেকারির কাউন্টার"');
    expect(html).toContain(`alt="${c.title_bn} — ৩টির মধ্যে ৩ নং ছবি"`);
    expect(html).toContain('aria-label="আগের ছবি"');
    expect(html).toContain('data-count="%tটির মধ্যে %n"'); // the viewer's script fills in the numbers (Bangla digits there too)
  });

  it("a class with no main picture still shows its pictures, counted without it", async () => {
    const c = await makeCourse({ banner: null });
    const admin = await owner();
    await add(admin, c.id, {});
    await add(admin, c.id, {});
    const html = await text(await new Client().get(`/en/courses/${c.slug}`));
    expect(html).not.toContain('class="gal-main"');
    expect((html.match(/data-gallery-item=/g) ?? []).length).toBe(2);
    expect(html).toContain(`alt="${c.title_en} — picture 2 of 2"`);
  });

  it("the owner's captions can never become markup, in the grid, in the viewer's data or in the structured data", async () => {
    const c = await makeCourse();
    const admin = await owner();
    await add(admin, c.id, { caption_en: `<script>alert(1)</script>" onmouseover="x`, caption_bn: "" });
    const html = await text(await new Client().get(`/en/courses/${c.slug}`));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('" onmouseover="x');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("tells search engines about every picture: the main one first, then the others, as addresses of this site", async () => {
    const main = await stored("banners");
    const c = await makeCourse({ banner: main });
    const admin = await owner();
    const one = await stored();
    const two = await stored();
    await add(admin, c.id, { image_key: one });
    await add(admin, c.id, { image_key: two });
    const html = await text(await new Client().get(`/en/courses/${c.slug}`));
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const course = blocks.find((b) => b["@type"] === "Course");
    expect(course.image.map((u: string) => new URL(u).pathname)).toEqual([`/media/${main}`, `/media/${one}`, `/media/${two}`]);
    expect(course.image.every((u: string) => /^https?:\/\//.test(u))).toBe(true);
    // a class with a single picture keeps the plain form
    const solo = await makeCourse({ banner: main });
    const soloHtml = await text(await new Client().get(`/en/courses/${solo.slug}`));
    const soloCourse = [...soloHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((b) => b["@type"] === "Course");
    expect(new URL(soloCourse.image).pathname).toBe(`/media/${main}`);
  });

  it("a removed picture is gone from the page at once", async () => {
    const c = await makeCourse();
    const admin = await owner();
    const gone = await add(admin, c.id, { caption_en: "Soon gone" });
    await add(admin, c.id, { caption_en: "Stays" });
    expect(await text(await new Client().get(`/en/courses/${c.slug}`))).toContain("Soon gone");
    await admin.del(`/api/admin/courses/${c.id}/images/${gone.id}`);
    const html = await text(await new Client().get(`/en/courses/${c.slug}`));
    expect(html).not.toContain("Soon gone");
    expect(html).toContain("Stays");
  });
});
