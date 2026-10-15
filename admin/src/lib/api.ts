import type { ApiErrorBody } from "@mawah/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string>,
  ) {
    super(code);
  }
}

interface Init {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  /** raw body (uploads) — sent as-is with the given content type */
  body?: Blob | ArrayBuffer;
  contentType?: string;
  signal?: AbortSignal;
}

/** Fetch under /api (staff session cookie, same origin). Throws ApiError with the server's stable error code. */
export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  const hasJson = init.json !== undefined;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (hasJson || init.body ? "POST" : "GET"),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(hasJson ? { "Content-Type": "application/json" } : {}),
        ...(init.body ? { "Content-Type": init.contentType ?? "application/octet-stream" } : {}),
      },
      body: hasJson ? JSON.stringify(init.json) : init.body,
      signal: init.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network");
  }
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | ApiErrorBody | null;
  if (!res.ok || !body || (body as { ok?: boolean }).ok === false) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? (res.status === 429 ? "rate_limited" : "generic"), err?.fields);
  }
  return body as T;
}

/**
 * Sends a file's raw bytes with a progress report (fetch cannot report upload progress, XMLHttpRequest can). The browser sets
 * Content-Length itself, which the Worker needs to stream a big file straight into storage. Errors come back like api() errors;
 * `signal` cancels the upload.
 */
export function upload<T = unknown>(path: string, file: Blob, opts: { onProgress?: (pct: number) => void; signal?: AbortSignal } = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      const body = xhr.response as (T & { ok?: boolean }) | ApiErrorBody | null;
      if (xhr.status >= 200 && xhr.status < 300 && body && (body as { ok?: boolean }).ok !== false) resolve(body as T);
      else {
        const err = (body as ApiErrorBody | null)?.error;
        reject(new ApiError(xhr.status, err?.code ?? (xhr.status === 413 ? "file_too_large" : xhr.status === 429 ? "rate_limited" : "generic"), err?.fields));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Admin-scoped helper: adm("/orders") -> /api/admin/orders */
export const adm = <T = unknown>(path: string, init?: Init) => api<T>(`/admin${path}`, init);

export function qstring(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
