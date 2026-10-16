import { useEffect } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CertificateDTO, LessonContentDTO, Progress } from "@mawah/shared";
import { track } from "../lib/analytics";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, ErrorState, Icon, Spinner, useToast } from "../components/ui";
import { Downloads, LessonBody, LessonMedia, Questions } from "../components/LessonView";
import { courseKey, CurriculumList, useCourseView, type CourseView } from "./Course";

export function LessonPlayer() {
  const { slug = "", lessonId = "" } = useParams();
  const id = Number(lessonId);
  const { t, pick, date } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const view = useCourseView(slug);
  const lesson = useQuery({
    queryKey: ["lesson", id],
    queryFn: async () => (await api<{ lesson: LessonContentDTO }>(`/student/lessons/${id}`)).lesson,
    enabled: Number.isInteger(id) && id > 0,
    retry: (n, e) => !(e instanceof ApiError) && n < 2,
  });

  const toggle = useMutation({
    mutationFn: async (done: boolean) => api<{ progress: Progress; certificate: CertificateDTO | null }>(`/student/lessons/${id}/complete`, { method: done ? "POST" : "DELETE", json: done ? {} : undefined }),
    onSuccess: (res, done) => {
      qc.setQueryData<LessonContentDTO>(["lesson", id], (l) => (l ? { ...l, completed: done } : l));
      qc.setQueryData<CourseView>(courseKey(slug), (v) =>
        v
          ? {
              ...v,
              progress: res.progress,
              certificate: res.certificate ?? v.certificate,
              curriculum: v.curriculum.map((m) => ({ ...m, lessons: m.lessons.map((l) => (l.id === id ? { ...l, completed: done } : l)) })),
            }
          : v,
      );
      void qc.invalidateQueries({ queryKey: ["my-courses"] });
      if (done) {
        track("lesson_complete", { course: slug, lesson_id: id });
        if (res.progress.pct >= 100) track("course_complete", { course: slug });
        if (res.certificate) track("certificate_earned", { course: slug });
      }
      if (done && res.certificate) toast(t("app.lesson.certEarned"));
      else if (done && res.progress.pct >= 100) toast(t("app.lesson.allDone"));
    },
    onError: () => toast(t("err.generic"), true),
  });

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [id]);

  // a lesson was opened (once per lesson, when its content has arrived)
  const lessonType = lesson.data?.type;
  useEffect(() => {
    if (lessonType) track("lesson_start", { course: slug, lesson_id: id, lesson_type: lessonType });
  }, [slug, id, lessonType]);

  if (!Number.isInteger(id) || id <= 0) return <Navigate to={`/learn/${slug}`} replace />;
  if (view.isPending || lesson.isPending) return <Spinner />;
  if (view.isError) return <ErrorState error={view.error} onRetry={() => view.refetch()} />;
  if (lesson.isError) {
    const e = lesson.error;
    if (e instanceof ApiError && e.code === "lesson_locked") {
      return (
        <div className="empty">
          <Icon name="lock" />
          <h2>{t("app.lesson.locked", { date: date(e.fields?.available_at) })}</h2>
          <Link className="btn btn-outline" to={`/learn/${slug}`}>
            {t("btn.back")}
          </Link>
        </div>
      );
    }
    return <ErrorState error={e} onRetry={() => lesson.refetch()} />;
  }

  const l = lesson.data;
  const v = view.data;
  const all = v.progress.pct >= 100;

  return (
    <div className="layout-player">
      <div>
        <p className="small">
          <Link className="link" to={`/learn/${slug}`}>
            ← {pick(v.course, "title")}
          </Link>
        </p>
        {v.certificate && all && (
          <div className="celebrate">
            <Icon name="award" />
            <div>
              <b>{t("app.lesson.certEarned")}</b> <Link to="/certificates">{t("app.course.certificate.get")}</Link>
            </div>
          </div>
        )}
        <LessonMedia lesson={l} />
        <div className="player-bar">
          <h1 className="player-title">{pick(l, "title")}</h1>
          <Button className={l.completed ? "btn-outline" : "btn-primary"} busy={toggle.isPending} onClick={() => toggle.mutate(!l.completed)}>
            <Icon name="check" /> {l.completed ? t("app.lesson.done") : t("app.lesson.markDone")}
          </Button>
        </div>
        <LessonBody lesson={l} />
        <div className="row between mt mb">
          {l.prev_id ? (
            <Link className="btn btn-outline" to={`/learn/${slug}/${l.prev_id}`}>
              ← {t("app.lesson.prev")}
            </Link>
          ) : (
            <span />
          )}
          {l.next_id ? (
            <Link
              className="btn btn-dark"
              to={`/learn/${slug}/${l.next_id}`}
              onClick={(e) => {
                // "next" also counts the lesson as done, so progress follows the student without extra taps
                if (!l.completed) {
                  e.preventDefault();
                  toggle.mutate(true, { onSuccess: () => navigate(`/learn/${slug}/${l.next_id}`) });
                }
              }}
            >
              {t("app.lesson.next")} →
            </Link>
          ) : null}
        </div>
        <Downloads lesson={l} />
        <Questions lessonId={l.id} />
      </div>
      <aside aria-label={t("app.course.curriculum")}>
        <section className="panel">
          <h2>{t("app.course.curriculum")}</h2>
          <CurriculumList view={v} slug={slug} currentId={id} />
        </section>
      </aside>
    </div>
  );
}

/** Free preview lessons: watchable without an account — the strongest "try before you buy". */
export function Preview() {
  const { lessonId = "" } = useParams();
  const [params] = useSearchParams();
  const course = (params.get("c") ?? "").replace(/[^a-z0-9-]/gi, "");
  const { t, pick, lang } = useI18n();
  const q = useQuery({
    queryKey: ["preview", lessonId],
    queryFn: async () => (await api<{ lesson: LessonContentDTO }>(`/preview/lessons/${Number(lessonId)}`)).lesson,
    retry: false,
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} />;
  const l = q.data;
  const home = lang === "en" ? "/en" : "";
  return (
    <div className="stack">
      <p className="small">
        <a className="link" href={course ? `${home}/courses/${course}` : `${home}/courses`}>
          ← {t("btn.back")}
        </a>
      </p>
      <span className="cert-pill">
        <Icon name="gift" /> {t("app.course.preview")}
      </span>
      <LessonMedia lesson={l} />
      <h1 className="player-title">{pick(l, "title")}</h1>
      <LessonBody lesson={l} />
      <div className="panel tc">
        <h2>{t("app.preview.cta")}</h2>
        <Link className="btn btn-primary btn-lg" to={course ? `/checkout?c=${course}` : "/"}>
          {t("btn.enrollNow")}
        </Link>
      </div>
    </div>
  );
}
