import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StudentMe } from "@mawah/shared";
import { api } from "./api";

interface AuthState {
  /** undefined while the first check is running */
  student: StudentMe | null | undefined;
  login: (email: string, password: string, turnstile?: string) => Promise<StudentMe>;
  register: (input: { name: string; email: string; phone?: string; password: string; lang: string; marketing: boolean; turnstile?: string }) => Promise<StudentMe>;
  logout: () => Promise<void>;
  setStudent: (s: StudentMe) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api<{ student: StudentMe | null }>("/auth/me")).student,
    staleTime: 5 * 60_000,
  });

  const login = useMutation({
    mutationFn: async (v: { email: string; password: string; turnstile?: string }) => (await api<{ student: StudentMe }>("/auth/login", { json: v })).student,
  });
  const register = useMutation({
    mutationFn: async (v: Parameters<AuthState["register"]>[0]) => (await api<{ student: StudentMe }>("/auth/register", { json: v })).student,
  });

  const value = useMemo<AuthState>(
    () => ({
      student: me.isPending ? undefined : (me.data ?? null),
      async login(email, password, turnstile) {
        const s = await login.mutateAsync({ email, password, turnstile });
        qc.clear();
        qc.setQueryData(["me"], s);
        return s;
      },
      async register(input) {
        const s = await register.mutateAsync(input);
        qc.clear();
        qc.setQueryData(["me"], s);
        return s;
      },
      async logout() {
        await api("/auth/logout", { method: "POST", json: {} }).catch(() => undefined);
        qc.clear();
        qc.setQueryData(["me"], null);
      },
      setStudent: (s) => qc.setQueryData(["me"], s),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me.isPending, me.data, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
