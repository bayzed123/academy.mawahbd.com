/*
 * A FoodCost recipe as a printable page: the PDF the website saves through the browser's own "Save as PDF" (like the certificate), and the
 * one the Android app makes with expo-print and hands to the share sheet. One page design for both, so a recipe looks the same wherever it
 * is saved. The screens pass every word already written in the reader's language (each has its own dictionary); this only lays them out.
 * Everything is escaped: a recipe's name and labels are the user's own text.
 *
 * The website prints its own page (a print style shows only the report), because a phone's browser may print the whole page from a hidden
 * frame. So every rule here sits inside .fcr: the report never touches the site's own look, and the site's look never reaches the report.
 */

export interface FcReportRow {
  label: string;
  value: string;
  /** the figure the eye should find first (the price), or a loss */
  tone?: "accent" | "loss";
}

export interface FcReportLine {
  n: string;
  name: string;
  amount: string;
  cost: string;
  share: string;
  kcal: string;
  /** a line that could not be costed or counted, said in words */
  note?: string;
}

export interface FcReport {
  lang: "bn" | "en";
  /** the page's title, which is also the file name a browser suggests for the PDF */
  docTitle: string;
  /** "MAWAH Academy · FoodCost" */
  brand: string;
  /** the recipe's name */
  title: string;
  /** what it makes and the date: "Makes 12 slices · 7 November 2026" */
  subtitle: string;
  /** two to four figures across the top: the cost of one, the price, the calories of one */
  headline: FcReportRow[];
  linesHeading: string;
  lineHeads: { n: string; name: string; amount: string; cost: string; share: string; kcal: string };
  lines: FcReportLine[];
  /** where the money goes: ingredients, packaging, labour, gas and electricity */
  splitHeading: string;
  split: FcReportRow[];
  /** the whole batch, the cost of one, the price, the profit */
  summaryHeading: string;
  summary: FcReportRow[];
  /** the calories and nutrients of one piece (or of the batch) */
  foodHeading: string;
  food: FcReportRow[];
  /** what is missing (a price, a figure) and where the numbers come from */
  notes: string[];
  footer: string;
}

/** The report's look: A4, black on white, the numbers in columns. The site's Hind Siliguri when the page has it, else the phone's own Bangla font. */
export const FC_REPORT_CSS = [
  '.fcr{font-family:"Hind Siliguri","Noto Sans Bengali","Noto Sans",system-ui,sans-serif;color:#17120f;background:#fff;font-size:11.5pt;line-height:1.45;font-weight:400;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
  ".fcr *{box-sizing:border-box}",
  ".fcr .fcr-brand{font-size:9.5pt;letter-spacing:.06em;text-transform:uppercase;color:#c2410c;font-weight:700}",
  ".fcr h1{margin:2pt 0;font-family:inherit;font-size:20pt;font-weight:700;line-height:1.2;color:#17120f;letter-spacing:0}",
  ".fcr .fcr-sub{margin:0 0 12pt;color:#5c524c}",
  ".fcr .fcr-figs{display:flex;flex-wrap:wrap;gap:8pt;margin:0 0 14pt}",
  ".fcr .fcr-fig{flex:1 1 120pt;border:1px solid #e3dcd6;border-radius:8pt;padding:7pt 10pt}",
  ".fcr .fcr-fig span{display:block;font-size:9pt;color:#5c524c}",
  ".fcr .fcr-fig b{font-size:14pt;font-weight:700}",
  ".fcr .fcr-fig.accent{border-color:#f08a5d;background:#fff4ee}",
  ".fcr .fcr-fig.accent b{color:#c2410c}",
  ".fcr h2{margin:14pt 0 6pt;padding:0 0 3pt;font-family:inherit;font-size:12.5pt;font-weight:700;line-height:1.3;color:#17120f;letter-spacing:0;border-bottom:2px solid #17120f}",
  ".fcr table{width:100%;border-collapse:collapse;font-size:inherit;font-variant-numeric:tabular-nums}",
  ".fcr th,.fcr td{text-align:left;padding:4pt 6pt;border-bottom:1px solid #ebe5e0;vertical-align:top;color:inherit;background:none}",
  ".fcr thead th{font-size:9pt;color:#5c524c;font-weight:600;border-bottom:1px solid #c9c0b9}",
  ".fcr .num{text-align:right;white-space:nowrap}",
  ".fcr .fcr-n{width:18pt;color:#8a7f78}",
  ".fcr .fcr-note{font-size:9pt;color:#b42318}",
  ".fcr .fcr-two{display:flex;gap:16pt;flex-wrap:wrap}",
  ".fcr .fcr-two>section{flex:1 1 220pt;min-width:0}",
  ".fcr .fcr-two th{font-weight:400}",
  ".fcr .fcr-two td{text-align:right;white-space:nowrap;font-weight:600}",
  ".fcr tr.accent td{color:#c2410c}",
  ".fcr tr.loss td{color:#b42318}",
  ".fcr ul{margin:12pt 0 0;padding:0 0 0 14pt;font-size:9.5pt;color:#5c524c}",
  ".fcr footer{margin-top:16pt;padding-top:6pt;border-top:1px solid #e3dcd6;font-size:9pt;color:#8a7f78}",
  ".fcr tr,.fcr .fcr-fig{break-inside:avoid}",
].join("\n");

const PAGE = "@page{size:A4;margin:14mm 13mm}";

/**
 * The website's print style: while html has .fcr-printing, printing shows the report (in .fcr-host) and nothing else; on the screen the
 * report is never seen. The site's security rules allow this one inline style by its fingerprint (worker/src/routes/spa.ts).
 */
export const FC_REPORT_PRINT_CSS = [
  "@media screen{.fcr-host{display:none!important}}",
  "@media print{",
  PAGE,
  // a light page, whatever the site's night or day look: in the dark look the browser would paint the page's edges dark
  "html.fcr-printing{color-scheme:light!important}",
  "html.fcr-printing,html.fcr-printing body{background:#fff!important;color:#17120f!important}",
  "html.fcr-printing body{display:block!important;min-height:0!important;margin:0!important;padding:0!important}",
  "html.fcr-printing body>:not(.fcr-host){display:none!important}",
  ".fcr-host{display:block!important}",
  "}",
  FC_REPORT_CSS,
].join("\n");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const rows = (list: FcReportRow[]) =>
  list.map((r) => `<tr${r.tone ? ` class="${r.tone}"` : ""}><th scope="row">${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join("");

/** The report itself, in its .fcr box: what the website prints from its own page. */
export function fcReportBody(r: FcReport): string {
  const lines = r.lines
    .map(
      (l) =>
        `<tr><td class="fcr-n">${esc(l.n)}</td><td>${esc(l.name)}${l.note ? `<div class="fcr-note">${esc(l.note)}</div>` : ""}</td><td class="num">${esc(l.amount)}</td><td class="num">${esc(l.cost)}</td><td class="num">${esc(l.share)}</td><td class="num">${esc(l.kcal)}</td></tr>`,
    )
    .join("");
  const head = r.headline.map((h) => `<div class="fcr-fig${h.tone ? ` ${h.tone}` : ""}"><span>${esc(h.label)}</span><b>${esc(h.value)}</b></div>`).join("");
  return `<div class="fcr" lang="${r.lang}">
<div class="fcr-brand">${esc(r.brand)}</div>
<h1>${esc(r.title)}</h1>
<p class="fcr-sub">${esc(r.subtitle)}</p>
<div class="fcr-figs">${head}</div>
<h2>${esc(r.linesHeading)}</h2>
<table>
<thead><tr><th class="fcr-n" scope="col">${esc(r.lineHeads.n)}</th><th scope="col">${esc(r.lineHeads.name)}</th><th class="num" scope="col">${esc(r.lineHeads.amount)}</th><th class="num" scope="col">${esc(r.lineHeads.cost)}</th><th class="num" scope="col">${esc(r.lineHeads.share)}</th><th class="num" scope="col">${esc(r.lineHeads.kcal)}</th></tr></thead>
<tbody>${lines}</tbody>
</table>
<div class="fcr-two">
<section><h2>${esc(r.summaryHeading)}</h2><table><tbody>${rows(r.summary)}</tbody></table></section>
<section><h2>${esc(r.splitHeading)}</h2><table><tbody>${rows(r.split)}</tbody></table></section>
</div>
${r.food.length ? `<h2>${esc(r.foodHeading)}</h2><div class="fcr-two"><section><table><tbody>${rows(r.food)}</tbody></table></section></div>` : ""}
${r.notes.length ? `<ul>${r.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
<footer>${esc(r.footer)}</footer>
</div>`;
}

/** The whole page, ready to print on its own: what the Android app turns into a PDF file. */
export function fcReportHtml(r: FcReport): string {
  return `<!doctype html>
<html lang="${r.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.docTitle)}</title>
<style>
${PAGE}
html,body{margin:0;padding:0;background:#fff}
${FC_REPORT_CSS}
</style>
</head>
<body>
${fcReportBody(r)}
</body>
</html>`;
}

/** A file name from a recipe's name: letters (any script), digits and dashes, never empty. */
export function fcReportFileName(name: string): string {
  const base = name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `MAWAH-FoodCost-${base || "recipe"}.pdf`;
}
