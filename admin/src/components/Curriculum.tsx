import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LESSON_TYPES, MAX_UPLOAD_RESOURCE_BYTES, type LessonType } from "@mawah/shared";
import { adm, api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, Empty, ErrorState, Field, Icon, IconButton, Progress, Select, Spinner, Switch, TextArea, TextInput, useConfirm, SlideOver, useFieldErrors, useToast } from "./ui";
import { DriveHelp } from "./DriveHelp";
import { VideoLinkHelp } from "./VideoLinkHelp";

interface Resource {
  id: number;
  title_bn: string;
  title_en: string;
  filename: string;
  mime: string;
  size_bytes: number;
}
interface Lesson {
  id: number;
  module_id: number;
  title_bn: string;
  title_en: string;
  type: LessonType;
  stream_uid: string | null;
  external_url: string | null;
  duration_sec: number;
  is_preview: number;
  has_body: number;
  sort: number;
  resources: Resource[];
}
interface Module {
  id: number;
  title_bn: string;
  title_en: string;
  sort: number;
  drip_days: number;
  lessons: Lesson[];
}
interface Tree {
  course: { id: number; slug: string; title_en: string; title_bn: string; status: string };
  modules: Module[];
}
interface LessonFull extends Lesson {
  body_bn: string;
  body_en: string;
}

const TYPE_ICON: Record<LessonType, string> = { video: "video", external: "link", text: "text", resource: "file" };
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* ----------------------------------------------------------------------------------------- video uploader */
interface VideoState {
  phase: "idle" | "uploading" | "processing" | "ready" | "error";
  pct: number;
  detail?: string;
}

/**
 * Sends the video straight from the browser to Cloudflare Stream (never through our server), then watches the
 * encoding until the video is playable. The finished video id and duration are handed to the lesson form.
 */
function VideoUploader({ onReady }: { onReady: (uid: string, durationSec: number) => void }) {
  const { t, err } = useI18n();
  const [state, setState] = useState<VideoState>({ phase: "idle", pct: 0 });
  const status = useQuery({ queryKey: ["stream-status"], queryFn: () => adm<{ configured: boolean }>("/media/video/status"), staleTime: 300_000 });
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const poll = (uid: string, tries = 0) => {
    timer.current = window.setTimeout(async () => {
      try {
        const { video } = await adm<{ video: { ready: boolean; state: string; duration: number; pct: number; error: string | null } }>(`/media/video/${uid}`);
        if (video.error) return setState({ phase: "error", pct: 0, detail: video.error });
        if (video.ready) {
          setState({ phase: "ready", pct: 100 });
          return onReady(uid, video.duration);
        }
        setState({ phase: "processing", pct: Math.round(video.pct) });
        if (tries < 400) poll(uid, tries + 1);
      } catch (e) {
        setState({ phase: "error", pct: 0, detail: err(e instanceof ApiError ? e.code : "generic") });
      }
    }, tries === 0 ? 1500 : 5000);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { uploadURL, uid } = await adm<{ uploadURL: string; uid: string }>("/media/video/upload", { json: {} });
      setState({ phase: "uploading", pct: 0 });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadURL);
        xhr.upload.onprogress = (e) => e.lengthComputable && setState({ phase: "uploading", pct: Math.round((e.loaded / e.total) * 100) });
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_${xhr.status}`)));
        xhr.onerror = () => reject(new Error("network"));
        const form = new FormData();
        form.append("file", file);
        xhr.send(form);
      });
      setState({ phase: "processing", pct: 0 });
      poll(uid);
    } catch (e) {
      setState({ phase: "error", pct: 0, detail: e instanceof ApiError ? err(e.code) : t("adm.video.failed") });
    }
  };

  if (status.data && !status.data.configured) {
    return (
      <div className="notice">
        <Icon name="video" />
        <div>
          <b>{t("adm.video.notConnected")}</b>
          <p>{t("adm.video.notConnectedBody")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="uploader">
      <input type="file" accept="video/*" onChange={(e) => upload(e.target.files?.[0])} disabled={state.phase === "uploading" || state.phase === "processing"} aria-label={t("adm.video.upload")} />
      {(state.phase === "uploading" || state.phase === "processing") && (
        <div>
          <Progress pct={state.pct} label={state.phase === "uploading" ? t("adm.video.uploading", { n: state.pct }) : t("adm.video.processing", { n: state.pct })} />
          <p className="hint">{state.phase === "uploading" ? t("adm.video.uploading", { n: state.pct }) : t("adm.video.processing", { n: state.pct })}</p>
        </div>
      )}
      {state.phase === "ready" && <p className="ok-text">{t("adm.video.ready")}</p>}
      {state.phase === "error" && <p className="err-text">{state.detail}</p>}
      <p className="hint">{t("adm.video.hint")}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- lesson drawer */
function LessonDrawer({ courseId, modules, lessonId, moduleId, onClose, onSaved }: { courseId: number; modules: Module[]; lessonId: number | null; moduleId: number; onClose: () => void; onSaved: () => void }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const fieldErrors = useFieldErrors();
  const [id, setId] = useState<number | null>(lessonId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [v, setV] = useState({
    module_id: moduleId,
    title_bn: "",
    title_en: "",
    type: "video" as LessonType,
    stream_uid: "",
    external_url: "",
    body_bn: "",
    body_en: "",
    minutes: 0,
    is_preview: false,
  });
  const [resources, setResources] = useState<Resource[]>([]);
  const loaded = useQuery({
    queryKey: ["lesson-admin", id],
    enabled: !!id,
    queryFn: () => adm<{ lesson: LessonFull; resources: Resource[] }>(`/lessons/${id}`),
  });
  useEffect(() => {
    const data = loaded.data;
    const l = data?.lesson;
    if (!data || !l) return;
    setV({ module_id: l.module_id, title_bn: l.title_bn, title_en: l.title_en, type: l.type, stream_uid: l.stream_uid ?? "", external_url: l.external_url ?? "", body_bn: l.body_bn, body_en: l.body_en, minutes: Math.round(l.duration_sec / 60), is_preview: !!l.is_preview });
    setResources(data.resources);
  }, [loaded.data]);

  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));

  const save = useMutation({
    mutationFn: async (override?: Partial<{ stream_uid: string; duration_sec: number }>) => {
      const body = {
        module_id: v.module_id,
        title_bn: v.title_bn,
        title_en: v.title_en,
        type: v.type,
        stream_uid: v.type === "video" ? (override?.stream_uid ?? v.stream_uid) : "",
        external_url: v.type === "external" ? v.external_url : "",
        body_bn: v.body_bn,
        body_en: v.body_en,
        duration_sec: override?.duration_sec ?? Math.round(v.minutes * 60),
        is_preview: v.is_preview,
      };
      return id ? adm<{ lesson: { id: number } }>(`/lessons/${id}`, { method: "PATCH", json: body }) : adm<{ lesson: { id: number } }>(`/courses/${courseId}/lessons`, { json: body });
    },
    onSuccess: (res) => {
      setErrors({});
      onSaved();
      if (!id) {
        // stay open so files can be attached to the lesson that now exists
        setId(res.lesson.id);
        toast(t("adm.lesson.savedAttach"));
      } else toast(t("adm.saved"));
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast(e instanceof ApiError && e.code !== "validation" ? t("err.generic") : t("err.validation"), true);
    },
  });

  const upload = async (file: File | undefined) => {
    if (!file || !id) return;
    if (file.size > MAX_UPLOAD_RESOURCE_BYTES) return toast(t("err.file_too_large"), true);
    try {
      const res = await api<{ resource: Resource }>(`/admin/lessons/${id}/resources?name=${encodeURIComponent(file.name)}&title_en=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ""))}`, { body: file, contentType: "application/octet-stream" });
      setResources((r) => [...r, res.resource]);
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError && e.code === "unsupported_file_type" ? t("err.file_type") : e instanceof ApiError && e.code === "file_too_large" ? t("err.file_too_large") : t("err.generic"), true);
    }
  };
  const removeResource = async (r: Resource) => {
    const ok = await confirm({ title: t("adm.confirm.delete", { name: r.filename }), danger: true, confirmLabel: t("btn.delete") });
    if (!ok.ok) return;
    await adm(`/resources/${r.id}`, { method: "DELETE" });
    setResources((x) => x.filter((i) => i.id !== r.id));
    onSaved();
  };

  return (
    <SlideOver
      open
      wide
      onClose={onClose}
      title={id ? t("adm.lesson.edit") : t("adm.lesson.new")}
      footer={
        <div className="row end">
          <Button className="btn-ghost" onClick={onClose}>
            {t("btn.close")}
          </Button>
          <Button className="btn-primary" busy={save.isPending} onClick={() => save.mutate(undefined)}>
            {t("btn.save")}
          </Button>
        </div>
      }
    >
      {id && loaded.isPending ? (
        <Spinner />
      ) : (
        <div className="form-grid">
          <Field id="l-title-bn" label={`${t("adm.f.titleBn")} *`} error={errors.title_bn} wide={false}>
            <TextInput id="l-title-bn" value={v.title_bn} maxLength={200} error={errors.title_bn} onChange={(e) => set("title_bn", e.target.value)} />
          </Field>
          <Field id="l-title-en" label={`${t("adm.f.titleEn")} *`} error={errors.title_en}>
            <TextInput id="l-title-en" value={v.title_en} maxLength={200} error={errors.title_en} onChange={(e) => set("title_en", e.target.value)} />
          </Field>
          <Field id="l-type" label={t("adm.lesson.type")} wide>
            <div className="segmented" role="radiogroup" aria-label={t("adm.lesson.type")}>
              {LESSON_TYPES.filter((x) => x !== "resource").map((x) => (
                <button key={x} type="button" role="radio" aria-checked={v.type === x} className={v.type === x ? "on" : ""} onClick={() => set("type", x)}>
                  <Icon name={TYPE_ICON[x]} /> {t(`adm.lesson.type.${x}` as "adm.lesson.type.video")}
                </button>
              ))}
            </div>
          </Field>

          {v.type === "video" && (
            <>
              <Field id="l-uid" label={t("adm.lesson.videoId")} hint={t("adm.lesson.videoIdHint")} error={errors.stream_uid} wide>
                <TextInput id="l-uid" value={v.stream_uid} placeholder="32 hex characters" error={errors.stream_uid} onChange={(e) => set("stream_uid", e.target.value.trim())} />
              </Field>
              <div className="field wide">
                <VideoUploader
                  onReady={(uid, dur) => {
                    set("stream_uid", uid);
                    set("minutes", Math.round(dur / 60));
                    save.mutate({ stream_uid: uid, duration_sec: dur });
                  }}
                />
              </div>
            </>
          )}
          {v.type === "external" && (
            <>
              <Field id="l-url" label={t("adm.lesson.externalUrl")} hint={t("adm.lesson.externalUrlHint")} error={errors.external_url} wide>
                <TextInput id="l-url" inputMode="url" placeholder="https://youtu.be/…" value={v.external_url} error={errors.external_url} onChange={(e) => set("external_url", e.target.value)} />
              </Field>
              <DriveHelp url={v.external_url} />
              <VideoLinkHelp url={v.external_url} />
            </>
          )}

          <Field id="l-min" label={t("adm.lesson.minutes")} error={errors.duration_sec}>
            <div className="input-suffix">
              <TextInput id="l-min" type="number" min={0} max={1440} value={String(v.minutes)} onChange={(e) => set("minutes", Number(e.target.value) || 0)} />
              <span>{t("adm.lesson.min")}</span>
            </div>
          </Field>
          <div className="field">
            <Switch checked={v.is_preview} onChange={(x) => set("is_preview", x)} label={t("adm.lesson.preview")} />
            <p className="hint">{t("adm.lesson.previewHint")}</p>
          </div>
          <Field id="l-module" label={t("adm.lesson.module")}>
            <Select id="l-module" value={String(v.module_id)} onChange={(e) => set("module_id", Number(e.target.value))}>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {pick(m, "title")}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="l-body-bn" label={`${v.type === "text" ? t("adm.lesson.content") : t("adm.lesson.notes")} — বাংলা`} hint={t("adm.markdown.hint")} wide>
            <TextArea id="l-body-bn" rows={v.type === "text" ? 10 : 4} className="mono" value={v.body_bn} onChange={(e) => set("body_bn", e.target.value)} />
          </Field>
          <Field id="l-body-en" label={`${v.type === "text" ? t("adm.lesson.content") : t("adm.lesson.notes")} — English`} wide>
            <TextArea id="l-body-en" rows={v.type === "text" ? 10 : 4} className="mono" value={v.body_en} onChange={(e) => set("body_en", e.target.value)} />
          </Field>

          <div className="field wide">
            <label>{t("adm.lesson.files")}</label>
            {!id ? (
              <p className="hint">{t("adm.lesson.filesAfterSave")}</p>
            ) : (
              <>
                <ul className="files">
                  {resources.map((r) => (
                    <li key={r.id}>
                      <Icon name="file" />
                      <a href={`/api/admin/resources/${r.id}/file`} target="_blank" rel="noopener noreferrer">
                        {r.filename}
                      </a>
                      <small>{kb(r.size_bytes)}</small>
                      <IconButton icon="x" label={t("btn.delete")} onClick={() => removeResource(r)} />
                    </li>
                  ))}
                </ul>
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.zip,.docx,.xlsx,.pptx,.txt,.csv" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} aria-label={t("adm.lesson.addFile")} />
                <p className="hint">{t("adm.lesson.filesHint", { mb: Math.round(MAX_UPLOAD_RESOURCE_BYTES / 1048576) })}</p>
              </>
            )}
          </div>
        </div>
      )}
    </SlideOver>
  );
}

/* ---------------------------------------------------------------------------------------- module drawer */
function ModuleDrawer({ courseId, module: mod, onClose, onSaved }: { courseId: number; module: Module | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const fieldErrors = useFieldErrors();
  const [v, setV] = useState({ title_bn: mod?.title_bn ?? "", title_en: mod?.title_en ?? "", drip_days: mod?.drip_days ?? 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (mod ? adm(`/modules/${mod.id}`, { method: "PATCH", json: v }) : adm(`/courses/${courseId}/modules`, { json: v })),
    onSuccess: () => {
      toast(t("adm.saved"));
      onSaved();
      onClose();
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });
  return (
    <SlideOver
      open
      onClose={onClose}
      title={mod ? t("adm.module.edit") : t("adm.module.new")}
      footer={
        <div className="row end">
          <Button className="btn-ghost" onClick={onClose}>
            {t("btn.cancel")}
          </Button>
          <Button className="btn-primary" busy={save.isPending} onClick={() => save.mutate()}>
            {t("btn.save")}
          </Button>
        </div>
      }
    >
      <div className="form-grid">
        <Field id="m-bn" label={`${t("adm.f.titleBn")} *`} error={errors.title_bn}>
          <TextInput id="m-bn" value={v.title_bn} maxLength={160} error={errors.title_bn} onChange={(e) => setV({ ...v, title_bn: e.target.value })} />
        </Field>
        <Field id="m-en" label={`${t("adm.f.titleEn")} *`} error={errors.title_en}>
          <TextInput id="m-en" value={v.title_en} maxLength={160} error={errors.title_en} onChange={(e) => setV({ ...v, title_en: e.target.value })} />
        </Field>
        <Field id="m-drip" label={t("adm.module.drip")} hint={t("adm.module.dripHint")} wide>
          <div className="input-suffix">
            <TextInput id="m-drip" type="number" min={0} max={730} value={String(v.drip_days)} onChange={(e) => setV({ ...v, drip_days: Number(e.target.value) || 0 })} />
            <span>{t("adm.module.days")}</span>
          </div>
        </Field>
      </div>
    </SlideOver>
  );
}

/* -------------------------------------------------------------------------------------------- the builder */
export function CurriculumBuilder({ courseId }: { courseId: number }) {
  const { t, pick, num } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const canWrite = can("courses:write");
  const [lessonEdit, setLessonEdit] = useState<{ id: number | null; moduleId: number } | null>(null);
  const [moduleEdit, setModuleEdit] = useState<{ module: Module | null } | null>(null);
  const tree = useQuery({ queryKey: ["curriculum", courseId], queryFn: () => adm<Tree>(`/courses/${courseId}/curriculum`) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["curriculum", courseId] });
    void qc.invalidateQueries({ queryKey: ["course", courseId] });
    void qc.invalidateQueries({ queryKey: ["/courses"] });
  };

  const reorder = useMutation({
    mutationFn: (body: { modules?: number[]; lessons?: { module_id: number; ids: number[] }[] }) => adm(`/courses/${courseId}/reorder`, { json: body }),
    onSuccess: refresh,
    onError: () => toast(t("err.generic"), true),
  });

  if (tree.isPending) return <Spinner />;
  if (tree.isError) return <ErrorState error={tree.error} onRetry={() => tree.refetch()} />;
  const modules = tree.data.modules;

  const moveModule = (i: number, dir: -1 | 1) => {
    const ids = modules.map((m) => m.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    reorder.mutate({ modules: ids });
  };
  const moveLesson = (m: Module, i: number, dir: -1 | 1) => {
    const ids = m.lessons.map((l) => l.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    reorder.mutate({ lessons: [{ module_id: m.id, ids }] });
  };
  const removeModule = async (m: Module) => {
    const res = await confirm({ title: t("adm.confirm.delete", { name: pick(m, "title") }), body: t("adm.module.deleteBody", { n: num(m.lessons.length) }), danger: true, confirmLabel: t("btn.delete") });
    if (!res.ok) return;
    await adm(`/modules/${m.id}`, { method: "DELETE" });
    refresh();
  };
  const removeLesson = async (l: Lesson) => {
    const res = await confirm({ title: t("adm.confirm.delete", { name: pick(l, "title") }), body: t("adm.lesson.deleteBody"), danger: true, confirmLabel: t("btn.delete") });
    if (!res.ok) return;
    await adm(`/lessons/${l.id}`, { method: "DELETE" });
    refresh();
  };

  const totalLessons = modules.reduce((a, m) => a + m.lessons.length, 0);

  return (
    <div className="curriculum">
      <div className="row between">
        <p className="muted">{t("adm.curr.sub", { n: num(totalLessons), m: num(modules.length) })}</p>
        {canWrite && (
          <Button className="btn-primary" onClick={() => setModuleEdit({ module: null })}>
            + {t("adm.module.add")}
          </Button>
        )}
      </div>

      {modules.length === 0 && (
        <Empty icon="book" title={t("adm.curr.empty")}>
          <p className="muted">{t("adm.curr.emptyHint")}</p>
        </Empty>
      )}

      {modules.map((m, mi) => (
        <section className="mod" key={m.id}>
          <header>
            <span className="n">{num(mi + 1)}</span>
            <div className="grow">
              <h3>{pick(m, "title")}</h3>
              {m.drip_days > 0 && <Chip tone="gold">{t("adm.module.dripBadge", { n: num(m.drip_days) })}</Chip>}
            </div>
            {canWrite && (
              <div className="row nowrap">
                <IconButton icon="up" label={t("adm.move.up")} disabled={mi === 0} onClick={() => moveModule(mi, -1)} />
                <IconButton icon="down" label={t("adm.move.down")} disabled={mi === modules.length - 1} onClick={() => moveModule(mi, 1)} />
                <IconButton icon="edit" label={t("btn.edit")} onClick={() => setModuleEdit({ module: m })} />
                <IconButton icon="trash" label={t("btn.delete")} onClick={() => removeModule(m)} />
              </div>
            )}
          </header>
          <ul className="lessons">
            {m.lessons.map((l, li) => (
              <li key={l.id}>
                <Icon name={TYPE_ICON[l.type]} />
                <button type="button" className="lesson-title" onClick={() => canWrite && setLessonEdit({ id: l.id, moduleId: m.id })}>
                  {pick(l, "title")}
                </button>
                {l.type === "video" && !l.stream_uid && <Chip tone="warn">{t("adm.lesson.noVideo")}</Chip>}
                {l.type === "external" && !l.external_url && <Chip tone="warn">{t("adm.lesson.noUrl")}</Chip>}
                {!!l.is_preview && <Chip tone="gold">{t("adm.lesson.previewTag")}</Chip>}
                {l.resources.length > 0 && (
                  <Chip>
                    <Icon name="file" className="inline-icon" /> {num(l.resources.length)}
                  </Chip>
                )}
                {l.duration_sec > 0 && <small className="muted">{num(Math.round(l.duration_sec / 60))} {t("adm.lesson.min")}</small>}
                {canWrite && (
                  <span className="row nowrap actions">
                    <IconButton icon="up" label={t("adm.move.up")} disabled={li === 0} onClick={() => moveLesson(m, li, -1)} />
                    <IconButton icon="down" label={t("adm.move.down")} disabled={li === m.lessons.length - 1} onClick={() => moveLesson(m, li, 1)} />
                    <IconButton icon="trash" label={t("btn.delete")} onClick={() => removeLesson(l)} />
                  </span>
                )}
              </li>
            ))}
          </ul>
          {canWrite && (
            <Button className="btn-outline add-lesson" onClick={() => setLessonEdit({ id: null, moduleId: m.id })}>
              + {t("adm.lesson.add")}
            </Button>
          )}
        </section>
      ))}

      {lessonEdit && <LessonDrawer courseId={courseId} modules={modules} lessonId={lessonEdit.id} moduleId={lessonEdit.moduleId} onClose={() => setLessonEdit(null)} onSaved={refresh} />}
      {moduleEdit && <ModuleDrawer courseId={courseId} module={moduleEdit.module} onClose={() => setModuleEdit(null)} onSaved={refresh} />}
    </div>
  );
}
