import { Hono } from "hono";
import { z } from "zod";
import { ROLES } from "@mawah/shared";
import type { AppEnv, Ctx } from "../../../env";
import { audit } from "../../../lib/audit";
import { csvResponse, toCsv } from "../../../lib/csv";
import { hashPassword, randomString } from "../../../lib/crypto";
import { all, first, likeEscape, nowIso, pageInfo, pageParams, run } from "../../../lib/db";
import { HttpError, intParam, notFound, ok, parseBody } from "../../../lib/http";
import { emailSchema, nameSchema } from "../../../lib/schemas";
import { requirePerm } from "../../../middleware/auth";

export const staff = new Hono<AppEnv>();

const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const tempPassword = () => `${randomString(5, TEMP_ALPHABET)}-${randomString(5, TEMP_ALPHABET)}-${randomString(5, TEMP_ALPHABET)}`;

const COLS = "id, email, name, role, active, must_change_password, locked_until, last_login_at, created_at";

staff.get("/staff", requirePerm("staff:read"), async (c) => {
  const rows = await all(c.env.DB, `SELECT ${COLS} FROM staff ORDER BY active DESC, created_at`);
  return ok(c, { items: rows });
});

/**
 * New team member: the Super Admin receives a one-time temporary password to pass on (shown once, never stored in
 * plain text). The person must choose their own password at first sign-in.
 */
staff.post("/staff", requirePerm("staff:write"), async (c) => {
  const body = await parseBody(c, z.object({ email: emailSchema, name: nameSchema, role: z.enum(ROLES) }));
  if (await first(c.env.DB, "SELECT id FROM staff WHERE email = ?", body.email)) throw new HttpError(409, "duplicate", "duplicate", { email: "duplicate" });
  const temp = tempPassword();
  const now = nowIso();
  const res = await run(
    c.env.DB,
    "INSERT INTO staff (email, name, role, password_hash, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
    body.email,
    body.name,
    body.role,
    await hashPassword(temp, c.env.APP_SECRET),
    now,
    now,
  );
  const id = res.meta.last_row_id as number;
  await audit(c, { action: "staff.created", entity: "staff", entityId: id, summary: `${body.email} (${body.role})` });
  return ok(c, { staff: await first(c.env.DB, `SELECT ${COLS} FROM staff WHERE id = ?`, id), temp_password: temp }, 201);
});

/** Another active Super Admin must always remain, otherwise nobody could manage the site. */
async function assertNotLastSuperAdmin(c: Ctx, id: number) {
  const others = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM staff WHERE role = 'super_admin' AND active = 1 AND id <> ?", id);
  if ((others?.n ?? 0) === 0) throw new HttpError(409, "last_super_admin");
}

staff.patch("/staff/:id", requirePerm("staff:write"), async (c) => {
  const id = intParam(c, "id");
  const me = c.get("staff")!;
  const target = await first<{ id: number; role: string; active: number }>(c.env.DB, "SELECT id, role, active FROM staff WHERE id = ?", id);
  if (!target) throw notFound();
  const body = await parseBody(c, z.object({ name: nameSchema, role: z.enum(ROLES), active: z.boolean() }).partial());

  const roleChange = body.role !== undefined && body.role !== target.role;
  const deactivating = body.active === false && !!target.active;
  if ((roleChange || deactivating) && id === me.id) throw new HttpError(409, "cannot_edit_self");
  if (target.role === "super_admin" && target.active && (roleChange || deactivating)) await assertNotLastSuperAdmin(c, id);

  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (body.name !== undefined) {
    sets.push("name = ?");
    params.push(body.name);
  }
  if (body.role !== undefined) {
    sets.push("role = ?");
    params.push(body.role);
  }
  if (body.active !== undefined) {
    sets.push("active = ?");
    params.push(body.active ? 1 : 0);
  }
  // a new role / a deactivation takes effect immediately: every existing session of that person is voided
  if (roleChange || deactivating) {
    sets.push("sessions_valid_after = ?");
    params.push(new Date().toISOString());
  }
  if (sets.length) await run(c.env.DB, `UPDATE staff SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...params, nowIso(), id);
  await audit(c, { action: "staff.updated", entity: "staff", entityId: id, meta: { fields: Object.keys(body), role: body.role ?? null } });
  return ok(c, { staff: await first(c.env.DB, `SELECT ${COLS} FROM staff WHERE id = ?`, id) });
});

staff.post("/staff/:id/reset-password", requirePerm("staff:write"), async (c) => {
  const id = intParam(c, "id");
  if (id === c.get("staff")!.id) throw new HttpError(409, "cannot_edit_self"); // use "change password" for yourself
  if (!(await first(c.env.DB, "SELECT id FROM staff WHERE id = ?", id))) throw notFound();
  const temp = tempPassword();
  await run(
    c.env.DB,
    "UPDATE staff SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL, sessions_valid_after = ?, updated_at = ? WHERE id = ?",
    await hashPassword(temp, c.env.APP_SECRET),
    new Date().toISOString(),
    nowIso(),
    id,
  );
  await audit(c, { action: "staff.password_reset", entity: "staff", entityId: id });
  return ok(c, { temp_password: temp });
});

/* ------------------------------------------------------------------------------------------ audit trail */
function activityFilters(q: Record<string, string>) {
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];
  if (["staff", "student", "system"].includes(q.actor_type ?? "")) {
    where.push("actor_type = ?");
    params.push(q.actor_type);
  }
  if (q.actor_id && /^\d+$/.test(q.actor_id)) {
    where.push("actor_id = ?");
    params.push(Number(q.actor_id));
  }
  if (q.entity && /^[a-z_]{2,30}$/.test(q.entity)) {
    where.push("entity = ?");
    params.push(q.entity);
  }
  if (q.action?.trim()) {
    where.push("action LIKE ? ESCAPE '\\'");
    params.push(`${likeEscape(q.action.trim().slice(0, 60))}%`);
  }
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) {
    where.push("date(created_at, '+6 hours') >= ?");
    params.push(q.from);
  }
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
    where.push("date(created_at, '+6 hours') <= ?");
    params.push(q.to);
  }
  if (q.q?.trim()) {
    const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
    where.push("(summary LIKE ? ESCAPE '\\' OR actor_name LIKE ? ESCAPE '\\' OR entity_id LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  return { where: where.join(" AND "), params };
}

staff.get("/activity", requirePerm("activity:read"), async (c) => {
  const f = activityFilters(c.req.query());
  const { page, per_page, offset } = pageParams(c.req.query(), { per_page: 40, max: 100 });
  const [rows, total] = await Promise.all([
    all(c.env.DB, `SELECT id, actor_type, actor_id, actor_name, action, entity, entity_id, summary, meta, ip, created_at FROM activity_log WHERE ${f.where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...f.params, per_page, offset),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM activity_log WHERE ${f.where}`, ...f.params),
  ]);
  return ok(c, { items: rows, page: pageInfo(page, per_page, total?.n ?? 0) });
});

staff.get("/activity/export.csv", requirePerm("activity:read"), async (c) => {
  const f = activityFilters(c.req.query());
  const rows = await all<Record<string, unknown>>(c.env.DB, `SELECT * FROM activity_log WHERE ${f.where} ORDER BY id DESC LIMIT 5000`, ...f.params);
  return csvResponse(
    "activity-log",
    toCsv(rows, [
      { key: "created_at", label: "Time (UTC)" },
      { key: "actor_type", label: "Actor type" },
      { key: "actor_name", label: "Actor" },
      { key: "action", label: "Action" },
      { key: "entity", label: "Entity" },
      { key: "entity_id", label: "Entity id" },
      { key: "summary", label: "Summary" },
      { key: "ip", label: "IP" },
    ]),
  );
});

/* ------------------------------------------------------------------------------------ who is online (KV) */
staff.post("/presence/ping", async (c) => {
  const me = c.get("staff")!;
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const path = typeof body.path === "string" ? body.path.slice(0, 80) : "";
  await c.env.KV.put(`presence:${me.id}`, JSON.stringify({ id: me.id, name: me.name, role: me.role, path, at: Date.now() }), { expirationTtl: 90 });
  return ok(c);
});

staff.get("/presence", async (c) => {
  const list = await c.env.KV.list({ prefix: "presence:", limit: 50 });
  const rows = await Promise.all(list.keys.map((k) => c.env.KV.get<{ id: number; name: string; role: string; path: string; at: number }>(k.name, "json")));
  return ok(c, { online: rows.filter((r): r is NonNullable<typeof r> => !!r && Date.now() - r.at < 90_000) });
});
