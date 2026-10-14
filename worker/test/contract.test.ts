import { describe, expect, it } from "vitest";
import adminLogin from "../../tests/fixtures/admin-login.json";
import certificateVerify from "../../tests/fixtures/certificate-verify.json";
import courseList from "../../tests/fixtures/course-list.json";
import createOrder from "../../tests/fixtures/create-order.json";
import { Client, env, json, registerStudent, uniqueEmail } from "./helpers";
import { hashPassword } from "../src/lib/crypto";
import { findForbiddenKeys, matchShape, type Shape } from "./shape";

/*
 * Contract tests: every JSON file in tests/fixtures/ describes one API call (request) and the exact SHAPE of what comes
 * back. They double as living API documentation and protect the two apps from accidental breaking changes — and the
 * "forbidKeys" lists make sure secrets and other people's data never leak into a response.
 */
interface Fixture {
  name: string;
  setup: "anonymous" | "student" | "staff-account" | "certificate";
  request: { method: string; path: string; json?: unknown };
  response: { status: number; headers?: Record<string, string>; forbidKeys?: string[]; shape: Shape };
}

const fill = (v: unknown, vars: Record<string, string>): unknown => JSON.parse(JSON.stringify(v).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`));

async function arrange(fx: Fixture): Promise<{ client: Client; vars: Record<string, string> }> {
  const course = await env.DB.prepare("SELECT slug FROM courses WHERE status = 'published' AND price > 0 ORDER BY id LIMIT 1").first<{ slug: string }>();
  const vars: Record<string, string> = { course_slug: course!.slug };
  if (fx.setup === "student") return { client: (await registerStudent()).client, vars };
  if (fx.setup === "staff-account") {
    vars.email = uniqueEmail("contract");
    vars.password = `Aa1-${crypto.randomUUID()}`;
    await env.DB.prepare("INSERT INTO staff (email, name, role, password_hash) VALUES (?, ?, 'viewer', ?)")
      .bind(vars.email, "Contract Viewer", await hashPassword(vars.password, env.APP_SECRET))
      .run();
    return { client: new Client(), vars };
  }
  if (fx.setup === "certificate") {
    const student = await registerStudent();
    vars.code = "MWH-7K3M-9P2Q-XR4T"; // inside the code alphabet (no I, L, O, U)
    await env.DB.prepare("INSERT INTO certificates (code, student_id, course_id, student_name, course_title_bn, course_title_en) SELECT ?, ?, id, ?, title_bn, title_en FROM courses WHERE slug = ?")
      .bind(vars.code, student.id, "Fixture Student", vars.course_slug)
      .run();
    return { client: new Client(), vars };
  }
  return { client: new Client(), vars };
}

const fixtures: Fixture[] = [courseList, createOrder, adminLogin, certificateVerify] as Fixture[];

describe("API contract (tests/fixtures/*.json)", () => {
  for (const fx of fixtures) {
    it(`${fx.name}: ${fx.request.method} ${fx.request.path.split("?")[0]}`, async () => {
      const { client, vars } = await arrange(fx);
      const path = fill(fx.request.path, vars) as string;
      const res = await client.fetch(path, { method: fx.request.method, ...(fx.request.json ? { json: fill(fx.request.json, vars) } : {}) });
      const body = await json(res);

      expect(res.status, JSON.stringify(body)).toBe(fx.response.status);
      expect(matchShape(body, fx.response.shape)).toEqual([]);
      expect(findForbiddenKeys(body, fx.response.forbidKeys ?? [])).toEqual([]);
      for (const [header, contains] of Object.entries(fx.response.headers ?? {})) {
        const value = header === "set-cookie" ? res.headers.getSetCookie().join(" | ") : (res.headers.get(header) ?? "");
        expect(value, `header ${header}`).toContain(contains);
      }
    });
  }

  it("course-list really is cheapest-first, paginated and honest about ratings", async () => {
    const body = await json(await new Client().get(courseList.request.path));
    const prices: number[] = body.courses.map((c: { price: number }) => c.price);
    expect(body.courses).toHaveLength(2);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(body.total).toBeGreaterThan(2);
    // no fabricated social proof: a class nobody reviewed shows no rating at all
    for (const c of body.courses) if (c.rating_count === 0) expect(c.rating_avg).toBe(0);
  });

  it("create-order starts 'pending' — nobody is enrolled until the gateway confirms", async () => {
    const { client, vars } = await arrange(createOrder as Fixture);
    const res = await client.post("/api/checkout", { courses: [vars.course_slug], channel: "mock" });
    const { order } = await json(res);
    expect(order.status).toBe("pending");
    expect((await json(await client.get("/api/student/courses"))).courses).toHaveLength(0);
  });

  it("admin-login: a wrong password gets the same answer whether or not the e-mail exists", async () => {
    const { vars } = await arrange(adminLogin as Fixture);
    const wrong = await new Client().post("/api/admin/auth/login", { email: vars.email, password: "not-the-password" });
    const unknown = await new Client().post("/api/admin/auth/login", { email: uniqueEmail("nobody"), password: "not-the-password" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await json(wrong)).error.code).toBe((await json(unknown)).error.code);
  });

  it("every fixture is syntactically a fixture (name, setup, request, response)", () => {
    for (const fx of fixtures) {
      expect(fx.name).toBeTruthy();
      expect(["anonymous", "student", "staff-account", "certificate"]).toContain(fx.setup);
      expect(fx.response.status).toBeGreaterThanOrEqual(200);
    }
  });
});
