import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orderCode, ORDER_STATUSES, PAYMENT_METHODS, studentCode, waNumber } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { CourseRow, ListResponse, OrderRow } from "../lib/types";
import { DataTable } from "../components/DataTable";
import { Button, Chip, ErrorState, Field, Icon, KV, PageHeader, Progress, Select, SlideOver, Spinner, StatusChip, TextInput, useConfirm, useFieldErrors, useToast } from "../components/ui";

/* ================================================================================================== orders */
interface OrderDetailData {
  order: OrderRow;
  items: { course_id: number; title_bn: string; title_en: string; list_price: number; price: number }[];
  events: { id: number; provider: string; event: string; verified: number; created_at: string }[];
  /** email is empty when the buyer gave none */
  student: { id: number; name: string; email: string; phone: string | null; blocked: number } | null;
}

function OrderDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, pick, money, num, dateTime, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["order-detail", id], queryFn: () => adm<OrderDetailData>(`/orders/${id}`) });

  const act = useMutation({
    mutationFn: async (a: { path: string; body?: Record<string, unknown> }) => adm(`/orders/${id}/${a.path}`, { json: a.body ?? {} }),
    onSuccess: () => {
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["order-detail", id] });
      void qc.invalidateQueries({ queryKey: ["/orders"] });
      void qc.invalidateQueries({ queryKey: ["badges"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast(err(e instanceof ApiError ? e.code : "generic"), true),
  });

  const o = q.data?.order;
  const approve = async () => {
    const body = o?.gateway_txn
      ? t("adm.order.approveBody", { trx: o.gateway_txn, amount: money(o.total) })
      : t("adm.order.approveBodyNoTrx", { amount: money(o?.total ?? 0), num: o?.payer_number ?? "—" });
    const r = await confirm({ title: t("adm.order.approveTitle"), body, confirmLabel: t("adm.order.approve") });
    if (r.ok) act.mutate({ path: "approve" });
  };
  // a manual order can be approved while it is still "pending" too: the student paid and told you on WhatsApp instead of using the form
  const approvable = !!o && (o.status === "awaiting_verification" || (o.status === "pending" && o.gateway === "manual"));
  const sentAfter = o?.proof_at && o.pay_by ? Math.round((Date.parse(o.proof_at) - Date.parse(o.pay_by)) / 60_000) : null;
  // someone who started to buy and did not finish: the number they typed is a way to win the sale back
  const unfinished = !!o && (o.status === "pending" || o.status === "cancelled" || o.status === "failed");
  const phone = (o?.customer_phone || q.data?.student?.phone || "").trim();
  const reject = async () => {
    const r = await confirm({ title: t("adm.order.rejectTitle"), body: t("adm.order.rejectBody"), danger: true, confirmLabel: t("adm.order.reject"), reason: { label: t("adm.order.reason") } });
    if (r.ok) act.mutate({ path: "reject", body: { reason: r.reason } });
  };
  const refund = async () => {
    const r = await confirm({ title: t("adm.order.refundTitle"), body: t("adm.order.refundBody"), danger: true, confirmLabel: t("adm.order.refund"), reason: { label: t("adm.order.reason"), required: true } });
    if (r.ok) act.mutate({ path: "refund", body: { reason: r.reason } });
  };

  return (
    <SlideOver open wide onClose={onClose} title={o ? `${t("adm.order.title")} ${o.invoice_no ?? orderCode(o.public_id)}` : t("adm.order.title")}>
      {q.isPending && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && o && (
        <div className="stack">
          <div className="row between">
            <StatusChip status={o.status} />
            <div className="row">
              {approvable && can("orders:verify") && (
                <>
                  <Button className="btn-primary" busy={act.isPending} onClick={approve}>
                    <Icon name="check" /> {t("adm.order.approve")}
                  </Button>
                  <Button className="btn-danger" onClick={reject}>
                    {t("adm.order.reject")}
                  </Button>
                </>
              )}
              {o.status === "paid" && can("orders:refund") && (
                <Button className="btn-danger" onClick={refund}>
                  {t("adm.order.refund")}
                </Button>
              )}
            </div>
          </div>
          {o.status === "awaiting_verification" && (
            <div className="notice">
              <Icon name="clock" />
              <div>
                <b>{t("adm.order.checkTitle")}</b>
                <p>{t("adm.order.checkBody", { trx: o.gateway_txn ?? "—", amount: money(o.total), num: o.payer_number ?? "—" })}</p>
              </div>
            </div>
          )}
          {o.status === "pending" && o.gateway === "manual" && (
            <div className="notice">
              <Icon name="clock" />
              <div>
                <b>{t("adm.order.waitingTitle")}</b>
                <p>{t("adm.order.waitingBody", { time: o.pay_by ? dateTime(o.pay_by) : "—" })}</p>
              </div>
            </div>
          )}
          <KV
            items={[
              { label: t("adm.order.invoice"), value: o.invoice_no },
              { label: t("adm.order.ref"), value: <code className="code">{o.public_id}</code> },
              { label: t("label.date"), value: dateTime(o.created_at) },
              { label: t("adm.order.paidAt"), value: o.paid_at ? dateTime(o.paid_at) : "—" },
              { label: t("adm.order.method"), value: o.method ? t(`method.${o.method}` as "method.bkash") : o.gateway },
              { label: t("adm.order.gateway"), value: o.gateway },
              { label: t("adm.order.txn"), value: o.gateway_txn ? <code className="code">{o.gateway_txn}</code> : "—" },
              { label: t("adm.order.payer"), value: o.payer_number },
              { label: t("adm.order.address"), value: o.customer_address || "—" },
              { label: t("adm.order.coupon"), value: o.coupon_code },
              { label: t("adm.order.note"), value: o.note || "—" },
              ...(o.gateway === "manual"
                ? [
                    { label: t("adm.order.payBy"), value: o.pay_by ? dateTime(o.pay_by) : "—" },
                    {
                      label: t("adm.order.proofAt"),
                      value: o.proof_at ? `${dateTime(o.proof_at)} · ${sentAfter !== null && sentAfter > 0 ? t("adm.order.late", { min: num(sentAfter) }) : t("adm.order.onTime")}` : "—",
                    },
                  ]
                : []),
            ]}
          />
          {o.gateway === "manual" && o.has_proof_image ? (
            <>
              <h3>{t("adm.order.proofTitle")}</h3>
              <a className="proof-shot" href={`/api/admin/orders/${o.id}/proof-image`} target="_blank" rel="noopener noreferrer" title={t("adm.order.proofShot")}>
                <img src={`/api/admin/orders/${o.id}/proof-image`} alt={t("adm.order.proofShotAlt")} loading="lazy" />
                <small>{t("adm.order.proofShot")}</small>
              </a>
            </>
          ) : (
            o.gateway === "manual" && o.status !== "paid" && <p className="hint">{t("adm.order.proofNone")}</p>
          )}
          <h3>{t("adm.order.items")}</h3>
          <table className="table compact">
            <tbody>
              {q.data.items.map((i) => (
                <tr key={i.course_id}>
                  <td>{pick(i, "title")}</td>
                  <td className="num">{i.price === i.list_price ? money(i.price) : `${money(i.price)} (${money(i.list_price)})`}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>{t("label.total")}</b>
                </td>
                <td className="num">
                  <b>{money(o.total)}</b>
                </td>
              </tr>
            </tbody>
          </table>
          {unfinished && phone && (
            <div className="notice">
              <Icon name="whatsapp" />
              <div>
                <b>{t("adm.order.followUp")}</b>
                <p>{t("adm.order.followUpHint")}</p>
                <a
                  className="btn btn-outline btn-sm"
                  href={`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(t("adm.order.followUpMsg", { name: o.customer_name.split(" ")[0], class: q.data.items.map((i) => pick(i, "title")).join(", ") }))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="whatsapp" /> {t("adm.order.followUp")}
                </a>
              </div>
            </div>
          )}
          {q.data.student && (
            <p>
              <b>{t("adm.nav.students")}:</b>{" "}
              <Link className="link" to={`/students?q=${studentCode(q.data.student.id)}`} onClick={onClose}>
                {q.data.student.name}
              </Link>{" "}
              · {q.data.student.email || t("adm.stu.noEmailShort")} {q.data.student.phone ? `· ${q.data.student.phone}` : ""}
            </p>
          )}
          {q.data.events.length > 0 && (
            <>
              <h3>{t("adm.order.events")}</h3>
              <ul className="feed">
                {q.data.events.map((e) => (
                  <li key={e.id}>
                    {e.provider} · {e.event} {e.verified ? <Chip tone="ok">{t("adm.order.verified")}</Chip> : null}
                    <small>{dateTime(e.created_at)}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </SlideOver>
  );
}

export function Orders() {
  const { t, money, num, dateTime } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <PageHeader title={t("adm.nav.orders")} sub={t("adm.orders.sub")} />
      <DataTable<OrderRow>
        endpoint="/orders"
        defaultSort="-created"
        csv
        dateRange
        searchPlaceholder={t("adm.orders.search")}
        filters={[
          { key: "status", label: t("label.status"), options: ORDER_STATUSES.map((s) => ({ value: s, label: t(`status.${s}` as "status.paid") })) },
          { key: "method", label: t("adm.order.method"), options: PAYMENT_METHODS.map((m) => ({ value: m, label: t(`method.${m}` as "method.bkash") })) },
        ]}
        onRowClick={(r) => setOpen(r.id)}
        summary={(d) => {
          const s = (d as unknown as { summary?: { paid_total: number; paid_count: number } }).summary;
          return s ? (
            <p className="summary-line">
              {t("adm.orders.paidInView", { total: money(s.paid_total), n: num(s.paid_count) })}
            </p>
          ) : null;
        }}
        columns={[
          { key: "invoice", label: t("adm.order.invoice"), className: "nowrap", render: (r) => <b>{r.invoice_no ?? orderCode(r.public_id)}</b> },
          { key: "customer", label: t("adm.nav.students"), render: (r) => (<span className="cell-title"><b>{r.customer_name}</b><small>{r.customer_email || r.customer_phone}</small></span>) },
          { key: "items", label: t("adm.nav.courses"), desktopOnly: true, render: (r) => <span className="clip">{r.items ?? ""}</span> },
          { key: "total", label: t("label.total"), sort: "total", className: "num", render: (r) => money(r.total) },
          { key: "method", label: t("adm.order.method"), desktopOnly: true, render: (r) => (r.method ? t(`method.${r.method}` as "method.bkash") : (r.gateway ?? "—")) },
          { key: "status", label: t("label.status"), render: (r) => <StatusChip status={r.status} /> },
          { key: "created", label: t("label.date"), sort: "created", desktopOnly: true, className: "nowrap", render: (r) => dateTime(r.created_at) },
        ]}
      />
      {open !== null && <OrderDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
