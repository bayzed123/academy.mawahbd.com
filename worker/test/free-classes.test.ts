import { describe, expect, it } from "vitest";
import { Client, env, json, registerStudent } from "./helpers";

/*
 * The free classes (the owner: "a Free class button in the navigation, beside the day / night switch, that shows every free class; after
 * enrolling, the student's page has the paid courses and the free classes under separate buttons — on the website and in the app").
 *  - every page's header has "Free classes" beside the night / day switch, and the menu and the footer have it too;
 *  - /free-classes lists the website's free classes (price 0) and then the free demos of the paid classes — never an Android app class;
 *  - the student's own classes say which are free, so My Learning can keep them apart.
 */
let seq = 0;
async function makeClass(o: { price: number; demo?: string; channel?: "website" | "app"; status?: string; title?: string }) {
  const slug = `free-page-${Date.now().toString(36)}-${seq++}`;
  const title = o.title ?? `Class ${slug}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, price, status, category_id, instructor_id, published_at, demo_url, channel)
     VALUES (?, ?, ?, '', '', ?, ?, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, ?)`,
  )
    .bind(slug, title, title, o.price, o.status ?? "published", o.demo ?? "", o.channel ?? "website")
    .run();
  return { id: res.meta.last_row_id as number, slug, title };
}
const body = async (path: string) => {
  const html = await (await new Client().get(path)).text();
  return html.slice(html.indexOf("<body"));
};
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("the Free classes button", () => {
  it("sits in every page's header beside the night / day switch, and in the menu and the footer, in both languages", async () => {
    for (const [path, label, href] of [
      ["/", "ফ্রি ক্লাস", "/free-classes"],
      ["/en/courses", "Free classes", "/en/free-classes"],
      ["/en/about", "Free classes", "/en/free-classes"],
    ] as const) {
      const html = await body(path);
      const actions = /<div class="nav-actions">([\s\S]*?)<details class="menu">/.exec(html)?.[1] ?? "";
      // the button comes right before the night / day switch
      expect(actions, path).toMatch(new RegExp(`<a class="free-btn" href="${href}"[^>]*>[\\s\\S]*?<span class="free-label">${label}</span></a><button class="theme-toggle"`));
      expect(html, path).toContain(`<a class="menu-free" href="${href}">`);
      expect(html.slice(html.indexOf('<footer class="site-footer">')), path).toContain(`<a href="${href}">${label}</a>`);
    }
    // the page itself marks its own button
    expect(await body("/free-classes")).toMatch(/<a class="free-btn" href="\/free-classes" aria-current="page">/);
  });
});

describe("the Free classes page", () => {
  it("lists the free classes, then the paid classes' free demos — never a draft, a demo that cannot play, or an app class", async () => {
    const free = await makeClass({ price: 0, title: "Zero Taka Cupcakes" });
    const demo = await makeClass({ price: 1200, demo: YT, title: "Sponge With A Demo" });
    const noDemo = await makeClass({ price: 1200, title: "Paid Without Demo" });
    const draft = await makeClass({ price: 0, status: "draft", title: "Draft Freebie" });
    const app = await makeClass({ price: 0, channel: "app", title: "Only In The App" });
    const res = await new Client().get("/en/free-classes");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Free cooking classes — MAWAH Academy</title>");
    const page = html.slice(html.indexOf("<main"));
    const freeRow = /<section class="section tight" id="free"[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
    const demoRow = /<section class="section band" id="demos"[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
    expect(freeRow).toContain(free.title);
    expect(freeRow).not.toContain(demo.title);
    expect(demoRow).toContain(demo.title);
    expect(demoRow).toContain(`href="/en/courses/${demo.slug}#demo"`); // straight to the demo on the class page
    expect(demoRow).not.toContain(free.title);
    for (const hidden of [noDemo, draft, app]) expect(page, hidden.title).not.toContain(hidden.title);
    // after enrolling, the student's page keeps paid and free apart: said on the page
    expect(page).toContain("My Learning keeps your paid classes and your free classes under separate buttons.");
  });

  it("is in Bangla at /free-classes, has its breadcrumb, and is in the sitemap in both languages", async () => {
    const html = await (await new Client().get("/free-classes")).text();
    expect(html).toContain('<html lang="bn"');
    expect(html).toContain("<h1>ফ্রি ক্লাস</h1>");
    expect(html).toContain('"@type":"BreadcrumbList"');
    const map = await (await new Client().get("/sitemap.xml")).text();
    expect(map).toContain("/free-classes</loc>");
    expect(map).toContain("/en/free-classes</loc>");
  });
});

describe("a student's own classes", () => {
  it("say which are free (a free class, an app class) and which are paid — a paid class given for nothing stays paid", async () => {
    const { client, id } = await registerStudent();
    const free = await makeClass({ price: 0 });
    const app = await makeClass({ price: 0, channel: "app" });
    const paid = await makeClass({ price: 1500 });
    const gifted = await makeClass({ price: 900 });
    const enrol = (courseId: number, source: string) =>
      env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', ?)").bind(id, courseId, source).run();
    await enrol(free.id, "free");
    await enrol(app.id, "free");
    await enrol(paid.id, "purchase");
    await enrol(gifted.id, "free"); // a 100 % coupon
    const { courses } = await json<{ courses: { course: { slug: string }; free: boolean }[] }>(await client.get("/api/student/courses"));
    const byslug = Object.fromEntries(courses.map((m) => [m.course.slug, m.free]));
    expect(byslug).toEqual({ [free.slug]: true, [app.slug]: true, [paid.slug]: false, [gifted.slug]: false });
  });
});
