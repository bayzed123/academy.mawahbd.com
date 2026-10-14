import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { adm, qstring } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Chart } from "../components/Chart";
import { Empty, ErrorState, Icon, PageHeader, Panel, Spinner, Tabs } from "../components/ui";

interface Revenue {
  from: string;
  to: string;
  group: "day" | "month";
  totals: { orders: number; revenue: number; discounts: number; students: number; average_order: number };
  refunds: { orders: number; amount: number };
  series: { period: string; orders: number; revenue: number; discounts: number }[];
  by_course: { course_id: number; title_en: string; title_bn: string; sales: number; revenue: number }[];
  by_method: { method: string; orders: number; revenue: number }[];
  by_coupon: { code: string; orders: number; discount_total: number }[];
}
interface LearningRow {
  id: number;
  title_en: string;
  title_bn: string;
  status: string;
  enrolled: number;
  completed: number;
  completion_pct: number;
  avg_progress_pct: number;
  rating_avg: number;
  rating_count: number;
  reviews_pending: number;
  questions_open: number;
}

const dhaka = (offsetDays = 0) => new Date(Date.now() + 6 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

function RevenueReport() {
  const { t, pick, money, num } = useI18n();
  const [from, setFrom] = useState(dhaka(-29));
  const [to, setTo] = useState(dhaka());
  const [group, setGroup] = useState<"day" | "month">("day");
  const q = useQuery({ queryKey: ["report-revenue", from, to, group], queryFn: () => adm<Revenue>(`/reports/revenue${qstring({ from, to, group })}`) });
  const preset = (days: number) => {
    setFrom(dhaka(-(days - 1)));
    setTo(dhaka());
    setGroup(days > 92 ? "month" : "day");
  };
  return (
    <>
      <div className="table-bar">
        <div className="row">
          {[7, 30, 90, 365].map((d) => (
            <button key={d} type="button" className="btn btn-outline btn-sm" onClick={() => preset(d)}>
              {t("adm.reports.lastDays", { n: num(d) })}
            </button>
          ))}
        </div>
        <div className="date-range">
          <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label={t("adm.f.from")} />
          <span>→</span>
          <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label={t("adm.f.to")} />
        </div>
        <div className="grow" />
        <a className="btn btn-outline btn-sm" href={`/api/admin/reports/revenue.csv${qstring({ from, to, group })}`} download>
          <Icon name="download" /> {t("adm.csv")}
        </a>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <section className="kpis">
            {[
              { label: t("adm.reports.revenue"), value: money(q.data.totals.revenue), icon: "wallet" },
              { label: t("adm.kpi.orders"), value: num(q.data.totals.orders), icon: "receipt" },
              { label: t("adm.reports.avgOrder"), value: money(q.data.totals.average_order), icon: "chart" },
              { label: t("adm.reports.buyers"), value: num(q.data.totals.students), icon: "users" },
              { label: t("adm.reports.discounts"), value: money(q.data.totals.discounts), icon: "tag" },
              { label: t("adm.reports.refunds"), value: `${money(q.data.refunds.amount)} (${num(q.data.refunds.orders)})`, icon: "refresh" },
            ].map((k) => (
              <div className="kpi" key={k.label}>
                <span className="kpi-ico">
                  <Icon name={k.icon} />
                </span>
                <span className="kpi-body">
                  <small>{k.label}</small>
                  <b>{k.value}</b>
                </span>
              </div>
            ))}
          </section>
          <Panel
            title={t("adm.reports.overTime")}
            actions={
              <Tabs value={group} onChange={setGroup} tabs={[{ value: "day", label: t("adm.reports.byDay") }, { value: "month", label: t("adm.reports.byMonth") }]} />
            }
          >
            {q.data.series.length === 0 ? (
              <Empty icon="chart" title={t("adm.reports.noData")} />
            ) : (
              <Chart type={group === "day" ? "line" : "bar"} label={t("adm.reports.overTime")} labels={q.data.series.map((s) => s.period)} datasets={[{ label: t("adm.reports.revenue"), data: q.data.series.map((s) => s.revenue) }]} format={(n) => money(n)} />
            )}
          </Panel>
          <div className="grid-2">
            <Panel title={t("adm.reports.byClass")}>
              {q.data.by_course.length === 0 ? (
                <p className="muted">{t("adm.reports.noData")}</p>
              ) : (
                <div className="table-scroll">
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>{t("adm.nav.courses")}</th>
                        <th className="num">{t("adm.dash.sales")}</th>
                        <th className="num">{t("adm.reports.revenue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.by_course.map((c) => (
                        <tr key={c.course_id}>
                          <td>{pick(c, "title")}</td>
                          <td className="num">{num(c.sales)}</td>
                          <td className="num">{money(c.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel title={t("adm.reports.byMethod")}>
              {q.data.by_method.length === 0 ? (
                <p className="muted">{t("adm.reports.noData")}</p>
              ) : (
                <>
                  <Chart type="doughnut" label={t("adm.reports.byMethod")} labels={q.data.by_method.map((m) => t(`method.${m.method}` as "method.bkash"))} datasets={[{ label: t("adm.reports.revenue"), data: q.data.by_method.map((m) => m.revenue) }]} format={(n) => money(n)} />
                  {q.data.by_coupon.length > 0 && (
                    <>
                      <h3>{t("adm.nav.coupons")}</h3>
                      <table className="table compact">
                        <tbody>
                          {q.data.by_coupon.map((c) => (
                            <tr key={c.code}>
                              <td>
                                <code className="code">{c.code}</code>
                              </td>
                              <td className="num">{num(c.orders)}</td>
                              <td className="num">−{money(c.discount_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

function LearningReport() {
  const { t, pick, num } = useI18n();
  const q = useQuery({ queryKey: ["report-learning"], queryFn: () => adm<{ items: LearningRow[]; top_rated: LearningRow[] }>("/reports/learning") });
  return (
    <>
      <div className="table-bar">
        <div className="grow" />
        <a className="btn btn-outline btn-sm" href="/api/admin/reports/learning.csv" download>
          <Icon name="download" /> {t("adm.csv")}
        </a>
        <a className="btn btn-outline btn-sm" href={`/api/admin/reports/enrollments.csv${qstring({ from: dhaka(-364), to: dhaka() })}`} download>
          <Icon name="download" /> {t("adm.reports.enrollCsv")}
        </a>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <Panel title={t("adm.reports.learning")}>
          {q.data.items.length === 0 ? (
            <Empty icon="book" title={t("adm.reports.noData")} />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("adm.nav.courses")}</th>
                    <th className="num">{t("adm.reports.enrolled")}</th>
                    <th className="num">{t("adm.reports.completed")}</th>
                    <th className="num desk">{t("adm.reports.completion")}</th>
                    <th className="num desk">{t("adm.reports.avgProgress")}</th>
                    <th className="num desk">{t("label.rating")}</th>
                    <th className="num desk">{t("adm.reports.open")}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((r) => (
                    <tr key={r.id}>
                      <td>{pick(r, "title")}</td>
                      <td className="num">{num(r.enrolled)}</td>
                      <td className="num">{num(r.completed)}</td>
                      <td className="num desk">{num(r.completion_pct)}%</td>
                      <td className="num desk">{num(r.avg_progress_pct)}%</td>
                      <td className="num desk">{r.rating_count ? `${r.rating_avg.toFixed(1)} (${num(r.rating_count)})` : "—"}</td>
                      <td className="num desk">{num(r.reviews_pending + r.questions_open)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

export function Reports() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "learning" || !can("reports:revenue") ? "learning" : "revenue";
  return (
    <>
      <PageHeader title={t("adm.nav.reports")} sub={t("adm.reports.sub")} />
      {can("reports:revenue") && <Tabs value={tab} onChange={(v) => setParams(v === "revenue" ? {} : { tab: v })} tabs={[{ value: "revenue", label: t("adm.reports.tabRevenue") }, { value: "learning", label: t("adm.reports.tabLearning") }]} />}
      {tab === "revenue" ? <RevenueReport /> : <LearningReport />}
    </>
  );
}
