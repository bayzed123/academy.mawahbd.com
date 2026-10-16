import { raw } from "hono/html";
import { loc } from "@mawah/shared";
import { renderMarkdown } from "../lib/markdown";
import type { FaqDTO } from "../services/faqs";
import { bannerHref } from "./banners";
import type { PageCtx } from "./ctx";
import { Icon } from "./ui";

/**
 * Questions and answers the owner manages in Admin → FAQ. An answer is simple Markdown from the owner, rendered by the same
 * safe renderer as class descriptions. A link to a page of this site follows the visitor's language (the owner writes
 * /courses/x once; an English visitor lands on /en/courses/x). Each question is a native <details> element: it works without
 * JavaScript, with a keyboard and with a screen reader, and costs the page no script at all.
 */
const answerHtml = (ctx: PageCtx, markdown: string) => renderMarkdown(markdown).replace(/href="(\/(?!\/)[^"]*)"/g, (_m, path: string) => `href="${bannerHref(ctx, path)}"`);

/** The question as plain text and the answer as plain text — what the structured data (and the chatbot) read. */
export const faqText = (ctx: PageCtx, f: FaqDTO) => ({ question: loc(f, "question", ctx.lang), answer: loc(f, "answer", ctx.lang) });

export function FaqItems({ ctx, items }: { ctx: PageCtx; items: FaqDTO[] }) {
  // where the questions are shown, for the visit counter (docs/analytics.md): a class page, the home page, or the FAQ page
  const scope = ctx.path.startsWith("/courses/") ? "class" : ctx.path === "/" ? "home" : "site";
  return (
    <div class="faq" {...(ctx.track.ga4 ? { "data-ga-faq": scope } : {})}>
      {items.map((f) => {
        const { question, answer } = faqText(ctx, f);
        return (
          <details class="faq-item" id={`faq-${f.id}`}>
            <summary>{question}</summary>
            <div class="faq-a">{raw(answerHtml(ctx, answer))}</div>
          </details>
        );
      })}
    </div>
  );
}

/** "Still have a question?" — the way to reach a person: WhatsApp when the owner has set a number, always the contact page. */
export function FaqCta({ ctx, dark }: { ctx: PageCtx; dark?: boolean }) {
  const { t } = ctx;
  const wa = ctx.settings.contact.whatsapp.replace(/\D/g, "");
  return (
    <div class={`faq-cta${dark ? " dark" : ""}`}>
      <span class="faq-cta-ico">
        <Icon name="chat" />
      </span>
      <div>
        <h3>{t("faq.cta.title")}</h3>
        <p>{t("faq.cta.sub")}</p>
      </div>
      <div class="faq-cta-btns">
        {wa && (
          <a class="btn btn-primary" href={`https://wa.me/${wa}?text=${encodeURIComponent(t("wa.prefill"))}`} target="_blank" rel="noopener noreferrer">
            <Icon name="whatsapp" />
            {t("contact.whatsapp")}
            <span class="vh"> ({t("shop.opens")})</span>
          </a>
        )}
        <a class="btn btn-outline" href={ctx.href("/contact")}>
          {t("nav.contact")}
        </a>
      </div>
    </div>
  );
}

/** The home page's FAQ band: the heading and the call to action on one side, the accordion on the other. */
export function HomeFaq({ ctx, items }: { ctx: PageCtx; items: FaqDTO[] }) {
  const { t } = ctx;
  return (
    <section class="section band" id="faq" aria-labelledby="faq-h">
      <div class="wrap faq-grid">
        <div class="faq-side">
          <header class="sec-head">
            <span class="eyebrow">{t("faq.eyebrow")}</span>
            <h2 id="faq-h">{t("faq.home.title")}</h2>
            <p>{t("faq.home.sub")}</p>
          </header>
          <FaqCta ctx={ctx} />
        </div>
        <div class="faq-main">
          <FaqItems ctx={ctx} items={items} />
          <p class="faq-more">
            <a class="btn btn-dark btn-lg" href={ctx.href("/faq")}>
              {t("faq.all")}
              <Icon name="arrow" />
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

/** The class page's FAQ: the class's own questions, then the basics. */
export function ClassFaq({ ctx, items }: { ctx: PageCtx; items: FaqDTO[] }) {
  const { t } = ctx;
  return (
    <section id="faq" class="faq-sec" aria-labelledby="faq-h">
      <h2 id="faq-h">{t("faq.course.title")}</h2>
      <FaqItems ctx={ctx} items={items} />
      <p class="faq-more">
        <a class="btn btn-outline btn-sm" href={ctx.href("/faq")}>
          {t("faq.all")}
          <Icon name="arrow" />
        </a>
      </p>
    </section>
  );
}
