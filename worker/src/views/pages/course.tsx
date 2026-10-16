import { raw } from "hono/html";
import { formatDate, formatDuration, formatNumber, loc, MATERIAL_KINDS, type CourseCardDTO, type CurriculumModuleDTO, type MaterialKind } from "@mawah/shared";
import { renderMarkdown } from "../../lib/markdown";
import type { CourseDetail, PublicReview, ReviewSummary } from "../../services/catalog";
import type { FaqDTO } from "../../services/faqs";
import type { GalleryImageDTO } from "../../services/gallery";
import type { Included } from "../../services/materials";
import type { PageCtx } from "../ctx";
import { ClassFaq } from "../faq";
import { gaItem, gaListAttr } from "../ga";
import { Layout } from "../layout";
import { breadcrumbLd, courseLd, faqLd, personLd } from "../seo";
import { avgLabel, CourseCard, Crumbs, Flash, Icon, InstructorBadges, NotifyForm, numLabel, priceLabel, reviewsLabel, Stars } from "../ui";

export interface CourseData {
  course: CourseDetail;
  curriculum: CurriculumModuleDTO[];
  reviews: PublicReview[];
  summary: ReviewSummary;
  /** the class's own questions, then the home-page ones (Admin → FAQ) */
  faqs: FaqDTO[];
  /** what the class gives beyond lessons (Admin → Materials): counts and titles of what is switched on — never an address or a file */
  included: Included;
  /** the pictures the owner added besides the main one (Admin → a class → Pictures), in the order they set */
  pictures: GalleryImageDTO[];
  flash?: string;
}

const materialIcon: Record<MaterialKind, string> = { video: "video", pdf: "file", zip: "layers", book: "book", live: "play", link: "link", group: "users" };

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
  const reviewHref = `/app/review/${encodeURIComponent(course.slug)}`;
  const preview = data.curriculum.flatMap((m) => m.lessons).find((l) => l.is_preview);
  const inc = data.included;
  // one line per kind the owner really added ("2 PDFs to download", "A private community group" …) — nothing if they added none
  const materialLines = MATERIAL_KINDS.filter((k) => (inc.counts[k] ?? 0) > 0).map((k) => t(`course.inc.m.${k}${inc.counts[k] === 1 ? "" : ".n"}` as "course.inc.m.pdf", { n: num(inc.counts[k] ?? 0) }));
  const hasFiles = (["video", "pdf", "zip", "book"] as const).some((k) => (inc.counts[k] ?? 0) > 0);
  // the viewer walks the main picture first (when there is one), then the others
  const pics = data.pictures;
  const mainCount = course.banner_key ? 1 : 0;
  const picTotal = pics.length + mainCount;
  const includes = [t("course.inc.lessons"), t("course.inc.progress"), t("course.inc.ask"), ...materialLines, ...(course.cert_enabled ? [t("course.inc.cert")] : [])];

  return (
    <Layout
      ctx={ctx}
      title={seoTitle}
      description={seoDesc}
      ogType="website"
      image={course.banner_key ? ctx.abs(`/media/${course.banner_key}`) : undefined}
      hasBuybar
      ga={{ item: gaItem(course) }}
      gallery={pics.length > 0}
      jsonLd={[
        courseLd(ctx, course, data.reviews, pics),
        breadcrumbLd(ctx, [
          { name: t("nav.home"), path: ctx.href("/") },
          { name: t("nav.classes"), path: ctx.href("/courses") },
          { name: title, path: ctx.href(`/courses/${course.slug}`) },
        ]),
        ...(course.instructor ? [personLd(ctx, course.instructor)] : []),
        ...(data.faqs.length > 0 ? [faqLd(ctx, data.faqs)] : []),
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
            <li class="fact-rating">
              <a href="#reviews">
                <Stars value={course.rating_count > 0 ? course.rating_avg : 0} />
                {course.rating_count > 0 ? (
                  <>
                    <b>{avgLabel(ctx, course.rating_avg)}</b> ({num(course.rating_count)})
                  </>
                ) : (
                  t("course.rating.first")
                )}
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div class="wrap detail">
        <div class={`detail-main a-${cat?.accent ?? "snack"}`}>
          <Flash ctx={ctx} flag={data.flash} />
          <div class="detail-media">
            <div class="detail-banner">
              <div class="banner banner-art">
                {course.banner_key ? (
                  pics.length > 0 ? (
                    <a class="gal-main" href={`/media/${course.banner_key}`} data-gallery-item data-alt={title} data-caption="" aria-label={t("course.gallery.see", { n: num(picTotal) })}>
                      <img src={`/media/${course.banner_key}`} alt="" width="1200" height="750" loading="eager" fetchpriority="high" decoding="async" />
                    </a>
                  ) : (
                    <img src={`/media/${course.banner_key}`} alt={title} width="1200" height="750" loading="eager" fetchpriority="high" decoding="async" />
                  )
                ) : (
                  <>
                    <span class="frame" />
                    <Icon name={course.icon ?? cat?.icon ?? "cake"} />
                  </>
                )}
              </div>
            </div>
            {pics.length > 0 && (
              <section class="gal" aria-labelledby="gal-h">
                <h2 id="gal-h" class="vh">
                  {t("course.gallery.title")}
                </h2>
                <ul class="gal-grid">
                  {pics.map((p, i) => {
                    const cap = loc(p, "caption", lang);
                    const alt = cap || t("course.gallery.alt", { title, n: num(i + 1 + mainCount), total: num(picTotal) });
                    return (
                      <li>
                        <a href={`/media/${p.image_key}`} data-gallery-item data-alt={alt} data-caption={cap}>
                          <img src={`/media/${p.thumb_key ?? p.image_key}`} alt={alt} width="480" height="360" loading="lazy" decoding="async" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
                <dialog class="lb" data-lightbox data-count={t("gallery.count", { n: "%n", total: "%t" })} aria-label={t("course.gallery.title")}>
                  <div class="lb-top">
                    <span class="lb-count" data-lb-count aria-live="polite" />
                    <button type="button" class="lb-x" data-lb-close aria-label={t("gallery.close")}>
                      <Icon name="x" />
                    </button>
                  </div>
                  <button type="button" class="lb-nav lb-prev" data-lb-prev aria-label={t("gallery.prev")}>
                    <Icon name="chevron" />
                  </button>
                  <figure class="lb-fig" data-lb-fig>
                    <img data-lb-img alt="" />
                    <figcaption data-lb-cap />
                  </figure>
                  <button type="button" class="lb-nav lb-next" data-lb-next aria-label={t("gallery.next")}>
                    <Icon name="chevron" />
                  </button>
                </dialog>
              </section>
            )}
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
            {inc.titles.length > 0 && (
              <>
                <h3 class="inc-sub">{t("course.inc.list")}</h3>
                <ul class="inc-list">
                  {inc.titles.map((m) => (
                    <li>
                      <Icon name={materialIcon[m.kind]} />
                      {loc(m, "title", lang)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {hasFiles && <p class="muted inc-note">{t("course.inc.personal")}</p>}
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
                          <a class="tag-preview" href={`/app/preview/${l.id}?c=${encodeURIComponent(course.slug)}`}>
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
                  <InstructorBadges ctx={ctx} rating={course.instructor.rating} />
                </div>
              </div>
            </section>
          )}

          <section id="reviews" class="rev-sec" aria-labelledby="rev-h">
            <div class="rev-head">
              <h2 id="rev-h">{t("course.reviews")}</h2>
              {data.summary.count > 0 && (
                <a class="btn btn-outline btn-sm" href={reviewHref}>
                  <Icon name="star" />
                  {t("reviews.write")}
                </a>
              )}
            </div>
            {data.summary.count === 0 ? (
              <div class="rev-empty">
                <Stars value={0} />
                <h3>{t("reviews.empty.title")}</h3>
                <p>{t("reviews.empty.body")}</p>
                <a class="btn btn-primary" href={reviewHref}>
                  <Icon name="star" />
                  {t("reviews.write.first")}
                </a>
                <p class="small muted">{t("reviews.rule")}</p>
              </div>
            ) : (
              <>
                <div class="rev-sum">
                  <div class="rev-score">
                    <b class="rev-avg">{avgLabel(ctx, data.summary.avg)}</b>
                    <Stars value={data.summary.avg} />
                    <span class="muted">{data.summary.count === 1 ? t("reviews.based.one") : t("reviews.based", { n: numLabel(ctx, data.summary.count) })}</span>
                  </div>
                  <ul class="rev-bars" aria-label={t("reviews.breakdown")}>
                    {[5, 4, 3, 2, 1].map((star) => {
                      const n = data.summary.dist[star - 1] ?? 0;
                      return (
                        <li>
                          <span>{t("reviews.stars", { n: numLabel(ctx, star) })}</span>
                          <svg class="rev-bar" aria-hidden="true" focusable="false">
                            <rect class="rev-bar-bg" width="100%" height="100%" />
                            <rect class="rev-bar-fg" width={`${Math.round((n / data.summary.count) * 100)}%`} height="100%" />
                          </svg>
                          <span class="num">{numLabel(ctx, n)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <ReviewList ctx={ctx} reviews={data.reviews} />
                <p class="small muted rev-rule">
                  <Icon name="shield" />
                  {t("reviews.rule")}
                </p>
              </>
            )}
          </section>

          {data.faqs.length > 0 && <ClassFaq ctx={ctx} items={data.faqs} />}
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
              <a class="btn btn-primary btn-lg btn-block" href={checkout}>
                {t("btn.enrollNow")}
                <Icon name="arrow" />
              </a>
              {preview && (
                <a class="btn btn-outline btn-block" href={`/app/preview/${preview.id}?c=${encodeURIComponent(course.slug)}`}>
                  <Icon name="play" />
                  {t("course.preview_cta")}
                </a>
              )}
              <ul>
                <li>
                  <Icon name="user" />
                  {t("course.no_login")}
                </li>
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
            <span>{t("label.loading")}</span>
          </div>
        </div>
      </section>

      <div class="buybar">
        {soon ? (
          <>
            <span class="badge-soon">{t("btn.comingSoon")}</span>
            <a class="btn btn-dark btn-sm" href="#main">
              {t("btn.notifyMe")}
            </a>
          </>
        ) : (
          <>
            <b>{priceLabel(ctx, course.price)}</b>
            <a class="btn btn-primary" href={checkout}>
              {t("btn.enrollNow")}
            </a>
          </>
        )}
      </div>
    </Layout>
  );
}

/** Approved reviews only, newest first (the students' own words; the team's reply, when there is one, sits under it). */
type ListedReview = PublicReview & { course_slug?: string; course_title_bn?: string; course_title_en?: string };

/** The review cards. `withClass` adds "about <class>" under the stars (an instructor's profile mixes reviews from several classes). */
export function ReviewList({ ctx, reviews, withClass = false }: { ctx: PageCtx; reviews: ListedReview[]; withClass?: boolean }) {
  const { t, lang } = ctx;
  return (
    <div class="reviews">
      {reviews.map((r) => (
        <figure class="review">
          <Stars value={r.rating} />
          {withClass && r.course_slug && (
            <p class="rev-class">
              <a href={ctx.href(`/courses/${r.course_slug}`)}>{lang === "bn" ? r.course_title_bn || r.course_title_en : r.course_title_en || r.course_title_bn}</a>
            </p>
          )}
          {r.body && <p>{r.body}</p>}
          <footer>
            {r.author} · {t("reviews.verified")} · <time datetime={r.created_at}>{formatDate(r.created_at, lang)}</time>
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
    <div class="grid" {...gaListAttr(ctx, "related")}>
      {courses.map((c) => (
        <CourseCard course={c} ctx={ctx} />
      ))}
    </div>
  );
}
