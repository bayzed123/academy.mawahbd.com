#!/usr/bin/env node
/**
 * i18n completeness check.
 *  - every English key has a Bangla twin (and vice versa) in each dictionary
 *  - every key that is BUILT AT RUN TIME (nav labels, health issue codes, status words …) exists, so the UI can never show a raw key
 * The static `t("…")` keys are already enforced by the TypeScript compiler; this covers the dynamic families it cannot see.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (p) => import(resolve(root, p));
const { common } = await load("shared/src/i18n/common.ts");
const { adminDict } = await load("shared/src/i18n/admin.ts");
const { appDict } = await load("shared/src/i18n/app.ts");
const constants = await load("shared/src/constants.ts");

let failures = 0;
const fail = (msg) => { failures++; console.error("✗", msg); };

for (const [name, d] of Object.entries({ common, admin: adminDict, app: appDict })) {
  const en = new Set(Object.keys(d.en)), bn = new Set(Object.keys(d.bn));
  for (const k of en) if (!bn.has(k)) fail(`${name}: "${k}" has no Bangla text`);
  for (const k of bn) if (!en.has(k)) fail(`${name}: "${k}" has no English text`);
  for (const [k, v] of Object.entries(d.bn)) if (!String(v).trim()) fail(`${name}: "${k}" is empty in Bangla`);
  // {placeholders} must match between languages
  for (const k of en) {
    const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    if (d.bn[k] !== undefined && ph(d.en[k]) !== ph(d.bn[k])) fail(`${name}: "${k}" placeholders differ between languages`);
  }
}

const admin = { ...common.en, ...adminDict.en };
const app = { ...common.en, ...appDict.en };
const need = (dict, label, keys) => { for (const k of keys) if (!(k in dict)) fail(`${label}: missing dynamic key "${k}"`); };

// the import screen names every column and every kind of problem by a key built at run time (a column added to the import without a name
// showed "adm.imp.field.address" on the owner's screen): read the lists from the source, so a new one cannot be forgotten
const imp = readFileSync(resolve(root, "shared/src/import.ts"), "utf8");
const importFields = [...(/export const IMPORT_FIELDS = \[([^\]]+)\]/.exec(imp)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
const importProblems = [...(/export type ProblemCode =([^;]+);/.exec(imp)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
if (importFields.length < 10 || importProblems.length < 10) fail(`import.ts parse looks wrong (${importFields.length}/${importProblems.length})`);

const dash = readFileSync(resolve(root, "worker/src/routes/api/admin/dashboard.ts"), "utf8");
const issues = [...dash.matchAll(/\b(?:pay|chat|sec|mail|sms|ga)\.push\("([a-z_]+)"\)/g)].map((m) => m[1]);
issues.push(...[...dash.matchAll(/issues: [^\n]*?\["([a-z_]+)"\]/g)].map((m) => m[1]));
const attention = [...dash.matchAll(/\{ key: "([a-z_]+)", severity:/g)].map((m) => m[1]);
const steps = [...dash.matchAll(/\{ key: "([a-z]+)", done:/g)].map((m) => m[1]);
const checks = ["database", "storage", "payments", "email", "sms", "analytics", "video", "chatbot", "security"];
if (issues.length < 10 || attention.length < 6 || steps.length < 7) fail(`dashboard.ts parse looks wrong (${issues.length}/${attention.length}/${steps.length})`);

need(admin, "import columns", importFields.map((f) => `adm.imp.field.${f}`));
need(admin, "import problems", importProblems.map((p) => `adm.imp.p.${p}`));
need(admin, "nav", constants.ADMIN_NAV.map((n) => `adm.nav.${n.key}`));
need(admin, "health kinds", checks.map((k) => `adm.health.k.${k}`));
need(admin, "health issues", issues.map((i) => `adm.health.${i}`));
need(admin, "attention", attention.map((a) => `adm.attn.${a}`));
need(admin, "onboarding", steps.flatMap((s) => [`adm.onb.${s}`, `adm.onb.${s}.d`]));
need(admin, "accents", constants.ACCENTS.map((a) => `adm.accent.${a}`));
need(admin, "role descriptions", constants.ROLES.map((r) => `adm.role.desc.${r}`));
need(admin, "lesson types", constants.LESSON_TYPES.map((x) => `adm.lesson.type.${x}`));
need(admin, "course status hints", constants.COURSE_STATUSES.map((s) => `adm.status.hint.${s}`));
need(admin, "enrollment sources", ["purchase", "free", "admin", "bundle"].map((s) => `adm.source.${s}`));
need(admin, "escalation reasons", ["low_confidence", "provider_error", "no_provider"].map((r) => `adm.escalation.${r}`));
need(admin, "actors", ["staff", "student", "system"].map((a) => `adm.actor.${a}`));
need(admin, "policies", ["refund", "terms", "privacy"].map((p) => `adm.policy.${p}`));
need(admin, "levels", ["beginner", "intermediate", "advanced"].map((l) => `label.${l}`));
need(admin, "payment methods", constants.PAYMENT_METHODS.map((m) => `method.${m}`));
const statuses = [...new Set([...constants.ORDER_STATUSES, ...constants.COURSE_STATUSES, "approved", "rejected", "active", "answered", "handled", "up", "open", "new", "revoked", "hidden"])];
need(admin, "status words (admin)", statuses.map((s) => `status.${s}`));
need(app, "status words (app)", constants.ORDER_STATUSES.map((s) => `status.${s}`));
need(app, "app order statuses", constants.ORDER_STATUSES.flatMap((s) => [`app.orders.status.${s}.title`, `app.orders.status.${s}.body`]));
need(app, "app review statuses", ["pending", "approved", "rejected"].map((s) => `app.course.review.status.${s}`));
need(app, "app channels", ["sslcommerz", "bkash", "manual", "mock"].flatMap((c) => [`app.checkout.channel.${c}`, `app.checkout.channel.${c}.sub`]));

// Admin → Analytics: every event the shop sends has a plain-words name, every setup problem is explained, every report section has a name
const analytics = await load("shared/src/analytics.ts");
need(admin, "analytics events", analytics.GA_EVENTS.map((e) => `adm.an.ev.${e.name}`));
need(admin, "analytics event groups", analytics.GA_EVENT_GROUPS.map((g) => `adm.an.g.${g}`));
const ga4 = readFileSync(resolve(root, "worker/src/lib/ga4.ts"), "utf8");
const ga4Problems = [...(/export type Ga4Problem =([\s\S]*?);/.exec(ga4)?.[1] ?? "").matchAll(/\| "([a-z_]+)"/g)].map((m) => m[1]);
if (ga4Problems.length < 8) fail(`ga4.ts: the problem list parse looks wrong (${ga4Problems.length})`);
need(admin, "analytics problems", ga4Problems.flatMap((p) => [`adm.an.p.${p}.title`, `adm.an.p.${p}.body`]));
const report = readFileSync(resolve(root, "worker/src/services/analytics.ts"), "utf8");
const sections = [...report.slice(report.indexOf("function questions("), report.indexOf("const row = ")).matchAll(/\n    ([a-z]+): [{[]/g)].map((m) => m[1]);
if (sections.length < 10) fail(`services/analytics.ts: the report sections parse looks wrong (${sections.length})`);
need(admin, "analytics report sections", sections.map((x) => `adm.an.sec.${x}`));

// Online payment: every way SSLCommerz can say no is explained in plain words (Settings → Payments → Check the connection) and has its short line in the owner's e-mail
const sslSource = readFileSync(resolve(root, "worker/src/services/payments/sslcommerz.ts"), "utf8");
const sslProblems = [...(/export type SslProblem =([\s\S]*?);/.exec(sslSource)?.[1] ?? "").matchAll(/\| "([a-z_]+)"/g)].map((m) => m[1]);
if (sslProblems.length < 6) fail(`sslcommerz.ts: the problem list parse looks wrong (${sslProblems.length})`);
need(admin, "online payment problems", sslProblems.flatMap((p) => [`adm.pay.p.${p}.title`, `adm.pay.p.${p}.body`]));
const noticeSource = readFileSync(resolve(root, "worker/src/services/notify.ts"), "utf8");
const failedWords = [...(/const PAYMENT_FAILED_WORDS[^=]*= \{([\s\S]*?)\n\};/.exec(noticeSource)?.[1] ?? "").matchAll(/\n  ([a-z_]+):/g)].map((m) => m[1]);
for (const p of sslProblems) if (!failedWords.includes(p)) fail(`notify.ts: PAYMENT_FAILED_WORDS has no line for the online payment problem "${p}"`);
need(admin, "owner note kinds", constants.NOTIFY_KINDS.flatMap((k) => [`adm.notify.kind.${k}`, `adm.notify.kind.${k}.d`]));

// every error code the Worker can throw should have a translation in both UIs (generic is the safety net, but specific is kinder)
const codes = new Set();
for (const f of ["worker/src/routes/api/auth.ts", "worker/src/routes/api/checkout.ts", "worker/src/routes/api/student.tsx", "worker/src/services/orders.ts", "worker/src/services/learning.ts", "worker/src/services/payments/bkash.ts"]) {
  for (const m of readFileSync(resolve(root, f), "utf8").matchAll(/(?:HttpError\(\d{3}, |forbidden\(|conflict\(|badRequest\(|unauthorized\(|notFound\()"([a-z_]+)"/g)) codes.add(m[1]);
}
const skip = new Set(["not_found", "unauthorized", "forbidden", "bad_request", "invalid_json", "validation", "unsupported_media_type", "payload_too_large", "invalid_token", "payment_unavailable", "gateway_init_failed"]);
for (const c of codes) if (!skip.has(c) && !(`err.${c}` in app)) console.warn(`  note: student-facing error code "${c}" falls back to the generic message`);

if (failures) { console.error(`\n${failures} i18n problem(s)`); process.exit(1); }
console.log(`i18n OK — admin ${Object.keys(adminDict.en).length} keys, app ${Object.keys(appDict.en).length} keys, common ${Object.keys(common.en).length} keys; dynamic families complete`);
