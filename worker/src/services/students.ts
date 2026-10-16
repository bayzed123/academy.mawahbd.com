import {
  dhakaDayStamp,
  languageFromText,
  methodFromText,
  normalizeAnyPhone,
  normKey,
  parseAmount,
  parseLooseDate,
  splitClassCell,
  type ImportField,
  type ImportProblem,
  type ImportRowIn,
  type ImportRowResult,
  type ImportSummary,
  type ImportWarning,
  type PastMethod,
} from "@mawah/shared";
import type { Env } from "../env";
import { generatePublicOrderId } from "../lib/crypto";
import { all, first, nowIso, qs } from "../lib/db";
import { conflict, HttpError } from "../lib/http";
import { sendMail, welcomeMail } from "../lib/mailer";
import { emailSchema } from "../lib/schemas";
import { createPasswordResetLink } from "./auth";
import { allocate } from "./orders";

/*
 * Students the owner adds by hand or imports from a spreadsheet: people who studied before the website existed (or paid in cash).
 * A student can get a class with or without a payment on record. A recorded payment is a normal PAID order — it shows in Orders
 * and in the income reports on the day it was really paid, with the next invoice number of that day — but no e-mail is sent.
 */

export interface ClassRef {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  price: number;
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const oneLine = (v: string | undefined) => (v ?? "").replace(CONTROL, "").replace(/\s+/g, " ").trim();

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Today's date in Dhaka, YYYY-MM-DD. */
export function dhakaToday(now: Date = new Date()): string {
  const d = dhakaDayStamp(now);
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** A day typed by staff, as a moment: today is right now; an earlier day is noon in Dhaka (06:00 UTC) on that day. */
export function dayAsMoment(day: string, now: Date = new Date()): string {
  return day >= dhakaToday(now) ? nowIso(now) : `${day}T06:00:00Z`;
}

/** The orders table knows bkash / nagad / rocket / card / manual; cash, bank and the rest are recorded as manual payments. */
const dbMethod = (m: PastMethod): "bkash" | "nagad" | "rocket" | "card" | "manual" => (m === "bkash" || m === "nagad" || m === "rocket" || m === "card" ? m : "manual");

const METHOD_WORDS: Record<PastMethod, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", card: "card", cash: "cash", bank: "bank transfer", other: "other" };

/* ================================================================================ giving a class (with or without a payment) */
export interface SalePlan {
  publicId: string;
  total: number;
  method: PastMethod;
  txn: string | null;
  paidAt: string;
  note: string;
  items: { course: ClassRef; price: number }[];
}

export interface AccessPlan {
  /** the student, by e-mail (unique) — so the same statements work for someone who is created in the very same batch */
  email: string;
  /** only the classes the student does not have yet */
  grant: ClassRef[];
  at: string;
  sale: SalePlan | null;
}

/** The statements that record a payment (order, gapless invoice number, items) and open the classes; one D1 batch runs them together or not at all. */
export function accessStatements(env: Env, p: AccessPlan): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  const s = p.sale;
  if (s) {
    const day = dhakaDayStamp(new Date(s.paidAt));
    out.push(
      env.DB.prepare(
        `INSERT INTO orders (public_id, student_id, status, subtotal, discount, total, method, gateway, gateway_txn, customer_name, customer_email, customer_phone,
                             note, paid_at, paid_claim, created_at, updated_at)
         SELECT ?1, st.id, 'paid', ?2, 0, ?2, ?3, 'manual', ?4, st.name, st.email, COALESCE(st.phone, ''), ?5, ?6, ?1, ?6, ?6 FROM students st WHERE st.email = ?7`,
      ).bind(s.publicId, s.total, dbMethod(s.method), s.txn, s.note, s.paidAt, p.email),
      env.DB.prepare(
        `INSERT INTO invoice_counters (day, last_seq) SELECT ?1, 1 WHERE EXISTS (SELECT 1 FROM orders WHERE public_id = ?2 AND invoice_no IS NULL)
         ON CONFLICT(day) DO UPDATE SET last_seq = last_seq + 1`,
      ).bind(day, s.publicId),
      env.DB.prepare(
        `UPDATE orders SET invoice_no = ?1 || printf('%04d', (SELECT last_seq FROM invoice_counters WHERE day = ?2)) WHERE public_id = ?3 AND invoice_no IS NULL`,
      ).bind(`INV-${env.BRAND_CODE}-${day}-`, day, s.publicId),
    );
    for (const it of s.items) {
      out.push(
        env.DB.prepare("INSERT INTO order_items (order_id, course_id, title_bn, title_en, list_price, price) SELECT o.id, ?2, ?3, ?4, ?5, ?5 FROM orders o WHERE o.public_id = ?1").bind(
          s.publicId,
          it.course.id,
          it.course.title_bn,
          it.course.title_en,
          it.price,
        ),
      );
    }
  }
  for (const c of p.grant) {
    out.push(
      env.DB.prepare(
        `INSERT INTO enrollments (student_id, course_id, order_id, status, source, enrolled_at)
         SELECT st.id, ?1, (SELECT id FROM orders WHERE public_id = ?2), 'active', ?3, ?4 FROM students st WHERE st.email = ?5
         ON CONFLICT(student_id, course_id) DO UPDATE SET status = 'active', revoked_at = NULL,
           order_id = COALESCE(excluded.order_id, enrollments.order_id),
           source = CASE WHEN excluded.order_id IS NOT NULL THEN 'purchase' ELSE enrollments.source END,
           enrolled_at = CASE WHEN enrollments.status = 'revoked' THEN excluded.enrolled_at ELSE enrollments.enrolled_at END`,
      ).bind(c.id, s?.publicId ?? null, s ? "purchase" : "admin", p.at, p.email),
    );
  }
  return out;
}

function saleNote(method: PastMethod, rawMethod: string, ref: string): string {
  const parts = ["Recorded by staff (a payment made earlier)", `paid by ${METHOD_WORDS[method]}`];
  if (rawMethod && (method === "other" || method === "bank" || method === "cash")) parts.push(`as written: ${rawMethod.slice(0, 40)}`);
  if (ref) parts.push(`reference: ${ref.slice(0, 40)}`);
  return parts.join(" · ");
}

/** A transaction id the live manual-payment form would also accept; anything else is kept in the order's note instead of the unique column. */
export function cleanTxn(raw: string): { txn: string | null; ref: string } {
  const t = raw.replace(CONTROL, "").trim();
  return /^[A-Za-z0-9]{6,24}$/.test(t) ? { txn: t.toUpperCase(), ref: "" } : { txn: null, ref: t };
}

function makeSale(courses: ClassRef[], amount: number, method: PastMethod, rawMethod: string, txnRaw: string, paidAt: string): SalePlan {
  const { txn, ref } = cleanTxn(txnRaw);
  const weights = courses.map((c) => c.price);
  const prices = allocate(amount, weights.some((w) => w > 0) ? weights : weights.map(() => 1)); // free classes share the amount equally
  return {
    publicId: generatePublicOrderId(),
    total: amount,
    method,
    txn,
    paidAt,
    note: saleNote(method, rawMethod, ref),
    items: courses.map((course, i) => ({ course, price: prices[i] })),
  };
}

const invalid = (fields: Record<string, string>) => new HttpError(422, "validation", "validation", fields);

export interface GrantInput {
  courseIds: number[];
  /** YYYY-MM-DD */
  enrolledOn?: string | undefined;
  payment?: { amount: number; method: PastMethod; txn: string; paidOn?: string | undefined } | null | undefined;
}

function checkDay(day: string | undefined, key: string, now: Date): void {
  if (day === undefined) return;
  const r = parseLooseDate(day, dhakaToday(now));
  if (!r.ok) throw invalid({ [key]: r.code });
}

/** Work out what giving these classes means for this student — what they already have, what is new, what the payment covers — and refuse anything wrong before writing. */
export async function planAccess(env: Env, email: string, haveIds: Set<number>, input: GrantInput, now: Date = new Date()): Promise<{ plan: AccessPlan | null; skipped: ClassRef[] }> {
  const ids = [...new Set(input.courseIds)];
  const pay = input.payment && input.payment.amount > 0 ? input.payment : null;
  if (ids.length === 0) {
    if (pay) throw invalid({ "payment.amount": "amount_needs_class" });
    return { plan: null, skipped: [] };
  }
  checkDay(input.enrolledOn, "enrolled_on", now);
  checkDay(pay?.paidOn, "payment.paid_on", now);

  const courses = await all<ClassRef>(env.DB, `SELECT id, slug, title_bn, title_en, price FROM courses WHERE id IN (${qs(ids.length)}) AND deleted_at IS NULL ORDER BY id`, ...ids);
  if (courses.length !== ids.length) throw invalid({ course_ids: "invalid" });
  const grant = courses.filter((c) => !haveIds.has(c.id));
  const skipped = courses.filter((c) => haveIds.has(c.id));
  if (grant.length === 0) return { plan: null, skipped };

  const day = input.enrolledOn ?? dhakaToday(now);
  const at = dayAsMoment(day, now);
  let sale: SalePlan | null = null;
  if (pay) {
    const { txn } = cleanTxn(pay.txn);
    if (txn && (await first(env.DB, "SELECT id FROM orders WHERE gateway = 'manual' AND gateway_txn = ?", txn))) throw conflict("trx_used", { "payment.txn_id": "trx_used" });
    sale = makeSale(grant, pay.amount, pay.method, "", pay.txn, dayAsMoment(pay.paidOn ?? day, now));
  }
  return { plan: { email, grant, at, sale }, skipped };
}

export interface NewStudent {
  name: string;
  email: string;
  phone: string | null;
  locale: "bn" | "en";
  notes: string;
  marketing: boolean;
}

function studentInsert(env: Env, s: NewStudent, source: "admin" | "import", createdAt: string, ignoreClash: boolean): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO students (email, name, phone, locale, notes, source, marketing_opt_in, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)${ignoreClash ? " ON CONFLICT(email) DO NOTHING" : ""}`,
  ).bind(s.email, s.name, s.phone, s.locale, s.notes, source, s.marketing ? 1 : 0, createdAt);
}

/** A new student the owner adds by hand, optionally with classes (and a payment) in the same step — all saved together or not at all. */
export async function createStudent(env: Env, s: NewStudent, input: GrantInput, now: Date = new Date()): Promise<{ id: number; granted: number }> {
  if (await first(env.DB, "SELECT id FROM students WHERE email = ?", s.email)) throw conflict("email_taken", { email: "email_taken" });
  const { plan } = await planAccess(env, s.email, new Set(), input, now);
  try {
    await env.DB.batch([studentInsert(env, s, "admin", plan?.at ?? nowIso(now), false), ...(plan ? accessStatements(env, plan) : [])]);
  } catch (err) {
    if (/students\.email/.test(String(err))) throw conflict("email_taken", { email: "email_taken" });
    if (/orders\.gateway/.test(String(err))) throw conflict("trx_used", { "payment.txn_id": "trx_used" });
    throw err;
  }
  const row = await first<{ id: number }>(env.DB, "SELECT id FROM students WHERE email = ?", s.email);
  return { id: row!.id, granted: plan?.grant.length ?? 0 };
}

/** Give an existing student one or more classes now or on an earlier date; classes they already have are left as they are. */
export async function grantAccess(env: Env, studentId: number, input: GrantInput, now: Date = new Date()): Promise<{ granted: ClassRef[]; skipped: ClassRef[]; invoice_no: string | null }> {
  const student = await first<{ email: string }>(env.DB, "SELECT email FROM students WHERE id = ?", studentId);
  if (!student) throw new HttpError(404, "not_found");
  const ids = [...new Set(input.courseIds)];
  const have = new Set<number>();
  if (ids.length) for (const r of await all<{ course_id: number }>(env.DB, `SELECT course_id FROM enrollments WHERE student_id = ? AND status = 'active' AND course_id IN (${qs(ids.length)})`, studentId, ...ids)) have.add(r.course_id);
  const { plan, skipped } = await planAccess(env, student.email, have, input, now);
  if (!plan) return { granted: [], skipped, invoice_no: null };
  try {
    await env.DB.batch(accessStatements(env, plan));
  } catch (err) {
    if (/orders\.gateway/.test(String(err))) throw conflict("trx_used", { "payment.txn_id": "trx_used" });
    throw err;
  }
  const invoice = plan.sale ? await first<{ invoice_no: string | null }>(env.DB, "SELECT invoice_no FROM orders WHERE public_id = ?", plan.sale.publicId) : null;
  return { granted: plan.grant, skipped, invoice_no: invoice?.invoice_no ?? null };
}

/* ================================================================================ the way in for a new student: set a password */
export const INVITE_DAYS = 3;

/** A link for the student to choose a password (valid for three days) — sent by e-mail, or handed back so staff can pass it on themselves. */
export async function inviteStudent(env: Env, studentId: number, mode: "email" | "link"): Promise<{ sent?: boolean; link?: string; days: number }> {
  const s = await first<{ id: number; email: string; name: string; locale: "bn" | "en"; blocked: number }>(env.DB, "SELECT id, email, name, locale, blocked FROM students WHERE id = ?", studentId);
  if (!s) throw new HttpError(404, "not_found");
  if (s.blocked) throw new HttpError(409, "account_blocked");
  const link = await createPasswordResetLink(env, s.id, INVITE_DAYS * 86_400);
  if (mode === "link") return { link, days: INVITE_DAYS };
  const sent = await sendMail(env, { to: s.email, ...welcomeMail(s.locale, s.name, link, INVITE_DAYS) });
  return { sent: sent.ok, days: INVITE_DAYS };
}

/* ================================================================================ a whole list at once */
interface ReadRow {
  index: number;
  name: string;
  email: string;
  phone: string | null;
  locale: "bn" | "en";
  notes: string;
  classes: ClassRef[];
  enrolledOn: string | null;
  amount: number | null;
  paidOn: string | null;
  method: PastMethod;
  rawMethod: string;
  txnRaw: string;
  problems: ImportProblem[];
}

type Found = { kind: "ok"; ref: ClassRef } | { kind: "ambiguous" } | { kind: "none" };

/** Finds a class from what is written in the sheet: its web address name (slug), its English or Bangla title, or a link to its page. */
export function classFinder(classes: ClassRef[]): (text: string) => Found {
  const bySlug = new Map(classes.map((c) => [c.slug.toLowerCase(), c]));
  const byTitle = new Map<string, ClassRef[]>();
  for (const c of classes) {
    for (const t of [c.title_en, c.title_bn]) {
      const k = normKey(t);
      if (!k) continue;
      const list = byTitle.get(k) ?? [];
      if (!list.includes(c)) list.push(c);
      byTitle.set(k, list);
    }
  }
  return (text) => {
    const raw = text.trim();
    const slug = raw
      .toLowerCase()
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/^\/?(?:(?:en|bn)\/)?courses\//, "")
      .replace(/[/?#].*$/, "");
    const hit = bySlug.get(slug) ?? bySlug.get(raw.toLowerCase());
    if (hit) return { kind: "ok", ref: hit };
    const list = byTitle.get(normKey(raw));
    if (!list) return { kind: "none" };
    return list.length === 1 ? { kind: "ok", ref: list[0] } : { kind: "ambiguous" };
  };
}

function readRow(raw: ImportRowIn, index: number, find: (t: string) => Found, today: string): ReadRow {
  const problems: ImportProblem[] = [];
  const bad = (field: ImportField, code: ImportProblem["code"], value?: string) => problems.push(value === undefined ? { field, code } : { field, code, value: value.slice(0, 80) });

  const name = oneLine(raw.name);
  if (name.length < 2) bad("name", "required");
  else if (name.length > 80) bad("name", "too_long");

  const emailText = oneLine(raw.email);
  let email = "";
  if (!emailText) bad("email", "required");
  else {
    const e = emailSchema.safeParse(emailText);
    if (e.success) email = e.data;
    else bad("email", "invalid_email", emailText);
  }

  let phone: string | null = null;
  const phoneText = oneLine(raw.phone);
  if (phoneText) {
    phone = normalizeAnyPhone(phoneText);
    if (!phone) bad("phone", "invalid_phone", phoneText);
  }

  let locale: "bn" | "en" = "bn";
  const langText = oneLine(raw.language);
  if (langText) {
    const l = languageFromText(langText);
    if (l) locale = l;
    else bad("language", "invalid_language", langText);
  }

  const notes = (raw.notes ?? "").replace(CONTROL, "").trim();
  if (notes.length > 500) bad("notes", "too_long");

  // classes: every entry must be found; "a, b" with a comma is accepted when each part is a class on its own
  const classes: ClassRef[] = [];
  let classProblem = false;
  const take = (ref: ClassRef) => {
    if (!classes.some((c) => c.id === ref.id)) classes.push(ref);
  };
  for (const part of splitClassCell(raw.classes ?? "")) {
    const one = find(part);
    if (one.kind === "ok") take(one.ref);
    else if (one.kind === "ambiguous") {
      classProblem = true;
      bad("classes", "class_ambiguous", part);
    } else {
      const bits = part.includes(",") ? part.split(",").map((s) => s.trim()).filter(Boolean) : [];
      const each = bits.length > 1 ? bits.map(find) : [];
      if (each.length && each.every((f) => f.kind === "ok")) each.forEach((f) => f.kind === "ok" && take(f.ref));
      else {
        classProblem = true;
        bad("classes", "class_not_found", part);
      }
    }
  }

  const day = (field: "enrolled_on" | "paid_on"): string | null => {
    const text = oneLine(raw[field]);
    if (!text) return null;
    const r = parseLooseDate(text, today);
    if (r.ok) return r.date;
    bad(field, r.code, text);
    return null;
  };
  const enrolledOn = day("enrolled_on");
  const paidOn = day("paid_on");

  let amount: number | null = null;
  const amountText = oneLine(raw.amount);
  if (amountText) {
    const a = parseAmount(amountText);
    if (a.ok) amount = a.amount > 0 ? a.amount : null; // 0 means "free": nothing to record
    else bad("amount", "invalid_amount", amountText);
  }
  if (amount && classes.length === 0 && !classProblem) bad("amount", "amount_needs_class");

  const rawMethod = oneLine(raw.method);
  return { index, name, email, phone, locale, notes, classes, enrolledOn, amount, paidOn, method: methodFromText(rawMethod), rawMethod, txnRaw: oneLine(raw.txn_id), problems };
}

export interface RowPlan {
  email: string;
  student: NewStudent;
  isNew: boolean;
  access: AccessPlan | null;
  /** an existing student with a blank phone / note gets the one from the list */
  fillBlanks: boolean;
}
export interface Analyzed {
  result: ImportRowResult;
  plan: RowPlan | null;
}

/**
 * Reads every line of a list and says what saving it would do — for each line: a new student, an existing one (classes are added, nothing else
 * changes), or a line with a problem — without writing anything. Saving uses exactly this answer, so what the owner checked is what is saved.
 */
export async function analyzeRows(env: Env, rows: ImportRowIn[], now: Date = new Date()): Promise<Analyzed[]> {
  const today = dhakaToday(now);
  const classes = await all<ClassRef>(env.DB, "SELECT id, slug, title_bn, title_en, price FROM courses WHERE deleted_at IS NULL");
  const find = classFinder(classes);
  const read = rows.map((r, i) => readRow(r, i, find, today));

  // what the database already knows about these people (one query per 80 e-mails) and about the transaction ids
  const known = new Map<string, { id: number; name: string; phone: string | null; notes: string; has: Set<number> }>();
  for (const part of chunk([...new Set(read.map((r) => r.email).filter(Boolean))], 80)) {
    const found = await all<{ id: number; email: string; name: string; phone: string | null; notes: string; course_id: number | null }>(
      env.DB,
      `SELECT s.id, s.email, s.name, s.phone, s.notes, e.course_id FROM students s
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active' WHERE s.email IN (${qs(part.length)})`,
      ...part,
    );
    for (const f of found) {
      const key = f.email.toLowerCase();
      const entry = known.get(key) ?? { id: f.id, name: f.name, phone: f.phone, notes: f.notes, has: new Set<number>() };
      if (f.course_id !== null) entry.has.add(f.course_id);
      known.set(key, entry);
    }
  }
  const usedTxn = new Set<string>();
  for (const part of chunk([...new Set(read.map((r) => cleanTxn(r.txnRaw).txn).filter((t): t is string => !!t))], 80)) {
    for (const o of await all<{ gateway_txn: string }>(env.DB, `SELECT gateway_txn FROM orders WHERE gateway = 'manual' AND gateway_txn IN (${qs(part.length)})`, ...part)) usedTxn.add(o.gateway_txn);
  }

  const firstUse = new Map<string, number>(); // e-mail -> the first good line that uses it in this list
  const givenHere = new Map<string, Set<number>>(); // e-mail -> classes an earlier line of this list already gives
  const txnHere = new Set<string>();
  const out: Analyzed[] = [];

  for (const r of read) {
    const problems = [...r.problems];
    const warnings: ImportWarning[] = [];
    const db = r.email ? known.get(r.email) : undefined;
    const earlier = r.email ? firstUse.get(r.email) : undefined;
    const have = new Set<number>([...(db?.has ?? []), ...(givenHere.get(r.email) ?? [])]);
    const grant = r.classes.filter((c) => !have.has(c.id));

    let sale: SalePlan | null = null;
    const paidDay = r.paidOn ?? r.enrolledOn ?? today;
    if (r.amount && problems.length === 0) {
      if (grant.length === 0) warnings.push({ code: "payment_skipped" });
      else {
        const { txn } = cleanTxn(r.txnRaw);
        if (txn && (usedTxn.has(txn) || txnHere.has(txn))) problems.push({ field: "txn_id", code: "trx_used", value: txn });
        else sale = makeSale(grant, r.amount, r.method, r.rawMethod, r.txnRaw, dayAsMoment(paidDay, now));
      }
    }

    const student: NewStudent = { name: r.name, email: r.email, phone: r.phone, locale: r.locale, notes: r.notes, marketing: false };
    const result: ImportRowResult = {
      index: r.index,
      status: problems.length ? "problem" : db || earlier !== undefined ? "existing" : "new",
      name: r.name,
      email: r.email,
      classes: r.classes.map((c) => ({ id: c.id, title_bn: c.title_bn, title_en: c.title_en, already: have.has(c.id) })),
      payment: sale ? { amount: sale.total, paid_on: paidDay, method: sale.method } : null,
      problems,
      warnings,
    };
    if (problems.length) {
      out.push({ result, plan: null });
      continue;
    }

    if (earlier !== undefined) warnings.push({ code: "merged_with_row", value: String(earlier + 1) });
    if (db && (db.name.toLowerCase() !== r.name.toLowerCase() || (r.phone && db.phone && db.phone !== r.phone))) warnings.push({ code: "kept_details" });
    if (r.email) {
      if (earlier === undefined) firstUse.set(r.email, r.index);
      const set = givenHere.get(r.email) ?? new Set<number>();
      grant.forEach((c) => set.add(c.id));
      givenHere.set(r.email, set);
      if (sale?.txn) txnHere.add(sale.txn);
    }
    const at = dayAsMoment(r.enrolledOn ?? today, now);
    out.push({
      result,
      plan: {
        email: r.email,
        student,
        isNew: !db && earlier === undefined,
        access: grant.length ? { email: r.email, grant, at, sale } : null,
        fillBlanks: !!db && ((!db.phone && !!r.phone) || (!db.notes && !!r.notes)),
      },
    });
  }
  return out;
}

export function summarize(list: Analyzed[]): ImportSummary {
  const s: ImportSummary = { new_students: 0, existing_students: 0, problem_rows: 0, classes_added: 0, payments: 0, amount: 0 };
  for (const a of list) {
    if (a.result.status === "problem") s.problem_rows++;
    else if (a.result.status === "new") s.new_students++;
    else s.existing_students++;
    if (a.plan?.access) {
      s.classes_added += a.plan.access.grant.length;
      if (a.plan.access.sale) {
        s.payments++;
        s.amount += a.plan.access.sale.total;
      }
    }
  }
  return s;
}

const STATEMENTS_PER_BATCH = 300;

/** Saves the lines that have no problem. A line is never half-saved: its statements always travel in the same batch. */
export async function commitRows(env: Env, list: Analyzed[], now: Date = new Date()): Promise<void> {
  const groups: D1PreparedStatement[][] = [];
  for (const { plan } of list) {
    if (!plan) continue;
    const g: D1PreparedStatement[] = [];
    if (plan.isNew) g.push(studentInsert(env, plan.student, "import", plan.access?.at ?? nowIso(now), true));
    else if (plan.fillBlanks) {
      g.push(
        env.DB.prepare(
          `UPDATE students SET phone = CASE WHEN COALESCE(phone, '') = '' THEN ?2 ELSE phone END, notes = CASE WHEN notes = '' THEN ?3 ELSE notes END, updated_at = ?4
           WHERE email = ?1`,
        ).bind(plan.email, plan.student.phone, plan.student.notes, nowIso(now)),
      );
    }
    if (plan.access) g.push(...accessStatements(env, plan.access));
    if (g.length) groups.push(g);
  }
  let batch: D1PreparedStatement[] = [];
  for (const g of groups) {
    if (batch.length && batch.length + g.length > STATEMENTS_PER_BATCH) {
      await env.DB.batch(batch);
      batch = [];
    }
    batch.push(...g);
  }
  if (batch.length) await env.DB.batch(batch);
}

