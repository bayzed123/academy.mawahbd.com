import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { STUDENT_SOURCES, studentCode } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { DataTable } from "../components/DataTable";
import { GrantDrawer, InviteBox, StudentFormDrawer } from "../components/StudentForms";
import { Button, Chip, ErrorState, Icon, KV, PageHeader, Progress, SlideOver, Spinner, StatusChip, useConfirm, useToast } from "../components/ui";

interface StudentRow {
  id: number;
  name: string;
  /** empty: the student gave none (they sign in with the mobile number or the student ID) */
  email: string;
  phone: string | null;
  address: string;
  locale: "bn" | "en";
  blocked: number;
  source: string;
  notes: string;
  created_at: string;
  last_login_at: string | null;
  enrollments: number;
  orders: number;
  spent: number;
}
interface StudentDetail {
  student: StudentRow & { blocked_reason: string | null; marketing_opt_in: number; email_verified_at: string | null; has_password: number };
  enrollments: { id: number; course_id: number; status: string; source: string; enrolled_at: string; slug: string; title_en: string; title_bn: string; total: number; done: number; certificate_code: string | null }[];
  orders: { id: number; public_id: string; invoice_no: string | null; status: string; total: number; method: string | null; created_at: string }[];
}

const sourceLabel = (t: ReturnType<typeof useI18n>["t"], source: string) => t(`adm.stu.source.${source}` as "adm.stu.source.signup");

function StudentDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, pick, money, date, dateTime, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["student-detail", id], queryFn: () => adm<StudentDetail>(`/students/${id}`) });
  const [editing, setEditing] = useState(false);
  const [granting, setGranting] = useState(false);
  const canWrite = can("students:write");
  const canCert = can("certificates:write");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["student-detail", id] });
    void qc.invalidateQueries({ queryKey: ["/students"] });
  };
  const act = useMutation({
    mutationFn: async (a: { run: () => Promise<unknown>; ok?: string }) => {
      await a.run();
      return a.ok ?? t("adm.saved");
    },
    onSuccess: (msg) => {
      toast(msg);
      refresh();
    },
    onError: (e) => toast(err(e instanceof ApiError ? e.code : "generic"), true),
  });

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
                <Button className="btn-outline" onClick={() => setEditing(true)}>
                  {t("btn.edit")}
                </Button>
                <Button className="btn-outline" onClick={() => setGranting(true)}>
                  <Icon name="plus" /> {t("adm.student.enroll")}
                </Button>
                <Button
                  className="btn-outline"
                  onClick={() =>
                    act.mutate({
                      run: async () => {
                        const r = await adm<{ sent: boolean }>(`/students/${id}/send-reset`, { json: {} });
                        if (!r.sent) throw new ApiError(0, "reset_not_sent");
                      },
                      ok: t("adm.student.resetSent"),
                    })
                  }
                >
                  {t("adm.student.sendReset")}
                </Button>
                {s.blocked ? (
                  <Button className="btn-outline" onClick={() => act.mutate({ run: () => adm(`/students/${id}/unblock`, { json: {} }) })}>
                    {t("adm.student.unblock")}
                  </Button>
                ) : (
                  <Button
                    className="btn-danger"
                    onClick={async () => {
                      const r = await confirm({ title: t("adm.student.blockTitle"), body: t("adm.student.blockBody"), danger: true, confirmLabel: t("adm.student.block"), reason: { label: t("adm.order.reason") } });
                      if (r.ok) act.mutate({ run: () => adm(`/students/${id}/block`, { json: { reason: r.reason } }) });
                    }}
                  >
                    {t("adm.student.block")}
                  </Button>
                )}
              </div>
            )}
          </div>
          {s.blocked_reason && <p className="notice bad-note">{s.blocked_reason}</p>}
          {canWrite && !s.has_password && !s.blocked && <InviteBox studentId={id} name={s.name} hasPassword={false} hasEmail={!!s.email} hasPhone={!!s.phone} />}
          <KV
            items={[
              { label: t("adm.stu.id"), value: <b className="student-code">{studentCode(s.id)}</b> },
              { label: t("label.email"), value: s.email || <span className="muted">{t("adm.stu.noEmail")}</span> },
              { label: t("label.phone"), value: s.phone ?? "—" },
              { label: t("adm.stu.address"), value: s.address || "—" },
              { label: t("adm.f.language"), value: s.locale === "bn" ? "বাংলা" : "English" },
              { label: t("adm.stu.col.source"), value: sourceLabel(t, s.source) },
              { label: t("adm.student.lastLogin"), value: s.last_login_at ? dateTime(s.last_login_at) : "—" },
              { label: t("adm.student.marketing"), value: s.marketing_opt_in ? t("adm.yes") : t("adm.no") },
              { label: t("adm.stu.note"), value: s.notes ? s.notes : <span className="muted">{t("adm.stu.noteNone")}</span> },
            ]}
          />

          <h3>{t("adm.student.classes")}</h3>
          {q.data.enrollments.length === 0 && <p className="muted">{t("adm.student.noClasses")}</p>}
          {q.data.enrollments.map((e) => (
            <div key={e.id} className="enroll-row">
              <div className="grow">
                <b>{pick(e, "title")}</b> <StatusChip status={e.status} />
                <small className="muted">
                  {" "}
                  · {t(`adm.source.${e.source}` as "adm.source.purchase")} · {date(e.enrolled_at)}
                </small>
                <Progress pct={e.total ? Math.round((e.done / e.total) * 100) : 0} label={`${pick(e, "title")}: ${e.done}/${e.total}`} />
                <small className="muted">
                  {e.done}/{e.total} {e.certificate_code ? `· ${t("label.certificate")}: ${e.certificate_code}` : ""}
                </small>
              </div>
              {canCert && e.status === "active" && !e.certificate_code && (
                <Button
                  className="btn-outline"
                  onClick={async () => {
                    // a class taught live has no lessons to finish in the app: the academy decides, and the student has it at once
                    const r = await confirm({ title: t("adm.student.certTitle", { name: s.name }), body: t("adm.student.certBody", { name: s.name, course: pick(e, "title") }), confirmLabel: t("adm.student.cert") });
                    if (r.ok) act.mutate({ run: () => adm("/certificates/issue", { json: { course_id: e.course_id, student_id: id } }), ok: t("adm.student.certDone") });
                  }}
                >
                  <Icon name="award" /> {t("adm.student.cert")}
                </Button>
              )}
              {canWrite && e.status === "active" && (
                <Button
                  className="btn-ghost"
                  onClick={async () => {
                    const r = await confirm({ title: t("adm.student.revokeTitle", { name: pick(e, "title") }), danger: true, confirmLabel: t("adm.student.revoke") });
                    if (r.ok) act.mutate({ run: () => adm(`/students/${id}/revoke`, { json: { course_id: e.course_id } }) });
                  }}
                >
                  {t("adm.student.revoke")}
                </Button>
              )}
            </div>
          ))}

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
      {editing && s && (
        <StudentFormDrawer
          student={{ id: s.id, name: s.name, email: s.email, phone: s.phone ?? "", address: s.address, locale: s.locale, notes: s.notes, marketing: !!s.marketing_opt_in }}
          onClose={() => setEditing(false)}
          onSaved={refresh}
        />
      )}
      {granting && s && <GrantDrawer student={{ id: s.id, name: s.name }} have={q.data!.enrollments.filter((e) => e.status === "active").map((e) => e.course_id)} onClose={() => setGranting(false)} onSaved={refresh} />}
    </SlideOver>
  );
}

export function Students() {
  const { t, money, num, date } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<number | null>(null);
  const adding = params.get("add") === "1";
  const canWrite = can("students:write");
  const closeAdd = () => {
    const next = new URLSearchParams(params);
    next.delete("add");
    setParams(next, { replace: true });
  };
  const openAdd = () => {
    const next = new URLSearchParams(params);
    next.set("add", "1");
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={t("adm.nav.students")}
        sub={t("adm.students.sub")}
        actions={
          canWrite ? (
            <div className="row">
              <Link className="btn btn-outline btn-sm" to="/students/import">
                <Icon name="download" /> {t("adm.stu.import")}
              </Link>
              <Button className="btn-primary" onClick={openAdd}>
                <Icon name="plus" /> {t("adm.stu.add")}
              </Button>
            </div>
          ) : undefined
        }
      />
      <DataTable<StudentRow>
        endpoint="/students"
        defaultSort="-created_at"
        csv
        searchPlaceholder={t("adm.students.search")}
        filters={[
          { key: "blocked", label: t("label.status"), options: [{ value: "1", label: t("adm.student.blocked") }] },
          { key: "source", label: t("adm.stu.filter.source"), options: STUDENT_SOURCES.map((s) => ({ value: s, label: sourceLabel(t, s) })) },
        ]}
        onRowClick={(r) => setOpen(r.id)}
        columns={[
          {
            key: "name",
            label: t("label.name"),
            sort: "name",
            render: (r) => (
              <span className="cell-title">
                <b>{r.name}</b>
                <small>
                  {r.email || r.phone || t("adm.stu.noEmailShort")} · {studentCode(r.id)}
                </small>
              </span>
            ),
          },
          { key: "phone", label: t("label.phone"), desktopOnly: true, render: (r) => r.phone ?? "—" },
          { key: "enrollments", label: t("adm.nav.courses"), desktopOnly: true, render: (r) => num(r.enrollments) },
          { key: "spent", label: t("adm.student.spent"), sort: "spent", className: "num", desktopOnly: true, render: (r) => money(r.spent) },
          { key: "source", label: t("adm.stu.col.source"), desktopOnly: true, render: (r) => <span className="muted small">{sourceLabel(t, r.source)}</span> },
          { key: "status", label: t("label.status"), render: (r) => (r.blocked ? <Chip tone="bad">{t("adm.student.blocked")}</Chip> : <Chip tone="ok">{t("status.active")}</Chip>) },
          { key: "created", label: t("adm.student.joinedCol"), sort: "created_at", desktopOnly: true, className: "nowrap", render: (r) => date(r.created_at) },
        ]}
      />
      {open !== null && <StudentDrawer id={open} onClose={() => setOpen(null)} />}
      {adding && canWrite && (
        <StudentFormDrawer
          onClose={closeAdd}
          onSaved={() => undefined}
          onOpenStudent={(id) => {
            closeAdd();
            setOpen(id);
          }}
        />
      )}
    </>
  );
}
