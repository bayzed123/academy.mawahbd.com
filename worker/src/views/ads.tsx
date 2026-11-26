import { AD_SIZES, loc, type AdSpot } from "@mawah/shared";
import type { BannerDTO } from "../services/banners";
import { bannerHref } from "./banners";
import type { PageCtx } from "./ctx";

/*
 * The academy's own ads (Admin → Banners → "Ad on the pages people read"): a picture that opens one of its pages — a class, an offer,
 * the shop. The owner uploads it once and ticks the kinds of page; every page of that kind then shows it by itself (no work per page or
 * per post). The picture is shown whole, never cropped or written over: the wide one on a computer, the phone one (when given) on a
 * phone. With several ads for a place, each visit shows another (marketing/site.js picks one; without JavaScript the first shows), and two
 * places on one page never show the same ad. The look: marketing/ad.css, sent only with pages that have an ad (Layout `ads`).
 */

/** Where a link of the owner's leads on this site ("/courses/x", "https://<this site>/en/courses/x" → "/courses/x"), or null (elsewhere). */
function sitePath(ctx: PageCtx, url: string): string | null {
  let path: string;
  if (/^\/(?!\/)/.test(url)) path = url;
  else {
    try {
      const u = new URL(url);
      if (u.origin !== new URL(ctx.abs("/")).origin) return null;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return path === "/en" ? "/" : path.replace(/^\/en(?=\/)/, "");
}

/** The ads worth showing on this page: not one that only opens the page the visitor is already on. */
export function adsForPage(ctx: PageCtx, ads: BannerDTO[]): BannerDTO[] {
  return ads.filter((b) => sitePath(ctx, b.link_url) !== ctx.path);
}

/**
 * One place for an ad. Every place of a page holds the same ads in the same order; `slot` says which this is (0, 1 …), so that the page
 * shows ad (k + slot) here — a different ad in each place.
 */
export function AdSlot({ ctx, ads, spot, slot = 0, grid = false }: { ctx: PageCtx; ads: BannerDTO[]; spot: AdSpot; slot?: number; grid?: boolean }) {
  if (ads.length === 0) return null;
  const { t, lang } = ctx;
  const shown = slot % ads.length;
  return (
    <aside class={`ad-slot${grid ? " ad-in-grid" : ""}`} aria-label={t("ad.label")} data-ad-slot={String(slot)}>
      {ads.map((b, i) => {
        const alt = loc(b, "alt", lang) || t("banner.open");
        return (
          <a
            class="ad"
            href={bannerHref(ctx, b.link_url)}
            data-ad={String(b.id)}
            data-ad-spot={spot}
            {...(b.new_tab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            {...(i === shown ? {} : { hidden: true })}
          >
            <picture>
              {b.mobile_image_key && <source media="(max-width: 720px)" srcset={`/media/${b.mobile_image_key}`} width={String(AD_SIZES.phone.w)} height={String(AD_SIZES.phone.h)} />}
              <img src={`/media/${b.image_key}`} alt={alt} width={String(AD_SIZES.wide.w)} height={String(AD_SIZES.wide.h)} loading="lazy" decoding="async" />
            </picture>
            {!!b.new_tab && <span class="vh"> ({t("banner.opens")})</span>}
          </a>
        );
      })}
    </aside>
  );
}

/**
 * Where the ad goes inside a blog post (its rendered blocks: paragraphs, headings, lists …): about a third of the way into a post long
 * enough to read on past it (6 blocks or more), never straight after a heading; -1 for a short post (its ad goes after it).
 */
export function adBreak(blocks: string[]): number {
  if (blocks.length < 6) return -1;
  let i = Math.ceil(blocks.length / 3);
  while (i > 1 && /^<h\d/.test(blocks[i - 1])) i--;
  return i;
}
