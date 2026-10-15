import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDuration } from "@mawah/shared";
import { adm } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { CourseRow } from "../lib/types";
import { isActive, useSetActive } from "../lib/visibility";
import { CourseStateChip } from "../components/CourseState";
import { Button, Chip, ErrorState, Icon, Kpi, PageHeader, Panel, Spinner, StatusChip, Switch } from "../components/ui";

interface Overview {
  stats: {
    enrolled: number;
    ever_enrolled: number;
    revenue: number;
    paid_orders: number;
    rating_avg: number;
    rating_count: number;
    reviews_waiting: number;
    waiting: number;
    modules: number;
    lessons: number;
    previews: number;
    minutes: number;
  };
  reviews: { id: number; rating: number; body: string; status: string; created_at: string; student_name: string }[];
}

interface Tree {
  modules: { id: number; title_bn: string; title_en: string; lessons: { id: number; title_bn: string; title_en: string; type: string; is_preview: number; duration_sec: number }[] }[];
}

const excerpt = (s: string, n = 260) => {
  const plain = s.replace(/[#*_`>\[\]()!-]+/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > n ? `${plain.slice(0, n).trimEnd()}…` : plain;
};

/**
 * The class's "view mode": everything the owner looks at before deciding what to do with a class, read-only, with one switch
 * for Active / Inactive and a clear way into edit mode. Counted from real rows (see worker/src/routes/api/admin/course-overview.ts).
 */
export function CourseView() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const [params] = useSearchParams();
  const { t, pick, lang, money, num, date } = useI18n();
  const { can } = useAuth();
  const setActive = useSetActive();
  const canWrite = can("courses:write");

  const course = useQuery({ queryKey: ["course", id], queryFn: async () => (await adm<{ item: CourseRow }>(`/courses/${id}`)).item });
  const overview = useQuery({ queryKey: ["course-overview", id], queryFn: () => adm<Overview>(`/courses/${id}/overview`) });
  const tree = useQuery({ queryKey: ["curriculum", id], queryFn: () => adm<Tree>(`/courses/${id}/curriculum`) });

  // old deep links (?tab=curriculum / ?tab=seo) belong to the editor
  const legacyTab = params.get("tab");
  if (legacyTab) return <Navigate to={`/courses/${id}/edit?tab=${encodeURIComponent(legacyTab)}`} replace />;
  if (course.isPending || overview.isPending) return <Spinner />;
  if (course.isError) return <ErrorState error={course.error} onRetry={() => course.refetch()} />;
  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;

  const c = course.data;
  const s = overview.data.stats;
  const active = isActive(c);
  const other = pick({ a_bn: c.title_en, a_en: c.title_bn }, "a");
  const publicHref = `${lang === "en" ? "/en" : ""}/courses/${c.slug}`;
  const subject = { ...c, enrolled_count: s.enrolled, notify_count: s.waiting };

  return (
    <>
      <PageHeader
        title={pick(c, "title")}
        sub={other}
        back={
          <Link to="/courses" className="back">
            ← {t("adm.nav.courses")}
          </Link>
        }
        actions={
          <>
            <Chip tone="info">
              <Icon name="eye" /> {t("adm.course.viewMode")}
            </Chip>
            {c.status === "published" && (
              <a className="btn btn-outline btn-sm" href={publicHref} target="_blank" rel="noopener noreferrer">
                <Icon name="external" /> {t("adm.course.viewOnSite")}
              </a>
            )}
            {canWrite && (
              <Link className="btn btn-primary btn-sm" to={`/courses/${id}/edit`}>
                <Icon name="sparkle" /> {t("adm.course.edit")}
              </Link>
            )}
          </>
        }
      />

      <section className={`panel vis-card${active ? " on" : ""}`} aria-label={t("adm.course.visibility")}>
        <div className="vis-text">
          <CourseStateChip status={c.status} />
          <p>{t(`adm.course.stateText.${c.status}` as "adm.course.stateText.draft")}</p>
        </div>
        <Switch checked={active} disabled={!canWrite} onChange={(x) => void setActive(subject, x)} label={t("adm.course.activeOnSite")} />
      </section>

      <section className="kpis" aria-label={t("adm.course.viewMode")}>
        <Kpi icon="users" label={t("adm.course.kpi.students")} value={num(s.enrolled)} sub={t("adm.course.kpi.ever", { n: num(s.ever_enrolled) })} />
        <Kpi icon="wallet" label={t("adm.course.kpi.revenue")} value={money(s.revenue)} sub={t(s.paid_orders === 1 ? "adm.course.kpi.ordersOne" : "adm.course.kpi.orders", { n: num(s.paid_orders) })} />
        <Kpi
          icon="star"
          label={t("adm.course.kpi.rating")}
          value={s.rating_count > 0 ? `${lang === "bn" ? num(Math.round(s.rating_avg * 10) / 10) : s.rating_avg.toFixed(1)} ★` : "—"}
          sub={s.rating_count > 0 ? t(s.rating_count === 1 ? "adm.course.kpi.reviewsOne" : "adm.course.kpi.reviews", { n: num(s.rating_count) }) : t("adm.course.kpi.notRated")}
        />
        <Kpi icon="check" label={t("adm.course.kpi.reviewsWaiting")} value={num(s.reviews_waiting)} sub={t("adm.course.kpi.toApprove")} tone={s.reviews_waiting > 0 ? "warn" : undefined} to={can("reviews:read") ? "/reviews?status=pending" : undefined} />
        {(c.status === "coming_soon" || s.waiting > 0) && <Kpi icon="bell" label={t("adm.course.kpi.waiting")} value={num(s.waiting)} sub={t("adm.course.kpi.asked")} to={can("signups:read") ? "/signups" : undefined} />}
        <Kpi icon="book" label={t("adm.course.kpi.lessons")} value={num(s.lessons)} sub={t(s.previews === 1 ? "adm.course.kpi.shapeOne" : "adm.course.kpi.shape", { m: num(s.minutes), p: num(s.previews) })} tone={s.lessons === 0 && active ? "warn" : undefined} />
      </section>

      <Panel
        title={t("adm.course.about")}
        actions={
          canWrite && (
            <Link className="btn btn-outline btn-sm" to={`/courses/${id}/edit`}>
              {t("adm.course.editDetails")}
            </Link>
          )
        }
      >
        {c.banner_key && <img className="view-banner" src={`/media/${c.banner_key}`} alt="" loading="lazy" />}
        <dl className="kv-grid">
          <div>
            <dt>{t("label.status")}</dt>
            <dd>
              <CourseStateChip status={c.status} />
            </dd>
          </div>
          <div>
            <dt>{t("label.price")}</dt>
            <dd>{c.price === 0 ? t("label.free") : money(c.price)}</dd>
          </div>
          <div>
            <dt>{t("adm.f.level")}</dt>
            <dd>{c.level ? t(`label.${c.level}` as "label.beginner") : t("adm.course.notSet")}</dd>
          </div>
          <div>
            <dt>{t("adm.f.launchAt")}</dt>
            <dd>{c.launch_at ? date(c.launch_at) : t("adm.course.notSet")}</dd>
          </div>
          <div>
            <dt>{t("adm.f.certEnabled")}</dt>
            <dd>{c.cert_enabled ? t("adm.yes") : t("adm.no")}</dd>
          </div>
          <div>
            <dt>{t("adm.f.featured")}</dt>
            <dd>{c.featured ? t("adm.yes") : t("adm.no")}</dd>
          </div>
          <div>
            <dt>{t("adm.course.address")}</dt>
            <dd>
              <code className="code">/courses/{c.slug}</code>
            </dd>
          </div>
          <div>
            <dt>{t("adm.f.sort")}</dt>
            <dd>{num(c.sort)}</dd>
          </div>
        </dl>
        <h3 className="view-h">{t("adm.course.shortDesc")}</h3>
        <div className="view-cols">
          <p lang="bn">{c.short_bn || "—"}</p>
          <p lang="en">{c.short_en || "—"}</p>
        </div>
        <div className="view-cols">
          <p lang="bn" className="muted">
            {excerpt(c.long_bn)}
          </p>
          <p lang="en" className="muted">
            {excerpt(c.long_en)}
          </p>
        </div>
      </Panel>

      <Panel
        title={t("adm.course.curriculum")}
        actions={
          canWrite && (
            <Link className="btn btn-outline btn-sm" to={`/courses/${id}/edit?tab=curriculum`}>
              {t("adm.course.editCurriculum")}
            </Link>
          )
        }
      >
        {tree.isPending ? (
          <Spinner />
        ) : (tree.data?.modules ?? []).length === 0 ? (
          <p className="muted">{t("adm.course.noLessons")}</p>
        ) : (
          <ol className="outline">
            {tree.data!.modules.map((m) => (
              <li key={m.id}>
                <b>{pick(m, "title")}</b>
                <ul>
                  {m.lessons.map((l) => (
                    <li key={l.id}>
                      <Icon name={l.type === "video" ? "video" : l.type === "resource" ? "download" : l.type === "external" ? "link" : "text"} />
                      <span>{pick(l, "title")}</span>
                      {l.is_preview ? <Chip tone="gold">{t("adm.course.freePreview")}</Chip> : null}
                      {l.duration_sec > 0 && <small className="muted">{formatDuration(l.duration_sec, lang)}</small>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel
        title={t("adm.course.latestReviews")}
        actions={
          can("reviews:read") && (
            <Link className="btn btn-outline btn-sm" to="/reviews">
              {t("adm.course.allReviews")}
            </Link>
          )
        }
      >
        {overview.data.reviews.length === 0 ? (
          <p className="muted">{t("adm.course.noReviews")}</p>
        ) : (
          <ul className="view-reviews">
            {overview.data.reviews.map((r) => (
              <li key={r.id}>
                <span className="stars" aria-label={`${r.rating}/5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Icon key={n} name="star" className={n <= r.rating ? "" : "off"} />
                  ))}
                </span>
                <b>{r.student_name}</b> <StatusChip status={r.status} /> <small className="muted">{date(r.created_at)}</small>
                {r.body && <p>{r.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canWrite && (
        <p className="row">
          <Link className="btn btn-primary" to={`/courses/${id}/edit`}>
            <Icon name="sparkle" /> {t("adm.course.edit")}
          </Link>
          <Button className="btn-ghost" onClick={() => void setActive(subject, !active)}>
            {active ? t("adm.course.makeInactive") : t("adm.course.makeActive")}
          </Button>
        </p>
      )}
    </>
  );
}
