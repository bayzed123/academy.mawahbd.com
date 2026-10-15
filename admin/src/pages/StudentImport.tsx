import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router";
import { IMPORT_CHUNK, IMPORT_MAX_ROWS, IMPORT_FIELDS, mapColumns, parseTable, templateCsv, type ColumnMap, type ImportRowIn, type ImportRowResult, type ImportSummary } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useClassOptions } from "../components/StudentForms";
import { Button, Chip, ErrorState, Icon, PageHeader, Panel, Progress, Spinner, Switch, TextArea } from "../components/ui";

/** One line of the pasted list, with the line it came from in the sheet (the header is line 1). */
interface Line {
  line: number;
  row: ImportRowIn;
  cells: string[];
}

function readLines(table: string[][], map: ColumnMap): Line[] {
  const out: Line[] = [];
  table.slice(1).forEach((cells, i) => {
    const row: ImportRowIn = {};
    let any = false;
    map.fields.forEach((f, c) => {
      if (!f) return;
      const v = (cells[c] ?? "").trim();
      if (v) any = true;
      row[f] = v;
    });
    if (any) out.push({ line: i + 2, row, cells });
  });
  return out;
}

const csvCell = (c: string) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const NO_TOTALS: ImportSummary = { new_students: 0, existing_students: 0, problem_rows: 0, classes_added: 0, payments: 0, amount: 0 };

export function StudentImport() {
  const { t, pick, money, num } = useI18n();
  const classes = useClassOptions();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ results: ImportRowResult[]; summary: ImportSummary } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [saved, setSaved] = useState<ImportSummary | null>(null);
  const [stopped, setStopped] = useState<{ done: number; total: number } | null>(null);

  const table = useMemo(() => parseTable(text), [text]);
  const map = useMemo(() => mapColumns(table.rows[0] ?? []), [table]);
  const lines = useMemo(() => (table.rows.length > 1 ? readLines(table.rows, map) : []), [table, map]);
  const hasKey = map.found.includes("name") && map.found.includes("email");
  const lineOf = (index: number) => lines[index]?.line ?? index + 2;

  const reset = () => {
    setPreview(null);
    setSaved(null);
    setStopped(null);
    setError("");
  };
  const onText = (value: string) => {
    setText(value);
    reset();
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    onText(await f.text());
  };

  const problemText = (p: { field: string; code: string; value?: string }) =>
    `${t(`adm.imp.field.${p.field}` as "adm.imp.field.name")}: ${t(`adm.imp.p.${p.code}` as "adm.imp.p.required", { value: p.value ?? "" })}`;

  const check = async () => {
    setChecking(true);
    reset();
    try {
      setPreview(await adm<{ results: ImportRowResult[]; summary: ImportSummary }>("/students/import/preview", { json: { rows: lines.map((l) => l.row) } }));
    } catch (e) {
      setError(e instanceof ApiError && e.code !== "validation" ? t(`err.${e.code}` as "err.generic") : t("err.generic"));
    } finally {
      setChecking(false);
    }
  };

  const addable = preview ? preview.results.filter((r) => r.status !== "problem") : [];
  const save = async () => {
    if (!preview) return;
    const rows = addable.map((r) => lines[r.index].row);
    const total = rows.length;
    const totals: ImportSummary = { ...NO_TOTALS };
    setSaved(null);
    setStopped(null);
    setSaving({ done: 0, total });
    let done = 0;
    try {
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
        const part = rows.slice(i, i + IMPORT_CHUNK);
        const r = await adm<{ summary: ImportSummary }>("/students/import", { json: { rows: part } });
        totals.new_students += r.summary.new_students;
        totals.existing_students += r.summary.existing_students;
        totals.classes_added += r.summary.classes_added;
        totals.payments += r.summary.payments;
        totals.amount += r.summary.amount;
        done += part.length;
        setSaving({ done, total });
      }
      totals.problem_rows = preview.results.length - addable.length;
      setSaved(totals);
    } catch {
      setStopped({ done, total });
    } finally {
      setSaving(null);
    }
  };

  const downloadProblems = () => {
    if (!preview) return;
    const bad = preview.results.filter((r) => r.status === "problem");
    const header = [...(table.rows[0] ?? []), t("adm.imp.problemColumn")];
    const body = bad.map((r) => [...(lines[r.index]?.cells ?? []), r.problems.map(problemText).join(" | ")]);
    download("students-to-fix.csv", `﻿${[header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`);
  };

  const shown = preview ? (onlyProblems ? preview.results.filter((r) => r.status === "problem") : preview.results) : [];
  const busy = checking || !!saving;

  return (
    <>
      <PageHeader
        title={t("adm.imp.title")}
        sub={t("adm.imp.sub")}
        back={
          <Link className="link" to="/students">
            {t("adm.imp.back")}
          </Link>
        }
      />
      <div className="stack import-flow">
        <Panel title={t("adm.imp.step1")}>
          <p>{t("adm.imp.prep")}</p>
          <div className="row">
            <Button className="btn-outline" onClick={() => download("students-template.csv", templateCsv())}>
              <Icon name="download" /> {t("adm.imp.template")}
            </Button>
          </div>
          <h4>{t("adm.imp.colsHead")}</h4>
          <table className="table compact cols-table">
            <thead>
              <tr>
                <th scope="col">{t("adm.imp.colName")}</th>
                <th scope="col">{t("adm.imp.colWhat")}</th>
              </tr>
            </thead>
            <tbody>
              {IMPORT_FIELDS.map((f) => (
                <tr key={f}>
                  <th scope="row">
                    <code>{f}</code>
                  </th>
                  <td>{t(`adm.imp.col.${f}` as "adm.imp.col.name")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>{t("adm.imp.classesRef")}</h4>
          <p className="hint">{t("adm.imp.classesRefHelp")}</p>
          {classes.isPending && <Spinner />}
          {classes.isError && <ErrorState error={classes.error} onRetry={() => classes.refetch()} />}
          {classes.data && (
            <div className="ref-scroll" tabIndex={0} role="region" aria-label={t("adm.imp.classesRef")}>
              <table className="table compact">
                <thead>
                  <tr>
                    <th scope="col">{t("adm.imp.refClass")}</th>
                    <th scope="col">{t("adm.imp.refSlug")}</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.data.items.map((c) => (
                    <tr key={c.id}>
                      <td>{pick(c, "title")}</td>
                      <td>
                        <code>{c.slug}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={t("adm.imp.step2")}>
          <label htmlFor="imp-paste" className="label">
            {t("adm.imp.paste")}
          </label>
          <TextArea id="imp-paste" rows={8} spellCheck={false} value={text} onChange={(e) => onText(e.target.value)} />
          <div className="row">
            <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden aria-label={t("adm.imp.orFile")} onChange={(e) => void onFile(e)} />
            <Button className="btn-outline" onClick={() => fileInput.current?.click()}>
              <Icon name="file" /> {t("adm.imp.orFile")}
            </Button>
            {text && (
              <Button className="btn-ghost" onClick={() => onText("")}>
                {t("adm.imp.clear")}
              </Button>
            )}
          </div>
          <p className="hint">{t("adm.imp.private")}</p>
          {text && (
            <div aria-live="polite">
              <p>
                <b>{t("adm.imp.found", { n: num(lines.length) })}</b>
              </p>
              {map.found.length > 0 && <p>{t("adm.imp.used", { list: map.found.map((f) => t(`adm.imp.field.${f}` as "adm.imp.field.name")).join(", ") })}</p>}
              {map.ignored.length > 0 && <p className="muted">{t("adm.imp.ignored", { list: map.ignored.join(", ") })}</p>}
              {!hasKey && <p className="err-text">{t("adm.imp.noKey")}</p>}
              {table.truncated && <p className="err-text">{t("adm.imp.cut", { max: num(IMPORT_MAX_ROWS) })}</p>}
            </div>
          )}
        </Panel>

        <Panel title={t("adm.imp.step3")}>
          <div className="row">
            <Button className="btn-primary" busy={checking} disabled={!hasKey || lines.length === 0 || !!saving} onClick={() => void check()}>
              {checking ? t("adm.imp.checking") : t("adm.imp.check")}
            </Button>
          </div>
          {error && (
            <p className="err-text" role="alert">
              {error}
            </p>
          )}
          {preview && (
            <div aria-live="polite">
              <div className="imp-sum">
                <Chip tone="ok">{t("adm.imp.sumNew", { n: num(preview.summary.new_students) })}</Chip>
                <Chip tone="info">{t("adm.imp.sumExisting", { n: num(preview.summary.existing_students) })}</Chip>
                <Chip tone={preview.summary.problem_rows ? "bad" : "neutral"}>{t("adm.imp.sumProblem", { n: num(preview.summary.problem_rows) })}</Chip>
                <Chip tone="gold">{t("adm.imp.sumClasses", { n: num(preview.summary.classes_added) })}</Chip>
                <Chip tone="gold">{t("adm.imp.sumPayments", { n: num(preview.summary.payments), amount: money(preview.summary.amount) })}</Chip>
              </div>
              {preview.summary.problem_rows > 0 && (
                <div className="row">
                  <Switch id="imp-only" checked={onlyProblems} onChange={setOnlyProblems} label={t("adm.imp.onlyProblems")} />
                  <Button className="btn-outline" onClick={downloadProblems}>
                    <Icon name="download" /> {t("adm.imp.downloadProblems")}
                  </Button>
                </div>
              )}
              <div className="imp-scroll" tabIndex={0} role="region" aria-label={t("adm.imp.step3")}>
                <table className="table compact imp-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("adm.imp.line")}</th>
                      <th scope="col">{t("adm.imp.student")}</th>
                      <th scope="col">{t("adm.imp.cls")}</th>
                      <th scope="col">{t("adm.imp.what")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.index} className={`imp-${r.status}`}>
                        <td className="num">{lineOf(r.index)}</td>
                        <td>
                          <b>{r.name || "—"}</b>
                          <br />
                          <small>{r.email}</small>
                        </td>
                        <td>
                          {r.classes.map((c) => (
                            <div key={c.id}>
                              {pick(c, "title")} {c.already && <Chip tone="neutral">{t("adm.stu.has")}</Chip>}
                            </div>
                          ))}
                        </td>
                        <td>
                          <b>{t(`adm.imp.status.${r.status}` as "adm.imp.status.new")}</b>
                          {r.payment && <div>{t("adm.imp.paid", { amount: money(r.payment.amount), date: r.payment.paid_on })}</div>}
                          {r.problems.map((p, i) => (
                            <div key={i} className="err-text">
                              {problemText(p)}
                            </div>
                          ))}
                          {r.warnings.map((w, i) => (
                            <div key={i} className="muted small">
                              {t(`adm.imp.w.${w.code}` as "adm.imp.w.kept_details", { value: w.value && /^\d+$/.test(w.value) ? lineOf(Number(w.value) - 1) : (w.value ?? "") })}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>

        <Panel title={t("adm.imp.step4")}>
          {!preview && <p className="muted">{t("adm.imp.noneToAdd")}</p>}
          {preview && addable.length === 0 && <p className="muted">{t("adm.imp.noneToAdd")}</p>}
          {preview && addable.length > 0 && !saved && (
            <div className="row">
              <Button className="btn-primary" busy={!!saving} disabled={busy} onClick={() => void save()}>
                {saving ? t("adm.imp.adding", { done: num(saving.done), total: num(saving.total) }) : t("adm.imp.add", { n: num(addable.length) })}
              </Button>
            </div>
          )}
          {saving && <Progress pct={saving.total ? Math.round((saving.done / saving.total) * 100) : 0} label={t("adm.imp.adding", { done: num(saving.done), total: num(saving.total) })} />}
          {stopped && (
            <p className="err-text" role="alert">
              {t("adm.imp.stopped", { done: num(stopped.done), total: num(stopped.total) })}
            </p>
          )}
          {saved && (
            <div className="notice ok" role="status">
              <Icon name="check" />
              <div>
                <b>{t("adm.imp.doneTitle")}</b>
                <p>{t("adm.imp.doneBody", { added: num(saved.new_students), existing: num(saved.existing_students), classes: num(saved.classes_added), payments: num(saved.payments), amount: money(saved.amount) })}</p>
                {saved.problem_rows > 0 && <p>{t("adm.imp.doneProblems", { n: num(saved.problem_rows) })}</p>}
                <h4>{t("adm.imp.nextHead")}</h4>
                <p>{t("adm.imp.next")}</p>
                <div className="row">
                  <Link className="btn btn-primary btn-sm" to="/students?source=import">
                    {t("adm.imp.see")}
                  </Link>
                  <Button
                    className="btn-outline"
                    onClick={() => {
                      onText("");
                    }}
                  >
                    {t("adm.imp.again")}
                  </Button>
                  {saved.problem_rows > 0 && (
                    <Button className="btn-outline" onClick={downloadProblems}>
                      <Icon name="download" /> {t("adm.imp.downloadProblems")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
