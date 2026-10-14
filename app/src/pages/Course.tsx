import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CertificateDTO, CurriculumModuleDTO, MyCourseDTO, Progress as ProgressDTO } from "@mawah/shared";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, ErrorState, Icon, Progress, Spinner, useToast } from "../components/ui";
import { resumeLessonId } from "./Learning";

export interface CourseView {
  course: MyCourseDTO["course"] & { id: number };
  enrolled_at: string;
  progress: ProgressDTO;
  curriculum: CurriculumModuleDTO[];
  certificate: CertificateDTO | null;
  review: { id: number; rating: number; body: string; status: "pending" | "approved" | "rejected"; reply: string | null } | null;
}

export const courseKey = (slug: string) => ["course", slug] as const;

export function useCourseView(slug: string) {
  return useQuery({ queryKey: courseKey(slug), queryFn: () => api<CourseView>(`/student/courses/${slug}`), retry: (n, e) => !(e instanceof ApiError) && n < 2 });
}

const isLocked = (availableAt?: string | null) => !!availableAt && Date.parse(availableAt) > Date.now();

/** Curriculum list shared by the class overview and the player sidebar. */
export function CurriculumList({ view, slug, currentId }: { view: CourseView; slug: string; currentId?: number }) {
  const { t, pick, date, duration, lang } = useI18n();
  const cur = view.curriculum.find((m) => m.lessons.some((l) => l.id === currentId))?.id ?? view.curriculum.find((m) => m.lessons.some((l) => !l.completed))?.id;
  return (
    <>
      {view.curriculum.map((m) => {
        const done = m.lessons.filter((l) => l.completed).length;
        return (
          <details key={m.id} className="module" open={m.id === cur || view.curriculum.length === 1}>
            <summary>
              <span>{pick(m, "title")}</span>
              <span className="count">
                {lang === "bn" ? toBn(done) : done}/{lang === "bn" ? toBn(m.lessons.length) : m.lessons.length}
              </span>
              <Icon name="chevron" />
            </summary>
            <ul className="lesson-list">
              {m.lessons.map((l) => {
                const locked = isLocked(l.available_at);
                const body = (
                  <>
                    <span className={`state${l.completed ? " done" : locked ? " lock" : ""}`}>
                      <Icon name={locked ? "lock" : "check"} />
                    </span>
                    <span>{pick(l, "title")}</span>
                    {locked ? <span className="dur">{t("app.course.locked", { date: date(l.available_at) })}</span> : l.duration_sec > 0 ? <span className="dur">{duration(l.duration_sec)}</span> : null}
                  </>
                );
                return (
                  <li key={l.id}>
                    {locked ? (
                      <span className="locked">{body}</span>
                    ) : (
                      <Link to={`/learn/${slug}/${l.id}`} aria-current={l.id === currentId ? "page" : undefined}>
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </>
  );
}

const BN = "০১২৩৪৫৬৭৮৯";
const toBn = (n: number) => String(n).replace(/\d/g, (d) => BN[Number(d)]);

function ReviewBox({ view, slug }: { view: CourseView; slug: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const existing = view.review;
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [editing, setEditing] = useState(!existing);
  const save = useMutation({
    mutationFn: () => api("/student/reviews", { json: { course_id: view.course.id, rating, body: body.trim() } }),
    onSuccess: () => {
      toast(t("app.course.review.thanks"));
      setEditing(false);
      void qc.invalidateQueries({ queryKey: courseKey(slug) });
    },
    onError: () => toast(t("err.generic"), true),
  });

  if (existing && !editing) {
    return (
      <section className="panel">
        <h2>{t("app.course.review.title")}</h2>
        <div className="stars" aria-label={`${existing.rating}/5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Icon key={n} name="star" className={n <= existing.rating ? "" : "off"} />
          ))}
        </div>
        {existing.body && <p>{existing.body}</p>}
        <p className="hint">{t(`app.course.review.status.${existing.status}` as "app.course.review.status.pending")}</p>
        {existing.reply && <p className="notice ok">{existing.reply}</p>}
        <Button className="btn-outline btn-sm" onClick={() => setEditing(true)}>
          {t("btn.edit")}
        </Button>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>{t("app.course.review.title")}</h2>
      <div className="stars-input" role="group" aria-label={t("label.rating")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-pressed={n <= rating} aria-label={`${n}`} onClick={() => setRating(n)}>
            <Icon name="star" />
          </button>
        ))}
      </div>
      <label className="vh" htmlFor="rv-body">
        {t("app.course.review.body")}
      </label>
      <textarea id="rv-body" className="input mt" maxLength={1000} placeholder={t("app.course.review.body")} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="row mt">
        <Button className="btn-emerald" busy={save.isPending} disabled={rating < 1} onClick={() => save.mutate()}>
          {t("btn.submit")}
        </Button>
        {existing && (
          <Button className="btn-ghost" onClick={() => setEditing(false)}>
            {t("btn.cancel")}
          </Button>
        )}
      </div>
      <p className="hint">{t("app.course.review.note")}</p>
    </section>
  );
}

export function CourseOverview() {
  const { slug = "" } = useParams();
  const { t, lang, pick } = useI18n();
  const q = useCourseView(slug);

  if (q.isPending) return <Spinner />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.code === "not_enrolled") {
      return (
        <div className="empty">
          <Icon name="lock" />
          <h2>{t("app.course.notEnrolled")}</h2>
          <Link className="btn btn-gold btn-lg" to={`/checkout?c=${encodeURIComponent(slug)}`}>
            {t("btn.enrollNow")}
          </Link>
        </div>
      );
    }
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  }
  const v = q.data;
  const resume = resumeLessonId(v.curriculum);
  const done = v.progress.pct >= 100;
  const home = lang === "en" ? "/en" : "";

  return (
    <>
      <div className="course-head">
        <p className="eyebrow">{v.course.category ? pick(v.course.category, "name") : ""}</p>
        <h1>{pick(v.course, "title")}</h1>
        <Progress pct={v.progress.pct} done={done} label={t("app.learning.progress", { done: lang === "bn" ? toBn(v.progress.done) : v.progress.done, total: lang === "bn" ? toBn(v.progress.total) : v.progress.total })} />
        <div className="prog-line">
          <span>{t("app.learning.progress", { done: lang === "bn" ? toBn(v.progress.done) : v.progress.done, total: lang === "bn" ? toBn(v.progress.total) : v.progress.total })}</span>
          <b>{lang === "bn" ? toBn(v.progress.pct) : v.progress.pct}%</b>
        </div>
        <div className="row">
          {resume ? (
            <Link className="btn btn-gold btn-lg" to={`/learn/${slug}/${resume}`}>
              <Icon name="play" /> {done ? t("app.learning.review") : v.progress.done > 0 ? t("app.course.resume") : t("app.learning.start")}
            </Link>
          ) : (
            <span className="badge-soon">{t("app.course.noLessons")}</span>
          )}
          <a className="btn btn-light" href={`${home}/courses/${slug}`}>
            {t("btn.readMore")}
          </a>
        </div>
      </div>

      {v.certificate && (
        <div className="celebrate">
          <Icon name="award" />
          <div>
            <b>{t("app.lesson.certEarned")}</b>{" "}
            <a href={`${home}/certificate/${v.certificate.code}`} target="_blank" rel="noopener noreferrer">
              {t("app.course.certificate.get")}
            </a>
          </div>
        </div>
      )}

      <section className="panel">
        <h2>{t("app.course.curriculum")}</h2>
        {v.curriculum.length === 0 ? <p className="muted">{t("app.course.noLessons")}</p> : <CurriculumList view={v} slug={slug} />}
        {!v.certificate && v.course && <p className="hint">{t("app.course.certificate.hint")}</p>}
      </section>

      <ReviewBox view={v} slug={slug} />
    </>
  );
}
