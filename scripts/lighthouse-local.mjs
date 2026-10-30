#!/usr/bin/env node
/**
 * Core Web Vitals / quality gate for the public (marketing) pages:   npm run lighthouse:local
 *
 * Runs Lighthouse (mobile profile: slow-4G + 4x CPU throttle) against a freshly seeded local Worker — the same one the
 * Playwright tests use (scripts/e2e-server.mjs, port 8788) — or against any URL:   LH_URL=https://mawahacademy.com npm run lighthouse:local
 * Fails (exit 1) when a page drops below the budgets below, so a regression is caught before it is deployed.
 * A lab number can spike on a shared machine (the first page measured also pays for a cold server and a cold Chrome), so one
 * warm-up measurement is thrown away and a page that misses a budget is measured again, up to three times in all: noise
 * passes on a later try, a real slowdown misses every time.
 *
 * Needs Chrome/Chromium: set CHROME_PATH (or CHROMIUM_PATH) if it is not installed in the usual place. Lighthouse itself is
 * fetched on demand with npx (pinned), so it is not a dependency of the project.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIGHTHOUSE = "lighthouse@13.5.0";
const BASE = (process.env.LH_URL ?? "http://localhost:8788").replace(/\/$/, "");
const OWN_SERVER = !process.env.LH_URL;
const OUT = resolve(root, ".lighthouseci");
process.env.CHROME_PATH ??= process.env.CHROMIUM_PATH ?? "";
if (!process.env.CHROME_PATH) delete process.env.CHROME_PATH;

/** Scores are 0–100, CLS is a plain number, TBT in milliseconds. Lab numbers vary a little run to run, so budgets leave headroom. */
const BUDGET = { performance: 85, accessibility: 95, "best-practices": 95, seo: 95, cls: 0.1, tbt: 300 };
const PAGES = [
  ["Home (Bangla)", "/"],
  ["Home (English)", "/en"],
  ["Class page", "/courses/beginners-baking-class"],
  ["Class list", "/courses"],
  ["Contact", "/contact"],
];

async function up(url) {
  try {
    return (await fetch(`${url}/api/health`)).ok;
  } catch {
    return false;
  }
}

let server;
if (OWN_SERVER && !(await up(BASE))) {
  console.log("starting the local test server …");
  // its own process group, so stopping it also stops wrangler/workerd underneath
  server = spawn("node", ["scripts/e2e-server.mjs"], { cwd: root, stdio: ["ignore", "ignore", "inherit"], detached: true });
  for (let i = 0; i < 90 && !(await up(BASE)); i++) await new Promise((r) => setTimeout(r, 2000));
  if (!(await up(BASE))) {
    stop();
    console.error("the local server did not start");
    process.exit(1);
  }
}
function stop() {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}
process.on("exit", stop);

mkdirSync(OUT, { recursive: true });
const TRIES = 3;

/** One Lighthouse run of one page: the parsed report, or null when the tool itself could not measure it. */
function runLighthouse(path) {
  const file = resolve(OUT, `${path.replace(/[^a-z0-9]+/gi, "_") || "home"}.json`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Lighthouse occasionally fails to record a trace (NO_NAVSTART): that is the tool, not the page — retry once
    spawnSync("npx", ["--yes", LIGHTHOUSE, `${BASE}${path}`, "--chrome-flags=--headless=new --no-sandbox", "--only-categories=performance,accessibility,best-practices,seo", "--output=json", `--output-path=${file}`, "--quiet"], {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
    });
    try {
      const r = JSON.parse(readFileSync(file, "utf8"));
      if (!r.runtimeError) return r;
    } catch {
      /* no report written */
    }
  }
  return null;
}

/** The numbers of one report and the budgets it misses. */
function judge(name, path, report) {
  const score = (k) => Math.round((report.categories[k]?.score ?? 0) * 100);
  const a = report.audits;
  const row = {
    name,
    path,
    performance: score("performance"),
    accessibility: score("accessibility"),
    "best-practices": score("best-practices"),
    seo: score("seo"),
    lcp: a["largest-contentful-paint"].displayValue,
    cls: a["cumulative-layout-shift"].numericValue,
    tbt: a["total-blocking-time"].numericValue,
  };
  const problems = [];
  for (const k of ["performance", "accessibility", "best-practices", "seo"]) if (row[k] < BUDGET[k]) problems.push(`${k} ${row[k]} < ${BUDGET[k]}`);
  if (row.cls > BUDGET.cls) problems.push(`CLS ${row.cls.toFixed(3)} > ${BUDGET.cls}`);
  if (row.tbt > BUDGET.tbt) problems.push(`TBT ${Math.round(row.tbt)}ms > ${BUDGET.tbt}ms`);
  row.problems = problems;
  // a page that moves too much: what moved and why, in Lighthouse's own words — a CI runner's browser can move what no local one does
  const named = (c) => String(c.extra?.value ?? c.extra?.snippet ?? "").replace(BASE, "");
  row.shifts =
    row.cls > BUDGET.cls
      ? (a["layout-shifts"]?.details?.items ?? []).slice(0, 4).map((s) => `${s.score.toFixed(3)} \`${s.node?.selector ?? "?"}\`: ${(s.subItems?.items ?? []).map((c) => `${c.cause} ${named(c)}`.trim()).join("; ") || "no cause named"}`)
      : [];
  row.browser = report.environment?.hostUserAgent ?? "";
  return row;
}

// Warm-up: the first page measured otherwise pays for a cold server and a cold Chrome. Touch every page, measure the first once, keep nothing.
for (const [, path] of PAGES) await fetch(`${BASE}${path}`).then((r) => r.arrayBuffer(), () => undefined);
runLighthouse(PAGES[0][1]);

const rows = [];
let failed = false;

for (const [name, path] of PAGES) {
  let row;
  const seen = [];
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const report = runLighthouse(path);
    if (!report) {
      row = { name, path, error: "Lighthouse could not measure this page" };
      break;
    }
    row = judge(name, path, report);
    seen.push(row.performance);
    row.tries = attempt;
    if (!row.problems.length) break;
  }
  if (row.error || row.problems.length) failed = true;
  row.seen = seen;
  rows.push(row);
}

const lines = [
  `### Lighthouse (mobile profile) — ${BASE}`,
  "",
  "| Page | Perf | A11y | Best practices | SEO | LCP | CLS | TBT | Result |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---|",
  ...rows.map((r) =>
    r.error
      ? `| ${r.name} | — | — | — | — | — | — | — | ❌ ${r.error} |`
      : `| ${r.name} | ${r.performance} | ${r.accessibility} | ${r["best-practices"]} | ${r.seo} | ${r.lcp} | ${r.cls.toFixed(3)} | ${Math.round(r.tbt)} ms | ${r.problems.length ? `❌ ${r.problems.join("; ")} (missed on all ${r.tries} tries: performance ${r.seen.join(", ")})` : r.tries > 1 ? `✅ on try ${r.tries} (earlier tries scored ${r.seen.slice(0, -1).join(", ")})` : "✅"} |`,
  ),
  "",
  `Budgets: performance ≥ ${BUDGET.performance}, accessibility ≥ ${BUDGET.accessibility}, best practices ≥ ${BUDGET["best-practices"]}, SEO ≥ ${BUDGET.seo}, CLS ≤ ${BUDGET.cls}, TBT ≤ ${BUDGET.tbt} ms. A page that misses a budget is measured again (up to ${TRIES} times): a one-off spike passes, a real slowdown misses every time.`,
  ...rows.flatMap((r) => (r.shifts?.length ? ["", `Layout shifts on "${r.name}", biggest first (${r.browser}):`, ...r.shifts.map((s) => `- ${s}`)] : [])),
];
console.log("\n" + lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
stop();
process.exit(failed ? 1 : 0);
