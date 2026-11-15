import type { CourseCardDTO } from "@mawah/shared";
import type { PageCtx } from "../ctx";
import { gaListAttr } from "../ga";
import { Layout } from "../layout";
import { breadcrumbLd } from "../seo";
import { CourseCard, Crumbs, Icon, SectionHead } from "../ui";

export interface FreeData {
  /** the website's classes that cost nothing (price 0): enrolled in one click, every lesson and the certificate included */
  free: CourseCardDTO[];
  /** the paid classes with a demo anyone can watch on the class page, before enrolling */
  demos: CourseCardDTO[];
}

/**
 * "Free classes" (the header's button beside the night / day switch, and the menu): every free class of the website in one place — first the
 * classes that are free from start to finish, then the free demo of each paid class. Only the website's own classes: the Android app's free
 * classes are listed in the app (services/catalog.ts ON_WEBSITE).
 */
export function FreeClassesPage({ ctx, data }: { ctx: PageCtx; data: FreeData }) {
  const { t } = ctx;
  return (
    <Layout
      ctx={ctx}
      list
      title={t("meta.free.title")}
      description={t("meta.free.desc")}
      jsonLd={[breadcrumbLd(ctx, [{ name: t("nav.home"), path: ctx.href("/") }, { name: t("nav.free"), path: ctx.href("/free-classes") }])]}
    >
      <section class="page-hero">
        <div class="wrap">
          <Crumbs items={[{ label: t("nav.home"), href: ctx.href("/") }, { label: t("nav.free") }]} />
          <h1>{t("free.title")}</h1>
          <p>{t("free.sub")}</p>
        </div>
      </section>

      <section class="section tight" id="free" aria-labelledby="free-h">
        <div class="wrap">
          <SectionHead eyebrow={t("label.free")} title={t("free.classes.title")} sub={t("free.classes.sub")} id="free-h" />
          {data.free.length === 0 ? (
            <div class="empty">
              <Icon name="gift" />
              <p>{t("free.classes.empty")}</p>
            </div>
          ) : (
            <div class="grid" {...gaListAttr(ctx, "free_classes")}>
              {data.free.map((c, i) => (
                <CourseCard course={c} ctx={ctx} eager={i < 3} />
              ))}
            </div>
          )}
        </div>
      </section>

      {data.demos.length > 0 && (
        <section class="section band" id="demos" aria-labelledby="demos-h">
          <div class="wrap">
            <SectionHead eyebrow={t("course.demo.free")} title={t("free.demos.title")} sub={t("free.demos.sub")} id="demos-h" />
            <div class="grid" {...gaListAttr(ctx, "free_demos")}>
              {data.demos.map((c) => (
                <CourseCard course={c} ctx={ctx} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section class="section tight">
        <div class="wrap">
          <div class="free-after">
            <p>
              <Icon name="book" />
              {t("free.after")}
            </p>
            <a class="btn btn-outline" href={ctx.href("/courses")}>
              {t("free.all")}
            </a>
          </div>
        </div>
      </section>
    </Layout>
  );
}
