/** Thin, typed helpers over D1. Always use bound parameters — never string-concatenate user input. */

export const nowIso = (d: Date = new Date()): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export function addSeconds(iso: string | Date, seconds: number): string {
  const base = typeof iso === "string" ? new Date(iso) : iso;
  return nowIso(new Date(base.getTime() + seconds * 1000));
}

type Param = string | number | null | boolean;

export async function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: Param[]
): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: Param[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

export async function run(db: D1Database, sql: string, ...params: Param[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

/** `?,?,?` for IN (...) lists. */
export function qs(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

/** Escape a user string for use inside a LIKE pattern (with ESCAPE '\\'). */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export interface PageInfo {
  page: number;
  per_page: number;
  total: number;
  pages: number;
}

export function pageParams(
  query: { page?: string | undefined; per_page?: string | undefined },
  defaults = { per_page: 20, max: 100 },
): { page: number; per_page: number; offset: number } {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const per_page = Math.min(defaults.max, Math.max(1, Math.floor(Number(query.per_page) || defaults.per_page)));
  return { page, per_page, offset: (page - 1) * per_page };
}

export function pageInfo(page: number, per_page: number, total: number): PageInfo {
  return { page, per_page, total, pages: Math.max(1, Math.ceil(total / per_page)) };
}

export function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
