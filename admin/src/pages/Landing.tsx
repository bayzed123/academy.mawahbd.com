import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { emptyBlock, LANDING_BLOCKS, LANDING_MAX_BLOCKS, LANDING_MAX_FAQS, LANDING_MAX_PICTURES, offPercent, type LandingBlock, type LandingBlockType } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { CourseRow, ListResponse } from "../lib/types";
import { ImageField, type FieldDef } from "../components/Form";
import { ResourcePage } from "../components/ResourcePage";
import { Button, Empty, ErrorState, IconButton, SlideOver, Spinner, StatusChip, useConfirm, useToast } from "../components/ui";

/*
 * Admin → Landing pages: as many pages as the owner wants, each at its own address (/l/<address>), built from blocks — a banner, words,
 * pictures, a video, a class with its Enroll button, a price with its saving, questions and answers, reviews, a WhatsApp button. The list
 * holds each page's name, address, search words and whether it is live; "Blocks" opens the page's blocks to add, fill, move and remove.
 */
interface LandingRow {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  status: "draft" | "published";
  block_count: number;
  updated_at: string;
  deleted_at: string | null;
}

export function Landing() {
  const { t, pick, num, date } = useI18n();
  const [editing, setEditing] = useState<LandingRow | null>(null);
  const fields: FieldDef[] = [
    { type: "text", key: "title_bn", label: t("adm.lp.titleBn"), half: true, maxLength: 120 },
    { type: "text", key: "title_en", label: t("adm.lp.titleEn"), half: true, maxLength: 120, hint: t("adm.lp.titleHint") },
    { type: "text", key: "slug", label: t("adm.lp.slug"), half: true, maxLength: 120, placeholder: "eid-offer", hint: t("adm.lp.slugHint") },
    { type: "select", key: "status", label: t("label.status"), half: true, options: (["draft", "published"] as const).map((s) => ({ value: s, label: t(`status.${s}`) })), hint: t("adm.lp.statusHint") },
    { type: "textarea", key: "description_bn", label: t("adm.lp.descBn"), half: true, maxLength: 300, hint: t("adm.lp.descHint") },
    { type: "textarea", key: "description_en", label: t("adm.lp.descEn"), half: true, maxLength: 300 },
  ];
  return (
    <>
      <ResourcePage<LandingRow>
        title={t("adm.nav.landing")}
        sub={t("adm.lp.sub")}
        endpoint="/landing"
        perms={{ write: "landing:write" }}
        fields={fields}
        defaults={{ title_bn: "", title_en: "", slug: "", status: "draft", description_bn: "", description_en: "" }}
        transform={(v) => (v.slug ? v : { ...v, slug: undefined })}
        rowLabel={(r) => r.title_en || r.title_bn || r.slug}
        defaultSort="-updated_at"
        csv={false}
        filters={[{ key: "status", label: t("label.status"), options: (["draft", "published"] as const).map((s) => ({ value: s, label: t(`status.${s}`) })) }]}
        rowActions={(r) => (
          <>
            <IconButton icon="layers" label={t("adm.lp.blocksOf", { name: pick(r, "title") || r.slug })} onClick={() => setEditing(r)} />
            {r.status === "published" && (
              <a className="icon-btn" href={`/l/${r.slug}`} target="_blank" rel="noopener noreferrer" aria-label={t("adm.lp.open", { name: pick(r, "title") || r.slug })} title={t("adm.lp.open", { name: pick(r, "title") || r.slug })}>
                <span aria-hidden="true">↗</span>
              </a>
            )}
          </>
        )}
        columns={[
          { key: "title", label: t("adm.lp.page"), sort: "title_en", render: (r) => <b>{pick(r, "title") || r.slug}</b> },
          { key: "slug", label: t("adm.lp.address"), render: (r) => <code>/l/{r.slug}</code> },
          { key: "blocks", label: t("adm.lp.blocks"), className: "num", render: (r) => num(r.block_count ?? 0) },
          { key: "status", label: t("label.status"), sort: "status", render: (r) => <StatusChip status={r.status} /> },
          { key: "updated_at", label: t("adm.lp.updated"), sort: "updated_at", desktopOnly: true, render: (r) => date(r.updated_at) },
        ]}
      />
      <SlideOver open={!!editing} onClose={() => setEditing(null)} title={editing ? t("adm.lp.blocksOf", { name: pick(editing, "title") || editing.slug }) : ""} wide>
        {editing && <BlocksEditor page={editing} />}
      </SlideOver>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------------- the blocks */
type Errors = Record<string, string>;
/** the block problems the Worker names (services/landing.ts), each said in plain words */
const LP_ERRORS = new Set(["not_found", "list_below_price", "invalid_url", "video_unsupported", "invalid_image", "too_many"]);
type LpError = "not_found" | "list_below_price" | "invalid_url" | "video_unsupported" | "invalid_image" | "too_many";

function BlocksEditor({ page }: { page: LandingRow }) {
  const { t, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const canWrite = can("landing:write");
  const loaded = useQuery({ queryKey: ["landing-blocks", page.id], queryFn: async () => (await adm<{ blocks: LandingBlock[] }>(`/landing/${page.id}/blocks`)).blocks });
  const [blocks, setBlocks] = useState<LandingBlock[] | null>(null);
  const [adding, setAdding] = useState<LandingBlockType>("hero");
  const [errors, setErrors] = useState<Errors>({});
  useEffect(() => {
    if (loaded.data && blocks === null) setBlocks(loaded.data);
  }, [loaded.data, blocks]);
  const save = useMutation({
    mutationFn: () => adm(`/landing/${page.id}/blocks`, { method: "PUT", json: { blocks } }),
    onSuccess: () => {
      setErrors({});
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["/landing"] });
      void qc.invalidateQueries({ queryKey: ["landing-blocks", page.id] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, c]) => [k, c === "required" ? t("err.required") : LP_ERRORS.has(c) ? t(`adm.lp.err.${c as LpError}`) : err(c)])));
      toast(e instanceof ApiError && e.fields ? t("adm.lp.fix") : err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });
  if (loaded.isPending || blocks === null) return loaded.isError ? <ErrorState error={loaded.error} onRetry={() => loaded.refetch()} /> : <Spinner />;
  const set = (i: number, b: LandingBlock) => setBlocks(blocks.map((x, k) => (k === i ? b : x)));
  const move = (i: number, d: -1 | 1) => setBlocks(blocks.toSpliced(i, 1).toSpliced(i + d, 0, blocks[i]));
  const remove = async (i: number) => {
    if (await confirm({ title: t("adm.lp.removeQ", { n: String(i + 1) }), danger: true })) setBlocks(blocks.filter((_, k) => k !== i));
  };
  return (
    <div className="stack lp-editor">
      <p className="muted">{t("adm.lp.blocksHint")}</p>
      {blocks.length === 0 && <Empty icon="layers" title={t("adm.lp.noBlocks")} />}
      {blocks.map((b, i) => (
        <fieldset key={i} className="lp-block-edit" disabled={!canWrite}>
          <legend>
            {i + 1}. {t(`adm.lp.type.${b.type}`)}
          </legend>
          <div className="row lp-block-tools">
            <IconButton icon="up" label={t("adm.lp.up", { n: String(i + 1) })} disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="down" label={t("adm.lp.down", { n: String(i + 1) })} disabled={i === blocks.length - 1} onClick={() => move(i, 1)} />
            <IconButton icon="trash" label={t("adm.lp.remove", { n: String(i + 1) })} onClick={() => void remove(i)} />
          </div>
          <BlockFields block={b} index={i} errors={errors} onChange={(x) => set(i, x)} />
        </fieldset>
      ))}
      {canWrite && (
        <div className="row lp-add">
          <label className="vh" htmlFor="lp-add-type">
            {t("adm.lp.addType")}
          </label>
          <select id="lp-add-type" className="input" value={adding} onChange={(e) => setAdding(e.target.value as LandingBlockType)}>
            {LANDING_BLOCKS.map((k) => (
              <option key={k} value={k}>
                {t(`adm.lp.type.${k}`)}
              </option>
            ))}
          </select>
          <Button className="btn-outline" disabled={blocks.length >= LANDING_MAX_BLOCKS} onClick={() => setBlocks([...blocks, emptyBlock(adding)])}>
            {t("adm.lp.add")}
          </Button>
        </div>
      )}
      {canWrite && (
        <div className="row">
          <Button busy={save.isPending} onClick={() => save.mutate()}>
            {t("btn.save")}
          </Button>
          {page.status === "published" && (
            <a className="btn btn-outline" href={`/l/${page.slug}`} target="_blank" rel="noopener noreferrer">
              {t("adm.lp.view")}
            </a>
          )}
        </div>
      )}
      {page.status !== "published" && <p className="hint">{t("adm.lp.draftHint")}</p>}
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- one block's fields */
function Text({ id, label, value, onChange, max, area, error, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; max: number; area?: boolean; error?: string; hint?: string }) {
  return (
    <label className="lp-field" htmlFor={id}>
      <span>{label}</span>
      {area ? (
        <textarea id={id} className="input" rows={area ? 4 : 2} maxLength={max} value={value} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="input" maxLength={max} value={value} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
      {error ? <small className="err-text">{error}</small> : hint ? <small className="hint">{hint}</small> : null}
    </label>
  );
}

function Money({ id, label, value, onChange, error, hint }: { id: string; label: string; value: number; onChange: (v: number) => void; error?: string; hint?: string }) {
  return (
    <label className="lp-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} className="input" inputMode="numeric" value={value || ""} aria-invalid={error ? true : undefined} onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value.replace(/[^\d]/g, "")) || 0)))} />
      {error ? <small className="err-text">{error}</small> : hint ? <small className="ok-text">{hint}</small> : null}
    </label>
  );
}

function BlockFields({ block, index, errors, onChange }: { block: LandingBlock; index: number; errors: Errors; onChange: (b: LandingBlock) => void }) {
  const { t, pick, money, num } = useI18n();
  const id = (k: string) => `lp-${index}-${k}`;
  const e = (k: string) => errors[`blocks.${index}.${k}`];
  // every block's words come in pairs: Bangla, then English
  const pair = (k: string, label: string, max: number, area = false) => (
    <div className="form-grid">
      <Text id={id(`${k}_bn`)} label={`${label} (${t("adm.lp.bn")})`} max={max} area={area} value={String((block as unknown as Record<string, unknown>)[`${k}_bn`] ?? "")} error={e(`${k}_bn`)} onChange={(v) => onChange({ ...block, [`${k}_bn`]: v } as LandingBlock)} />
      <Text id={id(`${k}_en`)} label={`${label} (${t("adm.lp.en")})`} max={max} area={area} value={String((block as unknown as Record<string, unknown>)[`${k}_en`] ?? "")} error={e(`${k}_en`)} onChange={(v) => onChange({ ...block, [`${k}_en`]: v } as LandingBlock)} />
    </div>
  );
  const courses = useQuery({
    queryKey: ["course-options"],
    queryFn: () => adm<ListResponse<CourseRow>>("/courses?per_page=100&sort=title_en"),
    staleTime: 60_000,
    enabled: block.type === "class" || block.type === "reviews",
  });
  const link = (b: { link: string }) => <Text id={id("link")} label={t("adm.lp.link")} max={500} value={b.link} error={e("link")} hint={t("adm.lp.linkHint")} onChange={(v) => onChange({ ...block, link: v } as LandingBlock)} />;
  switch (block.type) {
    case "hero":
      return (
        <div className="stack">
          <div className="lp-field">
            <label htmlFor={id("image")}>{t("adm.lp.picture")}</label>
            <ImageField id={id("image")} value={block.image_key} folder="banners" maxWidth={1600} wide onChange={(v) => onChange({ ...block, image_key: v })} />
          </div>
          {pair("heading", t("adm.lp.heading"), 120)}
          {pair("text", t("adm.lp.lead"), 300, true)}
          {pair("button", t("adm.lp.button"), 40)}
          {link(block)}
        </div>
      );
    case "text":
      return (
        <div className="stack">
          {pair("heading", t("adm.lp.heading"), 120)}
          {pair("body", t("adm.lp.body"), 8000, true)}
          <p className="hint">{t("adm.markdown.hint")}</p>
        </div>
      );
    case "pictures":
      return (
        <div className="stack">
          {pair("heading", t("adm.lp.heading"), 120)}
          {e("items") && <p className="err-text">{t("adm.lp.needPicture")}</p>}
          {block.items.map((p, n) => (
            <div key={n} className="lp-sub">
              <label htmlFor={id(`pic-${n}`)}>{t("adm.lp.pictureN", { n: num(n + 1) })}</label>
              <ImageField id={id(`pic-${n}`)} value={p.image_key} folder="banners" maxWidth={1400} onChange={(v) => (v ? onChange({ ...block, items: block.items.map((x, k) => (k === n ? { ...x, image_key: v } : x)) }) : onChange({ ...block, items: block.items.filter((_, k) => k !== n) }))} />
              <div className="form-grid">
                <Text id={id(`cap-${n}-bn`)} label={`${t("adm.lp.caption")} (${t("adm.lp.bn")})`} max={160} value={p.caption_bn} onChange={(v) => onChange({ ...block, items: block.items.map((x, k) => (k === n ? { ...x, caption_bn: v } : x)) })} />
                <Text id={id(`cap-${n}-en`)} label={`${t("adm.lp.caption")} (${t("adm.lp.en")})`} max={160} value={p.caption_en} onChange={(v) => onChange({ ...block, items: block.items.map((x, k) => (k === n ? { ...x, caption_en: v } : x)) })} />
              </div>
            </div>
          ))}
          {block.items.length < LANDING_MAX_PICTURES && (
            <div className="lp-field">
              <label htmlFor={id("pic-new")}>{t("adm.lp.addPicture")}</label>
              <ImageField id={id("pic-new")} value={null} folder="banners" maxWidth={1400} onChange={(v) => v && onChange({ ...block, items: [...block.items, { image_key: v, caption_bn: "", caption_en: "" }] })} />
            </div>
          )}
        </div>
      );
    case "video":
      return (
        <div className="stack">
          {pair("heading", t("adm.lp.heading"), 120)}
          <Text id={id("url")} label={t("adm.lp.videoUrl")} max={500} value={block.url} error={e("url")} hint={t("adm.lp.videoHint")} onChange={(v) => onChange({ ...block, url: v })} />
        </div>
      );
    case "class": {
      const course = courses.data?.items.find((c) => c.id === block.course_id);
      const off = course ? offPercent(course.price, block.list_price) : null;
      return (
        <div className="stack">
          <label className="lp-field" htmlFor={id("course")}>
            <span>{t("adm.lp.class")} *</span>
            <select id={id("course")} className="input" value={block.course_id || ""} aria-invalid={e("course_id") ? true : undefined} onChange={(ev) => onChange({ ...block, course_id: Number(ev.target.value) || 0 })}>
              <option value="">{t("adm.lp.chooseClass")}</option>
              {(courses.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c, "title")} · {money(c.price)}
                </option>
              ))}
            </select>
            {e("course_id") && <small className="err-text">{e("course_id")}</small>}
          </label>
          <Money id={id("list")} label={t("adm.lp.listPrice")} value={block.list_price} error={e("list_price")} hint={off ? t("adm.lp.saves", { n: num(off) }) : t("adm.lp.listHint")} onChange={(v) => onChange({ ...block, list_price: v })} />
          {pair("button", t("adm.lp.button"), 40)}
          <p className="hint">{t("adm.lp.classHint")}</p>
        </div>
      );
    }
    case "price": {
      const off = offPercent(block.price, block.list_price);
      return (
        <div className="stack">
          {pair("heading", t("adm.lp.heading"), 120)}
          <div className="form-grid">
            <Money id={id("price")} label={`${t("adm.lp.price")} *`} value={block.price} error={e("price")} onChange={(v) => onChange({ ...block, price: v })} />
            <Money id={id("list")} label={t("adm.lp.listPrice")} value={block.list_price} error={e("list_price")} hint={off ? t("adm.lp.saves", { n: num(off) }) : undefined} onChange={(v) => onChange({ ...block, list_price: v })} />
          </div>
          {pair("note", t("adm.lp.note"), 300, true)}
          {pair("button", t("adm.lp.button"), 40)}
          {link(block)}
        </div>
      );
    }
    case "faq":
      return (
        <div className="stack">
          {pair("heading", t("adm.lp.heading"), 120)}
          {e("items") && <p className="err-text">{t("adm.lp.needQuestion")}</p>}
          {block.items.map((q, n) => {
            const put = (k: keyof typeof q, v: string) => onChange({ ...block, items: block.items.map((x, j) => (j === n ? { ...x, [k]: v } : x)) });
            return (
              <div key={n} className="lp-sub">
                <div className="row">
                  <b>{t("adm.lp.questionN", { n: num(n + 1) })}</b>
                  <IconButton icon="trash" label={t("adm.lp.removeQuestion", { n: num(n + 1) })} onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== n) })} />
                </div>
                {e(`items.${n}`) && <p className="err-text">{t("adm.lp.needBoth")}</p>}
                <div className="form-grid">
                  <Text id={id(`q-${n}-bn`)} label={`${t("adm.lp.question")} (${t("adm.lp.bn")})`} max={300} value={q.question_bn} onChange={(v) => put("question_bn", v)} />
                  <Text id={id(`q-${n}-en`)} label={`${t("adm.lp.question")} (${t("adm.lp.en")})`} max={300} value={q.question_en} onChange={(v) => put("question_en", v)} />
                  <Text id={id(`a-${n}-bn`)} label={`${t("adm.lp.answer")} (${t("adm.lp.bn")})`} max={3000} area value={q.answer_bn} onChange={(v) => put("answer_bn", v)} />
                  <Text id={id(`a-${n}-en`)} label={`${t("adm.lp.answer")} (${t("adm.lp.en")})`} max={3000} area value={q.answer_en} onChange={(v) => put("answer_en", v)} />
                </div>
              </div>
            );
          })}
          {block.items.length < LANDING_MAX_FAQS && (
            <Button className="btn-outline btn-sm" onClick={() => onChange({ ...block, items: [...block.items, { question_bn: "", question_en: "", answer_bn: "", answer_en: "" }] })}>
              {t("adm.lp.addQuestion")}
            </Button>
          )}
        </div>
      );
    case "reviews":
      return (
        <div className="stack">
          {pair("heading", t("adm.lp.heading"), 120)}
          <div className="form-grid">
            <label className="lp-field" htmlFor={id("course")}>
              <span>{t("adm.lp.reviewsOf")}</span>
              <select id={id("course")} className="input" value={block.course_id} onChange={(ev) => onChange({ ...block, course_id: Number(ev.target.value) || 0 })}>
                <option value={0}>{t("adm.lp.allClasses")}</option>
                {(courses.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {pick(c, "title")}
                  </option>
                ))}
              </select>
              {e("course_id") && <small className="err-text">{e("course_id")}</small>}
            </label>
            <label className="lp-field" htmlFor={id("count")}>
              <span>{t("adm.lp.howMany")}</span>
              <select id={id("count")} className="input" value={block.count} onChange={(ev) => onChange({ ...block, count: Number(ev.target.value) })}>
                {[3, 6, 9, 12].map((n) => (
                  <option key={n} value={n}>
                    {num(n)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">{t("adm.lp.reviewsHint")}</p>
        </div>
      );
    case "whatsapp":
      return (
        <div className="stack">
          {pair("heading", t("adm.lp.heading"), 120)}
          {pair("button", t("adm.lp.button"), 40)}
          {pair("message", t("adm.lp.message"), 500, true)}
          <p className="hint">{t("adm.lp.waHint")}</p>
        </div>
      );
  }
}
