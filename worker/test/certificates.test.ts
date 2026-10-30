import { describe, expect, it } from "vitest";
import { CERT_JS } from "../src/generated/assets";
import { fitSize, lineEms, twoLines } from "../src/views/certificate";
import { Client, env, json, loginStaff, registerStudent } from "./helpers";

/*
 * The certificate, after the owner's fifth round ("still not to see any certificate design… students can download it"). One drawing (SVG,
 * an A4 page on its side) is the page, the PDF (the browser's own Save as PDF) and the picture (marketing/cert.js). A class taught live
 * has no lessons in the app to finish, so the academy issues its certificates by hand: one student, or a whole class at once.
 */
const text = async (path: string) => (await new Client().get(path)).text();
const body = (page: string) => page.slice(page.indexOf("<body"));

let seq = 0;
async function makeClass(opts: { lessons?: number; cert?: boolean; status?: string } = {}) {
  const slug = `cert-class-${Date.now().toString(36)}-${seq++}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, long_bn, long_en, price, status, category_id, instructor_id, cert_enabled, published_at)
     VALUES (?, 'লাইভ কেক ক্লাস', 'Live Cake Class', '', '', '', '', 500, ?, 1, 1, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, opts.status ?? "published", opts.cert === false ? 0 : 1)
    .run();
  const id = res.meta.last_row_id as number;
  const lessons: number[] = [];
  if (opts.lessons) {
    const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en) VALUES (?, 'ম', 'M')").bind(id).run();
    for (let i = 0; i < opts.lessons; i++) {
      const l = await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, sort) VALUES (?, ?, 'ল', 'L', 'external', 'https://vimeo.com/123456789', ?)")
        .bind(id, mod.meta.last_row_id, i)
        .run();
      lessons.push(l.meta.last_row_id as number);
    }
  }
  return { id, slug, lessons };
}
async function enrol(courseId: number, name = "Rahima Akter") {
  const { id } = await registerStudent(new Client(), { name });
  await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, source) VALUES (?, ?, 'admin')").bind(id, courseId).run();
  return id;
}
const certOf = (studentId: number, courseId: number) =>
  env.DB.prepare("SELECT code, student_name, revoked_at FROM certificates WHERE student_id = ? AND course_id = ?").bind(studentId, courseId).first<{ code: string; student_name: string; revoked_at: string | null }>();

describe("the certificate's design", () => {
  it("is one drawing with the student's name, the class, the date, the code and a QR code — with Download PDF and Download picture", async () => {
    const c = await makeClass();
    const sid = await enrol(c.id, "Fatema Khatun");
    const admin = (await loginStaff("super_admin")).client;
    expect((await admin.post("/api/admin/certificates/issue", { course_id: c.id, student_id: sid })).status).toBe(200);
    const { code } = (await certOf(sid, c.id))!;

    const res = await new Client().get(`/en/certificate/${code}`);
    expect(res.status).toBe(200);
    const page = await res.text();
    const art = /<svg class="cert-art"[\s\S]*?<\/svg>\s*<\/div>/.exec(page)?.[0] ?? "";
    expect(art).toContain('viewBox="0 0 1123 794"'); // an A4 page on its side
    expect(art).toContain('role="img" aria-labelledby="cert-title cert-desc"');
    expect(art).toContain('<title id="cert-title">Certificate of Completion: Fatema Khatun</title>');
    expect(art).toContain(`<desc id="cert-desc">Fatema Khatun has successfully completed the class Live Cake Class at MAWAH Academy.`);
    expect(art).toContain(`>${code}</text>`);
    expect(art).toContain('<svg class="cert-qr" x="104" y="557" width="132" height="132"');
    expect(art).toContain('<image href="/logo.webp"');
    expect(art).not.toContain("SAMPLE");
    // the buttons: the browser's own Save as PDF, and the picture (shown by the script that makes it), and the certificate check
    const b = body(page);
    expect(b).toContain('<button class="btn btn-primary" type="button" data-print="true">');
    expect(b).toContain(`data-cert-png="true" data-file="MAWAH-certificate-${code}.png"`);
    expect(b).toContain(`href="/en/verify/${code}"`);
    expect(b).toContain("Download PDF opens the print window: choose “Save as PDF”.");
    expect(page).toContain(`<script src="${CERT_JS}" defer="">`);
    // in Bangla: the Bangla words and the Bangla date
    const bn = await text(`/certificate/${code}`);
    expect(bn).toContain(">সম্পন্নকরণ সনদ</text>");
    expect(bn).toContain(">লাইভ কেক ক্লাস</text>");
    expect(bn).toContain(">সনদ নম্বর</text>");
  });

  it("has a public sample, marked SAMPLE across, with a class's name when asked — never a hidden class's, and no certificate check", async () => {
    const page = await text("/en/certificate/sample?class=beginners-baking-class");
    const art = /<svg class="cert-art"[\s\S]*?<\/svg>\s*<\/div>/.exec(page)?.[0] ?? "";
    expect(art).toContain(">Your Name</text>");
    expect(art).toContain(">Beginners Baking Class</text>");
    expect(art).toContain(">SAMPLE</text>");
    expect(art).toContain(">MWH-0000-0000-0000</text>");
    expect(body(page)).toContain("This is a sample of our certificate.");
    expect(body(page)).not.toContain("/verify/MWH-0000");
    expect(await text("/en/certificate/sample")).toContain(">Your class at MAWAH Academy</text>");
    const draft = await makeClass({ status: "draft" });
    expect(await text(`/en/certificate/sample?class=${draft.slug}`)).not.toContain("Live Cake Class");
    expect(await text("/certificate/sample")).toContain(">নমুনা</text>");
    // the class page offers it under its certificate line
    expect(await text("/en/courses/beginners-baking-class")).toContain('href="/en/certificate/sample?class=beginners-baking-class">See a sample</a>');
  });

  it("chooses a size for the name that fits the line, and splits a long class name over two lines at the best word", () => {
    expect(fitSize("Fatema", 600, 58, 30)).toBe(58);
    const long = "Mohammad Abdullah Al Mamun Chowdhury";
    const size = fitSize(long, 600, 58, 30);
    expect(size).toBeLessThan(58);
    expect(size).toBeGreaterThan(30);
    expect(size * lineEms(long)).toBeLessThanOrEqual(600);
    expect(fitSize("x".repeat(400), 600, 58, 30)).toBe(30); // never under the smallest size: the page's script narrows the rest
    // a Bangla letter's vowel signs and marks sit on it: they hardly widen the line
    expect(lineEms("কি")).toBeLessThan(lineEms("কক"));
    expect(twoLines("Beginners Baking Class", 20)).toEqual(["Beginners Baking Class"]);
    expect(twoLines("Professional Cake Decoration and Fondant Masterclass for Home Bakers", 20)).toEqual([
      "Professional Cake Decoration and",
      "Fondant Masterclass for Home Bakers",
    ]);
  });
});

describe("issuing certificates by hand", () => {
  it("a whole class at once: everyone enrolled who has none — taken-back enrolments and existing certificates are left as they are", async () => {
    const c = await makeClass(); // taught live: no lessons in the app
    const a = await enrol(c.id, "Student A");
    const b = await enrol(c.id, "Student B");
    const gone = await enrol(c.id, "Student Gone");
    await env.DB.prepare("UPDATE enrollments SET status = 'revoked' WHERE student_id = ? AND course_id = ?").bind(gone, c.id).run();
    const admin = (await loginStaff("super_admin")).client;

    const before = await json(await admin.get(`/api/admin/certificates/class/${c.id}`));
    expect(before).toMatchObject({ enrolled: 2, lessons: 0, with_cert: 0, to_all: 2, to_finished: 0, course: { id: c.id, cert_enabled: true } });

    const res = await admin.post("/api/admin/certificates/issue", { course_id: c.id, who: "all" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ issued: 2, more: false });
    for (const sid of [a, b]) expect((await certOf(sid, c.id))?.code).toMatch(/^MWH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(await certOf(gone, c.id)).toBeNull();
    expect((await certOf(a, c.id))!.student_name).toBe("Student A");
    // each code is its own
    expect((await certOf(a, c.id))!.code).not.toBe((await certOf(b, c.id))!.code);

    // again: nothing new, and a certificate that was taken back stays taken back
    await env.DB.prepare("UPDATE certificates SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE student_id = ? AND course_id = ?").bind(b, c.id).run();
    expect(await json(await admin.post("/api/admin/certificates/issue", { course_id: c.id, who: "all" }))).toMatchObject({ issued: 0 });
    expect((await certOf(b, c.id))!.revoked_at).not.toBeNull();
    expect(await json(await admin.get(`/api/admin/certificates/class/${c.id}`))).toMatchObject({ with_cert: 2, to_all: 0 });

    // the activity log says who issued how many, for which class
    const log = await json(await admin.get("/api/admin/activity?action=certificate.issued"));
    expect(JSON.stringify(log.items)).toContain("2 × Live Cake Class");
  });

  it("only those who finished every lesson, when the owner chooses that", async () => {
    const c = await makeClass({ lessons: 2 });
    const done = await enrol(c.id, "Finished");
    const half = await enrol(c.id, "Halfway");
    for (const l of c.lessons) await env.DB.prepare("INSERT INTO lesson_progress (student_id, lesson_id, course_id) VALUES (?, ?, ?)").bind(done, l, c.id).run();
    await env.DB.prepare("INSERT INTO lesson_progress (student_id, lesson_id, course_id) VALUES (?, ?, ?)").bind(half, c.lessons[0], c.id).run();
    const admin = (await loginStaff("super_admin")).client;
    expect(await json(await admin.get(`/api/admin/certificates/class/${c.id}`))).toMatchObject({ enrolled: 2, lessons: 2, to_all: 2, to_finished: 1 });
    expect(await json(await admin.post("/api/admin/certificates/issue", { course_id: c.id, who: "finished" }))).toMatchObject({ issued: 1 });
    expect(await certOf(done, c.id)).not.toBeNull();
    expect(await certOf(half, c.id)).toBeNull();
  });

  it("one student from their page — and says plainly why not: already has one, taken back, not in the class, certificates off", async () => {
    const c = await makeClass();
    const sid = await enrol(c.id, "Nusrat Jahan");
    const admin = (await loginStaff("super_admin")).client;
    const issue = (student_id: number, course_id = c.id) => admin.post("/api/admin/certificates/issue", { course_id, student_id });

    expect(await json(await issue(sid))).toMatchObject({ issued: 1 });
    expect((await certOf(sid, c.id))?.student_name).toBe("Nusrat Jahan");
    let res = await issue(sid);
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("cert_exists");

    await env.DB.prepare("UPDATE certificates SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE student_id = ? AND course_id = ?").bind(sid, c.id).run();
    res = await issue(sid);
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("cert_revoked");

    const stranger = (await registerStudent()).id;
    res = await issue(stranger);
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("not_enrolled");

    const off = await makeClass({ cert: false });
    const sid2 = await enrol(off.id);
    res = await issue(sid2, off.id);
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("cert_off");
    expect(await json(await admin.get(`/api/admin/certificates/class/${off.id}`))).toMatchObject({ course: { cert_enabled: false } });
    expect((await admin.post("/api/admin/certificates/issue", { course_id: 99999999 })).status).toBe(404);
  });

  it("the student has it at once: in the app's list, on My Learning and at the certificate check", async () => {
    const c = await makeClass();
    const { client, id: sid } = await registerStudent(new Client(), { name: "Sadia Islam" });
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, source) VALUES (?, ?, 'admin')").bind(sid, c.id).run();
    const admin = (await loginStaff("super_admin")).client;
    await admin.post("/api/admin/certificates/issue", { course_id: c.id, student_id: sid });
    const list = (await json(await client.get("/api/student/certificates"))).certificates as { code: string; course_id: number }[];
    const mine = list.find((x) => x.course_id === c.id);
    expect(mine).toBeTruthy();
    const learning = (await json(await client.get("/api/student/courses"))).courses as { course: { slug: string }; certificate_code: string | null }[];
    expect(learning.find((x) => x.course.slug === c.slug)?.certificate_code).toBe(mine!.code);
    expect(await text(`/en/verify/${mine!.code}`)).toContain("Sadia Islam");
  });

  it("is for the owner and support staff; the others may look but not issue", async () => {
    const c = await makeClass();
    const sid = await enrol(c.id);
    for (const role of ["content_manager", "viewer"] as const) {
      const who = (await loginStaff(role)).client;
      expect((await who.get(`/api/admin/certificates/class/${c.id}`)).status, role).toBe(200);
      expect((await who.post("/api/admin/certificates/issue", { course_id: c.id, student_id: sid })).status, role).toBe(403);
    }
    const support = (await loginStaff("support")).client;
    expect((await support.post("/api/admin/certificates/issue", { course_id: c.id, student_id: sid })).status).toBe(200);
    expect((await new Client().post("/api/admin/certificates/issue", { course_id: c.id })).status).toBe(401);
  });
});
