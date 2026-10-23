import { percentOff } from "@mawah/shared";
import { useI18n } from "../lib/i18n";
import { Button, IconButton } from "./ui";

/** One weight or size of a product, as the editor holds it (stock "" = not counted). */
export interface VariantDraft {
  id?: number;
  label_bn: string;
  label_en: string;
  price: number | "";
  list_price: number | "";
  stock: number | "";
  sku: string;
}

export const emptyVariant = (): VariantDraft => ({ label_bn: "", label_en: "", price: "", list_price: "", stock: "", sku: "" });

/** From the API's rows (stock null = not counted) to the editor's. */
export const toDrafts = (rows: unknown): VariantDraft[] =>
  Array.isArray(rows) && rows.length
    ? rows.map((r: { id: number; label_bn: string; label_en: string; price: number; list_price: number; stock: number | null; sku: string }) => ({
        id: r.id,
        label_bn: r.label_bn,
        label_en: r.label_en,
        price: r.price,
        list_price: r.list_price || "",
        stock: r.stock ?? "",
        sku: r.sku,
      }))
    : [emptyVariant()];

/** From the editor's rows to what the API takes. */
export const fromDrafts = (rows: VariantDraft[]) =>
  rows.map((r) => ({
    ...(r.id ? { id: r.id } : {}),
    label_bn: r.label_bn.trim(),
    label_en: r.label_en.trim(),
    price: r.price === "" ? 0 : Number(r.price),
    list_price: r.list_price === "" ? 0 : Number(r.list_price),
    stock: r.stock === "" ? null : Number(r.stock),
    sku: r.sku.trim(),
  }));

/**
 * Admin → Shop → a product → "Weights / sizes and prices": one row per weight ("500 g", "1 kg") or size, each with its price, the usual
 * price (shown struck through with the "% off" the buyer saves), how many are in stock (empty = not counted) and an optional code.
 */
export function VariantsEditor({ value, onChange, errors }: { value: VariantDraft[]; onChange: (v: VariantDraft[]) => void; errors?: Record<string, string> }) {
  const { t, num } = useI18n();
  const set = (i: number, patch: Partial<VariantDraft>) => onChange(value.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const n = (s: string): number | "" => (s.trim() === "" ? "" : Math.max(0, Math.floor(Number(s) || 0)));
  return (
    <div className="variants-editor">
      {value.map((r, i) => {
        const off = r.price !== "" && r.list_price !== "" ? percentOff(Number(r.price), Number(r.list_price)) : null;
        const e = (k: string) => errors?.[`variants.${i}.${k}`];
        return (
          <fieldset key={r.id ?? `new-${i}`} className="variant-row">
            <legend>{t("adm.shop.variant", { n: num(i + 1) })}</legend>
            <label>
              <span>{t("adm.shop.vLabelBn")}</span>
              <input className="input" value={r.label_bn} maxLength={60} placeholder="৫০০ গ্রাম" onChange={(ev) => set(i, { label_bn: ev.target.value })} />
            </label>
            <label>
              <span>{t("adm.shop.vLabelEn")}</span>
              <input className="input" value={r.label_en} maxLength={60} placeholder="500 g" aria-invalid={e("label_en") ? true : undefined} onChange={(ev) => set(i, { label_en: ev.target.value })} />
              {e("label_en") && <small className="err-text">{e("label_en")}</small>}
            </label>
            <label>
              <span>{t("adm.shop.price")} *</span>
              <input className="input" inputMode="numeric" value={r.price} aria-invalid={e("price") ? true : undefined} onChange={(ev) => set(i, { price: n(ev.target.value) })} />
              {e("price") && <small className="err-text">{e("price")}</small>}
            </label>
            <label>
              <span>{t("adm.shop.listPrice")}</span>
              <input className="input" inputMode="numeric" value={r.list_price} aria-invalid={e("list_price") ? true : undefined} onChange={(ev) => set(i, { list_price: n(ev.target.value) })} />
              {e("list_price") ? <small className="err-text">{e("list_price")}</small> : off ? <small className="ok-text">{t("adm.shop.saves", { n: num(off) })}</small> : null}
            </label>
            <label>
              <span>{t("adm.shop.stock")}</span>
              <input className="input" inputMode="numeric" value={r.stock} placeholder={t("adm.shop.stockAny")} onChange={(ev) => set(i, { stock: n(ev.target.value) })} />
            </label>
            <label>
              <span>{t("adm.shop.sku")}</span>
              <input className="input" value={r.sku} maxLength={60} onChange={(ev) => set(i, { sku: ev.target.value })} />
            </label>
            {value.length > 1 && <IconButton icon="trash" label={t("adm.shop.removeVariant", { n: num(i + 1) })} onClick={() => onChange(value.filter((_, k) => k !== i))} />}
          </fieldset>
        );
      })}
      {value.length < 20 && (
        <Button className="btn-outline btn-sm" onClick={() => onChange([...value, emptyVariant()])}>
          {t("adm.shop.addVariant")}
        </Button>
      )}
      <p className="hint">{t("adm.shop.variantsHint")}</p>
    </div>
  );
}
