import type { Ctx, Env } from "../env";
import { run } from "./db";

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string | number;
  summary?: string;
  meta?: Record<string, unknown>;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Append to the audit trail on behalf of whoever is acting in this request (staff, student or system). */
export async function audit(c: Ctx, entry: AuditEntry): Promise<void> {
  const staff = c.get("staff");
  const student = c.get("student");
  const actor = staff
    ? { type: "staff", id: staff.id, name: staff.name }
    : student
      ? { type: "student", id: student.id, name: student.name }
      : { type: "system", id: null, name: "" };
  await writeAudit(c.env, actor, entry, c.get("ip"));
}

export async function auditAs(
  env: Env,
  actor: { type: "staff" | "student" | "system"; id: number | null; name: string },
  entry: AuditEntry,
  ip = "",
): Promise<void> {
  await writeAudit(env, actor, entry, ip);
}

async function writeAudit(
  env: Env,
  actor: { type: string; id: number | null; name: string },
  entry: AuditEntry,
  ip: string,
): Promise<void> {
  try {
    await run(
      env.DB,
      `INSERT INTO activity_log (actor_type, actor_id, actor_name, action, entity, entity_id, summary, meta, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      actor.type,
      actor.id,
      clip(actor.name, 120),
      entry.action,
      entry.entity ?? "",
      String(entry.entityId ?? ""),
      clip(entry.summary ?? "", 300),
      clip(JSON.stringify(entry.meta ?? {}), 2000),
      clip(ip, 64),
    );
  } catch (err) {
    // the audit trail must never take the request down, but a failure must be visible in logs
    console.error("audit_write_failed", entry.action, err);
  }
}
