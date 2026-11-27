import { describe, expect, it } from "vitest";
import { Client, env, firstCourse, json, registerStudent } from "./helpers";

/*
 * The website's cached pages turn "Enroll" into "Start the class" for a class the signed-in student has (marketing/site.js): they ask
 * /api/student/owned, which lists only that student's active classes — nothing for a stranger, nothing revoked.
 */
describe("the classes a signed-in student has", () => {
  it("lists the addresses of their active classes only; a stranger gets nothing", async () => {
    const course = await firstCourse();
    const other = (await env.DB.prepare("SELECT id, slug FROM courses WHERE id <> ? AND deleted_at IS NULL ORDER BY id LIMIT 1").bind(course.id).first<{ id: number; slug: string }>())!;
    const s = await registerStudent();
    expect((await json(await s.client.get("/api/student/owned"))).slugs).toEqual([]);
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'active', 'admin')").bind(s.id, course.id).run();
    await env.DB.prepare("INSERT INTO enrollments (student_id, course_id, status, source) VALUES (?, ?, 'revoked', 'admin')").bind(s.id, other.id).run();
    expect((await json(await s.client.get("/api/student/owned"))).slugs).toEqual([course.slug]);
    expect((await new Client().get("/api/student/owned")).status).toBe(401);
  });
});
