import { useMemo, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { CourseStatus, CurriculumModuleDTO, MyCourseDTO, OrderDTO } from "@mawah/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { KeepAccount } from "../components/KeepAccount";
import { Reveal, stagger } from "../components/motion";
import { accentClass, Banner, Empty, ErrorState, Icon, Progress } from "../components/ui";

export function MyLearning() {
  const { t, lang, pick } = useI18n();
  const { student } = useAuth();
  const courses = useQuery({ queryKey: ["my-courses"], queryFn: async () => (await api<{ courses: MyCourseDTO[] }>("/student/courses")).courses });
  const orders = useQuery({ queryKey: ["orders"], queryFn: async () => (await api<{ orders: OrderDTO[] }>("/student/orders")).orders });
  const awaiting = useMemo(() => orders.data?.filter((o) => o.status === "awaiting_verification") ?? [], [orders.data]);
  // a manual payment that was started and not finished yet (the order page has the payment details and the countdown)
  const unfinished = useMemo(() => orders.data?.filter((o) => o.gateway === "manual" && o.status === "pending" && !!o.pay_by && Date.parse(o.pay_by) > Date.now()) ?? [], [orders.data]);
  const home = lang === "en" ? "/en" : "";
  // paid classes and free classes under two separate buttons; the choice is in the address (?tab=free), so a link can open either one
  const [params, setParams] = useSearchParams();
  const paid = useMemo(() => courses.data?.filter((m) => !m.free) ?? [], [courses.data]);
  const free = useMemo(() => courses.data?.filter((m) => !!m.free) ?? [], [courses.data]);
  const asked = params.get("tab");
  // with nothing asked for, the paid classes — unless the student has only free ones
  const tab: Tab = asked === "free" || asked === "paid" ? asked : paid.length === 0 && free.length > 0 ? "free" : "paid";
  const choose = (next: Tab) =>
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        out.set("tab", next);
        return out;
      },
      { replace: true },
    );
  const shown = tab === "free" ? free : paid;
  const n = (v: number) => (lang === "bn" ? toBn(v) : String(v));

  return (
    <>
      <Reveal className="page-head">
        <h1>{t("app.learning.title")}</h1>
        <p>{student ? t("app.learning.hello", { name: student.name.split(" ")[0] }) : ""} {t("app.learning.sub")}</p>
      </Reveal>

      <KeepAccount />

      {unfinished.map((o) => (
        <Link key={o.public_id} to={`/orders/${o.public_id}`} className="notice">
          <Icon name="wallet" />
          <div>
            <b>{t("app.learning.finishPay")}</b>
            <p>{o.items.map((i) => pick(i, "title")).join(", ")} — {t("app.learning.finishPayBody")}</p>
          </div>
        </Link>
      ))}

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
          <div className="row center">
            <a className="btn btn-primary btn-lg" href={`${home}/courses`}>
              {t("app.nav.browse")}
            </a>
            <a className="btn btn-outline btn-lg" href={`${home}/free-classes`}>
              <Icon name="gift" /> {t("app.learning.free.browse")}
            </a>
          </div>
        </Empty>
      )}
      {!!courses.data?.length && (
        <LearningTabs
          tab={tab}
          onChoose={choose}
          labels={{ paid: t("app.learning.tab.paid"), free: t("app.learning.tab.free") }}
          counts={{ paid: n(paid.length), free: n(free.length) }}
          label={t("app.learning.tabs")}
        />
      )}
      {!!courses.data?.length && shown.length === 0 && (
        <div id={`learning-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          <Empty icon={tab === "free" ? "gift" : "book"} title={t(tab === "free" ? "app.learning.free.empty.title" : "app.learning.paid.empty.title")}>
            <p>{t(tab === "free" ? "app.learning.free.empty.body" : "app.learning.paid.empty.body")}</p>
            <a className="btn btn-primary btn-lg" href={tab === "free" ? `${home}/free-classes` : `${home}/courses`}>
              {tab === "free" ? t("app.learning.free.browse") : t("app.nav.browse")}
            </a>
          </Empty>
        </div>
      )}
      <div className="grid" {...(shown.length ? { id: `learning-${tab}`, role: "tabpanel", "aria-labelledby": `tab-${tab}` } : {})}>
        {shown.map((m, i) => {
          const done = m.progress.pct >= 100;
          const cta = m.resume_lesson_id && m.progress.done > 0 && !done ? `/learn/${m.course.slug}/${m.resume_lesson_id}` : `/learn/${m.course.slug}`;
          return (
            <Reveal key={m.course.id} delay={stagger(i)}>
              <article className={`card course-card ${accentClass(m.course)}`}>
                <Link to={`/learn/${m.course.slug}`} tabIndex={-1} aria-hidden="true">
                  <Banner course={m.course} />
                </Link>
                {m.course.category && <span className="chip-cat">{pick(m.course.category, "name")}</span>}
                {m.free && (
                  <span className="chip-free">
                    <Icon name="gift" /> {t("label.free")}
                  </span>
                )}
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
                    <Link className="btn btn-primary" to={cta}>
                      {done ? t("app.learning.review") : m.progress.done > 0 ? t("app.learning.continue") : t("app.learning.start")}
                    </Link>
                    <Link className="btn btn-outline" to={`/review/${m.course.slug}`}>
                      <Icon name="star" /> {t("app.learning.rate")}
                    </Link>
                  </div>
                </div>
              </article>
            </Reveal>
          );
        })}
      </div>
    </>
  );
}

const BN = "০১২৩৪৫৬৭৮৯";
const toBn = (n: number) => String(n).replace(/\d/g, (d) => BN[Number(d)]);

type Tab = "paid" | "free";
const TABS: Tab[] = ["paid", "free"];

/** "Paid classes" and "Free classes": two buttons (a tab list: the arrow keys move between them, as screen readers expect). */
function LearningTabs({ tab, onChoose, labels, counts, label }: { tab: Tab; onChoose: (t: Tab) => void; labels: Record<Tab, string>; counts: Record<Tab, string>; label: string }) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const at = TABS.indexOf(tab);
    const next = e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[TABS.length - 1] : TABS[(at + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    onChoose(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <div className="learn-tabs" role="tablist" aria-label={label}>
      {TABS.map((x) => (
        <button
          key={x}
          id={`tab-${x}`}
          type="button"
          role="tab"
          aria-selected={tab === x}
          aria-controls={tab === x ? `learning-${x}` : undefined}
          tabIndex={tab === x ? 0 : -1}
          className={`learn-tab${x === "free" ? " is-free" : ""}`}
          onClick={() => onChoose(x)}
          onKeyDown={onKey}
        >
          <Icon name={x === "free" ? "gift" : "book"} />
          <span>{labels[x]}</span>
          <b className="learn-tab-n">{counts[x]}</b>
        </button>
      ))}
    </div>
  );
}

/** Lesson to open when the student presses "Resume": first unfinished, unlocked lesson (else the first lesson). */
export function resumeLessonId(curriculum: CurriculumModuleDTO[]): number | null {
  const lessons = curriculum.flatMap((m) => m.lessons);
  const open = (l: (typeof lessons)[number]) => !l.available_at || Date.parse(l.available_at) <= Date.now();
  return lessons.find((l) => !l.completed && open(l))?.id ?? lessons[0]?.id ?? null;
}

export type { CourseStatus };
