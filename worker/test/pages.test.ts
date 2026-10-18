import { describe, expect, it } from "vitest";
import { VERIFICATION_FILES } from "../src/generated/verification";
import { verificationRoutes } from "../src/routes/seo";
import { mockSignature } from "../src/services/payments";
import { Client, env, json, registerStudent } from "./helpers";

const text = async (res: Response) => await res.text();

async function course(slug: string, title: string, extra: Record<string, unknown> = {}) {
  const cols = { status: "published", price: 500, long_en: "", long_bn: "", ...extra } as Record<string, unknown>;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, long_bn, long_en, price, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, 'ছোট বিবরণ', 'Short blurb', ?, ?, ?, ?, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, title, title, cols.long_bn, cols.long_en, cols.price, cols.status)
    .run();
  return res.meta.last_row_id as number;
}

describe("home & navigation", () => {
  it("renders the Bangla home page by default with a strict, hash-based CSP", async () => {
    const res = await new Client().get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await text(res);
    expect(html).toContain('<html lang="bn"');
    expect(html).toContain("মাওয়াহ একাডেমি");
    expect(html).toContain("২৬টি অনলাইন ক্লাস"); // the real class count, in Bengali digits

    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toMatch(/style-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves the English site under /en with hreflang alternates and a language toggle", async () => {
    const html = await text(await new Client().get("/en/courses"));
    expect(html).toContain('<html lang="en"');
    expect(html).toContain('hreflang="bn"');
    expect(html).toContain('hreflang="x-default"');
    expect(html).toMatch(/href="\/courses"[^>]*hreflang="bn"|hreflang="bn"[^>]*href="\/courses"/);
    expect(html).toContain("All classes");
  });

  it("shows the official logo with an 'Academy' label in both languages, and the brand icons in the head", async () => {
    for (const [path, label] of [["/", "একাডেমি"], ["/en", "Academy"]] as const) {
      const html = await text(await new Client().get(path));
      // header and footer both carry the lockup: the logo picture (named by the link, so empty alt) + the label
      expect(html.match(/class="brand-logo" src="\/logo-sm\.webp"/g)?.length, path).toBe(2);
      expect(html, path).toContain(`<span class="brand-name">${label}</span>`);
      expect(html, path).toMatch(/<a class="brand" href="[^"]*" aria-label="[^"]+">/);
      expect(html, path).toContain('<meta name="theme-color" content="#070304"');
      expect(html, path).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"');
      expect(html, path).toContain('href="/favicon-32.png"');
      expect(html, path).not.toContain("favicon.svg"); // the drawn monogram is gone
      expect(html, path).not.toMatch(/#073b2c|#0b4d3a|#0f6148/i); // and so is the old green
    }
    // the organisation's structured data points at the square logo file
    expect(await text(await new Client().get("/"))).toContain("/icon-512.png");
  });

  it("a page without a picture of its own is shared with the site's share image, at an address that changes with the picture", async () => {
    // Facebook / WhatsApp keep a picture they fetched once for weeks: a new picture (a new domain on it …) must come with a new address
    for (const path of ["/", "/en", "/en/faq", "/courses"]) {
      const html = await text(await new Client().get(path));
      expect(html, path).toMatch(/<meta property="og:image" content="http:\/\/localhost:8787\/assets\/og\.[0-9a-f]{10}\.jpg"/);
      expect(html, path).toMatch(/<meta name="twitter:image" content="http:\/\/localhost:8787\/assets\/og\.[0-9a-f]{10}\.jpg"/);
      expect(html, path).not.toContain("og-default.jpg");
    }
  });

  it("never ships inline style attributes or inline scripts (CSP-safe markup)", async () => {
    const soon = await course(`soon-${Date.now()}`, "Soon Course", { status: "coming_soon" });
    for (const path of ["/", "/en", "/courses", "/courses/beginners-baking-class", "/contact", "/about", "/verify", "/blog", "/policies/refund"]) {
      const html = await text(await new Client().get(path));
      expect(html, path).not.toMatch(/\sstyle="/);
      expect(html, path).not.toMatch(/\son[a-z]+="/); // onclick=, onerror= …
      // the only <script> tags are external src=… or JSON-LD data blocks
      const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
      for (const attrs of scripts) expect(attrs, path).toMatch(/src=|application\/ld\+json/);
    }
    expect(soon).toBeGreaterThan(0);
  });

  it("every class card shows a banner, a name, a short description, Read More and Enroll Now with its price", async () => {
    const html = await text(await new Client().get("/courses?per_page=60"));
    const cards = html.split('<article class="card').slice(1);
    expect(cards.length).toBe(12); // paginated: 12 per page
    for (const card of cards) {
      expect(card).toContain('class="banner');
      expect(card).toContain("card-title");
      expect(card).toContain("card-desc");
      expect(card).toContain("বিস্তারিত পড়ুন");
      if (card.includes('class="ribbon"')) {
        // a "coming soon" class: badge + notify-me instead of a price and an Enroll button
        expect(card).toContain("badge-soon");
        expect(card).toContain('action="/api/notify"');
        expect(card).not.toContain("এখনই ভর্তি হন");
      } else {
        expect(card).toContain("এখনই ভর্তি হন");
        expect(card).toMatch(/btn-price">৳[০-৯,]+</);
      }
    }
    expect(cards.filter((c) => !c.includes('class="ribbon"')).length).toBeGreaterThan(0);
  });

  it("filters, searches and paginates the class list server-side", async () => {
    const cat = await text(await new Client().get("/en/courses?cat=mishti-halua"));
    expect(cat).toContain("Rasgulla Special Class");
    expect(cat).not.toContain("Exclusive Brownie Master Class");

    const search = await text(await new Client().get("/en/courses?q=biryani"));
    expect(search).toContain("Aurosh Biryani");
    expect(search).toContain('<meta name="robots" content="noindex'); // search results are not indexed

    const page2 = await text(await new Client().get("/en/courses?page=2"));
    expect(page2).toContain('rel="prev"');
    expect(page2).toContain('<meta name="robots" content="noindex');

    const empty = await text(await new Client().get("/en/courses?q=zzzzqqq"));
    expect(empty).toContain("No classes match");
  });

  it("ignores junk query values instead of erroring", async () => {
    const res = await new Client().get("/courses?page=-5&sort=%3Cscript%3E&cat=%27%3B--&level=x");
    expect(res.status).toBe(200);
    expect(await text(res)).not.toContain("<script>alert");
  });
});

describe("course detail page", () => {
  it("has a Course JSON-LD with a BDT offer, a breadcrumb, canonical and Open Graph tags — and no invented ratings", async () => {
    const html = await text(await new Client().get("/en/courses/premium-mishti-master-class"));
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const courseLd = blocks.find((b) => b["@type"] === "Course");
    expect(courseLd.name).toBe("Premium Mishti Master Class");
    expect(courseLd.offers).toMatchObject({ price: 3550, priceCurrency: "BDT" });
    expect(courseLd.provider.name).toBe("MAWAH Academy");
    expect(courseLd.aggregateRating).toBeUndefined(); // no reviews yet -> no rating markup
    expect(blocks.some((b) => b["@type"] === "BreadcrumbList")).toBe(true);
    expect(html).toContain('<link rel="canonical" href="http://localhost:8787/en/courses/premium-mishti-master-class"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain("৳3,550");
    expect(html).toContain("https://www.facebook.com/share/p/1DrGD8Wbp5/"); // the class's Facebook details post
    expect(html).toContain('href="/app/checkout?c=premium-mishti-master-class"');
  });

  it("coming-soon classes show a badge and a notify-me form instead of a price and an Enroll button", async () => {
    const slug = `soon-${Date.now()}`;
    await course(slug, "Winter Pitha Festival", { status: "coming_soon", price: 999 });
    const html = await text(await new Client().get(`/en/courses/${slug}`));
    expect(html).toContain("Coming Soon");
    expect(html).toContain('action="/api/notify"');
    expect(html).not.toContain(`/app/checkout?c=${slug}`);
    expect(html).not.toContain("৳999");
    const courseLd = JSON.parse([...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => m[1]).find((j) => j.includes('"Course"'))!);
    expect(courseLd.offers).toBeUndefined();
  });

  it("unknown, draft or archived classes are a proper 404 page", async () => {
    const slug = `draft-${Date.now()}`;
    await course(slug, "Hidden Draft", { status: "draft" });
    for (const path of [`/courses/${slug}`, "/courses/does-not-exist", "/en/courses/does-not-exist"]) {
      const res = await new Client().get(path);
      expect(res.status, path).toBe(404);
      expect(await text(res)).toContain("<html");
    }
  });

  it("escapes class text and renders Markdown safely (no raw HTML, no javascript: links)", async () => {
    const slug = `xss-${Date.now()}`;
    await course(slug, `<img src=x onerror=alert(1)> Cake`, {
      long_en: "Hello <script>alert('x')</script>\n\n[bad](javascript:alert(1)) and [ok](https://example.com) and **bold**\n\n![p](data:text/html;base64,AAAA)",
    });
    const html = await text(await new Client().get(`/en/courses/${slug}`));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; Cake");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">ok</a>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("data:text/html");
  });

  it("puts reviews in the page itself and lazy-loads only the related classes, as a cacheable HTML fragment", async () => {
    const html = await text(await new Client().get("/en/courses/beginners-baking-class"));
    expect(html).toContain('id="reviews"');
    expect(html).not.toContain('data-fragment="/_f/reviews');
    expect(html).toContain('data-fragment="/_f/related/beginners-baking-class?lang=en"');

    const related = await text(await new Client().get("/_f/related/beginners-baking-class?lang=bn"));
    expect(related).toContain("card-title");
    expect((await new Client().get("/_f/related/nope")).status).toBe(404);
  });

  it("still answers the old reviews fragment, so a page cached before the release can fill its reviews", async () => {
    const reviews = await text(await new Client().get("/_f/reviews/beginners-baking-class?lang=en"));
    expect(reviews).toContain("No reviews yet");
    expect((await new Client().get("/_f/reviews/nope")).status).toBe(404);
  });
});

describe("SEO files", () => {
  it("serves a bilingual sitemap with every class and a robots.txt that hides the apps", async () => {
    const xml = await text(await new Client().get("/sitemap.xml"));
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml.match(/\/courses\/[a-z0-9-]+<\/loc>/g)!.length).toBeGreaterThanOrEqual(52); // 26 classes x 2 languages
    expect(xml).toContain("/en/courses/beginners-baking-class");
    const robots = await text(await new Client().get("/robots.txt"));
    expect(robots).toContain("Disallow: /admin/");
    expect(robots).toContain("Disallow: /app/");
    expect(robots).toContain("Sitemap: http://localhost:8787/sitemap.xml");
  });

  it("serves the proof-of-ownership files other services ask for (Meta, Google Search Console, Bing …) at the root, exactly as given, with a plain 200", async () => {
    const files = { "tgvr8dgfrjxjhoqzqto2mplocbx41n.html": "tgvr8dgfrjxjhoqzqto2mplocbx41n", "BingSiteAuth.xml": '<?xml version="1.0"?>\n<users><user>ABC123</user></users>\n', "verify-me.txt": "google-site-verification: abc" };
    const routes = verificationRoutes(files);
    for (const [name, body] of Object.entries(files)) {
      const res = await routes.request(`/${name}`);
      expect(res.status, name).toBe(200); // not the redirect Cloudflare's asset layer gives "/name.html"
      expect(await res.text(), name).toBe(body);
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    }
    expect((await routes.request("/tgvr8dgfrjxjhoqzqto2mplocbx41n.html")).headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect((await routes.request("/BingSiteAuth.xml")).headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect((await routes.request("/verify-me.txt")).headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect((await routes.request("/tgvr8dgfrjxjhoqzqto2mplocbx41n.html", { method: "HEAD" })).status).toBe(200);
    // only those names, only to read
    expect((await routes.request("/other-file.html")).status).toBe(404);
    expect((await routes.request("/tgvr8dgfrjxjhoqzqto2mplocbx41n.html", { method: "POST" })).status).toBe(404);
    expect((await verificationRoutes({}).request("/tgvr8dgfrjxjhoqzqto2mplocbx41n.html")).status).toBe(404);
  });

  it("serves the files kept in the project's marketing/verification folder, through the whole site (the headers of every page apply), and never lets one take the place of robots.txt or the sitemap", async () => {
    for (const [name, body] of Object.entries(VERIFICATION_FILES)) {
      const res = await new Client().get(`/${name}`);
      expect(res.status, name).toBe(200);
      expect(await res.text(), name).toBe(body);
      expect(res.headers.get("x-content-type-options"), name).toBe("nosniff");
    }
    expect(Object.keys(VERIFICATION_FILES)).not.toContain("robots.txt");
    expect(Object.keys(VERIFICATION_FILES)).not.toContain("sitemap.xml");
    expect(await text(await new Client().get("/robots.txt"))).toContain("User-agent: *");
  });
});

describe("certificate, verification & invoice documents", () => {
  async function completedCourse() {
    const slug = `cert-${Date.now()}`;
    const courseId = await course(slug, "Certificate Test Class", { price: 300 });
    const mod = await env.DB.prepare("INSERT INTO modules (course_id, title_bn, title_en) VALUES (?, 'ম', 'M')").bind(courseId).run();
    const lesson = await env.DB.prepare("INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, sort) VALUES (?, ?, 'ল', 'L', 'external', 'https://vimeo.com/123456789', 1)")
      .bind(courseId, mod.meta.last_row_id)
      .run();
    const { client, body } = await registerStudent(undefined, { name: "Fatema Khatun" });
    const order = await client.post("/api/checkout", { agree: true, courses: [slug], channel: "mock" });
    const publicId = (await json(order)).order.public_id as string;
    await new Client().fetch("/api/payments/mock/webhook", { method: "POST", form: { order: publicId, status: "paid", sig: await mockSignature(env, publicId, "paid") } });
    const done = await json(await client.post(`/api/student/lessons/${lesson.meta.last_row_id}/complete`));
    return { client, publicId, code: done.certificate.code as string, studentId: body.student.id as number };
  }

  it("shows a printable certificate with the student's name, a QR code and a verification link", async () => {
    const { code } = await completedCourse();
    const res = await new Client().get(`/en/certificate/${code}`);
    expect(res.status).toBe(200);
    const html = await text(res);
    expect(html).toContain("Fatema Khatun");
    expect(html).toContain("Certificate Test Class");
    expect(html).toContain(code);
    expect(html).toContain("<svg class=\"cert-qr\""); // inline QR code
    expect(html).toContain(`http://localhost:8787/verify/${code}`.replace("http://localhost:8787", "")); // verify path is in the page
    expect(html).toContain("data-print");
    expect(html).toContain('content="noindex'); // credentials are not for search engines
  });

  it("the public verify page confirms a genuine code, and rejects wrong ones", async () => {
    const { code } = await completedCourse();
    const good = await text(await new Client().get(`/en/verify/${code}`));
    expect(good).toContain("This certificate is genuine");
    expect(good).toContain("Fatema Khatun");
    const bad = await text(await new Client().get("/en/verify/MWH-AAAA-BBBB-CCCC"));
    expect(bad).toContain("No certificate was found");
    expect(bad).not.toContain("This certificate is genuine");
  });

  it("a revoked certificate stops rendering and fails verification", async () => {
    const { code } = await completedCourse();
    await env.DB.prepare("UPDATE certificates SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE code = ?").bind(code).run();
    expect((await new Client().get(`/certificate/${code}`)).status).toBe(404);
    expect(await text(await new Client().get(`/en/verify/${code}`))).toContain("revoked");
  });

  it("rate-limits certificate lookups so codes cannot be brute-forced", async () => {
    const c = new Client();
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await c.get(`/verify/MWH-AAAA-AAAA-${String(1000 + i).slice(-4).replace(/\d/g, "A")}`)).status);
    expect(statuses).toContain(429);
  });

  it("gives the buyer — and only the buyer — a printable invoice", async () => {
    const { client, publicId } = await completedCourse();
    const res = await client.get(`/api/student/orders/${publicId}/invoice?lang=en`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const html = await text(res);
    expect(html).toMatch(/INV-MWH-\d{8}-\d{4}/);
    expect(html).toContain("Certificate Test Class");
    expect(html).toContain("৳300");
    expect(html).toContain("PAID");

    const { client: other } = await registerStudent();
    expect((await other.get(`/api/student/orders/${publicId}/invoice`)).status).toBe(404);
    expect((await new Client().get(`/api/student/orders/${publicId}/invoice`)).status).toBe(401);
  });
});

describe("assets & SPA shells", () => {
  it("serves the SPA shell with a script-only CSP (503 here because the React apps are not built in tests)", async () => {
    const res = await new Client().get("/app/learn/anything");
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    }
    const admin = await new Client().get("/admin/orders");
    expect([200, 503]).toContain(admin.status);
  });

  it("refuses to serve anything but public image prefixes from /media", async () => {
    await env.R2.put("banners/x.png", new Uint8Array([137, 80, 78, 71]), { httpMetadata: { contentType: "image/png" } });
    await env.R2.put("resources/private.pdf", "secret", { httpMetadata: { contentType: "application/pdf" } });
    await env.R2.put("banners/evil.svg", "<svg onload=alert(1)>", { httpMetadata: { contentType: "image/svg+xml" } });
    const ok = await new Client().get("/media/banners/x.png");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("immutable");
    expect((await new Client().get("/media/resources/private.pdf")).status).toBe(404);
    expect((await new Client().get("/media/banners/evil.svg")).status).toBe(404);
    expect((await new Client().get("/media/banners/../resources/private.pdf")).status).toBe(404);
  });
});
