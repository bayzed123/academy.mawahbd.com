import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  FC_NUTRIENTS,
  FC_NUTRIENT_NAMES,
  FC_UNITS,
  fcIngredient,
  fcNutrientText,
  fcNutritionBoxes,
  fcNutritionFromBoxes,
  fcParseNumber,
  unitCost,
  type FcIngredientDTO,
  type FcNutrient,
  type FcUnit,
} from "@mawah/shared/foodcost";
import { api, ApiError, useResource } from "../../src/api";
import { ask, say, useFc } from "../../src/components/FoodCost";
import { draftOf, fieldsOf, priceBody, PriceFields, type PriceDraft } from "../../src/components/FoodCostPrice";
import { useSession } from "../../src/session";
import { errorKey } from "../../src/strings";
import { Btn } from "../../src/ui/Btn";
import { Card } from "../../src/ui/Card";
import { Field } from "../../src/ui/Field";
import { Header } from "../../src/ui/Header";
import { Icon } from "../../src/ui/Icon";
import { Page, SectionTitle } from "../../src/ui/Page";
import { Press } from "../../src/ui/Press";
import { CardSkeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

const PATH = "/api/fc/v1/ingredients";
/** The unit a price is shared out per, by kind: a gram, a millilitre, a piece. */
const BASE = { mass: "g", volume: "ml", count: "piece" } as const satisfies Record<string, FcUnit>;

/** Ingredients & prices: the Dhaka average staff keep, or one's own price (for oneself only), and one's own ingredients. */
export default function IngredientsScreen() {
  const { t, c } = useFc();
  const { status } = useSession();
  const router = useRouter();
  const list = useResource<{ ingredients: FcIngredientDTO[] }>(status === "in" ? PATH : null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const changed = (text: string) => {
    say(text, setNote);
    void list.refresh();
  };
  const words = q.trim().toLowerCase();
  const shown = (list.data?.ingredients ?? []).filter((i) => (i.active || i.own) && (!words || `${i.name_bn} ${i.name_en} ${i.category}`.toLowerCase().includes(words)));
  const own = shown.filter((i) => i.own);
  const shared = shown.filter((i) => !i.own);

  return (
    <>
      <Header title={t("fc.ingredients")} />
      <Page under keyboard onRefresh={() => void list.refresh()} refreshing={list.refreshing}>
        {status !== "in" ? (
          <EmptyState icon="tag" title={t("fc.loggedOut.title")} body={t("fc.loggedOut.body")} action={{ title: t("home.login.cta"), onPress: () => router.push("/login") }} />
        ) : list.loading ? (
          <CardSkeleton image={false} />
        ) : list.error && !list.data ? (
          <ErrorState error={list.error} onRetry={() => void list.refresh()} />
        ) : (
          <>
            <Txt v="small" color={c.text2}>
              {t("fc.ingredientsSub")}
            </Txt>
            <Field label={t("fc.search")} value={q} onChangeText={setQ} autoCorrect={false} />
            {note ? (
              <Txt v="small" color={c.ok} accessibilityLiveRegion="polite">
                {note}
              </Txt>
            ) : null}
            {adding ? (
              <AddIngredient
                onDone={(text) => {
                  setAdding(false);
                  if (text) changed(text);
                }}
              />
            ) : (
              <Btn title={t("fc.addOwn")} icon="plus" kind="secondary" onPress={() => setAdding(true)} />
            )}
            {own.length > 0 ? (
              <View style={{ gap: 10 }}>
                <SectionTitle title={t("fc.ownList")} />
                {own.map((i) => (
                  <IngredientRow key={i.id} i={i} changed={changed} />
                ))}
              </View>
            ) : null}
            <View style={{ gap: 10 }}>
              <SectionTitle title={t("fc.sharedList")} sub={t("fc.sharedHelp")} />
              {shared.length === 0 ? (
                <Txt v="small" color={c.text3}>
                  {words ? t("fc.nothingFound") : t("fc.sharedEmpty")}
                </Txt>
              ) : (
                shared.map((i) => <IngredientRow key={i.id} i={i} changed={changed} />)
              )}
            </View>
          </>
        )}
      </Page>
    </>
  );
}

function IngredientRow({ i, changed }: { i: FcIngredientDTO; changed: (text: string) => void }) {
  const { t, c, lang, n, money, unit } = useFc();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<PriceDraft>(() => draftOf(i));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const name = lang === "bn" ? i.name_bn || i.name_en : i.name_en || i.name_bn;
  const other = lang === "bn" ? i.name_en : i.name_bn;
  const base = i.price ? BASE[FC_UNITS[i.price.pack_unit].dim] : null;
  const each = i.price && base ? unitCost(fcIngredient(i, lang), base) : null;
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      setErrors({});
      setOpen(false);
      changed(done);
    } catch (e) {
      const f = fieldsOf(e, t);
      setErrors(f);
      if (!Object.keys(f).length) {
        const code = e instanceof ApiError ? e.code : "";
        say(code === "fc_in_use" ? t("fc.ingredientInUse") : code === "network" ? t("common.offline") : t(errorKey(code)), (text) => setErrors({ price_minor: text }));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 6 }}>
      <Txt v="label">
        {name}
        {other && other !== name ? <Txt v="small" color={c.text3}>{` · ${other}`}</Txt> : null}
      </Txt>
      {i.category ? (
        <Txt v="tiny" color={c.text3}>
          {i.category}
        </Txt>
      ) : null}
      {i.price ? (
        <Txt v="small">
          {t("fc.priceFor", { price: money(i.price.price_minor), qty: n(i.price.pack_qty), unit: unit(i.price.pack_unit) })}
          {each !== null && base ? <Txt v="small" color={c.text3}>{` · ${money(each)} / ${unit(base)}`}</Txt> : null}
        </Txt>
      ) : (
        <Txt v="small" color={c.text3}>
          {t("fc.noPrice")}
        </Txt>
      )}
      {i.price_source === "mine" ? (
        <Txt v="tiny" color={c.ok}>
          {t("fc.myPrice")}
          {i.default_price && !i.own ? ` · ${t("fc.averageIs", { price: money(i.default_price.price_minor), qty: n(i.default_price.pack_qty), unit: unit(i.default_price.pack_unit) })}` : ""}
        </Txt>
      ) : i.price_source === "default" ? (
        <Txt v="tiny" color={c.text3}>
          {t("fc.dhakaAverage")}
        </Txt>
      ) : null}
      <Txt v="tiny" color={c.text3}>
        {i.nutrition?.kcal != null ? t("fc.kcalPer100", { kcal: fcNutrientText("kcal", i.nutrition.kcal, lang) }) : t("fc.noKcal")}
      </Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        <Btn title={t("fc.setMyPrice")} kind="secondary" small onPress={() => setOpen((x) => !x)} accessibilityHint={name} />
        {i.price_source === "mine" && !i.own ? (
          <Btn title={t("fc.backToDefault")} kind="ghost" small loading={busy && !open} onPress={() => void run(() => api(`/api/fc/v1/prices/${i.id}`, { method: "DELETE" }), t("fc.backToDefaultDone"))} accessibilityHint={name} />
        ) : null}
        {i.own ? (
          <Press
            onPress={() => ask(t("fc.delete"), name, t("fc.deleteYes"), t("fc.deleteNo"), () => void run(() => api(`/api/fc/v1/ingredients/${i.id}`, { method: "DELETE" }), t("fc.ingredientDeleted")))}
            accessibilityRole="button"
            accessibilityLabel={`${t("fc.delete")} — ${name}`}
            style={{ width: 44, height: 40, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="trash" size={20} color={c.bad} />
          </Press>
        ) : null}
      </View>
      {open ? (
        <View style={{ gap: 10, marginTop: 6 }}>
          <PriceFields d={d} onChange={setD} errors={errors} />
          <Txt v="tiny" color={c.text3}>
            {t("fc.myPriceHint")}
          </Txt>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Btn title={t("fc.savePrice")} small loading={busy} onPress={() => void run(() => api(`/api/fc/v1/prices/${i.id}`, { method: "PUT", body: priceBody(d) }), t("fc.priceSaved"))} style={{ flex: 1 }} />
            <Btn title={t("fc.cancel")} kind="ghost" small onPress={() => setOpen(false)} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function AddIngredient({ onDone }: { onDone: (done?: string) => void }) {
  const { t, c, lang } = useFc();
  const [names, setNames] = useState({ bn: "", en: "", category: "", gml: "", gpc: "" });
  const [d, setD] = useState<PriceDraft>(() => draftOf(null));
  const [food, setFood] = useState(() => fcNutritionBoxes(null));
  const [tried, setTried] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const typed = fcNutritionFromBoxes(food);
  const foodError = (k: FcNutrient) =>
    errors[`nutrition.${k}`] ?? (tried && typed.bad.includes(k) ? t(k === "kcal" && !food.kcal.trim() ? "fc.kcalFirst" : "fc.badFigure") : undefined);
  const add = async () => {
    setTried(true);
    if (typed.bad.length) return;
    setBusy(true);
    try {
      await api(PATH, {
        method: "POST",
        body: {
          name_bn: names.bn.trim(),
          name_en: names.en.trim(),
          category: names.category.trim(),
          g_per_ml: fcParseNumber(names.gml),
          g_per_piece: fcParseNumber(names.gpc),
          price: d.taka.trim() ? priceBody(d) : null,
          nutrition: typed.nutrition,
        },
      });
      onDone(t("fc.ingredientAdded"));
    } catch (e) {
      const f = fieldsOf(e, t);
      setErrors(Object.keys(f).length ? f : { name_en: e instanceof ApiError ? t(errorKey(e.code)) : t("err.server") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: 10 }}>
      <Txt v="heading">{t("fc.addOwn")}</Txt>
      <Field label={t("fc.nameBn")} value={names.bn} maxLength={80} onChangeText={(v) => setNames({ ...names, bn: v })} />
      <Field label={t("fc.nameEn")} value={names.en} maxLength={80} onChangeText={(v) => setNames({ ...names, en: v })} error={errors.name_en} />
      <Field label={t("fc.category")} value={names.category} maxLength={40} onChangeText={(v) => setNames({ ...names, category: v })} />
      <Field label={t("fc.gPerMl")} hint={t("fc.gPerMlHint")} value={names.gml} keyboardType="decimal-pad" onChangeText={(v) => setNames({ ...names, gml: v })} />
      <Field label={t("fc.gPerPiece")} hint={t("fc.gPerPieceHint")} value={names.gpc} keyboardType="decimal-pad" onChangeText={(v) => setNames({ ...names, gpc: v })} />
      <Txt v="label" color={c.text2}>
        {t("fc.itsPrice")}
      </Txt>
      <PriceFields d={d} onChange={setD} errors={errors} />
      <Txt v="label" color={c.text2}>
        {t("fc.nutritionOwn")}
      </Txt>
      <Txt v="tiny" color={c.text3}>
        {t("fc.nutritionOwnHint")}
      </Txt>
      {FC_NUTRIENTS.map((k) => (
        <Field
          key={k}
          label={`${FC_NUTRIENT_NAMES[k][lang].name} (${FC_NUTRIENT_NAMES[k][lang].unit})`}
          value={food[k]}
          keyboardType="decimal-pad"
          onChangeText={(v) => setFood((x) => ({ ...x, [k]: v }))}
          error={foodError(k)}
        />
      ))}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Btn title={t("fc.addOwnSave")} loading={busy} onPress={() => void add()} style={{ flex: 1 }} />
        <Btn title={t("fc.cancel")} kind="ghost" onPress={() => onDone()} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}
