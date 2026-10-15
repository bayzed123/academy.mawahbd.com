import type { MiddlewareHandler } from "hono";
import { can, type Permission, type Role } from "@mawah/shared";
import type { AppEnv, Ctx, StaffCtx, StudentCtx } from "../env";
import { first } from "../lib/db";
import { HttpError } from "../lib/http";
import { readSession } from "../lib/session";

interface StudentRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  locale: "bn" | "en";
  blocked: number;
  sessions_valid_after: string | null;
  has_password: number;
}

interface StaffRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: number;
  must_change_password: number;
  sessions_valid_after: string | null;
}

async function resolveStudent(c: Ctx): Promise<StudentCtx | null> {
  const session = await readSession(c, "student");
  if (!session) return null;
  const row = await first<StudentRow>(
    c.env.DB,
    "SELECT id, name, email, phone, locale, blocked, sessions_valid_after, (password_hash IS NOT NULL OR google_sub IS NOT NULL) AS has_password FROM students WHERE id = ?",
    session.id,
  );
  if (!row || row.blocked) return null;
  if (row.sessions_valid_after && session.created < Date.parse(row.sessions_valid_after)) return null;
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, locale: row.locale, has_password: !!row.has_password };
}

async function resolveStaff(c: Ctx): Promise<StaffCtx | null> {
  const session = await readSession(c, "staff");
  if (!session) return null;
  const row = await first<StaffRow>(
    c.env.DB,
    "SELECT id, name, email, role, active, must_change_password, sessions_valid_after FROM staff WHERE id = ?",
    session.id,
  );
  if (!row || !row.active) return null;
  if (row.sessions_valid_after && session.created < Date.parse(row.sessions_valid_after)) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    must_change_password: !!row.must_change_password,
  };
}

/** Attach the student (if logged in) without requiring one. */
export const loadStudent: MiddlewareHandler<AppEnv> = async (c, next) => {
  const student = await resolveStudent(c);
  if (student) c.set("student", student);
  await next();
};

export const requireStudent: MiddlewareHandler<AppEnv> = async (c, next) => {
  const student = await resolveStudent(c);
  if (!student) throw new HttpError(401, "unauthorized");
  c.set("student", student);
  await next();
};

/** Staff session required. Staff flagged `must_change_password` can only reach /auth endpoints. */
export const requireStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const staff = await resolveStaff(c);
  if (!staff) throw new HttpError(401, "unauthorized");
  c.set("staff", staff);
  const path = new URL(c.req.url).pathname;
  if (staff.must_change_password && !path.startsWith("/api/admin/auth/")) {
    throw new HttpError(403, "password_change_required");
  }
  await next();
};

export const loadStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const staff = await resolveStaff(c);
  if (staff) c.set("staff", staff);
  await next();
};

/** RBAC gate — the permission table lives in @mawah/shared and is the same one the admin UI uses. */
export function requirePerm(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const staff = c.get("staff");
    if (!staff) throw new HttpError(401, "unauthorized");
    if (!can(staff.role, permission)) throw new HttpError(403, "forbidden");
    await next();
  };
}

export function assertPerm(c: Ctx, permission: Permission): void {
  const staff = c.get("staff");
  if (!staff) throw new HttpError(401, "unauthorized");
  if (!can(staff.role, permission)) throw new HttpError(403, "forbidden");
}
