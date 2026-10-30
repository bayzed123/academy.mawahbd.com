import { raw } from "hono/html";
import { formatDate } from "@mawah/shared";
import type { PageCtx } from "./ctx";
import { qrSvg } from "./qr";

/**
 * The certificate itself: one drawing (SVG) at the size of an A4 page lying on its side, 297 × 210 mm at 96 dots per inch. The same drawing
 * is what the page shows (scaled to the screen), what prints — "Download PDF" is the browser's own Save as PDF, which sets Bangla letters
 * right — and what marketing/cert.js turns into a picture for "Download picture". The look: a white sheet with the academy's black band on
 * the left (the logo, the QR code that opens the certificate check), an orange edge, the student's name large, the class in orange, the date
 * and the certificate's code at the foot either side of an orange seal. Its words come in the page's language.
 */
export const CERT_W = 1123;
export const CERT_H = 794;

export interface CertArtData {
  name: string;
  course: string;
  issuedAt: string;
  code: string;
  /** the address the QR code opens: the certificate check for this code */
  verifyUrl: string;
  /** a sample of the design (Admin → Certificates, a class page): marked SAMPLE across, with a code that checks nothing */
  sample?: boolean;
}

// vowel signs, the virama and the other marks of Bangla sit on the letter before them; the ones written beside it still take some room
const BN_MARK = /[ঁ-ঃ়া-্ৗৢৣ‌‍]/;
const BN_WIDE_SIGN = /[া-ীেৈোৌ]/;

/** About how many ems a line takes in the certificate's fonts: enough to choose a size that fits (the page's script then checks it). */
export function lineEms(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (BN_MARK.test(ch)) {
      if (BN_WIDE_SIGN.test(ch)) w += 0.3;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0980 && cp <= 0x09ff) w += 0.62;
    else if (ch === " ") w += 0.26;
    else if (/[A-Z0-9]/.test(ch)) w += 0.66;
    else if (/[iljft.,'’!|:;-]/.test(ch)) w += 0.3;
    else if (/[mw]/.test(ch)) w += 0.8;
    else w += 0.52;
  }
  return w;
}

/** The largest size, up to `base`, at which `text` fits in `max` pixels (never under `min`: a very long line is narrowed instead, by cert.js). */
export const fitSize = (text: string, max: number, base: number, min: number) => Math.max(min, Math.min(base, Math.floor(max / Math.max(lineEms(text), 1))));

/** A class's name on one line, or on two split at the word that makes the longer of the two the shortest. */
export function twoLines(text: string, maxEms: number): string[] {
  if (lineEms(text) <= maxEms) return [text];
  const words = text.trim().split(/\s+/);
  let best: string[] = [text];
  let widest = Infinity;
  for (let i = 1; i < words.length; i++) {
    const pair = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const w = Math.max(lineEms(pair[0]!), lineEms(pair[1]!));
    if (w < widest) {
      widest = w;
      best = pair;
    }
  }
  return best;
}

const SERIF = "'Playfair Display','Tiro Bangla',serif";
const SANS = "'Hind Siliguri',sans-serif";
// the right-hand part of the sheet: its middle, and how wide a line may be there
const MID = 736;
const NAME_MAX = 600;
const COURSE_MAX = 620;

/** The orange seal at the foot: a round badge with a ring of stitches and two ribbon tails. */
const Seal = ({ x, y }: { x: number; y: number }) => (
  <g aria-hidden="true">
    <path d={`M${x - 26} ${y + 34}L${x - 44} ${y + 94}L${x - 27} ${y + 85}L${x - 15} ${y + 100}L${x} ${y + 44}Z`} fill="#c2410c" />
    <path d={`M${x + 26} ${y + 34}L${x + 44} ${y + 94}L${x + 27} ${y + 85}L${x + 15} ${y + 100}L${x} ${y + 44}Z`} fill="#b13a0a" />
    <circle cx={x} cy={y} r="58" fill="#ff5722" />
    <circle cx={x} cy={y} r="50" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-dasharray="1.6 3.4" />
    <circle cx={x} cy={y} r="42" fill="none" stroke="#ffffff" stroke-opacity=".7" stroke-width="1" />
    <path d={`M${x} ${y - 33}l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z`} fill="#ffffff" />
    <text x={x} y={y + 6} text-anchor="middle" font-family={SERIF} font-weight="600" font-size="17" letter-spacing="2.5" fill="#ffffff">
      MAWAH
    </text>
    <text x={x} y={y + 22} text-anchor="middle" font-family={SANS} font-weight="700" font-size="8.5" letter-spacing="3.4" fill="#ffffff">
      ACADEMY
    </text>
  </g>
);

export function CertificateArt({ ctx, data }: { ctx: PageCtx; data: CertArtData }) {
  const { t, lang } = ctx;
  const date = formatDate(data.issuedAt, lang);
  const nameSize = fitSize(data.name, NAME_MAX, 58, 30);
  const courseLines = twoLines(data.course, COURSE_MAX / 30);
  const courseSize = Math.min(30, ...courseLines.map((l) => fitSize(l, COURSE_MAX, 30, 18)));
  const courseTop = courseLines.length > 1 ? 458 : 470;
  const site = ctx.abs("/verify").replace(/^https?:\/\//, "");
  const desc = t("cert.desc", { name: data.name, course: data.course, date, code: data.code });
  const label = (en: string) => (lang === "en" ? en.toUpperCase() : en);
  return (
    <svg
      class="cert-art"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${CERT_W} ${CERT_H}`}
      width={CERT_W}
      height={CERT_H}
      role="img"
      aria-labelledby="cert-title cert-desc"
      data-cert-art
    >
      <title id="cert-title">{`${t("cert.heading")}: ${data.name}`}</title>
      <desc id="cert-desc">{desc}</desc>
      <rect width={CERT_W} height={CERT_H} fill="#ffffff" />

      {/* the academy's band: the logo's own black (so the picture sits in it without an edge), with an orange edge */}
      <rect width="340" height={CERT_H} fill="#080305" />
      <rect x="340" width="8" height={CERT_H} fill="#ff5722" />
      <image href="/logo.webp" x="40" y="62" width="260" height="141.5" preserveAspectRatio="xMidYMid meet" />
      <text x="170" y="242" text-anchor="middle" font-family={SANS} font-size="15" letter-spacing={lang === "en" ? "1.2" : "0"} fill="#d4d4d4">
        {t("cert.band")}
      </text>
      <path d="M140 264h60" stroke="#ff5722" stroke-width="2" />
      <g fill="none" stroke="#1f1f1f" stroke-width="1" aria-hidden="true">
        {[34, 54, 74, 94, 114].map((r) => (
          <circle cx="170" cy="410" r={r} />
        ))}
      </g>
      <path d="M170 398l12 12-12 12-12-12z" fill="#ff5722" aria-hidden="true" />
      <rect x="95" y="548" width="150" height="150" rx="14" fill="#ffffff" />
      {raw(qrSvg(data.verifyUrl, { cls: "cert-qr", label: t("cert.scan"), at: { x: 104, y: 557, size: 132 } }))}
      <text x="170" y="728" text-anchor="middle" font-family={SANS} font-size="14" fill="#d4d4d4">
        {t("cert.scan")}
      </text>
      <text x="170" y="750" text-anchor="middle" font-family={SANS} font-size="13" fill="#ff8a50">
        {site}
      </text>

      {/* the sheet: a thin frame with orange corners */}
      <rect x="380" y="34" width="711" height="726" fill="none" stroke="#e5e5e5" stroke-width="1.5" />
      <path d="M380 72V34h38M1053 34h38v38M380 722v38h38M1053 760h38v-38" fill="none" stroke="#ff5722" stroke-width="3" />

      <text x={MID} y="160" text-anchor="middle" font-family={SERIF} font-weight="600" font-size="46" fill="#0a0a0a" data-fit="640">
        {t("cert.heading")}
      </text>
      <path d={`M${MID - 112} 194h92M${MID + 20} 194h92`} stroke="#d4d4d4" stroke-width="1" />
      <path d={`M${MID} 187l7 7-7 7-7-7z`} fill="#ff5722" />
      <text x={MID} y="256" text-anchor="middle" font-family={SANS} font-size="19" fill="#525252">
        {t("cert.presented")}
      </text>
      <text x={MID} y="338" text-anchor="middle" font-family={SERIF} font-weight="600" font-size={nameSize} fill="#0a0a0a" data-fit={NAME_MAX} data-cert-name>
        {data.name}
      </text>
      <path d={`M${MID - 280} 366h560`} stroke="#e5e5e5" stroke-width="1.5" />
      <path d={`M${MID - 50} 366h100`} stroke="#ff5722" stroke-width="3" />
      <text x={MID} y="416" text-anchor="middle" font-family={SANS} font-size="19" fill="#525252">
        {t("cert.for")}
      </text>
      {courseLines.map((line, i) => (
        <text x={MID} y={courseTop + i * Math.round(courseSize * 1.3)} text-anchor="middle" font-family={SANS} font-weight="700" font-size={courseSize} fill="#c2410c" data-fit={COURSE_MAX} data-cert-course>
          {line}
        </text>
      ))}

      {/* the foot: when, the seal, which certificate */}
      <path d="M440 628h160M872 628h160" stroke="#d4d4d4" stroke-width="1" />
      <text x="520" y="654" text-anchor="middle" font-family={SANS} font-weight="600" font-size="13" letter-spacing={lang === "en" ? "1.6" : "0"} fill="#737373">
        {label(t("cert.issued"))}
      </text>
      <text x="520" y="684" text-anchor="middle" font-family={SANS} font-weight="700" font-size="19" fill="#0a0a0a">
        {date}
      </text>
      <text x="952" y="654" text-anchor="middle" font-family={SANS} font-weight="600" font-size="13" letter-spacing={lang === "en" ? "1.6" : "0"} fill="#737373">
        {label(t("cert.id"))}
      </text>
      <text x="952" y="684" text-anchor="middle" font-family={SANS} font-weight="700" font-size="18" letter-spacing="1.2" fill="#0a0a0a" data-cert-code>
        {data.code}
      </text>
      <Seal x={MID} y={618} />
      <text x={MID} y="744" text-anchor="middle" font-family={SANS} font-size="12.5" fill="#737373">
        {t("cert.verifyAt", { site })}
      </text>

      {data.sample && (
        <text x={MID} y="480" text-anchor="middle" transform={`rotate(-16 ${MID} 480)`} font-family={SERIF} font-weight="600" font-size="150" letter-spacing="14" fill="#ff5722" fill-opacity=".13" aria-hidden="true">
          {t("cert.sample")}
        </text>
      )}
    </svg>
  );
}
