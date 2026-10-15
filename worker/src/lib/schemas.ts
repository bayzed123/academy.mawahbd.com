import { z } from "zod";
import { normalizeAnyPhone } from "@mawah/shared";

/** Shared zod building blocks. Error "messages" are stable codes the UIs translate (see shared/i18n). */
export const emailSchema = z
  .string({ error: "required" })
  .trim()
  .toLowerCase()
  .max(254, "too_long")
  .pipe(z.email("invalid_email"));

/** An e-mail that may be left out: nothing (or only spaces) means "none"; something typed must be a real address. */
export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "too_long")
  .optional()
  .nullable()
  .transform((value, ctx) => {
    if (!value) return undefined;
    if (!z.email().safeParse(value).success) {
      ctx.addIssue({ code: "custom", message: "invalid_email" });
      return z.NEVER;
    }
    return value;
  });

export const passwordSchema = z
  .string({ error: "required" })
  .min(8, "weak_password")
  .max(128, "too_long");

/** A person's name: no space at either end and one space between words, 2–80 characters. */
export const nameSchema = z
  .string({ error: "required" })
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2, "required").max(80, "too_long"));

/** Optional phone number: a Bangladesh mobile is normalised to 01XXXXXXXXX; a number from another country (students abroad) is kept as +digits. Or null. */
export const phoneSchema = z
  .string()
  .trim()
  .max(20, "invalid_phone")
  .optional()
  .nullable()
  .transform((value, ctx) => {
    if (!value) return null;
    const n = normalizeAnyPhone(value);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return n;
  });

/** A phone number that must be given (checkout without an account: the shop follows up by call or WhatsApp). Same rules as phoneSchema. */
export const requiredPhoneSchema = z
  .string({ error: "required" })
  .trim()
  .min(1, "required")
  .max(20, "invalid_phone")
  .transform((value, ctx) => {
    const n = normalizeAnyPhone(value);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return n;
  });

/** Where someone lives, as they write it (one line or a few): 5–300 characters, no control characters, spaces tidied. */
export const addressSchema = z
  .string({ error: "required" })
  .transform((s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim())
  .pipe(z.string().min(5, "required").max(300, "too_long"));

export const langSchema = z.enum(["bn", "en"]);

/** Free text with a hard cap; control characters stripped. */
export const textSchema = (max: number, min = 0) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim())
    .pipe(z.string().min(min, "required").max(max, "too_long"));

export const turnstileField = z.string().max(2048).optional();

export const idSchema = z.coerce.number().int().positive();

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "required")
  .max(120, "too_long")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalid_slug");

export const urlSchema = z
  .string()
  .trim()
  .max(500, "too_long")
  .refine((v) => /^https?:\/\//i.test(v), "invalid_url");

export const optionalUrl = z
  .union([urlSchema, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
