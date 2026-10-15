import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, ErrorState, Icon, KV, Spinner, useToast } from "../components/ui";

type Problem = "key_missing" | "key_invalid" | "key_restricted" | "domain_not_verified" | "from_invalid" | "rate_limited" | "provider_error" | "network" | "other";
interface LastTest {
  at: string;
  sent: boolean;
  provider: string;
  problem: Problem | null;
  by: string;
}
interface EmailStatus {
  configured: boolean;
  provider: "resend" | "dev-outbox" | "none";
  from: string;
  domain: string;
  last: LastTest | null;
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
          (result.sent ? (
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
    </>
  );
}
