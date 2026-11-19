import type { Env, Lang } from "../env";
import { all } from "../lib/db";

/**
 * The chatbot's answers name the website's pages by their path ("My Learning (/app/)", "/courses/beginners-baking-class"). A visitor should
 * not have to read a path: each page an answer names becomes a button under it, with the page's own name (a class: its real title), and the
 * path is taken out of the words. Only pages that exist get a button — a class that is not on sale, or a path the website does not have,
 * gets none.
 */
export interface ChatLink {
  label: string;
  href: string;
}

const PAGES: Record<string, { bn: string; en: string; app?: true }> = {
  "/": { bn: "হোম পেজ", en: "Home page" },
  "/courses": { bn: "সব ক্লাস", en: "All classes" },
  "/free-classes": { bn: "ফ্রি ক্লাস", en: "Free classes" },
  "/how-to-order": { bn: "কীভাবে অর্ডার করবেন", en: "How to order" },
  "/guide": { bn: "ইউজার গাইড", en: "User guide" },
  "/faq": { bn: "প্রশ্ন ও উত্তর", en: "Questions & answers" },
  "/contact": { bn: "যোগাযোগ", en: "Contact us" },
  "/hotline": { bn: "হটলাইন", en: "Hotline" },
  "/verify": { bn: "সার্টিফিকেট যাচাই", en: "Check a certificate" },
  "/blog": { bn: "ব্লগ", en: "Blog" },
  "/about": { bn: "আমাদের সম্পর্কে", en: "About us" },
  "/shop": { bn: "শপ", en: "Shop" },
  "/policies/refund": { bn: "রিফান্ড নীতি", en: "Refund policy" },
  "/policies/privacy": { bn: "গোপনীয়তা নীতি", en: "Privacy policy" },
  "/policies/terms": { bn: "শর্তাবলি", en: "Terms" },
  "/policies/delivery": { bn: "ডেলিভারি নীতি", en: "Delivery policy" },
  "/app/": { bn: "আমার ক্লাস", en: "My Learning", app: true },
  "/app/login": { bn: "লগইন", en: "Sign in", app: true },
  "/app/register": { bn: "অ্যাকাউন্ট খুলুন", en: "Create an account", app: true },
  "/app/forgot": { bn: "পাসওয়ার্ড ভুলে গেছি", en: "Forgot password", app: true },
  "/app/orders": { bn: "আমার অর্ডার", en: "My orders", app: true },
  "/app/certificates": { bn: "আমার সার্টিফিকেট", en: "My certificates", app: true },
  "/app/profile": { bn: "প্রোফাইল", en: "Profile", app: true },
};

// a path the answer names: on its own, in brackets, or as this site's full address; with or without "/en" in front
const PATH = String.raw`(?:\/en)?\/(?:app(?:\/(?:login|register|forgot|orders|certificates|profile))?\/?|courses\/[a-z0-9-]{1,80}|courses|free-classes|how-to-order|guide|faq|contact|hotline|verify|blog|about|shop|policies\/(?:refund|privacy|terms|delivery))`;

/** This site's own addresses (the configured one and the public domain), for full links an answer may write out. */
function siteHost(env: Env): string {
  let own = "";
  try {
    own = new URL(env.SITE_URL).host.replace(/^www\./, "").replace(/\./g, "\\.");
  } catch {
    /* only the public domain */
  }
  return own && own !== "mawahacademy\\.com" ? `(?:${own}|mawahacademy\\.com)` : "mawahacademy\\.com";
}

/** The path as the table above knows it ("/en/courses" → "/courses"; "/app" → "/app/"). */
const keyOf = (path: string) => {
  const p = path.replace(/^\/en(?=\/)/, "").replace(/\/+$/, "") || "/";
  return p === "/app" ? "/app/" : p;
};

/** Take the pages out of an answer's words and give them back as buttons (at most four, each once). */
export async function linkify(env: Env, text: string, lang: Lang): Promise<{ reply: string; links: ChatLink[] }> {
  const host = siteHost(env);
  const token = new RegExp(String.raw`(?:https?:\/\/(?:www\.)?${host})?(${PATH})(?![\w/-])`, "g");
  const found: string[] = [];
  for (const m of text.matchAll(token)) {
    const k = keyOf(m[1]);
    if (!found.includes(k)) found.push(k);
  }
  if (!found.length) return { reply: text, links: [] };

  // a class only when it is really on the website
  const slugs = found.filter((k) => k.startsWith("/courses/")).map((k) => k.slice("/courses/".length));
  const classes = slugs.length
    ? await all<{ slug: string; title_bn: string; title_en: string }>(
        env.DB,
        `SELECT slug, title_bn, title_en FROM courses WHERE slug IN (${slugs.map(() => "?").join(",")}) AND deleted_at IS NULL AND status IN ('published','coming_soon') AND channel = 'website'`,
        ...slugs,
      )
    : [];
  const label = (k: string): string | null => {
    if (k.startsWith("/courses/")) {
      const c = classes.find((x) => x.slug === k.slice("/courses/".length));
      return c ? (lang === "en" ? c.title_en || c.title_bn : c.title_bn || c.title_en) : null;
    }
    const page = PAGES[k];
    return page ? page[lang] : null;
  };
  const href = (k: string) => (k.startsWith("/app/") || lang === "bn" ? k : k === "/" ? "/en" : `/en${k}`);

  const links: ChatLink[] = [];
  for (const k of found) {
    const l = label(k);
    if (l && links.length < 4) links.push({ label: l, href: href(k) });
  }

  // the words: a path in brackets after a page's name is dropped ("My Learning (/app/)" → "My Learning"); a path standing on its own
  // becomes the page's name ("go to /contact" → "go to Contact us"); a class that is not on the website keeps nothing at all
  const bracketed = new RegExp(String.raw`\s*[(（\[]\s*(?:https?:\/\/(?:www\.)?${host})?(${PATH})\s*[)）\]]`, "g");
  let reply = text.replace(bracketed, "");
  reply = reply.replace(token, (_all, p: string) => label(keyOf(p)) ?? "");
  reply = reply
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([।.,;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
  return { reply, links };
}
