import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Channel, QuoteDTO } from "@mawah/shared";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, Empty, ErrorState, Field, Icon, Spinner, TextInput, useFieldErrors, useToast } from "../components/ui";

const CHANNEL_ICON: Record<Channel, string> = { sslcommerz: "wallet", bkash: "wallet", manual: "phone", mock: "sparkle" };
type Method = "bkash" | "nagad" | "rocket";

export default function Checkout() {
  const { t, lang, pick, money, err } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const fieldErrors = useFieldErrors();

  const slug = params.get("c") ?? "";
  const bundle = params.get("bundle");
  const [coupon, setCoupon] = useState<string | undefined>(params.get("coupon")?.toUpperCase() || undefined);
  const [couponInput, setCouponInput] = useState(coupon ?? "");
  const [couponError, setCouponError] = useState("");
  const [channel, setChannel] = useState<Channel | "">("");
  const [method, setMethod] = useState<Method>("bkash");
  const [trx, setTrx] = useState("");
  const [payer, setPayer] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const cart = { courses: slug ? [slug] : undefined, bundle_id: bundle ? Number(bundle) : undefined };
  const quote = useQuery({
    queryKey: ["quote", slug, bundle, coupon],
    queryFn: async () => (await api<{ quote: QuoteDTO }>("/checkout/quote", { json: { ...cart, coupon } })).quote,
    enabled: !!(slug || bundle),
    retry: false,
  });

  // pick a sensible default payment channel as soon as the quote tells us what is available
  const channels = quote.data?.channels ?? [];
  useEffect(() => {
    if (channels.length && !channels.includes(channel as Channel)) setChannel(channels.includes("sslcommerz") ? "sslcommerz" : channels[0]);
  }, [channels, channel]);

  const apply = useMutation({
    mutationFn: async (code: string) => (await api<{ quote: QuoteDTO }>("/checkout/quote", { json: { ...cart, coupon: code } })).quote,
    onSuccess: (q, code) => {
      qc.setQueryData(["quote", slug, bundle, code], q);
      setCoupon(code);
      setCouponError("");
    },
    onError: (e) => setCouponError(err(e instanceof ApiError ? e.code : "generic")),
  });

  const pay = useMutation({
    mutationFn: async () =>
      api<{ order: { public_id: string; status: string; total: number }; redirect_url?: string }>("/checkout", {
        json: { ...cart, coupon, channel: channel || undefined, manual: channel === "manual" ? { method, trx_id: trx.trim(), payer_number: payer.trim() } : undefined },
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["my-courses"] });
      if (res.redirect_url) {
        toast(t("app.checkout.redirecting"));
        window.location.assign(res.redirect_url);
      } else navigate(`/orders/${res.order.public_id}`, { replace: true });
    },
    onError: (e) => {
      setFields(fieldErrors(e));
      setFormError(e instanceof ApiError && e.code !== "validation" ? err(e.code) : "");
    },
  });

  if (!slug && !bundle) {
    return (
      <Empty icon="book" title={t("app.checkout.empty")}>
        <a className="btn btn-primary" href={lang === "en" ? "/en/courses" : "/courses"}>
          {t("app.nav.browse")}
        </a>
      </Empty>
    );
  }
  if (quote.isPending) return <Spinner />;
  if (quote.isError) {
    const code = quote.error instanceof ApiError ? quote.error.code : "generic";
    if (code === "already_enrolled") {
      return (
        <Empty icon="check" title={t("app.checkout.already")}>
          <Link className="btn btn-primary btn-lg" to={slug ? `/learn/${slug}` : "/"}>
            {t("app.checkout.goClass")}
          </Link>
        </Empty>
      );
    }
    return <ErrorState error={quote.error} />;
  }

  const q = quote.data;
  const free = q.total === 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFields({});
    setFormError("");
    pay.mutate();
  };
  const policy = lang === "en" ? "/en/policies" : "/policies";

  return (
    <>
      <div className="page-head">
        <h1>{t("app.checkout.title")}</h1>
      </div>
      <form className="checkout" onSubmit={submit} noValidate>
        <div className="stack">
          <section className="panel">
            <h2>{t("app.checkout.pay")}</h2>
            {free ? (
              <div className="notice ok">
                <Icon name="gift" />
                <div>
                  <b>{t("app.checkout.freeTitle")}</b>
                  <p>{t("app.checkout.freeBody")}</p>
                </div>
              </div>
            ) : channels.length === 0 ? (
              <div className="notice bad">
                <Icon name="shield" />
                <div>
                  <b>{t("app.checkout.noChannels")}</b>
                </div>
              </div>
            ) : (
              <fieldset className="pay-opts">
                <legend className="vh">{t("app.checkout.pay")}</legend>
                {channels.map((c) => (
                  <label key={c} className="pay-opt">
                    <input type="radio" name="channel" value={c} checked={channel === c} onChange={() => setChannel(c)} />
                    <span className="pay-ico">
                      <Icon name={CHANNEL_ICON[c]} />
                    </span>
                    <span>
                      <b>{t(`app.checkout.channel.${c}` as "app.checkout.channel.manual")}</b>
                      <small>{t(`app.checkout.channel.${c}.sub` as "app.checkout.channel.manual.sub")}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {channel === "manual" && !free && q.manual && (
              <div className="manual-box">
                <p>
                  <b>{t("app.checkout.manual.send", { amount: money(q.total) })}</b>
                </p>
                <ul className="num-list">
                  {(["bkash", "nagad", "rocket"] as const)
                    .filter((m) => q.manual!.numbers[m])
                    .map((m) => (
                      <li key={m}>
                        <span>{t(`method.${m}` as "method.bkash")}</span>
                        <code>{q.manual!.numbers[m]}</code>
                      </li>
                    ))}
                </ul>
                {(pick(q.manual, "note") as string) && <p className="small">{pick(q.manual, "note")}</p>}
                <Field id="m-method" label={t("app.checkout.manual.method")}>
                  <select id="m-method" className="input" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                    {(["bkash", "nagad", "rocket"] as const).map((m) => (
                      <option key={m} value={m}>
                        {t(`method.${m}` as "method.bkash")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="m-trx" label={t("app.checkout.manual.trx")} error={fields.trx_id} hint={t("app.checkout.manual.trxHint")}>
                  <TextInput id="m-trx" autoCapitalize="characters" autoComplete="off" value={trx} onChange={(e) => setTrx(e.target.value)} error={fields.trx_id} />
                </Field>
                <Field id="m-payer" label={t("app.checkout.manual.payer")} error={fields.payer_number}>
                  <TextInput id="m-payer" type="tel" inputMode="tel" placeholder="01XXXXXXXXX" value={payer} onChange={(e) => setPayer(e.target.value)} error={fields.payer_number} />
                </Field>
                <p className="hint">{t("app.checkout.manual.note")}</p>
              </div>
            )}
            {formError && (
              <div className="flash err mt" role="alert">
                {formError}
              </div>
            )}
          </section>
        </div>

        <aside className="sticky">
          <section className="panel">
            <h2>{t("app.checkout.summary")}</h2>
            {q.items.map((it) => (
              <div className="summary-item" key={it.course_id}>
                <span>{pick(it, "title")}</span>
                <span>
                  {it.list_price !== it.price && <s className="muted small">{money(it.list_price)} </s>}
                  <b>{it.price === 0 ? t("label.free") : money(it.price)}</b>
                </span>
              </div>
            ))}
            <div className="sum-row">
              <span>{t("label.subtotal")}</span>
              <span>{money(q.subtotal)}</span>
            </div>
            {q.discount > 0 && (
              <div className="sum-row disc">
                <span>
                  {t("label.discount")} {q.coupon_code ? `(${q.coupon_code})` : ""}
                </span>
                <span>−{money(q.discount)}</span>
              </div>
            )}
            <div className="sum-row total">
              <span>{t("label.total")}</span>
              <span>{money(q.total)}</span>
            </div>

            <div className="mt">
              <label htmlFor="coupon" className="small">
                <b>{t("app.checkout.coupon")}</b>
              </label>
              <div className="coupon">
                <input id="coupon" className="input" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} autoCapitalize="characters" autoComplete="off" />
                <Button type="button" className="btn-outline" busy={apply.isPending} disabled={!couponInput.trim()} onClick={() => apply.mutate(couponInput.trim().toUpperCase())}>
                  {t("app.checkout.apply")}
                </Button>
                {coupon && (
                  <Button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setCoupon(undefined);
                      setCouponInput("");
                      setCouponError("");
                    }}
                  >
                    {t("app.checkout.remove")}
                  </Button>
                )}
              </div>
              {couponError && <p className="err-text">{couponError}</p>}
              {coupon && !couponError && q.coupon_code && <p className="hint">{t("app.checkout.couponApplied", { code: q.coupon_code })}</p>}
            </div>

            <div className="mt">
              <Button className="btn-primary btn-block btn-lg" type="submit" busy={pay.isPending} disabled={!free && (channels.length === 0 || (channel === "manual" && (!trx.trim() || !payer.trim())))}>
                {free ? t("app.checkout.enrollFree") : channel === "manual" ? t("app.checkout.submitManual") : t("app.checkout.place", { amount: money(q.total) })}
              </Button>
            </div>
            <p className="hint tc">
              <Icon name="shield" className="inline-icon" /> {t("app.checkout.secure")}
            </p>
            <p className="hint tc">
              {t("app.checkout.terms")}{" "}
              <a className="link" href={`${policy}/terms`} target="_blank" rel="noopener noreferrer">
                {t("app.checkout.termsLink")}
              </a>{" "}
              ·{" "}
              <a className="link" href={`${policy}/refund`} target="_blank" rel="noopener noreferrer">
                {t("app.checkout.refundLink")}
              </a>
            </p>
          </section>
        </aside>
      </form>
    </>
  );
}
