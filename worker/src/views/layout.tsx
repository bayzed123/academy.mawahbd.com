import { raw } from "hono/html";
import { loc } from "@mawah/shared";
import { turnstileEnabled } from "../lib/turnstile";
import { BANNERS_JS, CSS, HAS_OG_IMAGE, SITE_JS } from "../generated/assets";
import { OfferPopup } from "./banners";
import { localizedPath, type PageCtx } from "./ctx";
import { Brand, Icon, jsonLd, shopOf } from "./ui";

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
  /** the page has a banner slider: load the script that moves it */
  slider?: boolean;
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
  const image = props.image ?? ctx.abs(HAS_OG_IMAGE ? "/og-default.jpg" : "/icon-512.png");
  const ids = analyticsIds(ctx);
  const tsKey = turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY : "";
  const announcement = lang === "bn" ? settings.announcement.bn || settings.announcement.en : settings.announcement.en || settings.announcement.bn;
  const wa = digits(settings.contact.whatsapp);
  const waHref = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(t("wa.prefill"))}` : "";
  const fb = httpUrl(settings.contact.facebook);
  const yt = httpUrl(settings.contact.youtube);
  const ig = httpUrl(settings.contact.instagram);
  const shop = shopOf(ctx);
  const shopAttrs = { target: "_blank", rel: "noopener noreferrer", "data-shop": "" } as const;

  const nav = [
    { href: ctx.href("/courses"), label: t("nav.classes"), match: "/courses" },
    { href: ctx.href("/courses?level=beginner"), label: t("nav.beginners"), match: "" },
    { href: ctx.href("/blog"), label: t("nav.blog"), match: "/blog" },
    { href: ctx.href("/about"), label: t("nav.about"), match: "/about" },
    { href: ctx.href("/faq"), label: t("nav.faq"), match: "/faq" },
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
        <meta name="theme-color" content="#070304" />
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
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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
                  {shop && (
                    <li class="nav-shop">
                      <a href={shop.href} {...shopAttrs}>
                        <Icon name="shop" />
                        {shop.label}
                        <Icon name="external" />
                        <span class="vh"> ({t("shop.opens")})</span>
                      </a>
                    </li>
                  )}
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
                      {shop && (
                        <a class="menu-shop" href={shop.href} {...shopAttrs}>
                          <Icon name="shop" />
                          {shop.label}
                          <Icon name="external" />
                          <span class="vh"> ({t("shop.opens")})</span>
                        </a>
                      )}
                      <a href={ctx.href("/verify")}>
                        <Icon name="award" />
                        {t("nav.verify")}
                      </a>
                      <a class="menu-login" data-guest href="/app/login">
                        <Icon name="user" />
                        {t("btn.login")}
                      </a>
                      <a class="menu-login" data-user href="/app/" hidden>
                        <Icon name="book" />
                        {t("btn.myLearning")}
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
                  <p class="foot-h">{t("footer.classes")}</p>
                  <ul>
                    {ctx.categories.map((c) => (
                      <li>
                        <a href={ctx.href(`/courses?cat=${c.slug}`)}>{loc(c, "name", lang)}</a>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p class="foot-h">{t("footer.company")}</p>
                  <ul>
                    <li>
                      <a href={ctx.href("/about")}>{t("nav.about")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/blog")}>{t("nav.blog")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/faq")}>{t("nav.faq")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/contact")}>{t("nav.contact")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/verify")}>{t("nav.verify")}</a>
                    </li>
                    {shop && (
                      <li>
                        <a href={shop.href} {...shopAttrs}>
                          {shop.label} ↗<span class="vh"> ({t("shop.opens")})</span>
                        </a>
                      </li>
                    )}
                  </ul>
                  <p class="foot-h mt">{t("footer.policies")}</p>
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
                  <p class="foot-h">{t("footer.contact")}</p>
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
                  <p class="foot-h mt">{t("footer.payments")}</p>
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
        {chrome && ctx.popup && <OfferPopup ctx={ctx} banner={ctx.popup} />}
        <script src={SITE_JS} defer />
        {((chrome && ctx.popup) || props.slider) && <script src={BANNERS_JS} defer />}
      </body>
    </html>
  );
}

export { raw };
