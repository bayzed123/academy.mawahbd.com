import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { playsOnPublicPages } from "@mawah/shared";
import { adm } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { CourseRow, ListResponse } from "../lib/types";
import { isActive, useSetActive } from "../lib/visibility";
import { ResourcePage } from "../components/ResourcePage";
import { CourseStateChip } from "../components/CourseState";
import { Chip, Icon, Switch } from "../components/ui";

export function useCategoryOptions() {
  const { pick } = useI18n();
  const q = useQuery({ queryKey: ["category-options"], queryFn: () => adm<ListResponse<{ id: number; name_bn: string; name_en: string }>>("/categories?per_page=100"), staleTime: 60_000 });
  return (q.data?.items ?? []).map((c) => ({ value: String(c.id), label: pick(c, "name") }));
}

/** Every class as a select option (the same list the bundle form uses, so the two share one request). */
export function useCourseOptions() {
  const { pick } = useI18n();
  const q = useQuery({ queryKey: ["course-options"], queryFn: () => adm<ListResponse<CourseRow>>("/courses?per_page=100&sort=title_en"), staleTime: 60_000 });
  return (q.data?.items ?? []).map((c) => ({ value: String(c.id), label: pick(c, "title") }));
}

export function useInstructorOptions() {
  const { pick } = useI18n();
  const q = useQuery({ queryKey: ["instructor-options"], queryFn: () => adm<ListResponse<{ id: number; name_bn: string; name_en: string }>>("/instructors?per_page=100"), staleTime: 60_000 });
  return (q.data?.items ?? []).map((c) => ({ value: String(c.id), label: pick(c, "name") }));
}

export function Courses() {
  const { t, pick, money, num } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const categories = useCategoryOptions();
  const setActive = useSetActive();

  return (
    <ResourcePage<CourseRow>
      title={t("adm.nav.courses")}
      sub={t("adm.courses.sub")}
      endpoint="/courses"
      perms={{ write: "courses:write", delete: "courses:delete" }}
      fields={[]}
      defaults={{}}
      rowLabel={(r) => r.title_en}
      defaultSort="sort"
      trash
      onEdit={(row) => navigate(row ? `/courses/${row.id}/edit` : "/courses/new")}
      onView={(row) => navigate(`/courses/${row.id}`)}
      searchPlaceholder={t("adm.courses.search")}
      filters={[
        { key: "status", label: t("label.status"), options: ["draft", "coming_soon", "published", "archived"].map((s) => ({ value: s, label: t(`status.${s}` as "status.draft") })) },
        { key: "category_id", label: t("adm.f.category"), options: categories },
      ]}
      columns={[
        {
          key: "title",
          label: t("adm.f.title"),
          sort: "title_en",
          render: (r) => (
            <Link to={`/courses/${r.id}`} className="cell-title" onClick={(e) => e.stopPropagation()}>
              <b>{pick(r, "title")}</b>
              <small>{pick({ a_bn: r.title_en, a_en: r.title_bn }, "a")}</small>
            </Link>
          ),
        },
        { key: "price", label: t("label.price"), sort: "price", className: "num", render: (r) => (r.price === 0 ? t("label.free") : money(r.price)) },
        { key: "status", label: t("label.status"), sort: "status", render: (r) => <CourseStateChip status={r.status} /> },
        {
          key: "active",
          label: t("adm.course.activeOnSite"),
          render: (r) => (
            // one switch: on = on the website and open for enrolment; off = hidden. It asks before hiding a class or opening an empty one.
            <span onClick={(e) => e.stopPropagation()}>
              <Switch checked={isActive(r)} disabled={!can("courses:write")} onChange={(x) => void setActive(r, x)} label={t("adm.course.toggle", { name: pick(r, "title") })} hideLabel />
            </span>
          ),
        },
        {
          // the demo class, one click away for every class: added (opens its tab) or "+ Add demo"
          key: "demo",
          label: t("adm.f.demoSection"),
          render: (r) =>
            playsOnPublicPages(r.demo_url ?? "") ? (
              <Link to={`/courses/${r.id}/edit?tab=demo`} className="chip-link" onClick={(e) => e.stopPropagation()}>
                <Chip tone="ok">
                  <Icon name="play" /> {t("adm.courses.demoYes")}
                  <span className="vh"> — {pick(r, "title")}</span>
                </Chip>
              </Link>
            ) : can("courses:write") ? (
              <Link to={`/courses/${r.id}/edit?tab=demo`} className="btn btn-outline btn-sm" onClick={(e) => e.stopPropagation()}>
                <Icon name="plus" /> {t("adm.courses.demoAdd")}
                <span className="vh"> — {pick(r, "title")}</span>
              </Link>
            ) : (
              <span className="muted">—</span>
            ),
        },
        {
          key: "lessons",
          label: t("adm.f.lessons"),
          sort: "lesson_count",
          desktopOnly: true,
          render: (r) =>
            r.lesson_count === 0 && r.status === "published" ? (
              <span className="warn-text" title={t("adm.courses.noLessons")}>
                <Icon name="bell" className="inline-icon" /> 0
              </span>
            ) : (
              num(r.lesson_count)
            ),
        },
        { key: "students", label: t("adm.nav.students"), desktopOnly: true, render: (r) => num(r.enrolled_count ?? 0) },
        { key: "wait", label: t("adm.f.waiting"), desktopOnly: true, render: (r) => (r.status === "coming_soon" ? num(r.notify_count ?? 0) : "—") },
      ]}
      rowActions={(r) => (
        <>
          <Link className="icon-btn" to={`/courses/${r.id}/edit?tab=curriculum`} aria-label={t("adm.course.curriculum")} title={t("adm.course.curriculum")}>
            <Icon name="list" />
          </Link>
          {r.status === "published" && (
            <a className="icon-btn" href={`/courses/${r.slug}`} target="_blank" rel="noopener noreferrer" aria-label={t("adm.course.viewOnSite")} title={t("adm.course.viewOnSite")}>
              <Icon name="external" />
            </a>
          )}
        </>
      )}
    />
  );
}
