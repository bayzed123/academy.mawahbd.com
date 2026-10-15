import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { Client, env, firstCourse, json, loginStaff, registerStudent } from "./helpers";

/*
 * Two safety nets that do not depend on someone remembering to write a test for each new route:
 *  1. ROUTE GUARDS — every route the Worker registers is enumerated from the router itself, so a new admin or student
 *     endpoint that forgets its login/permission check fails here immediately.
 *  2. PRODUCTION MODE — the hardening that only switches on when ENVIRONMENT = "production" (HSTS, __Host- cookies,
 *     the edge page cache, no test gateway, no dev mailbox) is exercised by flipping that variable for one test.
 */

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const apiRoutes = [...new Map(app.routes.filter((r) => METHODS.has(r.method) && r.path.startsWith("/api/")).map((r) => [`${r.method} ${r.path}`, { method: r.method, path: r.path }])).values()];
const concrete = (path: string) => path.replace(/:\w+/g, "1");
const label = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

/** Admin endpoints that are deliberately reachable without a staff session (login screens). */
const OPEN_ADMIN = new Set(["GET /api/admin/auth/setup-status", "GET /api/admin/auth/me", "POST /api/admin/auth/setup", "POST /api/admin/auth/login", "POST /api/admin/auth/logout"]);
/** Admin endpoints any signed-in staff member may call, whatever their role. */
const ANY_STAFF = new Set(["POST /api/admin/presence/ping", "POST /api/admin/auth/change-password", "POST /api/admin/auth/logout"]);

describe("route guards (enumerated from the router)", () => {
  it("finds the API surface (so this test cannot silently check nothing)", () => {
    const admin = apiRoutes.filter((r) => r.path.startsWith("/api/admin/"));
    expect(admin.length).toBeGreaterThan(80);
    expect(apiRoutes.filter((r) => r.path.startsWith("/api/student/")).length).toBeGreaterThan(10);
  });

  it("every admin endpoint refuses anonymous callers with 401", async () => {
    const leaks: string[] = [];
    for (const r of apiRoutes.filter((x) => x.path.startsWith("/api/admin/") && !OPEN_ADMIN.has(label(x)))) {
      const res = await new Client().fetch(concrete(r.path), { method: r.method, ...(r.method === "GET" || r.method === "DELETE" ? {} : { json: {} }) });
      if (res.status !== 401) leaks.push(`${label(r)} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it("a student session is never a staff session", async () => {
    const { client } = await registerStudent();
    const leaks: string[] = [];
    for (const r of apiRoutes.filter((x) => x.path.startsWith("/api/admin/") && !OPEN_ADMIN.has(label(x)) && x.method === "GET")) {
      const res = await client.get(concrete(r.path));
      if (res.status !== 401) leaks.push(`${label(r)} -> ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it("a read-only Viewer can read, but cannot write anywhere in the admin", async () => {
    const viewer = (await loginStaff("viewer")).client;
    const writable: string[] = [];
    for (const r of apiRoutes.filter((x) => x.path.startsWith("/api/admin/") && x.method !== "GET" && !x.path.startsWith("/api/admin/auth/") && !ANY_STAFF.has(label(x)))) {
      const res = await viewer.fetch(concrete(r.path), { method: r.method, ...(r.method === "DELETE" ? {} : { json: {} }) });
      if (res.status !== 403) writable.push(`${label(r)} -> ${res.status}`);
    }
    expect(writable).toEqual([]);
  });

  it("student and checkout endpoints need a student login — except the two a visitor must be able to use to buy", async () => {
    const open: string[] = [];
    // seeing the price and buying without an account are public on purpose (see guest-checkout.test.ts); everything else about an order is not
    const visitorMayUse = ["/api/checkout/quote", "/api/checkout/guest"];
    const guarded = apiRoutes.filter(
      (x) =>
        x.path.startsWith("/api/student/") ||
        (x.path.startsWith("/api/checkout") && !visitorMayUse.includes(x.path)) ||
        ["/api/auth/profile", "/api/auth/change-password", "/api/auth/set-password"].includes(x.path),
    );
    expect(guarded.length).toBeGreaterThan(12);
    for (const path of visitorMayUse) expect(apiRoutes.some((r) => r.path === path && r.method === "POST"), path).toBe(true);
    // they answer a visitor (here: "what is the basket?"), they do not ask them to log in
    for (const path of visitorMayUse) expect((await new Client().post(path, {})).status, path).toBe(422);
    for (const r of guarded) {
      const res = await new Client().fetch(concrete(r.path), { method: r.method, ...(r.method === "GET" || r.method === "DELETE" ? {} : { json: {} }) });
      if (res.status !== 401) open.push(`${label(r)} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });
});

/** Run `fn` as if deployed to production, always restoring the test environment afterwards. */
async function inProduction<T>(fn: () => Promise<T>): Promise<T> {
  const before = env.ENVIRONMENT;
  (env as { ENVIRONMENT: string }).ENVIRONMENT = "production";
  try {
    return await fn();
  } finally {
    (env as { ENVIRONMENT: string }).ENVIRONMENT = before;
  }
}

describe("production mode", () => {
  it("turns on HSTS and keeps the baseline security headers", async () => {
    await inProduction(async () => {
      const res = await new Client().get("/en/contact");
      expect(res.headers.get("strict-transport-security")).toMatch(/max-age=63072000; includeSubDomains; preload/);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain("unsafe-inline");
    });
    // …and never in development, where plain http on localhost must keep working
    expect((await new Client().get("/en/contact")).headers.get("strict-transport-security")).toBeNull();
  });

  it("uses __Host- session cookies: Secure, HttpOnly, and Strict for staff", async () => {
    await inProduction(async () => {
      const student = await registerStudent();
      const sCookie = student.res.headers.getSetCookie().find((c) => c.startsWith("__Host-mawah_sid="))!;
      expect(sCookie).toBeTruthy();
      expect(sCookie).toMatch(/Secure/i);
      expect(sCookie).toMatch(/HttpOnly/i);
      expect(sCookie).toMatch(/SameSite=Lax/i);
      expect(sCookie).toMatch(/Path=\//i);
      expect(sCookie).not.toMatch(/Domain=/i);

      const staffClient = new Client();
      const { email, password } = await loginStaff("viewer");
      const res = await staffClient.post("/api/admin/auth/login", { email, password });
      const aCookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-mawah_asid="))!;
      expect(aCookie).toBeTruthy();
      expect(aCookie).toMatch(/SameSite=Strict/i);
      expect(aCookie).toMatch(/HttpOnly/i);
      expect(aCookie).toMatch(/Secure/i);
    });
  });

  it("has no test payment gateway and no dev mailbox, even though ALLOW_MOCK_PAYMENTS is set", async () => {
    expect(env.ALLOW_MOCK_PAYMENTS).toBe("true"); // the test environment really does allow it…
    const course = await firstCourse("beginners-baking-class");
    const offered = async (client: Client) => (await json(await client.post("/api/checkout/quote", { courses: [course.slug] }))).quote.channels as string[];

    const dev = await registerStudent();
    expect(await offered(dev.client)).toContain("mock"); // …so these assertions are meaningful

    await inProduction(async () => {
      const { client } = await registerStudent(); // signed in as production: it holds the __Host- cookie
      expect(await offered(client)).not.toContain("mock");
      const res = await client.post("/api/checkout", { courses: [course.slug], channel: "mock" });
      expect(res.status).toBe(400);
      expect((await json(res)).error.code).toBe("payment_unavailable");
      expect((await new Client().get("/api/payments/mock/pay/anything")).status).toBe(404);
      expect((await new Client().fetch("/api/payments/mock/webhook", { method: "POST", form: { order: "x", status: "paid", sig: "x" } })).status).toBe(404);
      expect((await new Client().get("/api/dev/outbox")).status).toBe(404);
    });
    // …and in development the same call works (that is what the E2E suite relies on)
    expect((await dev.client.post("/api/checkout", { courses: [course.slug], channel: "mock" })).status).toBe(201);
  });

  it("serves public pages from the edge cache and an admin edit shows up on the very next request", async () => {
    const course = await firstCourse("beginners-baking-class");
    await inProduction(async () => {
      const admin = (await loginStaff("content_manager")).client; // signed in *as production*, so it holds the __Host- cookie
      const path = `/en/courses/${course.slug}`;
      const first = await new Client().get(path);
      expect(first.status).toBe(200);
      expect(first.headers.get("x-page-cache")).toBe("MISS");
      expect(first.headers.get("cache-control")).toMatch(/public/);
      expect(first.headers.get("set-cookie")).toBeNull(); // a cacheable page never sets cookies
      await first.text(); // read the page to the end, like a browser does (the cache copy is finished by then)

      // the cache entry is written after the response (waitUntil): on a busy machine that can take a while, so wait up to 10 s
      let second = await new Client().get(path);
      for (let i = 0; i < 100 && second.headers.get("x-page-cache") !== "HIT"; i++) {
        await second.text();
        await new Promise((r) => setTimeout(r, 100));
        second = await new Client().get(path);
      }
      expect(second.headers.get("x-page-cache")).toBe("HIT");

      // marketing parameters do not create separate cache entries
      const tracked = await new Client().get(`${path}?utm_source=facebook&fbclid=abc123`);
      expect(tracked.headers.get("x-page-cache")).toBe("HIT");

      // an admin edit bumps the content version, so the old HTML is never served again
      const marker = `Edited ${Date.now().toString(36)}`;
      const edit = await admin.patch(`/api/admin/courses/${course.id}`, { title_en: marker });
      expect(edit.status).toBe(200);
      const after = await new Client().get(path);
      expect(after.headers.get("x-page-cache")).toBe("MISS");
      expect(await after.text()).toContain(marker);

      // restore the title so later tests see the original catalogue
      expect((await admin.patch(`/api/admin/courses/${course.id}`, { title_en: course.title_en })).status).toBe(200);
    });
  });

  it("never caches anything personal: API responses and the app shells are private or uncacheable", async () => {
    await inProduction(async () => {
      const student = await registerStudent();
      for (const path of ["/api/student/courses", "/api/auth/me"]) {
        const res = await student.client.get(path);
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toContain("no-store");
      }
      expect((await new Client().get("/app/")).headers.get("x-page-cache")).toBeNull();
      expect((await new Client().get("/admin/")).headers.get("x-page-cache")).toBeNull();
    });
  });
});
