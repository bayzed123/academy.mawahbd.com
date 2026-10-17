/**
 * The SSLCommerz logo. SSLCommerz asks every shop that takes payments through it to show its own picture — one image with the logos of the
 * ways to pay — and gives the shop the link to it (as a bare link, or as a few lines of HTML with the picture inside a link). The owner pastes
 * whatever SSLCommerz gave into Admin → Settings → Payments; this reads it into the picture's address and, when there is one, the address the
 * picture links to. The website never makes up the link: until the owner pastes one, nothing of SSLCommerz's is shown.
 *
 * Only an https address on sslcommerz.com (or one of its sub-domains) is accepted — the picture is SSLCommerz's own, and the page's security
 * policy lets pictures come from there and nowhere else outside the website. Nothing pasted is ever put into a page as HTML: only the two
 * addresses taken out of it, after this check.
 */
export interface SslLogo {
  /** the picture */
  src: string;
  /** where the picture links to (SSLCommerz's own page), when the pasted code had a link */
  href: string | null;
}

/** The longest text the box takes: a link, or SSLCommerz's few lines of HTML. */
export const SSL_LOGO_MAX = 2000;

const isSslHost = (host: string) => host === "sslcommerz.com" || host.endsWith(".sslcommerz.com");

/** An https address on sslcommerz.com, cleaned up; null for anything else (another site, http, a user name or port in it, not an address). */
function sslAddress(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/&amp;/gi, "&"));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !isSslHost(u.hostname.toLowerCase())) return null;
  return u.href;
}

/** The value of attribute `name` on the first `<tag …>` in some HTML (quoted with " or ', or not quoted). */
function attr(html: string, tag: string, name: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*?\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(html);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

/**
 * What the owner pasted, read: the picture (and its link), or null when the box is empty or holds no SSLCommerz picture. HTML is read for
 * `<img src>` and `<a href>`; anything else for the first https address in it (so a link copied with a word or a line break around it works).
 */
export function readSslLogo(input: string | null | undefined): SslLogo | null {
  const text = (input ?? "").trim();
  if (!text || text.length > SSL_LOGO_MAX) return null;
  if (/<img\b/i.test(text)) {
    const src = sslAddress(attr(text, "img", "src") ?? "");
    if (!src) return null;
    const href = attr(text, "a", "href");
    return { src, href: href ? sslAddress(href) : null };
  }
  const first = /https?:\/\/[^\s"'<>]+/i.exec(text)?.[0];
  const src = first ? sslAddress(first) : null;
  return src ? { src, href: null } : null;
}
