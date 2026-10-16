import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderDTO, OrderStatus } from "@mawah/shared";
import { CURRENCY, firstTime, gaItem, track } from "../lib/analytics";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { KeepAccount } from "../components/KeepAccount";
import { Empty, ErrorState, Icon, Spinner } from "../components/ui";
import { ManualPay, ManualWaiting } from "./ManualPay";

const statusIcon: Record<OrderStatus, string> = { paid: "check", pending: "clock", awaiting_verification: "clock", failed: "x", cancelled: "x", refunded: "x" };

export function Orders() {
  const { t, pick, money, date, lang } = useI18n();
  const q = useQuery({ queryKey: ["orders"], queryFn: async () => (await api<{ orders: OrderDTO[] }>("/student/orders")).orders });
  return (
    <>
      <div className="page-head">
        <h1>{t("app.orders.title")}</h1>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && (
        <Empty icon="wallet" title={t("app.orders.empty")}>
          <a className="btn btn-primary" href={lang === "en" ? "/en/courses" : "/courses"}>
            {t("app.nav.browse")}
          </a>
        </Empty>
      )}
      {q.data?.map((o) => (
        <Link key={o.public_id} to={`/orders/${o.public_id}`} className="order-row">
          <span>
            <b>{o.invoice_no ?? o.public_id.slice(0, 8).toUpperCase()}</b>
            <br />
            <small className="muted">{o.items.map((i) => pick(i, "title")).join(", ")}</small>
          </span>
          <span className="row">
            <span className="muted small">{date(o.created_at)}</span>
            <b>{money(o.total)}</b>
            <span className={`chip ${o.status}`}>{o.gateway === "manual" && o.status === "pending" ? t("app.orders.payNow") : t(`status.${o.status}` as "status.paid")}</span>
          </span>
        </Link>
      ))}
    </>
  );
}

export function OrderDetail() {
  const { publicId = "" } = useParams();
  const { t, pick, money, dateTime, lang } = useI18n();
  const qc = useQueryClient();
  const started = useRef(Date.now());
  const skewMs = useRef(0); // the server's clock minus this device's, so the payment countdown is right even when the phone's clock is off
  const q = useQuery({
    queryKey: ["order", publicId],
    queryFn: async () => {
      const r = await api<{ order: OrderDTO; now?: string }>(`/student/orders/${publicId}`);
      if (r.now) skewMs.current = Date.parse(r.now) - Date.now();
      return r.order;
    },
    // the payment webhook can arrive after the browser redirect: keep checking for a few minutes, politely. An open manual order
    // changes only when staff decide, so while this page is on screen it asks every 15 seconds for up to two hours (not in a hidden tab).
    refetchInterval: (query) => {
      const d = query.state.data;
      const age = Date.now() - started.current;
      if (d?.status === "pending") return d.gateway === "manual" ? false : age < 4 * 60_000 ? 3000 : false;
      if (d?.status === "awaiting_verification") return age < 2 * 3600_000 ? 15_000 : false;
      return false;
    },
  });

  const status = q.data?.status;
  // the moment the order turns paid, the new class must show up in My Learning
  useEffect(() => {
    if (status === "paid") void qc.invalidateQueries({ queryKey: ["my-courses"] });
  }, [status, qc]);

  // what happened to the payment, said once per order on this device: a sale is counted once however often this page is opened
  // (and Google counts one "transaction_id" once as well). A manual payment is a sale only when staff have confirmed it.
  const order = q.data;
  useEffect(() => {
    if (!order) return;
    const base = {
      transaction_id: order.public_id,
      currency: CURRENCY,
      value: order.total,
      coupon: order.coupon_code ?? undefined,
      payment_type: order.method ?? order.gateway ?? undefined,
      items: order.items.map((i) => gaItem(i)),
    };
    if (order.status === "paid" && firstTime(`purchase:${order.public_id}`)) track("purchase", base);
    else if (order.status === "awaiting_verification" && firstTime(`waiting:${order.public_id}`)) track("payment_pending", base);
    else if ((order.status === "failed" || order.status === "cancelled") && firstTime(`${order.status}:${order.public_id}`)) track("payment_failed", { ...base, reason: order.status });
  }, [order?.status, order?.public_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const first = o.items[0];
  const manualOpen = o.gateway === "manual" && !!o.manual && (o.status === "pending" || o.status === "awaiting_verification");

  const hero = (
    <section className={`panel status-hero ${o.status}`}>
      <div className="big">
        <Icon name={statusIcon[o.status]} />
      </div>
      <h1>{t(`app.orders.status.${o.status}.title` as "app.orders.status.paid.title")}</h1>
      <p className="muted">{t(`app.orders.status.${o.status}.body` as "app.orders.status.paid.body")}</p>
      {o.status === "pending" && <span className="spinner sm" aria-hidden="true" />}
      <div className="row mt">
        {o.status === "paid" && first?.slug && (
          <Link className="btn btn-primary btn-lg" to={o.items.length === 1 ? `/learn/${first.slug}` : "/"}>
            <Icon name="play" /> {t("app.orders.startLearning")}
          </Link>
        )}
        {(o.status === "failed" || o.status === "cancelled") && first?.slug && (
          <Link className="btn btn-primary btn-lg" to={`/checkout?c=${first.slug}`}>
            {t("app.orders.tryAgain")}
          </Link>
        )}
        {o.status === "paid" && (
          <a className="btn btn-outline" href={`/api/student/orders/${o.public_id}/invoice?lang=${lang}`} target="_blank" rel="noopener noreferrer" onClick={() => track("invoice_download", { transaction_id: o.public_id })}>
            <Icon name="download" /> {t("app.orders.invoice")}
          </a>
        )}
      </div>
    </section>
  );

  return (
    <>
      {manualOpen && o.status === "pending" ? (
        <ManualPay order={o} skewMs={skewMs.current} />
      ) : (
        hero
      )}
      {manualOpen && o.status === "awaiting_verification" && <ManualWaiting order={o} />}
      {o.status === "paid" && <KeepAccount />}

      <section className="panel">
        <h2>{t("app.orders.items")}</h2>
        {o.items.map((i) => (
          <div className="summary-item" key={i.course_id}>
            <span>{pick(i, "title")}</span>
            <b>{i.price === 0 ? t("label.free") : money(i.price)}</b>
          </div>
        ))}
        <div className="sum-row total">
          <span>{t("label.total")}</span>
          <span>{money(o.total)}</span>
        </div>
        <dl className="kv-grid mt">
          {o.invoice_no && (
            <div>
              <dt>{t("app.orders.invoiceNo")}</dt>
              <dd>{o.invoice_no}</dd>
            </div>
          )}
          <div>
            <dt>{t("app.orders.ref")}</dt>
            <dd>{o.public_id}</dd>
          </div>
          <div>
            <dt>{t("label.date")}</dt>
            <dd>{dateTime(o.created_at)}</dd>
          </div>
          {o.paid_at && (
            <div>
              <dt>{t("app.orders.paidOn")}</dt>
              <dd>{dateTime(o.paid_at)}</dd>
            </div>
          )}
          {o.method && (
            <div>
              <dt>{t("app.orders.method")}</dt>
              <dd>{t(`method.${o.method}` as "method.bkash")}</dd>
            </div>
          )}
          {o.gateway_txn && (
            <div>
              <dt>{t("app.orders.txn")}</dt>
              <dd>{o.gateway_txn}</dd>
            </div>
          )}
          {o.coupon_code && (
            <div>
              <dt>{t("app.orders.coupon")}</dt>
              <dd>{o.coupon_code}</dd>
            </div>
          )}
        </dl>
      </section>
    </>
  );
}
