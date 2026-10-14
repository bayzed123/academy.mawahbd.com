import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

/*
 * The site has ONE public address (SITE_URL). In production:
 *   - plain http goes to https, and www.<address> goes to <address> (permanent redirects that keep the path and the query);
 *   - any other address that reaches the Worker — the free workers.dev one — keeps working (the deploy checks use it) but is
 *     marked "noindex" and its robots.txt closes the door, so search engines only ever list the real address;
 *   - none of this happens in development, or when SITE_URL is not a proper address.
 */
const PUBLIC = "https://mawahacademy.com";
const FREE = "https://academy-mawahbd-com.mawahacademy.workers.dev";

async function request(url: string, opts: { method?: string; site?: string; environment?: string } = {}) {
  const e = env as { ENVIRONMENT: string; SITE_URL: string };
  const before = { environment: e.ENVIRONMENT, site: e.SITE_URL };
  e.ENVIRONMENT = opts.environment ?? "production";
  e.SITE_URL = opts.site ?? PUBLIC;
  try {
    return await exports.default.fetch(new Request(url, { method: opts.method ?? "GET", redirect: "manual", headers: { "cf-connecting-ip": "10.77.66.55" } }));
  } finally {
    e.ENVIRONMENT = before.environment;
    e.SITE_URL = before.site;
  }
}

describe("one public address", () => {
  it("sends www.<address> to <address>, keeping the path and the query", async () => {
    const res = await request(`https://www.mawahacademy.com/en/courses?cat=cakes&sort=price_asc`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${PUBLIC}/en/courses?cat=cakes&sort=price_asc`);
    expect(res.headers.get("strict-transport-security")).toMatch(/max-age=63072000/); // even a redirect carries the security headers
    expect((await request(`https://www.mawahacademy.com/`)).headers.get("location")).toBe(`${PUBLIC}/`);
  });

  it("sends plain http to https", async () => {
    const res = await request(`http://mawahacademy.com/courses/beginners-baking-class?utm_source=facebook`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${PUBLIC}/courses/beginners-baking-class?utm_source=facebook`);
  });

  it("takes http://www… to the public https address in one hop", async () => {
    const res = await request(`http://www.mawahacademy.com/about`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${PUBLIC}/about`);
  });

  it("answers anything but GET and HEAD over http with a 308, which keeps the method", async () => {
    const res = await request(`http://mawahacademy.com/api/auth/login`, { method: "POST" });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${PUBLIC}/api/auth/login`);
  });

  it("leaves the public address alone: no redirect, no noindex, and the normal robots.txt", async () => {
    const health = await request(`${PUBLIC}/api/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("x-robots-tag")).toBeNull();
    expect(health.headers.get("strict-transport-security")).toMatch(/preload/);

    const robots = await (await request(`${PUBLIC}/robots.txt`)).text();
    expect(robots).toContain("Allow: /");
    expect(robots).toContain(`Sitemap: ${PUBLIC}/sitemap.xml`);
    expect(robots).not.toMatch(/^Disallow: \/$/m);
  });

  it("keeps the free workers.dev address working but out of search results", async () => {
    const health = await request(`${FREE}/api/health`);
    expect(health.status).toBe(200); // the deploy checks rely on this
    expect(health.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const page = await request(`${FREE}/en/contact`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const robots = await (await request(`${FREE}/robots.txt`)).text();
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Disallow: \/$/m);
    expect(robots).not.toContain("Sitemap:");
  });

  it("does nothing in development or when SITE_URL is not an address", async () => {
    const dev = await request(`http://www.mawahacademy.com/api/health`, { environment: "development" });
    expect(dev.status).toBe(200);
    expect(dev.headers.get("x-robots-tag")).toBeNull();
    expect(dev.headers.get("strict-transport-security")).toBeNull();

    const broken = await request(`https://www.mawahacademy.com/api/health`, { site: "not an address" });
    expect(broken.status).toBe(200);
    expect(broken.headers.get("location")).toBeNull();
  });

  it("does not redirect a site whose SITE_URL is itself the workers.dev address", async () => {
    const res = await request(`${FREE}/api/health`, { site: FREE });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect((await request(`${FREE}/robots.txt`, { site: FREE }).then((r) => r.text()))).toContain(`Sitemap: ${FREE}/sitemap.xml`);
  });
});
