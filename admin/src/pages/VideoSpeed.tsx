import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, Empty, ErrorState, Icon, Kpi, PageHeader, Panel, Spinner, useConfirm, useToast } from "../components/ui";

type MoveState = "queued" | "copying" | "ready" | "failed" | "undone";
interface DriveLesson {
  id: number;
  course_id: number;
  course_bn: string;
  course_en: string;
  title_bn: string;
  title_en: string;
  on_stream: boolean;
  move: { state: MoveState; problem: string | null; detail: string | null; minutes: number | null; updated_at: string } | null;
}
interface Overview {
  configured: boolean;
  at_once: number;
  blocked: { problem: string; detail?: string; at: string } | null;
  /** the last time Google refused a student's Drive video */
  drive_last: { at: string; problem: string; status: number | null } | null;
  lessons: DriveLesson[];
}

/** Where a lesson stands: still on Drive, waiting, being copied, on Stream, or failed (and why). */
const stateOf = (l: DriveLesson): "drive" | "queued" | "copying" | "stream" | "failed" =>
  l.on_stream ? "stream" : l.move?.state === "queued" ? "queued" : l.move?.state === "copying" ? "copying" : l.move?.state === "failed" ? "failed" : "drive";

/**
 * Admin → Video speed. Lessons whose video plays from Google Drive start late and stop on a phone's internet (the file goes out exactly as
 * it was recorded, often 8 Mbit/s or more). Here they are moved into Cloudflare Stream — one, or all — which plays each one in the quality
 * the student's internet can take. The copying happens on Cloudflare's side, a few at a time; the page follows it while it is open, and each
 * lesson switches to Stream by itself once its copy is ready. "Switch back" returns a lesson to its Drive video.
 */
export function VideoSpeed() {
  const { t, pick, num, dateTime } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const canWrite = can("courses:write");
  const q = useQuery({
    queryKey: ["video-moves"],
    queryFn: () => adm<Overview>("/video-moves"),
    // while copies run, the page asks again (that is also what moves the queue on)
    refetchInterval: (query) => (query.state.data?.lessons.some((l) => l.move?.state === "queued" || l.move?.state === "copying") ? 15_000 : false),
  });
  const done = (data: Overview) => qc.setQueryData(["video-moves"], data);
  const failed = (e: unknown) => toast(e instanceof ApiError && e.code === "stream_not_configured" ? t("adm.vs.notConfigured") : t("err.generic"), true);

  const move = useMutation({
    mutationFn: (which: number[] | "all") => adm<Overview & { queued: number }>("/video-moves", { method: "POST", json: which === "all" ? { all: true } : { lessons: which } }),
    onSuccess: (data) => {
      done(data);
      toast(t("adm.vs.queued", { n: num(data.queued) }));
    },
    onError: failed,
  });
  const undo = useMutation({
    mutationFn: (id: number) => adm<Overview>(`/video-moves/${id}/undo`, { method: "POST", json: {} }),
    onSuccess: (data) => {
      done(data);
      toast(t("adm.vs.undone"));
    },
    onError: failed,
  });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const states = d.lessons.map(stateOf);
  const count = (s: ReturnType<typeof stateOf>) => states.filter((x) => x === s).length;
  const waiting = count("drive") + count("failed");

  const moveAll = async () => {
    const res = await confirm({ title: t("adm.vs.allTitle", { n: num(waiting) }), body: t("adm.vs.allBody"), confirmLabel: t("adm.vs.all") });
    if (res.ok) move.mutate("all");
  };

  return (
    <>
      <PageHeader title={t("adm.nav.videospeed")} sub={t("adm.vs.sub")} />

      {!d.configured ? (
        <p className="notice warn-note" role="status">
          <Icon name="clock" />
          <span>{t("adm.vs.notConfigured")}</span>
        </p>
      ) : d.blocked ? (
        <p className="notice warn-note" role="alert">
          <Icon name="clock" />
          <span>
            {t(`adm.vs.blocked.${d.blocked.problem}` as "adm.vs.blocked.stream_quota")}
            {d.blocked.detail && <small className="vs-detail">{t("adm.vs.said", { text: d.blocked.detail })}</small>}
          </span>
        </p>
      ) : null}

      {d.drive_last && count("drive") + count("failed") > 0 && (
        <p className="notice bad" role="status">
          <Icon name="x" />
          <span>{t(d.drive_last.problem === "quota" ? "adm.vs.driveQuota" : "adm.vs.driveFailed", { when: dateTime(d.drive_last.at) })}</span>
        </p>
      )}

      <section className="kpis" aria-label={t("adm.nav.videospeed")}>
        <Kpi icon="video" label={t("adm.vs.onDrive")} value={num(count("drive"))} sub={t("adm.vs.onDriveSub")} tone={count("drive") > 0 ? "warn" : undefined} />
        <Kpi icon="refresh" label={t("adm.vs.moving")} value={num(count("queued") + count("copying"))} sub={t("adm.vs.movingSub", { n: num(d.at_once) })} />
        <Kpi icon="check" label={t("adm.vs.onStream")} value={num(count("stream"))} sub={t("adm.vs.onStreamSub")} tone={count("stream") > 0 ? "ok" : undefined} />
        <Kpi icon="x" label={t("adm.vs.failed")} value={num(count("failed"))} sub={t("adm.vs.failedSub")} />
      </section>

      <Panel title={t("adm.vs.why")}>
        <p className="muted">{t("adm.vs.whyBody")}</p>
        <p className="muted">{t("adm.vs.cost")}</p>
        {canWrite && d.configured && waiting > 0 && (
          <div className="row">
            <Button className="btn-primary" busy={move.isPending} onClick={() => void moveAll()}>
              <Icon name="play" /> {t("adm.vs.allBtn", { n: num(waiting) })}
            </Button>
          </div>
        )}
      </Panel>

      <Panel title={t("adm.vs.list")}>
        {d.lessons.length === 0 ? (
          <Empty icon="video" title={t("adm.vs.none")}>
            <p>{t("adm.vs.noneBody")}</p>
          </Empty>
        ) : (
          <ul className="vs-list">
            {d.lessons.map((l, i) => {
              const s = states[i];
              const name = pick(l, "title");
              return (
                <li key={l.id} className="vs-row">
                  <Link to={`/courses/${l.course_id}`} className="cell-title">
                    <b>{name}</b>
                    <small>{pick({ title_bn: l.course_bn, title_en: l.course_en }, "title")}</small>
                  </Link>
                  <span className="vs-state">
                    {s === "stream" ? (
                      <Chip tone="ok">
                        {t("adm.vs.s.stream")}
                        {l.move?.minutes ? ` · ${t("adm.vs.minutes", { n: num(l.move.minutes) })}` : ""}
                      </Chip>
                    ) : s === "copying" ? (
                      <Chip tone="info">{t("adm.vs.s.copying")}</Chip>
                    ) : s === "queued" ? (
                      <Chip>{t("adm.vs.s.queued")}</Chip>
                    ) : s === "failed" ? (
                      <Chip tone="bad">{t("adm.vs.s.failed")}</Chip>
                    ) : (
                      <Chip tone="warn">{t("adm.vs.s.drive")}</Chip>
                    )}
                    {s === "failed" && l.move?.problem && <small className="vs-why">{t(`adm.vs.p.${l.move.problem}` as "adm.vs.p.stream_error")}</small>}
                    {s === "failed" && l.move?.detail && <small className="vs-detail">{t("adm.vs.said", { text: l.move.detail })}</small>}
                  </span>
                  {canWrite && d.configured && (
                    <span className="vs-act">
                      {s === "drive" || s === "failed" ? (
                        <Button className="btn-outline btn-sm" busy={move.isPending && move.variables !== "all" && move.variables?.[0] === l.id} onClick={() => move.mutate([l.id])} aria-label={`${t("adm.vs.move")} — ${name}`}>
                          {s === "failed" ? t("adm.vs.retry") : t("adm.vs.move")}
                        </Button>
                      ) : (
                        <Button className="btn-ghost btn-sm" busy={undo.isPending && undo.variables === l.id} onClick={() => undo.mutate(l.id)} aria-label={`${t("adm.vs.back")} — ${name}`}>
                          {t("adm.vs.back")}
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
