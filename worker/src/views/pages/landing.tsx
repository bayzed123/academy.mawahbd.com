import { raw } from "hono/html";
import { formatMoney, formatNumber, loc, offPercent, waNumber, type LandingBlock } from "@mawah/shared";
import { renderMarkdown, stripMarkdown } from "../../lib/markdown";
import { landingVideo, type LandingData, type LandingRow } from "../../services/landing";
import type { PageCtx } from "../ctx";
import { Layout } from "../layout";
import { faqLd } from "../seo";
import { CourseCard, Icon } from "../ui";
import { ReviewList } from "./course";

/*
 * A landing page (Admin → Landing pages): the owner's blocks, top to bottom. Every word is the owner's, in the visitor's language (or the
 * other one when a block has words in one language only); prices, savings and reviews are only ever what the owner entered or what
 * students wrote and staff approved.
 */

/** The block's words in this language, or the other language's when this one is empty. */
const say = (ctx: PageCtx, o: object, key: string): string => {
  const r = o as Record<string, unknown>;
  const mine = String(r[`${key}_${ctx.lang}`] ?? "").trim();
  return mine || String(r[`${key}_${ctx.lang === "bn" ? "en" : "bn"}`] ?? "").trim();
};

const money = (ctx: PageCtx, n: number) => formatMoney(n, ctx.lang);

/** A page of this site opens in place; another site in a new tab, safely. */
const linkAttrs = (href: string) => (/^https:\/\//i.test(href) ? { href, target: "_blank", rel: "noopener noreferrer" } : { href });

/** The price with the usual price struck through and the saving. */
const PriceLine = ({ ctx, price, list }: { ctx: PageCtx; price: number; list: number }) => {
  const off = offPercent(price, list);
  return (
    <p class="lp-price">
      <b>{money(ctx, price)}</b>
      {off !== null && (
        <>
          <s>
            <span class="vh">{ctx.t("lp.was")} </span>
            {money(ctx, list)}
          </s>
          <span class="lp-off">{ctx.t("lp.off", { n: formatNumber(off, ctx.lang) })}</span>
        </>
      )}
    </p>
  );
};

function Block({ ctx, block, data, first }: { ctx: PageCtx; block: LandingBlock; data: LandingData; first: boolean }) {
  const { t, lang } = ctx;
  const heading = "heading_bn" in block ? say(ctx, block, "heading") : "";
  const H = first ? "h1" : "h2";
  switch (block.type) {
    case "hero": {
      const button = say(ctx, block, "button");
      const text = say(ctx, block, "text");
      return (
        <section class={`lp-hero${block.image_key ? " has-img" : ""}`}>
          {block.image_key && <img class="lp-hero-img" src={`/media/${block.image_key}`} alt="" width="1600" height="800" fetchpriority={first ? "high" : undefined} decoding="async" />}
          <div class="wrap lp-hero-body">
            {heading && <H>{heading}</H>}
            {text && <p class="lp-lead">{text}</p>}
            {button && block.link && (
              <a class="btn btn-gold btn-lg" {...linkAttrs(block.link)}>
                {button}
                <Icon name="arrow" />
              </a>
            )}
          </div>
        </section>
      );
    }
    case "text":
      return (
        <section class="section lp-text">
          <div class="wrap lp-narrow">
            {heading && <H>{heading}</H>}
            <div class="prose">{raw(renderMarkdown(say(ctx, block, "body")))}</div>
          </div>
        </section>
      );
    case "pictures":
      return (
        <section class="section lp-pictures">
          <div class="wrap">
            {heading && <H>{heading}</H>}
            <ul class="lp-pic-grid">
              {block.items.map((p) => {
                const caption = say(ctx, p, "caption");
                return (
                  <li>
                    <figure>
                      <img src={`/media/${p.image_key}`} alt={caption} width="800" height="600" loading="lazy" decoding="async" />
                      {caption && <figcaption>{caption}</figcaption>}
                    </figure>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      );
    case "video": {
      const src = landingVideo(block.url);
      if (!src) return null;
      return (
        <section class="section lp-video">
          <div class="wrap lp-narrow">
            {heading && <H>{heading}</H>}
            <div class="lp-frame">
              <iframe src={src} title={heading || t("lp.video")} loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" />
            </div>
          </div>
        </section>
      );
    }
    case "class": {
      const course = data.courses.get(block.course_id);
      // a class that is hidden, coming soon or deleted is simply left out — never a broken Buy button
      if (!course) return null;
      const button = say(ctx, block, "button") || t("btn.enrollNow");
      return (
        <section class="section lp-class">
          <div class="wrap lp-class-grid">
            <CourseCard ctx={ctx} course={course} headingLevel={first ? 2 : 3} />
            <div class="lp-buy lp-card">
              <H class="lp-buy-title">{loc(course, "title", lang)}</H>
              {loc(course, "short", lang) && <p>{loc(course, "short", lang)}</p>}
              {course.price === 0 ? <p class="lp-price"><b>{t("label.free")}</b></p> : <PriceLine ctx={ctx} price={course.price} list={block.list_price} />}
              <a class="btn btn-primary btn-lg btn-block" href={`/app/checkout?c=${encodeURIComponent(course.slug)}`}>
                {button}
                <Icon name="arrow" />
              </a>
              <a class="link" href={ctx.href(`/courses/${course.slug}`)}>
                {t("lp.details")}
              </a>
            </div>
          </div>
        </section>
      );
    }
    case "price": {
      const button = say(ctx, block, "button");
      const note = say(ctx, block, "note");
      return (
        <section class="section lp-offer">
          <div class="wrap lp-narrow">
            <div class="lp-offer-card">
              {heading && <H>{heading}</H>}
              <PriceLine ctx={ctx} price={block.price} list={block.list_price} />
              {note && <p class="muted">{note}</p>}
              {button && block.link && (
                <a class="btn btn-primary btn-lg" {...linkAttrs(block.link)}>
                  {button}
                  <Icon name="arrow" />
                </a>
              )}
            </div>
          </div>
        </section>
      );
    }
    case "faq":
      return (
        <section class="section lp-faq">
          <div class="wrap lp-narrow">
            <H>{heading || t("lp.faq")}</H>
            <div class="faq-list">
              {block.items.map((q) => (
                <details class="faq-item">
                  <summary>{say(ctx, q, "question")}</summary>
                  <div class="prose">{raw(renderMarkdown(say(ctx, q, "answer")))}</div>
                </details>
              ))}
            </div>
          </div>
        </section>
      );
    case "reviews": {
      const reviews = (data.reviews.get(block.course_id) ?? []).slice(0, block.count);
      // no approved review yet: nothing is made up to fill the space
      if (!reviews.length) return null;
      return (
        <section class="section lp-reviews">
          <div class="wrap">
            <H>{heading || t("lp.reviews")}</H>
            <ReviewList ctx={ctx} reviews={reviews} withClass={block.course_id === 0} />
          </div>
        </section>
      );
    }
    case "whatsapp": {
      const number = waNumber(ctx.settings.contact.whatsapp);
      // no WhatsApp number in Settings → Contact: there is nothing to press
      if (!number) return null;
      const message = say(ctx, block, "message");
      return (
        <section class="section lp-wa">
          <div class="wrap lp-narrow lp-wa-card">
            {heading && <H>{heading}</H>}
            <a class="btn btn-lg lp-wa-btn" href={`https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ""}`} target="_blank" rel="noopener noreferrer">
              <Icon name="whatsapp" />
              {say(ctx, block, "button")}
              <span class="vh"> ({t("shop.opens")})</span>
            </a>
          </div>
        </section>
      );
    }
  }
}

export function LandingPage({ ctx, page, blocks, data }: { ctx: PageCtx; page: LandingRow; blocks: LandingBlock[]; data: LandingData }) {
  const title = say(ctx, page, "title");
  const firstHero = blocks[0]?.type === "hero" && !!say(ctx, blocks[0], "heading");
  const firstText = blocks.find((b) => b.type === "text" || b.type === "hero");
  const description =
    say(ctx, page, "description") || (firstText ? stripMarkdown(say(ctx, firstText, firstText.type === "text" ? "body" : "text"), 155) : "") || title;
  const heroImage = blocks.find((b): b is Extract<LandingBlock, { type: "hero" }> => b.type === "hero" && !!b.image_key);
  const faqs = blocks.flatMap((b) => (b.type === "faq" ? b.items : []));
  return (
    <Layout
      ctx={ctx}
      title={`${title} — ${ctx.t("brand.name")}`}
      description={description}
      image={heroImage?.image_key ? ctx.abs(`/media/${heroImage.image_key}`) : undefined}
      jsonLd={faqs.length ? [faqLd(ctx, faqs.map((f, i) => ({ id: i, ...f })) as Parameters<typeof faqLd>[1])] : []}
      bodyClass="landing"
      landing
    >
      {!firstHero && (
        <section class="page-hero">
          <div class="wrap">
            <h1>{title}</h1>
          </div>
        </section>
      )}
      {blocks.map((b, i) => (
        <Block ctx={ctx} block={b} data={data} first={i === 0 && firstHero} />
      ))}
    </Layout>
  );
}
