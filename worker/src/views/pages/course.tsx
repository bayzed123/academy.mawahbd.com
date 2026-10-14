import { raw } from "hono/html";
import { formatDuration, formatNumber, loc, type CourseCardDTO, type CurriculumModuleDTO } from "@mawah/shared";
import { renderMarkdown } from "../../lib/markdown";
import type { CourseDetail, PublicReview } from "../../services/catalog";
import type { PageCtx } from "../ctx";
import { Layout } from "../layout";
import { breadcrumbLd, courseLd, personLd } from "../seo";
import { CourseCard, Crumbs, Flash, Icon, NotifyForm, priceLabel, Stars } from "../ui";

export interface CourseData {
  course: CourseDetail;
  curriculum: CurriculumModuleDTO[];
  reviews: PublicReview[];
  flash?: string;
}

const lessonIcon = { video: "play", external: "play", text: "book", resource: "download" } as const;

export function CoursePage({ ctx, data }: { ctx: PageCtx; data: CourseData }) {
  const { t, lang } = ctx;
  const { course } = data;
  const soon = course.status === "coming_soon";
  const title = loc(course, "title", lang);
  const num = (v: number) => (lang === "bn" ? formatNumber(v, "bn") : String(v));
  const longMd = loc(course, "long", lang);
  const wa = ctx.settings.contact.whatsapp.replace(/\D/g, "");
  const seoTitle = loc(course, "seo_title", lang) || `${title} — ${t("brand.name")}`;
  const seoDesc = loc(course, "seo_desc", lang) || loc(course, "short", lang) || title;
  const cat = course.category;
  const duration = formatDuration(course.duration_sec, lang);
  const lessonTotal = data.curriculum.reduce((s, m) => s + m.lessons.length, 0);
  const checkout = `/app/checkout?c=${encodeURIComponent(course.slug)}`;
  const includes = [t("course.inc.lessons"), t("course.inc.progress"), t("course.inc.ask"), ...(course.cert_enabled ? [t("course.inc.cert")] : [])];

  return (
    <Layout
      ctx={ctx}
      title={seoTitle}
      description={seoDesc}
      ogType="website"
      image={course.banner_key ? ctx.abs(`/media/${course.banner_key}`) : undefined}
      hasBuybar
      jsonLd={[
        courseLd(ctx, course, data.reviews),
        breadcrumbLd(ctx, [
          { name: t("nav.home"), path: ctx.href("/") },
          { name: t("nav.classes"), path: ctx.href("/courses") },
          { name: title, path: ctx.href(`/courses/${course.slug}`) },
        ]),
        ...(course.instructor ? [personLd(ctx, course.instructor)] : []),
      ]}
    >
      <section class="page-hero">
        <div class="wrap">
          <Crumbs
            items={[
              { label: t("nav.home"), href: ctx.href("/") },
              { label: t("course.breadcrumb.classes"), href: ctx.href("/courses") },
              ...(cat ? [{ label: loc(cat, "name", lang), href: ctx.href(`/courses?cat=${cat.slug}`) }] : []),
            ]}
          />
          <h1>{title}</h1>
          <p>{loc(course, "short", lang)}</p>
          <ul class="facts">
            {course.level && (
              <li>
                <Icon name="layers" />
                {t(`label.${course.level}` as never)}
              </li>
            )}
            {lessonTotal > 0 && (
              <li>
                <Icon name="play" />
                {t("course.lessons", { n: num(lessonTotal) })}
              </li>
            )}
            {duration && (
              <li>
                <Icon name="clock" />
                {t("course.duration", { d: duration })}
              </li>
            )}
            {course.cert_enabled && (
              <li>
                <Icon name="award" />
                {t("course.cert")}
              </li>
            )}
            {course.rating_count > 0 && (
              <li>
                <Stars value={course.rating_avg} />
                {lang === "bn" ? formatNumber(course.rating_avg, "bn") : course.rating_avg.toFixed(1)} ({num(course.rating_count)})
              </li>
            )}
          </ul>
        </div>
      </section>

      <div class="wrap detail">
        <div class={`detail-main a-${cat?.accent ?? "snack"}`}>
          <Flash ctx={ctx} flag={data.flash} />
          <div class="detail-banner">
            <div class="banner banner-art">
              {course.banner_key ? (
                <img src={`/media/${course.banner_key}`} alt={title} width="1200" height="750" loading="eager" fetchpriority="high" decoding="async" />
              ) : (
                <>
                  <span class="frame" />
                  <Icon name={course.icon ?? cat?.icon ?? "cake"} />
                </>
              )}
            </div>
          </div>

          <section class="prose" aria-labelledby="about-h">
            <h2 id="about-h">{t("course.about")}</h2>
            {longMd ? raw(renderMarkdown(longMd)) : <p>{loc(course, "short", lang)}</p>}
            {course.details_url && (
              <p>
                <a class="btn btn-outline" href={course.details_url} target="_blank" rel="noopener noreferrer nofollow">
                  <Icon name="facebook" />
                  {t("course.details_fb")}
                </a>
              </p>
            )}
          </section>

          <section aria-labelledby="inc-h">
            <h2 id="inc-h">{t("course.includes")}</h2>
            <ul class="checks">
              {includes.map((i) => (
                <li>
                  <Icon name="check" />
                  {i}
                </li>
              ))}
            </ul>
          </section>

          <section class="curr" aria-labelledby="curr-h">
            <h2 id="curr-h">{t("course.curriculum")}</h2>
            {data.curriculum.length === 0 ? (
              <p class="muted">{t("course.curriculum.empty")}</p>
            ) : (
              data.curriculum.map((m, mi) => (
                <details open={mi === 0}>
                  <summary>
                    <span>{loc(m, "title", lang)}</span>
                    <Icon name="chevron" />
                  </summary>
                  <ul>
                    {m.lessons.map((l) => (
                      <li>
                        <Icon name={lessonIcon[l.type]} />
                        <span>{loc(l, "title", lang)}</span>
                        {l.is_preview && (
                          <a class="tag-preview" href={`/app/preview/${l.id}`}>
                            {t("course.preview")}
                          </a>
                        )}
                        {l.duration_sec > 0 && <small>{formatDuration(l.duration_sec, lang)}</small>}
                      </li>
                    ))}
                  </ul>
                </details>
              ))
            )}
          </section>

          {course.instructor && (
            <section aria-labelledby="inst-h">
              <h2 id="inst-h">{t("course.instructor")}</h2>
              <div class="person">
                <span class="avatar">
                  {course.instructor.photo_key ? <img src={`/media/${course.instructor.photo_key}`} alt="" width="72" height="72" loading="lazy" /> : [...loc(course.instructor, "name", lang)][0]}
                </span>
                <div>
                  <h3>
                    <a href={ctx.href(`/instructors/${course.instructor.slug}`)}>{loc(course.instructor, "name", lang)}</a>
                  </h3>
                  <p class="muted">{loc(course.instructor, "headline", lang)}</p>
                </div>
              </div>
            </section>
          )}

          <section aria-labelledby="rev-h">
            <h2 id="rev-h">{t("course.reviews")}</h2>
            <div class="lazy" data-fragment={`/_f/reviews/${course.slug}?lang=${lang}`} aria-busy="true">
              <noscript>
                <p class="muted">{t("reviews.none")}</p>
              </noscript>
              <span>{t("reviews.loading")}</span>
            </div>
          </section>
        </div>

        <aside class="buy" aria-label={t("label.price")}>
          {soon ? (
            <>
              <span class="badge-soon">
                <Icon name="clock" />
                {t("btn.comingSoon")}
              </span>
              <h3 class="mt">{t("course.notify_title")}</h3>
              <p class="muted">{t("course.notify_desc")}</p>
              <NotifyForm ctx={ctx} slug={course.slug} />
            </>
          ) : (
            <>
              <div class="buy-price">{priceLabel(ctx, course.price)}</div>
              <a class="btn btn-gold btn-lg btn-block" href={checkout}>
                {t("btn.enrollNow")}
                <Icon name="arrow" />
              </a>
              <ul>
                <li>
                  <Icon name="wallet" />
                  {t("course.pay_with")}
                </li>
                {course.cert_enabled && (
                  <li>
                    <Icon name="award" />
                    {t("course.cert_desc")}
                  </li>
                )}
              </ul>
            </>
          )}
          {wa && (
            <a class="btn btn-outline btn-block" href={`https://wa.me/${wa}?text=${encodeURIComponent(`${t("wa.prefill")} — ${title}`)}`} target="_blank" rel="noopener noreferrer">
              <Icon name="whatsapp" />
              {t("course.ask_wa")}
            </a>
          )}
        </aside>
      </div>

      <section class="section band">
        <div class="wrap">
          <header class="sec-head">
            <h2>{t("sec.related")}</h2>
          </header>
          <div class="lazy" data-fragment={`/_f/related/${course.slug}?lang=${lang}`} aria-busy="true">
            <span>{t("reviews.loading")}</span>
          </div>
        </div>
      </section>

      <div class="buybar">
        {soon ? (
          <>
            <span class="badge-soon">{t("btn.comingSoon")}</span>
            <a class="btn btn-emerald btn-sm" href="#main">
              {t("btn.notifyMe")}
            </a>
          </>
        ) : (
          <>
            <b>{priceLabel(ctx, course.price)}</b>
            <a class="btn btn-gold" href={checkout}>
              {t("btn.enrollNow")}
            </a>
          </>
        )}
      </div>
    </Layout>
  );
}

/** HTML fragment: approved reviews only (lazy-loaded below the fold). */
export function ReviewsFragment({ ctx, reviews }: { ctx: PageCtx; reviews: PublicReview[] }) {
  const { t, lang } = ctx;
  if (reviews.length === 0) return <p class="muted">{t("reviews.none")}</p>;
  return (
    <div class="reviews">
      {reviews.map((r) => (
        <figure class="review">
          <Stars value={r.rating} />
          {r.body && <p>{r.body}</p>}
          <footer>
            {r.author} · {t("reviews.verified")}
          </footer>
          {r.reply && (
            <div class="reply">
              <b>{t("reviews.reply")}:</b> {r.reply}
            </div>
          )}
        </figure>
      ))}
    </div>
  );
}

export function RelatedFragment({ ctx, courses }: { ctx: PageCtx; courses: CourseCardDTO[] }) {
  return (
    <div class="grid">
      {courses.map((c) => (
        <CourseCard course={c} ctx={ctx} />
      ))}
    </div>
  );
}
