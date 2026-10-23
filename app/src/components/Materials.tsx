import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MaterialKind } from "@mawah/shared";
import { track } from "../lib/analytics";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { HostedVideo } from "./LessonView";
import { Button, Field, Icon, TextInput, useToast } from "./ui";

/**
 * Class materials the owner added (Admin → Materials): files to download, links, live classes and private groups.
 * The list carries no address and no file key — a file comes through /download, a link through /open, and both check that
 * the student is enrolled and are recorded. A video kept in Google Drive plays right in its card (the website hands it on itself),
 * or says it is being prepared — never a link to Drive. The notice at the top says plainly that these are for the student alone.
 */
export interface StudentMaterial {
  id: number;
  kind: MaterialKind;
  title_bn: string;
  title_en: string;
  note_bn: string;
  note_en: string;
  delivery: "file" | "link" | "play" | "pending" | "embed";
  media_url: string | null;
  filename: string | null;
  size_bytes: number | null;
  platform: string | null;
  starts_at: string | null;
  duration_min: number | null;
  ask_profile: boolean;
  request: { status: "pending" | "approved" | "rejected" } | null;
}

export const materialsKey = (slug: string) => ["materials", slug] as const;
/** `enabled` stays false until the class itself has loaded, so a student who is not enrolled never makes this request. */
export function useMaterials(slug: string, enabled = true) {
  return useQuery({ queryKey: materialsKey(slug), queryFn: () => api<{ materials: StudentMaterial[] }>(`/student/courses/${slug}/materials`), enabled, retry: (n, e) => !(e instanceof ApiError) && n < 2 });
}

const ICON: Record<MaterialKind, string> = { video: "video", pdf: "file", zip: "layers", book: "book", live: "play", link: "link", group: "users" };

/** "2.4 MB" / "512 KB" — with Bangla digits and units in Bangla. */
function sizeLabel(bytes: number, lang: "bn" | "en") {
  const mb = bytes / (1024 * 1024);
  const n = (v: number) => new Intl.NumberFormat(lang === "bn" ? "bn-BD" : "en", { maximumFractionDigits: 1 }).format(v);
  return mb >= 1 ? `${n(mb)} ${lang === "bn" ? "এমবি" : "MB"}` : `${n(Math.max(1, Math.round(bytes / 1024)))} ${lang === "bn" ? "কেবি" : "KB"}`;
}

/** upcoming → live (from the start until its length is over; two hours when no length was given) → ended */
function liveState(m: StudentMaterial): "upcoming" | "live" | "ended" {
  const start = Date.parse(m.starts_at ?? "");
  if (Number.isNaN(start)) return "upcoming";
  const now = Date.now();
  if (now < start) return "upcoming";
  return now <= start + (m.duration_min ?? 120) * 60_000 ? "live" : "ended";
}

export function MaterialsSection({ slug, materials }: { slug: string; materials: StudentMaterial[] }) {
  const { t } = useI18n();
  return (
    <section className="panel" id="materials" aria-labelledby="mat-h">
      <h2 id="mat-h">{t("app.mat.title")}</h2>
      <p className="muted">{t("app.mat.sub")}</p>
      <div className="notice mat-notice">
        <Icon name="lock" />
        <div>
          <b>{t("app.mat.notice.title")}</b>
          <p>{t("app.mat.notice")}</p>
        </div>
      </div>
      <ul className="mat-grid">
        {materials.map((m) => (
          <li key={m.id} className={m.delivery === "play" || m.delivery === "pending" || m.delivery === "embed" ? "mat-wide" : undefined}>
            <MaterialCard slug={slug} m={m} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MaterialCard({ slug, m }: { slug: string; m: StudentMaterial }) {
  const { t, pick, dateTime, lang, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const title = pick(m, "title");
  const note = pick(m, "note");
  const [profile, setProfile] = useState("");
  const [profileError, setProfileError] = useState("");
  const [fallback, setFallback] = useState<string | null>(null);
  // a YouTube or Vimeo video: its player, once the student pressed "Watch video" (null = not started yet)
  const [embed, setEmbed] = useState<string | null>(null);

  /** The address comes from the server (after the enrolment check); the tab is opened now, inside the click, so a pop-up blocker allows it. */
  const open = useMutation({
    mutationFn: async () => {
      const tab = window.open("about:blank", "_blank");
      try {
        const { url } = await api<{ url: string }>(`/student/materials/${m.id}/open`, { method: "POST", json: {} });
        return { url, tab };
      } catch (e) {
        tab?.close();
        throw e;
      }
    },
    onSuccess: ({ url, tab }) => {
      track("material_open", { material_id: m.id, material_type: m.kind });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        setFallback(url); // the browser refused to open a tab: show the link instead
        toast(t("app.mat.popup"), true);
      }
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });

  /** A YouTube, Vimeo or Facebook video plays here, in that site's own player: "open" gives its address (and records it), and no tab is opened. */
  const watch = useMutation({
    mutationFn: () => api<{ url: string; embed_url: string | null }>(`/student/materials/${m.id}/open`, { method: "POST", json: {} }),
    onSuccess: (r) => {
      track("material_open", { material_id: m.id, material_type: m.kind });
      // started at once, as it was pressed (Facebook's player takes autoplay=true, the others autoplay=1)
      if (r.embed_url) setEmbed(`${r.embed_url}${r.embed_url.includes("?") ? "&" : "?"}autoplay=${r.embed_url.startsWith("https://www.facebook.com/") ? "true" : "1"}`);
      else setFallback(r.url); // cannot be played here after all: the link, to open by hand
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });

  // a Drive video was started: recorded like an opened link (who watched what is in Admin → Materials)
  const played = useMutation({
    mutationFn: () => api(`/student/materials/${m.id}/play`, { method: "POST", json: {} }),
    onSuccess: () => track("material_open", { material_id: m.id, material_type: m.kind }),
  });

  const join = useMutation({
    mutationFn: () => api<{ request: { status: "pending" | "approved" | "rejected" }; url: string }>(`/student/materials/${m.id}/join`, { method: "POST", json: { profile_url: profile } }),
    onSuccess: () => {
      setProfileError("");
      track("material_join_request", { material_id: m.id });
      toast(t("app.mat.group.sent"));
      void qc.invalidateQueries({ queryKey: materialsKey(slug) });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "validation") setProfileError(e.fields?.profile_url === "required" ? t("app.mat.group.err.required") : t("app.mat.group.err.facebook"));
      else toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true);
    },
  });

  const live = m.kind === "live" ? liveState(m) : null;
  const meta =
    m.delivery === "file"
      ? [m.filename, m.size_bytes ? sizeLabel(m.size_bytes, lang) : null].filter(Boolean).join(" · ")
      : m.kind === "live" && m.starts_at
        ? t("app.mat.when", { when: dateTime(m.starts_at) })
        : "";

  return (
    <article className={`mat-card mat-${m.kind}`}>
      <div className="mat-head">
        <span className="mat-ico" aria-hidden="true">
          <Icon name={ICON[m.kind]} />
        </span>
        <div>
          <p className="mat-kind">{t(`app.mat.kind.${m.kind}` as "app.mat.kind.pdf")}</p>
          <h3 className="mat-title">{title}</h3>
        </div>
        {live && <span className={`mat-chip ${live}`}>{t(`app.mat.live.${live}` as "app.mat.live.live")}</span>}
      </div>
      {note && <p className="mat-note">{note}</p>}
      {meta && <p className="mat-meta">{meta}</p>}

      {m.delivery === "play" && m.media_url ? (
        <HostedVideo src={m.media_url} title={title} preload="none" onFirstPlay={() => played.mutate()} />
      ) : m.delivery === "pending" ? (
        // a Google Drive video the website cannot play yet: said plainly, with no link — a student is never sent to the owner's Drive
        <div className="video-frame is-note">
          <div className="video-note" role="status">
            <Icon name="play" />
            <p>{t("app.lesson.drivePending")}</p>
          </div>
        </div>
      ) : m.delivery === "embed" && embed ? (
        <div className="video-frame">
          <iframe src={embed} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin" />
        </div>
      ) : (
        <div className="mat-actions">
          {m.delivery === "embed" ? (
            <Button className="btn-primary" busy={watch.isPending} onClick={() => watch.mutate()}>
              <Icon name="play" /> {t("app.mat.watch")}
              <span className="vh">: {title}</span>
            </Button>
          ) : m.delivery === "file" ? (
            <a className="btn btn-primary" href={`/api/student/materials/${m.id}/download`} download onClick={() => track("material_download", { material_id: m.id, material_type: m.kind })}>
              <Icon name="download" /> {t("app.mat.download")}
              <span className="vh">: {title}</span>
            </a>
          ) : m.kind === "group" ? (
            <GroupActions m={m} profile={profile} setProfile={setProfile} profileError={profileError} join={join} open={open} />
          ) : (
            <Button className="btn-primary" busy={open.isPending} onClick={() => open.mutate()}>
              <Icon name={m.kind === "live" ? "play" : "external"} /> {m.kind === "live" ? t("app.mat.joinLive") : m.kind === "video" ? t("app.mat.watch") : t("app.mat.openLink")}
              <span className="vh">: {title}</span>
            </Button>
          )}
          {fallback && (
            <a className="btn btn-outline" href={fallback} target="_blank" rel="noopener noreferrer">
              {t("app.mat.openHere")}
            </a>
          )}
        </div>
      )}
    </article>
  );
}

function GroupActions({
  m,
  profile,
  setProfile,
  profileError,
  join,
  open,
}: {
  m: StudentMaterial;
  profile: string;
  setProfile: (v: string) => void;
  profileError: string;
  join: { isPending: boolean; mutate: () => void };
  open: { isPending: boolean; mutate: () => void };
}) {
  const { t } = useI18n();
  const [changing, setChanging] = useState(false);
  const asked = m.request;
  const id = `mat-profile-${m.id}`;
  // a group without the profile question (WhatsApp, Telegram): the link opens straight away
  if (!m.ask_profile) {
    return (
      <Button className="btn-primary" busy={open.isPending} onClick={() => open.mutate()}>
        <Icon name="users" /> {t("app.mat.group.open")}
      </Button>
    );
  }
  return (
    <div className="mat-profile">
      {asked && !changing ? (
        <>
          <p className={`notice ${asked.status === "approved" ? "ok" : asked.status === "rejected" ? "bad" : ""}`.trim()} role="status">
            <Icon name={asked.status === "approved" ? "check" : "clock"} />
            <span>{t(`app.mat.group.${asked.status}` as "app.mat.group.pending")}</span>
          </p>
          <div className="row">
            <Button className="btn-primary" busy={open.isPending} onClick={() => open.mutate()}>
              <Icon name="users" /> {t("app.mat.group.open")}
            </Button>
            <Button className="btn-ghost" onClick={() => setChanging(true)}>
              {t("app.mat.group.change")}
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            join.mutate();
            setChanging(false);
          }}
          noValidate
        >
          <p className="hint">{t("app.mat.group.fbHelp")}</p>
          <Field id={id} label={t("app.mat.group.profile")} error={profileError} hint={t("app.mat.group.profileHint")}>
            <TextInput id={id} type="url" inputMode="url" autoComplete="off" placeholder="https://www.facebook.com/your.name" value={profile} error={profileError} onChange={(e) => setProfile(e.target.value)} />
          </Field>
          <div className="row">
            <Button className="btn-primary" type="submit" busy={join.isPending}>
              <Icon name="users" /> {t("app.mat.group.ask")}
            </Button>
            {changing && (
              <Button className="btn-ghost" onClick={() => setChanging(false)}>
                {t("btn.cancel")}
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
