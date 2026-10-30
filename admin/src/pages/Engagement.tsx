import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { DataTable } from "../components/DataTable";
import { Button, Chip, Field, Icon, IconButton, PageHeader, Panel, Select, SlideOver, Spinner, StatusChip, Tabs, TextArea, useConfirm, useToast } from "../components/ui";
import { useCourseOptions } from "./Courses";

const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

function useAct(invalidate: string[]) {
  const { err, t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  return async (fn: () => Promise<unknown>, ok = t("adm.saved")) => {
    try {
      await fn();
      toast(ok);
      for (const k of invalidate) void qc.invalidateQueries({ queryKey: [k] });
      void qc.invalidateQueries({ queryKey: ["badges"] });
      return true;
    } catch (e) {
      toast(err(e instanceof ApiError ? e.code : "generic"), true);
      return false;
    }
  };
}

function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" className={i <= n ? "" : "off"} />
      ))}
    </span>
  );
}

/* ================================================================================================= reviews */
interface Review {
  id: number;
  course_id: number;
  rating: number;
  body: string;
  status: string;
  reply: string | null;
  created_at: string;
  student_name: string;
  course_title_en: string;
  course_title_bn: string;
}

export function Reviews() {
  const { t, pick, date } = useI18n();
  const { can } = useAuth();
  const act = useAct(["/reviews"]);
  const [reply, setReply] = useState<Review | null>(null);
  const [text, setText] = useState("");
  const canMod = can("reviews:moderate");
  return (
    <>
      <PageHeader title={t("adm.nav.reviews")} sub={t("adm.reviews.sub")} />
      <DataTable<Review>
        endpoint="/reviews"
        csv
        searchPlaceholder={t("adm.reviews.search")}
        filters={[
          { key: "status", label: t("label.status"), options: REVIEW_STATUSES.map((s) => ({ value: s, label: t(`status.${s}` as "status.pending") })) },
          { key: "rating", label: t("label.rating"), options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} ★` })) },
        ]}
        columns={[
          { key: "rating", label: t("label.rating"), render: (r) => <Stars n={r.rating} /> },
          {
            key: "body",
            label: t("adm.reviews.review"),
            render: (r) => (
              <span className="cell-title">
                <b>{r.student_name}</b>
                <small>{pick({ a_bn: r.course_title_bn, a_en: r.course_title_en }, "a")}</small>
                <span className="clip wrap">{r.body || "—"}</span>
                {r.reply && <em className="reply">↳ {r.reply}</em>}
              </span>
            ),
          },
          { key: "status", label: t("label.status"), render: (r) => <StatusChip status={r.status} /> },
          { key: "date", label: t("label.date"), desktopOnly: true, render: (r) => date(r.created_at) },
        ]}
        rowActions={
          canMod
            ? (r) => (
                <div className="row nowrap">
                  {r.status !== "approved" && <IconButton icon="check" label={t("adm.reviews.approve")} onClick={() => act(() => adm(`/reviews/${r.id}/moderate`, { json: { status: "approved" } }))} />}
                  {r.status !== "rejected" && <IconButton icon="x" label={t("adm.reviews.reject")} onClick={() => act(() => adm(`/reviews/${r.id}/moderate`, { json: { status: "rejected" } }))} />}
                  <IconButton icon="chat" label={t("adm.reviews.reply")} onClick={() => { setReply(r); setText(r.reply ?? ""); }} />
                </div>
              )
            : undefined
        }
      />
      <SlideOver
        open={!!reply}
        onClose={() => setReply(null)}
        title={t("adm.reviews.reply")}
        footer={
          <div className="row end">
            <Button className="btn-ghost" onClick={() => setReply(null)}>
              {t("btn.cancel")}
            </Button>
            <Button className="btn-primary" onClick={async () => { if (reply && (await act(() => adm(`/reviews/${reply.id}/reply`, { json: { reply: text } })))) setReply(null); }}>
              {t("btn.save")}
            </Button>
          </div>
        }
      >
        {reply && (
          <>
            <Stars n={reply.rating} />
            <p>{reply.body}</p>
            <Field id="rv-reply" label={t("adm.reviews.yourReply")} hint={t("adm.reviews.replyHint")}>
              <TextArea id="rv-reply" rows={5} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </>
        )}
      </SlideOver>
    </>
  );
}

/* =============================================================================================== questions */
interface Question {
  id: number;
  body: string;
  answer: string | null;
  status: string;
  created_at: string;
  student_name: string;
  lesson_title_en: string;
  lesson_title_bn: string;
  course_title_en: string;
  course_title_bn: string;
}

export function Questions() {
  const { t, pick, dateTime } = useI18n();
  const { can } = useAuth();
  const act = useAct(["/questions"]);
  const [open, setOpen] = useState<Question | null>(null);
  const [text, setText] = useState("");
  const canAnswer = can("questions:answer");
  return (
    <>
      <PageHeader title={t("adm.nav.questions")} sub={t("adm.questions.sub")} />
      <DataTable<Question>
        endpoint="/questions"
        csv={false}
        searchPlaceholder={t("btn.search")}
        filters={[{ key: "status", label: t("label.status"), options: ["open", "answered", "hidden"].map((s) => ({ value: s, label: t(`status.${s}` as "status.open") })) }]}
        onRowClick={canAnswer ? (q) => { setOpen(q); setText(q.answer ?? ""); } : undefined}
        columns={[
          {
            key: "q",
            label: t("adm.questions.question"),
            render: (r) => (
              <span className="cell-title">
                <b>{r.body}</b>
                <small>
                  {r.student_name} · {pick({ a_bn: r.course_title_bn, a_en: r.course_title_en }, "a")} → {pick({ a_bn: r.lesson_title_bn, a_en: r.lesson_title_en }, "a")}
                </small>
                {r.answer && <em className="reply">↳ {r.answer}</em>}
              </span>
            ),
          },
          { key: "status", label: t("label.status"), render: (r) => <StatusChip status={r.status} /> },
          { key: "date", label: t("label.date"), desktopOnly: true, render: (r) => dateTime(r.created_at) },
        ]}
      />
      <SlideOver
        open={!!open}
        onClose={() => setOpen(null)}
        title={t("adm.questions.answer")}
        footer={
          <div className="row end">
            {open && (
              <Button className="btn-ghost" onClick={async () => { if (await act(() => adm(`/questions/${open.id}/visibility`, { json: { hidden: open.status !== "hidden" } }))) setOpen(null); }}>
                {open.status === "hidden" ? t("adm.questions.unhide") : t("adm.questions.hide")}
              </Button>
            )}
            <Button className="btn-primary" disabled={text.trim().length === 0} onClick={async () => { if (open && (await act(() => adm(`/questions/${open.id}/answer`, { json: { answer: text } })))) setOpen(null); }}>
              {t("adm.questions.send")}
            </Button>
          </div>
        }
      >
        {open && (
          <>
            <p className="notice">
              <b>{open.student_name}:</b> {open.body}
            </p>
            <Field id="qa-answer" label={t("adm.questions.yourAnswer")} hint={t("adm.questions.answerHint")}>
              <TextArea id="qa-answer" rows={6} maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </>
        )}
      </SlideOver>
    </>
  );
}

/* ============================================================================================ certificates */
interface Cert {
  id: number;
  code: string;
  student_name: string;
  student_email: string;
  course_title_en: string;
  course_title_bn: string;
  issued_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

interface ClassCerts {
  course: { id: number; slug: string; title_bn: string; title_en: string; cert_enabled: boolean };
  enrolled: number;
  lessons: number;
  with_cert: number;
  to_all: number;
  to_finished: number;
}

/**
 * Issue certificates for a whole class at once — everyone enrolled, or only those who finished every lesson in the app. A class taught live
 * has no lessons in the app, so the academy decides when it is complete. Each student sees theirs in the student app at once.
 */
function IssueDrawer({ onClose }: { onClose: () => void }) {
  const { t, pick, num, err, lang } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const courses = useCourseOptions();
  const [courseId, setCourseId] = useState("");
  const [who, setWho] = useState<"all" | "finished">("all");
  const stats = useQuery({ queryKey: ["cert-class", courseId], queryFn: () => adm<ClassCerts>(`/certificates/class/${courseId}`), enabled: !!courseId });
  const s = stats.data;
  const count = s ? (who === "all" ? s.to_all : s.to_finished) : 0;
  const issue = useMutation({
    // a big class goes in a few rounds (each one a few hundred), until nobody is left
    mutationFn: async () => {
      let issued = 0;
      for (let round = 0; round < 25; round++) {
        const r = await adm<{ issued: number; more: boolean }>("/certificates/issue", { json: { course_id: Number(courseId), who } });
        issued += r.issued;
        if (!r.more) break;
      }
      return issued;
    },
    onSuccess: (issued) => {
      toast(t("adm.certs.issuedN", { n: num(issued) }));
      void qc.invalidateQueries({ queryKey: ["/certificates"] });
      void qc.invalidateQueries({ queryKey: ["cert-class"] });
      onClose();
    },
    onError: (e) => toast(err(e instanceof ApiError ? e.code : "generic"), true),
  });
  return (
    <SlideOver
      open
      onClose={onClose}
      title={t("adm.certs.issueTitle")}
      footer={
        <div className="row end">
          <Button className="btn-ghost" onClick={onClose}>
            {t("btn.cancel")}
          </Button>
          <Button className="btn-primary" busy={issue.isPending} disabled={!s || !s.course.cert_enabled || count === 0} onClick={() => issue.mutate()}>
            <Icon name="award" /> {t("adm.certs.issueN", { n: num(count) })}
          </Button>
        </div>
      }
    >
      <div className="stack">
        <p className="muted">{t("adm.certs.issueSub")}</p>
        <Field id="ci-class" label={t("adm.certs.class")}>
          <Select id="ci-class" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">{t("adm.lp.chooseClass")}</option>
            {courses.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        {stats.isPending && courseId && <Spinner />}
        {s && !s.course.cert_enabled && (
          <p className="notice" role="alert">
            <Icon name="help" /> {t("err.cert_off")}
          </p>
        )}
        {s && s.course.cert_enabled && (
          <>
            <p className="notice" role="status">
              <Icon name="users" /> {t("adm.certs.stats", { enrolled: num(s.enrolled), have: num(s.with_cert) })}
              {s.lessons === 0 && ` ${t("adm.certs.noLessons")}`}
            </p>
            <fieldset className="field wide">
              <legend>{t("adm.certs.who")}</legend>
              <label className="check">
                <input type="radio" name="ci-who" checked={who === "all"} onChange={() => setWho("all")} /> {t("adm.certs.whoAll", { n: num(s.to_all) })}
              </label>
              <label className="check">
                <input type="radio" name="ci-who" checked={who === "finished"} disabled={s.lessons === 0} onChange={() => setWho("finished")} /> {t("adm.certs.whoFinished", { n: num(s.to_finished) })}
              </label>
            </fieldset>
            {count === 0 && <p className="muted">{t("adm.certs.nobody")}</p>}
            <a className="link" href={`${lang === "en" ? "/en" : ""}/certificate/sample?class=${encodeURIComponent(s.course.slug)}`} target="_blank" rel="noopener noreferrer">
              <Icon name="external" /> {t("adm.certs.design")}: {pick(s.course, "title")}
            </a>
          </>
        )}
      </div>
    </SlideOver>
  );
}

export function Certificates() {
  const { t, pick, date, lang } = useI18n();
  const { can } = useAuth();
  const confirm = useConfirm();
  const act = useAct(["/certificates"]);
  const canWrite = can("certificates:write");
  const [issuing, setIssuing] = useState(false);
  return (
    <>
      <PageHeader
        title={t("adm.nav.certificates")}
        sub={t("adm.certs.sub")}
        actions={
          <>
            <a className="btn btn-outline" href={`${lang === "en" ? "/en" : ""}/certificate/sample`} target="_blank" rel="noopener noreferrer">
              <Icon name="external" /> {t("adm.certs.design")}
            </a>
            {canWrite && (
              <Button className="btn-primary" onClick={() => setIssuing(true)}>
                <Icon name="award" /> {t("adm.certs.issue")}
              </Button>
            )}
          </>
        }
      />
      {issuing && <IssueDrawer onClose={() => setIssuing(false)} />}
      <DataTable<Cert>
        endpoint="/certificates"
        csv
        searchPlaceholder={t("adm.certs.search")}
        filters={[{ key: "revoked", label: t("label.status"), options: [{ value: "0", label: t("status.active") }, { value: "1", label: t("status.revoked") }] }]}
        columns={[
          { key: "code", label: t("adm.certs.code"), render: (r) => <code className="code">{r.code}</code> },
          { key: "student", label: t("adm.nav.students"), render: (r) => (<span className="cell-title"><b>{r.student_name}</b><small>{r.student_email}</small></span>) },
          { key: "course", label: t("adm.nav.courses"), desktopOnly: true, render: (r) => pick({ a_bn: r.course_title_bn, a_en: r.course_title_en }, "a") },
          { key: "issued", label: t("adm.certs.issued"), desktopOnly: true, render: (r) => date(r.issued_at) },
          { key: "status", label: t("label.status"), render: (r) => <StatusChip status={r.revoked_at ? "revoked" : "active"} /> },
        ]}
        rowActions={(r) => (
          <div className="row nowrap">
            <a className="icon-btn" href={`${lang === "en" ? "/en" : ""}/verify/${r.code}`} target="_blank" rel="noopener noreferrer" aria-label={t("adm.certs.verify")} title={t("adm.certs.verify")}>
              <Icon name="external" />
            </a>
            {canWrite &&
              (r.revoked_at ? (
                <Button className="btn-outline" onClick={() => act(() => adm(`/certificates/${r.id}/restore`, { json: {} }))}>
                  {t("adm.restore")}
                </Button>
              ) : (
                <>
                  <IconButton
                    icon="refresh"
                    label={t("adm.certs.reissue")}
                    onClick={async () => {
                      const c = await confirm({ title: t("adm.certs.reissueTitle"), body: t("adm.certs.reissueBody"), confirmLabel: t("adm.certs.reissue") });
                      if (c.ok) void act(() => adm(`/certificates/${r.id}/reissue`, { json: {} }));
                    }}
                  />
                  <IconButton
                    icon="x"
                    label={t("adm.certs.revoke")}
                    onClick={async () => {
                      const c = await confirm({ title: t("adm.certs.revokeTitle"), body: t("adm.certs.revokeBody"), danger: true, confirmLabel: t("adm.certs.revoke"), reason: { label: t("adm.order.reason"), required: true } });
                      if (c.ok) void act(() => adm(`/certificates/${r.id}/revoke`, { json: { reason: c.reason } }));
                    }}
                  />
                </>
              ))}
          </div>
        )}
      />
    </>
  );
}

/* ================================================================================================= signups */
interface Signup {
  id: number;
  course_id: number;
  email: string;
  phone: string | null;
  lang: string;
  created_at: string;
  notified_at: string | null;
  course_title_en: string;
  course_title_bn: string;
  course_status: string;
}
interface Waiting {
  id: number;
  title_en: string;
  title_bn: string;
  status: string;
  waiting: number;
}

export function Signups() {
  const { t, pick, num, date } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "newsletter" ? "newsletter" : "notify";
  const act = useAct(["/signups"]);
  const canWrite = can("signups:write");
  const summary = useQuery({ queryKey: ["signups-summary"], queryFn: () => adm<{ waiting_by_course: Waiting[] }>("/signups?per_page=1"), enabled: tab === "notify" });
  return (
    <>
      <PageHeader title={t("adm.nav.signups")} sub={t("adm.signups.sub")} />
      <Tabs value={tab} onChange={(v) => setParams(v === "notify" ? {} : { tab: v })} tabs={[{ value: "notify", label: t("adm.signups.notify") }, { value: "newsletter", label: t("adm.signups.newsletter") }]} />
      {tab === "notify" ? (
        <>
          {summary.data && summary.data.waiting_by_course.length > 0 && (
            <Panel title={t("adm.signups.waiting")} className="compact">
              <ul className="rank">
                {summary.data.waiting_by_course.map((w) => (
                  <li key={w.id}>
                    <span>
                      {pick(w, "title")} <StatusChip status={w.status} />
                    </span>
                    <span className="row nowrap">
                      <b>{num(w.waiting)}</b>
                      {w.status === "published" && canWrite && (
                        <Button
                          className="btn-outline"
                          onClick={async () => {
                            if (await act(async () => { const r = await adm<{ sent: number }>(`/signups/notify/${w.id}`, { json: {} }); return r; }, t("adm.signups.sent"))) void summary.refetch();
                          }}
                        >
                          {t("adm.signups.sendNow")}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="hint">{t("adm.signups.autoHint")}</p>
            </Panel>
          )}
          <DataTable<Signup>
            endpoint="/signups"
            csv
            searchPlaceholder={t("adm.signups.search")}
            filters={[{ key: "pending", label: t("label.status"), options: [{ value: "1", label: t("adm.signups.pending") }] }]}
            columns={[
              { key: "email", label: t("label.email"), render: (r) => <b>{r.email}</b> },
              { key: "phone", label: t("label.phone"), desktopOnly: true, render: (r) => r.phone ?? "—" },
              { key: "course", label: t("adm.nav.courses"), render: (r) => pick({ a_bn: r.course_title_bn, a_en: r.course_title_en }, "a") },
              { key: "date", label: t("label.date"), desktopOnly: true, render: (r) => date(r.created_at) },
              { key: "notified", label: t("label.status"), render: (r) => (r.notified_at ? <Chip tone="ok">{t("adm.signups.notified")}</Chip> : <Chip tone="warn">{t("adm.signups.pending")}</Chip>) },
            ]}
            rowActions={canWrite ? (r) => <IconButton icon="trash" label={t("btn.delete")} onClick={() => act(() => adm(`/signups/${r.id}`, { method: "DELETE" }), t("adm.deleted"))} /> : undefined}
          />
        </>
      ) : (
        <DataTable<{ id: number; email: string; lang: string; source: string; created_at: string; unsubscribed_at: string | null }>
          endpoint="/subscribers"
          csv
          columns={[
            { key: "email", label: t("label.email"), render: (r) => <b>{r.email}</b> },
            { key: "lang", label: t("adm.f.language"), desktopOnly: true, render: (r) => (r.lang === "bn" ? "বাংলা" : "English") },
            { key: "source", label: t("adm.signups.source"), desktopOnly: true },
            { key: "date", label: t("label.date"), render: (r) => date(r.created_at) },
            { key: "status", label: t("label.status"), render: (r) => (r.unsubscribed_at ? <Chip tone="bad">{t("adm.signups.unsub")}</Chip> : <Chip tone="ok">{t("status.active")}</Chip>) },
          ]}
        />
      )}
    </>
  );
}

/* ================================================================================================ messages */
interface Message {
  id: number;
  name: string;
  email: string;
  phone: string;
  message: string;
  status: string;
  created_at: string;
}
interface Handoff {
  id: number;
  question: string;
  reason: string;
  lang: string;
  status: string;
  created_at: string;
  course_title_en: string | null;
  course_title_bn: string | null;
  student_name: string | null;
  student_email: string | null;
}

export function Messages() {
  const { t, pick, dateTime } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "handoffs" ? "handoffs" : "messages";
  const act = useAct(["/messages", "/escalations"]);
  const canWrite = can("messages:write");
  return (
    <>
      <PageHeader title={t("adm.nav.messages")} sub={t("adm.messages.sub")} />
      <Tabs value={tab} onChange={(v) => setParams(v === "messages" ? {} : { tab: v })} tabs={[{ value: "messages", label: t("adm.messages.contact") }, { value: "handoffs", label: t("adm.messages.handoffs") }]} />
      {tab === "messages" ? (
        <DataTable<Message>
          endpoint="/messages"
          csv
          searchPlaceholder={t("btn.search")}
          filters={[{ key: "status", label: t("label.status"), options: [{ value: "new", label: t("adm.messages.new") }, { value: "handled", label: t("adm.messages.handled") }] }]}
          columns={[
            { key: "from", label: t("adm.messages.from"), render: (r) => (<span className="cell-title"><b>{r.name}</b><small>{r.email}{r.phone ? ` · ${r.phone}` : ""}</small></span>) },
            { key: "message", label: t("adm.messages.message"), render: (r) => <span className="clip wrap">{r.message}</span> },
            { key: "date", label: t("label.date"), desktopOnly: true, render: (r) => dateTime(r.created_at) },
            { key: "status", label: t("label.status"), render: (r) => <StatusChip status={r.status} /> },
          ]}
          rowActions={(r) => (
            <div className="row nowrap">
              <a className="icon-btn" href={`mailto:${r.email}?subject=${encodeURIComponent("Re: MAWAH Academy")}`} aria-label={t("adm.messages.reply")} title={t("adm.messages.reply")}>
                <Icon name="mail" />
              </a>
              {canWrite && <IconButton icon={r.status === "new" ? "check" : "refresh"} label={r.status === "new" ? t("adm.messages.markHandled") : t("adm.messages.reopen")} onClick={() => act(() => adm(`/messages/${r.id}/status`, { json: { status: r.status === "new" ? "handled" : "new" } }))} />}
            </div>
          )}
        />
      ) : (
        <DataTable<Handoff>
          endpoint="/escalations"
          csv={false}
          filters={[{ key: "status", label: t("label.status"), options: [{ value: "open", label: t("status.open") }, { value: "handled", label: t("adm.messages.handled") }] }]}
          columns={[
            {
              key: "q",
              label: t("adm.messages.question"),
              render: (r) => (
                <span className="cell-title">
                  <b>{r.question}</b>
                  <small>
                    {r.student_name ? `${r.student_name} · ` : ""}
                    {r.course_title_en ? pick({ a_bn: r.course_title_bn ?? "", a_en: r.course_title_en }, "a") : t("adm.messages.general")}
                  </small>
                </span>
              ),
            },
            { key: "reason", label: t("adm.messages.reason"), desktopOnly: true, render: (r) => t(`adm.escalation.${r.reason}` as "adm.escalation.low_confidence") },
            { key: "date", label: t("label.date"), desktopOnly: true, render: (r) => dateTime(r.created_at) },
            { key: "status", label: t("label.status"), render: (r) => <StatusChip status={r.status} /> },
          ]}
          rowActions={canWrite ? (r) => <IconButton icon={r.status === "open" ? "check" : "refresh"} label={r.status === "open" ? t("adm.messages.markHandled") : t("adm.messages.reopen")} onClick={() => act(() => adm(`/escalations/${r.id}/status`, { json: { status: r.status === "open" ? "handled" : "open" } }))} /> : undefined}
        />
      )}
    </>
  );
}
