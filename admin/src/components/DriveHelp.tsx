import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Icon, useToast } from "./ui";

type Problem = "not_configured" | "key_invalid" | "key_rejected" | "api_disabled" | "not_drive_file" | "folder" | "no_access" | "not_video" | "not_downloadable" | "quota" | "network" | "google_error" | "other";
interface Status {
  configured: boolean;
  email: string | null;
  last: { at: string; problem: Problem; status: number | null } | null;
}
type Check =
  | { ready: true; name: string; mime: string; size: number | null; can_download: boolean | null; playable: "likely" | "unsure"; email: string | null }
  | { ready: false; problem: Problem; detail: string | null; status: number | null; email: string | null };

const LOOKS_LIKE_DRIVE = /^\s*https?:\/\/(?:drive|docs|drive\.usercontent)\.google\.com\//i;
const size = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Under the link of a "link" lesson or of a class material, when the link is a Google Drive one: how to make the video play inside the class page
 * (share it with the website's own Google address), a "Check access" button that says — in plain words — whether that worked, and "Play here",
 * which plays the video in this box exactly as a student will get it. Without this the owner could not tell: a video the website cannot read only
 * tells the student it is being prepared (a student is never sent to Drive).
 */
export function DriveHelp({ url }: { url: string }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const canCheck = can("courses:write");
  const isDrive = LOOKS_LIKE_DRIVE.test(url);
  const status = useQuery({ queryKey: ["drive-status"], queryFn: () => adm<Status>("/drive"), enabled: isDrive });
  const [result, setResult] = useState<Check | null>(null);
  // "Play here": the video in this box, as a student will get it (null = not playing; the link it was started for)
  const [playing, setPlaying] = useState<string | null>(null);
  const [playFailed, setPlayFailed] = useState(false);

  // a different link is a different question: the answer to the last one no longer applies, and the video shown is no longer this one
  useEffect(() => {
    setResult(null);
    setPlaying(null);
    setPlayFailed(false);
  }, [url]);

  const check = useMutation({
    mutationFn: () => adm<Check>("/drive/check", { method: "POST", json: { url: url.trim() } }),
    onSuccess: (r) => setResult(r),
    onError: (e) => toast(e instanceof ApiError && e.code === "rate_limited" ? t("err.rate_limited") : t("err.generic"), true),
  });

  if (!isDrive) return null;
  const s = status.data;
  const email = result?.email ?? s?.email ?? null;
  const title = (p: Problem) => t(`adm.drive.p.${p}.title` as "adm.drive.p.other.title");
  const body = (p: Problem) => t(`adm.drive.p.${p}.body` as "adm.drive.p.other.body");
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email ?? "");
      toast(t("adm.drive.copied"));
    } catch {
      /* the address is on the screen to select by hand */
    }
  };

  return (
    <section className="field wide drive-help" aria-labelledby="drive-h">
      <div className="notice">
        <Icon name="video" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b id="drive-h">{t("adm.drive.title")}</b>
          {s && !s.configured ? (
            <>
              <b>{title("not_configured")}</b>
              <p>{t("adm.drive.noKeyBody")}</p>
            </>
          ) : (
            <>
              <p>{t("adm.drive.how")}</p>
              {email && (
                <div className="copy-row">
                  <code className="brk" aria-label={t("adm.drive.email")}>
                    {email}
                  </code>
                  <Button className="btn-outline" onClick={() => void copy()}>
                    {t("adm.drive.copy")}
                  </Button>
                </div>
              )}
              <p className="hint">{t("adm.drive.steps")}</p>
              <p className="hint">{t("adm.drive.noDownload")}</p>
              <p className="hint">{t("adm.drive.formats")}</p>
            </>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <Button className="btn-primary" busy={check.isPending} disabled={!canCheck || !url.trim()} onClick={() => check.mutate()}>
              <Icon name="check" /> {t("adm.drive.check")}
            </Button>
            {canCheck && s?.configured !== false && (
              <Button
                className="btn-outline"
                disabled={!url.trim()}
                aria-expanded={!!playing}
                onClick={() => {
                  setPlayFailed(false);
                  setPlaying(playing ? null : url.trim());
                }}
              >
                <Icon name="play" /> {playing ? t("adm.drive.playClose") : t("adm.drive.play")}
              </Button>
            )}
            {!canCheck && <span className="hint">{t("adm.drive.readonly")}</span>}
          </div>
          <div aria-live="polite">
            {result &&
              (result.ready ? (
                <div className="notice ok-note" style={{ marginTop: 12 }}>
                  <Icon name="check" />
                  <div>
                    <b>{t("adm.drive.ready", { name: result.name })}</b>
                    <p className="hint">{[result.mime, result.size !== null ? size(result.size) : ""].filter(Boolean).join(" · ")}</p>
                    {result.playable === "unsure" && <p>{t("adm.drive.unsure")}</p>}
                  </div>
                </div>
              ) : (
                <div className="notice bad-note" role="alert" style={{ marginTop: 12 }}>
                  <Icon name="x" />
                  <div>
                    <b>{title(result.problem)}</b>
                    <p>{body(result.problem)}</p>
                    {result.detail && (
                      <p className="said">
                        {t("adm.drive.said")}: <q>{result.detail}</q>
                        {result.status ? ` (${result.status})` : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
          </div>
          {playing && (
            <div className="drive-play">
              {playFailed ? (
                <p className="err-text" role="alert">
                  {t("adm.drive.playFailed")}
                </p>
              ) : (
                <>
                  <video
                    src={`/api/admin/drive/media?url=${encodeURIComponent(playing)}`}
                    aria-label={t("adm.drive.playLabel")}
                    controls
                    controlsList="nodownload"
                    playsInline
                    preload="metadata"
                    onError={() => setPlayFailed(true)}
                  />
                  <p className="hint">{t("adm.drive.playHint")}</p>
                </>
              )}
            </div>
          )}
          {s?.last && (
            <p className="hint" style={{ marginTop: 10 }}>
              {t("adm.drive.last")}: {title(s.last.problem)} · {when(s.last.at)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
