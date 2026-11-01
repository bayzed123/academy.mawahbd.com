import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "./config";

/** An answer from the server that is not "ok": its error code (worker/src/lib/http.ts), or "network" when the phone could not reach it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(code);
  }
}

let token: string | null = null;
let onSignedOut: (() => void) | null = null;

/** The session token (set by the sign-in); every call sends it as `Authorization: Bearer …`. */
export function setToken(next: string | null) {
  token = next;
}
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
/** Called when the server says the token is no longer good (logged out elsewhere, password changed, blocked). */
export function onUnauthorized(fn: (() => void) | null) {
  onSignedOut = fn;
}

export interface CallOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** seconds before giving up on a slow network (default 20) */
  timeout?: number;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: CallOptions = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (opts.timeout ?? 20) * 1000);
  opts.signal?.addEventListener("abort", () => ctrl.abort());
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, "network");
  } finally {
    clearTimeout(timer);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON: an outage page */
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; fields?: Record<string, string> } } | null)?.error;
    if (res.status === 401 && token) onSignedOut?.();
    throw new ApiError(res.status, err?.code ?? (res.status >= 500 ? "server" : "unknown"), err?.fields ?? {});
  }
  return data as T;
}

/* ------------------------------------------------------------------------------------------------ data on screens */

/**
 * What a screen shows: kept in memory while the app runs, so going back to a screen is instant, and fetched again in the background
 * (pull down to refresh does it on purpose).
 */
const cache = new Map<string, unknown>();

export function clearCache() {
  cache.clear();
}

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useResource<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T | undefined>(() => (path ? (cache.get(path) as T | undefined) : undefined));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path && !cache.has(path));
  const [refreshing, setRefreshing] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(
    async (manual: boolean) => {
      if (!path) return;
      if (manual) setRefreshing(true);
      try {
        const next = await api<T>(path);
        cache.set(path, next);
        if (live.current) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (live.current) setError(err instanceof ApiError ? err : new ApiError(0, "network"));
      } finally {
        if (live.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [path],
  );

  useEffect(() => {
    if (!path) {
      setData(undefined);
      setLoading(false);
      return;
    }
    setData(cache.get(path) as T | undefined);
    setLoading(!cache.has(path));
    void load(false);
  }, [path, load]);

  const refresh = useCallback(() => load(true), [load]);
  return { data, error, loading, refreshing, refresh };
}
