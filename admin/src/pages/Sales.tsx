import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orderCode, ORDER_STATUSES, PAYMENT_METHODS } from "@mawah/shared";
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
          {q.data.student && (
            <p>
              <b>{t("adm.nav.students")}:</b>{" "}
              <Link className="link" to={`/students?q=${encodeURIComponent(q.data.student.email)}`} onClick={onClose}>
                {q.data.student.name}
              </Link>{" "}
              · {q.data.student.email} {q.data.student.phone ? `· ${q.data.student.phone}` : ""}
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
          { key: "customer", label: t("adm.nav.students"), render: (r) => (<span className="cell-title"><b>{r.customer_name}</b><small>{r.customer_email}</small></span>) },
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

/* ================================================================================================ students */
interface StudentRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  locale: string;
  blocked: number;
  created_at: string;
  last_login_at: string | null;
  enrollments: number;
  orders: number;
  spent: number;
}
interface StudentDetail {
  student: StudentRow & { blocked_reason: string | null; marketing_opt_in: number; email_verified_at: string | null };
  enrollments: { id: number; course_id: number; status: string; source: string; enrolled_at: string; slug: string; title_en: string; title_bn: string; total: number; done: number; certificate_code: string | null }[];
  orders: { id: number; public_id: string; invoice_no: string | null; status: string; total: number; method: string | null; created_at: string }[];
}

function StudentDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, pick, money, date, dateTime, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const q = useQuery({ queryKey: ["student-detail", id], queryFn: () => adm<StudentDetail>(`/students/${id}`) });
  const courses = useQuery({ queryKey: ["course-options"], queryFn: () => adm<ListResponse<CourseRow>>("/courses?per_page=100&sort=title_en"), staleTime: 60_000 });
  const [courseId, setCourseId] = useState("");
  const [edit, setEdit] = useState<{ name: string; phone: string; locale: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const canWrite = can("students:write");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["student-detail", id] });
    void qc.invalidateQueries({ queryKey: ["/students"] });
  };
  const run = async (fn: () => Promise<unknown>, ok = t("adm.saved")) => {
    try {
      await fn();
      toast(ok);
      refresh();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(err(e instanceof ApiError ? e.code : "generic"), true);
    }
  };

  const s = q.data?.student;
  return (
    <SlideOver open wide onClose={onClose} title={s ? s.name : t("adm.nav.students")}>
      {q.isPending && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && s && (
        <div className="stack">
          <div className="row between">
            <div className="row">
              {s.blocked ? <Chip tone="bad">{t("adm.student.blocked")}</Chip> : <Chip tone="ok">{t("status.active")}</Chip>}
              <small className="muted">{t("adm.student.joined", { d: date(s.created_at) })}</small>
            </div>
            {canWrite && (
              <div className="row">
                <Button className="btn-outline" onClick={() => setEdit({ name: s.name, phone: s.phone ?? "", locale: s.locale })}>
                  {t("btn.edit")}
                </Button>
                <Button className="btn-outline" onClick={() => run(async () => { const r = await adm<{ sent: boolean }>(`/students/${id}/send-reset`, { json: {} }); if (!r.sent) throw new ApiError(0, "generic"); }, t("adm.student.resetSent"))}>
                  {t("adm.student.sendReset")}
                </Button>
                {s.blocked ? (
                  <Button className="btn-outline" onClick={() => run(() => adm(`/students/${id}/unblock`, { json: {} }))}>
                    {t("adm.student.unblock")}
                  </Button>
                ) : (
                  <Button
                    className="btn-danger"
                    onClick={async () => {
                      const r = await confirm({ title: t("adm.student.blockTitle"), body: t("adm.student.blockBody"), danger: true, confirmLabel: t("adm.student.block"), reason: { label: t("adm.order.reason") } });
                      if (r.ok) void run(() => adm(`/students/${id}/block`, { json: { reason: r.reason } }));
                    }}
                  >
                    {t("adm.student.block")}
                  </Button>
                )}
              </div>
            )}
          </div>
          {s.blocked_reason && <p className="notice bad-note">{s.blocked_reason}</p>}
          <KV
            items={[
              { label: t("label.email"), value: s.email },
              { label: t("label.phone"), value: s.phone },
              { label: t("adm.f.language"), value: s.locale === "bn" ? "বাংলা" : "English" },
              { label: t("adm.student.lastLogin"), value: s.last_login_at ? dateTime(s.last_login_at) : "—" },
              { label: t("adm.student.marketing"), value: s.marketing_opt_in ? t("adm.yes") : t("adm.no") },
            ]}
          />

          <h3>{t("adm.student.classes")}</h3>
          {q.data.enrollments.length === 0 && <p className="muted">{t("adm.student.noClasses")}</p>}
          {q.data.enrollments.map((e) => (
            <div key={e.id} className="enroll-row">
              <div className="grow">
                <b>{pick(e, "title")}</b> <StatusChip status={e.status} />
                <small className="muted"> · {t(`adm.source.${e.source}` as "adm.source.purchase")} · {date(e.enrolled_at)}</small>
                <Progress pct={e.total ? Math.round((e.done / e.total) * 100) : 0} label={`${pick(e, "title")}: ${e.done}/${e.total}`} />
                <small className="muted">
                  {e.done}/{e.total} {e.certificate_code ? `· ${t("label.certificate")}: ${e.certificate_code}` : ""}
                </small>
              </div>
              {canWrite && e.status === "active" && (
                <Button
                  className="btn-ghost"
                  onClick={async () => {
                    const r = await confirm({ title: t("adm.student.revokeTitle", { name: pick(e, "title") }), danger: true, confirmLabel: t("adm.student.revoke") });
                    if (r.ok) void run(() => adm(`/students/${id}/revoke`, { json: { course_id: e.course_id } }));
                  }}
                >
                  {t("adm.student.revoke")}
                </Button>
              )}
            </div>
          ))}
          {canWrite && (
            <div className="row nowrap">
              <Select aria-label={t("adm.student.grant")} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">{t("adm.student.grant")}</option>
                {courses.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pick(c, "title")}
                  </option>
                ))}
              </Select>
              <Button disabled={!courseId} onClick={() => run(() => adm(`/students/${id}/enroll`, { json: { course_id: Number(courseId) } })).then(() => setCourseId(""))}>
                {t("adm.student.enroll")}
              </Button>
            </div>
          )}

          <h3>{t("adm.nav.orders")}</h3>
          {q.data.orders.length === 0 ? (
            <p className="muted">{t("adm.dash.noOrders")}</p>
          ) : (
            <table className="table compact">
              <tbody>
                {q.data.orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.invoice_no ?? o.public_id.slice(0, 8)}</td>
                    <td className="num">{money(o.total)}</td>
                    <td>
                      <StatusChip status={o.status} />
                    </td>
                    <td className="muted">{date(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {edit && (
        <SlideOver
          open
          onClose={() => setEdit(null)}
          title={t("btn.edit")}
          footer={
            <div className="row end">
              <Button className="btn-ghost" onClick={() => setEdit(null)}>
                {t("btn.cancel")}
              </Button>
              <Button
                className="btn-primary"
                onClick={() =>
                  void run(() => adm(`/students/${id}`, { method: "PATCH", json: edit }), t("adm.saved")).then(() => setEdit(null))
                }
              >
                {t("btn.save")}
              </Button>
            </div>
          }
        >
          <Field id="se-name" label={t("label.name")} error={errors.name}>
            <TextInput id="se-name" value={edit.name} error={errors.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <Field id="se-phone" label={t("label.phone")} error={errors.phone}>
            <TextInput id="se-phone" value={edit.phone} error={errors.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
          </Field>
          <Field id="se-lang" label={t("adm.f.language")}>
            <Select id="se-lang" value={edit.locale} onChange={(e) => setEdit({ ...edit, locale: e.target.value })}>
              <option value="bn">বাংলা</option>
              <option value="en">English</option>
            </Select>
          </Field>
        </SlideOver>
      )}
    </SlideOver>
  );
}

export function Students() {
  const { t, money, num, date } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <PageHeader title={t("adm.nav.students")} sub={t("adm.students.sub")} />
      <DataTable<StudentRow>
        endpoint="/students"
        defaultSort="-created_at"
        csv
        searchPlaceholder={t("adm.students.search")}
        filters={[{ key: "blocked", label: t("label.status"), options: [{ value: "1", label: t("adm.student.blocked") }] }]}
        onRowClick={(r) => setOpen(r.id)}
        columns={[
          { key: "name", label: t("label.name"), sort: "name", render: (r) => (<span className="cell-title"><b>{r.name}</b><small>{r.email}</small></span>) },
          { key: "phone", label: t("label.phone"), desktopOnly: true, render: (r) => r.phone ?? "—" },
          { key: "enrollments", label: t("adm.nav.courses"), desktopOnly: true, render: (r) => num(r.enrollments) },
          { key: "spent", label: t("adm.student.spent"), sort: "spent", className: "num", desktopOnly: true, render: (r) => money(r.spent) },
          { key: "status", label: t("label.status"), render: (r) => (r.blocked ? <Chip tone="bad">{t("adm.student.blocked")}</Chip> : <Chip tone="ok">{t("status.active")}</Chip>) },
          { key: "created", label: t("adm.student.joinedCol"), sort: "created_at", desktopOnly: true, className: "nowrap", render: (r) => date(r.created_at) },
        ]}
      />
      {open !== null && <StudentDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
