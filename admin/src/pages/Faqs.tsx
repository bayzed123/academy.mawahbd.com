import { useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FAQ_TOPICS, type FaqTopic } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { FieldDef } from "../components/Form";
import { ResourcePage } from "../components/ResourcePage";
import { Chip, Icon, Switch, useToast } from "../components/ui";
import { useCourseOptions } from "./Courses";

interface Faq {
  id: number;
  scope: "site" | "course";
  course_id: number | null;
  topic: FaqTopic;
  question_bn: string;
  question_en: string;
  answer_bn: string;
  answer_en: string;
  featured: number;
  active: number;
  sort: number;
  course_title_bn?: string;
  course_title_en?: string;
  deleted_at: string | null;
}

/** The on/off switch in the list: shown / hidden without opening the form. */
function ActiveToggle({ row, canWrite }: { row: Faq; canWrite: boolean }) {
  const { t, pick, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const name = pick(row, "question") || t("adm.faqs.untitled");
  const flip = useMutation({
    mutationFn: (active: boolean) => adm(`/faqs/${row.id}`, { method: "PATCH", json: { active } }),
    onSuccess: () => {
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["/faqs"] });
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  return <Switch checked={!!row.active} disabled={!canWrite || flip.isPending} onChange={(x) => flip.mutate(x)} label={t("adm.faqs.toggle", { name })} hideLabel />;
}

export function Faqs() {
  const { t, pick, lang } = useI18n();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const classes = useCourseOptions();
  const canWrite = can("faqs:write");
  // arriving from a class (?course_id=…) the form starts as "one class only" for that class
  const fromClass = Number(params.get("course_id")) || null;
  const isClass = (v: Record<string, unknown>) => v.scope === "course";
  const isSite = (v: Record<string, unknown>) => v.scope !== "course";
  const topicLabel = (topic: FaqTopic) => t(`adm.faqs.topic.${topic}` as "adm.faqs.topic.general");
  const fields: FieldDef[] = [
    { type: "select", key: "scope", label: t("adm.faqs.scope"), hint: t("adm.faqs.scopeHint"), options: [{ value: "site", label: t("adm.faqs.scope.site") }, { value: "course", label: t("adm.faqs.scope.course") }] },
    { type: "select", key: "course_id", label: t("adm.faqs.course"), options: classes, nullable: true, numeric: true, showIf: isClass },
    { type: "select", key: "topic", label: t("adm.faqs.topic"), hint: t("adm.faqs.topicHint"), options: FAQ_TOPICS.map((x) => ({ value: x, label: topicLabel(x) })), half: true, showIf: isSite },
    { type: "text", key: "question_bn", label: t("adm.faqs.questionBn"), maxLength: 250 },
    { type: "text", key: "question_en", label: t("adm.faqs.questionEn"), maxLength: 250 },
    { type: "markdown", key: "answer_bn", label: t("adm.faqs.answerBn"), rows: 5, maxLength: 3000 },
    { type: "markdown", key: "answer_en", label: t("adm.faqs.answerEn"), rows: 5, maxLength: 3000, hint: t("adm.faqs.answerHint") },
    { type: "switch", key: "featured", label: t("adm.faqs.featured"), half: true, showIf: isSite },
    { type: "switch", key: "active", label: t("adm.f.active"), half: true },
    { type: "number", key: "sort", label: t("adm.f.sort"), half: true, min: 0, max: 99999, hint: t("adm.f.sortHint") },
  ];
  return (
    <ResourcePage<Faq>
      title={t("adm.nav.faqs")}
      sub={t("adm.faqs.sub")}
      endpoint="/faqs"
      perms={{ write: "faqs:write" }}
      fields={fields}
      defaults={{ scope: fromClass ? "course" : "site", course_id: fromClass, topic: "general", question_bn: "", question_en: "", answer_bn: "", answer_en: "", featured: false, active: true, sort: 100 }}
      rowLabel={(r) => r.question_en || r.question_bn || `#${r.id}`}
      defaultSort="sort"
      searchPlaceholder={t("adm.faqs.search")}
      csv={false}
      trash
      filters={[
        { key: "scope", label: t("adm.faqs.scope"), options: [{ value: "site", label: t("adm.faqs.scope.site") }, { value: "course", label: t("adm.faqs.scope.course") }] },
        { key: "course_id", label: t("adm.faqs.course"), options: classes },
        { key: "topic", label: t("adm.faqs.topic"), options: FAQ_TOPICS.map((x) => ({ value: x, label: topicLabel(x) })) },
        { key: "active", label: t("label.status"), options: [{ value: "1", label: t("adm.faqs.status.on") }, { value: "0", label: t("adm.faqs.status.off") }] },
      ]}
      toolbarExtra={
        <a className="btn btn-outline btn-sm" href={lang === "en" ? "/en/faq" : "/faq"} target="_blank" rel="noopener noreferrer">
          <Icon name="external" /> {t("adm.faqs.preview")}
        </a>
      }
      columns={[
        {
          key: "question",
          label: t("adm.faqs.question"),
          render: (r) => (
            <span className="cell-title">
              <b>{pick(r, "question") || t("adm.faqs.untitled")}</b>
              <small>{r.scope === "course" ? pick({ a_bn: r.course_title_bn ?? "", a_en: r.course_title_en ?? "" }, "a") || `#${r.course_id}` : t("adm.faqs.allClasses")}</small>
            </span>
          ),
        },
        { key: "scope", label: t("adm.faqs.scope"), sort: "scope", desktopOnly: true, render: (r) => <Chip tone={r.scope === "course" ? "info" : "neutral"}>{r.scope === "course" ? t("adm.faqs.scope.course") : topicLabel(r.topic)}</Chip> },
        { key: "home", label: t("adm.faqs.home"), desktopOnly: true, render: (r) => (r.featured && r.scope === "site" ? <Chip tone="gold">{t("adm.faqs.home")}</Chip> : "—") },
        { key: "status", label: t("label.status"), render: (r) => <Chip tone={r.active ? "ok" : "neutral"}>{t(r.active ? "adm.faqs.status.on" : "adm.faqs.status.off")}</Chip> },
        { key: "sort", label: t("adm.f.sort"), sort: "sort", desktopOnly: true },
      ]}
      rowActions={(r) => <ActiveToggle row={r} canWrite={canWrite} />}
    />
  );
}
