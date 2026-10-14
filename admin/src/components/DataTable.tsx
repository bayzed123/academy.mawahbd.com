import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PageInfo } from "../lib/types";
import { adm, qstring } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Empty, ErrorState, Icon, Select, Spinner, useDebounced } from "./ui";

export interface Column<T> {
  key: string;
  label: string;
  /** server-side sort field; omit for non-sortable columns */
  sort?: string;
  render?: (row: T) => ReactNode;
  className?: string;
  /** hide below 760px so the table stays readable on a phone */
  desktopOnly?: boolean;
}

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface Props<T> {
  endpoint: string;
  columns: Column<T>[];
  filters?: FilterDef[];
  searchPlaceholder?: string;
  defaultSort?: string;
  /** show a "Download CSV" button (the Worker serves `${endpoint}/export.csv` with the same filters) */
  csv?: boolean;
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
  emptyTitle?: string;
  extraParams?: Record<string, string | undefined>;
  perPage?: number;
  /** two date inputs bound to ?from=&to= (Dhaka calendar days) */
  dateRange?: boolean;
  /** extra content under the toolbar that depends on the response (e.g. totals) */
  summary?: (data: { items: T[]; page: PageInfo } & Record<string, unknown>) => ReactNode;
  queryKey?: unknown[];
}

/**
 * Server-side list used by every admin module: search, filters, sorting, pagination and CSV export.
 * The state lives in the URL (?q=&status=&page=&sort=), so a filtered view can be bookmarked, shared with a
 * colleague, or linked from the dashboard ("3 payments waiting" opens Orders already filtered).
 */
export function DataTable<T extends { id: number }>({ endpoint, columns, filters = [], searchPlaceholder, defaultSort, csv, toolbar, onRowClick, rowActions, emptyTitle, extraParams = {}, perPage = 20, summary, queryKey = [], dateRange }: Props<T>) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const debounced = useDebounced(text);
  const page = Number(params.get("page") ?? 1) || 1;
  const sort = params.get("sort") ?? defaultSort ?? "";

  // push the debounced search into the URL (and back to page 1)
  useEffect(() => {
    if (debounced === q) return;
    const next = new URLSearchParams(params);
    if (debounced) next.set("q", debounced);
    else next.delete("q");
    next.delete("page");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const query: Record<string, string | number | undefined> = { q: q || undefined, page, per_page: perPage, sort: sort || undefined, ...extraParams };
  for (const f of filters) query[f.key] = params.get(f.key) ?? extraParams[f.key] ?? undefined;
  if (dateRange) {
    query.from = params.get("from") ?? undefined;
    query.to = params.get("to") ?? undefined;
  }

  const list = useQuery({
    queryKey: [endpoint, query, ...queryKey],
    queryFn: () => adm<{ items: T[]; page: PageInfo } & Record<string, unknown>>(`${endpoint}${qstring(query)}`),
    placeholderData: keepPreviousData,
  });

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!("page" in patch)) next.delete("page");
    setParams(next);
  };

  const toggleSort = (field: string) => update({ sort: sort === field ? `-${field}` : sort === `-${field}` ? null : field });
  const exportHref = `/api/admin${endpoint}/export.csv${qstring({ ...query, page: undefined, per_page: undefined })}`;
  const data = list.data;
  const info = data?.page;

  return (
    <div className="table-wrap">
      <div className="table-bar">
        <div className="search">
          <Icon name="search" />
          <input type="search" className="input" placeholder={searchPlaceholder ?? t("btn.search")} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("btn.search")} />
        </div>
        {filters.map((f) => (
          <Select key={f.key} aria-label={f.label} value={params.get(f.key) ?? ""} onChange={(e) => update({ [f.key]: e.target.value || null })}>
            <option value="">{f.label}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ))}
        {dateRange && (
          <div className="date-range">
            <input type="date" className="input" aria-label={t("adm.f.from")} value={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value || null })} />
            <span>→</span>
            <input type="date" className="input" aria-label={t("adm.f.to")} value={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value || null })} />
          </div>
        )}
        <div className="grow" />
        {csv && (
          <a className="btn btn-outline btn-sm" href={exportHref} download>
            <Icon name="download" /> {t("adm.csv")}
          </a>
        )}
        {toolbar}
      </div>

      {data && summary?.(data)}

      {list.isPending && <Spinner />}
      {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {data && data.items.length === 0 && <Empty icon="search" title={emptyTitle ?? t("label.noResults")} />}
      {data && data.items.length > 0 && (
        <div className={`table-scroll${list.isPlaceholderData ? " stale" : ""}`}>
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={`${c.className ?? ""}${c.desktopOnly ? " desk" : ""}`} aria-sort={c.sort && (sort === c.sort ? "ascending" : sort === `-${c.sort}` ? "descending" : "none") || undefined}>
                    {c.sort ? (
                      <button type="button" className="th-btn" onClick={() => toggleSort(c.sort!)}>
                        {c.label}
                        <span className="sort-ind" aria-hidden="true">
                          {sort === c.sort ? "▲" : sort === `-${c.sort}` ? "▼" : ""}
                        </span>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
                {rowActions && <th className="actions-col" />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr
                  key={row.id}
                  className={onRowClick ? "clickable" : ""}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick(row)) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`${c.className ?? ""}${c.desktopOnly ? " desk" : ""}`} data-label={c.label}>
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                      {rowActions(row)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {info && info.total > 0 && (
        <div className="pager">
          <span className="muted">{t("adm.pager.total", { n: info.total })}</span>
          <div className="row">
            <button type="button" className="btn btn-outline btn-sm" disabled={info.page <= 1} onClick={() => update({ page: String(info.page - 1) })}>
              ← {t("btn.previous")}
            </button>
            <span>{t("adm.pager.page", { n: info.page, total: info.pages })}</span>
            <button type="button" className="btn btn-outline btn-sm" disabled={info.page >= info.pages} onClick={() => update({ page: String(info.page + 1) })}>
              {t("btn.next")} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
