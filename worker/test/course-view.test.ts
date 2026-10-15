import { describe, expect, it } from "vitest";
import { refreshCourseRating, refreshCourseStats } from "../src/services/catalog";
import { Client, env, json, loginStaff, registerStudent } from "./helpers";

/*
 * Admin → Classes: the owner's read-only "View" page and the Active / Inactive switch.
 * Active = visible on the website and open for enrolment (status "published"); Inactive = hidden (status "draft").
 * What the owner must be able to rely on: an inactive class disappears and cannot be bought, but the students who already
 * paid keep their access; and the View page's numbers are counted from real rows.
 */

let seq = 0;
async function newClass(status: "published" | "draft" | "coming_soon" = "published") {
  const slug = `view-${Date.now().toString(36)}${++seq}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, long_bn, long_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, 'ভিউ ক্লাস', ?, 'ছোট', 'Short', '', '', 400, ?, 1, 1, ?)`,
  )
    .bind(slug, `View class ${slug}`, status, status === "published" ? "2026-01-01T00:00:00Z" : null)
    .run();
  return { id: res.meta.last_row_id as number, slug };
}

describe("the class overview behind the View page", () => {
  it("counts students, sales, reviews, the waiting list and the shape of the class from real rows only", async () => {
    const { id, slug } = await newClass();
    const staff = (await loginStaff("super_admin")).client;

    // a curriculum: one module, two lessons (one is a free preview)
    const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort) VALUES (?, 'ম', 'M', 1)").bind(id).run();
    await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, duration_sec, is_preview, sort) VALUES (?, ?, 'ক', 'A', 'text', 600, 1, 1)").bind(id, mod.meta.last_row_id).run();
    await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, duration_sec, is_preview, sort) VALUES (?, ?, 'খ', 'B', 'text', 1200, 0, 2)").bind(id, mod.meta.last_row_id).run();
    await refreshCourseStats(env, id);

    // two students: one active, one revoked; one paid order and one still pending
    const a = await registerStudent(new Client(), { name: "Active Student" });
    const b = await registerStudent(new Client(), { name: "Revoked Student" });
    const enrolA = await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'purchase')").bind(a.id, id).run();
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source, revoked_at) VALUES (?, ?, 'revoked', 'purchase', '2026-02-01T00:00:00Z')").bind(b.id, id).run();
    const order = (status: string, n: number) =>
      env.DB.prepare("INSERT INTO orders (public_id, student_id, status, subtotal, discount, total, gateway, customer_name, customer_email) VALUES (?, ?, ?, 400, 0, 400, 'mock', 'n', 'e@x.test')").bind(`ov${n}${Date.now()}`, a.id, status).run();
    const paid = await order("paid", 1);
    const pending = await order("pending", 2);
    await env.DB.prepare("INSERT INTO order_items (order_id, course_id, title_bn, title_en, list_price, price) VALUES (?, ?, 'x', 'x', 400, 360)").bind(paid.meta.last_row_id, id).run();
    await env.DB.prepare("INSERT INTO order_items (order_id, course_id, title_bn, title_en, list_price, price) VALUES (?, ?, 'x', 'x', 400, 400)").bind(pending.meta.last_row_id, id).run();

    // reviews: one approved, one waiting; two people asked to be told when it launches (one already told)
    await env.DB.prepare("INSERT INTO reviews (course_id, student_id, enrollment_id, rating, body, status) VALUES (?, ?, ?, 5, 'Lovely', 'approved')").bind(id, a.id, enrolA.meta.last_row_id).run();
    const enrolB = await env.DB.prepare("SELECT id FROM enrollments WHERE student_id = ? AND course_id = ?").bind(b.id, id).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO reviews (course_id, student_id, enrollment_id, rating, body, status) VALUES (?, ?, ?, 3, 'Waiting', 'pending')").bind(id, b.id, enrolB!.id).run();
    await refreshCourseRating(env, id);
    await env.DB.prepare("INSERT INTO notify_signups (course_id, email) VALUES (?, 'wait1@x.test')").bind(id).run();
    await env.DB.prepare("INSERT INTO notify_signups (course_id, email, notified_at) VALUES (?, 'told@x.test', '2026-02-01T00:00:00Z')").bind(id).run();

    const res = await staff.get(`/api/admin/courses/${id}/overview`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.stats).toEqual({
      enrolled: 1, // the revoked student does not count as enrolled…
      ever_enrolled: 2, // …but is still part of the history
      revenue: 360, // only the paid order, at the price actually paid (after the coupon), not the pending one
      paid_orders: 1,
      rating_avg: 5, // only the approved review
      rating_count: 1,
      reviews_waiting: 1,
      waiting: 1, // the person already told does not count
      modules: 1,
      lessons: 2,
      previews: 1,
      minutes: 30,
    });
    expect(body.reviews.map((r: { body: string; status: string }) => `${r.status}:${r.body}`).sort()).toEqual(["approved:Lovely", "pending:Waiting"]);
    expect(slug).toBeTruthy();
  });

  it("is readable by everyone who may see classes (even a read-only viewer), not by strangers, and says 404 for a class that does not exist", async () => {
    const { id } = await newClass();
    expect((await (await loginStaff("viewer")).client.get(`/api/admin/courses/${id}/overview`)).status).toBe(200);
    expect((await new Client().get(`/api/admin/courses/${id}/overview`)).status).toBe(401);
    expect((await (await loginStaff("super_admin")).client.get("/api/admin/courses/99999999/overview")).status).toBe(404);
  });

  it("a class with nothing yet shows honest zeros", async () => {
    const { id } = await newClass("draft");
    const body = await json(await (await loginStaff("content_manager")).client.get(`/api/admin/courses/${id}/overview`));
    expect(body.stats).toMatchObject({ enrolled: 0, ever_enrolled: 0, revenue: 0, paid_orders: 0, rating_count: 0, reviews_waiting: 0, waiting: 0, lessons: 0 });
    expect(body.reviews).toEqual([]);
  });
});

describe("Active / Inactive", () => {
  it("inactive hides the class and closes enrolment at once — and the students who already paid keep their access", async () => {
    const { id, slug } = await newClass("published");
    const staff = (await loginStaff("content_manager")).client;
    const student = await registerStudent(new Client(), { name: "Paid Student" });
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'purchase')").bind(student.id, id).run();
    const buyer = await registerStudent(new Client(), { name: "Would Be Buyer" });

    const publicPage = async () => (await new Client().get(`/en/courses/${slug}`)).status;
    const inList = async () => (await (await new Client().get(`/en/courses?q=${slug}`)).text()).includes(`/courses/${slug}"`);
    const apiList = async () => (await json(await new Client().get(`/api/courses?q=${slug}`))).courses.some((c: { slug: string }) => c.slug === slug);
    expect(await publicPage()).toBe(200);
    expect(await inList()).toBe(true);
    expect(await apiList()).toBe(true);

    const off = await staff.patch(`/api/admin/courses/${id}`, { status: "draft" });
    expect(off.status).toBe(200);
    expect(await publicPage()).toBe(404);
    expect(await inList()).toBe(false);
    expect(await apiList()).toBe(false);
    // nobody can start buying it
    const quote = await buyer.client.post("/api/checkout/quote", { courses: [slug] });
    expect(quote.status).toBe(422);
    expect((await json(quote)).error.code).toBe("course_unavailable");
    // the student who paid still learns
    expect((await student.client.get(`/api/student/courses/${slug}`)).status).toBe(200);

    const on = await staff.patch(`/api/admin/courses/${id}`, { status: "published" });
    expect(on.status).toBe(200);
    expect(await publicPage()).toBe(200);
    expect((await buyer.client.post("/api/checkout/quote", { courses: [slug] })).status).toBe(200);
  });

  it("switching it off and on again keeps the first publication date and changes nothing else", async () => {
    const { id } = await newClass("published");
    const staff = (await loginStaff("super_admin")).client;
    const before = (await json(await staff.get(`/api/admin/courses/${id}`))).item;
    await staff.patch(`/api/admin/courses/${id}`, { status: "draft" });
    await staff.patch(`/api/admin/courses/${id}`, { status: "published" });
    const after = (await json(await staff.get(`/api/admin/courses/${id}`))).item;
    expect(after.status).toBe("published");
    expect(after.published_at).toBe(before.published_at);
    expect({ ...after, updated_at: 0 }).toEqual({ ...before, updated_at: 0 });
  });

  it("only people who may edit classes can flip the switch; the change is in the activity log", async () => {
    const { id } = await newClass("published");
    const support = (await loginStaff("support")).client;
    const viewer = (await loginStaff("viewer")).client;
    expect((await support.patch(`/api/admin/courses/${id}`, { status: "draft" })).status).toBe(403);
    expect((await viewer.patch(`/api/admin/courses/${id}`, { status: "draft" })).status).toBe(403);
    const owner = (await loginStaff("super_admin")).client;
    expect((await owner.patch(`/api/admin/courses/${id}`, { status: "draft" })).status).toBe(200);
    const log = await json(await owner.get("/api/admin/activity?action=courses.updated"));
    expect(log.items.length).toBeGreaterThan(0);
  });
});
