import { shownEmail, studentCode, type StudentMe } from "@mawah/shared";

/**
 * What the apps are told about the signed-in student. `has_password` false = an account made at checkout that still has no password.
 * A buyer who gave no e-mail is stored under a made-up address: the apps are told "no e-mail" (empty), never that address.
 */
export function toMe(s: { id: number; name: string; email: string; phone: string | null; address?: string; locale: "bn" | "en"; has_password?: boolean }): StudentMe {
  return {
    kind: "student",
    id: s.id,
    name: s.name,
    email: shownEmail(s.email),
    phone: s.phone,
    address: s.address ?? "",
    locale: s.locale,
    code: studentCode(s.id),
    has_password: s.has_password ?? true,
  };
}
