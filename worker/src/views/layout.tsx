import { raw } from "hono/html";
import { loc, readSslLogo } from "@mawah/shared";
import { turnstileEnabled } from "../lib/turnstile";
import { isTracking, NO_TRACKING } from "../lib/tracking";
import { ANALYTICS_JS, BANNERS_JS, CSS, GALLERY_JS, OG_IMAGE, SITE_JS } from "../generated/assets";
import { OfferPopup } from "./banners";
import { localizedPath, type PageCtx } from "./ctx";
import { DEVELOPER, PAY_LOGOS } from "./footer-data";
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
  /** the page has pictures to look at large (a class with more than its main picture): load the viewer's script */
  gallery?: boolean;
  /** shows/hides the site chrome (certificate & invoice documents print without it) */
  chrome?: boolean;
  /** what the analytics script needs to know about this page (the class on show …); written into the page only when measuring is on */
  ga?: unknown;
  children?: unknown;
}

const digits = (s: string) => s.replace(/\D/g, "");
const httpUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : "");

export function Layout(props: LayoutProps) {
  const { ctx } = props;
  const { t, lang, settings, env } = ctx;
  const chrome = props.chrome !== false;
  const canonical = ctx.abs(props.canonicalPath ?? ctx.href(ctx.path));
  const image = props.image ?? ctx.abs(OG_IMAGE ?? "/icon-512.png");
  // a certificate or an invoice (chrome off) carries a person's name and a secret address: it is never measured, whatever the request
  const ids = chrome ? ctx.track : NO_TRACKING;
  const measuring = isTracking(ids);
  const tsKey = turnstileEnabled(env) ? env.TURNSTILE_SITE_KEY : "";
  const announcement = lang === "bn" ? settings.announcement.bn || settings.announcement.en : settings.announcement.en || settings.announcement.bn;
  const wa = digits(settings.contact.whatsapp);
  const waHref = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(t("wa.prefill"))}` : "";
  const fb = httpUrl(settings.contact.facebook);
  const yt = httpUrl(settings.contact.youtube);
  const ig = httpUrl(settings.contact.instagram);
  // the registered address and trade licence number (SSLCommerz asks for them on every page)
  const regAddress = lang === "bn" ? settings.contact.address_bn || settings.contact.address_en : settings.contact.address_en || settings.contact.address_bn;
  // SSLCommerz's own logo, when the owner has pasted the link SSLCommerz gave (Settings → Payments): it takes the place of the five small marks
  const sslLogo = settings.payments.sslcommerz ? readSslLogo(settings.payments.ssl_logo) : null;
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
        {measuring && props.ga !== undefined && <script type="application/json" id="mawah-ga">{jsonLd(props.ga)}</script>}
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
                    <li>
                      <a href={ctx.href("/policies/delivery")}>{t("policy.delivery")}</a>
                    </li>
                  </ul>
                  <p class="foot-h mt">{t("footer.help")}</p>
                  <ul>
                    <li>
                      <a href={ctx.href("/how-to-order")}>{t("policy.order")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/guide")}>{t("policy.guide")}</a>
                    </li>
                    <li>
                      <a href={ctx.href("/hotline")}>{t("policy.hotline")}</a>
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
                  {(regAddress || settings.contact.trade_license) && (
                    <p class="foot-legal">
                      {regAddress && (
                        <span>
                          {t("biz.address")}: {regAddress}
                        </span>
                      )}
                      {settings.contact.trade_license && (
                        <span>
                          {t("biz.license")}: {settings.contact.trade_license}
                        </span>
                      )}
                    </p>
                  )}
                  <p class="foot-h mt" id="pay-h">
                    {t("footer.payments")}
                  </p>
                  {sslLogo ? (
                    <p class="ssl-logo">
                      {sslLogo.href ? (
                        <a href={sslLogo.href} rel="noopener noreferrer" target="_blank">
                          <img src={sslLogo.src} alt={t("footer.sslAlt")} loading="lazy" decoding="async" />
                          <span class="vh"> ({t("shop.opens")})</span>
                        </a>
                      ) : (
                        <img src={sslLogo.src} alt={t("footer.sslAlt")} loading="lazy" decoding="async" />
                      )}
                    </p>
                  ) : (
                    <ul class="pay-logos" aria-labelledby="pay-h">
                      {PAY_LOGOS.map((p) => (
                        <li>
                          <img src={p.src} width={p.width} height={p.height} alt={t(`method.${p.key}` as "method.bkash")} loading="lazy" decoding="async" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div class="wrap foot-bottom">
                <span>{t("footer.rights", { year: new Date().getUTCFullYear() })}</span>
                <span class="foot-credit">
                  {t("footer.developed")}{" "}
                  <a href={DEVELOPER.url} rel="noopener noreferrer" target="_blank">
                    {DEVELOPER.name}
                    <span class="vh"> ({t("shop.opens")})</span>
                  </a>
                </span>
                {measuring && (
                  <span class="foot-choice">
                    <button type="button" data-ga-choices hidden data-off={t("ga.choice.off")} data-on={t("ga.choice.on")} data-is-off={t("ga.choice.is_off")} data-is-on={t("ga.choice.is_on")}>
                      {t("ga.choice.off")}
                    </button>
                    <span class="vh" role="status" data-ga-status />
                  </span>
                )}
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
        {measuring && <script src={ANALYTICS_JS} defer />}
        {props.gallery && <script src={GALLERY_JS} defer />}
      </body>
    </html>
  );
}

export { raw };
