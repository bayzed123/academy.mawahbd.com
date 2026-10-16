import { useMemo } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Chart } from "../components/Chart";
import { Button, Chip, ErrorState, Icon, Kpi, PageHeader, Panel, Progress, Spinner, StatusChip, useToast } from "../components/ui";

interface Dash {
  kpis: {
    revenue_30d: number | null;
    revenue_prev_30d: number | null;
    orders_30d: number;
    students_total: number;
    students_30d: number;
    enrollments_active: number;
    classes_live: number;
    classes_coming_soon: number;
    pending_verifications: number;
    open_questions: number;
    pending_reviews: number;
    new_messages: number;
  };
  charts: {
    revenue_daily: { period: string; value: number }[] | null;
    revenue_monthly: { period: string; value: number }[] | null;
    enrollments_daily: { period: string; value: number }[];
  };
  top_classes: { id: number; title_en: string; title_bn: string; sales: number; revenue: number }[];
  recent_enrollments: { id: number; enrolled_at: string; source: string; student_name: string; title_en: string; title_bn: string }[];
  recent_orders: { id: number; public_id: string; invoice_no: string | null; status: string; total: number; customer_name: string; method: string | null; created_at: string }[];
  attention: { key: string; severity: "high" | "medium" | "info"; count: number; href: string; items?: { id: number; title_en: string; title_bn: string; waiting?: number }[] }[];
  onboarding: { dismissed: boolean; steps: { key: string; done: boolean; href: string; optional?: boolean }[] };
}

interface Health {
  checks: { key: string; status: "ok" | "warn" | "error" | "info"; issues: string[] }[];
}

const HEALTH_ICON: Record<string, string> = { database: "layers", storage: "download", payments: "wallet", email: "mail", sms: "phone", analytics: "activity", video: "video", chatbot: "bot", security: "shield" };
const HEALTH_FIX: Record<string, string> = { payments: "/settings", email: "/settings?tab=email", sms: "/settings?tab=sms", analytics: "/analytics", video: "/help", chatbot: "/chatbot", security: "/help", database: "/help", storage: "/help" };

function greeting(lang: "bn" | "en"): string {
  const h = new Date(Date.now() + 6 * 3600e3).getUTCHours();
  if (lang === "en") return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 20 ? "Good evening" : "Good night";
  return h < 5 ? "শুভ রাত্রি" : h < 12 ? "শুভ সকাল" : h < 16 ? "শুভ দুপুর" : h < 18 ? "শুভ বিকাল" : h < 20 ? "শুভ সন্ধ্যা" : "শুভ রাত্রি";
}

export function Dashboard() {
  const { t, lang, pick, money, num, date, dateTime } = useI18n();
  const { staff, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => adm<Dash>("/dashboard"), refetchInterval: 120_000 });
  const health = useQuery({ queryKey: ["health"], queryFn: () => adm<Health>("/health"), refetchInterval: 300_000 });
  const hide = useMutation({
    mutationFn: async () => {
      const current = await adm<{ settings: { onboarding: { dismissed: boolean } } }>("/settings");
      return adm("/settings/onboarding", { method: "PUT", json: { ...current.settings.onboarding, dismissed: true } });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dashboard"] }),
    onError: () => toast(t("err.generic"), true),
  });

  const d = dash.data;
  const rev = d?.charts.revenue_daily;
  const k = d?.kpis;
  const delta = useMemo(() => {
    if (!k || k.revenue_30d === null || !k.revenue_prev_30d) return null;
    return Math.round(((k.revenue_30d - k.revenue_prev_30d) / k.revenue_prev_30d) * 100);
  }, [k]);
  const short = (p: string) => date(p).replace(/ [\d০-৯]{4}$/, "");

  if (dash.isPending) return <Spinner />;
  if (dash.isError) return <ErrorState error={dash.error} onRetry={() => dash.refetch()} />;
  const done = d!.onboarding.steps.filter((s) => s.done).length;
  const required = d!.onboarding.steps.filter((s) => !s.optional);
  const allRequiredDone = required.every((s) => s.done);

  return (
    <>
      <PageHeader title={`${greeting(lang)}, ${staff?.name.split(" ")[0] ?? ""}`} sub={t("adm.dash.sub")} />

      {/* ------------------------------------------------ health check strip */}
      <section className="health" aria-label={t("adm.health.title")}>
        {health.data?.checks.map((c) => (
          <Link key={c.key} to={HEALTH_FIX[c.key] ?? "/help"} className={`health-card ${c.status}`} title={c.issues.map((i) => t(`adm.health.${i}` as "adm.health.database_unreachable")).join(" · ") || t("adm.health.ok")}>
            <Icon name={HEALTH_ICON[c.key] ?? "shield"} />
            <span>
              <b>{t(`adm.health.k.${c.key}` as "adm.health.k.database")}</b>
              <small>{c.status === "ok" ? t("adm.health.ok") : c.status === "info" ? t("adm.health.info") : c.status === "warn" ? t("adm.health.warn") : t("adm.health.error")}</small>
            </span>
            <i className="status-dot" />
          </Link>
        ))}
      </section>
      {health.data?.checks.some((c) => c.issues.length > 0 && c.status !== "ok") && (
        <Panel title={t("adm.health.fix")} className="compact">
          <ul className="issues">
            {health.data.checks
              .filter((c) => c.issues.length && c.status !== "ok")
              .flatMap((c) => c.issues.map((i) => ({ c, i })))
              .map(({ c, i }) => (
                <li key={`${c.key}-${i}`} className={c.status}>
                  <Icon name={c.status === "error" ? "shield" : "bell"} />
                  <span>{t(`adm.health.${i}` as "adm.health.database_unreachable")}</span>
                  <Link to={HEALTH_FIX[c.key] ?? "/help"} className="link">
                    {t("adm.health.open")}
                  </Link>
                </li>
              ))}
          </ul>
        </Panel>
      )}

      {/* ------------------------------------------------ first-run guide */}
      {!d!.onboarding.dismissed && !(allRequiredDone && done === d!.onboarding.steps.length) && (
        <Panel
          title={t("adm.onb.title")}
          actions={
            can("settings:write") && (
              <Button className="btn-ghost" busy={hide.isPending} onClick={() => hide.mutate()}>
                {t("adm.onb.hide")}
              </Button>
            )
          }
          className="onboarding"
        >
          <p className="muted">{t("adm.onb.sub")}</p>
          <div className="onb-progress">
            <Progress pct={Math.round((done / d!.onboarding.steps.length) * 100)} label={t("adm.onb.progress", { done: num(done), total: num(d!.onboarding.steps.length) })} />
            <b>{t("adm.onb.progress", { done: num(done), total: num(d!.onboarding.steps.length) })}</b>
          </div>
          <ol className="steps">
            {d!.onboarding.steps.map((s) => (
              <li key={s.key} className={s.done ? "done" : ""}>
                <span className="tick">{s.done ? <Icon name="check" /> : null}</span>
                <span>
                  <b>{t(`adm.onb.${s.key}` as "adm.onb.contacts")}</b>
                  <small>{t(`adm.onb.${s.key}.d` as "adm.onb.contacts.d")}</small>
                </span>
                {s.optional && <Chip>{t("label.optional")}</Chip>}
                {!s.done && (
                  <Link className="btn btn-outline btn-sm" to={s.href}>
                    {t("adm.onb.go")}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {/* ------------------------------------------------ KPI cards */}
      <section className="kpis" aria-label={t("adm.dash.kpis")}>
        {k!.revenue_30d !== null && (
          <Kpi icon="wallet" label={t("adm.kpi.revenue")} value={money(k!.revenue_30d)} sub={delta === null ? t("adm.kpi.noPrev") : `${delta >= 0 ? "▲" : "▼"} ${num(Math.abs(delta))}% ${t("adm.kpi.vsPrev")}`} tone={delta !== null && delta >= 0 ? "ok" : undefined} to="/reports" />
        )}
        <Kpi icon="receipt" label={t("adm.kpi.orders")} value={num(k!.orders_30d)} sub={t("adm.kpi.last30")} to={can("orders:read") ? "/orders?status=paid" : undefined} />
        <Kpi icon="users" label={t("adm.kpi.students")} value={num(k!.students_total)} sub={t("adm.kpi.newStudents", { n: num(k!.students_30d) })} to={can("students:read") ? "/students" : undefined} />
        <Kpi icon="book" label={t("adm.kpi.enrollments")} value={num(k!.enrollments_active)} sub={t("adm.kpi.activeNow")} />
        <Kpi icon="layers" label={t("adm.kpi.classes")} value={num(k!.classes_live)} sub={t("adm.kpi.soon", { n: num(k!.classes_coming_soon) })} to="/courses" />
        <Kpi icon="clock" label={t("adm.kpi.verify")} value={num(k!.pending_verifications)} sub={t("adm.kpi.verifyHint")} to={can("orders:read") ? "/orders?status=awaiting_verification" : undefined} tone={k!.pending_verifications > 0 ? "warn" : undefined} />
        <Kpi icon="chat" label={t("adm.kpi.questions")} value={num(k!.open_questions)} sub={t("adm.kpi.reviewsWait", { n: num(k!.pending_reviews) })} to="/questions?status=open" tone={k!.open_questions > 0 ? "warn" : undefined} />
      </section>

      {/* ------------------------------------------------ needs attention today */}
      <Panel title={t("adm.attn.title")}>
        {d!.attention.length === 0 ? (
          <p className="muted">
            <Icon name="check" className="inline-icon ok" /> {t("adm.attn.clear")}
          </p>
        ) : (
          <ul className="attn">
            {d!.attention.map((a) => (
              <li key={a.key} className={a.severity}>
                <Link to={a.href}>
                  <span className="n">{num(a.count)}</span>
                  <span>
                    <b>{t(`adm.attn.${a.key}` as "adm.attn.manual_payments")}</b>
                    {a.items && a.items.length > 0 && (
                      <small>
                        {a.items
                          .slice(0, 3)
                          .map((i) => pick(i, "title") + (i.waiting ? ` (${num(i.waiting)})` : ""))
                          .join(" · ")}
                        {a.items.length > 3 ? " …" : ""}
                      </small>
                    )}
                  </span>
                  <Icon name="arrow" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ------------------------------------------------ charts */}
      <div className="grid-2">
        {rev && (
          <Panel title={t("adm.chart.revenue30")}>
            <Chart type="line" label={t("adm.chart.revenue30")} labels={rev.map((r) => short(r.period))} datasets={[{ label: t("adm.kpi.revenue"), data: rev.map((r) => r.value), color: "#db1718" }]} format={(n) => money(n)} />
          </Panel>
        )}
        <Panel title={t("adm.chart.enroll30")}>
          <Chart type="bar" label={t("adm.chart.enroll30")} labels={d!.charts.enrollments_daily.map((r) => short(r.period))} datasets={[{ label: t("adm.kpi.enrollments"), data: d!.charts.enrollments_daily.map((r) => r.value), color: "#c4b14a" }]} />
        </Panel>
        {d!.charts.revenue_monthly && (
          <Panel title={t("adm.chart.revenue12")} className="span-2">
            <Chart type="bar" label={t("adm.chart.revenue12")} labels={d!.charts.revenue_monthly.map((r) => r.period)} datasets={[{ label: t("adm.kpi.revenue"), data: d!.charts.revenue_monthly.map((r) => r.value), color: "#db1718" }]} format={(n) => money(n)} />
          </Panel>
        )}
      </div>

      {/* ------------------------------------------------ lists */}
      <div className="grid-2">
        <Panel title={t("adm.dash.topClasses")}>
          {d!.top_classes.length === 0 ? (
            <p className="muted">{t("adm.dash.noSales")}</p>
          ) : (
            <ol className="rank">
              {d!.top_classes.map((c) => (
                <li key={c.id}>
                  <Link to={`/courses/${c.id}`}>{pick(c, "title")}</Link>
                  <span>
                    {num(c.sales)} {t("adm.dash.sales")}
                    {rev ? ` · ${money(c.revenue)}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title={t("adm.dash.recentEnroll")}>
          {d!.recent_enrollments.length === 0 ? (
            <p className="muted">{t("adm.dash.noEnroll")}</p>
          ) : (
            <ul className="feed">
              {d!.recent_enrollments.map((e) => (
                <li key={e.id}>
                  <b>{e.student_name}</b> <span className="muted">→</span> {pick(e, "title")}
                  <small>{dateTime(e.enrolled_at)}</small>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {can("orders:read") && (
          <Panel title={t("adm.dash.recentOrders")} className="span-2" actions={<Link className="link" to="/orders">{t("btn.viewAll")}</Link>}>
            {d!.recent_orders.length === 0 ? (
              <p className="muted">{t("adm.dash.noOrders")}</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <tbody>
                    {d!.recent_orders.map((o) => (
                      <tr key={o.id}>
                        <td>{o.invoice_no ?? o.public_id.slice(0, 8)}</td>
                        <td>{o.customer_name}</td>
                        <td className="num">{money(o.total)}</td>
                        <td>
                          <StatusChip status={o.status} />
                        </td>
                        <td className="muted">{dateTime(o.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
