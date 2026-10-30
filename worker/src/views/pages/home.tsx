import { formatMoney, formatNumber, loc, playsOnPublicPages, videoEmbed, videoThumb, videoWatchUrl, type CategoryDTO, type CourseCardDTO } from "@mawah/shared";
import type { InstructorDTO, PublicReview } from "../../services/catalog";
import { stripMarkdown } from "../../lib/markdown";
import type { PageCtx } from "../ctx";
import { gaListAttr } from "../ga";
import { Layout } from "../layout";
import { Carousel, CourseCard, Flash, Highlight, Icon, InstructorBadges, SectionHead, Stars, shopOf } from "../ui";
import { organizationLd, websiteLd } from "../seo";
import type { BannerDTO } from "../../services/banners";
import type { FaqDTO } from "../../services/faqs";
import { BannerSlider } from "../banners";
import { HomeFaq } from "../faq";

/** One of the owner's home-page videos (Admin → Home videos): a YouTube or Vimeo address and its title. */
export interface HomeVideo {
  id: number;
  url: string;
  title_bn: string;
  title_en: string;
}

export interface HomeData {
  /** the owner's slider banners (Admin → Banners); empty = the page opens with the built-in welcome */
  banners: BannerDTO[];
  /** the owner's home-page questions (Admin → FAQ → "show on the home page"); none = no section */
  faqs: FaqDTO[];
  /** the owner's videos that are switched on (Admin → Home videos), in their order; none = no section */
  videos: HomeVideo[];
  featured: CourseCardDTO[];
  beginners: CourseCardDTO[];
  instructors: InstructorDTO[];
  reviews: (PublicReview & { course_title_bn: string; course_title_en: string; course_slug: string })[];
  posts: { slug: string; title_bn: string; title_en: string; excerpt_bn: string; excerpt_en: string; published_at: string | null }[];
  classCount: number;
  minPrice: number;
  flash?: string;
}

const num = (ctx: PageCtx, n: number) => (ctx.lang === "bn" ? formatNumber(n, "bn") : String(n));

export function HomePage({ ctx, data }: { ctx: PageCtx; data: HomeData }) {
  const { t, lang } = ctx;
  const trust = [
    { icon: "play", title: t("why.video.title"), desc: t("why.video.desc") },
    { icon: "award", title: t("why.cert.title"), desc: t("why.cert.desc") },
    { icon: "wallet", title: t("why.pay.title"), desc: t("why.pay.desc") },
    { icon: "chat", title: t("why.ask.title"), desc: t("why.ask.desc") },
  ];
  const shop = shopOf(ctx);
  return (
    <Layout
      ctx={ctx}
      title={t("meta.home.title")}
      description={t("meta.home.desc")}
      jsonLd={[organizationLd(ctx), websiteLd(ctx)]}
      slider={data.banners.length > 0}
      videos={data.videos.some((v) => playsOnPublicPages(v.url))}
    >
      {data.banners.length > 0 && <BannerSlider ctx={ctx} banners={data.banners} />}
      <section class={`hero${data.banners.length > 0 ? " has-banners" : ""}`}>
        <div class="wrap hero-grid">
          <span class="eyebrow">{t("hero.eyebrow")}</span>
          <h1>
            <Highlight text={t("hero.title")} hl={t("hero.title.hl")} />
          </h1>
          <p class="hero-sub">{t("hero.sub")}</p>
          <div class="hero-cta">
            <a class="btn btn-primary btn-lg" href={ctx.href("/courses")}>
              {t("hero.cta1")}
              <Icon name="arrow" />
            </a>
            <a class="btn btn-light btn-lg" href={ctx.href("/courses?level=beginner")}>
              {t("hero.cta2")}
            </a>
          </div>
          <ul class="chips">
            <li>
              <Icon name="award" />
              {t("hero.chip.cert")}
            </li>
            <li>
              <Icon name="wallet" />
              {t("hero.chip.pay")}
            </li>
            <li>
              <Icon name="phone" />
              {t("hero.chip.mobile")}
            </li>
            {data.minPrice > 0 && (
              <li>
                <Icon name="tag" />
                {t("hero.chip.from", { price: formatMoney(data.minPrice, lang) })}
              </li>
            )}
          </ul>
        </div>
      </section>

      {data.flash && (
        <div class="wrap flash-top">
          <Flash ctx={ctx} flag={data.flash} />
        </div>
      )}

      <section class="section band-light" id="why">
        <div class="wrap">
          <SectionHead title={t("why.title")} hl={t("why.title.hl")} sub={t("why.sub")} center />
          <div class="trust">
            {trust.map((x) => (
              <div class="trust-item">
                <span class="trust-ico">
                  <Icon name={x.icon} />
                </span>
                <h3>{x.title}</h3>
                <p>{x.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section class="section" id="classes">
        <div class="wrap">
          <SectionHead eyebrow={t("hero.count", { n: num(ctx, data.classCount) })} title={t("sec.classes")} hl={t("sec.classes.hl")} sub={t("sec.classes.sub")} />
          <div class="grid" {...gaListAttr(ctx, "home_featured")}>
            {data.featured.map((c, i) => (
              <CourseCard course={c} ctx={ctx} eager={i < 3} />
            ))}
          </div>
          <p class="center cta-row">
            <a class="btn btn-dark btn-lg" href={ctx.href("/courses")}>
              {t("btn.viewAll")}
              <Icon name="arrow" />
            </a>
          </p>
        </div>
      </section>

      <HomeVideos ctx={ctx} videos={data.videos} />

      {data.beginners.length > 0 && (
        <section class="section band" id="beginners">
          <div class="wrap">
            <SectionHead eyebrow={t("label.beginner")} title={t("sec.beginners")} hl={t("sec.beginners.hl")} sub={t("sec.beginners.sub")} />
            <Carousel ctx={ctx} label={t("sec.beginners")} track={gaListAttr(ctx, "home_beginners")}>
              {data.beginners.map((c) => (
                <CourseCard course={c} ctx={ctx} />
              ))}
            </Carousel>
          </div>
        </section>
      )}

      <section class="section">
        <div class="wrap">
          <SectionHead title={t("sec.categories")} hl={t("sec.categories.hl")} />
          <div class="tiles">
            {ctx.categories.map((c: CategoryDTO) => (
              <a class={`tile a-${c.accent}`} href={ctx.href(`/courses?cat=${c.slug}`)}>
                <span class="tile-ico">
                  <Icon name={c.icon} />
                </span>
                <span>
                  <b>{loc(c, "name", lang)}</b>
                  <small>{t("courses.count", { n: num(ctx, c.course_count ?? 0) })}</small>
                </span>
              </a>
            ))}
            {shop && (
              <a class="tile tile-shop" href={shop.href} {...(shop.internal ? {} : { target: "_blank", rel: "noopener noreferrer", "data-shop": "" })}>
                <span class="tile-ico">
                  <Icon name="shop" />
                </span>
                <span>
                  <b>
                    {shop.label}
                    {!shop.internal && (
                      <>
                        {" "}
                        <Icon name="external" />
                        <span class="vh"> ({t("shop.opens")})</span>
                      </>
                    )}
                  </b>
                  <small>{shop.internal ? t("shop.tile.own") : t("shop.tile.sub", { host: shop.host })}</small>
                </span>
              </a>
            )}
          </div>
        </div>
      </section>

      <section class="section band-light">
        <div class="wrap">
          <SectionHead title={t("sec.how")} hl={t("sec.how.hl")} center />
          <ol class="steps">
            {[1, 2, 3].map((n) => (
              <li class="step">
                <h3>{t(`how.${n}.title` as never)}</h3>
                <p>{t(`how.${n}.desc` as never)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {data.instructors.length > 0 && (
        <section class="section">
          <div class="wrap">
            <SectionHead title={t("sec.instructors")} hl={t("sec.instructors.hl")} />
            <div class="grid">
              {data.instructors.map((i) => (
                <div class="person">
                  <span class="avatar">{i.photo_key ? <img src={`/media/${i.photo_key}`} alt="" width="72" height="72" loading="lazy" /> : [...loc(i, "name", lang)][0]}</span>
                  <div>
                    <h3>
                      <a href={ctx.href(`/instructors/${i.slug}`)}>{loc(i, "name", lang)}</a>
                    </h3>
                    <p class="muted">{loc(i, "headline", lang)}</p>
                    <InstructorBadges ctx={ctx} rating={i.rating} />
                    <p>{stripMarkdown(loc(i, "bio", lang), 140)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {data.reviews.length > 0 && (
        <section class="section band">
          <div class="wrap">
            <SectionHead title={t("sec.reviews")} hl={t("sec.reviews.hl")} />
            <Carousel ctx={ctx} label={t("sec.reviews")}>
              {data.reviews.map((r) => (
                <figure class="review">
                  <Stars value={r.rating} />
                  <p>{r.body}</p>
                  <footer>
                    {r.author} · <a href={ctx.href(`/courses/${r.course_slug}`)}>{loc({ title_bn: r.course_title_bn, title_en: r.course_title_en }, "title", lang)}</a>
                  </footer>
                </figure>
              ))}
            </Carousel>
          </div>
        </section>
      )}

      {data.faqs.length > 0 && <HomeFaq ctx={ctx} items={data.faqs} />}

      {data.posts.length > 0 && (
        <section class="section">
          <div class="wrap">
            <SectionHead title={t("sec.blog")} hl={t("sec.blog.hl")} />
            <div class="grid">
              {data.posts.map((p) => (
                <article class="card">
                  <div class="card-body">
                    <h3 class="card-title">
                      <a href={ctx.href(`/blog/${p.slug}`)}>{loc(p, "title", lang)}</a>
                    </h3>
                    <p class="card-desc">{loc(p, "excerpt", lang)}</p>
                    <a class="btn btn-outline btn-sm" href={ctx.href(`/blog/${p.slug}`)}>
                      {t("blog.read")}
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section class="band-dark">
        <div class="wrap news">
          <div>
            <h2>{t("news.title")}</h2>
            <p>{t("news.sub")}</p>
          </div>
          <form class="form-inline" method="post" action="/api/newsletter" data-ajax data-ok={t("news.ok")} data-err={t("notify.fail")} data-limit={t("err.rate_limited")}>
            <input type="hidden" name="lang" value={lang} />
            <label class="vh" for="news-email">
              {t("news.ph")}
            </label>
            <input class="input" id="news-email" type="email" name="email" required autocomplete="email" placeholder={t("news.ph")} />
            <button class="btn btn-gold" type="submit">
              {t("news.btn")}
            </button>
            <p class="status-line full" data-status role="status" />
          </form>
        </div>
      </section>
    </Layout>
  );
}

/**
 * The owner's videos: each one its picture with an orange play button; pressed, the video site's own player takes the picture's place and
 * plays right here (marketing/site.js). The player's address is rebuilt from the checked video id (shared/src/videoEmbed.ts). A video whose
 * address no longer plays here is left out. Without JavaScript the picture opens the video on its own site.
 */
export function HomeVideos({ ctx, videos }: { ctx: PageCtx; videos: HomeVideo[] }) {
  const { t, lang } = ctx;
  const items = videos
    .map((v) => ({ v, embed: videoEmbed(v.url), watch: videoWatchUrl(v.url), thumb: videoThumb(v.url), title: loc(v, "title", lang) }))
    .filter((x) => x.embed && x.watch && x.embed.site !== "facebook");
  if (!items.length) return null;
  const n = Math.min(items.length, 3);
  return (
    <section class="section" id="videos" aria-labelledby="videos-h">
      <div class="wrap">
        <SectionHead eyebrow={t("vid.eyebrow")} title={t("vid.title")} hl={t("vid.title.hl")} sub={t("vid.sub")} id="videos-h" />
        <ul class={`vids n${n}`}>
          {items.map(({ embed, watch, thumb, title }) => (
            <li>
              <div class="vid" data-player={`${embed!.src}${embed!.src.includes("?") ? "&" : "?"}autoplay=1`} data-title={title || t("vid.untitled")}>
                <a class="vid-play" href={watch!} target="_blank" rel="noopener noreferrer" aria-label={`${t("vid.play")}: ${title || t("vid.untitled")}`}>
                  {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" width={480} height={360} />}
                  <span class="vid-btn" aria-hidden="true">
                    <Icon name="play" />
                  </span>
                </a>
              </div>
              {title && <p class="vid-title">{title}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
