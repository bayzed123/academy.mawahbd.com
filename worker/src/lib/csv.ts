/**
 * CSV for the "export everywhere there is a list" requirement.
 *  - UTF-8 with a BOM so Excel opens Bangla text correctly
 *  - spreadsheet-formula injection is neutralised: cells that start with = + - @ (or tab/CR) are prefixed with '
 */
export interface CsvColumn<T> {
  key: string;
  label: string;
  value?: (row: T) => unknown;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => cell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.value ? c.value(r) : r[c.key])).join(",")).join("\r\n");
  return `﻿${head}\r\n${body}${rows.length ? "\r\n" : ""}`;
}

export function csvResponse(name: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
