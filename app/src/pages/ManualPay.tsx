import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { orderCode, sslPayLinkFor, toBnDigits, waNumber, type OrderDTO } from "@mawah/shared";
import { track } from "../lib/analytics";
import { api, ApiError, apiUpload } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSite } from "../lib/hooks";
import { shrinkImage } from "../lib/image";
import { useI18n } from "../lib/i18n";
import { Button, Field, Icon, TextInput, useFieldErrors, useToast } from "../components/ui";

/* =============================================================================================================================
 *  Manual (send-money) payment, the screens of an open order:
 *    ManualPay      — "pending": where to send the money, a countdown, and the form for the TrxID and/or a screenshot
 *    ManualWaiting  — "awaiting_verification": what was sent, a WhatsApp message to the team, and a place to add a screenshot
 * ========================================================================================================================== */
/** "card" = the shop's SSLCommerz payment link: paid on SSLCommerz's own page, by card or mobile banking */
type Method = "bkash" | "nagad" | "rocket" | "card";

/** Seconds left until `payBy` (zero or below once it has passed), ticking every second. `skewMs` = the server's clock minus this device's. */
export function useSecondsLeft(payBy: string | null, skewMs: number): number | null {
  const target = payBy ? Date.parse(payBy) : null;
  const [now, setNow] = useState(() => Date.now() + skewMs);
  useEffect(() => {
    if (target === null) return;
    const tick = () => setNow(Date.now() + skewMs);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target, skewMs]);
  return target === null ? null : Math.floor((target - now) / 1000);
}

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);
  return url;
}

/** The WhatsApp link with the payment message already written (empty when the owner has not set a WhatsApp number). */
function useWhatsAppHref(order: OrderDTO, trx: string, withShot: boolean): string {
  const { t, pick, money } = useI18n();
  const site = useSite();
  const number = site.data?.contact.whatsapp ? waNumber(site.data.contact.whatsapp) : "";
  if (!number) return "";
  const method = order.via_link && order.manual?.link ? t("app.manual.linkName") : order.method ? t(`method.${order.method}` as "method.bkash") : "";
  const lines = [
    t("app.manual.wa.hello"),
    t("app.manual.wa.order", { code: orderCode(order.public_id) }),
    t("app.manual.wa.classes", { classes: order.items.map((i) => pick(i, "title")).join(", ") }),
    t("app.manual.wa.amount", { amount: money(order.total) }),
    method && order.payer_number ? t("app.manual.wa.method", { method, from: order.payer_number }) : "",
    trx ? t("app.manual.wa.trx", { trx }) : "",
    withShot ? t("app.manual.wa.shot") : "",
    t("app.manual.wa.thanks"),
  ].filter(Boolean);
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join("\n"))}`;
}

function CopyButton({ value, what }: { value: string; what: string }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => toast(t("app.manual.copied")),
          () => undefined, // clipboard blocked: the number stays selectable on screen
        );
      }}
    >
      {t("app.manual.copy")}
      <span className="vh"> {what}</span>
    </button>
  );
}

function ShotPicker({ id, file, onPick }: { id: string; file: File | null; onPick: (f: File | null) => void }) {
  const { t } = useI18n();
  const preview = useObjectUrl(file);
  return (
    <div className="field">
      <span className="label" id={`${id}-l`}>
        {t("app.manual.shot")}
      </span>
      <div className="shot-row">
        <label className="shot-pick btn btn-outline">
          <input id={id} type="file" accept="image/*" aria-labelledby={`${id}-l`} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          <Icon name="file" /> {t("app.manual.shotPick")}
        </label>
        {file && preview && (
          <span className="shot-preview">
            <img src={preview} alt="" width={56} height={56} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(null)}>
              {t("app.manual.shotRemove")}
            </button>
          </span>
        )}
      </div>
      <p className="hint">{t("app.manual.shotHint")}</p>
    </div>
  );
}

const clock = (sec: number, bn: boolean) => {
  const out = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  return bn ? toBnDigits(out) : out;
};

/* --------------------------------------------------------------------------------------------------- pending: pay, then send proof */
export function ManualPay({ order, skewMs }: { order: OrderDTO; skewMs: number }) {
  const { t, lang, money, pick, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const info = order.manual!;
  const method = (order.method ?? "bkash") as Method;
  // paid on the shop's SSLCommerz payment link (while the owner still has one) — otherwise sent to one of the numbers
  const viaLink = order.via_link && !!info.link;
  const to = (method !== "card" && info.numbers[method]) || info.numbers.bkash || info.numbers.nagad || info.numbers.rocket;
  const methodName = viaLink ? t("app.manual.linkName") : t(`method.${method}` as "method.bkash");
  const code = orderCode(order.public_id);
  const { student } = useAuth();
  // SSLCommerz's page opens with the amount, the order code and the buyer's name and number already in its form
  const payLink = viaLink ? (sslPayLinkFor(info.link, { amount: order.total, code, name: student?.name, phone: order.payer_number }) ?? info.link) : "";
  const left = useSecondsLeft(order.pay_by, skewMs);
  const over = left !== null && left <= 0;

  const [trx, setTrx] = useState(order.gateway_txn ?? "");
  const [shot, setShot] = useState<File | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const wa = useWhatsAppHref(order, trx.trim().toUpperCase(), !!shot || order.has_proof_image);

  const send = useMutation({
    mutationFn: async () => {
      if (shot) await apiUpload(`/checkout/${order.public_id}/proof-image`, await shrinkImage(shot));
      return api(`/checkout/${order.public_id}/proof`, { json: trx.trim() ? { trx_id: trx.trim() } : {} });
    },
    onSuccess: () => {
      toast(t("app.manual.sentToast"));
      track("payment_proof_sent", { transaction_id: order.public_id, payment_type: order.method ?? undefined, has_trxid: !!trx.trim(), has_screenshot: !!shot || order.has_proof_image });
      void qc.invalidateQueries({ queryKey: ["order", order.public_id] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => {
      setFields(fieldErrors(e));
      setFormError(e instanceof ApiError && e.code !== "validation" ? err(e.code) : "");
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFields({});
    setFormError("");
    if (!trx.trim() && !shot && !order.has_proof_image) {
      setFormError(t("app.manual.needProof"));
      return;
    }
    send.mutate();
  };

  return (
    <section className="panel pay-panel">
      <div className="pay-head">
        <h1>{t("app.manual.title", { amount: money(order.total) })}</h1>
        {left !== null &&
          (over ? (
            <span className="countdown over">{t("app.manual.timeUp")}</span>
          ) : (
            <span className={`countdown${left < 300 ? " warn" : ""}`} role="timer">
              <Icon name="clock" /> {t("app.manual.timeLeft", { time: clock(left, lang === "bn") })}
            </span>
          ))}
      </div>

      {over && (
        <div className="notice">
          <Icon name="clock" />
          <div>
            <b>{t("app.manual.timeUp")}</b>
            <p>{t("app.manual.timeUpBody")}</p>
            {order.items[0]?.slug && (
              <Link className="btn btn-outline btn-sm" to={`/checkout?c=${order.items[0].slug}`}>
                {t("app.manual.startAgain")}
              </Link>
            )}
          </div>
        </div>
      )}

      {viaLink ? (
        <ol className="pay-steps">
          <li>
            {t("app.manual.step.link")}
            <span className="copy-row">
              <a className="btn btn-primary" href={payLink} target="_blank" rel="noopener noreferrer">
                <Icon name="wallet" /> {t("app.manual.openLink")}
                <span className="vh"> ({t("app.nav.opensNew")})</span>
              </a>
            </span>
          </li>
          <li>{t("app.manual.step.linkPay", { amount: money(order.total) })}</li>
          <li>
            {t("app.manual.step.linkRef")}
            <span className="copy-row">
              <code>{code}</code>
              <CopyButton value={code} what={code} />
            </span>
          </li>
          <li>{t("app.manual.step.linkProof")}</li>
        </ol>
      ) : (
        <ol className="pay-steps">
          <li>{t("app.manual.step.open", { method: methodName })}</li>
          <li>
            {t("app.manual.step.send", { amount: money(order.total) })}
            <span className="copy-row">
              <code>{to}</code>
              <CopyButton value={to} what={methodName} />
            </span>
          </li>
          <li>
            {t("app.manual.step.ref", { code })}
            <span className="copy-row">
              <code>{code}</code>
              <CopyButton value={code} what={code} />
            </span>
          </li>
          <li>{t("app.manual.step.proof")}</li>
        </ol>
      )}
      {order.payer_number && <p className="hint">{t(viaLink ? "app.manual.payFromLink" : "app.manual.payFrom", { num: order.payer_number })}</p>}
      {(pick(info, "note") as string) && <p className="small">{pick(info, "note")}</p>}

      <form className="proof-form" onSubmit={submit} noValidate>
        <Field id="p-trx" label={t("app.manual.trx")} error={fields.trx_id} hint={viaLink ? t("app.manual.trxHintLink") : t("app.manual.trxHint", { method: methodName })}>
          <TextInput id="p-trx" autoCapitalize="characters" autoComplete="off" value={trx} onChange={(e) => setTrx(e.target.value)} error={fields.trx_id} />
        </Field>
        <ShotPicker id="p-shot" file={shot} onPick={setShot} />
        {formError && (
          <div className="flash err" role="alert">
            {formError}
          </div>
        )}
        <Button className="btn-primary btn-block btn-lg" type="submit" busy={send.isPending}>
          {t("app.manual.send")}
        </Button>
      </form>

      {wa && (
        <div className="wa-box">
          <a className="btn btn-wa btn-block" href={wa} target="_blank" rel="noopener noreferrer">
            <Icon name="whatsapp" /> {t("app.manual.wa.pending")}
          </a>
          <p className="hint">{t("app.manual.wa.hint")}</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------------------- awaiting verification: what the team has */
export function ManualWaiting({ order }: { order: OrderDTO }) {
  const { t, dateTime, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const wa = useWhatsAppHref(order, order.gateway_txn ?? "", order.has_proof_image);
  const [shot, setShot] = useState<File | null>(null);
  const [problem, setProblem] = useState("");

  const add = useMutation({
    mutationFn: async (file: File) => apiUpload(`/checkout/${order.public_id}/proof-image`, await shrinkImage(file)),
    onSuccess: () => {
      setShot(null);
      toast(t("app.manual.sentToast"));
      void qc.invalidateQueries({ queryKey: ["order", order.public_id] });
    },
    onError: (e) => setProblem(err(e instanceof ApiError ? e.code : "generic")),
  });

  return (
    <section className="panel">
      <h2>{t("app.manual.sent.title")}</h2>
      <ul className="sent-list">
        {order.gateway_txn && (
          <li>
            <Icon name="check" /> {t("app.manual.sent.trx", { trx: order.gateway_txn })}
          </li>
        )}
        {order.has_proof_image && (
          <li>
            <Icon name="check" /> {t("app.manual.sent.shot")}
          </li>
        )}
        {order.proof_at && (
          <li>
            <Icon name="clock" /> {t("app.manual.sent.at", { time: dateTime(order.proof_at) })}
          </li>
        )}
      </ul>
      {wa && (
        <>
          <a className="btn btn-wa btn-block btn-lg" href={wa} target="_blank" rel="noopener noreferrer">
            <Icon name="whatsapp" /> {t("app.manual.wa.waiting")}
          </a>
          <p className="hint">{t("app.manual.wa.hint")}</p>
        </>
      )}
      {!order.has_proof_image && (
        <form
          className="proof-form"
          onSubmit={(e) => {
            e.preventDefault();
            setProblem("");
            if (shot) add.mutate(shot);
          }}
        >
          <ShotPicker id="w-shot" file={shot} onPick={setShot} />
          {problem && (
            <div className="flash err" role="alert">
              {problem}
            </div>
          )}
          <Button className="btn-outline" type="submit" busy={add.isPending} disabled={!shot}>
            {t("app.manual.addShot")}
          </Button>
        </form>
      )}
      <p className="hint">{t("app.checkout.manual.note")}</p>
    </section>
  );
}
