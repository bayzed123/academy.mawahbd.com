import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";

/** An error with an HTTP status and a stable machine code that the UIs translate. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public fields?: Record<string, string>,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code = "bad_request", fields?: Record<string, string>) =>
  new HttpError(400, code, code, fields);
export const unauthorized = (code = "unauthorized") => new HttpError(401, code);
export const forbidden = (code = "forbidden") => new HttpError(403, code);
export const notFound = (code = "not_found") => new HttpError(404, code);
export const conflict = (code: string, fields?: Record<string, string>) => new HttpError(409, code, code, fields);
export const tooMany = (code = "rate_limited") => new HttpError(429, code);

/** Map zod issues to `{ field: code }` — codes come from the schema messages (e.g. "invalid_email"). */
export function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in fields)) fields[key] = issue.message && !issue.message.startsWith("Invalid") ? issue.message : "invalid";
  }
  return fields;
}

export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      return await c.req.json();
    } catch {
      throw new HttpError(400, "invalid_json");
    }
  }
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    return Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  }
  throw new HttpError(415, "unsupported_media_type");
}

/** Parse + validate a request body with zod; throws a 422 with per-field codes. */
export async function parseBody<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  const data = await readJson(c);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpError(422, "validation", "validation", zodFields(parsed.error));
  return parsed.data;
}

export function parseQuery<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.output<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw new HttpError(422, "validation", "validation", zodFields(parsed.error));
  return parsed.data;
}

export function ok<T extends object>(c: Context<AppEnv>, data: T = {} as T, status: 200 | 201 = 200) {
  return c.json({ ok: true as const, ...data }, status);
}

export function intParam(c: Context<AppEnv>, name: string): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
}
