/** Minimal escaping helpers for the few places that build HTML strings by hand (e-mails, markdown). */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only these URL schemes may ever appear in an href/src generated from user-controlled text. */
export function safeUrl(raw: string, opts: { allowRelative?: boolean } = { allowRelative: true }): string | null {
  const url = raw.trim().replace(/[\u0000-\u001f\u007f\s]+/g, "");
  if (!url) return null;
  if (opts.allowRelative && url.startsWith("/") && !url.startsWith("//")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:[^\s]+@[^\s]+$/i.test(url)) return url;
  if (/^tel:\+?[\d-]+$/i.test(url)) return url;
  return null;
}
