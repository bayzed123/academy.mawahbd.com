import { raw } from "hono/html";
import { loc } from "@mawah/shared";
import { turnstileEnabled } from "../lib/turnstile";
import { CSS, HAS_OG_IMAGE, SITE_JS } from "../generated/assets";
import { localizedPath, type PageCtx } from "./ctx";
import { Brand, Icon, jsonLd } from "./ui";

export interface LayoutProps {
  ctx: PageCtx;
  title: string;
  description: string;
  /** localised path used for <link rel=canonical>; defaults to the current page */
  canonicalPath?: string;
  image?: string;
  ogType?: "website" | "article";
  jsonLd?: unknown[];
  noindex?: boolean;
  bodyClass?: string;
  hasBuybar?: boolean;
  /** shows/hides the site chrome (certificate & invoice documents print without it) */
  chrome?: boolean;
  children?: unknown;
}

const safeId = (v: string, re: RegExp) => (re.test(v) ? v : "");
const digits = (s: string) => s.replace(/\D/g, "");
const httpUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : "");

export const analyticsIds = (ctx: PageCtx) => ({
  ga4: safeId(ctx.settings.analytics.ga4.trim(), /^G-[A-Z0-9]{4,20}$/),
  clarity: safeId(ctx.settings.analytics.clarity.trim(), /^[a-z0-9]{6,20}$/i),
  pixel: safeId(ctx.settings.analytics.meta_pixel.trim(), /^\d{8,20}$/),
});

export function Layout(props: LayoutProps) {
  const { ctx } = props;
  const { t, lang, settings, env } = ctx;
  const chrome = props.chrome !== false;
  const canonical = ctx.abs(props.canonicalPath ?? ctx.href(ctx.path));
  const image = props.image ?? ctx.abs(HAS_OG_IMAGE ? "/og-default.png" : "/favicon.svg");
  const ids = analyticsIds(ctx);
  const tsKey = turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY : "";
  const announcement = lang === "bn" ? settings.announcement.bn || settings.announcement.en : settings.announcement.en || settings.announcement.bn;
  const wa = digits(settings.contact.whatsapp);
  const waHref = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(t("wa.prefill"))}` : "";
  const fb = httpUrl(settings.contact.facebook);
  const yt = httpUrl(settings.contact.youtube);
  const ig = httpUrl(settings.contact.instagram);

  const nav = [
    { href: ctx.href("/courses"), label: t("nav.classes"), match: "/courses" },
    { href: ctx.href("/courses?level=beginner"), label: t("nav.beginners"), match: "" },
    { href: ctx.href("/blog"), label: t("nav.blog"), match: "/blog" },
    { href: ctx.href("/about"), label: t("nav.about"), match: "/about" },
    { href: ctx.href("/contact"), label: t("nav.contact"), match: "/contact" },
  ];
  const fontPreloads =
    lang === "bn"
      ? ["/fonts/hind-bn-400.woff2", "/fonts/tiro-bn-400.woff2"]
      : ["/fonts/hind-latin-400.woff2", "/fonts/playfair-latin-600.woff2"];

  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <meta name="description" content={props.description} />
        <meta name="theme-color" content="#073b2c" />
        {props.noindex ? <meta name="robots" content="noindex, follow" /> : <meta name="robots" content="index, follow, max-image-preview:large" />}
        <link rel="canonical" href={canonical} />
        <link rel="alternate" hreflang="bn" href={ctx.abs(localizedPath("bn", ctx.path))} />
        <link rel="alternate" hreflang="en" href={ctx.abs(localizedPath("en", ctx.path))} />
        <link rel="alternate" hreflang="x-default" href={ctx.abs(localizedPath("bn", ctx.path))} />
        <meta property="og:site_name" content="MAWAH Academy" />
        <meta property="og:type" content={props.ogType ?? "website"} />
        <meta property="og:title" content={props.title} />
        <meta property="og:description" content={props.description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={image} />
        <meta property="og:locale" content={lang === "bn" ? "bn_BD" : "en_US"} />
        <meta property="og:locale:alternate" content={lang === "bn" ? "en_US" : "bn_BD"} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={props.title} />
        <meta name="twitter:description" content={props.description} />
        <meta name="twitter:image" content={image} />
        {ids.ga4 && <meta name="mawah:ga4" content={ids.ga4} />}
        {ids.clarity && <meta name="mawah:clarity" content={ids.clarity} />}
        {ids.pixel && <meta name="mawah:pixel" content={ids.pixel} />}
        {tsKey && <meta name="mawah:turnstile" content={tsKey} />}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/manifest.webmanifest" />
        {fontPreloads.map((href) => (
          <link rel="preload" href={href} as="font" type="font/woff2" crossorigin="anonymous" />
        ))}
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        {(props.jsonLd ?? []).map((data) => (
          <script type="application/ld+json">{jsonLd(data)}</script>
        ))}
      </head>
      <body class={`${props.bodyClass ?? ""}${props.hasBuybar ? " has-buybar" : ""}`.trim() || undefined}>
        {chrome && (
          <>
            <a class="skip" href="#main">
              {t("nav.skip")}
            </a>
            {announcement && <div class="announce">{announcement}</div>}
            <header class="site-header">
              <div class="wrap nav">
                <Brand ctx={ctx} />
                <ul class="nav-links">
                  {nav.map((n) => (
                    <li>
                      <a href={n.href} aria-current={n.match && ctx.path.startsWith(n.match) ? "page" : undefined}>
                        {n.label}
                      </a>
                    </li>
                  ))}
                </ul>
                <div class="nav-actions">
                  <a class="lang-toggle" href={ctx.altHref} hreflang={lang === "bn" ? "en" : "bn"} lang={lang === "bn" ? "en" : "bn"} title={t("lang.switch")}>
                    <Icon name="globe" />
                    {t("lang.switch")}
                  </a>
                  <a class="btn btn-gold btn-sm" data-guest href="/app/login">
                    {t("btn.login")}
                  </a>
                  <a class="btn btn-gold btn-sm" data-user href="/app/" hidden>
                    {t("btn.myLearning")}
                  </a>
                  <details class="menu">
                    <summary aria-label={t("nav.menu")}>
                      <Icon name="menu" />
                    </summary>
                    <div class="menu-panel">
                      {nav.map((n) => (
                        <a href={n.href}>{n.label}</a>
                      ))}
                      <a href={ctx.href("/verify")}>
                        <Icon name="award" />
                        {t("nav.verify")}
                      </a>
                    </div>
                  </details>
                </div>
              </div>
            </header>
          </>
        )}

        <main id="main">{props.children as never}</main>

        {chrome && (
          <>
            <footer class="site-footer">
              <div class="wrap foot-grid">
                <div>
                  <Brand ctx={ctx} />
                  <p>{t("footer.about")}</p>
                  {(fb || yt || ig) && (
                    <div class="social">
                      {fb && (
                        <a href={fb} rel="noopener noreferrer" target="_blank" aria-label="Facebook">
                          <Icon name="facebook" />
                        </a>
                      )}
                      {yt && (
                        <a href={yt} rel="noopener noreferrer" target="_blank" aria-label="YouTube">
                          <Icon name="youtube" />
                        </a>
                      )}
                      {ig && (
                        <a href={ig} rel="noopener noreferrer" target="_blank" aria-label="Instagram">
                          <Icon name="instagram" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <h4>{t("footer.classes")}</h4>
                  <ul>
                    {ctx.categories.map((c) => (
                      <li>
                        <a href={ctx.href(`/courses?cat=${c.slug}`)}>{loc(c, "name", lang)}</a>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>{t("footer.company")}</h4>
                  <ul>
                    <li>
                      <a href={ctx.href("/about")}>{t("nav.about")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/blog")}>{t("nav.blog")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/contact")}>{t("nav.contact")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/verify")}>{t("nav.verify")}</a>
                    </li>
                  </ul>
                  <h4 class="mt">{t("footer.policies")}</h4>
                  <ul>
                    <li>
                      <a href={ctx.href("/policies/refund")}>{t("policy.refund")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/policies/privacy")}>{t("policy.privacy")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/policies/terms")}>{t("policy.terms")}</a>
                    </li>
                  </ul>
                </div>
                <div>
                  <h4>{t("footer.contact")}</h4>
                  <ul>
                    {waHref && (
                      <li>
                        <a href={waHref} rel="noopener noreferrer" target="_blank">
                          {t("contact.whatsapp")}
                        </a>
                      </li>
                    )}
                    {settings.contact.phone && (
                      <li>
                        <a href={`tel:${settings.contact.phone.replace(/[^\d+]/g, "")}`}>{settings.contact.phone}</a>
                      </li>
                    )}
                    {settings.contact.email && (
                      <li>
                        <a href={`mailto:${settings.contact.email}`}>{settings.contact.email}</a>
                      </li>
                    )}
                  </ul>
                  <h4 class="mt">{t("footer.payments")}</h4>
                  <div class="pay-list">
                    <span>{t("method.bkash")}</span>
                    <span>{t("method.nagad")}</span>
                    <span>{t("method.rocket")}</span>
                    <span>{t("method.card")}</span>
                  </div>
                </div>
              </div>
              <div class="wrap foot-bottom">
                <span>{t("footer.rights", { year: new Date().getUTCFullYear() })}</span>
                <span>{t("brand.tagline")}</span>
              </div>
            </footer>

            <div class="floats">
              {waHref && (
                <a class="fab fab-wa" href={waHref} rel="noopener noreferrer" target="_blank" aria-label={t("wa.label")} title={t("wa.label")}>
                  <Icon name="whatsapp" />
                </a>
              )}
              {settings.chatbot.enabled && (
                <button class="fab fab-chat" type="button" data-chat-open aria-label={t("chat.open")} title={t("chat.open")}>
                  <Icon name="chat" />
                </button>
              )}
            </div>
          </>
        )}
        <script src={SITE_JS} defer />
      </body>
    </html>
  );
}

export { raw };
