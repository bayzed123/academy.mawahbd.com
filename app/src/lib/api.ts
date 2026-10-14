import type { ApiErrorBody } from "@mawah/shared";

/** A failed API call. `code` is a stable machine code ("invalid_credentials", "email_taken" …) the UI translates. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

interface Init {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  signal?: AbortSignal;
}

async function readBody<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | ApiErrorBody | null;
  if (!res.ok || !body || (body as { ok?: boolean }).ok === false) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? (res.status === 429 ? "rate_limited" : "generic"), err?.fields, err as unknown as Record<string, unknown>);
  }
  return body as T;
}

export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network");
  }
  return readBody<T>(res);
}

/** Sends a file's raw bytes (a payment screenshot). Errors come back exactly like api() errors. */
export async function apiUpload<T = unknown>(path: string, file: Blob): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  return readBody<T>(res);
}

/** Only same-site paths may be used as a post-login destination (blocks open redirects). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
}
