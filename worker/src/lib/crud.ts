import { Hono } from "hono";
import type { z } from "zod";
import type { Permission } from "@mawah/shared";
import type { AppEnv, Ctx } from "../env";
import { audit } from "./audit";
import { csvResponse, toCsv, type CsvColumn } from "./csv";
import { all, first, likeEscape, nowIso, pageInfo, pageParams, run } from "./db";
import { HttpError, intParam, notFound, ok, parseBody } from "./http";
import { bumpContentVersion } from "./settings";
import { requirePerm } from "../middleware/auth";

type Row = Record<string, unknown> & { id: number };

/**
 * A tiny, declarative CRUD engine for the admin modules that are plain tables
 * (instructors, categories, blog, bundles, coupons, courses …).
 *
 *  - every route is behind RBAC (`read` / `write` / `delete` permissions from @mawah/shared)
 *  - input is validated by a zod schema; SQL only ever uses WHITELISTED column names + bound parameters
 *  - soft delete + restore, server-side search / filter / sort / pagination, CSV export
 *  - every mutation is written to the audit log; content that shows on the public site bumps the cache version
 */
export interface ResourceDef<S extends z.ZodObject> {
  name: string;
  table: string;
  perms: { read: Permission; write: Permission; delete?: Permission };
  schema: S;
  searchCols: string[];
  sortCols: string[];
  defaultSort: string;
  filters?: Record<string, string>;
  softDelete?: boolean;
  /** columns that exist in the schema but are not table columns (e.g. course_ids for bundles) */
  virtual?: string[];
  /** table columns the server may set from beforeSave (never from the request body), e.g. published_at */
  serverColumns?: string[];
  /** touches data shown on the public site -> bump the edge-cache version after writes */
  publicContent?: boolean;
  hasUpdatedAt?: boolean;
  csv?: CsvColumn<Row>[];
  label?: (row: Row) => string;
  beforeSave?: (c: Ctx, data: Record<string, unknown>, existing: Row | null) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** `existing` is the row as it was before an update (null on create) */
  afterSave?: (c: Ctx, row: Row, data: Record<string, unknown>, kind: "create" | "update", existing: Row | null) => Promise<void>;
  canDelete?: (c: Ctx, row: Row) => Promise<void>;
  decorate?: (c: Ctx, rows: Row[]) => Promise<Row[]>;
}

const col = (name: string, allowed: Set<string>) => {
  if (!allowed.has(name)) throw new HttpError(400, "bad_column");
  return name;
};

const toDb = (v: unknown): string | number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  return v as string | number;
};

export function crudRoutes<S extends z.ZodObject>(def: ResourceDef<S>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const shape = Object.keys(def.schema.shape);
  const virtual = new Set(def.virtual ?? []);
  const writable = new Set([...shape.filter((k) => !virtual.has(k)), ...(def.serverColumns ?? [])]);
  const sortable = new Set(def.sortCols);
  const filterCols = new Set(Object.values(def.filters ?? {}));
  const partial = def.schema.partial();

  async function fetchRow(c: Ctx, id: number, includeDeleted = false): Promise<Row> {
    const row = await first<Row>(c.env.DB, `SELECT * FROM ${def.table} WHERE id = ? ${def.softDelete && !includeDeleted ? "AND deleted_at IS NULL" : ""}`, id);
    if (!row) throw notFound();
    return row;
  }

  function listSql(c: Ctx, forExport: boolean) {
    const q = c.req.query();
    const where: string[] = def.softDelete && q.deleted !== "1" ? ["deleted_at IS NULL"] : def.softDelete ? ["deleted_at IS NOT NULL"] : ["1=1"];
    const params: (string | number)[] = [];
    for (const [param, column] of Object.entries(def.filters ?? {})) {
      const v = q[param];
      if (v !== undefined && v !== "") {
        where.push(`${col(column, filterCols)} = ?`);
        params.push(v);
      }
    }
    if (q.q?.trim()) {
      const like = `%${likeEscape(q.q.trim().slice(0, 80))}%`;
      where.push(`(${def.searchCols.map((s) => `${s} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
      for (let i = 0; i < def.searchCols.length; i++) params.push(like);
    }
    // sort field comes from a whitelist declared in code (never from the request); the request only picks among them
    const requested = q.sort?.replace(/^-/, "");
    const useRequested = !!requested && sortable.has(requested);
    const field = useRequested ? requested : def.defaultSort.replace(/^-/, "");
    const descending = (useRequested ? q.sort! : def.defaultSort).startsWith("-");
    const orderBy = `${field} ${descending ? "DESC" : "ASC"}, id DESC`;
    const { page, per_page, offset } = pageParams(q);
    return { where: where.join(" AND "), params, orderBy, page, per_page, offset, limit: forExport ? 5000 : per_page, off: forExport ? 0 : offset };
  }

  r.get("/", requirePerm(def.perms.read), async (c) => {
    const s = listSql(c, false);
    const [rows, total] = await Promise.all([
      all<Row>(c.env.DB, `SELECT * FROM ${def.table} WHERE ${s.where} ORDER BY ${s.orderBy} LIMIT ? OFFSET ?`, ...s.params, s.limit, s.off),
      first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM ${def.table} WHERE ${s.where}`, ...s.params),
    ]);
    const items = def.decorate ? await def.decorate(c, rows) : rows;
    return ok(c, { items, page: pageInfo(s.page, s.per_page, total?.n ?? 0) });
  });

  r.get("/export.csv", requirePerm(def.perms.read), async (c) => {
    const s = listSql(c, true);
    const rows = await all<Row>(c.env.DB, `SELECT * FROM ${def.table} WHERE ${s.where} ORDER BY ${s.orderBy} LIMIT ? OFFSET ?`, ...s.params, s.limit, s.off);
    const columns = def.csv ?? (Object.keys(rows[0] ?? { id: 0 }).map((key) => ({ key, label: key })) as CsvColumn<Row>[]);
    return csvResponse(def.name, toCsv(rows, columns));
  });

  r.get("/:id", requirePerm(def.perms.read), async (c) => {
    const row = await fetchRow(c, intParam(c, "id"), true);
    const [item] = def.decorate ? await def.decorate(c, [row]) : [row];
    return ok(c, { item });
  });

  async function save(c: Ctx, kind: "create" | "update", id?: number) {
    const schema = kind === "create" ? def.schema : partial;
    const existing = kind === "update" ? await fetchRow(c, id!) : null;
    let data = (await parseBody(c, schema as z.ZodType)) as Record<string, unknown>;
    if (def.beforeSave) data = await def.beforeSave(c, data, existing);

    const keys = Object.keys(data).filter((k) => data[k] !== undefined && writable.has(k));
    let rowId = id;
    try {
      if (kind === "create") {
        if (keys.length === 0) throw new HttpError(422, "validation");
        const res = await run(c.env.DB, `INSERT INTO ${def.table} (${keys.map((k) => col(k, writable)).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => toDb(data[k])));
        rowId = res.meta.last_row_id as number;
      } else if (keys.length) {
        const set = keys.map((k) => `${col(k, writable)} = ?`).join(", ") + (def.hasUpdatedAt === false ? "" : ", updated_at = ?");
        await run(c.env.DB, `UPDATE ${def.table} SET ${set} WHERE id = ?`, ...keys.map((k) => toDb(data[k])), ...(def.hasUpdatedAt === false ? [] : [nowIso()]), id!);
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const msg = String(err);
      if (msg.includes("UNIQUE")) {
        const field = (/\.([a-z_]+)(?:\s|$|:)/i.exec(msg) ?? [])[1] ?? "slug";
        throw new HttpError(409, "duplicate", "duplicate", { [field]: "duplicate" });
      }
      if (msg.includes("CHECK") || msg.includes("FOREIGN KEY")) throw new HttpError(422, "validation");
      throw err;
    }
    const row = await fetchRow(c, rowId!, true);
    if (def.afterSave) await def.afterSave(c, row, data, kind, existing);
    await audit(c, { action: `${def.name}.${kind === "create" ? "created" : "updated"}`, entity: def.name, entityId: row.id, summary: def.label?.(row) ?? "", meta: { fields: keys } });
    if (def.publicContent) await bumpContentVersion(c.env);
    const [item] = def.decorate ? await def.decorate(c, [row]) : [row];
    return { item };
  }

  r.post("/", requirePerm(def.perms.write), async (c) => ok(c, await save(c, "create"), 201));
  r.patch("/:id", requirePerm(def.perms.write), async (c) => ok(c, await save(c, "update", intParam(c, "id"))));

  r.delete("/:id", requirePerm(def.perms.delete ?? def.perms.write), async (c) => {
    const id = intParam(c, "id");
    const row = await fetchRow(c, id);
    if (def.canDelete) await def.canDelete(c, row);
    if (def.softDelete) await run(c.env.DB, `UPDATE ${def.table} SET deleted_at = ? WHERE id = ?`, nowIso(), id);
    else await run(c.env.DB, `DELETE FROM ${def.table} WHERE id = ?`, id);
    await audit(c, { action: `${def.name}.deleted`, entity: def.name, entityId: id, summary: def.label?.(row) ?? "" });
    if (def.publicContent) await bumpContentVersion(c.env);
    return ok(c);
  });

  if (def.softDelete) {
    r.post("/:id/restore", requirePerm(def.perms.delete ?? def.perms.write), async (c) => {
      const id = intParam(c, "id");
      await fetchRow(c, id, true);
      await run(c.env.DB, `UPDATE ${def.table} SET deleted_at = NULL WHERE id = ?`, id);
      await audit(c, { action: `${def.name}.restored`, entity: def.name, entityId: id });
      if (def.publicContent) await bumpContentVersion(c.env);
      return ok(c);
    });
  }

  return r;
}
