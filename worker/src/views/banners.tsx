import { formatNumber, loc } from "@mawah/shared";
import type { BannerDTO } from "../services/banners";
import { localizedPath, type PageCtx } from "./ctx";
import { Icon } from "./ui";

/**
 * Banners the owner manages in Admin → Banners: the slider at the top of the home page and the offer pop-up.
 * The words and pictures are the owner's; the page adds what makes them usable — a real link or button, text for blind
 * visitors, controls that work without a mouse, no movement for people who asked for less, and no layout jump while the
 * pictures load (every slide has a fixed shape).
 */

/** Where a banner's button goes. A page of this site follows the visitor's language: /courses/x becomes /en/courses/x in English. */
export function bannerHref(ctx: PageCtx, url: string): string {
  if (ctx.lang === "en" && /^\/(?!\/)/.test(url) && !/^\/(en(\/|$)|app(\/|$)|admin(\/|$)|api\/|media\/)/.test(url)) return localizedPath("en", url);
  return url;
}

const newTab = (b: BannerDTO) => (b.new_tab ? { target: "_blank", rel: "noopener noreferrer" } : {});

const numLabel = (ctx: PageCtx, n: number) => (ctx.lang === "bn" ? formatNumber(n, "bn") : String(n));

function Picture({ b, alt, eager }: { b: BannerDTO; alt: string; eager: boolean }) {
  if (!b.image_key) return null;
  return (
    <picture>
      {b.mobile_image_key && <source media="(max-width: 720px)" srcset={`/media/${b.mobile_image_key}`} />}
      <img src={`/media/${b.image_key}`} alt={alt} width="1600" height="600" decoding="async" loading={eager ? "eager" : "lazy"} fetchpriority={eager ? "high" : undefined} />
    </picture>
  );
}

function Slide({ ctx, b, i, total }: { ctx: PageCtx; b: BannerDTO; i: number; total: number }) {
  const { t, lang } = ctx;
  const title = loc(b, "title", lang);
  const text = loc(b, "text", lang);
  const label = loc(b, "button", lang);
  const alt = loc(b, "alt", lang);
  const href = b.link_url ? bannerHref(ctx, b.link_url) : "";
  const button = !!label && !!href;
  // a picture with a link but no button is itself the link
  const wholePictureLinks = !!href && !label && !!b.image_key;
  const picture = <Picture b={b} alt={alt || (wholePictureLinks ? "" : title)} eager={i === 0} />;
  return (
    <div class={`bn-slide${b.image_key ? "" : " bn-plain"}`} role="group" aria-roledescription="slide" aria-label={t("banner.slide", { n: numLabel(ctx, i + 1), total: numLabel(ctx, total) })}>
      {wholePictureLinks ? (
        <a class="bn-media" href={href} {...newTab(b)} aria-label={alt || title || t("banner.open")}>
          {picture}
        </a>
      ) : (
        b.image_key && <div class="bn-media">{picture}</div>
      )}
      {(title || text || button) && (
        <div class="bn-copy">
          {title && <p class="bn-title">{title}</p>}
          {text && <p class="bn-text">{text}</p>}
          {button && (
            <a class="btn btn-primary btn-lg" href={href} {...newTab(b)}>
              {label}
              <Icon name="arrow" />
              {!!b.new_tab && <span class="vh"> ({t("banner.opens")})</span>}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** The slider at the top of the home page. One banner is a still picture; two or more become a slider with arrows, dots and a pause button. */
export function BannerSlider({ ctx, banners }: { ctx: PageCtx; banners: BannerDTO[] }) {
  const { t } = ctx;
  const n = banners.length;
  return (
    <div class="bn-band">
      <div class="wrap">
        <div class="bn" data-slider data-autoplay={n > 1 ? "" : undefined} role="region" aria-roledescription="carousel" aria-label={t("banner.region")}>
          <div class="bn-track">
            {banners.map((b, i) => (
              <Slide ctx={ctx} b={b} i={i} total={n} />
            ))}
          </div>
          {n > 1 && (
            <div class="bn-ctrl" hidden>
              <button type="button" class="bn-btn bn-prev" data-prev aria-label={t("banner.prev")}>
                <Icon name="arrow" />
              </button>
              <div class="bn-dots">
                {banners.map((_, i) => (
                  <button type="button" data-go aria-label={t("banner.go", { n: numLabel(ctx, i + 1) })} aria-current={i === 0 ? "true" : undefined} />
                ))}
              </div>
              <button type="button" class="bn-btn bn-next" data-next aria-label={t("banner.next")}>
                <Icon name="arrow" />
              </button>
              <button type="button" class="bn-btn bn-toggle" data-toggle data-pause={t("banner.pause")} data-play={t("banner.play")} aria-pressed="false" aria-label={t("banner.pause")}>
                <Icon name="pause" />
                <Icon name="play" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The offer pop-up: hidden until the script shows it after a pause, and never again to someone who closed it (until the owner edits it). */
export function OfferPopup({ ctx, banner: b }: { ctx: PageCtx; banner: BannerDTO }) {
  const { t, lang } = ctx;
  const title = loc(b, "title", lang);
  const text = loc(b, "text", lang);
  const label = loc(b, "button", lang);
  const alt = loc(b, "alt", lang);
  const href = b.link_url ? bannerHref(ctx, b.link_url) : "";
  const button = !!label && !!href;
  return (
    <div class="offer" data-offer data-id={b.id} data-v={b.updated_at} data-delay={b.popup_delay_sec} data-days={b.popup_repeat_days} role="dialog" aria-modal="true" aria-label={title || t("banner.offer")} hidden>
      <div class="offer-card">
        <button type="button" class="offer-x" data-offer-close aria-label={t("btn.close")}>
          <Icon name="x" />
        </button>
        {b.image_key &&
          (href && !label ? (
            <a class="offer-media" href={href} {...newTab(b)} aria-label={alt || title || t("banner.open")}>
              <Picture b={b} alt="" eager={false} />
            </a>
          ) : (
            <div class="offer-media">
              <Picture b={b} alt={alt || title} eager={false} />
            </div>
          ))}
        {(title || text || button) && (
          <div class="offer-copy">
            {title && <p class="offer-title">{title}</p>}
            {text && <p class="offer-text">{text}</p>}
            {button && (
              <a class="btn btn-primary btn-lg" href={href} {...newTab(b)}>
                {label}
                <Icon name="arrow" />
                {!!b.new_tab && <span class="vh"> ({t("banner.opens")})</span>}
              </a>
            )}
          </div>
        )}
        <button type="button" class="offer-no" data-offer-close>
          {t("banner.no_thanks")}
        </button>
      </div>
    </div>
  );
}
