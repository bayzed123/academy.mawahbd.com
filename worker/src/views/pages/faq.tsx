import type { FaqTopic } from "@mawah/shared";
import type { FaqDTO } from "../../services/faqs";
import { groupByTopic } from "../../services/faqs";
import type { PageCtx } from "../ctx";
import { FaqCta, FaqItems } from "../faq";
import { Layout } from "../layout";
import { breadcrumbLd, faqLd } from "../seo";
import { Crumbs } from "../ui";

/** /faq — every active site-wide question, grouped by topic, with the way to reach a person at the end. */
export function FaqPage({ ctx, items }: { ctx: PageCtx; items: FaqDTO[] }) {
  const { t } = ctx;
  const groups = groupByTopic(items);
  const label = (topic: FaqTopic) => t(`faq.topic.${topic}` as "faq.topic.general");
  return (
    <Layout
      ctx={ctx}
      title={t("meta.faq.title")}
      description={t("meta.faq.desc")}
      jsonLd={[
        breadcrumbLd(ctx, [
          { name: t("nav.home"), path: ctx.href("/") },
          { name: t("nav.faq"), path: ctx.href("/faq") },
        ]),
        // the structured data lists exactly the questions the page shows — never more
        ...(items.length > 0 ? [faqLd(ctx, items)] : []),
      ]}
    >
      <section class="page-hero">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: t("nav.faq") }]} />
          <h1>{t("faq.title")}</h1>
          <p>{t("faq.sub")}</p>
        </div>
      </section>
      <section class="section tight">
        <div class="wrap faq-page">
          {groups.length > 1 && (
            <nav class="faq-topics" aria-label={t("faq.topics")}>
              {groups.map((g) => (
                <a class="chip" href={`#topic-${g.topic}`}>
                  {label(g.topic)}
                </a>
              ))}
            </nav>
          )}
          {groups.map((g) => (
            <section class="faq-group" id={`topic-${g.topic}`} aria-labelledby={`topic-h-${g.topic}`}>
              <h2 id={`topic-h-${g.topic}`}>{label(g.topic)}</h2>
              <FaqItems ctx={ctx} items={g.items} />
            </section>
          ))}
          {items.length === 0 && <p class="muted">{t("faq.empty")}</p>}
          <FaqCta ctx={ctx} />
        </div>
      </section>
    </Layout>
  );
}
