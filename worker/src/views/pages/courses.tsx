import { formatNumber, loc, type CategoryDTO, type CourseCardDTO } from "@mawah/shared";
import type { CourseSort } from "../../services/catalog";
import type { PageCtx } from "../ctx";
import { gaListAttr } from "../ga";
import { Layout } from "../layout";
import { breadcrumbLd } from "../seo";
import { CourseCard, Crumbs, Icon, Pager, shopOf } from "../ui";

export interface ListData {
  courses: CourseCardDTO[];
  total: number;
  page: number;
  perPage: number;
  cat?: string;
  q?: string;
  sort: CourseSort;
  level?: "beginner";
}

export function CoursesPage({ ctx, data }: { ctx: PageCtx; data: ListData }) {
  const { t, lang } = ctx;
  const pages = Math.max(1, Math.ceil(data.total / data.perPage));
  const activeCat = ctx.categories.find((c: CategoryDTO) => c.slug === data.cat);
  const filtered = !!(data.cat || data.q || data.level);
  const hrefFor = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = { cat: data.cat, q: data.q, sort: data.sort === "featured" ? undefined : data.sort, level: data.level, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return ctx.href("/courses") + (qs ? `?${qs}` : "");
  };
  const n = (v: number) => (lang === "bn" ? formatNumber(v, "bn") : String(v));
  const title = activeCat ? `${loc(activeCat, "name", lang)} — ${t("brand.name")}` : t("meta.courses.title");
  const shop = shopOf(ctx);

  return (
    <Layout
      ctx={ctx}
      title={title}
      description={activeCat ? loc(activeCat, "blurb", lang) || t("meta.courses.desc") : t("meta.courses.desc")}
      noindex={!!data.q || data.page > 1 || data.sort !== "featured"}
      canonicalPath={hrefFor({ q: undefined, sort: undefined }).split("&page")[0]}
      jsonLd={[breadcrumbLd(ctx, [{ name: t("nav.home"), path: ctx.href("/") }, { name: t("nav.classes"), path: ctx.href("/courses") }])]}
    >
      <section class="page-hero">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: t("nav.classes") }]} />
          <h1>{activeCat ? loc(activeCat, "name", lang) : data.level ? t("sec.beginners") : t("courses.title")}</h1>
          <p>{activeCat ? loc(activeCat, "blurb", lang) : data.level ? t("sec.beginners.sub") : t("courses.sub")}</p>
        </div>
      </section>

      <section class="section tight">
        <div class="wrap">
          <form class="searchbar" method="get" action={ctx.href("/courses")} role="search">
            {data.cat && <input type="hidden" name="cat" value={data.cat} />}
            {data.level && <input type="hidden" name="level" value={data.level} />}
            <label class="vh" for="q">
              {t("courses.search_ph")}
            </label>
            <input class="input" id="q" type="search" name="q" value={data.q ?? ""} placeholder={t("courses.search_ph")} maxlength={80} />
            <label class="vh" for="sort">
              {t("courses.sort")}
            </label>
            <select class="input" id="sort" name="sort">
              {(["featured", "new", "price_asc", "price_desc"] as CourseSort[]).map((s) => (
                <option value={s} selected={data.sort === s}>
                  {t(`sort.${s}` as never)}
                </option>
              ))}
            </select>
            <button class="btn btn-dark" type="submit">
              <Icon name="search" />
              {t("btn.search")}
            </button>
          </form>

          <div class="filters">
            <nav class="pills" aria-label={t("sec.categories")}>
              <a class="pill" href={ctx.href("/courses")} aria-current={!data.cat && !data.level ? "true" : undefined}>
                {t("label.all")}
              </a>
              <a class="pill" href={hrefFor({ cat: undefined, level: "beginner", page: undefined })} aria-current={data.level ? "true" : undefined}>
                {t("label.beginner")}
              </a>
              {ctx.categories.map((c: CategoryDTO) => (
                <a class={`pill a-${c.accent}`} href={hrefFor({ cat: c.slug, level: undefined, page: undefined })} aria-current={data.cat === c.slug ? "true" : undefined}>
                  <span class="dot" />
                  {loc(c, "name", lang)}
                </a>
              ))}
              {shop && (
                <a class="pill pill-shop" href={shop.href} target="_blank" rel="noopener noreferrer" data-shop>
                  <Icon name="shop" />
                  {shop.label}
                  <Icon name="external" />
                  <span class="vh"> ({t("shop.opens")})</span>
                </a>
              )}
            </nav>
            <span class="muted">{t("courses.count", { n: n(data.total) })}</span>
          </div>

          {data.courses.length === 0 ? (
            <div class="empty">
              <Icon name="search" />
              <p>{t("courses.empty")}</p>
              {filtered && (
                <a class="btn btn-outline" href={ctx.href("/courses")}>
                  {t("courses.clear")}
                </a>
              )}
            </div>
          ) : (
            <div class="grid" {...gaListAttr(ctx, "classes")}>
              {data.courses.map((c, i) => (
                <CourseCard course={c} ctx={ctx} eager={i < 3} headingLevel={2} />
              ))}
            </div>
          )}

          <Pager ctx={ctx} page={data.page} pages={pages} hrefFor={(p) => hrefFor({ page: String(p) })} />
        </div>
      </section>
    </Layout>
  );
}
