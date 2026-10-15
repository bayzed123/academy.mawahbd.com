import { studentCode, type StudentMe } from "@mawah/shared";

/** What the apps are told about the signed-in student. `has_password` false = an account made at checkout that still has no password. */
export function toMe(s: { id: number; name: string; email: string; phone: string | null; locale: "bn" | "en"; has_password?: boolean }): StudentMe {
  return {
    kind: "student",
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone,
    locale: s.locale,
    code: studentCode(s.id),
    has_password: s.has_password ?? true,
  };
}
