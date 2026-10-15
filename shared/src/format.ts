export type Lang = "bn" | "en";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Replace ASCII digits with Bengali digits. */
export function toBnDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

/** Bengali digits to ASCII ones (০১৭… -> 017…), for numbers and dates people type in Bangla. */
export function fromBnDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** Group digits the South-Asian way (12,34,567) — the convention used for BDT. */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

export function formatNumber(n: number, lang: Lang): string {
  const negative = n < 0;
  const [int, frac] = Math.abs(n).toString().split(".");
  const grouped = groupIndian(int) + (frac ? `.${frac}` : "");
  const out = (negative ? "-" : "") + grouped;
  return lang === "bn" ? toBnDigits(out) : out;
}

/** "৳১,৮৫০" in Bangla, "৳1,850" in English. Whole taka only. */
export function formatMoney(amount: number, lang: Lang): string {
  return `৳${formatNumber(Math.round(amount), lang)}`;
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_BN = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Convert an ISO/UTC timestamp to a Date whose UTC fields are the Asia/Dhaka wall-clock (UTC+6, no DST). */
export function toDhaka(iso: string | Date): Date {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(d.getTime() + DHAKA_OFFSET_MS);
}

/** "14 Oct 2026" / "১৪ অক্টোবর ২০২৬" (Bangladesh time). */
export function formatDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = toDhaka(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDate();
  const month = (lang === "bn" ? MONTHS_BN : MONTHS_EN)[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const out = `${day} ${month} ${year}`;
  return lang === "bn" ? toBnDigits(out) : out;
}

export function formatDateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = toDhaka(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h24 < 12 ? (lang === "bn" ? "সকাল" : "AM") : lang === "bn" ? "বিকাল" : "PM";
  const time = `${h12}:${mm} ${ampm}`;
  return `${formatDate(iso, lang)}, ${lang === "bn" ? toBnDigits(time) : time}`;
}

/** Today's date in Dhaka as YYYYMMDD (used for invoice numbers). */
export function dhakaDayStamp(date: Date = new Date()): string {
  const d = toDhaka(date);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "1 h 20 min" / "১ ঘণ্টা ২০ মিনিট". */
export function formatDuration(seconds: number, lang: Lang): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h === 0 && m === 0) return "";
  const parts: string[] = [];
  if (lang === "bn") {
    if (h) parts.push(`${toBnDigits(h)} ঘণ্টা`);
    if (m) parts.push(`${toBnDigits(m)} মিনিট`);
  } else {
    if (h) parts.push(`${h} h`);
    if (m) parts.push(`${m} min`);
  }
  return parts.join(" ");
}

/** Pick the localized value of a bilingual record: obj[`${key}_bn`] / obj[`${key}_en`] with fallback. */
export function loc(obj: object, key: string, lang: Lang): string {
  const rec = obj as Record<string, unknown>;
  const primary = rec[`${key}_${lang}`];
  const other = rec[`${key}_${lang === "bn" ? "en" : "bn"}`];
  const val = typeof primary === "string" && primary.trim() ? primary : other;
  return typeof val === "string" ? val : "";
}

export function pick<T>(lang: Lang, bn: T, en: T): T {
  return lang === "bn" ? bn : en;
}

/** Bangladesh mobile number normaliser: returns 01XXXXXXXXX or null. */
export function normalizeBdPhone(input: string): string | null {
  const digits = fromBnDigits(input).replace(/[^\d+]/g, "");
  const m = digits.match(/^(?:\+?880|0)?(1[3-9]\d{8})$/);
  return m ? `0${m[1]}` : null;
}

/** A number staff typed in: a Bangladesh mobile in the usual 01XXXXXXXXX form, or any other number kept as +digits (7–15 of them). */
export function normalizeAnyPhone(input: string): string | null {
  const bd = normalizeBdPhone(input);
  if (bd) return bd;
  const m = fromBnDigits(input).replace(/[^\d+]/g, "").match(/^(?:\+|00)?(\d{7,15})$/);
  return m ? `+${m[1]}` : null;
}

/** The student ID people quote to the shop and see on their profile and receipts: STU-000123 (the account number, at least six digits). */
export function studentCode(id: number): string {
  return `STU-${String(id).padStart(6, "0")}`;
}

/** The account number behind what someone typed as a student ID ("STU-000123", "stu123", "123"), or null when it is not one. */
export function parseStudentCode(input: string): number | null {
  const m = input.trim().match(/^(?:stu-?)?0*(\d{1,9})$/i);
  return m ? Number(m[1]) : null;
}

/** The short code of an order that people read out or type into a payment reference: the first 8 characters of its public id. */
export function orderCode(publicId: string): string {
  return publicId.slice(0, 8).toUpperCase();
}

/** wa.me wants the number with its country code and nothing else: 01712345678 -> 8801712345678 (other countries: digits only). */
export function waNumber(input: string): string {
  const bd = normalizeBdPhone(input);
  return bd ? `88${bd}` : input.replace(/\D/g, "").replace(/^00/, "");
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`;
}
