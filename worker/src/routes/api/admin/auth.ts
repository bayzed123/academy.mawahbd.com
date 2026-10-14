import { Hono } from "hono";
import { z } from "zod";
import type { StaffMe } from "@mawah/shared";
import type { AppEnv } from "../../../env";
import { audit, auditAs } from "../../../lib/audit";
import { hashPassword, timingSafeEqual } from "../../../lib/crypto";
import { first, nowIso, run } from "../../../lib/db";
import { HttpError, ok, parseBody } from "../../../lib/http";
import { emailSchema, nameSchema, passwordSchema } from "../../../lib/schemas";
import { createSession, destroySession } from "../../../lib/session";
import { loadStaff, requireStaff } from "../../../middleware/auth";
import { checkRateLimit, rateLimit } from "../../../middleware/ratelimit";
import { authenticate, setPassword } from "../../../services/auth";

export const adminAuthRoutes = new Hono<AppEnv>();

const toMe = (s: { id: number; name: string; email: string; role: StaffMe["role"]; must_change_password: boolean }): StaffMe => ({
  kind: "staff",
  id: s.id,
  name: s.name,
  email: s.email,
  role: s.role,
  must_change_password: s.must_change_password,
});

/** The login screen asks this to decide whether to show the one-time "create the first admin" form. */
adminAuthRoutes.get("/setup-status", async (c) => {
  const row = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM staff");
  return ok(c, { needs_setup: (row?.n ?? 0) === 0, setup_enabled: !!c.env.SETUP_TOKEN });
});

const setupSchema = z.object({
  setup_token: z.string().min(1, "required").max(200),
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

/**
 * One-time bootstrap: creates the first Super Admin. Requires the SETUP_TOKEN secret (known only to the
 * person who deployed the site) and permanently disables itself once any staff account exists.
 */
adminAuthRoutes.post("/setup", rateLimit("RL_AUTH"), async (c) => {
  if (!c.env.SETUP_TOKEN) throw new HttpError(404, "not_found");
  const body = await parseBody(c, setupSchema);
  if (!timingSafeEqual(body.setup_token, c.env.SETUP_TOKEN)) throw new HttpError(403, "invalid_setup_token");

  const count = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM staff");
  if ((count?.n ?? 0) > 0) throw new HttpError(409, "already_setup");

  const hash = await hashPassword(body.password, c.env.APP_SECRET);
  const now = nowIso();
  const res = await run(
    c.env.DB,
    `INSERT INTO staff (email, name, role, password_hash, created_at, updated_at) VALUES (?, ?, 'super_admin', ?, ?, ?)`,
    body.email,
    body.name,
    hash,
    now,
    now,
  );
  const id = res.meta.last_row_id as number;
  await auditAs(c.env, { type: "staff", id, name: body.name }, { action: "staff.setup", entity: "staff", entityId: id, summary: "First super admin created" }, c.get("ip"));
  await createSession(c, "staff", id);
  return ok(c, { staff: toMe({ id, name: body.name, email: body.email, role: "super_admin", must_change_password: false }) }, 201);
});

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "required").max(128) });

adminAuthRoutes.post("/login", rateLimit("RL_AUTH"), async (c) => {
  const body = await parseBody(c, loginSchema);
  if (!(await checkRateLimit(c.env, "RL_AUTH", `RL_AUTH:staff:${body.email}`))) throw new HttpError(429, "rate_limited");

  const result = await authenticate(c.env, "staff", body.email, body.password);
  if (!result.ok) {
    await auditAs(c.env, { type: "system", id: null, name: "" }, { action: "staff.login_failed", entity: "staff", summary: result.reason, meta: { email: body.email } }, c.get("ip"));
    throw new HttpError(result.reason === "invalid_credentials" ? 401 : result.reason === "account_locked" ? 429 : 403, result.reason);
  }
  const row = result.row as unknown as { id: number; name: string; email: string; role: StaffMe["role"]; must_change_password: number };
  await createSession(c, "staff", row.id);
  c.set("staff", { id: row.id, name: row.name, email: row.email, role: row.role, must_change_password: !!row.must_change_password });
  await audit(c, { action: "staff.login", entity: "staff", entityId: row.id });
  return ok(c, { staff: toMe({ ...row, must_change_password: !!row.must_change_password }) });
});

adminAuthRoutes.post("/logout", loadStaff, async (c) => {
  if (c.get("staff")) await audit(c, { action: "staff.logout", entity: "staff", entityId: c.get("staff")!.id });
  await destroySession(c, "staff");
  return ok(c);
});

adminAuthRoutes.get("/me", loadStaff, (c) => {
  const s = c.get("staff");
  return ok(c, { staff: s ? toMe(s) : null });
});

const changeSchema = z.object({ current: z.string().min(1, "required").max(128), next: passwordSchema });

adminAuthRoutes.post("/change-password", requireStaff, rateLimit("RL_AUTH"), async (c) => {
  const body = await parseBody(c, changeSchema);
  const me = c.get("staff")!;
  const check = await authenticate(c.env, "staff", me.email, body.current);
  if (!check.ok) throw new HttpError(400, "invalid_credentials", "invalid_credentials", { current: "invalid_credentials" });
  if (body.current === body.next) throw new HttpError(422, "validation", "validation", { next: "same_password" });
  await setPassword(c.env, "staff", me.id, body.next);
  await createSession(c, "staff", me.id);
  await audit(c, { action: "staff.password_changed", entity: "staff", entityId: me.id });
  return ok(c);
});
