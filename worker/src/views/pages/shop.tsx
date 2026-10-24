import { SHOP_PER_PAGE, formatMoney, formatNumber, loc, percentOff, type ShopCardDTO, type ShopCategoryDTO, type ShopProductDTO, type ShopReviewDTO } from "@mawah/shared";
import { renderMarkdown, stripMarkdown } from "../../lib/markdown";
import { SHOP_SORTS, type ShopSort } from "../../services/shop";
import type { PageCtx } from "../ctx";
import { Layout } from "../layout";
import { breadcrumbLd } from "../seo";
import { avgLabel, Crumbs, Icon, Pager, reviewsLabel, Stars } from "../ui";
import { raw } from "hono/html";

/*
 * The Equipment Shop's own pages (server-made, so search engines and link previews see them): the grid with its categories and pages, and a
 * product with its weights, prices, pictures, description, reviews and related products. The cart, the wishlist and "Add to cart" work in
 * the browser (marketing/shop.js keeps only variant ids and quantities); checkout is in the app (/app/shop/…), where the Worker prices
 * everything again.
 */

const money = (ctx: PageCtx, n: number) => formatMoney(n, ctx.lang);
const num = (ctx: PageCtx, n: number) => (ctx.lang === "bn" ? formatNumber(n, "bn") : String(n));

/** "−20%" in a red corner when the usual price is above the price. */
const OffBadge = ({ ctx, price, list }: { ctx: PageCtx; price: number; list: number }) => {
  const p = percentOff(price, list);
  return p ? <span class="off-badge">{ctx.t("shop.off", { n: num(ctx, p) })}</span> : null;
};

/** The heart: add to / take off the wishlist (the browser keeps the list; shop.js turns it on). */
const WishButton = ({ ctx, product, big = false }: { ctx: PageCtx; product: { id: number; name_bn: string; name_en: string }; big?: boolean }) => (
  <button type="button" class={`wish${big ? " wish-big" : ""}`} data-wish={product.id} aria-pressed="false" hidden>
    <Icon name="heart" />
    <span class={big ? "" : "vh"}>
      <span data-wish-off>{ctx.t("shop.wish.add")}</span>
      <span data-wish-on hidden>
        {ctx.t("shop.wish.remove")}
      </span>
      <span class="vh"> — {loc(product, "name", ctx.lang)}</span>
    </span>
  </button>
);

/** A product in the grid. `category` is its category's name, said above the name when the grid knows it. */
export const ProductCard = ({ ctx, p, eager = false, headingLevel = 2, category }: { ctx: PageCtx; p: ShopCardDTO; eager?: boolean; headingLevel?: 2 | 3; category?: string }) => {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const href = ctx.href(`/shop/p/${p.slug}`);
  const name = loc(p, "name", ctx.lang);
  return (
    <article class="pcard">
      <a class="pcard-img" href={href} tabindex={-1} aria-hidden="true">
        {p.image ? <img src={p.image} alt="" width="480" height="480" loading={eager ? "eager" : "lazy"} decoding="async" /> : <Icon name="shop" />}
      </a>
      <OffBadge ctx={ctx} price={p.price} list={p.list_price} />
      <WishButton ctx={ctx} product={p} />
      <div class="pcard-body">
        {category && <p class="pcard-cat">{category}</p>}
        <Heading class="pcard-title">
          <a href={href}>{name}</a>
        </Heading>
        {p.reviews > 0 && p.rating !== null && (
          <span class="pcard-rating">
            <Stars value={p.rating} />
            <span>({num(ctx, p.reviews)})</span>
          </span>
        )}
        <p class="pcard-price">
          {p.several && <span class="from">{ctx.t("shop.from")} </span>}
          <b>{money(ctx, p.price)}</b>
          {p.list_price > p.price && (
            <s>
              <span class="vh">{ctx.t("shop.was")} </span>
              {money(ctx, p.list_price)}
            </s>
          )}
        </p>
        {!p.in_stock ? (
          <span class="btn btn-outline btn-sm is-disabled" aria-disabled="true">
            {ctx.t("shop.out")}
          </span>
        ) : p.variant_id ? (
          <button type="button" class="btn btn-primary btn-sm" data-add={p.variant_id} data-name={name}>
            <Icon name="cart" />
            {ctx.t("shop.add")}
            <span class="vh"> — {name}</span>
          </button>
        ) : (
          <a class="btn btn-outline btn-sm" href={href}>
            {ctx.t("shop.choose")}
            <span class="vh"> — {name}</span>
          </a>
        )}
      </div>
    </article>
  );
};

/** The cart button in the shop's own bar: how many things are in it (shop.js fills the number). */
const ShopBar = ({ ctx }: { ctx: PageCtx }) => (
  <div class="shop-bar">
    <a class="btn btn-ghost btn-sm" href="/app/shop/wishlist">
      <Icon name="heart" />
      {ctx.t("shop.wishlist")}
      <span class="count-badge" data-wish-count hidden />
    </a>
    <a class="btn btn-dark btn-sm" href="/app/shop/cart">
      <Icon name="cart" />
      {ctx.t("shop.cart")}
      <span class="count-badge" data-cart-count hidden />
    </a>
  </div>
);

const PolicyLinks = ({ ctx }: { ctx: PageCtx }) => (
  <p class="shop-policies small">
    <a href={ctx.href("/policies/shop-terms")}>{ctx.t("policy.shop_terms")}</a>
    {" · "}
    <a href={ctx.href("/policies/shop-returns")}>{ctx.t("policy.shop_returns")}</a>
    {" · "}
    <a href={ctx.href("/policies/privacy")}>{ctx.t("policy.privacy")}</a>
  </p>
);

export interface ShopListData {
  items: ShopCardDTO[];
  total: number;
  page: number;
  pages: number;
  categories: ShopCategoryDTO[];
  category: ShopCategoryDTO | null;
  sort: ShopSort;
  q?: string;
  /** the price filter, in whole taka (0 = no end) */
  min?: number;
  max?: number;
  inStock?: boolean;
}

/** A filter's hidden fields: each of the page's three small forms keeps what the other two chose. */
const Keep = ({ sort, q, min, max, inStock }: { sort?: ShopSort; q?: string; min?: number; max?: number; inStock?: boolean }) => (
  <>
    {sort && sort !== "featured" && <input type="hidden" name="sort" value={sort} />}
    {q && <input type="hidden" name="q" value={q} />}
    {!!min && <input type="hidden" name="min" value={String(min)} />}
    {!!max && <input type="hidden" name="max" value={String(max)} />}
    {inStock && <input type="hidden" name="stock" value="1" />}
  </>
);

/*
 * The shop's grid, laid out like a shop's category page: the categories, a price filter and "in stock only" at the side (above the grid on
 * a phone, the filters folded away), "Showing 1–12 of 30 results" with the sorting, the products four to a row on a computer and two on a
 * phone, and numbered pages. Every filter is an ordinary form and link, so it works without the script and each result has its own address.
 */
export function ShopPage({ ctx, data }: { ctx: PageCtx; data: ShopListData }) {
  const { t, lang } = ctx;
  const base = data.category ? `/shop/category/${data.category.slug}` : "/shop";
  const state = { sort: data.sort, q: data.q, min: data.min || 0, max: data.max || 0, inStock: !!data.inStock };
  const hrefFor = (over: { page?: number; sort?: ShopSort; q?: string }) => {
    const params = new URLSearchParams();
    const sort = over.sort ?? state.sort;
    const q = "q" in over ? over.q : state.q;
    if (sort !== "featured") params.set("sort", sort);
    if (q) params.set("q", q);
    if (state.min) params.set("min", String(state.min));
    if (state.max) params.set("max", String(state.max));
    if (state.inStock) params.set("stock", "1");
    if (over.page && over.page > 1) params.set("page", String(over.page));
    const qs = params.toString();
    return ctx.href(base) + (qs ? `?${qs}` : "");
  };
  const title = data.category ? loc(data.category, "name", lang) : t("shop.title");
  const crumbs = [{ label: t("nav.home"), href: ctx.href("/") }, ...(data.category ? [{ label: t("shop.title"), href: ctx.href("/shop") }, { label: title }] : [{ label: t("shop.title") }])];
  const filtered = !!(state.q || state.min || state.max || state.inStock);
  const from = (data.page - 1) * SHOP_PER_PAGE + 1;
  const to = Math.min(data.total, data.page * SHOP_PER_PAGE);
  const showing =
    data.total === 1 ? t("shop.showing.one") : data.pages <= 1 ? t("shop.showing.all", { n: num(ctx, data.total) }) : t("shop.showing", { from: num(ctx, from), to: num(ctx, to), n: num(ctx, data.total) });
  const catName = new Map(data.categories.map((c) => [c.slug, loc(c, "name", lang)]));
  // a category link keeps the sorting and the filters, and starts again at page one
  const catHref = (slug: string | null) => {
    const params = new URLSearchParams();
    if (state.sort !== "featured") params.set("sort", state.sort);
    if (state.min) params.set("min", String(state.min));
    if (state.max) params.set("max", String(state.max));
    if (state.inStock) params.set("stock", "1");
    const qs = params.toString();
    return ctx.href(slug ? `/shop/category/${slug}` : "/shop") + (qs ? `?${qs}` : "");
  };
  return (
    <Layout
      ctx={ctx}
      title={`${title}${data.page > 1 ? ` — ${t("pager.page", { n: num(ctx, data.page), total: num(ctx, data.pages) })}` : ""} — ${t("brand.name")}`}
      description={t("shop.sub")}
      noindex={filtered || data.sort !== "featured"}
      canonicalPath={ctx.href(base) + (data.page > 1 ? `?page=${data.page}` : "")}
      jsonLd={[breadcrumbLd(ctx, crumbs.map((c) => ({ name: c.label, path: c.href ?? ctx.href(base) })))]}
      shop
    >
      <section class="page-hero shop-hero">
        <div class="wrap">
          <Crumbs items={crumbs} />
          <h1>{title}</h1>
          <p>{t("shop.sub")}</p>
        </div>
      </section>
      <section class="section tight">
        <div class="wrap shop-layout">
          <aside class="shop-side">
            <section class="side-box" aria-labelledby="shop-cats">
              <h2 id="shop-cats" class="side-title">
                {t("shop.categories")}
              </h2>
              <ul class="cat-list">
                <li>
                  <a href={catHref(null)} aria-current={!data.category ? "page" : undefined}>
                    {t("shop.all")}
                  </a>
                </li>
                {data.categories.map((c) => (
                  <li>
                    <a href={catHref(c.slug)} aria-current={data.category?.slug === c.slug ? "page" : undefined}>
                      {loc(c, "name", lang)}
                      <span class="cat-n">{num(ctx, c.count)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            <details class="side-box side-filter" data-shop-filters open>
              <summary>
                <span class="side-title">{t("shop.filters")}</span>
                <Icon name="chevron" />
              </summary>
              <form class="filter-form" method="get" action={ctx.href(base)}>
                <Keep sort={state.sort} q={state.q} />
                <fieldset>
                  <legend>{t("shop.price")}</legend>
                  <div class="price-row">
                    <label>
                      <span>{t("shop.price.min")}</span>
                      <input class="input" type="number" name="min" min="0" step="1" inputmode="numeric" value={state.min ? String(state.min) : ""} />
                    </label>
                    <label>
                      <span>{t("shop.price.max")}</span>
                      <input class="input" type="number" name="max" min="0" step="1" inputmode="numeric" value={state.max ? String(state.max) : ""} />
                    </label>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>{t("shop.availability")}</legend>
                  <label class="check">
                    <input type="checkbox" name="stock" value="1" checked={state.inStock} />
                    <span>{t("shop.stock.only")}</span>
                  </label>
                </fieldset>
                <div class="filter-actions">
                  <button class="btn btn-primary btn-sm" type="submit">
                    {t("shop.apply")}
                  </button>
                  {filtered && (
                    <a class="btn btn-ghost btn-sm" href={ctx.href(base)}>
                      {t("shop.clear")}
                    </a>
                  )}
                </div>
              </form>
            </details>
            <PolicyLinks ctx={ctx} />
          </aside>
          <div class="shop-main">
            <div class="shop-tools">
              <form class="searchbar" method="get" action={ctx.href(base)} role="search">
                <Keep sort={state.sort} min={state.min} max={state.max} inStock={state.inStock} />
                <label class="vh" for="sq">
                  {t("shop.search")}
                </label>
                <input class="input" id="sq" type="search" name="q" value={data.q ?? ""} placeholder={t("shop.search")} maxlength={80} />
                <button class="btn btn-dark" type="submit">
                  <Icon name="search" />
                  {t("btn.search")}
                </button>
              </form>
              <ShopBar ctx={ctx} />
            </div>
            <div class="shop-toolbar">
              <p class="shop-count">{data.total ? showing : t("shop.count", { n: num(ctx, 0) })}</p>
              <form class="sort-form" method="get" action={ctx.href(base)}>
                <Keep q={state.q} min={state.min} max={state.max} inStock={state.inStock} />
                <label for="ssort">{t("shop.sort")}</label>
                <select class="input" id="ssort" name="sort" data-autosubmit>
                  {SHOP_SORTS.map((s) => (
                    <option value={s} selected={data.sort === s}>
                      {t(`sort.${s}` as never)}
                    </option>
                  ))}
                </select>
                <button class="btn btn-dark btn-sm" type="submit" data-autosubmit-btn>
                  {t("shop.apply")}
                </button>
              </form>
            </div>
            {data.items.length === 0 ? (
              <div class="empty">
                <Icon name="shop" />
                <p>{t("shop.empty")}</p>
                {(filtered || data.category) && (
                  <a class="btn btn-outline" href={ctx.href("/shop")}>
                    {t("courses.clear")}
                  </a>
                )}
              </div>
            ) : (
              <div class="pgrid">
                {data.items.map((p, i) => (
                  <ProductCard ctx={ctx} p={p} eager={i < 4} category={p.category_slug ? catName.get(p.category_slug) : undefined} />
                ))}
              </div>
            )}
            <Pager ctx={ctx} page={data.page} pages={data.pages} hrefFor={(p) => hrefFor({ page: p })} numbers />
          </div>
        </div>
      </section>
      <ShopToast ctx={ctx} />
    </Layout>
  );
}

/**
 * The shop's page while it is closed and the menus point to it: what is coming, and two ways on — WhatsApp (when the owner gave a
 * number) and the classes. No product, price or date is shown, because none is decided yet.
 */
export function ShopSoonPage({ ctx }: { ctx: PageCtx }) {
  const { t } = ctx;
  const wa = ctx.settings.contact.whatsapp.replace(/\D/g, "");
  return (
    <Layout ctx={ctx} title={`${t("shop.title")} — ${t("brand.name")}`} description={t("shop.soon.text")} noindex>
      <section class="page-hero shop-soon">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: t("shop.title") }]} />
          <p class="pill-badge">
            <span class="dot" aria-hidden="true" />
            {t("shop.soon.badge")}
          </p>
          <h1>{t("shop.title")}</h1>
          <p>{t("shop.soon.text")}</p>
          <div class="hero-cta">
            {wa && (
              <a class="btn btn-primary btn-lg" href={`https://wa.me/${wa}?text=${encodeURIComponent(t("wa.prefill"))}`} target="_blank" rel="noopener noreferrer">
                <Icon name="whatsapp" />
                {t("shop.soon.wa")}
                <span class="vh"> ({t("shop.opens")})</span>
              </a>
            )}
            <a class={`btn ${wa ? "btn-outline" : "btn-primary"} btn-lg`} href={ctx.href("/courses")}>
              {t("shop.soon.classes")}
              <Icon name="arrow" />
            </a>
          </div>
          {wa && <p class="muted">{t("shop.soon.ask")}</p>}
        </div>
      </section>
    </Layout>
  );
}

/** "Added to the cart — View cart": said once after "Add to cart" (shop.js shows it). */
const ShopToast = ({ ctx }: { ctx: PageCtx }) => (
  <div class="shop-toast" data-shop-toast role="status" aria-live="polite" hidden>
    <span data-toast-text data-added={ctx.t("shop.added")} data-full={ctx.t("shop.full")} />
    <a class="btn btn-sm btn-gold" href="/app/shop/cart">
      {ctx.t("shop.viewCart")}
    </a>
  </div>
);

function productLd(ctx: PageCtx, p: ShopProductDTO) {
  const prices = p.variants.map((v) => v.price);
  const inStock = p.variants.some((v) => v.in_stock);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: loc(p, "name", ctx.lang),
    description: stripMarkdown(loc(p, "short", ctx.lang) || loc(p, "body", ctx.lang), 300) || loc(p, "name", ctx.lang),
    url: ctx.abs(ctx.href(`/shop/p/${p.slug}`)),
    brand: { "@type": "Brand", name: "MAWAH" },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "BDT",
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      offerCount: prices.length,
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };
  if (p.images.length) data.image = p.images.map((i) => ctx.abs(i.large));
  if (p.reviews > 0 && p.rating !== null) data.aggregateRating = { "@type": "AggregateRating", ratingValue: p.rating, reviewCount: p.reviews };
  return data;
}

export function ProductPage({
  ctx,
  product: p,
  reviews,
  related,
  delivery,
}: {
  ctx: PageCtx;
  product: ShopProductDTO;
  reviews: ShopReviewDTO[];
  related: ShopCardDTO[];
  delivery: string;
}) {
  const { t, lang } = ctx;
  const name = loc(p, "name", lang);
  const first = p.variants.find((v) => v.in_stock) ?? p.variants[0];
  const body = loc(p, "body", lang);
  const crumbs = [
    { label: t("nav.home"), href: ctx.href("/") },
    { label: t("shop.title"), href: ctx.href("/shop") },
    ...(p.category ? [{ label: loc(p.category, "name", lang), href: ctx.href(`/shop/category/${p.category.slug}`) }] : []),
    { label: name },
  ];
  const label = (v: ShopProductDTO["variants"][number]) => (lang === "bn" ? v.label_bn || v.label_en : v.label_en || v.label_bn);
  return (
    <Layout
      ctx={ctx}
      title={`${name} — ${t("shop.title")} — ${t("brand.name")}`}
      description={stripMarkdown(loc(p, "short", lang) || body, 155) || name}
      image={p.images[0]?.large}
      jsonLd={[productLd(ctx, p), breadcrumbLd(ctx, crumbs.map((c) => ({ name: c.label, path: c.href ?? ctx.href(`/shop/p/${p.slug}`) })))]}
      shop
    >
      <section class="section tight">
        <div class="wrap">
          <div class="shop-tools">
            <Crumbs items={crumbs} />
            <ShopBar ctx={ctx} />
          </div>
          <div class="product">
            <div class="product-media">
              <div class="product-main">
                {p.images.length ? <img data-main-img src={p.images[0].large} alt={name} width="800" height="800" decoding="async" /> : <Icon name="shop" />}
                <OffBadge ctx={ctx} price={first.price} list={first.list_price} />
              </div>
              {p.images.length > 1 && (
                <ul class="product-thumbs" aria-label={t("shop.pictures")}>
                  {p.images.map((img, i) => (
                    <li>
                      <a href={img.large} data-thumb={img.large} aria-current={i === 0 ? "true" : undefined}>
                        <img src={img.small} alt={t("shop.picture", { n: num(ctx, i + 1), name })} width="96" height="96" loading="lazy" decoding="async" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div class="product-info">
              {p.category && (
                <a class="chip-cat" href={ctx.href(`/shop/category/${p.category.slug}`)}>
                  {loc(p.category, "name", lang)}
                </a>
              )}
              <h1>{name}</h1>
              {p.reviews > 0 && p.rating !== null ? (
                <a class="rating-badge" href="#reviews">
                  <Stars value={p.rating} />
                  <b>{avgLabel(ctx, p.rating)}</b>
                  <span>· {reviewsLabel(ctx, p.reviews)}</span>
                </a>
              ) : null}
              <p class="product-price" data-price-box>
                <b data-now>{money(ctx, first.price)}</b>
                <s data-was hidden={!(first.list_price > first.price)}>
                  <span class="vh">{t("shop.was")} </span>
                  <span data-list-amount>{money(ctx, first.list_price)}</span>
                </s>
                <span class="off-inline" data-off hidden={!percentOff(first.price, first.list_price)}>
                  {percentOff(first.price, first.list_price) ? t("shop.off", { n: num(ctx, percentOff(first.price, first.list_price)!) }) : ""}
                </span>
              </p>
              {loc(p, "short", lang) && <p class="product-short">{loc(p, "short", lang)}</p>}

              <form class="buy-form" data-buy-form data-off-tpl={t("shop.off", { n: "%n" })} data-left-tpl={t("shop.left", { n: "%n" })}>
                {p.variants.length > 1 && (
                  <fieldset class="variants">
                    <legend>{t("shop.weight")}</legend>
                    <div class="variant-list">
                      {p.variants.map((v) => (
                        <label class={`variant${v.in_stock ? "" : " is-out"}`}>
                          <input
                            type="radio"
                            name="variant"
                            value={v.id}
                            checked={v.id === first.id}
                            disabled={!v.in_stock}
                            data-price={money(ctx, v.price)}
                            data-list={v.list_price > v.price ? money(ctx, v.list_price) : ""}
                            data-pct={percentOff(v.price, v.list_price) ? num(ctx, percentOff(v.price, v.list_price)!) : ""}
                            data-stock={v.stock === null ? "" : String(v.stock)}
                            data-stock-label={v.stock === null ? "" : num(ctx, v.stock)}
                          />
                          <span>
                            {label(v) || money(ctx, v.price)}
                            {!v.in_stock && <small> · {t("shop.out")}</small>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {p.variants.length === 1 && <input type="hidden" name="variant" value={first.id} />}
                {p.variants.length === 1 && label(first) && <p class="muted">{t("shop.size", { size: label(first) })}</p>}
                <p class="stock-line" data-stock-line data-in={t("shop.inStock")}>
                  {first.in_stock ? (first.stock !== null && first.stock <= 5 ? t("shop.left", { n: num(ctx, first.stock) }) : t("shop.inStock")) : t("shop.out")}
                </p>
                <div class="buy-row">
                  <label class="vh" for="qty">
                    {t("shop.qty")}
                  </label>
                  <div class="qty">
                    <button type="button" class="qty-btn" data-qty="-1" aria-label={t("shop.less")}>
                      −
                    </button>
                    <input id="qty" class="input" type="number" name="qty" value="1" min="1" max="20" inputmode="numeric" />
                    <button type="button" class="qty-btn" data-qty="1" aria-label={t("shop.more")}>
                      +
                    </button>
                  </div>
                  <button type="submit" class="btn btn-primary" data-buy="add" data-name={name} disabled={!p.in_stock}>
                    <Icon name="cart" />
                    {t("shop.add")}
                  </button>
                  <button type="submit" class="btn btn-gold" data-buy="now" disabled={!p.in_stock}>
                    {t("shop.buyNow")}
                  </button>
                </div>
                <p class="hint" data-buy-hint hidden>
                  {t("shop.needJs")}
                </p>
              </form>
              <WishButton ctx={ctx} product={p} big />
              <ul class="product-facts">
                <li>
                  <Icon name="truck" />
                  {delivery || t("shop.deliveryAll")}
                </li>
                <li>
                  <Icon name="wallet" />
                  {t("shop.payWays")}
                </li>
                <li>
                  <Icon name="shield" />
                  <a href={ctx.href("/policies/shop-returns")}>{t("policy.shop_returns")}</a>
                </li>
              </ul>
            </div>
          </div>

          <div class="product-tabs">
            <section aria-labelledby="desc-h" class="prose">
              <h2 id="desc-h">{t("shop.description")}</h2>
              {body ? raw(renderMarkdown(body)) : <p class="muted">{loc(p, "short", lang) || name}</p>}
            </section>

            <section id="reviews" aria-labelledby="rev-h" class="product-reviews">
              <h2 id="rev-h">
                {t("shop.reviews")} ({num(ctx, p.reviews)})
              </h2>
              {reviews.length === 0 ? (
                <p class="muted">{t("shop.reviews.none")}</p>
              ) : (
                <ul class="review-list">
                  {reviews.map((r) => (
                    <li class="review">
                      <div class="review-head">
                        <Stars value={r.rating} />
                        <b>{r.name}</b>
                        {r.verified && (
                          <span class="badge-plain">
                            <Icon name="check" />
                            {t("shop.verified")}
                          </span>
                        )}
                        <time class="muted small" datetime={r.created_at}>
                          {new Date(r.created_at).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeZone: "Asia/Dhaka" })}
                        </time>
                      </div>
                      <p>{r.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <details class="review-write">
                <summary class="btn btn-outline btn-sm">{t("shop.review.write")}</summary>
                <form class="form-grid" method="post" action={`/api/shop/products/${p.slug}/reviews`} data-ajax data-ok={t("shop.review.thanks")} data-err={t("err.validation")} data-limit={t("err.rate_limited")}>
                  <fieldset class="stars-pick">
                    <legend>{t("shop.review.rating")}</legend>
                    {[5, 4, 3, 2, 1].map((n) => (
                      <label>
                        <input type="radio" name="rating" value={n} required checked={n === 5} />
                        <span>{"★".repeat(n)}</span>
                        <span class="vh">{t("shop.review.stars", { n: num(ctx, n) })}</span>
                      </label>
                    ))}
                  </fieldset>
                  <label for="rv-name">{t("contact.name")}</label>
                  <input class="input" id="rv-name" name="name" required maxlength={80} autocomplete="name" />
                  <label for="rv-phone">{t("shop.review.phone")}</label>
                  <input class="input" id="rv-phone" name="phone" type="tel" inputmode="tel" required maxlength={20} autocomplete="tel" placeholder="01XXXXXXXXX" aria-describedby="rv-phone-h" />
                  <p class="hint" id="rv-phone-h">
                    {t("shop.review.phoneHint")}
                  </p>
                  <label for="rv-body">{t("shop.review.body")}</label>
                  <textarea class="input" id="rv-body" name="body" required minlength={3} maxlength={1500} rows={4} />
                  <div data-turnstile />
                  <button class="btn btn-primary" type="submit">
                    {t("shop.review.send")}
                  </button>
                  <p class="status-line" data-status role="status" />
                </form>
              </details>
            </section>
          </div>

          {related.length > 0 && (
            <section class="section tight" aria-labelledby="rel-h">
              <h2 id="rel-h">{t("shop.related")}</h2>
              <div class="pgrid">
                {related.map((r) => (
                  <ProductCard ctx={ctx} p={r} headingLevel={3} />
                ))}
              </div>
            </section>
          )}
          <PolicyLinks ctx={ctx} />
        </div>
      </section>
      <ShopToast ctx={ctx} />
    </Layout>
  );
}
