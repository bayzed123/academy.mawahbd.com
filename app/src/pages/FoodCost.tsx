import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FC_COST_KINDS,
  FC_COST_PERS,
  FC_ROUND_STEPS,
  FC_UNITS,
  FC_UNIT_LIST,
  FC_UNIT_NAMES,
  fcCostWith,
  fcEmptyForm,
  fcFormFromDTO,
  fcFormToInput,
  fcIngredient,
  fcMoney,
  fcNewItem,
  fcParseNumber,
  fcParseTaka,
  fcTakaText,
  fcUnitsFor,
  unitCost,
  type FcBook,
  type FcCostKind,
  type FcFormCost,
  type FcFormItem,
  type FcIngredientDTO,
  type FcMeDTO,
  type FcProblem,
  type FcRecipeDTO,
  type FcRecipeForm,
  type FcRecipeSummaryDTO,
  type FcResult,
  type FcUnit,
} from "@mawah/shared/foodcost";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, Empty, ErrorState, Field, Icon, Spinner, TextInput, useToast } from "../components/ui";

/*
 * FoodCost (docs/foodcost.md): what a recipe costs and what to sell it for. The same engine runs here while one types, on the server when a
 * recipe is saved, and in the Android app, so the numbers agree everywhere. Prices: the Dhaka average staff keep, or one's own.
 */

type Book = FcBook & { me: FcMeDTO };
type Saved = { recipe: FcRecipeDTO; result: FcResult };
const BOOK = ["fc", "book"] as const;
/** The unit a price is shared out per, by kind: a gram, a millilitre, a piece. */
const BASE = { mass: "g", volume: "ml", count: "piece" } as const satisfies Record<string, FcUnit>;
const ingName = (i: Pick<FcIngredientDTO, "name_bn" | "name_en">, lang: "bn" | "en") => (lang === "bn" ? i.name_bn || i.name_en : i.name_en || i.name_bn);

function useFc() {
  const { lang, t } = useI18n();
  const money = (minor: number | null | undefined) => (minor === null || minor === undefined ? "—" : fcMoney(minor, lang));
  const unit = (u: FcUnit) => FC_UNIT_NAMES[u][lang];
  /** "৳37.92 / cupcake", "৳0.55 / g"; "—" while there is nothing to share out */
  const per = (minor: number | null, label: string, u: FcUnit) => (minor === null ? "—" : `${money(minor)} / ${label || unit(u)}`);
  const num = (n: number) => (lang === "bn" ? n.toLocaleString("bn-BD", { maximumFractionDigits: 2 }) : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  return { lang, t, money, unit, per, num };
}

/* --------------------------------------------------------------------------------------------------------------------- my recipes */

function PlanLine({ me }: { me: FcMeDTO }) {
  const { t, num, lang } = useFc();
  if (me.student) return <p className="fc-plan">{t("app.fc.planStudent")}</p>;
  if (me.limit === null)
    return <p className="fc-plan">{me.plan_until ? t("app.fc.planProUntil", { date: new Date(me.plan_until).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB") }) : t("app.fc.planPro")}</p>;
  const full = me.used >= me.limit;
  return (
    <p className={`fc-plan${full ? " full" : ""}`}>
      {t("app.fc.planFree", { used: num(me.used), limit: num(me.limit) })} {full && t("app.fc.atLimit")} {t("app.fc.studentsNoLimit")}{" "}
      <a className="link" href={lang === "en" ? "/en/courses" : "/courses"}>
        {t("app.nav.browse")}
      </a>
    </p>
  );
}

export function FcHome() {
  const { t, per, unit, num } = useFc();
  const q = useQuery({ queryKey: ["fc", "recipes"], queryFn: () => api<{ recipes: FcRecipeSummaryDTO[]; me: FcMeDTO }>("/fc/v1/recipes") });
  return (
    <>
      <div className="page-head">
        <h1>{t("app.fc.title")}</h1>
        <p>{t("app.fc.sub")}</p>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <PlanLine me={q.data.me} />
          <div className="row fc-actions">
            <Link className="btn btn-primary" to="/foodcost/new">
              <Icon name="plus" /> {t("app.fc.new")}
            </Link>
            <Link className="btn btn-outline" to="/foodcost/ingredients">
              <Icon name="tag" /> {t("app.fc.ingredients")}
            </Link>
          </div>
          {q.data.recipes.length === 0 ? (
            <Empty icon="receipt" title={t("app.fc.empty")}>
              <p>{t("app.fc.emptyHelp")}</p>
            </Empty>
          ) : (
            <ul className="fc-list plain-list">
              {q.data.recipes.map((r) => (
                <li key={r.id}>
                  <Link to={`/foodcost/${r.id}`} className="order-row fc-row">
                    <span>
                      <b>{r.name}</b>
                      <br />
                      <small className="muted">{t("app.fc.makes", { qty: num(r.yield_qty), what: r.yield_label || unit(r.yield_unit) })}</small>
                    </span>
                    <span className="row">
                      <span className="fc-fig">
                        <small>{t("app.fc.costPer")}</small> <b>{per(r.per_unit_minor, r.yield_label, r.yield_unit)}</b>
                      </span>
                      {r.suggested_minor !== null && (
                        <span className="fc-fig">
                          <small>{t("app.fc.priceAt")}</small> <b>{per(r.suggested_minor, r.yield_label, r.yield_unit)}</b>
                        </span>
                      )}
                      {!r.complete && <span className="chip pending">{t("app.fc.partial")}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------------------- the editor */

export function FcEditor() {
  const { id } = useParams();
  const { t } = useFc();
  // /foodcost/new: 0; an address that is not a number is a recipe that does not exist (-1)
  const recipeId = id === undefined ? 0 : /^\d+$/.test(id) ? Number(id) : -1;
  const q = useQuery({ queryKey: BOOK, queryFn: () => api<Book>("/fc/v1/book") });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const saved = recipeId !== 0 ? (q.data.recipes.find((r) => r.id === recipeId) ?? null) : null;
  if (recipeId !== 0 && !saved)
    return (
      <Empty icon="receipt" title={t("app.fc.notFound")}>
        <Link className="btn btn-outline" to="/foodcost">
          {t("app.fc.back")}
        </Link>
      </Empty>
    );
  // a new form for each recipe (and a fresh one once a new recipe is saved), so nothing typed for one ever shows on another
  return <RecipeForm key={recipeId || "new"} book={q.data} saved={saved} />;
}

/** A problem in words, on the form line it is about (the lines sent leave out the empty ones), with the reader's digits. */
function problemText(p: FcProblem, result: FcResult, rows: number[], fc: Pick<ReturnType<typeof useFc>, "t" | "num">): string {
  const line = p.line !== undefined ? fc.num(rows[p.line] + 1) : "";
  const name = p.line !== undefined ? (result.lines[p.line]?.name ?? "") : "";
  return fc.t(`app.fc.p.${p.code}` as "app.fc.p.bad_qty", { line, cost: p.cost !== undefined ? fc.num(p.cost + 1) : "", name });
}
/** A field's error code in words: "required" and "invalid" have their own words, anything else its error message. */
const codeText = (code: string, t: ReturnType<typeof useFc>["t"], err: (c: string) => string) => (code === "required" ? t("err.required") : err(code === "invalid" ? "validation" : code));

function RecipeForm({ book, saved }: { book: Book; saved: FcRecipeDTO | null }) {
  const { t, lang, money, unit, per, num } = useFc();
  const { err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState<FcRecipeForm>(() => (saved ? fcFormFromDTO(saved) : fcEmptyForm()));
  const [problem, setProblem] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  // on a phone the panel with the costs is below the form: a bar at the bottom keeps them in sight (and lifts the floating buttons, app.css)
  useEffect(() => {
    document.body.classList.add("has-fcbar");
    return () => document.body.classList.remove("has-fcbar");
  }, []);

  const { input, rows } = useMemo(() => fcFormToInput(f), [f]);
  // the same costing the server does, on every key press
  const result = useMemo(() => fcCostWith({ id: saved?.id ?? 0, ...input }, book, lang), [input, book, lang, saved]);
  const ingredients = useMemo(() => new Map(book.ingredients.map((i) => [i.id, i])), [book]);
  const others = book.recipes.filter((r) => r.id !== saved?.id);
  const categories = useMemo(() => {
    const by = new Map<string, FcIngredientDTO[]>();
    for (const i of book.ingredients) by.set(i.category || "", [...(by.get(i.category || "") ?? []), i]);
    return [...by.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [book]);
  const lineOf = (row: number) => rows.indexOf(row);
  const set = (patch: Partial<FcRecipeForm>) => setF((x) => ({ ...x, ...patch }));
  const setItem = (n: number, patch: Partial<FcFormItem>) => setF((x) => ({ ...x, items: x.items.map((i, k) => (k === n ? { ...i, ...patch } : i)) }));
  const setCost = (n: number, patch: Partial<FcFormCost>) => setF((x) => ({ ...x, costs: x.costs.map((c, k) => (k === n ? { ...c, ...patch } : c)) }));

  /**
   * Choosing what a line is: the unit stays when it is the same kind (weight, volume, count) as the ingredient's price or the recipe's yield,
   * else it becomes that kind's own (eggs priced by the dozen are counted in pieces, flour priced by the kg is weighed in grams).
   */
  const choose = (n: number, ref: string) => {
    let u: FcUnit = f.items[n].unit;
    const ing = ref[0] === "i" ? ingredients.get(Number(ref.slice(1))) : undefined;
    const sub = ref[0] === "r" ? book.recipes.find((x) => x.id === Number(ref.slice(1))) : undefined;
    const kind = ing?.price ? FC_UNITS[ing.price.pack_unit].dim : sub ? FC_UNITS[sub.yield_unit].dim : null;
    if (kind && FC_UNITS[u].dim !== kind) u = BASE[kind];
    setItem(n, { ref, unit: u });
  };

  const onSaved = (r: Saved, fresh: boolean) => {
    // the book in memory holds the saved recipe at once, so the page for it opens without waiting for the server again
    qc.setQueryData<Book>(BOOK, (b) => b && { ...b, recipes: [r.recipe, ...b.recipes.filter((x) => x.id !== r.recipe.id)], me: fresh ? { ...b.me, used: b.me.used + 1 } : b.me });
    void qc.invalidateQueries({ queryKey: ["fc"] });
  };
  const failed = (e: unknown) => {
    if (!(e instanceof ApiError)) return setProblem(t("err.generic"));
    if (e.code === "fc_limit") return setProblem(t("app.fc.limitReached", { limit: num(book.me.limit ?? 0) }));
    const fields: Record<string, string> = {};
    for (const [k, code] of Object.entries(e.fields ?? {})) {
      // "items.2.qty" is the third line sent: put it on the form line it came from
      const m = /^items\.(\d+)/.exec(k);
      const key = m ? `item${rows[Number(m[1])]}` : k;
      fields[key] = codeText(code, t, err);
    }
    setFieldErr(fields);
    setProblem(Object.keys(fields).length ? t("app.fc.fixFirst") : err(e.code));
  };

  const save = useMutation({
    mutationFn: () => (saved ? api<Saved>(`/fc/v1/recipes/${saved.id}`, { method: "PUT", json: input }) : api<Saved>("/fc/v1/recipes", { json: input })),
    onSuccess: (r) => {
      setProblem("");
      setFieldErr({});
      onSaved(r, !saved);
      toast(t("app.fc.saved"));
      if (!saved) navigate(`/foodcost/${r.recipe.id}`, { replace: true });
    },
    onError: failed,
  });
  const copy = useMutation({
    mutationFn: () => api<Saved>(`/fc/v1/recipes/${saved!.id}/duplicate`, { method: "POST" }),
    onSuccess: (r) => {
      onSaved(r, true);
      toast(t("app.fc.copied"));
      navigate(`/foodcost/${r.recipe.id}`);
    },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: () => api(`/fc/v1/recipes/${saved!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fc"] });
      toast(t("app.fc.deleted"));
      navigate("/foodcost");
    },
    onError: (e) => {
      setConfirmDelete(false);
      setProblem(e instanceof ApiError && e.code === "fc_in_use" ? t("app.fc.inUse", { name: e.fields?.used_by ?? "" }) : err(e instanceof ApiError ? e.code : "generic"));
    },
  });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!input.name) {
      setFieldErr({ name: t("err.required") });
      setProblem(t("app.fc.fixFirst"));
      return;
    }
    save.mutate();
  };

  const yieldWhat = f.yieldLabel.trim() || unit(f.yieldUnit);
  const counted = FC_UNITS[f.yieldUnit].dim === "count";

  return (
    <form className="fc-editor" onSubmit={submit} noValidate>
      <div className="page-head">
        <p className="fc-crumb">
          <Link className="link" to="/foodcost">
            {t("app.fc.title")}
          </Link>
        </p>
        <h1>{saved ? saved.name : t("app.fc.newTitle")}</h1>
      </div>

      <div className="fc-grid">
        <div className="fc-main">
          <section className="panel" aria-labelledby="fc-h-about">
            <h2 id="fc-h-about">{t("app.fc.about")}</h2>
            <Field id="fc-name" label={t("app.fc.name")} required error={fieldErr.name}>
              <TextInput id="fc-name" value={f.name} maxLength={120} placeholder={t("app.fc.namePh")} onChange={(e) => set({ name: e.target.value })} error={fieldErr.name} />
            </Field>
            <fieldset className="fc-yield">
              <legend>{t("app.fc.yield")}</legend>
              <div className="fc-yield-row">
                <Field id="fc-yq" label={t("app.fc.yieldQty")} error={fieldErr.yield_qty}>
                  <TextInput id="fc-yq" inputMode="decimal" value={f.yieldQty} placeholder="12" onChange={(e) => set({ yieldQty: e.target.value })} error={fieldErr.yield_qty} />
                </Field>
                <Field id="fc-yu" label={t("app.fc.unit")}>
                  <select id="fc-yu" className="input" value={f.yieldUnit} onChange={(e) => set({ yieldUnit: e.target.value as FcUnit })}>
                    {FC_UNIT_LIST.map((u) => (
                      <option key={u} value={u}>
                        {unit(u)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="fc-yl" label={t("app.fc.yieldLabel")} hint={t("app.fc.yieldLabelHint")}>
                  <TextInput id="fc-yl" value={f.yieldLabel} maxLength={40} placeholder={t("app.fc.yieldLabelPh")} onChange={(e) => set({ yieldLabel: e.target.value })} />
                </Field>
              </div>
              {counted && (
                <Field id="fc-og" label={t("app.fc.outputG")} hint={t("app.fc.outputGHint")}>
                  <TextInput id="fc-og" inputMode="decimal" value={f.outputG} onChange={(e) => set({ outputG: e.target.value })} />
                </Field>
              )}
            </fieldset>
          </section>

          <section className="panel" aria-labelledby="fc-h-lines">
            <h2 id="fc-h-lines">{t("app.fc.lines")}</h2>
            {book.ingredients.length === 0 && others.length === 0 && <p className="hint">{t("app.fc.noIngredients")}</p>}
            <ol className="fc-lines plain-list">
              {f.items.map((it, n) => {
                const k = lineOf(n);
                const line = k >= 0 ? result.lines[k] : undefined;
                const ing = it.ref[0] === "i" ? ingredients.get(Number(it.ref.slice(1))) : undefined;
                const units = ing ? fcUnitsFor(fcIngredient(ing, lang)) : FC_UNIT_LIST;
                const shown = units.includes(it.unit) ? units : [it.unit, ...units];
                return (
                  <li key={n} className="fc-line">
                    <div className="fc-line-what">
                      <label htmlFor={`fc-i${n}`}>{t("app.fc.lineN", { n: num(n + 1) })}</label>
                      <select id={`fc-i${n}`} className="input" value={it.ref} onChange={(e) => choose(n, e.target.value)}>
                        <option value="">{t("app.fc.choose")}</option>
                        {categories.map(([cat, list]) => (
                          <optgroup key={cat} label={cat || t("app.fc.otherCat")}>
                            {list
                              .filter((i) => i.active || `i${i.id}` === it.ref)
                              .map((i) => (
                                <option key={i.id} value={`i${i.id}`}>
                                  {ingName(i, lang)}
                                  {i.price ? "" : ` (${t("app.fc.noPriceShort")})`}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                        {others.length > 0 && (
                          <optgroup label={t("app.fc.myRecipes")}>
                            {others.map((r) => (
                              <option key={r.id} value={`r${r.id}`}>
                                {r.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                    <div className="fc-line-qty">
                      <label htmlFor={`fc-q${n}`}>{t("app.fc.qty")}</label>
                      <input id={`fc-q${n}`} className="input" inputMode="decimal" value={it.qty} aria-invalid={fieldErr[`item${n}`] ? true : undefined} onChange={(e) => setItem(n, { qty: e.target.value })} />
                    </div>
                    <div className="fc-line-unit">
                      <label htmlFor={`fc-u${n}`}>{t("app.fc.unit")}</label>
                      <select id={`fc-u${n}`} className="input" value={it.unit} onChange={(e) => setItem(n, { unit: e.target.value as FcUnit })}>
                        {shown.map((u) => (
                          <option key={u} value={u}>
                            {unit(u)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="fc-line-cost" aria-live="polite">
                      {line && !line.problem && (
                        <>
                          <b>{money(line.costMinor)}</b>
                          <small className="muted">{t("app.fc.share", { pct: num(line.sharePct) })}</small>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm fc-remove"
                      aria-label={t("app.fc.removeLine", { n: num(n + 1) })}
                      onClick={() => setF((x) => ({ ...x, items: x.items.length > 1 ? x.items.filter((_, j) => j !== n) : [fcNewItem()] }))}
                    >
                      <Icon name="trash" />
                    </button>
                    {(fieldErr[`item${n}`] || line?.problem) && (
                      <p className="err-text fc-line-err" role="alert">
                        {fieldErr[`item${n}`] ?? problemText({ code: line!.problem!, line: k }, result, rows, { t, num })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setF((x) => ({ ...x, items: [...x.items, fcNewItem()] }))}>
              <Icon name="plus" /> {t("app.fc.addLine")}
            </button>
          </section>

          <section className="panel" aria-labelledby="fc-h-costs">
            <h2 id="fc-h-costs">{t("app.fc.costs")}</h2>
            <p className="hint">{t("app.fc.costsHelp")}</p>
            {f.costs.length > 0 && (
              <ol className="fc-costs plain-list">
                {f.costs.map((c, n) => (
                  <li key={n} className="fc-cost">
                    <div>
                      <label htmlFor={`fc-ck${n}`}>{t("app.fc.costN", { n: num(n + 1) })}</label>
                      <select id={`fc-ck${n}`} className="input" value={c.kind} onChange={(e) => setCost(n, { kind: e.target.value as FcCostKind })}>
                        {FC_COST_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t(`app.fc.kind.${k}` as "app.fc.kind.packaging")}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`fc-cl${n}`}>{t("app.fc.costLabel")}</label>
                      <input id={`fc-cl${n}`} className="input" value={c.label} maxLength={60} onChange={(e) => setCost(n, { label: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor={`fc-ca${n}`}>{t("app.fc.amount")}</label>
                      <input id={`fc-ca${n}`} className="input" inputMode="decimal" value={c.amount} onChange={(e) => setCost(n, { amount: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor={`fc-cp${n}`}>{t("app.fc.per")}</label>
                      <select id={`fc-cp${n}`} className="input" value={c.per} onChange={(e) => setCost(n, { per: e.target.value as FcFormCost["per"] })}>
                        {FC_COST_PERS.map((p) => (
                          <option key={p} value={p}>
                            {t(`app.fc.per.${p}` as "app.fc.per.batch", { what: yieldWhat })}
                          </option>
                        ))}
                      </select>
                    </div>
                    {c.per === "hour" && (
                      <div>
                        <label htmlFor={`fc-ch${n}`}>{t("app.fc.hours")}</label>
                        <input id={`fc-ch${n}`} className="input" inputMode="decimal" value={c.hours} onChange={(e) => setCost(n, { hours: e.target.value })} />
                      </div>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm fc-remove" aria-label={t("app.fc.removeCost", { n: num(n + 1) })} onClick={() => setF((x) => ({ ...x, costs: x.costs.filter((_, j) => j !== n) }))}>
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <div className="row">
              {(
                [
                  ["packaging", "piece"],
                  ["labour", "hour"],
                  ["energy", "batch"],
                  ["other", "batch"],
                ] as const
              ).map(([kind, per]) => (
                <button key={kind} type="button" className="btn btn-outline btn-sm" onClick={() => setF((x) => ({ ...x, costs: [...x.costs, { kind, per, label: "", amount: "", hours: per === "hour" ? "1" : "" }] }))}>
                  <Icon name="plus" /> {t(`app.fc.kind.${kind}`)}
                </button>
              ))}
            </div>
          </section>

          <section className="panel" aria-labelledby="fc-h-price">
            <h2 id="fc-h-price">{t("app.fc.pricing")}</h2>
            <fieldset className="fc-mode">
              <legend>{t("app.fc.profitAs")}</legend>
              {(["markup", "margin"] as const).map((m) => (
                <label key={m} className="fc-radio">
                  <input type="radio" name="fc-mode" value={m} checked={f.mode === m} onChange={() => set({ mode: m })} />
                  <span>
                    <b>{t(`app.fc.mode.${m}`)}</b>
                    <small className="muted">{t(`app.fc.mode.${m}.d`)}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="fc-yield-row">
              <Field id="fc-pct" label={t("app.fc.pct")} error={fieldErr["pricing.pct"]}>
                <TextInput id="fc-pct" inputMode="decimal" value={f.pct} placeholder="40" onChange={(e) => set({ pct: e.target.value })} error={fieldErr["pricing.pct"]} />
              </Field>
              <Field id="fc-round" label={t("app.fc.roundTo")}>
                <select id="fc-round" className="input" value={f.roundTo} onChange={(e) => set({ roundTo: Number(e.target.value) })}>
                  {FC_ROUND_STEPS.map((s) => (
                    <option key={s} value={s}>
                      {s === 0 ? t("app.fc.noRounding") : money(s)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="fc-actual" label={t("app.fc.actual", { what: yieldWhat })} hint={t("app.fc.actualHint")}>
                <TextInput id="fc-actual" inputMode="decimal" value={f.actual} onChange={(e) => set({ actual: e.target.value })} />
              </Field>
            </div>
          </section>

          <section className="panel">
            <Field id="fc-notes" label={t("app.fc.notes")}>
              <textarea id="fc-notes" className="input" rows={3} maxLength={2000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </section>
        </div>

        <aside className="fc-side" aria-labelledby="fc-h-result">
          <div className="panel fc-result">
            <h2 id="fc-h-result" tabIndex={-1}>
              {t("app.fc.result")}
            </h2>
            <dl className="fc-figs" aria-live="polite">
              <div>
                <dt>{t("app.fc.oneBatch")}</dt>
                <dd>{money(result.batchMinor)}</dd>
              </div>
              <div className="big">
                <dt>{t("app.fc.costPer")}</dt>
                <dd>{per(result.perUnitMinor, f.yieldLabel.trim(), f.yieldUnit)}</dd>
              </div>
              {f.pct.trim() !== "" && (
                <div className="big accent">
                  <dt>{t(`app.fc.suggested.${f.mode}`, { pct: num(input.pricing.pct) })}</dt>
                  <dd>{per(result.suggestedMinor, f.yieldLabel.trim(), f.yieldUnit)}</dd>
                </div>
              )}
              {result.actual && (
                <>
                  <div className={result.actual.profitMinor < 0 ? "loss" : ""}>
                    <dt>{result.actual.profitMinor < 0 ? t("app.fc.lossEach") : t("app.fc.profitEach")}</dt>
                    <dd>{money(result.actual.profitMinor)}</dd>
                  </div>
                  <div className={result.actual.profitBatchMinor < 0 ? "loss" : ""}>
                    <dt>{t("app.fc.profitBatch")}</dt>
                    <dd>{money(result.actual.profitBatchMinor)}</dd>
                  </div>
                  <div>
                    <dt>{t("app.fc.realMargin")}</dt>
                    <dd>
                      {result.actual.marginPct === null ? "—" : `${num(result.actual.marginPct)}%`} · {t("app.fc.mode.markup")} {result.actual.markupPct === null ? "—" : `${num(result.actual.markupPct)}%`}
                    </dd>
                  </div>
                </>
              )}
            </dl>
            <table className="fc-split">
              <caption className="vh">{t("app.fc.split")}</caption>
              <tbody>
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
                    <tr key={k}>
                      <th scope="row">{k === "ingredients" ? t("app.fc.ingredientsCost") : t(`app.fc.kind.${k}`)}</th>
                      <td>{money(v)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!result.complete && (
              <div className="fc-warn" role="status">
                <b>{t("app.fc.partialLong")}</b>
                <ul>
                  {result.problems.map((p, n) => (
                    <li key={n}>{problemText(p, result, rows, { t, num })}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.complete && result.problems.length > 0 && (
              <ul className="fc-warn">
                {result.problems.map((p, n) => (
                  <li key={n}>{problemText(p, result, rows, { t, num })}</li>
                ))}
              </ul>
            )}
            {problem && (
              <p className="err-text" role="alert">
                {problem}
              </p>
            )}
            <div className="fc-buttons">
              <Button type="submit" busy={save.isPending}>
                {saved ? t("app.fc.save") : t("app.fc.saveNew")}
              </Button>
              {saved && (
                <>
                  <Button type="button" className="btn-outline" busy={copy.isPending} onClick={() => copy.mutate()}>
                    {t("app.fc.copy")}
                  </Button>
                  {confirmDelete ? (
                    <span className="fc-confirm" role="group" aria-label={t("app.fc.deleteAsk")}>
                      <span>{t("app.fc.deleteAsk")}</span>
                      <Button type="button" className="btn-danger btn-sm" busy={remove.isPending} onClick={() => remove.mutate()}>
                        {t("app.fc.deleteYes")}
                      </Button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                        {t("app.fc.deleteNo")}
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
                      <Icon name="trash" /> {t("app.fc.delete")}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      <button
        type="button"
        className="fc-bar"
        onClick={() => {
          const h = document.getElementById("fc-h-result");
          h?.scrollIntoView({ block: "start" });
          h?.focus({ preventScroll: true });
        }}
      >
        <span>
          {t("app.fc.costPer")} <b>{per(result.perUnitMinor, f.yieldLabel.trim(), f.yieldUnit)}</b>
        </span>
        {f.pct.trim() !== "" && (
          <span>
            {t("app.fc.priceAt")} <b>{per(result.suggestedMinor, f.yieldLabel.trim(), f.yieldUnit)}</b>
          </span>
        )}
        {!result.complete && <span className="chip pending">{t("app.fc.partial")}</span>}
      </button>
    </form>
  );
}

/* --------------------------------------------------------------------------------------------------------- ingredients & prices */

type PriceDraft = { qty: string; unit: FcUnit; taka: string; supplier: string; day: string };
const draftOf = (i: FcIngredientDTO | null): PriceDraft => ({
  qty: i?.price ? String(i.price.pack_qty) : "1",
  unit: i?.price?.pack_unit ?? "kg",
  taka: i?.price ? fcTakaText(i.price.price_minor) : "",
  supplier: i?.price?.supplier ?? "",
  day: i?.price?.bought_on ?? "",
});
const priceBody = (d: PriceDraft) => ({ pack_qty: fcParseNumber(d.qty) ?? 0, pack_unit: d.unit, price_minor: fcParseTaka(d.taka) ?? -1, supplier: d.supplier.trim(), bought_on: d.day || null });

function PriceFields({ id, d, onChange, errors }: { id: string; d: PriceDraft; onChange: (d: PriceDraft) => void; errors: Record<string, string> }) {
  const { t, unit } = useFc();
  return (
    <div className="fc-price-fields">
      <Field id={`${id}-q`} label={t("app.fc.pack")} error={errors.pack_qty}>
        <TextInput id={`${id}-q`} inputMode="decimal" value={d.qty} onChange={(e) => onChange({ ...d, qty: e.target.value })} error={errors.pack_qty} />
      </Field>
      <Field id={`${id}-u`} label={t("app.fc.unit")}>
        <select id={`${id}-u`} className="input" value={d.unit} onChange={(e) => onChange({ ...d, unit: e.target.value as FcUnit })}>
          {FC_UNIT_LIST.map((u) => (
            <option key={u} value={u}>
              {unit(u)}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-p`} label={t("app.fc.priceTk")} required error={errors.price_minor}>
        <TextInput id={`${id}-p`} inputMode="decimal" value={d.taka} onChange={(e) => onChange({ ...d, taka: e.target.value })} error={errors.price_minor} />
      </Field>
      <Field id={`${id}-s`} label={t("app.fc.supplier")}>
        <TextInput id={`${id}-s`} value={d.supplier} maxLength={80} onChange={(e) => onChange({ ...d, supplier: e.target.value })} />
      </Field>
      <Field id={`${id}-d`} label={t("app.fc.boughtOn")}>
        <TextInput id={`${id}-d`} type="date" value={d.day} onChange={(e) => onChange({ ...d, day: e.target.value })} />
      </Field>
    </div>
  );
}

const fieldsOf = (e: unknown, t: ReturnType<typeof useFc>["t"], err: (c: string) => string) => {
  const out: Record<string, string> = {};
  if (e instanceof ApiError) for (const [k, code] of Object.entries(e.fields ?? {})) out[k.replace(/^price\./, "")] = codeText(code, t, err);
  return out;
};

function PriceLine({ i }: { i: FcIngredientDTO }) {
  const { t, lang, money, unit, num } = useFc();
  if (!i.price) return <span className="muted">{t("app.fc.noPrice")}</span>;
  const ing = fcIngredient(i, lang);
  const base = BASE[FC_UNITS[i.price.pack_unit].dim];
  const each = unitCost(ing, base);
  return (
    <span>
      {t("app.fc.priceFor", { price: money(i.price.price_minor), qty: num(i.price.pack_qty), unit: unit(i.price.pack_unit) })}
      {each !== null && <small className="muted"> · {`${money(each)} / ${unit(base)}`}</small>}
    </span>
  );
}

function IngredientRow({ i }: { i: FcIngredientDTO }) {
  const { t, lang } = useFc();
  const { err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<PriceDraft>(() => draftOf(i));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const done = (text: string) => {
    void qc.invalidateQueries({ queryKey: ["fc"] });
    toast(text);
  };
  const setPrice = useMutation({
    mutationFn: () => api(`/fc/v1/prices/${i.id}`, { method: "PUT", json: priceBody(d) }),
    onSuccess: () => {
      setOpen(false);
      setErrors({});
      done(t("app.fc.priceSaved"));
    },
    onError: (e) => setErrors(fieldsOf(e, t, err)),
  });
  const back = useMutation({ mutationFn: () => api(`/fc/v1/prices/${i.id}`, { method: "DELETE" }), onSuccess: () => done(t("app.fc.backToDefaultDone")) });
  const remove = useMutation({
    mutationFn: () => api(`/fc/v1/ingredients/${i.id}`, { method: "DELETE" }),
    onSuccess: () => done(t("app.fc.ingredientDeleted")),
    onError: (e) => toast(e instanceof ApiError && e.code === "fc_in_use" ? t("app.fc.ingredientInUse") : err(e instanceof ApiError ? e.code : "generic"), true),
  });
  const name = ingName(i, lang);
  const other = lang === "bn" ? i.name_en : i.name_bn;
  return (
    <li className="fc-ing">
      <div className="fc-ing-head">
        <span>
          <b>{name}</b>
          {other && other !== name && <small className="muted"> · {other}</small>}
          {i.category && <small className="muted"> · {i.category}</small>}
          <br />
          <PriceLine i={i} />{" "}
          {i.price_source === "mine" && <span className="chip paid">{t("app.fc.myPrice")}</span>}
          {i.price_source === "default" && <span className="chip">{t("app.fc.dhakaAverage")}</span>}
          {i.price_source === "mine" && i.default_price && !i.own && (
            <small className="muted"> · {t("app.fc.averageIs", { price: fcMoney(i.default_price.price_minor, lang), qty: String(i.default_price.pack_qty), unit: FC_UNIT_NAMES[i.default_price.pack_unit][lang] })}</small>
          )}
        </span>
        <span className="row">
          <button type="button" className="btn btn-outline btn-sm" aria-expanded={open} aria-label={`${t("app.fc.setMyPrice")} — ${name}`} onClick={() => setOpen((x) => !x)}>
            {t("app.fc.setMyPrice")}
          </button>
          {i.price_source === "mine" && !i.own && (
            <Button type="button" className="btn-ghost btn-sm" busy={back.isPending} aria-label={`${t("app.fc.backToDefault")} — ${name}`} onClick={() => back.mutate()}>
              {t("app.fc.backToDefault")}
            </Button>
          )}
          {i.own && (
            <Button type="button" className="btn-ghost btn-sm" busy={remove.isPending} aria-label={`${t("app.fc.delete")} — ${name}`} onClick={() => remove.mutate()}>
              <Icon name="trash" />
            </Button>
          )}
        </span>
      </div>
      {open && (
        <form
          className="fc-price-form"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            setPrice.mutate();
          }}
        >
          <PriceFields id={`fc-p${i.id}`} d={d} onChange={setD} errors={errors} />
          <p className="hint">{i.own ? t("app.fc.ownPriceHint") : t("app.fc.myPriceHint")}</p>
          <div className="row">
            <Button type="submit" className="btn-primary btn-sm" busy={setPrice.isPending}>
              {t("app.fc.savePrice")}
            </Button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              {t("app.fc.cancel")}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function AddIngredient({ onDone }: { onDone: () => void }) {
  const { t } = useFc();
  const { err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [names, setNames] = useState({ bn: "", en: "", category: "", gml: "", gpc: "" });
  const [d, setD] = useState<PriceDraft>(() => draftOf(null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: () =>
      api("/fc/v1/ingredients", {
        json: {
          name_bn: names.bn.trim(),
          name_en: names.en.trim(),
          category: names.category.trim(),
          g_per_ml: fcParseNumber(names.gml),
          g_per_piece: fcParseNumber(names.gpc),
          price: d.taka.trim() ? priceBody(d) : null,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fc"] });
      toast(t("app.fc.ingredientAdded"));
      onDone();
    },
    onError: (e) => {
      const f = fieldsOf(e, t, err);
      setErrors(f);
      if (!Object.keys(f).length) toast(err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });
  return (
    <form
      className="panel fc-add"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        add.mutate();
      }}
    >
      <h2>{t("app.fc.addOwn")}</h2>
      <div className="fc-price-fields">
        <Field id="fc-n-bn" label={t("app.fc.nameBn")} error={errors.name_en}>
          <TextInput id="fc-n-bn" lang="bn" value={names.bn} maxLength={80} onChange={(e) => setNames({ ...names, bn: e.target.value })} />
        </Field>
        <Field id="fc-n-en" label={t("app.fc.nameEn")}>
          <TextInput id="fc-n-en" lang="en" value={names.en} maxLength={80} onChange={(e) => setNames({ ...names, en: e.target.value })} />
        </Field>
        <Field id="fc-n-cat" label={t("app.fc.category")}>
          <TextInput id="fc-n-cat" value={names.category} maxLength={40} onChange={(e) => setNames({ ...names, category: e.target.value })} />
        </Field>
        <Field id="fc-n-gml" label={t("app.fc.gPerMl")} hint={t("app.fc.gPerMlHint")}>
          <TextInput id="fc-n-gml" inputMode="decimal" value={names.gml} onChange={(e) => setNames({ ...names, gml: e.target.value })} />
        </Field>
        <Field id="fc-n-gpc" label={t("app.fc.gPerPiece")} hint={t("app.fc.gPerPieceHint")}>
          <TextInput id="fc-n-gpc" inputMode="decimal" value={names.gpc} onChange={(e) => setNames({ ...names, gpc: e.target.value })} />
        </Field>
      </div>
      <h3>{t("app.fc.itsPrice")}</h3>
      <PriceFields id="fc-n-p" d={d} onChange={setD} errors={errors} />
      <div className="row">
        <Button type="submit" busy={add.isPending}>
          {t("app.fc.addOwnSave")}
        </Button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          {t("app.fc.cancel")}
        </button>
      </div>
    </form>
  );
}

export function FcIngredients() {
  const { t, lang } = useFc();
  const q = useQuery({ queryKey: ["fc", "ingredients"], queryFn: () => api<{ ingredients: FcIngredientDTO[] }>("/fc/v1/ingredients") });
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const words = search.trim().toLowerCase();
  const shown = (q.data?.ingredients ?? []).filter((i) => (i.active || i.own) && (!words || `${i.name_bn} ${i.name_en} ${i.category}`.toLowerCase().includes(words)));
  const own = shown.filter((i) => i.own);
  const shared = shown.filter((i) => !i.own);
  return (
    <>
      <div className="page-head">
        <p className="fc-crumb">
          <Link className="link" to="/foodcost">
            {t("app.fc.title")}
          </Link>
        </p>
        <h1>{t("app.fc.ingredients")}</h1>
        <p>{t("app.fc.ingredientsSub")}</p>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <div className="row fc-actions">
            <div className="fc-search">
              <label className="vh" htmlFor="fc-search">
                {t("app.fc.search")}
              </label>
              <input id="fc-search" className="input" type="search" placeholder={t("app.fc.search")} value={search} onChange={(e) => setSearch(e.target.value)} lang={lang} />
            </div>
            {!adding && (
              <button type="button" className="btn btn-outline" onClick={() => setAdding(true)}>
                <Icon name="plus" /> {t("app.fc.addOwn")}
              </button>
            )}
          </div>
          {adding && <AddIngredient onDone={() => setAdding(false)} />}
          {own.length > 0 && (
            <section className="panel" aria-labelledby="fc-h-own">
              <h2 id="fc-h-own">{t("app.fc.ownList")}</h2>
              <ul className="plain-list fc-ings">
                {own.map((i) => (
                  <IngredientRow key={i.id} i={i} />
                ))}
              </ul>
            </section>
          )}
          <section className="panel" aria-labelledby="fc-h-shared">
            <h2 id="fc-h-shared">{t("app.fc.sharedList")}</h2>
            <p className="hint">{t("app.fc.sharedHelp")}</p>
            {shared.length === 0 ? (
              <p className="muted">{words ? t("app.fc.nothingFound") : t("app.fc.sharedEmpty")}</p>
            ) : (
              <ul className="plain-list fc-ings">
                {shared.map((i) => (
                  <IngredientRow key={i.id} i={i} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
