import { raw } from "hono/html";
import { formatDate, formatMoney, loc, type CourseCardDTO, type OrderDTO } from "@mawah/shared";
import { renderMarkdown, stripMarkdown } from "../../lib/markdown";
import type { InstructorDTO, InstructorReview } from "../../services/catalog";
import type { CertRow } from "../../services/learning";
import type { PageCtx } from "../ctx";
import { Layout } from "../layout";
import { qrSvg } from "../qr";
import { ReviewList } from "./course";
import { articleLd, breadcrumbLd, personLd } from "../seo";
import { CourseCard, Crumbs, Flash, Icon, InstructorBadges, LogoImg, SectionHead } from "../ui";

/* ======================================================================================== blog */
export interface PostRow {
  slug: string;
  title_bn: string;
  title_en: string;
  excerpt_bn: string;
  excerpt_en: string;
  body_bn: string;
  body_en: string;
  cover_key: string | null;
  seo_title_bn: string;
  seo_title_en: string;
  seo_desc_bn: string;
  seo_desc_en: string;
  published_at: string | null;
  updated_at: string;
}

export function BlogListPage({ ctx, posts }: { ctx: PageCtx; posts: PostRow[] }) {
  const { t, lang } = ctx;
  return (
    <Layout ctx={ctx} title={t("meta.blog.title")} description={t("meta.blog.desc")} noindex={posts.length === 0}>
      <section class="page-hero">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: t("blog.title") }]} />
          <h1>{t("blog.title")}</h1>
          <p>{t("blog.sub")}</p>
        </div>
      </section>
      <section class="section tight">
        <div class="wrap">
          {posts.length === 0 ? (
            <div class="empty">
              <Icon name="book" />
              <p>{t("blog.empty")}</p>
            </div>
          ) : (
            <div class="grid">
              {posts.map((p) => (
                <article class="card">
                  {p.cover_key && (
                    <a class="banner" href={ctx.href(`/blog/${p.slug}`)} tabindex={-1} aria-hidden="true">
                      <img src={`/media/${p.cover_key}`} alt="" width="640" height="400" loading="lazy" decoding="async" />
                    </a>
                  )}
                  <div class="card-body">
                    <span class="muted">{formatDate(p.published_at, lang)}</span>
                    <h3 class="card-title">
                      <a href={ctx.href(`/blog/${p.slug}`)}>{loc(p, "title", lang)}</a>
                    </h3>
                    <p class="card-desc">{loc(p, "excerpt", lang) || stripMarkdown(loc(p, "body", lang), 150)}</p>
                    <a class="btn btn-outline btn-sm" href={ctx.href(`/blog/${p.slug}`)}>
                      {t("blog.read")}
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}

export function BlogPostPage({ ctx, post }: { ctx: PageCtx; post: PostRow }) {
  const { t, lang } = ctx;
  const title = loc(post, "title", lang);
  const description = loc(post, "seo_desc", lang) || loc(post, "excerpt", lang) || stripMarkdown(loc(post, "body", lang), 155);
  return (
    <Layout
      ctx={ctx}
      title={loc(post, "seo_title", lang) || `${title} — ${t("brand.name")}`}
      description={description}
      ogType="article"
      image={post.cover_key ? ctx.abs(`/media/${post.cover_key}`) : undefined}
      jsonLd={[
        articleLd(ctx, { title, description, slug: post.slug, published_at: post.published_at, updated_at: post.updated_at, image: post.cover_key ? `/media/${post.cover_key}` : undefined }),
        breadcrumbLd(ctx, [
          { name: t("nav.home"), path: ctx.href("/") },
          { name: t("blog.title"), path: ctx.href("/blog") },
          { name: title, path: ctx.href(`/blog/${post.slug}`) },
        ]),
      ]}
    >
      <section class="page-hero">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: t("blog.title"), href: ctx.href("/blog") }]} />
          <h1>{title}</h1>
          <p>{formatDate(post.published_at, lang)}</p>
        </div>
      </section>
      <article class="section tight">
        <div class="wrap">
          {post.cover_key && <img class="detail-banner" src={`/media/${post.cover_key}`} alt="" width="1200" height="630" decoding="async" />}
          <div class="prose">{raw(renderMarkdown(loc(post, "body", lang)))}</div>
          <p>
            <a class="btn btn-outline" href={ctx.href("/blog")}>
              {t("blog.back")}
            </a>
          </p>
        </div>
      </article>
    </Layout>
  );
}

/* ================================================================================== instructor */
export function InstructorPage({ ctx, instructor, courses, reviews }: { ctx: PageCtx; instructor: InstructorDTO; courses: CourseCardDTO[]; reviews: InstructorReview[] }) {
  const { t, lang } = ctx;
  const name = loc(instructor, "name", lang);
  return (
    <Layout
      ctx={ctx}
      title={`${name} — ${t("brand.name")}`}
      description={stripMarkdown(loc(instructor, "bio", lang), 155) || loc(instructor, "headline", lang)}
      jsonLd={[personLd(ctx, instructor)]}
    >
      <section class="page-hero">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: name }]} />
          <h1>{name}</h1>
          <p>{loc(instructor, "headline", lang)}</p>
          <InstructorBadges ctx={ctx} rating={instructor.rating} />
        </div>
      </section>
      <section class="section tight">
        <div class="wrap">
          <div class="person">
            <span class="avatar">{instructor.photo_key ? <img src={`/media/${instructor.photo_key}`} alt="" width="72" height="72" loading="lazy" /> : [...name][0]}</span>
            <div class="prose">
              <h2>{t("instructor.about")}</h2>
              {raw(renderMarkdown(loc(instructor, "bio", lang)))}
              {instructor.credentials && <p class="muted">{instructor.credentials}</p>}
              {instructor.links.length > 0 && (
                <p>
                  {instructor.links.map((l) => (
                    <a class="btn btn-outline btn-sm" href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                      {l.label}
                    </a>
                  ))}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
      <section class="section tight" id="reviews">
        <div class="wrap">
          <SectionHead title={t("instructor.reviews_title", { name })} />
          {reviews.length > 0 ? <ReviewList ctx={ctx} reviews={reviews} withClass /> : <p class="muted">{t("instructor.reviews_none")}</p>}
        </div>
      </section>
      <section class="section band">
        <div class="wrap">
          <SectionHead title={t("instructor.classes_by", { name })} />
          <div class="grid">
            {courses.map((c) => (
              <CourseCard course={c} ctx={ctx} />
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}

/* ============================================================================ about / contact / policy */
export function AboutPage({ ctx }: { ctx: PageCtx }) {
  const { t, lang } = ctx;
  const about = lang === "bn" ? ctx.settings.about.bn || ctx.settings.about.en : ctx.settings.about.en || ctx.settings.about.bn;
  return (
    <Layout ctx={ctx} title={t("meta.about.title")} description={t("meta.about.desc")}>
      <section class="page-hero">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: t("nav.about") }]} />
          <h1>{t("about.title")}</h1>
          <p>{t("brand.tagline")}</p>
        </div>
      </section>
      <section class="section tight">
        <div class="wrap">
          <div class="prose">{raw(renderMarkdown(about))}</div>
          <h2 class="mt">{t("about.expect")}</h2>
          <ul class="checks">
            {(["about.e1", "about.e2", "about.e3", "about.e4"] as const).map((k) => (
              <li>
                <Icon name="check" />
                {t(k)}
              </li>
            ))}
          </ul>
          <p class="cta-row">
            <a class="btn btn-primary btn-lg" href={ctx.href("/courses")}>
              {t("hero.cta1")}
              <Icon name="arrow" />
            </a>
          </p>
        </div>
      </section>
    </Layout>
  );
}

export function ContactPage({ ctx, flash }: { ctx: PageCtx; flash?: string }) {
  const { t, lang } = ctx;
  const c = ctx.settings.contact;
  const wa = c.whatsapp.replace(/\D/g, "");
  const channels = [
    wa && { icon: "whatsapp", label: t("contact.whatsapp"), href: `https://wa.me/${wa}?text=${encodeURIComponent(t("wa.prefill"))}` },
    /^https?:\/\//.test(c.facebook) && { icon: "facebook", label: t("contact.facebook"), href: c.facebook },
    c.phone && { icon: "phone", label: c.phone, href: `tel:${c.phone.replace(/[^\d+]/g, "")}` },
    c.email && { icon: "mail", label: c.email, href: `mailto:${c.email}` },
  ].filter(Boolean) as { icon: string; label: string; href: string }[];
  return (
    <Layout ctx={ctx} title={t("meta.contact.title")} description={t("meta.contact.desc")}>
      <section class="page-hero">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: t("nav.contact") }]} />
          <h1>{t("contact.title")}</h1>
          <p>{t("contact.sub")}</p>
        </div>
      </section>
      <section class="section tight">
        <div class="wrap detail">
          <div>
            <Flash ctx={ctx} flag={flash} />
            <form method="post" action="/api/contact" data-ajax data-ok={t("contact.ok")} data-err={t("contact.fail")} data-limit={t("err.rate_limited")}>
              <input type="hidden" name="lang" value={lang} />
              <div class="field">
                <label for="c-name">{t("contact.name")}</label>
                <input class="input" id="c-name" name="name" required minlength={2} maxlength={80} autocomplete="name" />
              </div>
              <div class="field">
                <label for="c-email">{t("contact.email")}</label>
                <input class="input" id="c-email" type="email" name="email" required autocomplete="email" />
              </div>
              <div class="field">
                <label for="c-phone">{t("contact.phone")}</label>
                <input class="input" id="c-phone" type="tel" name="phone" inputmode="tel" autocomplete="tel" />
              </div>
              <div class="field">
                <label for="c-msg">{t("contact.message")}</label>
                <textarea class="input" id="c-msg" name="message" required minlength={5} maxlength={2000} />
              </div>
              <div data-turnstile />
              <button class="btn btn-primary btn-lg" type="submit">
                {t("contact.send")}
              </button>
              <p class="status-line" data-status role="status" />
            </form>
          </div>
          {channels.length > 0 && (
            <aside class="buy">
              <h2>{t("contact.channels")}</h2>
              <ul>
                {channels.map((ch) => (
                  <li>
                    <Icon name={ch.icon} />
                    <a href={ch.href} rel="noopener noreferrer" target={ch.href.startsWith("http") ? "_blank" : undefined}>
                      {ch.label}
                    </a>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      </section>
    </Layout>
  );
}

export function PolicyPage({ ctx, kind }: { ctx: PageCtx; kind: "refund" | "privacy" | "terms" }) {
  const { t, lang } = ctx;
  const p = ctx.settings.policies;
  const body = lang === "bn" ? p[`${kind}_bn` as const] || p[`${kind}_en` as const] : p[`${kind}_en` as const] || p[`${kind}_bn` as const];
  const title = t(`policy.${kind}` as never);
  return (
    <Layout ctx={ctx} title={`${title} — ${t("brand.name")}`} description={stripMarkdown(body, 155)}>
      <section class="page-hero">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: title }]} />
          <h1>{title}</h1>
        </div>
      </section>
      <section class="section tight">
        <div class="wrap">
          <div class="prose">{raw(renderMarkdown(body))}</div>
        </div>
      </section>
    </Layout>
  );
}

/* =============================================================================== certificate verify */
export function VerifyPage({ ctx, code, cert }: { ctx: PageCtx; code?: string; cert: CertRow | null | undefined }) {
  const { t, lang } = ctx;
  const searched = code !== undefined && code !== "";
  return (
    <Layout ctx={ctx} title={t("meta.verify.title")} description={t("meta.verify.desc")} noindex>
      <section class="page-hero">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: t("nav.verify") }]} />
          <h1>{t("verify.title")}</h1>
          <p>{t("verify.sub")}</p>
        </div>
      </section>
      <section class="section">
        <div class="wrap">
          <div class="verify-card">
            <form method="get" action={ctx.href("/verify")} class="form-inline">
              <label class="vh" for="vcode">
                {t("verify.input")}
              </label>
              <input class="input" id="vcode" name="code" value={code ?? ""} placeholder="MWH-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck={false} required />
              <button class="btn btn-primary" type="submit">
                {t("verify.btn")}
              </button>
            </form>
            {searched && (
              <div class="mt">
                {cert && !cert.revoked_at ? (
                  <>
                    <div class="verdict ok" role="status">
                      <Icon name="shield" />
                      {t("verify.valid")}
                    </div>
                    <dl class="kv">
                      <dt>{t("verify.awarded_to")}</dt>
                      <dd>{cert.student_name}</dd>
                    </dl>
                    <dl class="kv">
                      <dt>{t("verify.course")}</dt>
                      <dd>{loc({ title_bn: cert.course_title_bn, title_en: cert.course_title_en }, "title", lang)}</dd>
                    </dl>
                    <dl class="kv">
                      <dt>{t("verify.issued")}</dt>
                      <dd>{formatDate(cert.issued_at, lang)}</dd>
                    </dl>
                    <dl class="kv">
                      <dt>{t("verify.code")}</dt>
                      <dd class="cert-code">{cert.code}</dd>
                    </dl>
                    <a class="btn btn-outline" href={ctx.href(`/certificate/${cert.code}`)}>
                      <Icon name="award" />
                      {t("verify.view")}
                    </a>
                  </>
                ) : cert ? (
                  <div class="verdict bad" role="status">
                    <Icon name="x" />
                    {t("verify.revoked")}
                  </div>
                ) : (
                  <>
                    <div class="verdict bad" role="status">
                      <Icon name="x" />
                      {t("verify.invalid")}
                    </div>
                    <p class="muted">{t("verify.invalid_hint")}</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </Layout>
  );
}

/* ================================================================================ certificate (print) */
export function CertificatePage({ ctx, cert }: { ctx: PageCtx; cert: CertRow }) {
  const { t, lang } = ctx;
  const verifyUrl = ctx.abs(`/verify/${cert.code}`);
  const course = loc({ title_bn: cert.course_title_bn, title_en: cert.course_title_en }, "title", lang);
  return (
    <Layout
      ctx={ctx}
      chrome={false}
      title={`${t("cert.heading")} — ${cert.student_name}`}
      description={`${cert.student_name} · ${course}`}
      noindex
      bodyClass="doc"
    >
      <div class="doc-bar">
        <button class="btn btn-primary" type="button" data-print>
          <Icon name="download" />
          {t("btn.print")}
        </button>
        <a class="btn btn-outline" href={ctx.href(`/verify/${cert.code}`)}>
          {t("nav.verify")}
        </a>
        <a class="btn btn-outline" href={ctx.altHref}>
          {t("lang.switch")}
        </a>
      </div>
      <div class="cert">
        <div class="cert-border" />
        <div class="cert-in">
          <LogoImg class="cert-logo" ctx={ctx} />
          <div class="cert-brand">{t("brand.academy")}</div>
          <h1>{t("cert.heading")}</h1>
          <p class="small">{t("cert.presented")}</p>
          <div class="cert-name">{cert.student_name}</div>
          <p class="small">{t("cert.for")}</p>
          <div class="cert-course">{course}</div>
          <div class="cert-foot">
            <div>
              <span>{t("cert.issued")}</span>
              <b>{formatDate(cert.issued_at, lang)}</b>
              <span>{t("verify.code")}</span>
              <b class="cert-code">{cert.code}</b>
            </div>
            <div>{raw(qrSvg(verifyUrl, { cls: "cert-qr", label: t("cert.scan") }))}</div>
          </div>
          <p class="small">{t("cert.scan")} · {ctx.abs("/verify")}</p>
        </div>
      </div>
    </Layout>
  );
}

/* ===================================================================================== invoice (print) */
export function InvoicePage({ ctx, order, customer }: { ctx: PageCtx; order: OrderDTO; customer: { name: string; email: string; phone: string; address?: string } }) {
  const { t, lang } = ctx;
  const c = ctx.settings.contact;
  const title = `${lang === "bn" ? "ইনভয়েস" : "Invoice"} ${order.invoice_no ?? ""}`;
  return (
    <Layout ctx={ctx} chrome={false} title={title} description={title} noindex bodyClass="doc">
      <div class="doc-bar">
        <button class="btn btn-primary" type="button" data-print>
          <Icon name="download" />
          {t("btn.print")}
        </button>
      </div>
      <article class="invoice">
        <header class="inv-head">
          <div>
            <LogoImg class="inv-logo" ctx={ctx} />
            <h1 class="mt">{lang === "bn" ? "ইনভয়েস" : "Invoice"}</h1>
            <p class="muted">{order.invoice_no ?? (lang === "bn" ? "পেমেন্টের অপেক্ষায়" : "Awaiting payment")}</p>
          </div>
          <div>
            <b>{t("brand.name")}</b>
            <br />
            {c.email && <>{c.email}<br /></>}
            {c.phone && <>{c.phone}<br /></>}
            {ctx.abs("/")}
          </div>
        </header>
        <div class="inv-meta">
          <div>
            <small class="muted">{lang === "bn" ? "প্রাপক" : "Billed to"}</small>
            <br />
            <b>{customer.name}</b>
            {customer.address && <><br />{customer.address}</>}
            {customer.email && <><br />{customer.email}</>}
            {customer.phone && <><br />{customer.phone}</>}
          </div>
          <div>
            <small class="muted">{t("label.date")}</small>
            <br />
            <b>{formatDate(order.paid_at ?? order.created_at, lang)}</b>
            <br />
            <small class="muted">{lang === "bn" ? "পেমেন্ট" : "Payment"}</small>
            <br />
            <b>{order.method ? t(`method.${order.method}` as never) : "—"}</b>
            {order.gateway_txn && <><br /><small class="cert-code">{order.gateway_txn}</small></>}
          </div>
          <div>{order.status === "paid" && <span class="paid-stamp">{lang === "bn" ? "পরিশোধিত" : "PAID"}</span>}</div>
        </div>
        <table class="inv-table">
          <thead>
            <tr>
              <th>{lang === "bn" ? "ক্লাস" : "Class"}</th>
              <th>{t("label.price")}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it) => (
              <tr>
                <td>{loc(it, "title", lang)}</td>
                <td>{formatMoney(it.list_price, lang)}</td>
              </tr>
            ))}
            {order.discount > 0 && (
              <tr>
                <td>
                  {t("label.discount")}
                  {order.coupon_code ? ` (${order.coupon_code})` : ""}
                </td>
                <td>− {formatMoney(order.discount, lang)}</td>
              </tr>
            )}
            <tr class="inv-total">
              <td>{t("label.total")}</td>
              <td>{formatMoney(order.total, lang)}</td>
            </tr>
          </tbody>
        </table>
        <p class="muted">{lang === "bn" ? "ধন্যবাদ! এটি কম্পিউটার-জেনারেটেড ইনভয়েস।" : "Thank you! This is a computer-generated invoice."}</p>
      </article>
    </Layout>
  );
}

/* ================================================================================================ errors */
export function ErrorPage({ ctx, status }: { ctx: PageCtx; status: 404 | 500 }) {
  const { t } = ctx;
  return (
    <Layout ctx={ctx} title={t(status === 404 ? "err.404.title" : "err.500.title")} description={t(status === 404 ? "err.404.body" : "err.500.body")} noindex>
      <section class="section">
        <div class="wrap">
          <div class="empty">
            <Icon name={status === 404 ? "search" : "bell"} />
            <h1>{t(status === 404 ? "err.404.title" : "err.500.title")}</h1>
            <p>{t(status === 404 ? "err.404.body" : "err.500.body")}</p>
            <a class="btn btn-primary" href={ctx.href("/")}>
              {t("err.home")}
            </a>
          </div>
        </div>
      </section>
    </Layout>
  );
}

