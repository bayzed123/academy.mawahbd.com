import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { NOTIFY_KINDS, type NotifyKind } from "@mawah/shared";
import { Button, Chip, ErrorState, Field, Icon, KV, Spinner, Switch, TextInput, useToast } from "../components/ui";

type Problem = "key_missing" | "key_invalid" | "key_restricted" | "domain_not_verified" | "from_invalid" | "rate_limited" | "provider_error" | "network" | "other";
interface LastTest {
  at: string;
  sent: boolean;
  provider: string;
  problem: Problem | null;
  by: string;
  viaSandbox?: boolean;
}
interface EmailStatus {
  configured: boolean;
  provider: "resend" | "dev-outbox" | "none";
  from: string;
  domain: string;
  reply_to: string;
  domain_refused_at: string | null;
  notify: { to: string[]; custom: boolean; default_to: string; off: NotifyKind[] };
  last: LastTest | null;
}
interface NoticeResult {
  to: string;
  sent: boolean;
  via_sandbox: boolean;
  problem: Problem | null;
  detail: string | null;
}
interface TestResult extends LastTest {
  to: string;
  from: string;
  domain: string;
  status: number | null;
  detail: string | null;
}

/**
 * Settings → E-mail. A refused e-mail leaves no trace on the website, so the owner can send one test message to their own address
 * and read — in plain words, with the steps — what Resend said. The key itself never comes to this screen: only whether one is set.
 */
export function EmailPanel() {
  const { t, lang, err } = useI18n();
  const { can, staff } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canTest = can("settings:write");
  const [result, setResult] = useState<TestResult | null>(null);
  const q = useQuery({ queryKey: ["email-status"], queryFn: () => adm<EmailStatus>("/settings/email") });
  const send = useMutation({
    mutationFn: () => adm<TestResult>("/settings/email/test", { method: "POST", json: { lang } }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ["email-status"] });
      void qc.invalidateQueries({ queryKey: ["health"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });
  const problemTitle = (p: Problem, domain: string) => t(`adm.email.p.${p}.title` as "adm.email.p.other.title", { domain });
  const problemBody = (p: Problem, domain: string, from: string) => t(`adm.email.p.${p}.body` as "adm.email.p.other.body", { domain, from });

  const service =
    s.provider === "resend" ? <Chip tone="ok">{t("adm.email.service.resend")}</Chip> : s.provider === "dev-outbox" ? <Chip tone="info">{t("adm.email.service.dev")}</Chip> : <Chip tone="warn">{t("adm.email.service.none")}</Chip>;
  const last = s.last ? (
    s.last.sent ? (
      <span className="ok-text">{t("adm.email.lastOk", { when: when(s.last.at) })}</span>
    ) : (
      <span>
        {t("adm.email.lastFail", { when: when(s.last.at) })}
        {s.last.problem ? ` · ${problemTitle(s.last.problem, s.domain)}` : ""}
      </span>
    )
  ) : (
    t("adm.email.lastNever")
  );

  return (
    <>
      <h3>{t("adm.email.title")}</h3>
      <p className="muted">{t("adm.email.sub")}</p>
      <KV
        items={[
          { label: t("adm.email.service"), value: service },
          { label: t("adm.email.from"), value: <code>{s.from}</code> },
          ...(s.reply_to ? [{ label: t("adm.email.replyTo"), value: <code>{s.reply_to}</code> }] : []),
          { label: t("adm.email.last"), value: last },
        ]}
      />
      <div className="row" style={{ marginTop: 18 }}>
        <Button className="btn-primary" busy={send.isPending} disabled={!canTest} onClick={() => send.mutate()}>
          <Icon name="mail" /> {t("adm.email.send")}
        </Button>
        <span className="hint">{canTest ? t("adm.email.sendTo", { email: staff?.email ?? "" }) : t("adm.email.readonly")}</span>
      </div>
      <div aria-live="polite">
        {result &&
          (result.sent && result.viaSandbox ? (
            <div className="notice" style={{ marginTop: 16 }}>
              <Icon name="bell" />
              <div>
                <b>{t("adm.email.sentSandbox")}</b>
                <p>{t("adm.email.sentSandboxBody", { email: result.to, domain: result.domain })}</p>
              </div>
            </div>
          ) : result.sent ? (
            <div className="notice ok-note" style={{ marginTop: 16 }}>
              <Icon name="check" />
              <div>
                <b>{result.provider === "dev-outbox" ? t("adm.email.sentDev") : t("adm.email.sentOk", { email: result.to })}</b>
                <p>{result.provider === "dev-outbox" ? t("adm.email.sentDevBody") : t("adm.email.sentOkBody")}</p>
              </div>
            </div>
          ) : (
            <div className="notice bad-note" role="alert" style={{ marginTop: 16 }}>
              <Icon name="x" />
              <div>
                <b>{problemTitle(result.problem ?? "other", result.domain)}</b>
                <p>{problemBody(result.problem ?? "other", result.domain, result.from)}</p>
                {result.detail && (
                  <p className="said">
                    {t("adm.email.says")} <q>{result.detail}</q>
                    {result.status ? ` (${result.status})` : ""}
                  </p>
                )}
                <p>{t("adm.email.tryAgain")}</p>
              </div>
            </div>
          ))}
      </div>
      {!result && (s.domain_refused_at || s.last?.viaSandbox) && s.provider === "resend" && (
        <div className="notice" style={{ marginTop: 16 }}>
          <Icon name="bell" />
          <div>
            <b>{t("adm.email.sandboxTitle")}</b>
            <p>{t("adm.email.sandboxBody", { domain: s.domain })}</p>
          </div>
        </div>
      )}
      <NotifyPanel status={s} canEdit={canTest} />
    </>
  );
}

/** Who gets the e-mails about what happens on the site, and which of them. */
function NotifyPanel({ status, canEdit }: { status: EmailStatus; canEdit: boolean }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState(status.notify.custom ? status.notify.to.join(", ") : "");
  const [error, setError] = useState("");
  const [results, setResults] = useState<NoticeResult[] | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["email-status"] });
    void qc.invalidateQueries({ queryKey: ["settings"] });
  };
  const save = useMutation({
    mutationFn: (body: { emails: string[]; off: NotifyKind[] }) => adm("/settings/notifications", { method: "PUT", json: body }),
    onSuccess: () => {
      setError("");
      toast(t("adm.saved"));
      refresh();
    },
    onError: (e) => {
      const fields = e instanceof ApiError ? e.fields : undefined;
      const code = fields ? Object.values(fields)[0] : e instanceof ApiError ? e.code : "generic";
      setError(err(code === "too_long" ? "too_long" : code === "invalid" || code === "invalid_email" ? "invalid_email" : code));
    },
  });
  const test = useMutation({
    mutationFn: () => adm<{ results: NoticeResult[] }>("/settings/email/notify-test", { method: "POST", json: {} }),
    onSuccess: (r) => setResults(r.results),
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  const addresses = () => text.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean);
  const off = new Set(status.notify.off);
  const flip = (kind: NotifyKind, on: boolean) => save.mutate({ emails: status.notify.custom ? status.notify.to : [], off: NOTIFY_KINDS.filter((k) => (k === kind ? !on : off.has(k))) });

  return (
    <section className="notify-panel" aria-labelledby="notify-h" style={{ marginTop: 28 }}>
      <h3 id="notify-h">{t("adm.notify.title")}</h3>
      <p className="muted">{t("adm.notify.sub")}</p>
      {!canEdit && <p className="hint">{t("adm.notify.readonly")}</p>}
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          save.mutate({ emails: addresses(), off: [...off] });
        }}
        noValidate
      >
        <Field id="notify-to" label={t("adm.notify.to")} error={error} hint={t("adm.notify.toHint", { default: status.notify.default_to || "—" })}>
          <TextInput id="notify-to" type="text" inputMode="email" autoComplete="off" value={text} error={error} disabled={!canEdit} placeholder={status.notify.default_to} onChange={(ev) => setText(ev.target.value)} />
        </Field>
        <p className="hint">{t("adm.notify.now", { list: status.notify.to.join(", ") || "—" })}</p>
        <div className="row">
          <Button className="btn-primary" type="submit" busy={save.isPending} disabled={!canEdit}>
            {t("adm.notify.save")}
          </Button>
        </div>
      </form>

      <h4 style={{ marginTop: 22 }}>{t("adm.notify.kinds")}</h4>
      <ul className="notify-kinds">
        {NOTIFY_KINDS.map((k) => (
          <li key={k}>
            <Switch id={`notify-${k}`} checked={!off.has(k)} disabled={!canEdit || save.isPending} onChange={(on) => flip(k, on)} label={t(`adm.notify.kind.${k}` as "adm.notify.kind.order_paid")} />
            <small className="muted">{t(`adm.notify.kind.${k}.d` as "adm.notify.kind.order_paid.d")}</small>
          </li>
        ))}
      </ul>

      <div className="row" style={{ marginTop: 18 }}>
        <Button className="btn-outline" busy={test.isPending} disabled={!canEdit} onClick={() => test.mutate()}>
          <Icon name="mail" /> {t("adm.notify.test")}
        </Button>
        <span className="hint">{t("adm.notify.testHint")}</span>
      </div>
      <div aria-live="polite">
        {results &&
          (results.length === 0 ? (
            <p className="notice" style={{ marginTop: 12 }}>
              {t("adm.notify.noOne")}
            </p>
          ) : (
            <ul className="notify-results">
              {results.map((r) => (
                <li key={r.to} className={r.sent ? (r.via_sandbox ? "warn" : "ok") : "bad"}>
                  {r.sent
                    ? r.via_sandbox
                      ? t("adm.notify.testSandbox", { to: r.to })
                      : t("adm.notify.testOk", { to: r.to })
                    : t("adm.notify.testFail", { to: r.to, why: r.detail || t(`adm.email.p.${r.problem ?? "other"}.title` as "adm.email.p.other.title", { domain: status.domain }) })}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
