import { useMemo } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { CourseStatus, CurriculumModuleDTO, MyCourseDTO, OrderDTO } from "@mawah/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { accentClass, Banner, Empty, ErrorState, Icon, Progress } from "../components/ui";

export function MyLearning() {
  const { t, lang, pick } = useI18n();
  const { student } = useAuth();
  const courses = useQuery({ queryKey: ["my-courses"], queryFn: async () => (await api<{ courses: MyCourseDTO[] }>("/student/courses")).courses });
  const orders = useQuery({ queryKey: ["orders"], queryFn: async () => (await api<{ orders: OrderDTO[] }>("/student/orders")).orders });
  const awaiting = useMemo(() => orders.data?.filter((o) => o.status === "awaiting_verification") ?? [], [orders.data]);
  const home = lang === "en" ? "/en" : "";

  return (
    <>
      <div className="page-head">
        <h1>{t("app.learning.title")}</h1>
        <p>{student ? t("app.learning.hello", { name: student.name.split(" ")[0] }) : ""} {t("app.learning.sub")}</p>
      </div>

      {awaiting.map((o) => (
        <Link key={o.public_id} to={`/orders/${o.public_id}`} className="notice">
          <Icon name="clock" />
          <div>
            <b>{t("app.learning.pendingPay")}</b>
            <p>{o.items.map((i) => pick(i, "title")).join(", ")} — {t("app.learning.pendingPayBody")}</p>
          </div>
        </Link>
      ))}

      {courses.isPending && (
        <div className="grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      )}
      {courses.isError && <ErrorState error={courses.error} onRetry={() => courses.refetch()} />}
      {courses.data?.length === 0 && (
        <Empty icon="book" title={t("app.learning.empty.title")}>
          <p>{t("app.learning.empty.body")}</p>
          <a className="btn btn-gold btn-lg" href={`${home}/courses`}>
            {t("app.nav.browse")}
          </a>
        </Empty>
      )}
      <div className="grid">
        {courses.data?.map((m) => {
          const done = m.progress.pct >= 100;
          const cta = m.resume_lesson_id && m.progress.done > 0 && !done ? `/learn/${m.course.slug}/${m.resume_lesson_id}` : `/learn/${m.course.slug}`;
          return (
            <article key={m.course.id} className={`card course-card ${accentClass(m.course)}`}>
              <Link to={`/learn/${m.course.slug}`} tabIndex={-1} aria-hidden="true">
                <Banner course={m.course} />
              </Link>
              {m.course.category && <span className="chip-cat">{pick(m.course.category, "name")}</span>}
              <div className="card-body">
                <h3 className="card-title">
                  <Link to={`/learn/${m.course.slug}`}>{pick(m.course, "title")}</Link>
                </h3>
                <Progress pct={m.progress.pct} done={done} label={t("app.learning.progress", { done: lang === "bn" ? toBn(m.progress.done) : m.progress.done, total: lang === "bn" ? toBn(m.progress.total) : m.progress.total })} />
                <div className="prog-line">
                  <span>{t("app.learning.progress", { done: lang === "bn" ? toBn(m.progress.done) : m.progress.done, total: lang === "bn" ? toBn(m.progress.total) : m.progress.total })}</span>
                  <b>{lang === "bn" ? toBn(m.progress.pct) : m.progress.pct}%</b>
                </div>
                {m.certificate_code && (
                  <span className="cert-pill">
                    <Icon name="award" /> {t("app.learning.certificate")}
                  </span>
                )}
                <div className="card-foot">
                  <Link className="btn btn-gold" to={cta}>
                    {done ? t("app.learning.review") : m.progress.done > 0 ? t("app.learning.continue") : t("app.learning.start")}
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

const BN = "০১২৩৪৫৬৭৮৯";
const toBn = (n: number) => String(n).replace(/\d/g, (d) => BN[Number(d)]);

/** Lesson to open when the student presses "Resume": first unfinished, unlocked lesson (else the first lesson). */
export function resumeLessonId(curriculum: CurriculumModuleDTO[]): number | null {
  const lessons = curriculum.flatMap((m) => m.lessons);
  const open = (l: (typeof lessons)[number]) => !l.available_at || Date.parse(l.available_at) <= Date.now();
  return lessons.find((l) => !l.completed && open(l))?.id ?? lessons[0]?.id ?? null;
}

export type { CourseStatus };
