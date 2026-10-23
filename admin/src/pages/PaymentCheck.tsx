import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, ErrorState, Icon, KV, Spinner, useToast } from "../components/ui";

type Problem = "not_configured" | "credentials" | "domain" | "blocked" | "amount_limit" | "bad_details" | "network" | "gateway_down" | "other";
interface Last {
  at: string;
  ok: boolean;
  problem: Problem | null;
  detail: string | null;
  mode: "live" | "sandbox";
  by: "checkout" | "check";
}
interface Status {
  enabled: boolean;
  configured: boolean;
  store_id_set: boolean;
  password_set: boolean;
  mode: "live" | "sandbox";
  host: string;
  site: string;
  return_urls: { success: string; fail: string; cancel: string; ipn: string };
  last: Last | null;
  /** SSLCommerz lately refused payments from this amount up (the store's limit per payment) */
  cap: { from: number; at: string; detail: string } | null;
  /** the dearest published class or bundle */
  dearest: number;
}
type Check = { connected: true; mode: "live" | "sandbox"; host: string; methods?: string[]; limited?: { amount: number; detail: string } } | { connected: false; mode: "live" | "sandbox"; host: string; problem: Problem; detail?: string; status?: number };

/** In the English SSLCommerz support reads, whatever the screen's language: "2,550 taka". */
const taka = (n: number) => `${n.toLocaleString("en-US")} taka`;

/**
 * SSLCommerz takes the store's connection but refuses real prices: its own limit on how much one payment may be. Only SSLCommerz can lift it,
 * so the owner gets the reason in plain words and a ready message to send them, with the amounts filled in.
 */
function AmountLimit({ amount, top, site, detail, at }: { amount: number; top: number; site: string; detail: string; at: string | null }) {
  const { t, lang, money } = useI18n();
  const toast = useToast();
  const message = t("adm.pay.chk.msgText", { site, amount: taka(amount), top: taka(Math.max(top, amount)) });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast(t("adm.pay.chk.copied"));
    } catch {
      /* the message is on the screen to select by hand */
    }
  };
  const when = at ? new Date(at).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }) : null;
  return (
    <div className="notice bad-note" style={{ marginTop: 12 }}>
      <Icon name="x" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>{when ? t("adm.pay.chk.capNow", { amount: money(amount), when }) : t("adm.pay.chk.limited", { amount: money(amount) })}</b>
        <p>{t("adm.pay.p.amount_limit.title")}.</p>
        <p>{t("adm.pay.p.amount_limit.body")}</p>
        {detail && (
          <p className="said">
            {t("adm.pay.chk.said")}: <q>{detail}</q>
          </p>
        )}
        <p className="label" id="ssl-msg" style={{ marginTop: 10 }}>
          <b>{t("adm.pay.chk.msg")}</b>
        </p>
        <div className="copy-row">
          {/* a letter, not code: the box's look (easy to select) in the ordinary font */}
          <code aria-labelledby="ssl-msg" lang="en" style={{ fontFamily: "inherit", lineHeight: 1.5 }}>
            {message}
          </code>
          <Button className="btn-outline btn-sm" onClick={() => void copy()}>
            {t("adm.pay.chk.copy")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings → Payments, below the switches: is the online payment (SSLCommerz) really working? From the outside there is no way to tell: a student
 * who is turned away only sees "could not start". So the owner can ask SSLCommerz for a payment page — exactly as a purchase would, nothing is
 * charged — and read, in plain words with the steps, what it said. The keys never come to this screen: only whether they are set.
 */
export function PaymentCheck() {
  const { t, lang, err } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canWrite = can("settings:write");
  const q = useQuery({ queryKey: ["ssl-status"], queryFn: () => adm<Status>("/settings/payments/ssl") });
  const [result, setResult] = useState<Check | null>(null);

  const check = useMutation({
    mutationFn: () => adm<Check>("/settings/payments/ssl/check", { method: "POST", json: {} }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ["ssl-status"] });
      void qc.invalidateQueries({ queryKey: ["health"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });
  const title = (p: Problem) => t(`adm.pay.p.${p}.title` as "adm.pay.p.other.title");
  const body = (p: Problem) => t(`adm.pay.p.${p}.body` as "adm.pay.p.other.body");
  const modeName = (m: "live" | "sandbox") => (m === "live" ? t("adm.pay.chk.live") : t("adm.pay.chk.test"));
  const modeWord = (m: "live" | "sandbox") => (m === "live" ? t("adm.pay.chk.modeLive") : t("adm.pay.chk.modeTest"));
  const set = (on: boolean) => (on ? <Chip tone="ok">{t("adm.sms.set")}</Chip> : <Chip tone="warn">{t("adm.sms.notSet")}</Chip>);

  const last = s.last ? (
    <span className={s.last.ok ? "ok-text" : undefined}>
      {(s.last.ok ? t("adm.pay.chk.lastOk", { when: when(s.last.at) }) : t("adm.pay.chk.lastFail", { when: when(s.last.at) })) + ` · ${t(`adm.pay.chk.by.${s.last.by}` as "adm.pay.chk.by.check")}`}
      {s.last.problem ? ` · ${title(s.last.problem)}` : ""}
    </span>
  ) : (
    t("adm.pay.chk.lastNever")
  );

  return (
    <section aria-labelledby="ssl-h" style={{ marginTop: 28 }}>
      <hr className="sep" />
      <h3 id="ssl-h">{t("adm.pay.chk.title")}</h3>
      <p className="muted">{t("adm.pay.chk.sub")}</p>
      <KV
        items={[
          { label: t("adm.pay.chk.mode"), value: <Chip tone={s.mode === "live" ? "ok" : "info"}>{modeName(s.mode)}</Chip> },
          { label: t("adm.pay.chk.gateway"), value: <code className="brk">{s.host}</code> },
          { label: t("adm.pay.chk.storeId"), value: set(s.store_id_set) },
          { label: t("adm.pay.chk.storePass"), value: set(s.password_set) },
          { label: t("adm.pay.chk.site"), value: <code className="brk">{s.site}</code> },
          { label: t("adm.pay.chk.last"), value: last },
        ]}
      />
      <p className="hint">{t("adm.pay.chk.modeHint", { mode: modeWord(s.mode) })}</p>
      {/* the long addresses get a line of their own: squeezed into a column of the list they broke in the middle of a word */}
      <p className="label" id="ssl-urls" style={{ marginTop: 14 }}>
        <b>{t("adm.pay.chk.urls")}</b>
      </p>
      <ul className="plain" aria-labelledby="ssl-urls">
        {Object.values(s.return_urls).map((u) => (
          <li key={u}>
            <code className="brk">{u}</code>
          </li>
        ))}
      </ul>
      <p className="hint">{t("adm.pay.chk.urlsHint")}</p>
      {!s.enabled && <p className="hint">{t("adm.pay.chk.off")}</p>}

      <div className="row" style={{ marginTop: 16 }}>
        <Button className="btn-outline" busy={check.isPending} disabled={!canWrite} onClick={() => check.mutate()}>
          <Icon name="wallet" /> {t("adm.pay.chk.button")}
        </Button>
        {!canWrite && <span className="hint">{t("adm.pay.chk.readonly")}</span>}
      </div>
      <p className="hint">{t("adm.pay.chk.note")}</p>
      <div aria-live="polite">
        {/* a limit SSLCommerz showed lately (a buyer's try or an earlier check): until a check is run here, it is what the owner sees */}
        {!result && s.cap && <AmountLimit amount={s.cap.from} top={s.dearest} site={s.site} detail={s.cap.detail} at={s.cap.at} />}
        {result &&
          (result.connected && result.limited ? (
            <AmountLimit amount={result.limited.amount} top={s.dearest} site={s.site} detail={result.limited.detail} at={null} />
          ) : result.connected ? (
            <div className="notice ok-note" style={{ marginTop: 12 }}>
              <Icon name="check" />
              <div>
                <b>{t("adm.pay.chk.ok", { mode: modeWord(result.mode) })}</b>
                {/* the ways of paying SSLCommerz has switched on for the store: what buyers choose from after "Pay" */}
                {result.methods && result.methods.length > 0 && <p>{t("adm.pay.chk.methods", { list: result.methods.join(", ") })}</p>}
              </div>
            </div>
          ) : (
            <div className="notice bad-note" role="alert" style={{ marginTop: 12 }}>
              <Icon name="x" />
              <div>
                <b>{title(result.problem)}</b>
                <p>{body(result.problem)}</p>
                {result.detail && (
                  <p className="said">
                    {t("adm.pay.chk.said")}: <q>{result.detail}</q>
                    {result.status ? ` (${result.status})` : ""}
                  </p>
                )}
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}
