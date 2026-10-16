import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { COURSE_STATUSES } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { ClassPicture, CourseRow } from "../lib/types";
import { ClassPictures } from "../components/ClassPictures";
import { CurriculumBuilder } from "../components/Curriculum";
import { FormFields, initialValues, toPayload, type FieldDef, type Values } from "../components/Form";
import { CourseStateChip } from "../components/CourseState";
import { Button, Chip, ErrorState, Icon, PageHeader, Panel, Spinner, Tabs, useConfirm, useFieldErrors, useToast } from "../components/ui";
import { useCategoryOptions, useInstructorOptions } from "./Courses";

type Tab = "details" | "curriculum" | "pictures" | "seo";

const DEFAULTS: Values = {
  title_bn: "", title_en: "", short_bn: "", short_en: "", long_bn: "", long_en: "", banner_key: null, icon: "cake", category_id: null, instructor_id: null,
  level: null, price: 0, status: "draft", details_url: "", featured: false, cert_enabled: true, cert_template: "classic",
  seo_title_bn: "", seo_title_en: "", seo_desc_bn: "", seo_desc_en: "", sort: 100, launch_at: null,
};

export function CourseEditor() {
  const { id: idParam } = useParams();
  const isNew = !idParam || idParam === "new";
  const id = isNew ? null : Number(idParam);
  const { t, pick, lang } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const fieldErrors = useFieldErrors();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "details";
  const categories = useCategoryOptions();
  const instructors = useInstructorOptions();
  const canWrite = can("courses:write");

  const course = useQuery({
    queryKey: ["course", id],
    enabled: id !== null,
    queryFn: async () => (await adm<{ item: CourseRow }>(`/courses/${id}`)).item,
  });

  // how many extra pictures the class has (the tab shows it); the Pictures tab reads the same list
  const pictureCount = useQuery({
    queryKey: ["course-images", id],
    enabled: id !== null,
    queryFn: () => adm<{ items: ClassPicture[]; max: number }>(`/courses/${id}/images`),
    select: (r) => r.items.length,
  });

  const detailFields: FieldDef[] = [
    { type: "text", key: "title_bn", label: t("adm.f.titleBn"), half: true, required: true, maxLength: 200 },
    { type: "text", key: "title_en", label: t("adm.f.titleEn"), half: true, required: true, maxLength: 200 },
    { type: "textarea", key: "short_bn", label: t("adm.f.shortBn"), hint: t("adm.f.shortHint"), half: true, maxLength: 400 },
    { type: "textarea", key: "short_en", label: t("adm.f.shortEn"), half: true, maxLength: 400 },
    { type: "image", key: "banner_key", label: t("adm.f.banner"), hint: t("adm.f.bannerHint"), folder: "banners", maxWidth: 1280 },
    { type: "icon", key: "icon", label: t("adm.f.icon"), hint: t("adm.f.iconHint") },
    { type: "markdown", key: "long_bn", label: t("adm.f.longBn"), rows: 10 },
    { type: "markdown", key: "long_en", label: t("adm.f.longEn"), rows: 10 },
    { type: "section", key: "s1", label: t("adm.f.sellingSection") },
    { type: "number", key: "price", label: t("adm.f.coursePrice"), half: true, min: 0, suffix: "৳", hint: t("adm.f.coursePriceHint") },
    { type: "select", key: "status", label: t("adm.course.visibility"), half: true, options: COURSE_STATUSES.map((s) => ({ value: s, label: t(`adm.course.vis.${s}` as "adm.course.vis.draft") })), hint: t(`adm.status.hint.${"draft"}` as "adm.status.hint.draft") },
    { type: "select", key: "category_id", label: t("adm.f.category"), half: true, options: categories, nullable: true, numeric: true },
    { type: "select", key: "instructor_id", label: t("adm.f.instructor"), half: true, options: instructors, nullable: true, numeric: true },
    { type: "select", key: "level", label: t("adm.f.level"), half: true, nullable: true, options: ["beginner", "intermediate", "advanced"].map((l) => ({ value: l, label: t(`label.${l}` as "label.beginner") })) },
    { type: "text", key: "details_url", label: t("adm.f.detailsUrl"), half: true, hint: t("adm.f.detailsUrlHint"), nullable: true },
    { type: "date", key: "launch_at", label: t("adm.f.launchAt"), half: true, hint: t("adm.f.launchAtHint") },
    { type: "number", key: "sort", label: t("adm.f.sort"), half: true, min: 0, max: 99999, hint: t("adm.f.sortHint") },
    { type: "switch", key: "featured", label: t("adm.f.featured"), half: true, hint: t("adm.f.featuredHint") },
    { type: "switch", key: "cert_enabled", label: t("adm.f.certEnabled"), half: true, hint: t("adm.f.certHint") },
  ];
  const seoFields: FieldDef[] = [
    { type: "text", key: "seo_title_bn", label: t("adm.f.seoTitleBn"), half: true, maxLength: 120 },
    { type: "text", key: "seo_title_en", label: t("adm.f.seoTitleEn"), half: true, maxLength: 120 },
    { type: "textarea", key: "seo_desc_bn", label: t("adm.f.seoDescBn"), half: true, maxLength: 320 },
    { type: "textarea", key: "seo_desc_en", label: t("adm.f.seoDescEn"), half: true, maxLength: 320 },
  ];
  const all = [...detailFields, ...seoFields];

  const [values, setValues] = useState<Values>(DEFAULTS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (course.data) {
      setValues(initialValues(all, course.data as unknown as Values, DEFAULTS));
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.data]);

  const set = (k: string, v: unknown) => {
    setValues((s) => ({ ...s, [k]: v }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = toPayload(all, values);
      return id ? adm<{ item: CourseRow }>(`/courses/${id}`, { method: "PATCH", json: body }) : adm<{ item: CourseRow }>("/courses", { json: body });
    },
    onSuccess: (res) => {
      setErrors({});
      setDirty(false);
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["/courses"] });
      void qc.invalidateQueries({ queryKey: ["course", res.item.id] });
      void qc.invalidateQueries({ queryKey: ["course-options"] });
      if (!id) navigate(`/courses/${res.item.id}/edit?tab=curriculum`, { replace: true });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast(e instanceof ApiError && e.code === "validation" ? t("err.validation") : t(`err.${e instanceof ApiError ? e.code : "generic"}` as "err.generic"), true);
    },
  });

  const onSave = async () => {
    // publishing a class without lessons is allowed, but never by accident: students who pay would find it empty
    if (values.status === "published" && (course.data?.lesson_count ?? 0) === 0) {
      const res = await confirm({ title: t("adm.course.publishEmptyTitle"), body: t("adm.course.publishEmptyBody"), confirmLabel: t("adm.course.publishAnyway") });
      if (!res.ok) return;
    }
    save.mutate();
  };

  if (id !== null && course.isPending) return <Spinner />;
  if (id !== null && course.isError) return <ErrorState error={course.error} onRetry={() => course.refetch()} />;

  const c = course.data;
  const title = c ? pick(c, "title") : t("adm.course.new");
  const statusHint = t(`adm.status.hint.${String(values.status)}` as "adm.status.hint.draft");

  return (
    <>
      <PageHeader
        title={title}
        back={
          <Link to={c ? `/courses/${c.id}` : "/courses"} className="back">
            ← {c ? t("adm.course.viewMode") : t("adm.nav.courses")}
          </Link>
        }
        sub={c ? undefined : t("adm.course.newSub")}
        actions={
          <>
            <Chip tone="warn">
              <Icon name="sparkle" /> {t("adm.course.editMode")}
            </Chip>
            {c && <CourseStateChip status={c.status} />}
            {c && (
              <Link className="btn btn-outline btn-sm" to={`/courses/${c.id}`}>
                <Icon name="eye" /> {t("adm.view")}
              </Link>
            )}
            {c?.status === "published" && (
              <a className="btn btn-outline btn-sm" href={`${lang === "en" ? "/en" : ""}/courses/${c.slug}`} target="_blank" rel="noopener noreferrer">
                <Icon name="external" /> {t("adm.course.viewOnSite")}
              </a>
            )}
            {canWrite && tab !== "curriculum" && tab !== "pictures" && (
              <Button className="btn-primary" busy={save.isPending} disabled={!dirty && !!id} onClick={onSave}>
                {t("btn.save")}
              </Button>
            )}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(v) => setParams(v === "details" ? {} : { tab: v })}
        tabs={[
          { value: "details", label: t("adm.course.tab.details") },
          { value: "curriculum", label: t("adm.course.curriculum"), count: c?.lesson_count },
          { value: "pictures", label: t("adm.course.tab.pictures"), count: pictureCount.data },
          { value: "seo", label: t("adm.course.tab.seo") },
        ]}
      />
      {tab === "curriculum" ? (
        id ? (
          <Panel>
            <CurriculumBuilder courseId={id} />
          </Panel>
        ) : (
          <Panel>
            <p className="muted">{t("adm.course.saveFirst")}</p>
          </Panel>
        )
      ) : tab === "pictures" ? (
        <Panel>{id ? <ClassPictures courseId={id} canWrite={canWrite} /> : <p className="muted">{t("adm.pics.saveFirst")}</p>}</Panel>
      ) : (
        <Panel>
          {tab === "details" && <p className="hint status-hint">{statusHint}</p>}
          <FormFields fields={tab === "seo" ? seoFields : detailFields} values={values} errors={errors} onChange={set} idPrefix="c" />
          {tab === "seo" && <p className="hint">{t("adm.f.seoNote")}</p>}
        </Panel>
      )}
    </>
  );
}
