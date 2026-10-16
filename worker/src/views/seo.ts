import { loc } from "@mawah/shared";
import type { CourseDetail, InstructorDTO, PublicReview } from "../services/catalog";
import type { FaqDTO } from "../services/faqs";
import { markdownToText, stripMarkdown } from "../lib/markdown";
import type { PageCtx } from "./ctx";

/* Structured data (JSON-LD). Google documents `Course` markup including offers and ratings — we only ever emit
 * aggregateRating when real approved reviews exist, and never invent counts. */

export const organizationLd = (ctx: PageCtx) => ({
  "@context": "https://schema.org",
  "@type": "EducationalOrganization",
  name: "MAWAH Academy",
  alternateName: "মাওয়াহ একাডেমি",
  url: ctx.abs("/"),
  logo: ctx.abs("/icon-512.png"),
  sameAs: [ctx.settings.contact.facebook, ctx.settings.contact.youtube, ctx.settings.contact.instagram].filter((u) => /^https?:\/\//.test(u)),
});

export const websiteLd = (ctx: PageCtx) => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "MAWAH Academy",
  url: ctx.abs("/"),
  inLanguage: ["bn-BD", "en"],
  potentialAction: {
    "@type": "SearchAction",
    target: `${ctx.abs(ctx.href("/courses"))}?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
});

export const breadcrumbLd = (ctx: PageCtx, items: { name: string; path: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: ctx.abs(it.path) })),
});

/** FAQPage: the questions a page shows, and only those. Answers are the plain text of what the visitor reads. */
export const faqLd = (ctx: PageCtx, items: FaqDTO[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((f) => ({
    "@type": "Question",
    name: loc(f, "question", ctx.lang),
    acceptedAnswer: { "@type": "Answer", text: markdownToText(loc(f, "answer", ctx.lang)) },
  })),
});

export function courseLd(ctx: PageCtx, course: CourseDetail, reviews: PublicReview[], pictures: { image_key: string }[] = []) {
  const lang = ctx.lang;
  const description = stripMarkdown(loc(course, "short", lang) || loc(course, "long", lang), 300);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: loc(course, "title", lang),
    description: description || loc(course, "title", lang),
    url: ctx.abs(ctx.href(`/courses/${course.slug}`)),
    inLanguage: lang === "bn" ? "bn-BD" : "en",
    provider: { "@type": "EducationalOrganization", name: "MAWAH Academy", sameAs: ctx.abs("/") },
    courseMode: "online",
  };
  // the main picture first, then the others the owner added (Admin → a class → Pictures)
  const images = [course.banner_key, ...pictures.map((p) => p.image_key)].filter((k): k is string => !!k).map((k) => ctx.abs(`/media/${k}`));
  if (images.length === 1) data.image = images[0];
  else if (images.length > 1) data.image = images;
  if (course.category) data.about = loc(course.category, "name", lang);
  if (course.instructor) {
    data.instructor = { "@type": "Person", name: loc(course.instructor, "name", lang), url: ctx.abs(ctx.href(`/instructors/${course.instructor.slug}`)) };
  }
  if (course.status === "published") {
    data.offers = {
      "@type": "Offer",
      category: "Paid",
      price: course.price,
      priceCurrency: "BDT",
      availability: "https://schema.org/InStock",
      url: ctx.abs(ctx.href(`/courses/${course.slug}`)),
    };
    data.hasCourseInstance = { "@type": "CourseInstance", courseMode: "online", courseWorkload: course.duration_sec ? `PT${Math.max(1, Math.round(course.duration_sec / 60))}M` : undefined };
  }
  if (course.rating_count > 0) {
    data.aggregateRating = { "@type": "AggregateRating", ratingValue: course.rating_avg, ratingCount: course.rating_count, bestRating: 5, worstRating: 1 };
    data.review = reviews.slice(0, 5).map((r) => ({
      "@type": "Review",
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
      author: { "@type": "Person", name: r.author },
      reviewBody: r.body,
      datePublished: r.created_at.slice(0, 10),
    }));
  }
  return data;
}

export const personLd = (ctx: PageCtx, i: InstructorDTO) => ({
  "@context": "https://schema.org",
  "@type": "Person",
  name: loc(i, "name", ctx.lang),
  jobTitle: loc(i, "headline", ctx.lang),
  description: stripMarkdown(loc(i, "bio", ctx.lang), 300),
  url: ctx.abs(ctx.href(`/instructors/${i.slug}`)),
  worksFor: { "@type": "EducationalOrganization", name: "MAWAH Academy" },
  sameAs: i.links.map((l) => l.url),
});

export const articleLd = (
  ctx: PageCtx,
  p: { title: string; description: string; slug: string; published_at: string | null; updated_at: string; image?: string },
) => ({
  "@context": "https://schema.org",
  "@type": "Article",
  headline: p.title,
  description: p.description,
  datePublished: p.published_at ?? p.updated_at,
  dateModified: p.updated_at,
  mainEntityOfPage: ctx.abs(ctx.href(`/blog/${p.slug}`)),
  inLanguage: ctx.lang === "bn" ? "bn-BD" : "en",
  author: { "@type": "Organization", name: "MAWAH Academy" },
  publisher: { "@type": "Organization", name: "MAWAH Academy", logo: { "@type": "ImageObject", url: ctx.abs("/icon-512.png") } },
  ...(p.image ? { image: ctx.abs(p.image) } : {}),
});
