import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState, type ComponentRef } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FC_COST_KINDS,
  FC_COST_PERS,
  FC_NUTRIENTS,
  FC_NUTRIENT_NAMES,
  FC_ROUND_STEPS,
  FC_UNITS,
  FC_UNIT_LIST,
  fcCostWith,
  fcEmptyForm,
  fcFormFromDTO,
  fcFormToInput,
  fcIngredient,
  fcNewItem,
  fcNutrientText,
  fcNutritionWith,
  fcUnitsFor,
  type FcBook,
  type FcFormCost,
  type FcFormItem,
  type FcIngredientDTO,
  type FcMeDTO,
  type FcNutrient,
  type FcNutritionResult,
  type FcRecipeDTO,
  type FcRecipeForm,
  type FcResult,
  type FcUnit,
} from "@mawah/shared/foodcost";
import { api, ApiError, useResource } from "../../src/api";
import type { FcReport, FcReportRow } from "@mawah/shared/foodcostReport";
import { ask, codeText, problemText, say, useFc } from "../../src/components/FoodCost";
import { LinePrice } from "../../src/components/FoodCostPrice";
import { shareRecipePdf } from "../../src/foodcostPdf";
import { CONTENT_MAX, GUTTER } from "../../src/lib/layout";
import { useSession } from "../../src/session";
import { errorKey } from "../../src/strings";
import { RADIUS } from "../../src/theme";
import { Btn } from "../../src/ui/Btn";
import { Card } from "../../src/ui/Card";
import { Choice, type ChoiceOption } from "../../src/ui/Choice";
import { Field } from "../../src/ui/Field";
import { Header } from "../../src/ui/Header";
import { Icon } from "../../src/ui/Icon";
import { KeyboardScroll } from "../../src/ui/KeyboardScroll";
import { Page } from "../../src/ui/Page";
import { Press } from "../../src/ui/Press";
import { CardSkeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

type Book = FcBook & { me: FcMeDTO };
type Saved = { recipe: FcRecipeDTO; result: FcResult };
/** The unit a price or a yield is shared out per, by kind: a gram, a millilitre, a piece. */
const BASE = { mass: "g", volume: "ml", count: "piece" } as const satisfies Record<string, FcUnit>;

/** A recipe: /foodcost/new, or /foodcost/12. Costed while one types by the same engine as the website and the server. */
export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useFc();
  const { status } = useSession();
  const router = useRouter();
  const book = useResource<Book>(status === "in" ? "/api/fc/v1/book" : null);
  // "new": 0; an address that is not a number is a recipe that does not exist (-1)
  const recipeId = id === "new" ? 0 : /^\d+$/.test(String(id ?? "")) ? Number(id) : -1;

  if (status !== "in" || !book.data) {
    return (
      <>
        <Header title={t("fc.title")} />
        <Page under>
          {status !== "in" ? (
            <EmptyState icon="receipt" title={t("fc.loggedOut.title")} body={t("fc.loggedOut.body")} action={{ title: t("home.login.cta"), onPress: () => router.push("/login") }} />
          ) : book.error ? (
            <ErrorState error={book.error} onRetry={() => void book.refresh()} />
          ) : (
            <CardSkeleton image={false} />
          )}
        </Page>
      </>
    );
  }
  const saved = recipeId !== 0 ? (book.data.recipes.find((r) => r.id === recipeId) ?? null) : null;
  if (recipeId !== 0 && !saved) {
    return (
      <>
        <Header title={t("fc.title")} />
        <Page under>
          <EmptyState icon="receipt" title={t("fc.notFound")} />
        </Page>
      </>
    );
  }
  // a new form for each recipe, so nothing typed for one ever shows on another
  return <RecipeForm key={saved ? saved.id : "new"} book={book.data} saved={saved} reload={book.refresh} />;
}

function RecipeForm({ book, saved, reload }: { book: Book; saved: FcRecipeDTO | null; reload: () => Promise<void> }) {
  const { t, c, lang, n: digits, money, unit, per } = useFc();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const resultY = useRef(0);
  const [f, setF] = useState<FcRecipeForm>(() => (saved ? fcFormFromDTO(saved) : fcEmptyForm()));
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "copy" | "delete" | "pdf">("");

  const { input, rows } = useMemo(() => fcFormToInput(f), [f]);
  // the same costing as the server's, on every key press — and the calories, from the same lines
  const result = useMemo(() => fcCostWith({ id: saved?.id ?? 0, ...input }, book, lang), [input, book, lang, saved]);
  const food = useMemo(() => fcNutritionWith({ id: saved?.id ?? 0, ...input }, book), [input, book, saved]);
  const kcal = (v: number) => fcNutrientText("kcal", v, lang);
  const ingredients = useMemo(() => new Map(book.ingredients.map((i) => [i.id, i])), [book]);
  const name = (i: FcIngredientDTO) => (lang === "bn" ? i.name_bn || i.name_en : i.name_en || i.name_bn);
  const whatOptions = (current: string): ChoiceOption<string>[] => [
    // by category (a switched-off ingredient only where it is already chosen), then one's other recipes
    ...book.ingredients
      .filter((i) => i.active || `i${i.id}` === current)
      .sort((a, b) => (a.category || "￿").localeCompare(b.category || "￿"))
      .map((i) => ({ value: `i${i.id}`, label: `${name(i)}${i.price ? "" : ` (${t("fc.noPriceShort")})`}`, group: i.category || t("fc.otherCat") })),
    ...book.recipes.filter((r) => r.id !== saved?.id).map((r) => ({ value: `r${r.id}`, label: r.name, group: t("fc.myRecipes") })),
  ];
  const unitOptions = (units: FcUnit[]): ChoiceOption<FcUnit>[] => units.map((u) => ({ value: u, label: unit(u) }));
  const set = (patch: Partial<FcRecipeForm>) => setF((x) => ({ ...x, ...patch }));
  const setItem = (n: number, patch: Partial<FcFormItem>) => setF((x) => ({ ...x, items: x.items.map((i, k) => (k === n ? { ...i, ...patch } : i)) }));
  const setCost = (n: number, patch: Partial<FcFormCost>) => setF((x) => ({ ...x, costs: x.costs.map((cost, k) => (k === n ? { ...cost, ...patch } : cost)) }));

  /** The unit stays when it is the same kind as the ingredient's price or the recipe's yield; else it becomes that kind's own. */
  const choose = (n: number, ref: string) => {
    let u: FcUnit = f.items[n].unit;
    const ing = ref[0] === "i" ? ingredients.get(Number(ref.slice(1))) : undefined;
    const sub = ref[0] === "r" ? book.recipes.find((x) => x.id === Number(ref.slice(1))) : undefined;
    // no price yet: something with a weight for one piece (an egg) is counted by the piece
    const kind = ing?.price ? FC_UNITS[ing.price.pack_unit].dim : ing?.g_per_piece ? "count" : sub ? FC_UNITS[sub.yield_unit].dim : null;
    if (kind && FC_UNITS[u].dim !== kind) u = BASE[kind];
    setItem(n, { ref, unit: u });
  };

  const failed = (e: unknown) => {
    if (!(e instanceof ApiError)) return setProblem(t("err.server"));
    if (e.code === "network") return setProblem(t("common.offline"));
    if (e.code === "fc_limit") return setProblem(t("fc.limitReached", { limit: book.me.limit ?? 0 }));
    if (e.code === "fc_in_use") return setProblem(t("fc.inUse", { name: e.fields.used_by ?? "" }));
    const fields: Record<string, string> = {};
    for (const [k, code] of Object.entries(e.fields)) {
      // "items.2.qty" is the third line sent: put it on the form line it came from
      const m = /^items\.(\d+)/.exec(k);
      fields[m ? `item${rows[Number(m[1])]}` : k] = codeText(code, t);
    }
    setFieldErr(fields);
    setProblem(Object.keys(fields).length ? t("fc.fixFirst") : t(errorKey(e.code)));
  };

  const save = async () => {
    if (!input.name) {
      setFieldErr({ name: t("err.required") });
      setProblem(t("fc.fixFirst"));
      scroll.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setBusy("save");
    setProblem("");
    try {
      const r = saved ? await api<Saved>(`/api/fc/v1/recipes/${saved.id}`, { method: "PUT", body: input }) : await api<Saved>("/api/fc/v1/recipes", { method: "POST", body: input });
      setFieldErr({});
      say(t("fc.saved"), setNote);
      // the book read again holds the saved recipe, so its own page opens at once
      await reload();
      if (!saved) router.replace(`/foodcost/${r.recipe.id}`);
    } catch (e) {
      failed(e);
    } finally {
      setBusy("");
    }
  };
  const copy = async () => {
    setBusy("copy");
    try {
      const r = await api<Saved>(`/api/fc/v1/recipes/${saved!.id}/duplicate`, { method: "POST", body: {} });
      say(t("fc.copied"), setNote);
      await reload();
      router.push(`/foodcost/${r.recipe.id}`);
    } catch (e) {
      failed(e);
    } finally {
      setBusy("");
    }
  };
  const remove = () =>
    ask(t("fc.deleteAsk"), saved!.name, t("fc.deleteYes"), t("fc.deleteNo"), async () => {
      setBusy("delete");
      try {
        await api(`/api/fc/v1/recipes/${saved!.id}`, { method: "DELETE" });
        say(t("fc.deleted"));
        await reload();
        if (router.canGoBack()) router.back();
        else router.replace("/foodcost");
      } catch (e) {
        failed(e);
      } finally {
        setBusy("");
      }
    });

  const yieldWhat = f.yieldLabel.trim() || unit(f.yieldUnit);
  const counted = FC_UNITS[f.yieldUnit].dim === "count";

  /** The PDF: the recipe as it is on the screen now (saved or not), in the reader's language, in the website's page design. */
  const pdf = async () => {
    const label = f.yieldLabel.trim();
    const title = input.name || t("fc.title");
    const date = new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
    const cal = (v: number | null | undefined) => (v === null || v === undefined ? "—" : kcal(v));
    const priced = f.pct.trim() !== "";
    const suggested: FcReportRow = { label: t(`fc.suggested.${f.mode}`, { pct: input.pricing.pct }), value: per(result.suggestedMinor, label, f.yieldUnit), tone: "accent" };
    const headline: FcReportRow[] = [
      { label: t("fc.cost"), value: per(result.perUnitMinor, label, f.yieldUnit) },
      ...(priced ? [suggested] : []),
      ...(food.perUnit && food.counted > 0 ? [{ label: t("fc.kcalPer", { what: yieldWhat }), value: cal(food.perUnit.kcal) }] : []),
    ];
    // three across at most, so a figure "per cupcake" stays on one line; the batch is always in the table below
    if (headline.length < 3) headline.push({ label: t("fc.oneBatch"), value: money(result.batchMinor) });
    const a = result.actual;
    const summary: FcReportRow[] = [
      { label: t("fc.oneBatch"), value: money(result.batchMinor) },
      { label: t("fc.cost"), value: per(result.perUnitMinor, label, f.yieldUnit) },
      ...(priced ? [suggested] : []),
      ...(a
        ? [
            { label: a.profitMinor < 0 ? t("fc.lossEach") : t("fc.profitEach"), value: money(a.profitMinor), tone: a.profitMinor < 0 ? ("loss" as const) : undefined },
            { label: t("fc.profitBatch"), value: money(a.profitBatchMinor), tone: a.profitBatchMinor < 0 ? ("loss" as const) : undefined },
            { label: t("fc.realMargin"), value: a.marginPct === null ? "—" : `${digits(a.marginPct)}%` },
          ]
        : []),
    ];
    const split = (
      [
        ["ingredients", result.ingredientsMinor],
        ["packaging", result.packagingMinor],
        ["labour", result.labourMinor],
        ["energy", result.energyMinor],
        ["other", result.otherMinor],
      ] as const
    )
      .filter(([k, v]) => k === "ingredients" || v > 0)
      .map(([k, v]) => ({ label: k === "ingredients" ? t("fc.ingredientsCost") : t(`fc.kind.${k}`), value: money(v) }));
    const figs = food.perUnit ?? food.batch;
    const foodRows: FcReportRow[] =
      food.counted > 0
        ? [
            ...(food.perUnit ? [{ label: t("fc.kcalPer", { what: yieldWhat }), value: cal(food.perUnit.kcal) }] : []),
            { label: t("fc.kcalBatch"), value: cal(food.batch.kcal) },
            ...FC_NUTRIENTS.filter((k) => k !== "kcal").map((k) => ({
              label: `${FC_NUTRIENT_NAMES[k][lang].name} ${food.perUnit ? t("fc.perWhat", { what: yieldWhat }) : t("fc.perBatch")}`,
              value: fcNutrientText(k, figs[k], lang) + (food.known[k] ? "" : " *"),
            })),
          ]
        : [];
    const report: FcReport = {
      lang,
      docTitle: `${t("fc.title")} — ${title}`,
      brand: t("fc.report.brand"),
      title,
      subtitle: `${t("fc.makes", { qty: input.yield_qty, what: yieldWhat })} · ${date}`,
      headline,
      linesHeading: t("fc.lines"),
      lineHeads: { n: "#", name: t("fc.report.item"), amount: t("fc.qty"), cost: t("fc.cost"), share: t("fc.report.share"), kcal: t("fc.report.kcal") },
      lines: result.lines.map((l, k) => ({
        n: digits(rows[k] + 1),
        name: l.name,
        amount: `${digits(l.qty)} ${unit(l.unit)}`,
        cost: l.problem ? "—" : money(l.costMinor),
        share: l.problem ? "—" : `${digits(l.sharePct)}%`,
        kcal: cal(food.lines[k]?.kcal),
        note: l.problem ? (l.problem === "no_price" ? t("fc.noPrice") : problemText({ code: l.problem, line: k }, result, rows, t)) : undefined,
      })),
      splitHeading: t("fc.report.split"),
      split,
      summaryHeading: t("fc.result"),
      summary,
      foodHeading: t("fc.food"),
      food: foodRows,
      notes: [
        ...(!result.complete ? [`${t("fc.partialLong")} ${result.problems.map((p) => problemText(p, result, rows, t)).join(" ")}`] : []),
        ...(food.counted > 0 && !food.complete
          ? [`${t("fc.foodPartial")} ${food.problems.map((p) => t(`fc.fp.${p.code}`, { line: rows[p.line] + 1, name: result.lines[p.line]?.name ?? "" })).join(" ")}`]
          : []),
        ...(food.counted > 0 && FC_NUTRIENTS.some((k) => !food.known[k]) ? [t("fc.foodStar")] : []),
        ...(food.counted > 0 ? [t("fc.foodSource")] : []),
        t("fc.report.prices"),
      ],
      footer: t("fc.report.footer"),
    };
    setBusy("pdf");
    setProblem("");
    try {
      await shareRecipePdf(report, title, t("fc.pdf"));
    } catch {
      setProblem(t("fc.pdfFailed"));
    } finally {
      setBusy("");
    }
  };
  const box = { borderWidth: 1, borderColor: c.line, borderRadius: RADIUS.m, padding: 12, gap: 10 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={saved ? saved.name : t("fc.newTitle")} right={<Btn title={t("fc.save")} small onPress={() => void save()} loading={busy === "save"} />} />
      {/* the box being typed in stays above the keyboard (Android draws edge to edge and no longer makes room by itself) */}
      <KeyboardScroll
        ref={scroll}
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: 96 + insets.bottom, gap: 16, width: "100%", maxWidth: CONTENT_MAX + GUTTER * 2, alignSelf: "center" }}
      >
          <Card style={{ gap: 12 }}>
            <Txt v="heading">{t("fc.about")}</Txt>
            <Field label={t("fc.name")} value={f.name} maxLength={120} placeholder={t("fc.namePh")} onChangeText={(v) => set({ name: v })} error={fieldErr.name} />
            <Txt v="label">{t("fc.yield")}</Txt>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label={t("fc.yieldQty")} value={f.yieldQty} keyboardType="decimal-pad" placeholder="12" onChangeText={(v) => set({ yieldQty: v })} error={fieldErr.yield_qty} box={{ flex: 1 }} />
              <Choice label={t("fc.unit")} value={f.yieldUnit} options={unitOptions(FC_UNIT_LIST)} onChange={(u) => set({ yieldUnit: u })} box={{ flex: 1 }} />
            </View>
            <Field label={t("fc.yieldLabel")} value={f.yieldLabel} maxLength={40} placeholder={t("fc.yieldLabelPh")} onChangeText={(v) => set({ yieldLabel: v })} />
            {counted ? <Field label={t("fc.outputG")} hint={t("fc.outputGHint")} value={f.outputG} keyboardType="decimal-pad" onChangeText={(v) => set({ outputG: v })} /> : null}
          </Card>

          <Card style={{ gap: 12 }}>
            <Txt v="heading">{t("fc.lines")}</Txt>
            {book.ingredients.length === 0 && book.recipes.length === 0 ? (
              <Txt v="small" color={c.text3}>
                {t("fc.noIngredients")}
              </Txt>
            ) : null}
            {f.items.map((it, n) => {
              const k = rows.indexOf(n);
              const line = k >= 0 ? result.lines[k] : undefined;
              const ing = it.ref[0] === "i" ? ingredients.get(Number(it.ref.slice(1))) : undefined;
              const units = ing ? fcUnitsFor(fcIngredient(ing, lang)) : FC_UNIT_LIST;
              const shown = units.includes(it.unit) ? units : [it.unit, ...units];
              // "no price" is said by the line's price box, which offers to set it there and then
              const err = fieldErr[`item${n}`] ?? (line?.problem && line.problem !== "no_price" ? problemText({ code: line.problem, line: k }, result, rows, t) : "");
              return (
                <View key={n} style={box}>
                  <Choice label={t("fc.lineN", { n: n + 1 })} value={it.ref} options={whatOptions(it.ref)} placeholder={t("fc.choose")} onChange={(v) => choose(n, v)} searchable />
                  <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
                    <Field label={t("fc.qty")} value={it.qty} keyboardType="decimal-pad" onChangeText={(v) => setItem(n, { qty: v })} box={{ flex: 1 }} />
                    <Choice label={t("fc.unit")} value={it.unit} options={unitOptions(shown)} onChange={(u) => setItem(n, { unit: u })} box={{ flex: 1 }} />
                    <Press
                      onPress={() => setF((x) => ({ ...x, items: x.items.length > 1 ? x.items.filter((_, j) => j !== n) : [fcNewItem()] }))}
                      accessibilityRole="button"
                      accessibilityLabel={t("fc.removeLine", { n: n + 1 })}
                      style={{ width: 44, height: 50, alignItems: "center", justifyContent: "center" }}
                    >
                      <Icon name="trash" size={20} color={c.bad} />
                    </Press>
                  </View>
                  {(line && !line.problem) || food.lines[k]?.kcal != null ? (
                    <Txt v="small" color={c.text2}>
                      {[line && !line.problem ? `${money(line.costMinor)} · ${t("fc.share", { pct: line.sharePct })}` : "", food.lines[k]?.kcal != null ? kcal(food.lines[k].kcal!) : ""].filter(Boolean).join(" · ")}
                    </Txt>
                  ) : null}
                  {err ? (
                    <Txt v="small" color={c.bad}>
                      {err}
                    </Txt>
                  ) : null}
                  {ing ? <LinePrice i={ing} lineUnit={it.unit} onSaved={reload} /> : null}
                </View>
              );
            })}
            <Btn title={t("fc.addLine")} icon="plus" kind="secondary" small onPress={() => setF((x) => ({ ...x, items: [...x.items, fcNewItem()] }))} />
          </Card>

          <Card style={{ gap: 12 }}>
            <Txt v="heading">{t("fc.costs")}</Txt>
            <Txt v="small" color={c.text3}>
              {t("fc.costsHelp")}
            </Txt>
            {f.costs.map((cost, n) => (
              <View key={n} style={box}>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
                  <Choice
                    label={t("fc.costN", { n: n + 1 })}
                    value={cost.kind}
                    options={FC_COST_KINDS.map((k) => ({ value: k, label: t(`fc.kind.${k}`) }))}
                    onChange={(k) => setCost(n, { kind: k })}
                    box={{ flex: 1 }}
                  />
                  <Press
                    onPress={() => setF((x) => ({ ...x, costs: x.costs.filter((_, j) => j !== n) }))}
                    accessibilityRole="button"
                    accessibilityLabel={t("fc.removeCost", { n: n + 1 })}
                    style={{ width: 44, height: 50, alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="trash" size={20} color={c.bad} />
                  </Press>
                </View>
                <Field label={t("fc.costLabel")} value={cost.label} maxLength={60} onChangeText={(v) => setCost(n, { label: v })} />
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Field label={t("fc.amount")} value={cost.amount} keyboardType="decimal-pad" onChangeText={(v) => setCost(n, { amount: v })} box={{ flex: 1 }} />
                  <Choice
                    label={t("fc.per")}
                    value={cost.per}
                    options={FC_COST_PERS.map((p) => ({ value: p, label: t(`fc.per.${p}`, { what: yieldWhat }) }))}
                    onChange={(p) => setCost(n, { per: p })}
                    box={{ flex: 1 }}
                  />
                </View>
                {cost.per === "hour" ? <Field label={t("fc.hours")} value={cost.hours} keyboardType="decimal-pad" onChangeText={(v) => setCost(n, { hours: v })} /> : null}
              </View>
            ))}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(
                [
                  ["packaging", "piece"],
                  ["labour", "hour"],
                  ["energy", "batch"],
                  ["other", "batch"],
                ] as const
              ).map(([kind, p]) => (
                <Btn
                  key={kind}
                  title={t(`fc.kind.${kind}`)}
                  icon="plus"
                  kind="secondary"
                  small
                  onPress={() => setF((x) => ({ ...x, costs: [...x.costs, { kind, per: p, label: "", amount: "", hours: p === "hour" ? "1" : "" }] }))}
                />
              ))}
            </View>
          </Card>

          <Card style={{ gap: 12 }}>
            <Txt v="heading">{t("fc.pricing")}</Txt>
            <Txt v="label">{t("fc.profitAs")}</Txt>
            {(["markup", "margin"] as const).map((m) => (
              <Press
                key={m}
                onPress={() => set({ mode: m })}
                accessibilityRole="radio"
                accessibilityState={{ checked: f.mode === m }}
                style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: RADIUS.m, borderWidth: 1, borderColor: f.mode === m ? c.accent : c.line }}
              >
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: f.mode === m ? c.accent : c.line2, alignItems: "center", justifyContent: "center", marginTop: 3 }}>
                  {f.mode === m ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent }} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Txt v="label">{t(`fc.mode.${m}`)}</Txt>
                  <Txt v="small" color={c.text3}>
                    {t(`fc.mode.${m}.d`)}
                  </Txt>
                </View>
              </Press>
            ))}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label={t("fc.pct")} value={f.pct} keyboardType="decimal-pad" placeholder="40" onChangeText={(v) => set({ pct: v })} error={fieldErr["pricing.pct"]} box={{ flex: 1 }} />
              <Choice
                label={t("fc.roundTo")}
                value={f.roundTo}
                options={FC_ROUND_STEPS.map((s) => ({ value: s as number, label: s === 0 ? t("fc.noRounding") : money(s) }))}
                onChange={(s) => set({ roundTo: s })}
                box={{ flex: 1 }}
              />
            </View>
            <Field label={t("fc.actual", { what: yieldWhat })} hint={t("fc.actualHint")} value={f.actual} keyboardType="decimal-pad" onChangeText={(v) => set({ actual: v })} />
          </Card>

          <Card>
            <Field label={t("fc.notes")} value={f.notes} maxLength={2000} multiline onChangeText={(v) => set({ notes: v })} />
          </Card>

          <View
            onLayout={(e) => {
              resultY.current = e.nativeEvent.layout.y;
            }}
          >
            <Card style={{ gap: 10 }}>
              <Txt v="heading">{t("fc.result")}</Txt>
              <Figure label={t("fc.oneBatch")} value={money(result.batchMinor)} />
              <Figure label={t("fc.cost")} value={per(result.perUnitMinor, f.yieldLabel.trim(), f.yieldUnit)} big />
              {f.pct.trim() !== "" ? <Figure label={t(`fc.suggested.${f.mode}`, { pct: input.pricing.pct })} value={per(result.suggestedMinor, f.yieldLabel.trim(), f.yieldUnit)} big accent /> : null}
              {result.actual ? (
                <>
                  <Figure label={result.actual.profitMinor < 0 ? t("fc.lossEach") : t("fc.profitEach")} value={money(result.actual.profitMinor)} bad={result.actual.profitMinor < 0} />
                  <Figure label={t("fc.profitBatch")} value={money(result.actual.profitBatchMinor)} bad={result.actual.profitBatchMinor < 0} />
                  <Figure
                    label={t("fc.realMargin")}
                    value={`${result.actual.marginPct === null ? "—" : `${digits(result.actual.marginPct)}%`} · ${t("fc.mode.markup")} ${result.actual.markupPct === null ? "—" : `${digits(result.actual.markupPct)}%`}`}
                  />
                </>
              ) : null}
              <View style={{ height: 1, backgroundColor: c.line, marginVertical: 2 }} />
              {(
                [
                  ["ingredients", result.ingredientsMinor],
                  ["packaging", result.packagingMinor],
                  ["labour", result.labourMinor],
                  ["energy", result.energyMinor],
                  ["other", result.otherMinor],
                ] as const
              )
                .filter(([k, v]) => k === "ingredients" || v > 0)
                .map(([k, v]) => (
                  <Figure key={k} label={k === "ingredients" ? t("fc.ingredientsCost") : t(`fc.kind.${k}`)} value={money(v)} small />
                ))}
              {result.problems.length > 0 ? (
                <View style={{ borderRadius: RADIUS.m, borderWidth: 1, borderColor: c.bad, backgroundColor: c.badBg, padding: 12, gap: 6 }}>
                  {!result.complete ? <Txt v="label">{t("fc.partialLong")}</Txt> : null}
                  {result.problems.map((p, i) => (
                    <Txt key={i} v="small">
                      • {problemText(p, result, rows, t)}
                    </Txt>
                  ))}
                </View>
              ) : null}
              {problem ? (
                <Txt v="small" color={c.bad} accessibilityLiveRegion="polite">
                  {problem}
                </Txt>
              ) : null}
              {note ? (
                <Txt v="small" color={c.ok} accessibilityLiveRegion="polite">
                  {note}
                </Txt>
              ) : null}
              <Btn title={saved ? t("fc.save") : t("fc.saveNew")} onPress={() => void save()} loading={busy === "save"} />
              <Btn title={t("fc.pdf")} icon="download" kind="secondary" onPress={() => void pdf()} loading={busy === "pdf"} accessibilityHint={t("fc.pdfHint")} />
              <Txt v="tiny" color={c.text3}>
                {t("fc.pdfHint")}
              </Txt>
              {saved ? (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Btn title={t("fc.copy")} kind="secondary" onPress={() => void copy()} loading={busy === "copy"} style={{ flex: 1 }} />
                  <Btn title={t("fc.delete")} kind="ghost" icon="trash" onPress={remove} loading={busy === "delete"} style={{ flex: 1 }} />
                </View>
              ) : null}
            </Card>
          </View>
          <FoodCard food={food} result={result} rows={rows} what={yieldWhat} />
      </KeyboardScroll>

      {/* the costs stay in sight while one types; a tap goes down to the whole picture */}
      <Press
        onPress={() => scroll.current?.scrollTo({ y: resultY.current, animated: true })}
        accessibilityRole="button"
        scale={0.99}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        <View style={{ backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10, paddingBottom: 10 + insets.bottom, paddingHorizontal: GUTTER, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 14 }}>
          <Txt v="small">
            {t("fc.cost")} <Txt v="label">{per(result.perUnitMinor, f.yieldLabel.trim(), f.yieldUnit)}</Txt>
          </Txt>
          {f.pct.trim() !== "" ? (
            <Txt v="small">
              {t("fc.price")}{" "}
              <Txt v="label" color={c.accent}>
                {per(result.suggestedMinor, f.yieldLabel.trim(), f.yieldUnit)}
              </Txt>
            </Txt>
          ) : null}
          {food.perUnit && food.counted > 0 ? <Txt v="label">{kcal(food.perUnit.kcal)}</Txt> : null}
          {!result.complete ? (
            <Txt v="small" color={c.bad}>
              {t("fc.partial")}
            </Txt>
          ) : null}
        </View>
      </Press>
    </View>
  );
}

/**
 * The calories and nutrients, below the cost: one piece (when the batch is counted), 100 g (when its weight is known) and the batch. A
 * figure some ingredient does not have is starred, and lines it could not count are named — never guessed.
 */
function FoodCard({ food, result, rows, what }: { food: FcNutritionResult; result: FcResult; rows: number[]; what: string }) {
  const { t, c, lang } = useFc();
  const text = (k: FcNutrient, v: number) => fcNutrientText(k, v, lang) + (food.known[k] ? "" : " *");
  const figs = food.perUnit ?? food.per100g ?? food.batch;
  const basis = food.perUnit ? t("fc.perWhat", { what }) : food.per100g ? t("fc.per100g") : t("fc.perBatch");
  return (
    <Card style={{ gap: 10 }}>
      <Txt v="heading">{t("fc.food")}</Txt>
      {food.counted === 0 && food.problems.length === 0 ? (
        <Txt v="small" color={c.text3}>
          {t("fc.foodNone")}
        </Txt>
      ) : (
        <>
          {food.perUnit ? <Figure label={t("fc.kcalPer", { what })} value={text("kcal", food.perUnit.kcal)} big /> : null}
          {food.per100g ? <Figure label={t("fc.kcal100g")} value={text("kcal", food.per100g.kcal)} big={!food.perUnit} /> : null}
          <Figure label={t("fc.kcalBatch")} value={text("kcal", food.batch.kcal)} />
          <View style={{ height: 1, backgroundColor: c.line, marginVertical: 2 }} />
          <Txt v="label" color={c.text2}>
            {t("fc.nutrientsFor", { basis })}
          </Txt>
          {FC_NUTRIENTS.filter((k) => k !== "kcal").map((k) => (
            <Figure key={k} label={FC_NUTRIENT_NAMES[k][lang].name} value={text(k, figs[k])} small />
          ))}
          {!food.complete ? (
            <View style={{ borderRadius: RADIUS.m, borderWidth: 1, borderColor: c.bad, backgroundColor: c.badBg, padding: 12, gap: 6 }}>
              <Txt v="label">{t("fc.foodPartial")}</Txt>
              {food.problems.map((p, i) => (
                <Txt key={i} v="small">
                  • {t(`fc.fp.${p.code}`, { line: rows[p.line] + 1, name: result.lines[p.line]?.name ?? "" })}
                </Txt>
              ))}
            </View>
          ) : FC_NUTRIENTS.some((k) => !food.known[k]) ? (
            <Txt v="tiny" color={c.text3}>
              {t("fc.foodStar")}
            </Txt>
          ) : null}
          <Txt v="tiny" color={c.text3}>
            {t("fc.foodSource")}
          </Txt>
        </>
      )}
    </Card>
  );
}

/** One line of the result: what it is on the left, the amount on the right. */
function Figure({ label, value, big, accent, bad, small }: { label: string; value: string; big?: boolean; accent?: boolean; bad?: boolean; small?: boolean }) {
  const { c } = useFc();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      <Txt v={small ? "small" : "body"} color={c.text3} style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      <Txt v={big ? "heading" : small ? "small" : "label"} color={bad ? c.bad : accent ? c.accent : c.text} style={{ marginLeft: "auto" }}>
        {value}
      </Txt>
    </View>
  );
}
