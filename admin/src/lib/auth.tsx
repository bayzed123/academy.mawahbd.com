import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { can, type Permission, type StaffMe } from "@mawah/shared";
import { adm } from "./api";

interface Auth {
  /** undefined while loading, null when signed out */
  staff: StaffMe | null | undefined;
  can: (p: Permission) => boolean;
  login: (email: string, password: string) => Promise<StaffMe>;
  setup: (v: { setup_token: string; name: string; email: string; password: string }) => Promise<StaffMe>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["staff-me"], queryFn: async () => (await adm<{ staff: StaffMe | null }>("/auth/me")).staff, staleTime: 60_000 });

  const value = useMemo<Auth>(() => {
    const staff = me.isPending ? undefined : (me.data ?? null);
    const open = async (path: string, body: unknown) => {
      const res = await adm<{ staff: StaffMe }>(path, { json: body });
      // drop everything cached for the previous (or anonymous) session, but keep the observed "me" query alive
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "staff-me" });
      qc.setQueryData(["staff-me"], res.staff);
      return res.staff;
    };
    return {
      staff,
      can: (p) => can(staff?.role, p),
      login: (email, password) => open("/auth/login", { email, password }),
      setup: (v) => open("/auth/setup", v),
      async logout() {
        await adm("/auth/logout", { method: "POST", json: {} }).catch(() => undefined);
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "staff-me" });
        qc.setQueryData(["staff-me"], null);
      },
      refresh: async () => {
        await qc.invalidateQueries({ queryKey: ["staff-me"] });
      },
    };
  }, [me.isPending, me.data, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
