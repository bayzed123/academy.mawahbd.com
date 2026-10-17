import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LessonContentDTO } from "@mawah/shared";
import { track } from "../lib/analytics";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, Icon, useToast } from "./ui";

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * A video the website hands on itself (a Google Drive file shared with the website's Google account): the browser's own player on the website's own
 * address — no Google sign-in, no "You need permission". If it cannot start, a plain message and "try again" instead of a black box. A lesson's video
 * loads its first frame at once; a class material's waits until it is pressed (`preload="none"`: a list of videos fetches nothing until one is
 * watched), and says once that it was started (`onFirstPlay`).
 */
export function HostedVideo({ src, title, preload = "metadata", onFirstPlay }: { src: string; title: string; preload?: "metadata" | "none"; onFirstPlay?: () => void }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  // another lesson is another video: forget that the last one failed
  useEffect(() => {
    setFailed(false);
    setStarted(false);
  }, [src]);
  if (failed) {
    return (
      <div className="video-frame is-note">
        <div className="video-note" role="alert">
          <Icon name="play" />
          <p>{t("app.lesson.driveFailed")}</p>
          <Button
            className="btn-gold"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            {t("app.lesson.driveRetry")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="video-frame">
      <video
        key={`${src}#${attempt}`}
        src={src}
        aria-label={title}
        controls
        controlsList="nodownload"
        playsInline
        preload={preload}
        onError={() => setFailed(true)}
        onPlay={() => {
          if (started) return;
          setStarted(true);
          onFirstPlay?.();
        }}
      />
    </div>
  );
}

/** The playable part of a lesson: Stream video (signed iframe), a Drive video the website plays itself, a YouTube/Vimeo embed, or a link-out card. */
export function LessonMedia({ lesson }: { lesson: LessonContentDTO }) {
  const { t, pick } = useI18n();
  const title = pick(lesson, "title");
  if (lesson.type === "video") {
    return (
      <div className="video-frame">
        {lesson.video?.embed_url ? (
          <iframe
            src={lesson.video.embed_url}
            title={title}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin"
          />
        ) : (
          <div className="video-note">
            <Icon name="play" />
            <p>{t("app.lesson.videoUnavailable")}</p>
          </div>
        )}
      </div>
    );
  }
  if (lesson.type === "external" && lesson.external) {
    if (lesson.external.media_url) return <HostedVideo src={lesson.external.media_url} title={title} />;
    // a Google Drive video the website cannot play yet: said plainly, with no link — a student is never sent to the owner's Drive
    if (lesson.external.pending) {
      return (
        <div className="video-frame is-note">
          <div className="video-note" role="status">
            <Icon name="play" />
            <p>{t("app.lesson.drivePending")}</p>
          </div>
        </div>
      );
    }
    return lesson.external.embed_url ? (
      <div className="video-frame">
        <iframe src={lesson.external.embed_url} title={title} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin" />
      </div>
    ) : (
      <div className="panel tc">
        <Icon name="play" className="icon-lg" />
        <p>{t("app.lesson.externalNote")}</p>
        <a className="btn btn-primary btn-lg" href={lesson.external.url} target="_blank" rel="noopener noreferrer">
          {t("app.lesson.externalOpen")}
        </a>
      </div>
    );
  }
  return null;
}

export function LessonBody({ lesson }: { lesson: LessonContentDTO }) {
  const { pick } = useI18n();
  const html = pick(lesson, "body_html");
  // `html` is produced by the server's escape-first Markdown renderer (no raw HTML, allow-listed URL schemes)
  return html ? <div className="prose" dangerouslySetInnerHTML={{ __html: html }} /> : null;
}

export function Downloads({ lesson }: { lesson: LessonContentDTO }) {
  const { t, pick } = useI18n();
  if (lesson.resources.length === 0) return null;
  return (
    <section className="panel">
      <h2>{t("app.lesson.resources")}</h2>
      <ul className="downloads">
        {lesson.resources.map((r) => (
          <li key={r.id}>
            <a href={`/api/student/resources/${r.id}/download`} download onClick={() => track("resource_download", { resource_id: r.id })}>
              <Icon name="download" />
              <span>{pick(r, "title") || r.filename}</span>
              <small>{kb(r.size_bytes)}</small>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Question {
  id: number;
  body: string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  author: string;
  mine: boolean;
}

/** Ask the team a question about this lesson. Answered questions are shared with classmates; pending ones are private. */
export function Questions({ lessonId }: { lessonId: number }) {
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const list = useQuery({
    queryKey: ["questions", lessonId],
    queryFn: async () => (await api<{ questions: Question[] }>(`/student/questions?lesson_id=${lessonId}`)).questions,
  });
  const ask = useMutation({
    mutationFn: () => api("/student/questions", { json: { lesson_id: lessonId, body: text.trim() } }),
    onSuccess: () => {
      setText("");
      track("question_ask", { lesson_id: lessonId }); // that one was asked — never what
      toast(t("app.qa.sent"));
      void qc.invalidateQueries({ queryKey: ["questions", lessonId] });
    },
    onError: () => toast(t("err.generic"), true),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length >= 3) ask.mutate();
  };
  return (
    <section className="panel">
      <h2>{t("app.qa.title")}</h2>
      <form onSubmit={submit} className="mb">
        <label className="vh" htmlFor="qa-text">
          {t("app.qa.ask")}
        </label>
        <textarea id="qa-text" className="input" maxLength={1000} placeholder={t("app.qa.placeholder")} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt">
          <Button type="submit" className="btn-dark" busy={ask.isPending} disabled={text.trim().length < 3}>
            {t("app.qa.ask")}
          </Button>
        </div>
      </form>
      {list.data?.length === 0 && <p className="muted">{t("app.qa.empty")}</p>}
      {list.data?.map((q) => (
        <div className="qa-item" key={q.id}>
          <p className="q">{q.body}</p>
          <div className="meta">
            {q.author} · {date(q.created_at)}
            {q.mine && !q.answer ? ` · ${t("app.qa.waiting")}` : ""}
          </div>
          {q.answer && (
            <p className="a">
              <b>{t("app.qa.teamAnswer")}:</b> {q.answer}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
