import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, ErrorState, Field, Icon, KV, Spinner, Switch, TextInput, useToast } from "../components/ui";

type Problem = "not_configured" | "url_invalid" | "key_rejected" | "sender_rejected" | "masking_bangla" | "no_balance" | "number_rejected" | "ip_blocked" | "network" | "provider_error" | "other";
interface Last {
  at: string;
  ok: boolean;
  problem: Problem | null;
  detail: string | null;
}
interface SmsStatus {
  configured: boolean;
  key_set: boolean;
  url_set: boolean;
  host: string | null;
  provider: "sms" | "dev-outbox" | "none";
  enabled: boolean;
  sender_id: string;
  with_email: boolean;
  last: Last | null;
}
interface Result {
  /** the company took the message (or, in test mode, it was kept) */
  sent: boolean;
  provider: "sms" | "dev-outbox" | "none";
  problem?: Problem;
  detail?: string;
  status?: number;
}
interface BalanceResult {
  /** the credit could be read */
  read: boolean;
  balance: number | null;
  problem?: Problem;
  detail?: string;
  status?: number;
}

/**
 * Settings → SMS. From the outside there is no way to tell whether the SMS company accepts the key, so the owner can ask for the credit
 * left and send one test message to a number they type, and read — in plain words, with the steps — what the company said. The key
 * itself never comes to this screen: only whether one is set, and the host it goes to.
 */
export function SmsPanel() {
  const { t, lang, err, num } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canWrite = can("settings:write");
  const q = useQuery({ queryKey: ["sms-status"], queryFn: () => adm<SmsStatus>("/settings/sms") });
  const [enabled, setEnabled] = useState(true);
  const [withEmail, setWithEmail] = useState(true);
  const [sender, setSender] = useState("");
  const [senderError, setSenderError] = useState("");
  const [to, setTo] = useState("");
  const [toError, setToError] = useState("");
  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [test, setTest] = useState<(Result & { to: string }) | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setEnabled(q.data.enabled);
    setWithEmail(q.data.with_email);
    setSender(q.data.sender_id);
  }, [q.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["sms-status"] });
    void qc.invalidateQueries({ queryKey: ["settings"] });
    void qc.invalidateQueries({ queryKey: ["health"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const save = useMutation({
    mutationFn: () => adm("/settings/sms", { method: "PUT", json: { enabled, with_email: withEmail, sender_id: sender.trim() } }),
    onSuccess: () => {
      setSenderError("");
      toast(t("adm.saved"));
      refresh();
    },
    onError: (e) => {
      const code = e instanceof ApiError ? (e.fields ? Object.values(e.fields)[0] : e.code) : "generic";
      setSenderError(err(code === "invalid" ? "invalid_id" : code));
    },
  });
  const check = useMutation({
    mutationFn: () => adm<BalanceResult>("/settings/sms/balance", { method: "POST", json: {} }),
    onSuccess: (r) => {
      setBalance(r);
      refresh();
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  const send = useMutation({
    mutationFn: () => adm<Result & { to: string }>("/settings/sms/test", { method: "POST", json: { to: to.trim(), lang } }),
    onSuccess: (r) => {
      setToError("");
      setTest(r);
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields?.to) setToError(err(e.fields.to === "invalid" ? "invalid_phone" : e.fields.to));
      else toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true);
    },
  });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });
  const title = (p: Problem) => t(`adm.sms.p.${p}.title` as "adm.sms.p.other.title");
  const body = (p: Problem) => t(`adm.sms.p.${p}.body` as "adm.sms.p.other.body");
  const said = (r: Result | BalanceResult) =>
    r.detail ? (
      <p className="said">
        {t("adm.sms.said")}: <q>{r.detail}</q>
        {r.status ? ` (${r.status})` : ""}
      </p>
    ) : null;
  const service = s.provider === "sms" ? <Chip tone="ok">{t("adm.sms.service.sms")}</Chip> : s.provider === "dev-outbox" ? <Chip tone="info">{t("adm.sms.service.dev")}</Chip> : <Chip tone="warn">{t("adm.sms.service.none")}</Chip>;
  const last = s.last ? (
    s.last.ok ? (
      <span className="ok-text">{t("adm.sms.lastOk", { when: when(s.last.at) })}</span>
    ) : (
      <span>
        {t("adm.sms.lastFail", { when: when(s.last.at) })}
        {s.last.problem ? ` · ${title(s.last.problem)}` : ""}
      </span>
    )
  ) : (
    t("adm.sms.lastNever")
  );

  return (
    <>
      <h3>{t("adm.sms.title")}</h3>
      <p className="muted">{t("adm.sms.sub")}</p>
      <KV
        items={[
          { label: t("adm.sms.service"), value: service },
          { label: t("adm.sms.key"), value: s.key_set ? <Chip tone="ok">{t("adm.sms.set")}</Chip> : <Chip tone="warn">{t("adm.sms.notSet")}</Chip> },
          { label: t("adm.sms.url"), value: s.url_set ? <Chip tone="ok">{t("adm.sms.set")}</Chip> : <Chip tone="warn">{t("adm.sms.notSet")}</Chip> },
          ...(s.host ? [{ label: t("adm.sms.host"), value: <code>{s.host}</code> }] : []),
          { label: t("adm.sms.last"), value: last },
        ]}
      />

      {!s.configured && s.provider === "none" && (
        <div className="notice" style={{ marginTop: 16 }}>
          <Icon name="bell" />
          <div>
            <b>{title("not_configured")}</b>
            <p>{body("not_configured")}</p>
          </div>
        </div>
      )}

      <form
        style={{ marginTop: 22 }}
        onSubmit={(ev) => {
          ev.preventDefault();
          save.mutate();
        }}
        noValidate
      >
        <div className="stack">
          <Switch id="sms-enabled" checked={enabled} disabled={!canWrite} onChange={setEnabled} label={t("adm.sms.enabled")} />
          <div>
            <Switch id="sms-with-email" checked={withEmail} disabled={!canWrite || !enabled} onChange={setWithEmail} label={t("adm.sms.withEmail")} />
            <p className="hint">{t("adm.sms.withEmailHint")}</p>
          </div>
        </div>
        <Field id="sms-sender" label={t("adm.sms.senderId")} hint={t("adm.sms.senderHint")} error={senderError}>
          <TextInput id="sms-sender" autoComplete="off" maxLength={15} value={sender} error={senderError} disabled={!canWrite} onChange={(ev) => setSender(ev.target.value)} />
        </Field>
        <div className="row">
          <Button className="btn-primary" type="submit" busy={save.isPending} disabled={!canWrite}>
            {t("btn.save")}
          </Button>
        </div>
      </form>

      <div className="row" style={{ marginTop: 26 }}>
        <Button className="btn-outline" busy={check.isPending} disabled={!canWrite} onClick={() => check.mutate()}>
          <Icon name="wallet" /> {t("adm.sms.balance")}
        </Button>
        {!canWrite && <span className="hint">{t("adm.sms.readonly")}</span>}
      </div>
      <div aria-live="polite">
        {balance &&
          (balance.read ? (
            <div className="notice ok-note" style={{ marginTop: 12 }}>
              <Icon name="check" />
              <div>
                <b>{t("adm.sms.balanceIs", { amount: num(balance.balance ?? 0) })}</b>
              </div>
            </div>
          ) : (
            <div className="notice bad-note" role="alert" style={{ marginTop: 12 }}>
              <Icon name="x" />
              <div>
                <b>{title(balance.problem ?? "other")}</b>
                <p>{body(balance.problem ?? "other")}</p>
                {said(balance)}
              </div>
            </div>
          ))}
      </div>

      <form
        style={{ marginTop: 26 }}
        onSubmit={(ev) => {
          ev.preventDefault();
          send.mutate();
        }}
        noValidate
      >
        <Field id="sms-test-to" label={t("adm.sms.testTo")} hint={t("adm.sms.testHint")} error={toError}>
          <TextInput id="sms-test-to" type="tel" inputMode="tel" autoComplete="off" placeholder="01XXXXXXXXX" value={to} error={toError} disabled={!canWrite} onChange={(ev) => setTo(ev.target.value)} />
        </Field>
        <div className="row">
          <Button className="btn-primary" type="submit" busy={send.isPending} disabled={!canWrite || !to.trim()}>
            <Icon name="phone" /> {t("adm.sms.testSend")}
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {test &&
          (test.sent ? (
            <div className="notice ok-note" style={{ marginTop: 12 }}>
              <Icon name="check" />
              <div>
                <b>{test.provider === "dev-outbox" ? t("adm.sms.sentDev") : t("adm.sms.sentOk", { to: test.to })}</b>
              </div>
            </div>
          ) : (
            <div className="notice bad-note" role="alert" style={{ marginTop: 12 }}>
              <Icon name="x" />
              <div>
                <b>{title(test.problem ?? "other")}</b>
                <p>{body(test.problem ?? "other")}</p>
                {said(test)}
              </div>
            </div>
          ))}
      </div>
    </>
  );
}
