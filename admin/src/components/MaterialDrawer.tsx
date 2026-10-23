import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FILE_MATERIAL_KINDS, GROUP_PLATFORMS, LIVE_PLATFORMS, MATERIAL_KINDS, MAX_UPLOAD_MATERIAL_BYTES, type MaterialKind } from "@mawah/shared";
import { adm, ApiError, upload } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { DriveHelp } from "./DriveHelp";
import { VideoLinkHelp } from "./VideoLinkHelp";
import { Button, Field, Icon, Progress, Select, SlideOver, Switch, TextArea, TextInput, useFieldErrors, useToast } from "./ui";

/** A material as the list returns it. */
export interface Material {
  id: number;
  course_id: number;
  kind: MaterialKind;
  title_bn: string;
  title_en: string;
  note_bn: string;
  note_en: string;
  r2_key: string | null;
  filename: string | null;
  mime: string | null;
  size_bytes: number | null;
  url: string | null;
  platform: string | null;
  starts_at: string | null;
  duration_min: number | null;
  ask_profile: number;
  active: number;
  sort: number;
  deleted_at: string | null;
  course_title_bn?: string;
  course_title_en?: string;
  downloads?: number;
  pending_requests?: number;
}

export const KIND_ICON: Record<MaterialKind, string> = { video: "video", pdf: "file", zip: "layers", book: "book", live: "play", link: "link", group: "users" };
export const sizeLabel = (bytes: number | null | undefined) => {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const FILE_KINDS = FILE_MATERIAL_KINDS as readonly MaterialKind[];
const ACCEPT: Record<string, string> = {
  video: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm",
  pdf: "application/pdf,.pdf",
  zip: ".zip,.docx,.xlsx,.pptx,application/zip",
  book: "application/pdf,application/epub+zip,.pdf,.epub",
};
/** The owner types the start time in Bangladesh time (UTC+6, no daylight saving); it is stored as UTC. */
const toBdLocal = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 6 * 3600_000).toISOString().slice(0, 16) : "");
const fromBdLocal = (local: string) => (local ? new Date(`${local}:00+06:00`).toISOString() : null);

interface Draft {
  course_id: string;
  kind: MaterialKind | "";
  title_bn: string;
  title_en: string;
  note_bn: string;
  note_en: string;
  delivery: "file" | "link";
  r2_key: string | null;
  filename: string;
  size_bytes: number;
  url: string;
  platform: string;
  starts_local: string;
  duration_min: string;
  active: boolean;
  sort: string;
}

function draftFrom(row: Material | null, courseId?: string): Draft {
  return {
    course_id: row ? String(row.course_id) : (courseId ?? ""),
    kind: row?.kind ?? "",
    title_bn: row?.title_bn ?? "",
    title_en: row?.title_en ?? "",
    note_bn: row?.note_bn ?? "",
    note_en: row?.note_en ?? "",
    delivery: row ? (row.r2_key ? "file" : FILE_KINDS.includes(row.kind) ? "link" : "file") : "file",
    r2_key: row?.r2_key ?? null,
    filename: row?.filename ?? "",
    size_bytes: row?.size_bytes ?? 0,
    url: row?.url ?? "",
    platform: row?.platform ?? "",
    starts_local: toBdLocal(row?.starts_at ?? null),
    duration_min: row?.duration_min ? String(row.duration_min) : "",
    active: row ? !!row.active : true,
    sort: String(row?.sort ?? 100),
  };
}

/**
 * The form behind "+ Add" in Admin → Materials. First the class, then WHAT is being added — seven cards, each saying in a line what
 * it is — and only then the fields that kind needs: an upload box for a file, an address for a link, a start time for a live class,
 * a group link (and, for Facebook, the profile question) for a private group.
 */
export function MaterialDrawer({ open, row, courseId, classes, onClose }: { open: boolean; row: Material | null; courseId?: string; classes: { value: string; label: string }[]; onClose: () => void }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const [d, setD] = useState<Draft>(() => draftFrom(row, courseId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<Draft>) => setD((s) => ({ ...s, ...patch }));

  // a fresh form each time the drawer is opened
  useEffect(() => {
    if (open) {
      setD(draftFrom(row, courseId));
      setErrors({});
    }
  }, [open, row, courseId]);

  const kind = d.kind;
  const fileKind = kind !== "" && FILE_KINDS.includes(kind);
  const byFile = fileKind && d.delivery === "file";

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        course_id: Number(d.course_id),
        kind,
        title_bn: d.title_bn,
        title_en: d.title_en,
        note_bn: d.note_bn,
        note_en: d.note_en,
        r2_key: byFile ? d.r2_key : null,
        url: byFile ? "" : d.url,
        platform: kind === "live" ? d.platform || "other" : kind === "group" ? d.platform || "facebook" : null,
        starts_at: kind === "live" ? fromBdLocal(d.starts_local) : null,
        duration_min: kind === "live" && d.duration_min ? Number(d.duration_min) : null,
        active: d.active,
        sort: Number(d.sort) || 100,
      };
      return row ? adm(`/materials/${row.id}`, { method: "PATCH", json: payload }) : adm("/materials", { method: "POST", json: payload });
    },
    onSuccess: () => {
      toast(t("adm.saved"));
      onClose();
      void qc.invalidateQueries({ queryKey: ["/materials"] });
      void qc.invalidateQueries({ queryKey: ["course-overview"] });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!(e instanceof ApiError && e.code === "validation")) toast(err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      wide
      title={row ? t("adm.mat.edit") : t("adm.mat.new")}
      footer={
        <div className="row end">
          <Button className="btn-ghost" onClick={onClose}>
            {t("btn.cancel")}
          </Button>
          <Button className="btn-primary" busy={save.isPending} disabled={!d.course_id || !kind} onClick={() => save.mutate()}>
            {t("btn.save")}
          </Button>
        </div>
      }
    >
      <div className="form-grid">
        <Field id="mat-class" label={t("adm.mat.step.class")} error={errors.course_id} wide>
          <Select id="mat-class" value={d.course_id} error={errors.course_id} onChange={(e) => set({ course_id: e.target.value })} disabled={!!row?.r2_key}>
            <option value="">{t("adm.mat.pickClass")}</option>
            {classes.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="type-cards wide">
          <legend>{t("adm.mat.step.kind")}</legend>
          <div className={`cards${kind ? " chosen" : ""}`} role="radiogroup" aria-label={t("adm.mat.step.kind")}>
            {MATERIAL_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={`type-card${kind === k ? " on" : ""}`} onClick={() => set({ kind: k, delivery: row?.r2_key && FILE_KINDS.includes(k) ? "file" : d.delivery })}>
                <span className="ico">
                  <Icon name={KIND_ICON[k]} />
                </span>
                <b>{t(`adm.mat.kind.${k}` as "adm.mat.kind.pdf")}</b>
                <small>{t(`adm.mat.kindHelp.${k}` as "adm.mat.kindHelp.pdf")}</small>
              </button>
            ))}
          </div>
          {kind && <p className="hint kind-help">{t(`adm.mat.kindHelp.${kind}` as "adm.mat.kindHelp.pdf")}</p>}
        </fieldset>

        {kind && (
          <>
            <h3 className="form-section wide">{t("adm.mat.step.details")}</h3>
            <Field id="mat-title-bn" label={t("adm.mat.titleBn")} error={errors.title_bn}>
              <TextInput id="mat-title-bn" value={d.title_bn} maxLength={160} error={errors.title_bn} onChange={(e) => set({ title_bn: e.target.value })} />
            </Field>
            <Field id="mat-title-en" label={t("adm.mat.titleEn")} error={errors.title_en}>
              <TextInput id="mat-title-en" value={d.title_en} maxLength={160} error={errors.title_en} onChange={(e) => set({ title_en: e.target.value })} />
            </Field>

            {fileKind && (
              <fieldset className="seg-field wide">
                <legend>{t("adm.mat.delivery")}</legend>
                <div className="seg" role="radiogroup" aria-label={t("adm.mat.delivery")}>
                  {(["file", "link"] as const).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={d.delivery === v} className={d.delivery === v ? "on" : ""} onClick={() => set({ delivery: v })}>
                      <Icon name={v === "file" ? "download" : "link"} /> {t(`adm.mat.delivery.${v}` as "adm.mat.delivery.file")}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {byFile && kind && (
              <div className="wide">
                <FileBox
                  kind={kind}
                  courseId={d.course_id}
                  value={d.r2_key ? { key: d.r2_key, filename: d.filename, size: d.size_bytes } : null}
                  error={errors.r2_key}
                  onChange={(f) => set({ r2_key: f?.key ?? null, filename: f?.filename ?? "", size_bytes: f?.size ?? 0 })}
                />
              </div>
            )}

            {kind === "live" && (
              <>
                <Field id="mat-platform" label={t("adm.mat.live.platform")} error={errors.platform}>
                  <Select id="mat-platform" value={d.platform || "zoom"} onChange={(e) => set({ platform: e.target.value })}>
                    {LIVE_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {t(`adm.mat.platform.${p}` as "adm.mat.platform.zoom")}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="mat-start" label={t("adm.mat.live.start")} error={errors.starts_at}>
                  <TextInput id="mat-start" type="datetime-local" value={d.starts_local} error={errors.starts_at} onChange={(e) => set({ starts_local: e.target.value })} />
                </Field>
                <Field id="mat-dur" label={t("adm.mat.live.duration")} error={errors.duration_min}>
                  <TextInput id="mat-dur" type="number" inputMode="numeric" min={5} max={720} value={d.duration_min} error={errors.duration_min} onChange={(e) => set({ duration_min: e.target.value })} />
                </Field>
              </>
            )}

            {kind === "group" && (
              <>
                <Field id="mat-gplatform" label={t("adm.mat.group.platform")} error={errors.platform}>
                  <Select id="mat-gplatform" value={d.platform || "facebook"} onChange={(e) => set({ platform: e.target.value })}>
                    {GROUP_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {t(`adm.mat.gplatform.${p}` as "adm.mat.gplatform.facebook")}
                      </option>
                    ))}
                  </Select>
                </Field>
                {(d.platform || "facebook") === "facebook" && (
                  <div className="notice wide">
                    <Icon name="users" />
                    <div>
                      <p>{t("adm.mat.group.fbNote")}</p>
                    </div>
                  </div>
                )}
              </>
            )}

            {!byFile && (
              <Field
                id="mat-url"
                label={kind === "group" ? ((d.platform || "facebook") === "facebook" ? t("adm.mat.group.url.facebook") : t("adm.mat.group.url.other")) : t("adm.mat.url")}
                hint={kind === "group" && (d.platform || "facebook") === "facebook" ? t("adm.mat.group.urlHint.facebook") : t("adm.mat.urlHint")}
                error={errors.url}
                wide
              >
                <TextInput id="mat-url" type="url" inputMode="url" placeholder="https://" value={d.url} error={errors.url} onChange={(e) => set({ url: e.target.value })} />
              </Field>
            )}
            {/* a Google Drive video plays inside the class page once it is shared with the website's Google address: how, and "Check access" */}
            {!byFile && kind !== "group" && <DriveHelp url={d.url} />}
            {!byFile && (kind === "video" || kind === "link") && <VideoLinkHelp url={d.url} asLink={kind === "link"} />}

            <Field id="mat-note-bn" label={t("adm.mat.noteBn")} error={errors.note_bn}>
              <TextArea id="mat-note-bn" rows={2} maxLength={300} value={d.note_bn} error={errors.note_bn} onChange={(e) => set({ note_bn: e.target.value })} />
            </Field>
            <Field id="mat-note-en" label={t("adm.mat.noteEn")} error={errors.note_en}>
              <TextArea id="mat-note-en" rows={2} maxLength={300} value={d.note_en} error={errors.note_en} onChange={(e) => set({ note_en: e.target.value })} />
            </Field>
            <Field id="mat-sort" label={t("adm.mat.sort")} hint={t("adm.f.sortHint")} error={errors.sort}>
              <TextInput id="mat-sort" type="number" inputMode="numeric" min={0} max={99999} value={d.sort} error={errors.sort} onChange={(e) => set({ sort: e.target.value })} />
            </Field>
            <div className="field">
              <Switch checked={d.active} onChange={(v) => set({ active: v })} label={t("adm.mat.shown")} />
              <p className="hint">{t("adm.mat.shownHint")}</p>
            </div>
          </>
        )}
      </div>
    </SlideOver>
  );
}

/* ----------------------------------------------------------------------------------------------- the upload box */
function FileBox({ kind, courseId, value, error, onChange }: { kind: MaterialKind; courseId: string; value: { key: string; filename: string; size: number } | null; error?: string; onChange: (f: { key: string; filename: string; size: number } | null) => void }) {
  const { t, err } = useI18n();
  const [pct, setPct] = useState<number | null>(null);
  const [problem, setProblem] = useState("");
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const maxMb = Math.round(MAX_UPLOAD_MATERIAL_BYTES / (1024 * 1024));

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setProblem("");
    if (!courseId) return setProblem(t("adm.mat.pickClassFirst"));
    if (file.size > MAX_UPLOAD_MATERIAL_BYTES) return setProblem(t("adm.mat.tooBig", { max: maxMb }));
    const ctl = new AbortController();
    abort.current = ctl;
    setPct(0);
    try {
      const res = await upload<{ key: string; filename: string; size_bytes: number }>(`/admin/materials/upload?course_id=${courseId}&name=${encodeURIComponent(file.name)}`, file, { onProgress: setPct, signal: ctl.signal });
      onChange({ key: res.key, filename: res.filename, size: res.size_bytes });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setProblem(err(e instanceof ApiError ? (e.code === "unsupported_file_type" ? "file_type" : e.code) : "generic"));
    } finally {
      setPct(null);
      abort.current = null;
      if (input.current) input.current.value = "";
    }
  };
  const shown = problem || error;
  return (
    <div className={`file-box${shown ? " bad" : ""}`}>
      {pct !== null ? (
        <div className="stack">
          <Progress pct={pct} label={t("adm.mat.uploading", { pct })} />
          <p role="status">{t("adm.mat.uploading", { pct })}</p>
          <Button className="btn-ghost" onClick={() => abort.current?.abort()}>
            {t("adm.mat.cancelUpload")}
          </Button>
        </div>
      ) : value ? (
        <div className="row between">
          <p className="ok-text" role="status">
            <Icon name="check" /> {t("adm.mat.uploaded", { name: value.filename, size: sizeLabel(value.size) })}
          </p>
          <div className="row">
            <label className="btn btn-outline btn-sm">
              {t("adm.mat.replace")}
              <input ref={input} className="vh" type="file" accept={ACCEPT[kind]} onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            <Button className="btn-ghost" onClick={() => onChange(null)}>
              {t("adm.mat.remove")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <label className="drop" htmlFor="mat-file">
            <Icon name="download" />
            <b>{t("adm.mat.upload")}</b>
            <small>{t(`adm.mat.accept.${kind}` as "adm.mat.accept.pdf")}</small>
          </label>
          <input id="mat-file" ref={input} className="vh" type="file" accept={ACCEPT[kind]} onChange={(e) => pick(e.target.files?.[0])} aria-describedby="mat-file-h" />
          <p id="mat-file-h" className="hint">
            {t("adm.mat.fileHint", { max: maxMb })}
          </p>
        </div>
      )}
      {shown && (
        <p className="err-text" role="alert">
          {shown}
        </p>
      )}
    </div>
  );
}
