/** Addresses on the website the app opens in the phone's browser (the shop's checkout, policies, a certificate, "forgot password"). */
export type Lang = "bn" | "en";

const prefix = (lang: Lang) => (lang === "en" ? "/en" : "");

export const siteLinks = (base: string, lang: Lang) => ({
  home: `${base}${prefix(lang)}/`,
  product: (slug: string) => `${base}${prefix(lang)}/shop/p/${encodeURIComponent(slug)}`,
  policy: (kind: "privacy" | "terms" | "refund") => `${base}${prefix(lang)}/policies/${kind}`,
  /** what deleting an account does, and the other ways to ask for it (the page Google Play is given) */
  accountDelete: `${base}${prefix(lang)}/account/delete`,
  certificate: (code: string) => `${base}/certificate/${encodeURIComponent(code)}`,
  forgot: `${base}/app/forgot`,
  media: (key: string) => `${base}/media/${key.split("/").map(encodeURIComponent).join("/")}`,
});

/** wa.me wants the number with its country code and digits only (the server already gives it so; this keeps a stray "+" or space out). */
export function whatsappLink(number: string, text?: string): string | null {
  const digits = number.replace(/\D+/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function telLink(phone: string): string | null {
  const clean = phone.replace(/[^\d+]/g, "");
  return clean.replace(/\D/g, "").length >= 6 ? `tel:${clean}` : null;
}

/** A link from the server that the app may open: web pages only (never javascript:, file: or an app scheme). */
export function safeWebUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
