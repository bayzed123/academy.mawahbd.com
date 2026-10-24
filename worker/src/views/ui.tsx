import { raw } from "hono/html";
import type { Accent, CategoryDTO, CourseCardDTO } from "@mawah/shared";
import { formatMoney, formatNumber, loc } from "@mawah/shared";
import type { PageCtx } from "./ctx";
import { gaCardAttr } from "./ga";
import type { InstructorRating } from "../services/catalog";
import { menuShop } from "../lib/settings";

/* ------------------------------------------------------------------ icons & brand */
export const Icon = ({ name, class: cls = "" }: { name: string; class?: string }) => (
  <svg class={`icon ${cls}`.trim()} aria-hidden="true" focusable="false">
    <use href={`/sprite.svg#i-${name}`} />
  </svg>
);

/**
 * The official logo (marketing/public/logo.webp, built from brand/mawah-logo.jpg by scripts/gen-brand-assets.mjs).
 * It is a picture with its own black background: show it on black (header, footer) or as a framed badge (documents).
 */
export const LogoImg = ({ class: cls = "", ctx }: { class?: string; ctx: PageCtx }) => (
  <img class={cls} src="/logo.webp" width="520" height="283" alt={ctx.t("brand.name")} decoding="async" />
);

/** Header / footer lockup: logo + a small "Academy" label (the logo itself already says MAWAH). */
export const Brand = ({ ctx }: { ctx: PageCtx }) => (
  <a class="brand" href={ctx.href("/")} aria-label={ctx.t("brand.name")}>
    <img class="brand-logo" src="/logo-sm.webp" width="107" height="58" alt="" decoding="async" />
    <span class="brand-text">
      <span class="brand-name">{ctx.t("brand.academy")}</span>
    </span>
  </a>
);

/* ------------------------------------------------------------------ small pieces */
export const Stars = ({ value }: { value: number }) => (
  <span class="stars" role="img" aria-label={`${value.toFixed(1)} / 5`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <svg class={`icon${value + 0.25 >= i ? "" : " off"}`} aria-hidden="true">
        <use href="/sprite.svg#i-star" />
      </svg>
    ))}
  </span>
);

/** "1,234" in Bangla digits when the page is Bangla. */
export const numLabel = (ctx: PageCtx, n: number) => (ctx.lang === "bn" ? formatNumber(n, "bn") : String(n));
/** "4.8" (one decimal, Bangla digits on the Bangla site). */
export const avgLabel = (ctx: PageCtx, avg: number) => (ctx.lang === "bn" ? formatNumber(Math.round(avg * 10) / 10, "bn") : avg.toFixed(1));
export const reviewsLabel = (ctx: PageCtx, n: number) => (n === 1 ? ctx.t("reviews.count.one") : ctx.t("reviews.count", { n: numLabel(ctx, n) }));

/**
 * The menus' Shop link (menuShop): the Equipment Shop on this website (/shop) — or, when the owner gave its address, another shop of theirs,
 * which leaves the site, so it opens in a new tab and says so for screen readers (`internal` false). Null when switched off.
 */
export function shopOf(ctx: PageCtx): { href: string; label: string; host: string; internal: boolean } | null {
  const s = ctx.settings.shop;
  const to = menuShop(ctx.settings);
  if (!to) return null;
  if (to.own) return { href: ctx.href("/shop"), label: ctx.t("shop.title"), host: "", internal: true };
  let host = "";
  try {
    host = new URL(s.url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
  const label = (ctx.lang === "bn" ? s.label_bn || s.label_en : s.label_en || s.label_bn) || ctx.t("nav.shop");
  return { href: s.url, label, host, internal: false };
}

/**
 * A small rating badge: "★ 4.8 · 23 reviews" when students have rated, otherwise an honest "Not rated yet".
 * The numbers are always real (see InstructorRating); there is no way to show a made-up figure here.
 */
export const RatingBadge = ({ ctx, avg, count, href, hint }: { ctx: PageCtx; avg: number; count: number; href?: string; hint?: string }) => {
  const inner =
    count > 0 ? (
      <>
        <Stars value={avg} />
        <b>{avgLabel(ctx, avg)}</b>
        <span>· {reviewsLabel(ctx, count)}</span>
      </>
    ) : (
      <>
        <Stars value={0} />
        <span>{ctx.t("rating.none")}</span>
      </>
    );
  const cls = `rating-badge${count > 0 ? "" : " is-none"}`;
  return href ? (
    <a class={cls} href={href} title={hint}>
      {inner}
    </a>
  ) : (
    <span class={cls} title={hint}>
      {inner}
    </span>
  );
};

/** Instructor trust badges: who they are, how students rate them, how many classes they teach. */
export const InstructorBadges = ({ ctx, rating }: { ctx: PageCtx; rating?: InstructorRating }) => (
  <div class="badge-row">
    <span class="badge-pro">
      <Icon name="award" />
      {ctx.t("instructor.badge")}
    </span>
    <RatingBadge ctx={ctx} avg={rating?.avg ?? 0} count={rating?.count ?? 0} hint={ctx.t("instructor.rating_hint")} />
    {rating && rating.classes > 0 && <span class="badge-plain">{ctx.t("instructor.classes_n", { n: numLabel(ctx, rating.classes) })}</span>}
  </div>
);

export const SectionHead = ({
  eyebrow,
  title,
  sub,
  center,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  center?: boolean;
}) => (
  <header class={`sec-head${center ? " center" : ""}`}>
    {eyebrow && <span class="eyebrow">{eyebrow}</span>}
    <h2>{title}</h2>
    {sub && <p>{sub}</p>}
  </header>
);

/**
 * A row that slides sideways (marketing/site.js): swipe it on a phone, drag it with a mouse, or press the arrows. Without the script it is a
 * plain scrolling row; the arrows show only when there is more than fits.
 */
export const Carousel = ({ ctx, label, track, children }: { ctx: PageCtx; label: string; track?: Record<string, string>; children?: unknown }) => (
  <div class="carousel" data-carousel role="region" aria-roledescription="carousel" aria-label={label}>
    <div class="car-track" {...(track ?? {})}>
      {children as never}
    </div>
    <div class="car-nav" hidden>
      <button type="button" class="car-btn" data-car-prev aria-label={ctx.t("car.prev")}>
        <Icon name="chevron" />
      </button>
      <button type="button" class="car-btn" data-car-next aria-label={ctx.t("car.next")}>
        <Icon name="chevron" />
      </button>
    </div>
  </div>
);

export const Flash = ({ ctx, flag }: { ctx: PageCtx; flag: string | undefined }) => {
  if (!flag) return null;
  const map: Record<string, [string, string]> = {
    notify_ok: ["ok", ctx.t("notify.ok")],
    news_ok: ["ok", ctx.t("news.ok")],
    contact_ok: ["ok", ctx.t("contact.ok")],
    err: ["err", ctx.t("err.validation")],
  };
  const hit = map[flag];
  return hit ? (
    <p id="form-status" class={`flash ${hit[0]}`} role="status">
      {hit[1]}
    </p>
  ) : null;
};

export const Crumbs = ({ items }: { items: { label: string; href?: string }[] }) => (
  <ol class="crumbs" aria-label="breadcrumb">
    {items.map((it) => (
      <li>{it.href ? <a href={it.href}>{it.label}</a> : <span aria-current="page">{it.label}</span>}</li>
    ))}
  </ol>
);

/** The page numbers a numbered pager shows: the first, the last and two either side of this one; 0 marks a gap ("…"). */
export function pageList(page: number, pages: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 2) out.push(n);
    else if (out[out.length - 1] !== 0) out.push(0);
  }
  return out;
}

/** Previous / next with "Page 2 of 5" — or, with `numbers` (the shop), every page number to jump to, like a shop's category pages. */
export const Pager = ({
  ctx,
  page,
  pages,
  hrefFor,
  numbers = false,
}: {
  ctx: PageCtx;
  page: number;
  pages: number;
  hrefFor: (p: number) => string;
  numbers?: boolean;
}) =>
  pages <= 1 ? null : (
    <nav class={numbers ? "pager pager-num" : "pager"} aria-label={numbers ? ctx.t("shop.pages") : "pagination"}>
      {page > 1 ? (
        <a class="btn btn-outline btn-sm" rel="prev" href={hrefFor(page - 1)}>
          {ctx.t("pager.prev")}
        </a>
      ) : null}
      {numbers ? (
        <ol>
          {pageList(page, pages).map((n) =>
            n === 0 ? (
              <li aria-hidden="true">…</li>
            ) : (
              <li>
                {n === page ? (
                  <span aria-current="page">
                    <span class="vh">{ctx.t("pager.page", { n: numLabel(ctx, n), total: numLabel(ctx, pages) })}</span>
                    <span aria-hidden="true">{numLabel(ctx, n)}</span>
                  </span>
                ) : (
                  <a href={hrefFor(n)} aria-label={ctx.t("pager.page", { n: numLabel(ctx, n), total: numLabel(ctx, pages) })}>
                    {numLabel(ctx, n)}
                  </a>
                )}
              </li>
            ),
          )}
        </ol>
      ) : (
        <span>{ctx.t("pager.page", { n: ctx.lang === "bn" ? formatNumber(page, "bn") : page, total: ctx.lang === "bn" ? formatNumber(pages, "bn") : pages })}</span>
      )}
      {page < pages ? (
        <a class="btn btn-outline btn-sm" rel="next" href={hrefFor(page + 1)}>
          {ctx.t("pager.next")}
        </a>
      ) : null}
    </nav>
  );

/* ------------------------------------------------------------------ course card + banner */
type CardCat = NonNullable<CourseCardDTO["category"]> | CategoryDTO;

export const Banner = ({ course, ctx, eager = false }: { course: CourseCardDTO; ctx: PageCtx; eager?: boolean }) => {
  const href = ctx.href(`/courses/${course.slug}`);
  if (course.banner_key) {
    return (
      <a class="banner" href={href} tabindex={-1} aria-hidden="true">
        <img src={`/media/${course.banner_key}`} alt="" width="640" height="400" loading={eager ? "eager" : "lazy"} decoding="async" />
      </a>
    );
  }
  const cat = course.category;
  return (
    <a class="banner banner-art" href={href} tabindex={-1} aria-hidden="true">
      <span class="frame" />
      <Icon name={course.icon ?? cat?.icon ?? "cake"} />
    </a>
  );
};

/** The price as shown on buttons and the buy box: "৳১,৮৫০" (or "ফ্রি" for free classes). */
export const priceLabel = (ctx: PageCtx, price: number) => (price === 0 ? ctx.t("label.free") : formatMoney(price, ctx.lang));

export const NotifyForm = ({ ctx, slug, compact = false }: { ctx: PageCtx; slug: string; compact?: boolean }) => (
  <form
    class="form-inline"
    method="post"
    action="/api/notify"
    data-ajax
    data-ok={ctx.t("notify.ok")}
    data-err={ctx.t("notify.fail")}
    data-limit={ctx.t("err.rate_limited")}
  >
    <input type="hidden" name="course" value={slug} />
    <input type="hidden" name="lang" value={ctx.lang} />
    <label class="vh" for={`nf-${slug}${compact ? "-c" : ""}`}>
      {ctx.t("notify.ph")}
    </label>
    <input class="input" id={`nf-${slug}${compact ? "-c" : ""}`} type="email" name="email" required autocomplete="email" placeholder={ctx.t("notify.ph")} />
    <button class="btn btn-dark btn-sm" type="submit">
      {ctx.t("notify.btn")}
    </button>
    <p class="status-line full" data-status role="status" />
  </form>
);

export const CourseCard = ({ course, ctx, eager = false, headingLevel = 3 }: { course: CourseCardDTO; ctx: PageCtx; eager?: boolean; headingLevel?: 2 | 3 }) => {
  const Heading = headingLevel === 2 ? "h2" : "h3"; // 2 when the grid sits right under the page's h1, 3 under a section heading
  const soon = course.status === "coming_soon";
  const cat = course.category as (CardCat & { accent: Accent }) | null;
  const detail = ctx.href(`/courses/${course.slug}`);
  return (
    <article class={`card a-${cat?.accent ?? "snack"}`} {...gaCardAttr(ctx, course)}>
      <Banner course={course} ctx={ctx} eager={eager} />
      {cat && <span class="chip-cat">{loc(cat, "name", ctx.lang)}</span>}
      {soon && <span class="ribbon">{ctx.t("stock.out")}</span>}
      <div class="card-body">
        <Heading class="card-title">
          <a href={detail}>{loc(course, "title", ctx.lang)}</a>
        </Heading>
        <p class="card-desc">{loc(course, "short", ctx.lang)}</p>
        <div class="card-meta">
          <span class={soon ? "stock out" : "stock in"}>
            <Icon name={soon ? "clock" : "check"} />
            {ctx.t(soon ? "stock.out" : "stock.in")}
          </span>
          {course.level && (
            <span>
              <Icon name="layers" />
              {ctx.t(`label.${course.level}` as never)}
            </span>
          )}
          {course.lesson_count > 0 && (
            <span>
              <Icon name="play" />
              {ctx.t("card.lessons", { n: ctx.lang === "bn" ? formatNumber(course.lesson_count, "bn") : course.lesson_count })}
            </span>
          )}
          {course.rating_count > 0 && (
            <span>
              <Stars value={course.rating_avg} />
              {ctx.lang === "bn" ? formatNumber(course.rating_avg, "bn") : course.rating_avg.toFixed(1)}
            </span>
          )}
        </div>
        <div class="card-foot">
          <a class="btn btn-outline btn-sm" href={detail}>
            {ctx.t("btn.readMore")}
            <span class="vh"> — {loc(course, "title", ctx.lang)}</span>
          </a>
          {soon ? (
            <span class="badge-soon">
              <Icon name="clock" />
              {ctx.t("btn.comingSoon")}
            </span>
          ) : (
            <a class="btn btn-primary btn-sm" href={`/app/checkout?c=${encodeURIComponent(course.slug)}`}>
              {ctx.t("btn.enrollNow")}
              <span class="btn-price">{priceLabel(ctx, course.price)}</span>
            </a>
          )}
        </div>
        {soon && (
          <details class="notify">
            <summary>
              <Icon name="bell" />
              {ctx.t("card.notify_hint")}
            </summary>
            <NotifyForm ctx={ctx} slug={course.slug} compact />
          </details>
        )}
      </div>
    </article>
  );
};

/** Escape a JSON-LD payload so it can never close the surrounding <script> tag. */
export const jsonLd = (data: unknown) =>
  raw(JSON.stringify(data).replace(/</g, "\\u003c").replace(new RegExp("\\u2028", "g"), "\\\\u2028").replace(new RegExp("\\u2029", "g"), "\\\\u2029"));
