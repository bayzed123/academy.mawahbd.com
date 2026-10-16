import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { compressImage } from "../lib/image";
import type { ClassPicture } from "../lib/types";
import { Button, Empty, ErrorState, IconButton, Spinner, TextInput, useConfirm, useToast } from "./ui";

/** Sizes of the two copies made in the browser: the large one opens in the viewer, the small one fills the grid (so a phone does not download twelve large files). */
const LARGE = 1600;
const SMALL = 480;

interface Listing {
  items: ClassPicture[];
  max: number;
}

/**
 * Admin → a class → Pictures: more pictures for the class page (the main one is set under Details). Each is shrunk in the browser into a
 * large and a small copy, stored like every other public picture, then added to the class; the owner writes an optional caption in both
 * languages and sets the order. Nothing here is saved by the Details form — every change on this tab is saved by its own button.
 */
export function ClassPictures({ courseId, canWrite }: { courseId: number; canWrite: boolean }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const key = ["course-images", courseId];

  const list = useQuery({ queryKey: key, queryFn: () => adm<Listing>(`/courses/${courseId}/images`) });
  const items = list.data?.items ?? [];
  const max = list.data?.max ?? 12;
  const room = Math.max(0, max - items.length);

  const upload = async (blob: Blob): Promise<string> => (await api<{ key: string }>("/admin/media/image?folder=gallery", { body: blob, contentType: blob.type || "image/webp" })).key;

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const take = files.slice(0, room);
    if (take.length < files.length) toast(t("adm.pics.onlyRoom", { n: String(room), max: String(max) }), true);
    let failed = 0;
    for (let i = 0; i < take.length; i++) {
      setProgress({ i: i + 1, n: take.length });
      try {
        const large = await compressImage(take[i], { maxWidth: LARGE });
        const small = await compressImage(take[i], { maxWidth: SMALL, quality: 0.8 });
        const image_key = await upload(large);
        const thumb_key = small === large ? image_key : await upload(small);
        await adm(`/courses/${courseId}/images`, { json: { image_key, thumb_key: thumb_key === image_key ? undefined : thumb_key, caption_bn: "", caption_en: "" } });
      } catch (e) {
        failed++;
        toast(err(e instanceof ApiError ? (e.code === "unsupported_file_type" ? "file_type" : e.code) : "generic"), true);
        if (e instanceof ApiError && e.code === "gallery_full") break;
      }
    }
    setProgress(null);
    if (fileInput.current) fileInput.current.value = "";
    await qc.invalidateQueries({ queryKey: key });
    if (failed === 0) toast(t("adm.pics.added", { n: String(take.length) }));
  };

  const move = useMutation({
    mutationFn: async (ids: number[]) => adm<{ items: ClassPicture[] }>(`/courses/${courseId}/images/order`, { json: { ids } }),
    onSuccess: (res) => qc.setQueryData<Listing>(key, (old) => (old ? { ...old, items: res.items } : old)),
    onError: (e) => toast(err(e instanceof ApiError ? e.code : "generic"), true),
  });
  const shift = (index: number, by: -1 | 1) => {
    const ids = items.map((p) => p.id);
    const other = index + by;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    move.mutate(ids);
  };

  const remove = async (p: ClassPicture) => {
    const res = await confirm({ title: t("adm.pics.removeTitle"), body: t("adm.pics.removeBody"), confirmLabel: t("btn.delete"), danger: true });
    if (!res.ok) return;
    try {
      await adm(`/courses/${courseId}/images/${p.id}`, { method: "DELETE" });
      toast(t("adm.deleted"));
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast(err(e instanceof ApiError ? e.code : "generic"), true);
    }
  };

  if (list.isPending) return <Spinner />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  return (
    <div className="pics">
      <p className="muted">{t("adm.pics.intro")}</p>

      {canWrite && (
        <div className="uploader">
          <label htmlFor="pics-add" className="label">
            {t("adm.pics.add")}
          </label>
          <input
            id="pics-add"
            ref={fileInput}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/avif"
            disabled={room === 0 || progress !== null}
            onChange={(e) => void addFiles(Array.from(e.target.files ?? []))}
          />
          {progress ? (
            <p className="hint" role="status">
              <span className="spinner sm" aria-hidden="true" /> {t("adm.pics.uploading", { i: String(progress.i), n: String(progress.n) })}
            </p>
          ) : (
            <p className="hint">{room === 0 ? t("adm.pics.full", { max: String(max) }) : t("adm.pics.addHint", { room: String(room), max: String(max) })}</p>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <Empty icon="image" title={t("adm.pics.none")}>
          <p className="muted">{t("adm.pics.noneHint")}</p>
        </Empty>
      ) : (
        <ol className="pic-list">
          {items.map((p, i) => (
            <PictureRow key={p.id} courseId={courseId} item={p} index={i} last={i === items.length - 1} canWrite={canWrite} busy={move.isPending} onShift={shift} onRemove={remove} />
          ))}
        </ol>
      )}
    </div>
  );
}

/** One picture: its small copy, an optional caption in each language (saved with its own button), the order buttons and delete. */
function PictureRow({ courseId, item, index, last, canWrite, busy, onShift, onRemove }: { courseId: number; item: ClassPicture; index: number; last: boolean; canWrite: boolean; busy: boolean; onShift: (index: number, by: -1 | 1) => void; onRemove: (p: ClassPicture) => void }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [bn, setBn] = useState(item.caption_bn);
  const [en, setEn] = useState(item.caption_en);
  const dirty = bn !== item.caption_bn || en !== item.caption_en;

  const save = useMutation({
    mutationFn: () => adm(`/courses/${courseId}/images/${item.id}`, { method: "PATCH", json: { caption_bn: bn.trim(), caption_en: en.trim() } }),
    onSuccess: async () => {
      toast(t("adm.saved"));
      await qc.invalidateQueries({ queryKey: ["course-images", courseId] });
    },
    onError: (e) => toast(err(e instanceof ApiError ? e.code : "generic"), true),
  });

  return (
    <li className="pic-row">
      <img src={`/media/${item.thumb_key ?? item.image_key}`} alt="" width="132" height="99" loading="lazy" />
      <div className="pic-fields">
        <div className="field">
          <label htmlFor={`pic-${item.id}-bn`}>
            {t("adm.pics.capBn")} <span className="muted">({index + 1})</span>
          </label>
          <TextInput id={`pic-${item.id}-bn`} value={bn} maxLength={160} disabled={!canWrite} onChange={(e) => setBn(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`pic-${item.id}-en`}>
            {t("adm.pics.capEn")} <span className="muted">({index + 1})</span>
          </label>
          <TextInput id={`pic-${item.id}-en`} value={en} maxLength={160} disabled={!canWrite} onChange={(e) => setEn(e.target.value)} />
        </div>
        <p className="hint">{t("adm.pics.capHint")}</p>
      </div>
      {canWrite && (
        <div className="pic-actions">
          <Button className="btn-outline" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
            {t("btn.save")}
          </Button>
          <div className="row nowrap">
            <IconButton icon="up" label={`${t("adm.move.up")} (${index + 1})`} disabled={index === 0 || busy} onClick={() => onShift(index, -1)} />
            <IconButton icon="down" label={`${t("adm.move.down")} (${index + 1})`} disabled={last || busy} onClick={() => onShift(index, 1)} />
            <IconButton icon="trash" label={`${t("btn.delete")} (${index + 1})`} onClick={() => onRemove(item)} />
          </div>
        </div>
      )}
    </li>
  );
}
