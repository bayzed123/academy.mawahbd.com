import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { CurriculumLessonDTO, CurriculumModuleDTO, LessonContentDTO, LessonType } from "@mawah/shared";
import { useI18n } from "../lib/i18n";
import { Icon } from "./ui";

const BN = "০১২৩৪৫৬৭৮৯";
const toBn = (n: number) => String(n).replace(/\d/g, (d) => BN[Number(d)]);
const isLocked = (availableAt?: string | null) => !!availableAt && Date.parse(availableAt) > Date.now();
const TYPE_ICON: Record<LessonType, string> = { video: "play", external: "play", text: "text", resource: "download" };

export interface RailLesson extends CurriculumLessonDTO {
  /** 1, 2, 3 … across the whole class (the parts, as the student counts them) */
  part: number;
  module: Pick<CurriculumModuleDTO, "id" | "title_bn" | "title_en">;
}

/** The class's lessons in their order, numbered across the parts. */
export function railLessons(curriculum: CurriculumModuleDTO[]): RailLesson[] {
  let part = 0;
  return curriculum.flatMap((m) => m.lessons.map((l) => ({ ...l, part: ++part, module: { id: m.id, title_bn: m.title_bn, title_en: m.title_en } })));
}

/**
 * The lessons of the class as one row under the video, like a video site's playlist: the one playing is marked and brought into view, a
 * tap opens another, and the row scrolls sideways (a finger, the arrows, or the keyboard). A lesson that opens later shows its date and a
 * lock, and cannot be opened yet.
 */
export function LessonRail({ lessons, slug, currentId }: { lessons: RailLesson[]; slug: string; currentId: number }) {
  const { t, pick, date, duration, lang } = useI18n();
  const rail = useRef<HTMLOListElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  const n = (v: number) => (lang === "bn" ? toBn(v) : String(v));
  const at = lessons.findIndex((l) => l.id === currentId);

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    // right-to-left never happens here (Bangla and English both read left to right)
    setEnds({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  // the lesson playing sits in the middle of the row (only the row scrolls — never the page)
  useLayoutEffect(() => {
    const el = rail.current;
    const item = el?.querySelector<HTMLElement>("[data-current]");
    if (!el || !item) return;
    el.scrollLeft = Math.max(0, item.offsetLeft - (el.clientWidth - item.offsetWidth) / 2);
    measure();
  }, [currentId, measure]);

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const move = (dir: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  if (lessons.length === 0) return null;
  return (
    <section className="rail-box" aria-labelledby="rail-h">
      <div className="rail-head">
        <div>
          <h2 id="rail-h">{t("app.lesson.rail")}</h2>
          {at >= 0 && <p className="rail-count">{t("app.lesson.part", { n: n(at + 1), total: n(lessons.length) })}</p>}
        </div>
        <div className="rail-arrows">
          <button type="button" className="rail-arrow is-back" onClick={() => move(-1)} disabled={ends.start} aria-label={t("app.lesson.railBack")}>
            <Icon name="chevron" />
          </button>
          <button type="button" className="rail-arrow" onClick={() => move(1)} disabled={ends.end} aria-label={t("app.lesson.railOn")}>
            <Icon name="chevron" />
          </button>
        </div>
      </div>
      <ol className="rail" ref={rail}>
        {lessons.map((l) => {
          const locked = isLocked(l.available_at);
          const current = l.id === currentId;
          const time = l.duration_sec > 0 ? duration(l.duration_sec) : "";
          const body = (
            <>
              <span className="rail-thumb" aria-hidden="true">
                <span className="rail-num">{n(l.part)}</span>
                <span className="rail-ico">
                  <Icon name={locked ? "lock" : l.completed && !current ? "check" : TYPE_ICON[l.type] ?? "play"} />
                </span>
                {current ? <span className="rail-now">{t("app.lesson.nowPlaying")}</span> : time ? <span className="rail-dur">{time}</span> : null}
              </span>
              <span className="rail-text">
                <span className="rail-title">
                  {pick(l, "title")}
                  {l.completed && <span className="vh"> ({t("app.lesson.done")})</span>}
                </span>
                <span className="rail-meta">{locked ? t("app.course.locked", { date: date(l.available_at) }) : pick(l.module, "title")}</span>
              </span>
            </>
          );
          return (
            <li key={l.id} className={`rail-item${current ? " is-current" : ""}${l.completed ? " is-done" : ""}${locked ? " is-locked" : ""}`} data-current={current || undefined}>
              {locked ? (
                <span className="rail-card" aria-disabled="true">
                  {body}
                </span>
              ) : (
                <Link className="rail-card" to={`/learn/${slug}/${l.id}`} aria-current={current ? "page" : undefined}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * A lesson's words under the video in a box of their own, folded to a few lines like a video site's description: "Show more" opens it all.
 * A short text has no button. Nothing here pushes the lessons down any more: they come first, right under the video.
 */
export function DescriptionBox({ lesson }: { lesson: LessonContentDTO }) {
  const { t, pick } = useI18n();
  const html = pick(lesson, "body_html");
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // another lesson starts folded again
  useEffect(() => {
    setOpen(false);
  }, [lesson.id]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => setLong(el.scrollHeight > el.clientHeight + 8);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html]);
  if (!html) return null;
  return (
    <section className={`desc-box${open ? " is-open" : ""}${long ? " is-long" : ""}`} aria-labelledby="desc-h">
      <h2 id="desc-h">{t("app.lesson.about")}</h2>
      {/* `html` is produced by the server's escape-first Markdown renderer (no raw HTML, allow-listed URL schemes) */}
      <div className="prose desc-body" id="desc-body" ref={box} dangerouslySetInnerHTML={{ __html: html }} />
      {(long || open) && (
        <button type="button" className="desc-more" aria-expanded={open} aria-controls="desc-body" onClick={() => setOpen((v) => !v)}>
          {open ? t("app.lesson.less") : t("app.lesson.more")}
          <Icon name="chevron" />
        </button>
      )}
    </section>
  );
}
