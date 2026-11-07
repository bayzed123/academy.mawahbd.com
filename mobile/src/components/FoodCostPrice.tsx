import { useState } from "react";
import { View } from "react-native";
import { FC_UNITS, FC_UNIT_LIST, fcParseNumber, fcParseTaka, fcTakaText, type FcIngredientDTO, type FcUnit } from "@mawah/shared/foodcost";
import { api, ApiError } from "../api";
import { errorKey } from "../strings";
import { Btn } from "../ui/Btn";
import { Choice } from "../ui/Choice";
import { Field } from "../ui/Field";
import { Txt } from "../ui/Txt";
import { codeText, say, useFc } from "./FoodCost";

/*
 * A price as it is typed, for Ingredients & prices (app/foodcost/ingredients.tsx) and for a recipe's line (app/foodcost/[id].tsx): one
 * set of boxes, sent the same way, so a price set on a line is the same price as one set on the list.
 */

export type PriceDraft = { qty: string; unit: FcUnit; taka: string; supplier: string };

export const draftOf = (i: FcIngredientDTO | null): PriceDraft => ({
  qty: i?.price ? String(i.price.pack_qty) : "1",
  unit: i?.price?.pack_unit ?? "kg",
  taka: i?.price ? fcTakaText(i.price.price_minor) : "",
  supplier: i?.price?.supplier ?? "",
});

export const priceBody = (d: PriceDraft) => ({ pack_qty: fcParseNumber(d.qty) ?? 0, pack_unit: d.unit, price_minor: fcParseTaka(d.taka) ?? -1, supplier: d.supplier.trim(), bought_on: null });

/** The server's field errors, on the boxes they are about ("price.pack_qty" is the pack box). */
export const fieldsOf = (e: unknown, t: ReturnType<typeof useFc>["t"]) => {
  const out: Record<string, string> = {};
  if (e instanceof ApiError) for (const [k, code] of Object.entries(e.fields)) out[k.replace(/^price\./, "")] = codeText(code, t);
  return out;
};

/** Pack size, unit and price; and where it was bought, except on a recipe's line (`compact`), where only the price matters. */
export function PriceFields({ d, onChange, errors, compact }: { d: PriceDraft; onChange: (d: PriceDraft) => void; errors: Record<string, string>; compact?: boolean }) {
  const { t, unit } = useFc();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Field label={t("fc.pack")} value={d.qty} keyboardType="decimal-pad" onChangeText={(v) => onChange({ ...d, qty: v })} error={errors.pack_qty} box={{ flex: 1 }} />
        <Choice label={t("fc.unit")} value={d.unit} options={FC_UNIT_LIST.map((u) => ({ value: u, label: unit(u) }))} onChange={(u) => onChange({ ...d, unit: u })} box={{ flex: 1 }} />
      </View>
      <Field label={t("fc.priceTk")} value={d.taka} keyboardType="decimal-pad" onChangeText={(v) => onChange({ ...d, taka: v })} error={errors.price_minor} />
      {compact ? null : <Field label={t("fc.supplier")} value={d.supplier} maxLength={80} onChangeText={(v) => onChange({ ...d, supplier: v })} />}
    </View>
  );
}

/** the pack a new price starts with, by how the line is measured: a line in grams gets a price per kg */
const PACK = { mass: "kg", volume: "l", count: "piece" } as const satisfies Record<string, FcUnit>;

/**
 * Under a recipe's line: the price its cost comes from (the Dhaka average or one's own), and one's own price set right there, without
 * leaving the recipe. Saved, the ingredient list is read again, so the recipe is costed at the new price at once.
 */
export function LinePrice({ i, lineUnit, onSaved }: { i: FcIngredientDTO; lineUnit: FcUnit; onSaved: () => Promise<void> }) {
  const { t, c, lang, n, money, unit } = useFc();
  const first = (): PriceDraft => (i.price ? { ...draftOf(i), supplier: i.price_source === "mine" ? (i.price.supplier ?? "") : "" } : { ...draftOf(null), unit: PACK[FC_UNITS[lineUnit].dim] });
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<PriceDraft>(first);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const name = lang === "bn" ? i.name_bn || i.name_en : i.name_en || i.name_bn;
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/fc/v1/prices/${i.id}`, { method: "PUT", body: priceBody(d) });
      setErrors({});
      setOpen(false);
      say(t("fc.priceSaved"));
      await onSaved();
    } catch (e) {
      const f = fieldsOf(e, t);
      setErrors(Object.keys(f).length ? f : { price_minor: e instanceof ApiError && e.code === "network" ? t("common.offline") : t(errorKey(e instanceof ApiError ? e.code : "")) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Txt v="small" color={i.price ? c.text3 : c.bad} style={{ flex: 1, minWidth: 160 }}>
          {i.price
            ? t("fc.linePrice", {
                price: t("fc.priceFor", { price: money(i.price.price_minor), qty: n(i.price.pack_qty), unit: unit(i.price.pack_unit) }),
                source: i.price_source === "mine" ? t("fc.myPrice") : t("fc.dhakaAverage"),
              })
            : t("fc.noPrice")}
        </Txt>
        <Btn
          title={i.price ? t("fc.changePrice") : t("fc.setPrice")}
          kind={i.price ? "ghost" : "secondary"}
          small
          accessibilityHint={name}
          onPress={() => {
            setD(first());
            setErrors({});
            setOpen((x) => !x);
          }}
        />
      </View>
      {open ? (
        <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 }}>
          <PriceFields d={d} onChange={setD} errors={errors} compact />
          <Txt v="tiny" color={c.text3}>
            {i.own ? t("fc.ownPriceHint") : t("fc.myPriceHint")}
          </Txt>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Btn title={t("fc.savePrice")} small loading={busy} onPress={() => void save()} style={{ flex: 1 }} />
            <Btn title={t("fc.cancel")} kind="ghost" small onPress={() => setOpen(false)} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
