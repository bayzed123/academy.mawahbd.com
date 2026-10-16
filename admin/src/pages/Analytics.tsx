import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GA_EVENT_GROUPS, GA_EVENTS, GA_FUNNEL } from "@mawah/shared";
import { adm, ApiError, qstring } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Chart } from "../components/Chart";
import { Button, Chip, ErrorState, Icon, Kpi, KV, PageHeader, Panel, Progress, Spinner, Tabs, useToast } from "../components/ui";

type Problem = "not_configured" | "key_invalid" | "key_rejected" | "api_disabled" | "no_access" | "property_missing" | "bad_request" | "quota" | "network" | "google_error" | "other";
type Range = "today" | "7d" | "28d" | "90d";

interface Last {
  at: string;
  ok: boolean;
  problem: Problem | null;
  detail: string | null;
}
interface Status {
  measurement_id: string | null;
  tag_live: boolean;
  property_id: string | null;
  stream_id: string | null;
  key_set: boolean;
  key_problem: "key_invalid" | null;
  service_email: string | null;
  last: Last | null;
}
interface NotConnected {
  connected: false;
  problem: Problem;
  detail?: string;
  status?: number;
}
interface ClassRow {
  slug: string;
  id: number | null;
  title_bn: string;
  title_en: string;
  status: string | null;
  views: number;
  people: number;
  seconds_per_person: number;
  item_views: number;
  carts: number;
  checkouts: number;
  ga_purchases: number;
  paid_sales: number;
  revenue: number;
}
interface Bucket {
  name: string;
  sessions: number;
  users: number;
}
interface Report {
  connected: true;
  range: Range;
  fetched_at: string;
  from: string;
  to: string;
  overview: { users: number; new_users: number; sessions: number; page_views: number; engagement_rate: number; avg_session_sec: number } | null;
  daily: { date: string; page_views: number; users: number }[];
  classes: ClassRow[];
  events: { event: string; count: number; users: number }[];
  sources: Bucket[];
  devices: Bucket[];
  countries: Bucket[];
  searches: { term: string; count: number }[];
  promotions: { name: string; views: number; clicks: number }[];
  pages: { path: string; views: number; users: number }[];
  problems: { section: string; problem: Problem; detail?: string }[];
}
interface Live {
  connected: true;
  fetched_at: string;
  active_users: number;
  pages: { title: string; users: number }[];
}
interface CheckResult {
  connected: boolean;
  problem?: Problem;
  detail?: string;
  status?: number;
}

/**
 * Admin → Analytics. Everything shown here is a number Google Analytics (or the shop's own database, where it says so) returned: nothing is estimated.
 * When the connection to Google is not in place the screen says exactly which step is missing, in plain words, with the steps to fix it.
 */
export function Analytics() {
  const { t, err, dateTime, num } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = can("analytics:manage");
  const [range, setRange] = useState<Range>("28d");
  const [checked, setChecked] = useState<CheckResult | null>(null);

  const status = useQuery({ queryKey: ["an-status"], queryFn: () => adm<Status>("/analytics/status") });
  const report = useQuery({
    queryKey: ["an-report", range],
    queryFn: async () => (await adm<{ report: Report | NotConnected }>(`/analytics/report${qstring({ range })}`)).report,
    staleTime: 60_000,
  });
  const connected = report.data?.connected === true;
  const live = useQuery({
    queryKey: ["an-live"],
    queryFn: async () => (await adm<{ live: Live | NotConnected }>("/analytics/realtime")).live,
    enabled: connected,
    refetchInterval: 30_000,
  });

  const refetchAll = () => {
    void qc.invalidateQueries({ queryKey: ["an-status"] });
    void qc.invalidateQueries({ queryKey: ["an-report"] });
    void qc.invalidateQueries({ queryKey: ["an-live"] });
  };
  const check = useMutation({
    mutationFn: () => adm<CheckResult>("/analytics/check", { method: "POST", json: {} }),
    onSuccess: (r) => {
      setChecked(r);
      void adm("/analytics/refresh", { method: "POST", json: {} }).finally(refetchAll);
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  const refresh = useMutation({
    mutationFn: () => adm("/analytics/refresh", { method: "POST", json: {} }),
    onSuccess: () => {
      toast(t("adm.an.refreshed"));
      refetchAll();
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });

  if (status.isPending || report.isPending) return <Spinner />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;
  const s = status.data;
  const r = report.data;
  const gaUrl = `https://analytics.google.com/analytics/web/#/p${s.property_id ?? ""}/reports/intelligenthome`;

  return (
    <>
      <PageHeader
        title={t("adm.an.title")}
        sub={t("adm.an.sub")}
        actions={
          <a className="btn btn-outline btn-sm" href={gaUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="external" /> {t("adm.an.open")}
            <span className="vh"> ({t("adm.banners.newTab")})</span>
          </a>
        }
      />

      <Connection status={s} problem={r.connected ? null : r} checked={checked} canManage={canManage} checking={check.isPending} onCheck={() => check.mutate()} open={!r.connected} />

      {r.connected && (
        <>
          <div className="table-bar">
            <Tabs
              value={range}
              onChange={setRange}
              tabs={[
                { value: "today", label: t("adm.an.range.today") },
                { value: "7d", label: t("adm.reports.lastDays", { n: num(7) }) },
                { value: "28d", label: t("adm.reports.lastDays", { n: num(28) }) },
                { value: "90d", label: t("adm.reports.lastDays", { n: num(90) }) },
              ]}
            />
            <div className="grow" />
            <span className="hint">{t("adm.an.updated", { when: dateTime(r.fetched_at) })}</span>
            {canManage && (
              <Button className="btn-outline btn-sm" busy={refresh.isPending} onClick={() => refresh.mutate()}>
                <Icon name="refresh" /> {t("adm.an.refresh")}
              </Button>
            )}
          </div>
          <Dashboard report={r} live={live.data?.connected ? live.data : null} />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ the connection */
function Connection({ status: s, problem, checked, canManage, checking, onCheck, open }: { status: Status; problem: NotConnected | null; checked: CheckResult | null; canManage: boolean; checking: boolean; onCheck: () => void; open: boolean }) {
  const { t, num, dateTime } = useI18n();
  const toast = useToast();
  const shown: { problem: Problem; detail?: string; status?: number } | null = checked && !checked.connected ? { problem: checked.problem ?? "other", detail: checked.detail, status: checked.status } : problem;
  const vars = { email: s.service_email ?? "—", property: s.property_id ?? "—" };
  const title = (p: Problem) => t(`adm.an.p.${p}.title` as "adm.an.p.other.title");
  const body = (p: Problem) => t(`adm.an.p.${p}.body` as "adm.an.p.other.body", vars);
  const said = (r: { detail?: string; status?: number }) =>
    r.detail ? (
      <p className="said">
        {t("adm.an.said")}: <q>{r.detail}</q>
        {r.status ? ` (${r.status})` : ""}
      </p>
    ) : null;
  const last = s.last ? (
    s.last.ok ? (
      <span className="ok-text">{t("adm.an.conn.lastOk", { when: dateTime(s.last.at) })}</span>
    ) : (
      <span>
        {t("adm.an.conn.lastFail", { when: dateTime(s.last.at) })}
        {s.last.problem ? ` · ${title(s.last.problem)}` : ""}
      </span>
    )
  ) : (
    t("adm.an.conn.lastNever")
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(s.service_email ?? "");
      toast(t("adm.copied"));
    } catch {
      /* the address is on screen; it can be selected by hand */
    }
  };

  const content = (
    <>
      {shown && (
        <div className="notice bad-note" role="alert">
          <Icon name="x" />
          <div>
            <b>{title(shown.problem)}</b>
            <p>{body(shown.problem)}</p>
            {said(shown)}
          </div>
        </div>
      )}
      <div aria-live="polite">
        {checked?.connected && (
          <div className="notice ok-note">
            <Icon name="check" />
            <div>
              <b>{t("adm.an.conn.ok")}</b>
            </div>
          </div>
        )}
      </div>
      <KV
        items={[
          { label: t("adm.an.conn.tag"), value: s.tag_live && s.measurement_id ? <Chip tone="ok">{t("adm.an.conn.tagOn", { id: s.measurement_id })}</Chip> : <Chip tone="warn">{t("adm.an.conn.tagOff")}</Chip> },
          { label: t("adm.an.conn.property"), value: s.property_id ? <code>{s.property_id}</code> : "—" },
          { label: t("adm.an.conn.stream"), value: s.stream_id ? <code>{s.stream_id}</code> : "—" },
          {
            label: t("adm.an.conn.key"),
            value: s.key_problem ? <Chip tone="bad">{t("adm.an.conn.unreadable")}</Chip> : s.key_set ? <Chip tone="ok">{t("adm.an.conn.set")}</Chip> : <Chip tone="warn">{t("adm.an.conn.notSet")}</Chip>,
          },
          ...(s.service_email
            ? [
                {
                  label: t("adm.an.conn.email"),
                  value: (
                    <span className="row">
                      <code className="code">{s.service_email}</code>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => void copy()}>
                        <Icon name="link" /> {t("adm.an.conn.copy")}
                      </button>
                    </span>
                  ),
                },
              ]
            : []),
          { label: t("adm.an.conn.last"), value: last },
        ]}
      />
      <div className="row mt">
        <Button className="btn-primary" busy={checking} disabled={!canManage} onClick={onCheck}>
          <Icon name="refresh" /> {t("adm.an.conn.check")}
        </Button>
        {!canManage && <span className="hint">{t("adm.an.conn.readonly")}</span>}
      </div>
      {!s.key_set && (
        <p className="hint mt">
          {t("adm.an.p.not_configured.body")} ({num(1)}–{num(5)})
        </p>
      )}
      <h3 className="mt">{t("adm.an.steps.title")}</h3>
      <ol className="an-steps">
        {[1, 2, 3, 4, 5].map((n) => (
          <li key={n}>{t(`adm.an.steps.${n}` as "adm.an.steps.1")}</li>
        ))}
      </ol>
    </>
  );

  return open ? (
    <Panel title={t("adm.an.conn.title")}>{content}</Panel>
  ) : (
    <details className="panel an-conn">
      <summary>
        <b>{t("adm.an.conn.title")}</b> · {last}
      </summary>
      {content}
    </details>
  );
}

/** A table that may be wider than the screen scrolls inside its own box; the box can be reached and scrolled with the keyboard (and has a name for screen readers). */
function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ the numbers */
function Dashboard({ report: r, live }: { report: Report; live: Live | null }) {
  const { t, tx, lang, num, money } = useI18n();
  const dur = (sec: number) => {
    const s = Math.round(sec);
    if (s < 60) return `${num(s)}${lang === "bn" ? " সে" : "s"}`;
    return `${num(Math.floor(s / 60))}${lang === "bn" ? " মি " : "m "}${num(s % 60)}${lang === "bn" ? " সে" : "s"}`;
  };
  const pct = (x: number) => `${num(Math.round(x * 100))}%`;
  const day = (g: string) => (/^\d{8}$/.test(g) ? `${g.slice(6, 8)}/${g.slice(4, 6)}` : g);
  const title = (c: ClassRow) => (lang === "bn" ? c.title_bn || c.title_en : c.title_en || c.title_bn) || c.slug;
  const o = r.overview;
  const byEvent = new Map(r.events.map((e) => [e.event, e]));
  const firstStep = byEvent.get(GA_FUNNEL[0])?.users ?? 0;
  const label = (event: string) => tx(`adm.an.ev.${event}`, event);

  return (
    <>
      {live && (
        <Panel title={t("adm.an.live.title")}>
          <div className="an-live">
            <div>
              <b className="big">{num(live.active_users)}</b>
              <p className="muted">{live.active_users > 0 ? t("adm.an.live.people", { n: num(live.active_users) }) : t("adm.an.live.none")}</p>
            </div>
            {live.pages.length > 0 && (
              <div>
                <p className="hint">{t("adm.an.live.pages")}</p>
                <ul className="plain">
                  {live.pages.map((p) => (
                    <li key={p.title}>
                      {p.title || "—"} · <b>{num(p.users)}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>
      )}

      {o && (
        <section className="kpis" aria-label={t("adm.an.k.range", { from: r.from, to: r.to })}>
          <Kpi icon="users" label={t("adm.an.k.users")} value={num(o.users)} />
          <Kpi icon="user" label={t("adm.an.k.new")} value={num(o.new_users)} />
          <Kpi icon="chart" label={t("adm.an.k.sessions")} value={num(o.sessions)} />
          <Kpi icon="book" label={t("adm.an.k.views")} value={num(o.page_views)} />
          <Kpi icon="check" label={t("adm.an.k.engaged")} value={pct(o.engagement_rate)} />
          <Kpi icon="clock" label={t("adm.an.k.time")} value={dur(o.avg_session_sec)} />
        </section>
      )}

      {r.daily.length > 1 && (
        <Panel title={t("adm.an.trend")}>
          <Chart
            type="line"
            label={t("adm.an.trend")}
            labels={r.daily.map((d) => day(d.date))}
            datasets={[
              { label: t("adm.an.trend.views"), data: r.daily.map((d) => d.page_views) },
              { label: t("adm.an.trend.users"), data: r.daily.map((d) => d.users), color: "#c4b14a" },
            ]}
          />
        </Panel>
      )}

      <Panel
        title={t("adm.an.classes.title")}
        actions={
          <a className="btn btn-outline btn-sm" href={`/api/admin/analytics/classes.csv${qstring({ range: r.range })}`} download>
            <Icon name="download" /> {t("adm.csv")}
          </a>
        }
      >
        <p className="muted">{t("adm.an.classes.sub")}</p>
        {r.classes.length === 0 ? (
          <p className="muted">{t("adm.an.none")}</p>
        ) : (
          <Scroll label={t("adm.an.classes.title")}>
            <table className="table compact" data-testid="an-classes">
              <thead>
                <tr>
                  <th>{t("adm.an.c.class")}</th>
                  <th className="num">{t("adm.an.c.views")}</th>
                  <th className="num">{t("adm.an.c.people")}</th>
                  <th className="num">{t("adm.an.c.time")}</th>
                  <th className="num">{t("adm.an.c.carts")}</th>
                  <th className="num">{t("adm.an.c.checkouts")}</th>
                  <th className="num">{t("adm.an.c.bought")}</th>
                  <th className="num">{t("adm.an.c.sales")}</th>
                  <th className="num">{t("adm.an.c.money")}</th>
                </tr>
              </thead>
              <tbody>
                {r.classes.map((c) => (
                  <tr key={c.slug}>
                    <td>
                      {c.id === null ? (
                        <>
                          <code className="code">{c.slug}</code> <span className="hint">{t("adm.an.c.gone")}</span>
                        </>
                      ) : (
                        <>
                          {title(c)} {c.views === 0 && <Chip tone="warn">{t("adm.an.c.none")}</Chip>}
                        </>
                      )}
                    </td>
                    <td className="num">{num(c.views)}</td>
                    <td className="num">{num(c.people)}</td>
                    <td className="num">{c.views > 0 ? dur(c.seconds_per_person) : "—"}</td>
                    <td className="num">{num(c.carts)}</td>
                    <td className="num">{num(c.checkouts)}</td>
                    <td className="num">{num(c.ga_purchases)}</td>
                    <td className="num">
                      <b>{num(c.paid_sales)}</b>
                    </td>
                    <td className="num">
                      <b>{money(c.revenue)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
        <p className="hint">{t("adm.an.c.note")}</p>
      </Panel>

      <div className="grid-2">
        <Panel title={t("adm.an.funnel.title")}>
          <p className="muted">{t("adm.an.funnel.sub")}</p>
          <ul className="an-funnel">
            {GA_FUNNEL.map((name) => {
              const users = byEvent.get(name)?.users ?? 0;
              const share = firstStep > 0 ? (users / firstStep) * 100 : 0;
              return (
                <li key={name}>
                  <span className="row between">
                    <span>{label(name)}</span>
                    <b>{num(users)}</b>
                  </span>
                  <Progress pct={share} label={label(name)} />
                  {name !== GA_FUNNEL[0] && firstStep > 0 && <small className="hint">{t("adm.an.funnel.of", { pct: num(Math.round(share)) })}</small>}
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title={t("adm.an.src.title")}>
          <Buckets rows={r.sources} head={t("adm.an.src.name")} visits={t("adm.an.src.visits")} people={t("adm.an.src.people")} none={t("adm.an.none")} />
        </Panel>

        <Panel title={t("adm.an.dev.title")}>
          <Buckets rows={r.devices.map((d) => ({ ...d, name: tx(`adm.an.dv.${d.name}`, d.name) }))} head={t("adm.an.dev.title")} visits={t("adm.an.src.visits")} people={t("adm.an.src.people")} none={t("adm.an.none")} />
        </Panel>

        <Panel title={t("adm.an.cty.title")}>
          <Buckets rows={r.countries} head={t("adm.an.cty.title")} visits={t("adm.an.src.visits")} people={t("adm.an.src.people")} none={t("adm.an.none")} />
        </Panel>

        <Panel title={t("adm.an.search.title")}>
          {r.searches.length === 0 ? (
            <p className="muted">{t("adm.an.search.none")}</p>
          ) : (
            <ul className="plain">
              {r.searches.map((q) => (
                <li key={q.term}>
                  {q.term} · <b>{num(q.count)}</b>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("adm.an.promo.title")}>
          {r.promotions.length === 0 ? (
            <p className="muted">{t("adm.an.promo.none")}</p>
          ) : (
            <Scroll label={t("adm.an.promo.title")}>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>{t("adm.an.promo.title")}</th>
                    <th className="num">{t("adm.an.promo.seen")}</th>
                    <th className="num">{t("adm.an.promo.clicked")}</th>
                    <th className="num">{t("adm.an.promo.rate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.promotions.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td className="num">{num(p.views)}</td>
                      <td className="num">{num(p.clicks)}</td>
                      <td className="num">{p.views > 0 ? pct(p.clicks / p.views) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
          )}
        </Panel>
      </div>

      <Panel title={t("adm.an.events.title")}>
        <p className="muted">{t("adm.an.events.sub")}</p>
        {GA_EVENT_GROUPS.map((g) => {
          const rows = GA_EVENTS.filter((e) => e.group === g)
            .map((e) => byEvent.get(e.name))
            .filter((e): e is { event: string; count: number; users: number } => !!e && e.count > 0);
          if (rows.length === 0) return null;
          return (
            <div key={g} className="mt">
              <h3>{t(`adm.an.g.${g}` as "adm.an.g.buying")}</h3>
              <Scroll label={t(`adm.an.g.${g}` as "adm.an.g.buying")}>
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>{t("adm.an.e.event")}</th>
                      <th className="num">{t("adm.an.e.times")}</th>
                      <th className="num">{t("adm.an.e.people")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.event}>
                        <td>{label(e.event)}</td>
                        <td className="num">{num(e.count)}</td>
                        <td className="num">{num(e.users)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            </div>
          );
        })}
        {r.events.length === 0 && <p className="muted">{t("adm.an.none")}</p>}
      </Panel>

      <Panel title={t("adm.an.pages.title")}>
        {r.pages.length === 0 ? (
          <p className="muted">{t("adm.an.none")}</p>
        ) : (
          <Scroll label={t("adm.an.pages.title")}>
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t("adm.an.pages.title")}</th>
                  <th className="num">{t("adm.an.c.views")}</th>
                  <th className="num">{t("adm.an.c.people")}</th>
                </tr>
              </thead>
              <tbody>
                {r.pages.map((p) => (
                  <tr key={p.path}>
                    <td>
                      <code className="code">{p.path}</code>
                    </td>
                    <td className="num">{num(p.views)}</td>
                    <td className="num">{num(p.users)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </Panel>

      {r.problems.length > 0 && (
        <div className="notice" role="status">
          <Icon name="bell" />
          <div>
            <b>{t("adm.an.partial")}</b>
            <ul className="plain">
              {r.problems.map((p) => (
                <li key={p.section}>
                  {tx(`adm.an.sec.${p.section}`, p.section)} — {t(`adm.an.p.${p.problem}.title` as "adm.an.p.other.title")}
                  {p.detail ? <span className="said"> · {p.detail}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <p className="hint">{t("adm.an.late")}</p>
    </>
  );
}

function Buckets({ rows, head, visits, people, none }: { rows: Bucket[]; head: string; visits: string; people: string; none: string }) {
  const { num } = useI18n();
  if (rows.length === 0) return <p className="muted">{none}</p>;
  return (
    <Scroll label={head}>
      <table className="table compact">
        <thead>
          <tr>
            <th>{head}</th>
            <th className="num">{visits}</th>
            <th className="num">{people}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.name}>
              <td>{b.name || "—"}</td>
              <td className="num">{num(b.sessions)}</td>
              <td className="num">{num(b.users)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  );
}
