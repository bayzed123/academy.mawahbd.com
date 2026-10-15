import { formatMoney, formatNumber, loc, type CategoryDTO, type CourseCardDTO } from "@mawah/shared";
import type { InstructorDTO, PublicReview } from "../../services/catalog";
import { stripMarkdown } from "../../lib/markdown";
import type { PageCtx } from "../ctx";
import { HeroArt } from "../hero-art";
import { Layout } from "../layout";
import { CourseCard, Flash, Icon, InstructorBadges, SectionHead, Stars, shopOf } from "../ui";
import { organizationLd, websiteLd } from "../seo";

export interface HomeData {
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
    >
      <section class="hero">
        <div class="wrap hero-grid">
          <div>
            <span class="eyebrow">{t("hero.eyebrow")}</span>
            <h1>{t("hero.title")}</h1>
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
            </ul>
          </div>
          <div class="hero-art">
            <HeroArt />
            <div class="tag-float tag-a">
              <Icon name="award" />
              <span>
                {t("hero.chip.cert")}
                <small>MWH-••••-••••-••••</small>
              </span>
            </div>
            {data.minPrice > 0 && (
              <div class="tag-float tag-b">
                <Icon name="wallet" />
                <span>
                  {formatMoney(data.minPrice, lang)}
                  <small>{t("hero.from")}</small>
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      <section class="section tight">
        <div class="wrap">
          <Flash ctx={ctx} flag={data.flash} />
          <div class="trust">
            {trust.map((x) => (
              <div class="trust-item">
                <span class="trust-ico">
                  <Icon name={x.icon} />
                </span>
                <div>
                  <h2>{x.title}</h2>
                  <p>{x.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section class="section" id="classes">
        <div class="wrap">
          <SectionHead eyebrow={t("hero.count", { n: num(ctx, data.classCount) })} title={t("sec.classes")} sub={t("sec.classes.sub")} />
          <div class="grid">
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

      {data.beginners.length > 0 && (
        <section class="section band" id="beginners">
          <div class="wrap">
            <SectionHead eyebrow={t("label.beginner")} title={t("sec.beginners")} sub={t("sec.beginners.sub")} />
            <div class="grid">
              {data.beginners.map((c) => (
                <CourseCard course={c} ctx={ctx} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section class="section">
        <div class="wrap">
          <SectionHead title={t("sec.categories")} />
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
              <a class="tile tile-shop" href={shop.href} target="_blank" rel="noopener noreferrer" data-shop>
                <span class="tile-ico">
                  <Icon name="shop" />
                </span>
                <span>
                  <b>
                    {shop.label} <Icon name="external" />
                    <span class="vh"> ({t("shop.opens")})</span>
                  </b>
                  <small>{t("shop.tile.sub", { host: shop.host })}</small>
                </span>
              </a>
            )}
          </div>
        </div>
      </section>

      <section class="section band">
        <div class="wrap">
          <SectionHead title={t("sec.how")} center />
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
            <SectionHead title={t("sec.instructors")} />
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
            <SectionHead title={t("sec.reviews")} />
            <div class="reviews">
              {data.reviews.map((r) => (
                <figure class="review">
                  <Stars value={r.rating} />
                  <p>{r.body}</p>
                  <footer>
                    {r.author} · <a href={ctx.href(`/courses/${r.course_slug}`)}>{loc({ title_bn: r.course_title_bn, title_en: r.course_title_en }, "title", lang)}</a>
                  </footer>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {data.posts.length > 0 && (
        <section class="section">
          <div class="wrap">
            <SectionHead title={t("sec.blog")} />
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
