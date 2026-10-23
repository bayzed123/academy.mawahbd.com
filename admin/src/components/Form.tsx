import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CLASS_ICONS } from "@mawah/shared";
import { adm, api, ApiError } from "../lib/api";
import { compressImage } from "../lib/image";
import { useI18n } from "../lib/i18n";
import type { CourseRow, ListResponse } from "../lib/types";
import { Button, Field, Icon, Select, Switch, TextArea, TextInput, useToast } from "./ui";
import { fromDrafts, toDrafts, VariantsEditor, type VariantDraft } from "./ShopVariants";

type Common = { key: string; label: string; half?: boolean; hint?: string; required?: boolean; /** show this field only while the form is in a state it applies to (e.g. pop-up settings) */ showIf?: (values: Values) => boolean };
export type FieldDef =
  | (Common & { type: "text" | "url" | "date" | "password"; maxLength?: number; placeholder?: string; nullable?: boolean })
  | (Common & { type: "textarea" | "markdown"; rows?: number; maxLength?: number })
  | (Common & { type: "number"; min?: number; max?: number; nullable?: boolean; suffix?: string })
  | (Common & { type: "select"; options: { value: string; label: string }[]; nullable?: boolean; numeric?: boolean; /** what the empty choice of a nullable menu says (default "—") */ emptyLabel?: string })
  | (Common & { type: "switch" })
  | (Common & { type: "image"; folder: "banners" | "photos" | "blog"; maxWidth: number; /** a wide preview, for banner pictures */ wide?: boolean })
  | (Common & { type: "courses" })
  | (Common & { type: "links" })
  | (Common & { type: "icon" })
  | (Common & { type: "variants" })
  | { type: "section"; key: string; label: string; half?: boolean; hint?: string; required?: boolean; showIf?: (values: Values) => boolean };

export type Values = Record<string, unknown>;

/* ------------------------------------------------------------------------------------------- image upload */
export function ImageField({ value, onChange, folder, maxWidth, id, error, wide }: { value: string | null; onChange: (v: string | null) => void; folder: string; maxWidth: number; id: string; error?: string; wide?: boolean }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressImage(file, { maxWidth });
      const res = await api<{ key: string }>(`/admin/media/image?folder=${folder}`, { body: blob, contentType: blob.type || file.type });
      onChange(res.key);
    } catch (e) {
      toast(err(e instanceof ApiError ? (e.code === "unsupported_file_type" ? "file_type" : e.code) : "generic"), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="image-field">
      <div className={`thumb${wide ? " wide" : ""}`}>{value ? <img src={`/media/${value}`} alt="" /> : <Icon name="sparkle" />}</div>
      <div className="stack">
        <input id={id} type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => pick(e.target.files?.[0])} aria-invalid={error ? true : undefined} />
        <div className="row">
          {busy && <span className="spinner sm" aria-hidden="true" />}
          {value && (
            <Button className="btn-ghost" onClick={() => onChange(null)}>
              {t("btn.delete")}
            </Button>
          )}
        </div>
        <p className="hint">{t("adm.image.hint")}</p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------------------- class multi-select */
export function CourseCheckList({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const { t, pick } = useI18n();
  const [filter, setFilter] = useState("");
  const list = useQuery({
    queryKey: ["course-options"],
    queryFn: () => adm<ListResponse<CourseRow>>("/courses?per_page=100&sort=title_en"),
    staleTime: 60_000,
  });
  const items = (list.data?.items ?? []).filter((c) => !filter || `${c.title_en} ${c.title_bn}`.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="check-list">
      <input className="input" type="search" placeholder={t("btn.search")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("btn.search")} />
      <div className="check-scroll">
        {items.map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={value.includes(c.id)} onChange={() => toggle(c.id)} />
            <span>{pick(c, "title")}</span>
          </label>
        ))}
      </div>
      <p className="hint">{t("adm.selected", { n: value.length })}</p>
    </div>
  );
}

function LinksField({ value, onChange }: { value: { label: string; url: string }[]; onChange: (v: { label: string; url: string }[]) => void }) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<{ label: string; url: string }>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="stack">
      {value.map((l, i) => (
        <div className="row nowrap" key={i}>
          <TextInput placeholder={t("adm.link.label")} value={l.label} maxLength={40} onChange={(e) => set(i, { label: e.target.value })} />
          <TextInput placeholder="https://" value={l.url} onChange={(e) => set(i, { url: e.target.value })} />
          <button type="button" className="icon-btn" aria-label={t("btn.delete")} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Icon name="x" />
          </button>
        </div>
      ))}
      {value.length < 6 && (
        <Button className="btn-outline" onClick={() => onChange([...value, { label: "", url: "" }])}>
          + {t("btn.add")}
        </Button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------------------------- the renderer */
export function FormFields({ fields, values, onChange, errors = {}, idPrefix = "f" }: { fields: FieldDef[]; values: Values; onChange: (key: string, value: unknown) => void; errors?: Record<string, string>; idPrefix?: string }) {
  const { t } = useI18n();
  return (
    <div className="form-grid">
      {fields.map((f) => {
        if (f.showIf && !f.showIf(values)) return null;
        const id = `${idPrefix}-${f.key}`;
        const err = errors[f.key];
        const v = values[f.key];
        if (f.type === "section") {
          return (
            <h3 key={f.key} className="form-section">
              {f.label}
            </h3>
          );
        }
        let control: ReactNode;
        switch (f.type) {
          case "text":
          case "url":
          case "password":
            control = (
              <TextInput
                id={id}
                type={f.type === "password" ? "password" : "text"}
                inputMode={f.type === "url" ? "url" : undefined}
                maxLength={f.maxLength}
                placeholder={f.placeholder}
                value={(v as string | null) ?? ""}
                error={err}
                onChange={(e) => onChange(f.key, f.nullable && e.target.value === "" ? null : e.target.value)}
              />
            );
            break;
          case "date":
            control = <TextInput id={id} type="date" value={((v as string | null) ?? "").slice(0, 10)} error={err} onChange={(e) => onChange(f.key, e.target.value || null)} />;
            break;
          case "textarea":
          case "markdown":
            control = <TextArea id={id} rows={f.rows ?? (f.type === "markdown" ? 8 : 3)} maxLength={f.maxLength} className={f.type === "markdown" ? "mono" : ""} value={(v as string) ?? ""} error={err} onChange={(e) => onChange(f.key, e.target.value)} />;
            break;
          case "number":
            control = (
              <div className="input-suffix">
                <TextInput
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={f.max}
                  value={v === null || v === undefined ? "" : String(v)}
                  error={err}
                  onChange={(e) => onChange(f.key, e.target.value === "" ? (f.nullable ? null : 0) : Number(e.target.value))}
                />
                {f.suffix && <span>{f.suffix}</span>}
              </div>
            );
            break;
          case "select":
            control = (
              <Select
                id={id}
                value={v === null || v === undefined ? "" : String(v)}
                error={err}
                onChange={(e) => onChange(f.key, e.target.value === "" ? null : f.numeric ? Number(e.target.value) : e.target.value)}
              >
                {f.nullable && <option value="">{f.emptyLabel ?? "—"}</option>}
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            );
            break;
          case "switch":
            control = <Switch id={id} checked={!!v} onChange={(x) => onChange(f.key, x)} label={f.label} />;
            return (
              <div key={f.key} className={`field${f.half ? "" : " wide"}`}>
                {control}
                {f.hint && <p className="hint">{f.hint}</p>}
              </div>
            );
          case "image":
            control = <ImageField id={id} value={(v as string | null) ?? null} folder={f.folder} maxWidth={f.maxWidth} wide={f.wide} onChange={(x) => onChange(f.key, x)} error={err} />;
            break;
          case "courses":
            control = <CourseCheckList value={(v as number[]) ?? []} onChange={(x) => onChange(f.key, x)} />;
            break;
          case "links":
            control = <LinksField value={(v as { label: string; url: string }[]) ?? []} onChange={(x) => onChange(f.key, x)} />;
            break;
          case "variants":
            control = <VariantsEditor value={(v as VariantDraft[]) ?? []} onChange={(x) => onChange(f.key, x)} errors={errors} />;
            break;
          case "icon":
            control = (
              <div className="icon-grid" role="radiogroup" aria-label={f.label}>
                {CLASS_ICONS.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={v === n} className={v === n ? "on" : ""} onClick={() => onChange(f.key, n)} title={n}>
                    <Icon name={n} />
                  </button>
                ))}
              </div>
            );
            break;
        }
        return (
          <Field key={f.key} id={id} label={f.required ? `${f.label} *` : f.label} error={err && f.type !== "text" ? err : undefined} hint={f.hint ?? (f.type === "markdown" ? t("adm.markdown.hint") : undefined)} wide={!f.half}>
            {control}
          </Field>
        );
      })}
    </div>
  );
}

/** Build the starting values of a form from field definitions + an existing row (or defaults for a new one). */
export function initialValues(fields: FieldDef[], row: Values | null, defaults: Values): Values {
  const out: Values = { ...defaults };
  if (row) {
    for (const f of fields) {
      if (f.type === "section") continue;
      const raw = row[f.key];
      out[f.key] = f.type === "switch" ? !!raw : f.type === "links" ? parseLinks(raw) : f.type === "variants" ? toDrafts(raw) : (raw ?? (f.type === "courses" ? [] : ""));
      if (f.type === "date" && typeof raw === "string") out[f.key] = raw.slice(0, 10);
      if (f.type === "select" && (f as { numeric?: boolean }).numeric && raw === null) out[f.key] = null;
    }
  }
  return out;
}

/**
 * The JSON sent to the API: only real fields, and an empty optional value (a cleared date, no picture, no
 * level …) travels as null — the server's schemas accept null for "not set" and reject an empty string.
 */
export function toPayload(fields: FieldDef[], values: Values): Values {
  const body: Values = {};
  for (const f of fields) {
    if (f.type === "section") continue;
    const v = values[f.key];
    const optional = f.type === "image" || f.type === "icon" || f.type === "date" || ("nullable" in f && !!f.nullable);
    body[f.key] = f.type === "variants" ? fromDrafts((v as VariantDraft[]) ?? []) : optional && (v === "" || v === undefined) ? null : v;
  }
  return body;
}

function parseLinks(raw: unknown): { label: string; url: string }[] {
  if (Array.isArray(raw)) return raw as { label: string; url: string }[];
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function useFormState(fields: FieldDef[], row: Values | null, defaults: Values) {
  const [values, setValues] = useState<Values>(() => initialValues(fields, row, defaults));
  useEffect(() => {
    setValues(initialValues(fields, row, defaults));
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps
  return [values, (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value })), setValues] as const;
}
