import { fromBnDigits } from "./format";

/**
 * Reading a list of students that the owner pasted from a spreadsheet or chose as a CSV file, and reading the cells in it.
 * The browser turns the text into rows (so the file never leaves the computer until "Check my list" is pressed); the Worker
 * reads every cell again with the same functions and never trusts what the browser says about a row.
 */

export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_COLUMNS = 30;
export const IMPORT_MAX_CHARS = 1_500_000;
/** Rows the browser sends in one save request (the Worker accepts a few more). */
export const IMPORT_CHUNK = 20;

/* ============================================================================================ text -> rows */
export type Delimiter = "," | ";" | "\t";

/** Which character separates the columns: whichever appears most in the first line outside quotes (a tab means it came from a sheet). */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted) {
      if (ch === "\n" || ch === "\r") break;
      if (ch in counts) counts[ch as Delimiter]++;
    }
  }
  if (counts["\t"] > 0 && counts["\t"] >= counts[","] && counts["\t"] >= counts[";"]) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

export interface ParsedTable {
  /** the header line first, then the data lines; empty lines are gone */
  rows: string[][];
  delimiter: Delimiter;
  /** true when the text was cut because it was too long or had too many rows */
  truncated: boolean;
}

/** A CSV reader (RFC 4180) that also copes with a byte-order mark, CR / LF / CRLF line ends, doubled quotes and line breaks inside quotes. */
export function parseTable(input: string, delimiter?: Delimiter): ParsedTable {
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let truncated = false;
  if (text.length > IMPORT_MAX_CHARS) {
    text = text.slice(0, IMPORT_MAX_CHARS);
    truncated = true;
  }
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let started = false; // the current line has had any character at all (a blank line is not a row)
  let stop = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== "")) {
      if (rows.length >= IMPORT_MAX_ROWS + 1) {
        truncated = true;
        stop = true;
      } else rows.push(row.slice(0, IMPORT_MAX_COLUMNS));
    }
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length && !stop; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
      started = true;
    } else if (ch === sep) {
      endCell();
      started = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (started || cell !== "") endRow();
    } else {
      cell += ch;
      started = true;
    }
  }
  if (!stop && (started || cell !== "" || row.length)) endRow();
  return { rows, delimiter: sep, truncated };
}

/* ============================================================================================ columns */
export const IMPORT_FIELDS = ["name", "email", "phone", "language", "notes", "classes", "enrolled_on", "amount", "paid_on", "method", "txn_id"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** One line of the list, as text exactly as it was written in the sheet. */
export type ImportRowIn = Partial<Record<ImportField, string>>;

/** The names a column may carry in the first line (English and Bangla); compared without capitals, spaces, dashes or underscores. */
const HEADERS: Record<ImportField, string[]> = {
  name: ["name", "full name", "student", "student name", "নাম", "শিক্ষার্থীর নাম", "ছাত্রের নাম"],
  email: ["email", "e-mail", "email address", "mail", "ইমেইল", "ই-মেইল", "ইমেল", "ইমেইল ঠিকানা"],
  phone: ["phone", "mobile", "mobile number", "phone number", "contact", "whatsapp", "cell", "ফোন", "মোবাইল", "মোবাইল নম্বর", "ফোন নম্বর", "মোবাইল নাম্বার"],
  language: ["language", "lang", "locale", "ভাষা"],
  notes: ["notes", "note", "remarks", "remark", "comment", "comments", "নোট", "মন্তব্য"],
  classes: ["classes", "class", "course", "courses", "class name", "class slug", "enrolled in", "ক্লাস", "কোর্স", "ক্লাসের নাম"],
  enrolled_on: ["enrolled on", "enrolled_on", "enrol date", "enroll date", "enrolment date", "enrollment date", "joined", "joined on", "join date", "start date", "date", "ভর্তির তারিখ", "তারিখ", "যোগদানের তারিখ"],
  amount: ["amount", "amount paid", "paid amount", "price", "payment", "total", "fee", "টাকা", "পরিমাণ", "পেমেন্ট", "মোট টাকা"],
  paid_on: ["paid on", "paid_on", "payment date", "date paid", "পেমেন্টের তারিখ", "টাকা দেওয়ার তারিখ"],
  method: ["method", "payment method", "paid via", "paid by", "gateway", "মাধ্যম", "পদ্ধতি", "পেমেন্ট পদ্ধতি"],
  txn_id: ["txn id", "txn_id", "trx id", "trxid", "transaction id", "transaction", "reference", "ট্রানজ্যাকশন আইডি", "ট্রানজেকশন আইডি"],
};

const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s_\-./()*:]+/g, "");
const LOOKUP = new Map<string, ImportField>();
for (const f of IMPORT_FIELDS) for (const h of HEADERS[f]) LOOKUP.set(squash(h), f);

export interface ColumnMap {
  /** for each column of the sheet: the field it fills, or null when it is not used */
  fields: (ImportField | null)[];
  found: ImportField[];
  /** headings that were not recognised (or repeated), so the screen can say they are left out */
  ignored: string[];
}

export function mapColumns(header: string[]): ColumnMap {
  const seen = new Set<ImportField>();
  const fields: (ImportField | null)[] = [];
  const ignored: string[] = [];
  for (const h of header) {
    const f = LOOKUP.get(squash(h)) ?? null;
    if (f && !seen.has(f)) {
      seen.add(f);
      fields.push(f);
    } else {
      fields.push(null);
      if (h.trim()) ignored.push(h.trim());
    }
  }
  return { fields, found: [...seen], ignored };
}

/** The data lines of a parsed table as rows keyed by field. Lines without a single used cell are dropped. */
export function tableToRows(table: string[][], map: ColumnMap): ImportRowIn[] {
  const out: ImportRowIn[] = [];
  for (const line of table.slice(1)) {
    const row: ImportRowIn = {};
    let any = false;
    map.fields.forEach((f, i) => {
      if (!f) return;
      const v = (line[i] ?? "").trim();
      if (v) any = true;
      row[f] = v;
    });
    if (any) out.push(row);
  }
  return out;
}

/** The header and one example line of the template people download; Excel opens it correctly because of the byte-order mark. */
export const IMPORT_TEMPLATE = {
  header: ["name", "email", "phone", "language", "classes", "enrolled_on", "amount", "paid_on", "method", "txn_id", "notes"],
  example: ["Rina Akter", "rina@example.com", "01712345678", "bn", "beginners-baking-class", "2024-03-15", "1500", "2024-03-15", "bkash", "8N7A6D5E", "Joined by WhatsApp group"],
} as const;

export function templateCsv(): string {
  const line = (cells: readonly string[]) => cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",");
  return `﻿${line(IMPORT_TEMPLATE.header)}\r\n${line(IMPORT_TEMPLATE.example)}\r\n`;
}

/* ============================================================================================ cells */
/** Comparison key for a class name: no capitals, no punctuation, one space between words; Bangla letters and their vowel signs are kept. */
export function normKey(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"‘’“”`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/** The cell of a "classes" column as separate entries: split at ; | and line breaks (a comma is handled by the caller, which can look the names up). */
export function splitClassCell(cell: string): string[] {
  return cell
    .split(/[;|\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type DateProblem = "invalid_date" | "date_in_future" | "date_too_old";
export const EARLIEST_DATE = "2000-01-01";
const MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * A date as people write it in Bangladesh: 2024-03-15, 15/03/2024, 15-03-2024, 15.03.2024, 15 Mar 2024, 15-Mar-2024, March 15, 2024 —
 * or a plain spreadsheet date number. The day always comes first (never the American order). A time after the date is ignored.
 * `today` is today's date in Dhaka as YYYY-MM-DD; a date after it is refused.
 */
export function parseLooseDate(input: string, today: string): { ok: true; date: string } | { ok: false; code: DateProblem } {
  const s = fromBnDigits(input).trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s?[ap]m)?$/i, "").replace(/T\d{2}:\d{2}.*$/, "").trim();
  let date: string | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) date = ymd(+m[1], +m[2], +m[3]);
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) date = ymd(+m[3], +m[2], +m[1]);
  else if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/))) date = MONTHS[m[2].toLowerCase()] ? ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) : null;
  else if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) date = MONTHS[m[1].toLowerCase()] ? ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) : null;
  else if (/^\d{5}$/.test(s) && +s >= 36526 && +s <= 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + +s * 86_400_000); // a spreadsheet's day number
    date = ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (!date) return { ok: false, code: "invalid_date" };
  if (date > today) return { ok: false, code: "date_in_future" };
  if (date < EARLIEST_DATE) return { ok: false, code: "date_too_old" };
  return { ok: true, date };
}

export const MAX_PAST_AMOUNT = 1_000_000;

/** Whole taka from "1500", "1,500", "১৫০০", "৳1500", "1500 tk", "1500/-" or "1500.00". Anything else (letters, cents, minus) is refused. */
export function parseAmount(input: string): { ok: true; amount: number } | { ok: false } {
  const s = fromBnDigits(input)
    .toLowerCase()
    .replace(/৳|taka|bdt|tk\.?|টাকা|\/-/g, "")
    .replace(/[\s,]/g, "");
  const m = s.match(/^(\d{1,9})(?:\.0+)?$/);
  if (!m) return { ok: false };
  const amount = Number(m[1]);
  return amount > MAX_PAST_AMOUNT ? { ok: false } : { ok: true, amount };
}

/** How a past payment was made. The first four are real payment channels; the rest are recorded as a manual payment. */
export const PAST_METHODS = ["bkash", "nagad", "rocket", "card", "cash", "bank", "other"] as const;
export type PastMethod = (typeof PAST_METHODS)[number];

/** The method named in a cell ("bKash", "বিকাশ", "Nagad", "cash in hand", "bank transfer" …); anything unknown counts as "other". */
export function methodFromText(input: string): PastMethod {
  const s = input.normalize("NFKC").toLowerCase().trim();
  if (/bkash|bikash|বিকাশ/.test(s)) return "bkash";
  if (/rocket|রকেট/.test(s)) return "rocket";
  if (/card|visa|master|কার্ড/.test(s)) return "card";
  if (/cash|ক্যাশ|হাতে|সরাসরি|নগদ\s*টাকা/.test(s)) return "cash"; // "নগদ" alone is Nagad; "নগদ টাকা" is cash money
  if (/nagad|নগদ/.test(s)) return "nagad";
  if (/bank|ব্যাংক|ব্যাঙ্ক|eft|cheque|transfer/.test(s)) return "bank";
  return "other";
}

/** "bn" / "en" from the way people write it; null when the cell says something else. */
export function languageFromText(input: string): "bn" | "en" | null {
  const s = input.normalize("NFKC").toLowerCase().trim();
  if (/^(bn|bangla|bengali|বাংলা|বাঙলা)$/.test(s)) return "bn";
  if (/^(en|english|eng|ইংরেজি|ইংলিশ)$/.test(s)) return "en";
  return null;
}

/* ============================================================================================ what the Worker answers */
export type ProblemCode =
  | "required"
  | "invalid_email"
  | "too_long"
  | "invalid_phone"
  | "invalid_language"
  | "class_not_found"
  | "class_ambiguous"
  | "invalid_date"
  | "date_in_future"
  | "date_too_old"
  | "invalid_amount"
  | "amount_needs_class"
  | "trx_used";
export interface ImportProblem {
  field: ImportField;
  code: ProblemCode;
  /** the text that caused it, when that helps ("Class “Cake” was not found") */
  value?: string;
}

export type WarningCode = "merged_with_row" | "payment_skipped" | "kept_details";
export interface ImportWarning {
  code: WarningCode;
  value?: string;
}

export interface ImportRowResult {
  /** the position of the line in the request (0 is the first line sent) */
  index: number;
  status: "new" | "existing" | "problem";
  name: string;
  email: string;
  classes: { id: number; title_bn: string; title_en: string; already: boolean }[];
  payment: { amount: number; paid_on: string; method: PastMethod } | null;
  problems: ImportProblem[];
  warnings: ImportWarning[];
}

export interface ImportSummary {
  new_students: number;
  existing_students: number;
  problem_rows: number;
  classes_added: number;
  payments: number;
  amount: number;
}
