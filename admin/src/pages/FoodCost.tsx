import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fromBnDigits } from "@mawah/shared";
import { FC_UNITS, FC_UNIT_LIST, FC_UNIT_NAMES, fcMoney, isFcUnit, unitCost, type FcPriceDTO, type FcUnit } from "@mawah/shared/foodcost";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, Empty, ErrorState, Field, PageHeader, Panel, Select, SlideOver, Spinner, Switch, Tabs, TextArea, TextInput, useDebounced, useFieldErrors, useToast } from "../components/ui";

/*
 * Admin → FoodCost (docs/foodcost.md): the shared ingredient list each user's recipes start from, with its default prices — the current Dhaka
 * average, one row per change so there is a history — pasted from a spreadsheet or added one by one; and the users, with their plan. Staff never
 * see anyone's recipes or own prices here.
 */

interface SharedIngredient {
  id: number;
  name_bn: string;
  name_en: string;
  category: string;
  g_per_ml: number | null;
  g_per_piece: number | null;
  active: boolean;
  sort: number;
  prices: number;
  used_in: number;
  default_price: FcPriceDTO | null;
}
interface WorkspaceRow {
  id: number;
  student_id: number;
  code: string;
  name: string;
  plan_now: "free" | "pro";
  plan_until: string | null;
  recipes: number;
  created_at: string;
}

type Tab = "ingredients" | "paste" | "workspaces";

/** "120.50" or "১২০.৫০" taka → paisa; null when it is not a number. */
const toPaisa = (text: string): number | null => {
  const n = Number(fromBnDigits(text.trim()).replace(/,/g, ""));
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const toNumber = (text: string): number | null => {
  const n = Number(fromBnDigits(text.trim()).replace(/,/g, ""));
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
/** The base unit a price is shared out per, in its own dimension (a gram, a millilitre, a piece). */
const BASE: Record<string, FcUnit> = { mass: "g", volume: "ml", count: "piece" };

export function FoodCost() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("ingredients");
  return (
    <>
      <PageHeader title={t("adm.nav.foodcost")} sub={t("adm.fc.sub")} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "ingredients", label: t("adm.fc.tabIngredients") },
          { value: "paste", label: t("adm.fc.tabPaste") },
          { value: "workspaces", label: t("adm.fc.tabWorkspaces") },
        ]}
      />
      {tab === "ingredients" && <Ingredients />}
      {tab === "paste" && <Paste onDone={() => setTab("ingredients")} />}
      {tab === "workspaces" && <Workspaces />}
    </>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- the shared list */

function Ingredients() {
  const { t, lang, num, date } = useI18n();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["fc-ingredients"], queryFn: () => adm<{ items: SharedIngredient[] }>("/fc/ingredients") });
  const [editing, setEditing] = useState<SharedIngredient | "new" | null>(null);

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data.items;
  const name = (i: SharedIngredient) => (lang === "bn" ? i.name_bn || i.name_en : i.name_en || i.name_bn);
  const priceText = (p: FcPriceDTO) => t("adm.fc.priceFor", { price: fcMoney(p.price_minor, lang), qty: num(p.pack_qty), unit: FC_UNIT_NAMES[p.pack_unit][lang] });

  return (
    <Panel
      actions={
        can("fc:write") ? (
          <Button className="btn-primary btn-sm" onClick={() => setEditing("new")}>
            {t("adm.fc.add")}
          </Button>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <Empty icon="book" title={t("adm.fc.none")}>
          <p>{t("adm.fc.noneBody")}</p>
        </Empty>
      ) : (
        <div className="table-wrap table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t("adm.fc.colName")}</th>
                <th>{t("adm.fc.colCategory")}</th>
                <th>{t("adm.fc.colPrice")}</th>
                <th>{t("adm.fc.colUnitCost")}</th>
                <th>{t("adm.fc.colMeasures")}</th>
                <th>{t("adm.fc.colUsed")}</th>
                <th>{t("adm.fc.colStatus")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const p = i.default_price;
                const base = p ? BASE[FC_UNITS[p.pack_unit].dim] : null;
                const each = p && base ? unitCost({ id: i.id, name: "", price: { packQty: p.pack_qty, packUnit: p.pack_unit, priceMinor: p.price_minor } }, base) : null;
                return (
                  <tr key={i.id}>
                    <td>
                      <b>{name(i)}</b>
                      {lang === "bn" ? i.name_en && <small className="muted"> · {i.name_en}</small> : i.name_bn && <small className="muted"> · {i.name_bn}</small>}
                    </td>
                    <td>{i.category}</td>
                    <td>
                      {p ? (
                        <>
                          {priceText(p)}
                          <br />
                          <small className="muted">{t("adm.fc.since", { date: date(p.bought_on ?? p.at) })}</small>
                        </>
                      ) : (
                        <Chip tone="warn">{t("adm.fc.noPrice")}</Chip>
                      )}
                    </td>
                    <td>{each !== null && base ? t("adm.fc.perUnit", { price: fcMoney(each, lang), unit: FC_UNIT_NAMES[base][lang] }) : "—"}</td>
                    <td>
                      {i.g_per_ml ? `${num(i.g_per_ml)} g/ml` : "—"} · {i.g_per_piece ? `${num(i.g_per_piece)} g` : "—"}
                    </td>
                    <td>{num(i.used_in)}</td>
                    <td>{i.active ? <Chip tone="ok">{t("adm.fc.on")}</Chip> : <Chip>{t("adm.fc.off")}</Chip>}</td>
                    <td>
                      {can("fc:write") && (
                        <Button className="btn-outline btn-sm" onClick={() => setEditing(i)} aria-label={`${t("btn.edit")} — ${name(i)}`}>
                          {t("btn.edit")}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <SlideOver open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? t("adm.fc.new") : editing ? t("adm.fc.editOf", { name: name(editing) }) : ""} wide>
        {editing && <IngredientEditor ingredient={editing === "new" ? null : editing} onSaved={() => setEditing(null)} />}
      </SlideOver>
    </Panel>
  );
}

/** A unit picker, with each unit's name in the reader's language. */
function UnitSelect({ id, value, onChange, disabled }: { id: string; value: FcUnit; onChange: (u: FcUnit) => void; disabled?: boolean }) {
  const { lang } = useI18n();
  return (
    <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as FcUnit)}>
      {FC_UNIT_LIST.map((u) => (
        <option key={u} value={u}>
          {FC_UNIT_NAMES[u][lang]}
        </option>
      ))}
    </Select>
  );
}

function IngredientEditor({ ingredient, onSaved }: { ingredient: SharedIngredient | null; onSaved: () => void }) {
  const { t, lang, num, date } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const canWrite = can("fc:write");
  const [f, setF] = useState({
    name_bn: ingredient?.name_bn ?? "",
    name_en: ingredient?.name_en ?? "",
    category: ingredient?.category ?? "",
    g_per_ml: ingredient?.g_per_ml ? String(ingredient.g_per_ml) : "",
    g_per_piece: ingredient?.g_per_piece ? String(ingredient.g_per_piece) : "",
    sort: String(ingredient?.sort ?? 100),
    active: ingredient?.active ?? true,
  });
  const [price, setPrice] = useState({ pack_qty: "1", pack_unit: "kg" as FcUnit, taka: "", supplier: "", bought_on: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const history = useQuery({
    queryKey: ["fc-price-history", ingredient?.id],
    queryFn: () => adm<{ history: FcPriceDTO[] }>(`/fc/ingredients/${ingredient!.id}/prices`),
    enabled: !!ingredient,
  });

  const priceBody = () => {
    if (!price.taka.trim()) return null;
    return { pack_qty: toNumber(price.pack_qty) ?? 0, pack_unit: price.pack_unit, price_minor: toPaisa(price.taka) ?? -1, supplier: price.supplier.trim(), bought_on: price.bought_on || null };
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["fc-ingredients"] });
    void qc.invalidateQueries({ queryKey: ["fc-price-history", ingredient?.id] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name_bn: f.name_bn.trim(),
        name_en: f.name_en.trim(),
        category: f.category.trim(),
        g_per_ml: toNumber(f.g_per_ml),
        g_per_piece: toNumber(f.g_per_piece),
        sort: Math.max(0, Math.round(Number(fromBnDigits(f.sort)) || 0)),
        active: f.active,
        // a new ingredient may come with its first price; an existing one gets a new price with its own button
        ...(ingredient ? {} : { price: priceBody() }),
      };
      return ingredient ? adm(`/fc/ingredients/${ingredient.id}`, { method: "PUT", json: body }) : adm("/fc/ingredients", { method: "POST", json: body });
    },
    onSuccess: () => {
      toast(t("adm.saved"));
      refresh();
      onSaved();
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });
  const newPrice = useMutation({
    mutationFn: () => adm(`/fc/ingredients/${ingredient!.id}/price`, { method: "POST", json: priceBody() }),
    onSuccess: () => {
      toast(t("adm.fc.priceSaved"));
      setPrice((p) => ({ ...p, taka: "", supplier: "" }));
      setErrors({});
      refresh();
    },
    onError: (e) => setErrors(Object.fromEntries(Object.entries(fieldErrors(e)).map(([k, v]) => [`price.${k}`, v]))),
  });

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        save.mutate();
      }}
      noValidate
    >
      <div className="form-grid">
        <Field id="fc-name-bn" label={t("adm.fc.nameBn")} error={errors.name_bn}>
          <TextInput id="fc-name-bn" value={f.name_bn} disabled={!canWrite} maxLength={80} onChange={(e) => set("name_bn", e.target.value)} />
        </Field>
        <Field id="fc-name-en" label={t("adm.fc.nameEn")} error={errors.name_en}>
          <TextInput id="fc-name-en" value={f.name_en} disabled={!canWrite} maxLength={80} onChange={(e) => set("name_en", e.target.value)} />
        </Field>
        <Field id="fc-category" label={t("adm.fc.category")} hint={t("adm.fc.categoryHint")} error={errors.category}>
          <TextInput id="fc-category" value={f.category} disabled={!canWrite} maxLength={40} onChange={(e) => set("category", e.target.value)} />
        </Field>
        <Field id="fc-sort" label={t("adm.fc.sort")} error={errors.sort}>
          <TextInput id="fc-sort" inputMode="numeric" value={f.sort} disabled={!canWrite} onChange={(e) => set("sort", e.target.value)} />
        </Field>
        <Field id="fc-gml" label={t("adm.fc.gPerMl")} hint={t("adm.fc.gPerMlHint")} error={errors.g_per_ml}>
          <TextInput id="fc-gml" inputMode="decimal" value={f.g_per_ml} disabled={!canWrite} onChange={(e) => set("g_per_ml", e.target.value)} />
        </Field>
        <Field id="fc-gpc" label={t("adm.fc.gPerPiece")} hint={t("adm.fc.gPerPieceHint")} error={errors.g_per_piece}>
          <TextInput id="fc-gpc" inputMode="decimal" value={f.g_per_piece} disabled={!canWrite} onChange={(e) => set("g_per_piece", e.target.value)} />
        </Field>
      </div>
      <div className="stack">
        <Switch id="fc-active" checked={f.active} disabled={!canWrite} onChange={(v) => set("active", v)} label={t("adm.fc.active")} />
        <p className="hint">{t("adm.fc.activeHint")}</p>
      </div>

      <section style={{ marginTop: 18 }} aria-labelledby="fc-price-title">
        <h3 id="fc-price-title">{t("adm.fc.price")}</h3>
        <p className="hint">{t("adm.fc.priceHint")}</p>
        {ingredient?.default_price && (
          <p>
            <b>{t("adm.fc.priceFor", { price: fcMoney(ingredient.default_price.price_minor, lang), qty: num(ingredient.default_price.pack_qty), unit: FC_UNIT_NAMES[ingredient.default_price.pack_unit][lang] })}</b>{" "}
            <small className="muted">{t("adm.fc.since", { date: date(ingredient.default_price.bought_on ?? ingredient.default_price.at) })}</small>
          </p>
        )}
        <div className="form-grid">
          <Field id="fc-pack" label={t("adm.fc.packQty")} error={errors["price.pack_qty"]}>
            <TextInput id="fc-pack" inputMode="decimal" value={price.pack_qty} disabled={!canWrite} onChange={(e) => setPrice((p) => ({ ...p, pack_qty: e.target.value }))} />
          </Field>
          <Field id="fc-unit" label={t("adm.fc.packUnit")} error={errors["price.pack_unit"]}>
            <UnitSelect id="fc-unit" value={price.pack_unit} disabled={!canWrite} onChange={(u) => setPrice((p) => ({ ...p, pack_unit: u }))} />
          </Field>
          <Field id="fc-taka" label={t("adm.fc.priceTaka")} error={errors["price.price_minor"]}>
            <TextInput id="fc-taka" inputMode="decimal" value={price.taka} disabled={!canWrite} onChange={(e) => setPrice((p) => ({ ...p, taka: e.target.value }))} />
          </Field>
          <Field id="fc-supplier" label={t("adm.fc.supplier")} error={errors["price.supplier"]}>
            <TextInput id="fc-supplier" value={price.supplier} disabled={!canWrite} maxLength={80} onChange={(e) => setPrice((p) => ({ ...p, supplier: e.target.value }))} />
          </Field>
          <Field id="fc-date" label={t("adm.fc.boughtOn")} error={errors["price.bought_on"]}>
            <TextInput id="fc-date" type="date" value={price.bought_on} disabled={!canWrite} onChange={(e) => setPrice((p) => ({ ...p, bought_on: e.target.value }))} />
          </Field>
        </div>
        {ingredient && canWrite && (
          <Button type="button" className="btn-outline btn-sm" busy={newPrice.isPending} disabled={!price.taka.trim()} onClick={() => newPrice.mutate()}>
            {t("adm.fc.setPrice")}
          </Button>
        )}
        {ingredient && (
          <>
            <h4 style={{ marginTop: 16 }}>{t("adm.fc.history")}</h4>
            {history.data?.history.length ? (
              <ul className="plain-list">
                {history.data.history.map((p, n) => (
                  <li key={n}>
                    {t("adm.fc.priceFor", { price: fcMoney(p.price_minor, lang), qty: num(p.pack_qty), unit: FC_UNIT_NAMES[p.pack_unit][lang] })} ·{" "}
                    <small className="muted">
                      {date(p.bought_on ?? p.at)}
                      {p.supplier ? ` · ${p.supplier}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t("adm.fc.historyNone")}</p>
            )}
          </>
        )}
      </section>

      {canWrite && (
        <div className="row" style={{ marginTop: 18 }}>
          <Button className="btn-primary" type="submit" busy={save.isPending}>
            {t("btn.save")}
          </Button>
        </div>
      )}
    </form>
  );
}

/* --------------------------------------------------------------------------------------------------------------- a pasted list */

interface PastedRow {
  name_bn: string;
  name_en: string;
  category: string;
  g_per_ml: number | null;
  g_per_piece: number | null;
  price: { pack_qty: number; pack_unit: FcUnit; price_minor: number } | null;
}

/** One line of the pasted table → a row, or the reason it cannot be one. Columns: bn · en · category · pack · unit · taka · g/ml · g/piece. */
function readLine(line: string, t: ReturnType<typeof useI18n>["t"]): { row?: PastedRow; why?: string } {
  const cols = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
  const [name_bn = "", name_en = "", category = "", pack = "", unitText = "", taka = "", gml = "", gpc = ""] = cols;
  if (!name_bn && !name_en) return { why: t("adm.fc.pasteNoName") };
  const numberOrNull = (v: string): number | null | "bad" => (v ? (toNumber(v) ?? "bad") : null);
  const g_per_ml = numberOrNull(gml);
  const g_per_piece = numberOrNull(gpc);
  if (g_per_ml === "bad") return { why: t("adm.fc.pasteBadNumber", { value: gml }) };
  if (g_per_piece === "bad") return { why: t("adm.fc.pasteBadNumber", { value: gpc }) };
  let price: PastedRow["price"] = null;
  if (taka) {
    const unit = unitText.toLowerCase();
    if (!isFcUnit(unit)) return { why: t("adm.fc.pasteBadUnit", { unit: unitText }) };
    const packQty = toNumber(pack || "1");
    const minor = toPaisa(taka);
    if (packQty === null) return { why: t("adm.fc.pasteBadNumber", { value: pack }) };
    if (minor === null) return { why: t("adm.fc.pasteBadNumber", { value: taka }) };
    price = { pack_qty: packQty, pack_unit: unit, price_minor: minor };
  }
  return { row: { name_bn, name_en, category, g_per_ml, g_per_piece, price } };
}

/** At most this many rows go in one request: the server's own limit (FC_IMPORT_MAX_ROWS in worker/src/routes/api/admin/foodcost.ts). */
const PART = 200;
/** A long list stopped after some parts were saved: the message says how many. */
class PartlySaved extends Error {}

function Paste({ onDone }: { onDone: () => void }) {
  const { t, lang, num } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [read, setRead] = useState<{ rows: PastedRow[]; bad: { line: number; why: string }[] } | null>(null);
  const example = "ময়দা\tFlour\tFlour\t1\tkg\t120\t0.53\t\nচিনি\tSugar\tSugar\t1\tkg\t140\t0.85\t\nডিম\tEgg\tDairy & eggs\t1\tdozen\t150\t\t50";

  const send = useMutation({
    // the server takes PART rows at a time, so a long list goes in parts; a name in an earlier part is known to the later ones
    mutationFn: async () => {
      const rows = read!.rows;
      const sum = { added: 0, updated: 0, priced: 0 };
      for (let from = 0; from < rows.length; from += PART) {
        try {
          const r = await adm<{ added: number; updated: number; priced: number }>("/fc/ingredients/import", { method: "POST", json: { rows: rows.slice(from, from + PART) } });
          sum.added += r.added;
          sum.updated += r.updated;
          sum.priced += r.priced;
        } catch (e) {
          if (from === 0) throw e;
          throw new PartlySaved(t("adm.fc.pastePartly", { saved: num(from), why: e instanceof ApiError ? e.message : t("err.generic") }));
        }
      }
      return sum;
    },
    onSuccess: (r) => {
      toast(t("adm.fc.pasteDone", { added: num(r.added), updated: num(r.updated), priced: num(r.priced) }));
      setText("");
      setRead(null);
      onDone();
    },
    onError: (e) => toast(e instanceof ApiError || e instanceof PartlySaved ? e.message : t("err.generic"), true),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["fc-ingredients"] }),
  });

  return (
    <Panel title={t("adm.fc.pasteTitle")}>
      <p className="hint">{t("adm.fc.pasteHelp")}</p>
      <p className="hint">{t("adm.fc.pasteUnits", { units: FC_UNIT_LIST.map((u) => (lang === "bn" ? `${u} (${FC_UNIT_NAMES[u].bn})` : u)).join(", ") })}</p>
      <Field id="fc-paste" label={t("adm.fc.pasteTitle")}>
        <TextArea id="fc-paste" rows={8} value={text} disabled={!can("fc:write")} placeholder={example} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="row">
        <Button
          className="btn-outline"
          disabled={!text.trim()}
          onClick={() => {
            const rows: PastedRow[] = [];
            const bad: { line: number; why: string }[] = [];
            // a line is not trimmed: a leading Tab is an empty first column (no Bangla name), not nothing
            text.split(/\r?\n/).forEach((line, n) => {
              if (!line.trim()) return;
              const r = readLine(line, t);
              if (r.row) rows.push(r.row);
              else bad.push({ line: n + 1, why: r.why! });
            });
            setRead({ rows, bad });
          }}
        >
          {t("adm.fc.pasteRead")}
        </Button>
        <Button className="btn-ghost" onClick={() => setText(example)}>
          {t("adm.fc.pasteExample")}
        </Button>
      </div>
      {read && (
        <div style={{ marginTop: 16 }} aria-live="polite">
          <p>{t("adm.fc.pasteRows", { n: num(read.rows.length) })}</p>
          {read.bad.map((b) => (
            <p key={b.line} className="err-text" role="alert">
              {t("adm.fc.pasteRowBad", { row: num(b.line), why: b.why })}
            </p>
          ))}
          {read.rows.length > 0 && (
            <>
              <div className="table-wrap table-scroll">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>{t("adm.fc.nameBn")}</th>
                      <th>{t("adm.fc.nameEn")}</th>
                      <th>{t("adm.fc.category")}</th>
                      <th>{t("adm.fc.colPrice")}</th>
                      <th>{t("adm.fc.colMeasures")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {read.rows.map((r, n) => (
                      <tr key={n}>
                        <td>{r.name_bn}</td>
                        <td>{r.name_en}</td>
                        <td>{r.category}</td>
                        <td>{r.price ? t("adm.fc.priceFor", { price: fcMoney(r.price.price_minor, lang), qty: num(r.price.pack_qty), unit: FC_UNIT_NAMES[r.price.pack_unit][lang] }) : "—"}</td>
                        <td>
                          {r.g_per_ml ? `${num(r.g_per_ml)} g/ml` : "—"} · {r.g_per_piece ? `${num(r.g_per_piece)} g` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {can("fc:write") && (
                <Button className="btn-primary" busy={send.isPending} onClick={() => send.mutate()} style={{ marginTop: 12 }}>
                  {t("adm.fc.pasteImport")}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ the users */

function Workspaces() {
  const { t, num, date } = useI18n();
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const list = useQuery({ queryKey: ["fc-workspaces", q], queryFn: () => adm<{ items: WorkspaceRow[] }>(`/fc/workspaces${q ? `?q=${encodeURIComponent(q)}` : ""}`) });

  return (
    <Panel>
      <p className="hint">{t("adm.fc.wsLimits")}</p>
      <p className="hint">{t("adm.fc.wsNote")}</p>
      <Field id="fc-ws-search" label={t("adm.fc.wsSearch")}>
        <TextInput id="fc-ws-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <Empty icon="users" title={t("adm.fc.wsNone")} />
      ) : (
        <div className="table-wrap table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t("adm.fc.wsStudent")}</th>
                <th>{t("adm.fc.wsPlan")}</th>
                <th>{t("adm.fc.wsRecipes")}</th>
                <th>{t("adm.fc.wsSince")}</th>
                {can("fc:plans") && <th />}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((w) => (
                <tr key={w.id}>
                  <td>
                    <b>{w.name}</b> <small className="muted">· {w.code}</small>
                  </td>
                  <td>
                    {w.plan_now === "pro" ? <Chip tone="gold">{w.plan_until ? t("adm.fc.wsProUntil", { date: date(w.plan_until) }) : t("adm.fc.wsPro")}</Chip> : <Chip>{t("adm.fc.wsFree")}</Chip>}
                  </td>
                  <td>{num(w.recipes)}</td>
                  <td>{date(w.created_at)}</td>
                  {can("fc:plans") && (
                    <td>
                      <PlanControl workspace={w} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function PlanControl({ workspace }: { workspace: WorkspaceRow }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [until, setUntil] = useState("");
  const [error, setError] = useState("");
  const change = useMutation({
    mutationFn: (plan: "free" | "pro") => adm(`/fc/workspaces/${workspace.id}/plan`, { method: "PUT", json: { plan, until: plan === "pro" && until ? until : null } }),
    onSuccess: () => {
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["fc-workspaces"] });
    },
    onError: (e) => setError(e instanceof ApiError ? err(e.fields?.until ?? e.code) : t("err.generic")),
  });
  const id = `fc-until-${workspace.id}`;
  const busy = change.isPending;
  return workspace.plan_now === "pro" ? (
    <Button className="btn-ghost btn-sm" busy={busy} onClick={() => change.mutate("free")}>
      {t("adm.fc.wsTake")}
    </Button>
  ) : (
    <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
      <Field id={id} label={t("adm.fc.wsUntil")} error={error}>
        <TextInput id={id} type="date" value={until} onChange={(e) => {
            setUntil(e.target.value);
            setError("");
          }} />
      </Field>
      <Button className="btn-outline btn-sm" busy={busy} onClick={() => change.mutate("pro")}>
        {t("adm.fc.wsGive")}
      </Button>
    </div>
  );
}
