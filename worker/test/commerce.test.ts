import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, env, json, registerStudent } from "./helpers";
import { mockSignature } from "../src/services/payments";
import { refreshCourseRating } from "../src/services/catalog";

/* ------------------------------------------------------------------------------------------------ helpers */
let seq = 0;
async function makeCourse(opts: { price?: number; status?: string; lessons?: number; resource?: boolean } = {}) {
  const n = ++seq;
  const slug = `test-course-${Date.now().toString(36)}-${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `টেস্ট ক্লাস ${n}`, `Test Course ${n}`, opts.price ?? 1000, opts.status ?? "published")
    .run();
  const courseId = res.meta.last_row_id as number;
  const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en, sort) VALUES (?, 'মডিউল', 'Module', 1)").bind(courseId).run();
  const moduleId = mod.meta.last_row_id as number;
  const lessons: number[] = [];
  for (let i = 1; i <= (opts.lessons ?? 3); i++) {
    const l = await env.DB.prepare(
      `INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, body_bn, body_en, sort, is_preview)
       VALUES (?, ?, ?, ?, 'external', 'https://youtu.be/dQw4w9WgXcQ', 'নোট **গুরুত্বপূর্ণ**', 'Notes <script>alert(1)</script>', ?, ?)`,
    )
      .bind(courseId, moduleId, `লেসন ${i}`, `Lesson ${i}`, i, i === 1 ? 1 : 0)
      .run();
    lessons.push(l.meta.last_row_id as number);
  }
  let resourceId = 0;
  if (opts.resource) {
    await env.R2.put(`resources/test-${n}.pdf`, "%PDF-1.4 test");
    const r = await env.DB.prepare("INSERT INTO lesson_resources (lesson_id, course_id, title_en, r2_key, filename, mime, size_bytes) VALUES (?, ?, 'Recipe PDF', ?, 'recipe.pdf', 'application/pdf', 13)")
      .bind(lessons[1], courseId, `resources/test-${n}.pdf`)
      .run();
    resourceId = r.meta.last_row_id as number;
  }
  return { id: courseId, slug, lessons, resourceId };
}

async function payMock(publicId: string, status: "paid" | "failed" = "paid", client = new Client()) {
  const sig = await mockSignature(env, publicId, status);
  return client.fetch("/api/payments/mock/webhook", { method: "POST", form: { order: publicId, status, sig } });
}

async function buy(student: Client, slugs: string[], extra: Record<string, unknown> = {}) {
  const res = await student.post("/api/checkout", { courses: slugs, channel: "mock", ...extra });
  const body = await json(res);
  return { res, body, publicId: body.order?.public_id as string };
}

async function buyAndPay(student: Client, slugs: string[], extra: Record<string, unknown> = {}) {
  const r = await buy(student, slugs, extra);
  expect(r.res.status, JSON.stringify(r.body)).toBe(201);
  expect((await payMock(r.publicId)).status).toBe(200);
  return r.publicId;
}

const orderRow = (publicId: string) => env.DB.prepare("SELECT * FROM orders WHERE public_id = ?").bind(publicId).first<any>();

afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------------------------------------ catalog */
describe("public catalog (the 26 real MAWAH classes)", () => {
  it("lists every launch class with the owner-supplied prices", async () => {
    const res = await new Client().get("/api/courses?per_page=60");
    const { courses, total } = await json(res);
    expect(total).toBe(26);
    const price = (slug: string) => courses.find((c: any) => c.slug === slug)?.price;
    expect(price("beginners-baking-class")).toBe(400);
    expect(price("traditional-aurosh-biryani-online-class")).toBe(350);
    expect(price("saffron-pistachio-sharbat-and-mahalabia-class")).toBe(610);
    expect(price("tehari-and-dessert-bowl-class")).toBe(650);
    expect(price("premium-mishti-master-class")).toBe(3550);
    expect(price("frozen-food-business-master-class")).toBe(3500);
    expect(price("sweet-savory-fast-food-class-season-1")).toBe(1850);
    expect(price("shahi-iftar-class")).toBe(2550);
    expect(courses.reduce((s: number, c: any) => s + c.price, 0)).toBe(
      [1850, 1550, 1150, 2550, 1550, 1550, 850, 850, 1050, 400, 1050, 1850, 2550, 2050, 610, 650, 350, 750, 1250, 550, 850, 1250, 1550, 3550, 3500, 1150].reduce((a, b) => a + b, 0),
    );
  });

  it("never fabricates social proof: no ratings or counts are seeded", async () => {
    const { courses } = await json(await new Client().get("/api/courses?per_page=60"));
    for (const c of courses) {
      expect(c.rating_count).toBe(0);
      expect(c.rating_avg).toBe(0);
    }
  });

  it("filters by category and searches Bangla and English", async () => {
    const cakes = await json(await new Client().get("/api/courses?cat=cakes-bakery&per_page=60"));
    expect(cakes.total).toBe(7);
    const bn = await json(await new Client().get(`/api/courses?q=${encodeURIComponent("বিরিয়ানি")}`));
    expect(bn.courses.some((c: any) => c.slug === "traditional-aurosh-biryani-online-class")).toBe(true);
    const en = await json(await new Client().get("/api/courses?q=brownie"));
    expect(en.courses[0].slug).toBe("exclusive-brownie-master-class");
  });

  it("hides draft and archived classes but shows coming-soon ones", async () => {
    const draft = await makeCourse({ status: "draft" });
    const soon = await makeCourse({ status: "coming_soon" });
    expect((await new Client().get(`/api/courses/${draft.slug}`)).status).toBe(404);
    const body = await json(await new Client().get(`/api/courses/${soon.slug}`));
    expect(body.course.status).toBe("coming_soon");
    // curriculum exposes titles only — never stream ids, urls or bodies
    expect(JSON.stringify(body.curriculum)).not.toContain("youtu");
  });
});

/* ------------------------------------------------------------------------------------------------ checkout */
describe("checkout & webhook-driven enrollment", () => {
  it("enrolls only after the (signed) payment webhook — not when the order is created", async () => {
    const course = await makeCourse({ price: 1850 });
    const { client } = await registerStudent();
    const r = await buy(client, [course.slug]);
    expect(r.res.status).toBe(201);
    expect(r.body.order.status).toBe("pending");
    expect(r.body.redirect_url).toContain("/api/payments/mock/pay/");

    // no enrollment yet: lessons are locked
    expect((await client.get(`/api/student/lessons/${course.lessons[1]}`)).status).toBe(403);
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(0);

    // an unsigned / forged webhook does nothing
    const forged = await new Client().fetch("/api/payments/mock/webhook", { method: "POST", form: { order: r.publicId, status: "paid", sig: "deadbeef" } });
    expect(forged.status).toBe(403);
    expect((await orderRow(r.publicId)).status).toBe("pending");

    // the genuine webhook confirms
    expect((await payMock(r.publicId)).status).toBe(200);
    const order = await orderRow(r.publicId);
    expect(order.status).toBe("paid");
    expect(order.invoice_no).toMatch(/^INV-MWH-\d{8}-\d{4}$/);
    expect(order.total).toBe(1850);

    const mine = await json(await client.get("/api/student/courses"));
    expect(mine.courses).toHaveLength(1);
    expect(mine.courses[0].course.slug).toBe(course.slug);
    expect((await client.get(`/api/student/lessons/${course.lessons[1]}`)).status).toBe(200);
  });

  it("is idempotent: replayed and concurrent webhooks create exactly one invoice, enrollment and coupon use", async () => {
    await env.DB.prepare("INSERT INTO coupons (code, type, value, max_uses) VALUES ('REPLAY50', 'flat', 50, 5)").run();
    const course = await makeCourse({ price: 500 });
    const { client } = await registerStudent();
    const { publicId, res } = await buy(client, [course.slug], { coupon: "replay50" });
    expect(res.status).toBe(201);
    expect((await orderRow(publicId)).total).toBe(450);

    const results = await Promise.all(Array.from({ length: 6 }, () => payMock(publicId)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    await payMock(publicId); // and again, later

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE order_id = (SELECT id FROM orders WHERE public_id = ?)").bind(publicId).first<{ n: number }>();
    expect(rows!.n).toBe(1);
    const coupon = await env.DB.prepare("SELECT used_count FROM coupons WHERE code = 'REPLAY50'").first<{ used_count: number }>();
    expect(coupon!.used_count).toBe(1);
    const invoices = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE invoice_no IS NOT NULL AND public_id = ?").bind(publicId).first<{ n: number }>();
    expect(invoices!.n).toBe(1);
  });

  it("issues unique, sequential, gapless invoice numbers", async () => {
    const course = await makeCourse({ price: 100 });
    const nums: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { client } = await registerStudent();
      const id = await buyAndPay(client, [course.slug]);
      nums.push(Number((await orderRow(id)).invoice_no.split("-").pop()));
    }
    expect(nums[1]).toBe(nums[0] + 1);
    expect(nums[2]).toBe(nums[1] + 1);
    const dup = await env.DB.prepare("SELECT invoice_no, COUNT(*) AS n FROM orders WHERE invoice_no IS NOT NULL GROUP BY invoice_no HAVING n > 1").all();
    expect(dup.results).toHaveLength(0);
  });

  it("marks a failed payment failed and leaves the student un-enrolled", async () => {
    const course = await makeCourse();
    const { client } = await registerStudent();
    const { publicId } = await buy(client, [course.slug]);
    await payMock(publicId, "failed");
    expect((await orderRow(publicId)).status).toBe("failed");
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(0);
  });

  it("prices are computed on the server — a tampered client price is ignored", async () => {
    const course = await makeCourse({ price: 777 });
    const { client } = await registerStudent();
    const res = await client.post("/api/checkout", { courses: [course.slug], channel: "mock", price: 1, total: 1, amount: 1 });
    expect(res.status).toBe(201);
    expect((await orderRow((await json(res)).order.public_id)).total).toBe(777);
  });

  it("refuses draft, coming-soon and already-owned classes", async () => {
    const draft = await makeCourse({ status: "draft" });
    const soon = await makeCourse({ status: "coming_soon" });
    const owned = await makeCourse();
    const { client } = await registerStudent();
    expect((await buy(client, [draft.slug])).res.status).toBe(422);
    expect((await buy(client, [soon.slug])).res.status).toBe(422);
    await buyAndPay(client, [owned.slug]);
    const again = await buy(client, [owned.slug]);
    expect(again.res.status).toBe(409);
    expect(again.body.error.code).toBe("already_enrolled");
  });

  it("requires login and an available payment channel", async () => {
    const course = await makeCourse();
    expect((await new Client().post("/api/checkout", { courses: [course.slug], channel: "mock" })).status).toBe(401);
    const { client } = await registerStudent();
    const bad = await client.post("/api/checkout", { courses: [course.slug], channel: "bkash" });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error.code).toBe("payment_unavailable");
  });

  it("free classes enroll with a single click and still get an invoice", async () => {
    const free = await makeCourse({ price: 0 });
    const { client } = await registerStudent();
    const res = await client.post("/api/checkout", { courses: [free.slug] });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.order.status).toBe("paid");
    expect((await orderRow(body.order.public_id)).invoice_no).toMatch(/^INV-MWH-/);
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(1);
  });

  it("bundles split the bundle price across the classes", async () => {
    const a = await makeCourse({ price: 600 });
    const b = await makeCourse({ price: 400 });
    const bundle = await env.DB.prepare("INSERT INTO bundles (slug, title_bn, title_en, price, status) VALUES (?, 'বান্ডেল', 'Bundle', 700, 'published')").bind(`bundle-${seq}`).run();
    const bundleId = bundle.meta.last_row_id as number;
    await env.DB.batch([a, b].map((c) => env.DB.prepare("INSERT INTO bundle_items (bundle_id, course_id) VALUES (?, ?)").bind(bundleId, c.id)));
    const { client } = await registerStudent();
    const res = await client.post("/api/checkout", { bundle_id: bundleId, channel: "mock" });
    expect(res.status).toBe(201);
    const publicId = (await json(res)).order.public_id;
    const items = await env.DB.prepare("SELECT course_id, price, list_price FROM order_items WHERE order_id = (SELECT id FROM orders WHERE public_id = ?) ORDER BY course_id").bind(publicId).all<any>();
    expect(items.results.map((i) => i.price)).toEqual([420, 280]);
    expect(items.results.reduce((s, i) => s + i.price, 0)).toBe(700);
    await payMock(publicId);
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------------------------------------ coupons */
describe("coupons", () => {
  const quote = async (client: Client, slugs: string[], coupon: string) => client.post("/api/checkout/quote", { courses: slugs, coupon });

  it("applies percent coupons with a cap and a minimum order", async () => {
    await env.DB.prepare("INSERT INTO coupons (code, type, value, min_order, max_discount) VALUES ('PCT20', 'percent', 20, 1000, 150)").run();
    const big = await makeCourse({ price: 2000 });
    const small = await makeCourse({ price: 500 });
    const { client } = await registerStudent();
    const ok = await json(await quote(client, [big.slug], "pct20"));
    expect(ok.quote.discount).toBe(150); // 20% of 2000 = 400, capped at 150
    expect(ok.quote.total).toBe(1850);
    const low = await quote(client, [small.slug], "PCT20");
    expect(low.status).toBe(422);
    expect((await json(low)).error.code).toBe("coupon_min_order");
  });

  it("rejects expired, unknown, exhausted and out-of-scope coupons", async () => {
    await env.DB.prepare("INSERT INTO coupons (code, type, value, expires_at) VALUES ('OLD', 'flat', 10, '2020-01-01T00:00:00Z')").run();
    await env.DB.prepare("INSERT INTO coupons (code, type, value, max_uses, used_count) VALUES ('GONE', 'flat', 10, 1, 1)").run();
    await env.DB.prepare("INSERT INTO coupons (code, type, value) VALUES ('SCOPED', 'flat', 10)").run();
    const target = await makeCourse({ price: 300 });
    const other = await makeCourse({ price: 300 });
    await env.DB.prepare("INSERT INTO coupon_courses (coupon_id, course_id) VALUES ((SELECT id FROM coupons WHERE code = 'SCOPED'), ?)").bind(target.id).run();
    const { client } = await registerStudent();
    expect((await json(await quote(client, [target.slug], "OLD"))).error.code).toBe("coupon_expired");
    expect((await json(await quote(client, [target.slug], "GONE"))).error.code).toBe("coupon_used");
    expect((await json(await quote(client, [target.slug], "NOPE"))).error.code).toBe("invalid_coupon");
    expect((await json(await quote(client, [other.slug], "SCOPED"))).error.code).toBe("coupon_not_applicable");
    expect((await json(await quote(client, [target.slug], "SCOPED"))).quote.discount).toBe(10);
  });

  it("limits use per student, and a 100% coupon enrolls instantly", async () => {
    await env.DB.prepare("INSERT INTO coupons (code, type, value, per_student_limit) VALUES ('FREEALL', 'percent', 100, 1)").run();
    const a = await makeCourse({ price: 400 });
    const b = await makeCourse({ price: 400 });
    const { client } = await registerStudent();
    const first = await client.post("/api/checkout", { courses: [a.slug], coupon: "FREEALL" });
    expect(first.status).toBe(201);
    expect((await json(first)).order.status).toBe("paid");
    const second = await client.post("/api/checkout/quote", { courses: [b.slug], coupon: "FREEALL" });
    expect(second.status).toBe(422);
    expect((await json(second)).error.code).toBe("coupon_used");
  });
});

/* ------------------------------------------------------------------------------------------------ manual */
describe("manual send-money payments", () => {
  it("records the TrxID, waits for staff, and refuses a TrxID that was already used", async () => {
    const course = await makeCourse({ price: 650 });
    const { client } = await registerStudent();
    const proof = { method: "bkash", trx_id: "8n7a6d5e4c", payer_number: "01712345678" };
    const res = await client.post("/api/checkout", { courses: [course.slug], channel: "manual", manual: proof });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.order.status).toBe("awaiting_verification");
    const row = await orderRow(body.order.public_id);
    expect(row.gateway_txn).toBe("8N7A6D5E4C");
    expect(row.invoice_no).toBeNull();
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(0);

    const { client: other } = await registerStudent();
    const reuse = await other.post("/api/checkout", { courses: [course.slug], channel: "manual", manual: proof });
    expect(reuse.status).toBe(409);
    expect((await json(reuse)).error.code).toBe("trx_used");
  });

  it("validates the proof fields", async () => {
    const course = await makeCourse();
    const { client } = await registerStudent();
    const bad = await client.post("/api/checkout", { courses: [course.slug], channel: "manual", manual: { method: "bkash", trx_id: "x", payer_number: "123" } });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.fields).toMatchObject({ "manual.trx_id": "invalid_trx", "manual.payer_number": "invalid_phone" });
  });
});

/* ------------------------------------------------------------------------------------------------ SSLCommerz */
describe("SSLCommerz (gateway calls stubbed)", () => {
  // what the (stubbed) SSLCommerz validator API will answer; null = validator unreachable
  let validation: Record<string, unknown> | null = null;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    validation = null;
    spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("gwprocess")) {
        return Response.json({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw?SESSIONKEY=abc", sessionkey: "abc" });
      }
      if (url.includes("validationserverAPI")) return validation ? Response.json(validation) : new Response("down", { status: 503 });
      return new Response("unexpected " + url, { status: 500 });
    }) as typeof fetch);
  });

  async function start(price = 1850) {
    const course = await makeCourse({ price });
    const { client } = await registerStudent();
    const res = await client.post("/api/checkout", { courses: [course.slug], channel: "sslcommerz" });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = await json(res);
    return { course, client, publicId: body.order.public_id as string, body };
  }

  it("creates a hosted-page session and enrolls from the IPN after server-side validation", async () => {
    const { client, publicId, body } = await start(1850);
    expect(body.redirect_url).toContain("sandbox.sslcommerz.com");
    const initCall = spy.mock.calls.find((c: unknown[]) => String(c[0]).includes("gwprocess"))!;
    const sent = new URLSearchParams(String((initCall[1] as RequestInit).body));
    expect(sent.get("total_amount")).toBe("1850.00");
    expect(sent.get("tran_id")).toBe(publicId);
    expect(sent.get("ipn_url")).toMatch(/\/api\/payments\/sslcommerz\/ipn$/);

    validation = { status: "VALID", tran_id: publicId, amount: "1850.00", currency: "BDT", bank_tran_id: "BANK123", card_type: "BKASH-BKash", risk_level: "0", val_id: "v1" };
    const ipn = await new Client().fetch("/api/payments/sslcommerz/ipn", { method: "POST", form: { tran_id: publicId, val_id: "v1", status: "VALID" } });
    expect(ipn.status).toBe(200);
    const order = await orderRow(publicId);
    expect(order.status).toBe("paid");
    expect(order.method).toBe("bkash");
    expect(order.gateway_txn).toBe("BANK123");
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(1);
  });

  it("rejects a payment whose validated amount does not match the order", async () => {
    const { client, publicId } = await start(1850);
    validation = { status: "VALID", tran_id: publicId, amount: "10.00", currency: "BDT", bank_tran_id: "X", card_type: "VISA", risk_level: "0", val_id: "v2" };
    await new Client().fetch("/api/payments/sslcommerz/ipn", { method: "POST", form: { tran_id: publicId, val_id: "v2" } });
    expect((await orderRow(publicId)).status).toBe("failed");
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(0);
  });

  it("holds risky payments for a human instead of auto-enrolling", async () => {
    const { client, publicId } = await start(500);
    validation = { status: "VALID", tran_id: publicId, amount: "500.00", currency: "BDT", bank_tran_id: "X", card_type: "VISA", risk_level: "1", val_id: "v3" };
    await new Client().fetch("/api/payments/sslcommerz/ipn", { method: "POST", form: { tran_id: publicId, val_id: "v3" } });
    expect((await orderRow(publicId)).status).toBe("awaiting_verification");
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(0);
  });

  it("does NOT trust the browser success redirect on its own", async () => {
    const { client, publicId } = await start(500);
    validation = null; // validator unreachable
    const res = await new Client().fetch(`/api/payments/sslcommerz/success?tran_id=${publicId}&val_id=fake`, { method: "GET" });
    expect(res.status).toBe(303);
    expect((await orderRow(publicId)).status).toBe("pending");
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------------------------------ learning */
describe("learning: access control, progress and certificates", () => {
  it("locks lessons for strangers and non-buyers, but lets anyone watch a free preview", async () => {
    const course = await makeCourse({ resource: true });
    const [preview, locked] = course.lessons;
    const stranger = new Client();
    expect((await stranger.get(`/api/student/lessons/${locked}`)).status).toBe(401);
    const preview1 = await stranger.get(`/api/preview/lessons/${preview}`);
    expect(preview1.status).toBe(200);
    expect((await json(preview1)).lesson.resources).toEqual([]); // previews never expose downloads
    expect((await stranger.get(`/api/preview/lessons/${locked}`)).status).toBe(401);

    const { client: nonBuyer } = await registerStudent();
    const denied = await nonBuyer.get(`/api/student/lessons/${locked}`);
    expect(denied.status).toBe(403);
    expect((await json(denied)).error.code).toBe("not_enrolled");
    expect((await nonBuyer.get(`/api/student/resources/${course.resourceId}/download`)).status).toBe(403);
  });

  it("serves lessons and private files to enrolled students, sanitising lesson notes", async () => {
    const course = await makeCourse({ resource: true });
    const { client } = await registerStudent();
    await buyAndPay(client, [course.slug]);
    const lesson = (await json(await client.get(`/api/student/lessons/${course.lessons[1]}`))).lesson;
    expect(lesson.external.embed_url).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(lesson.body_html_bn).toContain("<strong>গুরুত্বপূর্ণ</strong>");
    expect(lesson.body_html_en).not.toContain("<script>");
    expect(lesson.body_html_en).toContain("&lt;script&gt;");
    expect(lesson.resources).toHaveLength(1);
    expect(lesson.prev_id).toBe(course.lessons[0]);
    expect(lesson.next_id).toBe(course.lessons[2]);

    const file = await client.get(`/api/student/resources/${course.resourceId}/download`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain("attachment");
    expect(file.headers.get("cache-control")).toContain("no-store");
    expect(await file.text()).toBe("%PDF-1.4 test");
  });

  it("tracks progress and issues a verifiable certificate at 100% — exactly once", async () => {
    const course = await makeCourse({ lessons: 3 });
    const { client, body } = await registerStudent(undefined, { name: "রহিমা বেগম" });
    await buyAndPay(client, [course.slug]);

    const r1 = await json(await client.post(`/api/student/lessons/${course.lessons[0]}/complete`));
    expect(r1.progress).toEqual({ done: 1, total: 3, pct: 33 });
    expect(r1.certificate).toBeNull();
    await client.post(`/api/student/lessons/${course.lessons[1]}/complete`);
    await client.post(`/api/student/lessons/${course.lessons[1]}/complete`); // idempotent
    expect((await json(await client.get(`/api/student/courses/${course.slug}`))).progress.done).toBe(2);

    const last = await json(await client.post(`/api/student/lessons/${course.lessons[2]}/complete`));
    expect(last.progress.pct).toBe(100);
    expect(last.certificate.code).toMatch(/^MWH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(last.certificate.student_name).toBe("রহিমা বেগম");

    const again = await json(await client.post(`/api/student/lessons/${course.lessons[2]}/complete`));
    expect(again.certificate.code).toBe(last.certificate.code);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM certificates WHERE student_id = ?").bind(body.student.id).first<{ n: number }>();
    expect(count!.n).toBe(1);

    // anyone can verify it — even with sloppy input
    const anon = new Client();
    const verified = await json(await anon.get(`/api/certificates/verify/${last.certificate.code}`));
    expect(verified).toMatchObject({ valid: true, revoked: false });
    expect(verified.certificate.course_title_en).toContain("Test Course");
    const sloppy = last.certificate.code.toLowerCase().replace(/-/g, " ").replace(/0/g, "o");
    expect((await json(await anon.get(`/api/certificates/verify/${encodeURIComponent(sloppy)}`))).valid).toBe(true);
    expect((await json(await anon.get("/api/certificates/verify/MWH-ZZZZ-ZZZZ-ZZZZ"))).valid).toBe(false);
    expect((await json(await anon.get("/api/certificates/verify/garbage"))).valid).toBe(false);
  });

  it("a revoked certificate no longer verifies as valid", async () => {
    const course = await makeCourse({ lessons: 1 });
    const { client } = await registerStudent();
    await buyAndPay(client, [course.slug]);
    const { certificate } = await json(await client.post(`/api/student/lessons/${course.lessons[0]}/complete`));
    await env.DB.prepare("UPDATE certificates SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), revoked_reason = 'test' WHERE code = ?").bind(certificate.code).run();
    expect(await json(await new Client().get(`/api/certificates/verify/${certificate.code}`))).toMatchObject({ valid: false, revoked: true });
  });

  it("drip content keeps later modules locked until their release day", async () => {
    const course = await makeCourse({ lessons: 2 });
    await env.DB.prepare("UPDATE modules SET drip_days = 7 WHERE course_id = ?").bind(course.id).run();
    const { client } = await registerStudent();
    await buyAndPay(client, [course.slug]);
    const locked = await client.get(`/api/student/lessons/${course.lessons[1]}`);
    expect(locked.status).toBe(403);
    expect((await json(locked)).error.code).toBe("lesson_locked");
    // the free-preview lesson is never drip-locked
    expect((await client.get(`/api/student/lessons/${course.lessons[0]}`)).status).toBe(200);
  });
});

/* ------------------------------------------------------------------------------------------------ reviews */
describe("reviews: enrolled students only, moderated", () => {
  it("refuses a review from someone who did not enroll", async () => {
    const course = await makeCourse();
    const { client } = await registerStudent();
    const res = await client.post("/api/student/reviews", { course_id: course.id, rating: 5, body: "Great!" });
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("not_enrolled");
    expect((await new Client().post("/api/student/reviews", { course_id: course.id, rating: 5, body: "x" })).status).toBe(401);
  });

  it("accepts a review from an enrolled student, hides it until approved, then averages it in", async () => {
    const course = await makeCourse();
    const { client, body } = await registerStudent(undefined, { name: "Nusrat Jahan" });
    await buyAndPay(client, [course.slug]);
    const res = await client.post("/api/student/reviews", { course_id: course.id, rating: 5, body: "চমৎকার ক্লাস" });
    expect(res.status).toBe(201);

    const before = await json(await new Client().get(`/api/courses/${course.slug}`));
    expect(before.reviews).toHaveLength(0);
    expect(before.course.rating_count).toBe(0);

    await env.DB.prepare("UPDATE reviews SET status = 'approved' WHERE course_id = ? AND student_id = ?").bind(course.id, body.student.id).run();
    await refreshCourseRating(env as never, course.id);
    const after = await json(await new Client().get(`/api/courses/${course.slug}`));
    expect(after.reviews).toHaveLength(1);
    expect(after.reviews[0].author).toBe("Nusrat J.");
    expect(after.course.rating_count).toBe(1);
    expect(after.course.rating_avg).toBe(5);

    // editing an approved review sends it back to moderation and out of the public average
    await client.post("/api/student/reviews", { course_id: course.id, rating: 4, body: "ঠিকঠাক" });
    const edited = await json(await new Client().get(`/api/courses/${course.slug}`));
    expect(edited.reviews).toHaveLength(0);
    expect(edited.course.rating_count).toBe(0);
  });

  it("validates the rating range", async () => {
    const course = await makeCourse();
    const { client } = await registerStudent();
    await buyAndPay(client, [course.slug]);
    expect((await client.post("/api/student/reviews", { course_id: course.id, rating: 6, body: "x" })).status).toBe(422);
    expect((await client.post("/api/student/reviews", { course_id: course.id, rating: 0, body: "x" })).status).toBe(422);
  });
});

/* ------------------------------------------------------------------------------------------------ public forms */
describe("public forms (work without JavaScript, rate-limited)", () => {
  it("coming-soon notify list: stores once per e-mail, JSON for scripts, redirect for plain forms", async () => {
    const soon = await makeCourse({ status: "coming_soon" });
    const c = new Client();
    const email = `notify${Date.now()}@example.test`;
    expect((await c.post("/api/notify", { course: soon.slug, email })).status).toBe(200);
    expect((await c.post("/api/notify", { course: soon.slug, email: email.toUpperCase() })).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM notify_signups WHERE course_id = ?").bind(soon.id).first<{ n: number }>();
    expect(n!.n).toBe(1);

    const html = await c.fetch("/api/notify", { method: "POST", form: { course: soon.slug, email: `b${email}` }, headers: { accept: "text/html", referer: "https://academy.test/courses/x" } });
    expect(html.status).toBe(303);
    expect(html.headers.get("location")).toContain("n=notify_ok");

    const published = await makeCourse({ status: "published" });
    expect((await c.post("/api/notify", { course: published.slug, email })).status).toBe(422);
  });

  it("rate-limits the public forms per client", async () => {
    const soon = await makeCourse({ status: "coming_soon" });
    const c = new Client();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await c.post("/api/notify", { course: soon.slug, email: `spam${i}@example.test` })).status);
    expect(statuses.slice(0, 8).every((s) => s === 200)).toBe(true);
    expect(statuses).toContain(429);
  });

  it("stores contact messages and newsletter subscribers", async () => {
    const c = new Client();
    expect((await c.post("/api/contact", { name: "Tester", email: "t@example.test", message: "Hello, is the brownie class good for beginners?" })).status).toBe(200);
    expect((await c.post("/api/newsletter", { email: "news@example.test" })).status).toBe(200);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM contact_messages").first<{ n: number }>())!.n).toBeGreaterThan(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE email = 'news@example.test'").first<{ n: number }>())!.n).toBe(1);
  });
});
