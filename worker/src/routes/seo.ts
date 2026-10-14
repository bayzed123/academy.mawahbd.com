import { Hono } from "hono";
import type { AppEnv } from "../env";
import { all } from "../lib/db";
import { cachedPage } from "../lib/render";
import { localizedPath } from "../views/ctx";

export const seoRoutes = new Hono<AppEnv>();

seoRoutes.get("/robots.txt", (c) => {
  const site = c.env.SITE_URL.replace(/\/$/, "");
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /admin/",
    "Disallow: /api/",
    "Disallow: /verify",
    "Disallow: /en/verify",
    "Disallow: /certificate/",
    "Disallow: /en/certificate/",
    "",
    `Sitemap: ${site}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

seoRoutes.get("/sitemap.xml", (c) =>
  cachedPage(c, { ttl: 3600 }, async () => {
    const site = c.env.SITE_URL.replace(/\/$/, "");
    const [courses, posts, instructors, cats] = await Promise.all([
      all<{ slug: string; updated_at: string }>(c.env.DB, "SELECT slug, updated_at FROM courses WHERE deleted_at IS NULL AND status IN ('published','coming_soon') ORDER BY sort, id"),
      all<{ slug: string; updated_at: string }>(c.env.DB, "SELECT slug, updated_at FROM blog_posts WHERE status = 'published' AND deleted_at IS NULL"),
      all<{ slug: string; updated_at: string }>(c.env.DB, "SELECT slug, updated_at FROM instructors WHERE active = 1 AND deleted_at IS NULL"),
      all<{ slug: string }>(c.env.DB, "SELECT slug FROM categories WHERE active = 1 ORDER BY sort"),
    ]);

    const entries: { path: string; lastmod?: string; priority: string }[] = [
      { path: "/", priority: "1.0" },
      { path: "/courses", priority: "0.9" },
      ...cats.map((x) => ({ path: `/courses?cat=${x.slug}`, priority: "0.7" })),
      ...courses.map((x) => ({ path: `/courses/${x.slug}`, lastmod: x.updated_at, priority: "0.9" })),
      { path: "/blog", priority: "0.6" },
      ...posts.map((x) => ({ path: `/blog/${x.slug}`, lastmod: x.updated_at, priority: "0.6" })),
      ...instructors.map((x) => ({ path: `/instructors/${x.slug}`, lastmod: x.updated_at, priority: "0.5" })),
      { path: "/about", priority: "0.5" },
      { path: "/contact", priority: "0.5" },
      { path: "/policies/refund", priority: "0.3" },
      { path: "/policies/privacy", priority: "0.3" },
      { path: "/policies/terms", priority: "0.3" },
    ];

    const xml = entries
      .map((e) => {
        const bn = esc(site + localizedPath("bn", e.path));
        const en = esc(site + localizedPath("en", e.path));
        const alt = `<xhtml:link rel="alternate" hreflang="bn" href="${bn}"/><xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${bn}"/>`;
        const lm = e.lastmod ? `<lastmod>${e.lastmod.slice(0, 10)}</lastmod>` : "";
        return `<url><loc>${bn}</loc>${lm}<priority>${e.priority}</priority>${alt}</url><url><loc>${en}</loc>${lm}<priority>${e.priority}</priority>${alt}</url>`;
      })
      .join("");

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${xml}</urlset>`,
      { headers: { "Content-Type": "application/xml; charset=utf-8" } },
    );
  }),
);
