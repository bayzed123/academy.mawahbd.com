import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { prepareVideo, sizeLabel, uploadLessonVideo, VideoError, type Prepared, type VideoStep } from "../lib/lessonVideo";
import { Button, Chip, Empty, Icon, Kpi, Panel, Progress, Spinner, useConfirm, useToast } from "./ui";

/*
 * The website's own video storage in the admin (lib/lessonVideo.ts does the work):
 *  - OwnVideo: in a lesson's editor, "Upload video" — made smaller in this browser, then sent; the lesson plays it from then on.
 *  - OwnStorageMover: Admin → Video speed, every Google Drive lesson moved over the same way (read through the website, made smaller,
 *    sent), one after another while the page is open.
 */

type Work = { step: VideoStep } | { done: Prepared & { after: number } } | { error: string } | null;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Asks before leaving the page while a video is being made or sent (it would stop). */
function useKeepOpen(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const stop = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [on]);
}

/** One line for where the work is: reading / making smaller n% / uploading n% / saving. */
function StepLine({ step }: { step: VideoStep }) {
  const { t } = useI18n();
  const pct = step.phase === "shrinking" || step.phase === "uploading" ? step.pct : null;
  const label =
    step.phase === "reading"
      ? t("adm.own.reading")
      : step.phase === "shrinking"
        ? t("adm.own.shrinking", { n: step.pct })
        : step.phase === "uploading"
          ? t("adm.own.uploading", { n: step.pct })
          : t("adm.own.saving");
  return (
    <div className="own-step" role="status">
      <Progress pct={pct ?? (step.phase === "saving" ? 100 : 2)} label={label} />
      <p className="hint">{label}</p>
    </div>
  );
}

function useErrorText() {
  const { t, err } = useI18n();
  return (e: unknown) =>
    e instanceof VideoError ? t(`adm.own.err.${e.message}` as "adm.own.err.not_video") : e instanceof ApiError ? err(e.code) : t("adm.own.err.shrink_failed");
}

/**
 * A lesson's video in our storage. `ensureLesson` saves a lesson that is not saved yet (an upload needs its id); `onChanged` refreshes the
 * editor around it.
 */
export function OwnVideo({ lessonId, bytes, ensureLesson, onChanged }: { lessonId: number | null; bytes: number | null; ensureLesson: () => Promise<number | null>; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const errorText = useErrorText();
  const [work, setWork] = useState<Work>(null);
  const [playing, setPlaying] = useState(false);
  const stop = useRef<AbortController | null>(null);
  const busy = !!work && "step" in work;
  useKeepOpen(busy);
  useEffect(() => () => stop.current?.abort(), []);

  const go = async (file: File | undefined) => {
    if (!file) return;
    const ctl = new AbortController();
    stop.current = ctl;
    setPlaying(false);
    try {
      setWork({ step: { phase: "reading" } });
      const id = lessonId ?? (await ensureLesson());
      if (!id) return setWork(null);
      const ready = await prepareVideo(file, (step) => setWork({ step }), ctl.signal);
      const res = await uploadLessonVideo(id, ready, (step) => setWork({ step }), ctl.signal);
      setWork({ done: { ...ready, after: res.video_bytes } });
      onChanged();
    } catch (e) {
      setWork(isAbort(e) ? null : { error: errorText(e) });
    } finally {
      stop.current = null;
    }
  };

  const remove = async () => {
    const res = await confirm({ title: t("adm.own.remove"), body: t("adm.own.removeBody"), danger: true, confirmLabel: t("adm.own.remove") });
    if (!res.ok || !lessonId) return;
    await adm(`/lessons/${lessonId}/video`, { method: "DELETE" });
    setWork(null);
    setPlaying(false);
    toast(t("adm.saved"));
    onChanged();
  };

  return (
    <div className="own-video field wide">
      <div className="row between">
        <b>
          <Icon name="video" /> {t("adm.own.title")}
        </b>
        {bytes ? <Chip tone="ok">{t("adm.own.stored", { size: sizeLabel(bytes) })}</Chip> : null}
      </div>
      <p className="hint">{t("adm.own.intro")}</p>

      {work && "step" in work ? (
        <>
          <StepLine step={work.step} />
          <p className="hint">{t("adm.own.keepOpen")}</p>
          <Button className="btn-ghost" onClick={() => stop.current?.abort()}>
            {t("adm.own.cancel")}
          </Button>
        </>
      ) : (
        <>
          {work && "done" in work && (
            <p className="ok-text" role="status">
              {work.done.done === "shrunk"
                ? t("adm.own.done", { before: work.done.before ? sizeLabel(work.done.before) : "—", after: sizeLabel(work.done.after), h: Math.min(work.done.width, work.done.height) })
                : work.done.done === "tidied"
                  ? t("adm.own.doneTidied", { after: sizeLabel(work.done.after) })
                  : t("adm.own.doneOriginal", { after: sizeLabel(work.done.after) })}
            </p>
          )}
          {work && "error" in work && (
            <p className="err-text" role="alert">
              {work.error}
            </p>
          )}
          <label className="btn btn-outline own-pick">
            <Icon name="up" /> {bytes ? t("adm.own.replace") : t("adm.own.pick")}
            <input className="vh" type="file" accept="video/*,.mp4,.mov,.mkv,.webm" onChange={(e) => void go(e.target.files?.[0] ?? undefined)} aria-label={bytes ? t("adm.own.replace") : t("adm.own.pick")} />
          </label>
          {bytes && lessonId ? (
            <div className="row">
              <Button className="btn-ghost" onClick={() => setPlaying((p) => !p)}>
                <Icon name="play" /> {t("adm.own.play")}
              </Button>
              <Button className="btn-ghost" onClick={() => void remove()}>
                <Icon name="trash" /> {t("adm.own.remove")}
              </Button>
            </div>
          ) : null}
          {playing && lessonId ? <video className="own-player" src={`/api/admin/lessons/${lessonId}/video/media?t=${bytes}`} controls playsInline preload="metadata" /> : null}
          <p className="hint">{t("adm.own.hint")}</p>
        </>
      )}
    </div>
  );
}

interface StoredLesson {
  id: number;
  course_id: number;
  course_bn: string;
  course_en: string;
  title_bn: string;
  title_en: string;
  drive_url: string | null;
  video_bytes: number;
  stored: boolean;
  duration_sec: number;
}
interface Storage {
  lessons: StoredLesson[];
  stored: number;
  bytes: number;
}

/** Can this browser make videos (WebCodecs)? Chrome and Edge on a computer can. */
const canMakeVideos = () => typeof window !== "undefined" && "VideoEncoder" in window && "VideoDecoder" in window;

/**
 * Admin → Video speed, first panel: our own storage. Every lesson that plays from Google Drive is moved over, one after another, while the
 * page is open: read through the website (/api/admin/drive/media), made smaller, sent, switched. A lesson that fails is said so, with
 * why, and the rest carry on; pressing the button again takes up the ones not moved yet.
 */
export function OwnStorageMover() {
  const { t, pick, num } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const canWrite = can("courses:write");
  const q = useQuery({ queryKey: ["video-storage"], queryFn: () => adm<Storage>("/video-storage") });
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<{ id: number; step: VideoStep } | null>(null);
  const [failures, setFailures] = useState<Record<number, string>>({});
  const stop = useRef<AbortController | null>(null);
  useKeepOpen(running);
  useEffect(() => () => stop.current?.abort(), []);

  if (q.isPending) return <Spinner />;
  if (q.isError || !q.data) return null;
  const d = q.data;
  const waiting = d.lessons.filter((l) => !l.stored && l.drive_url);

  const moveOne = async (l: StoredLesson, ctl: AbortController) => {
    setCurrent({ id: l.id, step: { phase: "reading" } });
    const src = `/api/admin/drive/media?url=${encodeURIComponent(l.drive_url!)}`;
    const ready = await prepareVideo(src, (step) => setCurrent({ id: l.id, step }), ctl.signal);
    await uploadLessonVideo(l.id, ready, (step) => setCurrent({ id: l.id, step }), ctl.signal);
  };

  const run = async (list: StoredLesson[]) => {
    const ctl = new AbortController();
    stop.current = ctl;
    setRunning(true);
    for (const l of list) {
      if (ctl.signal.aborted) break;
      try {
        await moveOne(l, ctl);
        setFailures((f) => {
          const { [l.id]: _gone, ...rest } = f;
          return rest;
        });
      } catch (e) {
        if (isAbort(e)) break;
        setFailures((f) => ({ ...f, [l.id]: errorText(e) }));
      }
      await qc.invalidateQueries({ queryKey: ["video-storage"] });
    }
    setCurrent(null);
    setRunning(false);
    stop.current = null;
    await qc.invalidateQueries({ queryKey: ["video-storage"] });
  };

  return (
    <Panel title={t("adm.own.vs.title")}>
      <p className="muted">{t("adm.own.vs.body")}</p>
      <section className="kpis" aria-label={t("adm.own.vs.title")}>
        <Kpi icon="check" label={t("adm.own.vs.inStorage")} value={num(d.stored)} sub={sizeLabel(d.bytes)} tone={d.stored > 0 ? "ok" : undefined} />
        <Kpi icon="video" label={t("adm.own.vs.onDrive")} value={num(waiting.length)} sub={t("adm.own.vs.onDriveSub")} tone={waiting.length > 0 ? "warn" : undefined} />
      </section>
      {!canMakeVideos() && (
        <p className="notice warn-note" role="status">
          <Icon name="clock" />
          <span>{t("adm.own.vs.browser")}</span>
        </p>
      )}
      {canWrite && waiting.length > 0 && (
        <div className="row">
          {running ? (
            <Button className="btn-outline" onClick={() => stop.current?.abort()}>
              <Icon name="x" /> {t("adm.own.vs.stop")}
            </Button>
          ) : (
            <Button className="btn-primary" disabled={!canMakeVideos()} onClick={() => void run(waiting)}>
              <Icon name="play" /> {t("adm.own.vs.start", { n: num(waiting.length) })}
            </Button>
          )}
          {running && <span className="hint">{t("adm.own.keepOpen")}</span>}
        </div>
      )}
      {d.lessons.length === 0 ? (
        <Empty icon="video" title={t("adm.own.vs.none")} />
      ) : (
        <ul className="vs-list own-list">
          {d.lessons.map((l) => (
            <li key={l.id} className="vs-row">
              <span className="cell-title">
                <b>{pick(l, "title")}</b>
                <small>{pick({ title_bn: l.course_bn, title_en: l.course_en }, "title")}</small>
              </span>
              {current?.id === l.id ? (
                <StepLine step={current.step} />
              ) : l.stored ? (
                <Chip tone="ok">{t("adm.own.stored", { size: sizeLabel(l.video_bytes) })}</Chip>
              ) : failures[l.id] ? (
                <span className="err-text" role="alert">
                  {failures[l.id]}
                </span>
              ) : (
                <Chip tone="warn">{t("adm.own.vs.waiting")}</Chip>
              )}
              {canWrite && !running && !l.stored && l.drive_url && canMakeVideos() && (
                <Button className="btn-ghost btn-sm" onClick={() => void run([l])}>
                  {t("adm.own.vs.one")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
