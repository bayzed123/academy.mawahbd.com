import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MaterialKind } from "@mawah/shared";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, Field, Icon, TextInput, useToast } from "./ui";

/**
 * Class materials the owner added (Admin → Materials): files to download, links, live classes and private groups.
 * The list carries no address and no file key — a file comes through /download, a link through /open, and both check that
 * the student is enrolled and are recorded. The notice at the top says plainly that these are for the student alone.
 */
export interface StudentMaterial {
  id: number;
  kind: MaterialKind;
  title_bn: string;
  title_en: string;
  note_bn: string;
  note_en: string;
  delivery: "file" | "link";
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
          <li key={m.id}>
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

  const join = useMutation({
    mutationFn: () => api<{ request: { status: "pending" | "approved" | "rejected" }; url: string }>(`/student/materials/${m.id}/join`, { method: "POST", json: { profile_url: profile } }),
    onSuccess: () => {
      setProfileError("");
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

      <div className="mat-actions">
        {m.delivery === "file" ? (
          <a className="btn btn-primary" href={`/api/student/materials/${m.id}/download`} download>
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
