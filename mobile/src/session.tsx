import type { StudentMe } from "@mawah/shared/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, clearCache, onUnauthorized, setToken } from "./api";
import { KEYS, readValue, writeValue } from "./storage";

type Status = "loading" | "in" | "out";

interface Session {
  status: Status;
  me: StudentMe | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Profile → Delete my account: deletes the account on the server (`password` when it has one), then forgets it on the phone */
  deleteAccount: (password?: string) => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Signing in on the app: the server hands the app a session token (POST /api/auth/login with client "app"), the app keeps it in the
 * phone's encrypted storage and sends it with every call. Opening the app starts at once from what it remembers, then checks with the
 * server; a token the server no longer accepts (logged out, password changed, account blocked) signs the app out.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<StudentMe | null>(null);

  const forget = useCallback(async () => {
    setToken(null);
    clearCache();
    setMe(null);
    setStatus("out");
    await Promise.all([writeValue(KEYS.token, null), writeValue(KEYS.me, null)]);
  }, []);

  useEffect(() => {
    onUnauthorized(() => void forget());
    return () => onUnauthorized(null);
  }, [forget]);

  useEffect(() => {
    void (async () => {
      const [token, saved] = await Promise.all([readValue(KEYS.token), readValue(KEYS.me)]);
      if (!token) {
        setStatus("out");
        return;
      }
      setToken(token);
      try {
        if (saved) setMe(JSON.parse(saved) as StudentMe);
      } catch {
        /* an unreadable copy is fetched again below */
      }
      setStatus("in");
      try {
        const res = await api<{ student: StudentMe | null }>("/api/auth/me");
        if (!res.student) return void forget();
        setMe(res.student);
        void writeValue(KEYS.me, JSON.stringify(res.student));
      } catch (err) {
        // offline: keep going with what the phone remembers
        if (err instanceof ApiError && err.status === 401) void forget();
      }
    })();
  }, [forget]);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await api<{ student: StudentMe; token: string }>("/api/auth/login", { method: "POST", body: { identifier, password, client: "app" } });
    if (!res.token) throw new ApiError(500, "server");
    setToken(res.token);
    clearCache();
    await Promise.all([writeValue(KEYS.token, res.token), writeValue(KEYS.me, JSON.stringify(res.student))]);
    setMe(res.student);
    setStatus("in");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST", timeout: 8 });
    } catch {
      /* signed out on the phone either way; the token also runs out on its own */
    }
    await forget();
  }, [forget]);

  const deleteAccount = useCallback(
    async (password?: string) => {
      await api("/api/auth/delete-account", { method: "POST", body: { confirm: true, ...(password ? { password } : {}) } });
      await forget();
    },
    [forget],
  );

  const value = useMemo(() => ({ status, me, login, logout, deleteAccount }), [status, me, login, logout, deleteAccount]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
