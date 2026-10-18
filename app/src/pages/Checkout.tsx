import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CHANNEL_LOGOS, PAY_LOGOS, PAY_VIA, PAY_VIA_GROUP, PAY_VIA_NAME, toBnDigits, type Channel, type PayMethodDTO, type PayVia, type QuoteDTO, type StudentMe } from "@mawah/shared";
import { CURRENCY, gaItem, track } from "../lib/analytics";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSite } from "../lib/hooks";
import { useI18n } from "../lib/i18n";
import { Button, Empty, ErrorState, Field, Icon, Spinner, TextInput, Turnstile, useFieldErrors, useToast } from "../components/ui";

const CHANNEL_ICON: Record<Channel, string> = { sslcommerz: "wallet", bkash: "wallet", manual: "phone", mock: "sparkle" };
type Method = "bkash" | "nagad" | "rocket";
type PayResult = { order: { public_id: string; status: string; total: number }; redirect_url?: string; pay_methods?: PayMethodDTO[]; via_missing?: PayVia; student?: StudentMe };

/**
 * Someone who typed the e-mail — or, with no e-mail, the mobile number — of a student account in "Your details". Nothing is opened for
 * them: they sign in right here (and the payment goes on at once), or — when that account has no password yet — they are sent a link, by
 * e-mail or by text message to the number. `who` is what they typed.
 */
function ExistingAccount({ who, passwordless, onSignedIn, onOther }: { who: string; passwordless: boolean; onSignedIn: (s: StudentMe) => void; onOther: () => void }) {
  const { t, lang, err } = useI18n();
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const signIn = async () => {
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      onSignedIn(await login(who, password));
    } catch (x) {
      setError(err(x instanceof ApiError ? x.code : "generic"));
    } finally {
      setBusy(false);
    }
  };
  const sendLink = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/auth/forgot", { json: { identifier: who, lang } });
      setSent(true);
    } catch (x) {
      setError(err(x instanceof ApiError ? x.code : "generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notice" role="region" aria-labelledby="exists-h" style={{ marginTop: 16 }}>
      <Icon name="user" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b id="exists-h">{t("app.checkout.exists.title")}</b>
        {sent ? (
          <p aria-live="polite">{t("app.checkout.exists.sent", { who })}</p>
        ) : passwordless ? (
          <>
            <p>{t("app.checkout.exists.link")}</p>
            <Button type="button" className="btn-primary" busy={busy} onClick={() => void sendLink()}>
              {t("app.checkout.exists.sendLink")}
            </Button>
          </>
        ) : (
          <>
            <p>{t("app.checkout.exists.body", { who })}</p>
            <div className="field">
              <label htmlFor="x-password">{t("app.checkout.exists.password")}</label>
              <TextInput
                id="x-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                onKeyDown={(ev) => {
                  // Enter here signs in; it must not send the whole checkout form again
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    void signIn();
                  }
                }}
              />
            </div>
            <div className="row">
              <Button type="button" className="btn-primary" busy={busy} disabled={!password} onClick={() => void signIn()}>
                {t("app.checkout.exists.signIn")}
              </Button>
              <button type="button" className="link" onClick={() => void sendLink()} disabled={busy}>
                {t("app.checkout.exists.forgot")}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="err-text" role="alert">
            {error}
          </p>
        )}
        <p className="small" style={{ marginTop: 10 }}>
          <button type="button" className="link" onClick={onOther}>
            {t("app.checkout.exists.other")}
          </button>
        </p>
      </div>
    </div>
  );
}

/**
 * The marks of the services a way of paying takes (the same pictures as the footer), so a buyer sees "bKash / Nagad / Rocket / cards" and not
 * just a word. For the online payment, SSLCommerz's own logo takes their place once the owner has pasted the link SSLCommerz gave (Settings →
 * Payments) — it is SSLCommerz's picture, from SSLCommerz's server.
 */
function PayMarks({ channel, sslLogo }: { channel: Channel; sslLogo: string | null }) {
  const { t } = useI18n();
  if (channel === "sslcommerz" && sslLogo) {
    return (
      <span className="pay-ssl">
        <img src={sslLogo} alt={t("app.checkout.sslAlt")} decoding="async" />
      </span>
    );
  }
  const keys = CHANNEL_LOGOS[channel];
  if (!keys.length) return null;
  const marks = PAY_LOGOS.filter((p) => keys.includes(p.key));
  // one spoken name for the whole row ("bKash, Nagad, Rocket"), the pictures themselves are decoration
  return (
    <span className="pay-marks" role="img" aria-label={marks.map((p) => t(`method.${p.key}` as "method.bkash")).join(", ")}>
      {marks.map((p) => (
        <span className="pay-mark" key={p.key} aria-hidden="true">
          <img src={p.src} width={p.width} height={p.height} alt="" loading="lazy" decoding="async" />
        </span>
      ))}
    </span>
  );
}

/** Our own picture of each way of paying, where we have one (the footer's marks); the others use SSLCommerz's, or the name alone. */
const OWN_LOGO: Partial<Record<PayVia, (typeof PAY_LOGOS)[number]>> = Object.fromEntries(PAY_LOGOS.map((l) => [l.key, l]));

/**
 * The online payment is chosen: its ways of paying, right here — bKash, Nagad, Rocket, Upay, then cards — and a tap pays with that one (the
 * button sends the form, so the details above are checked first). `ways`: what SSLCommerz offered the shop last time; before it was ever
 * asked, all of them (one it turns out not to offer brings its list instead).
 */
function PayTiles({ ways, busy, pending }: { ways: { via: PayVia; logo: string | null }[]; busy: PayVia | null; pending: boolean }) {
  const { t } = useI18n();
  const groups = (["mobile", "card"] as const).map((g) => ({ g, list: ways.filter((w) => PAY_VIA_GROUP[w.via] === g) })).filter((x) => x.list.length);
  return (
    <div className="pay-tiles" role="group" aria-labelledby="pt-h">
      <h3 id="pt-h">{t("app.pay.tap")}</h3>
      <p className="hint">{t("app.pay.tapHint")}</p>
      {groups.map(({ g, list }) => (
        <div className="pay-group" key={g}>
          <h4>{t(`app.pay.g.${g}` as "app.pay.g.mobile")}</h4>
          <ul className="pay-grid">
            {list.map(({ via, logo }) => {
              const own = OWN_LOGO[via];
              const name = PAY_VIA_NAME[via];
              return (
                <li key={via}>
                  <button type="submit" name="via" value={via} className="pay-method" aria-label={t("app.pay.withName", { name })} aria-busy={busy === via || undefined} disabled={pending}>
                    <span className="pay-logo" aria-hidden="true">
                      {busy === via ? (
                        <span className="spinner sm" />
                      ) : own ? (
                        <img src={own.src} width={own.width} height={own.height} alt="" decoding="async" />
                      ) : logo ? (
                        <img src={logo} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <Icon name="wallet" />
                      )}
                    </span>
                    <span className="pay-name">{name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

const PAY_GROUPS = ["mobile", "card", "bank", "other"] as const;

/**
 * The buyer chose the online payment and pressed Pay: SSLCommerz opened the payment and said which ways of paying this store takes. They are shown
 * here, on the website — SSLCommerz's own names and logos, mobile wallets first — and a tap goes straight to that one (bKash's page for bKash,
 * Nagad's for Nagad …) instead of SSLCommerz's list. "All ways to pay" is SSLCommerz's own page, as before; "Change how to pay" goes back.
 */
function PayChooser({ methods, all, total, missing, onBack }: { methods: PayMethodDTO[]; all: string; total: number; missing?: PayVia; onBack: () => void }) {
  const { t, money } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  // a new step: move the reader (and the screen reader) to its heading
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const groups = PAY_GROUPS.map((g) => ({ g, list: methods.filter((m) => m.group === g) })).filter((x) => x.list.length);
  return (
    <>
      <div className="page-head">
        <h1 ref={heading} tabIndex={-1}>
          {t("app.pay.title")}
        </h1>
      </div>
      <section className="panel pay-chooser" aria-labelledby="pc-sub">
        <p id="pc-sub" className="muted">
          {t("app.pay.sub", { total: money(total) })}
        </p>
        {missing && (
          <p className="notice" role="status">
            <Icon name="help" />
            <span>{t("app.pay.missing", { name: PAY_VIA_NAME[missing] })}</span>
          </p>
        )}
        {groups.map(({ g, list }) => (
          <div className="pay-group" key={g}>
            <h2>{t(`app.pay.g.${g}` as "app.pay.g.mobile")}</h2>
            <ul className="pay-grid">
              {list.map((m) => (
                <li key={m.url}>
                  <a className="pay-method" href={m.url}>
                    <span className="pay-logo" aria-hidden="true">
                      {m.logo ? <img src={m.logo} alt="" loading="lazy" decoding="async" /> : <Icon name="wallet" />}
                    </span>
                    <span className="pay-name">{m.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="pay-foot">
          <a className="btn btn-outline" href={all}>
            {t("app.pay.all")}
          </a>
          <Button className="btn-ghost" onClick={onBack}>
            {t("app.pay.back")}
          </Button>
        </div>
        <p className="hint pay-secure">
          <Icon name="lock" /> {t("app.pay.secure")}
        </p>
      </section>
    </>
  );
}

export default function Checkout() {
  const { t, lang, pick, money, err } = useI18n();
  const [params] = useSearchParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const fieldErrors = useFieldErrors();
  const { student, setStudent } = useAuth();
  const site = useSite();
  // buying needs no account: a visitor gives a name, a number and an e-mail, and the account is made for them
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(student?.phone ?? "");
  const [address, setAddress] = useState(student?.address ?? "");
  const [captcha, setCaptcha] = useState("");
  const [bump, setBump] = useState(0);
  // `by` = which of the two said who they are: the e-mail, or (when they gave none) the mobile number
  const [exists, setExists] = useState<{ who: string; by: "email" | "phone"; passwordless: boolean } | null>(null);

  // the profile arrives after the first render: fill the boxes it can fill, without overwriting anything already typed
  useEffect(() => {
    if (!student) return;
    setPhone((v) => v || (student.phone ?? ""));
    setAddress((v) => v || (student.address ?? ""));
  }, [student]);

  const slug = params.get("c") ?? "";
  const bundle = params.get("bundle");
  const [coupon, setCoupon] = useState<string | undefined>(params.get("coupon")?.toUpperCase() || undefined);
  const [couponInput, setCouponInput] = useState(coupon ?? "");
  const [couponError, setCouponError] = useState("");
  const [channel, setChannel] = useState<Channel | "">("");
  const [method, setMethod] = useState<Method>("bkash");
  const [payer, setPayer] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  // the online gateway turned this purchase away: the error says so, and the other way of paying is offered right there
  const [gatewayDown, setGatewayDown] = useState(false);
  // the online payment is open and SSLCommerz listed the ways this store takes: the buyer taps one (null = still on the form)
  const [online, setOnline] = useState<{ methods: PayMethodDTO[]; all: string; total: number; missing?: PayVia } | null>(null);
  // the way of paying the buyer tapped last (kept for the payment that goes on after they sign in to an existing account)
  const [via, setVia] = useState<PayVia | null>(null);

  const cart = { courses: slug ? [slug] : undefined, bundle_id: bundle ? Number(bundle) : undefined };
  const quote = useQuery({
    queryKey: ["quote", slug, bundle, coupon],
    queryFn: async () => (await api<{ quote: QuoteDTO }>("/checkout/quote", { json: { ...cart, coupon } })).quote,
    enabled: !!(slug || bundle),
    retry: false,
  });

  // pick a sensible default payment channel as soon as the quote tells us what is available
  const channels = quote.data?.channels ?? [];
  // only the services the owner has a number for can be chosen for a manual payment
  const manualMethods = (["bkash", "nagad", "rocket"] as const).filter((m) => quote.data?.manual?.numbers[m]);
  const chosenMethod: Method = manualMethods.includes(method) ? method : (manualMethods[0] ?? method);
  useEffect(() => {
    if (channels.length && !channels.includes(channel as Channel)) setChannel(channels.includes("sslcommerz") ? "sslcommerz" : channels[0]);
  }, [channels, channel]);

  // the basket is on screen: one "begin_checkout" per basket (docs/analytics.md)
  const began = useRef("");
  useEffect(() => {
    const q = quote.data;
    const key = `${slug}|${bundle ?? ""}`;
    if (!q || began.current === key) return;
    began.current = key;
    track("begin_checkout", { currency: CURRENCY, value: q.total, coupon: q.coupon_code ?? undefined, items: q.items.map((i) => gaItem(i)) });
  }, [quote.data, slug, bundle]);

  const apply = useMutation({
    mutationFn: async (code: string) => (await api<{ quote: QuoteDTO }>("/checkout/quote", { json: { ...cart, coupon: code } })).quote,
    onSuccess: (q, code) => {
      qc.setQueryData(["quote", slug, bundle, code], q);
      setCoupon(code);
      setCouponError("");
      track("coupon_applied", { coupon: code });
    },
    onError: (e) => {
      setCouponError(err(e instanceof ApiError ? e.code : "generic"));
      track("coupon_failed", { reason: e instanceof ApiError ? e.code : "generic" }); // never what was typed: the box takes anything a person pastes
    },
  });

  const pay = useMutation({
    // "student": already signed in (or just signed in here — `gaps` then says what their profile lacks, which the details typed above fill);
    // "guest": a visitor, with the details typed above
    mutationFn: async (v: { as: "student" | "guest"; gaps?: { phone: boolean; address: boolean }; via?: PayVia | null }) => {
      const basket = quote.data;
      if (basket) {
        track("add_payment_info", {
          currency: CURRENCY,
          value: basket.total,
          coupon: basket.coupon_code ?? undefined,
          payment_type: basket.total === 0 ? "free" : channel === "manual" ? `manual_${chosenMethod}` : channel === "sslcommerz" && v.via ? `sslcommerz_${v.via}` : channel || "unknown",
          items: basket.items.map((i) => gaItem(i)),
        });
      }
      const order = { ...cart, coupon, channel: channel || undefined, manual: channel === "manual" ? { method: chosenMethod, payer_number: payer.trim() } : undefined, via: channel === "sslcommerz" ? (v.via ?? undefined) : undefined };
      if (v.as === "student") {
        // a signed-in student whose profile lacks a mobile number or an address gives them here (the form shows only then)
        const details = v.gaps ? { ...(v.gaps.phone ? { phone: phone.trim() } : {}), ...(v.gaps.address ? { address: address.trim() } : {}) } : needsDetails ? { phone: phone.trim(), address: address.trim() } : {};
        return api<PayResult>("/checkout", { json: { ...order, details: Object.keys(details).length ? details : undefined } });
      }
      return api<PayResult>("/checkout/guest", { json: { ...order, name: name.trim(), email: email.trim() || undefined, phone: phone.trim(), address: address.trim(), lang, turnstile: captcha || undefined } });
    },
    onSuccess: (res, v) => {
      if (res.student) setStudent(res.student); // the visitor now has an account and is signed in on this phone
      if (res.student && v.as === "guest") track("sign_up", { method: "checkout" });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["my-courses"] });
      if (res.redirect_url && res.pay_methods?.length) {
        setOnline({ methods: res.pay_methods, all: res.redirect_url, total: res.order.total, missing: res.via_missing });
        window.scrollTo({ top: 0 });
      } else if (res.redirect_url) {
        toast(t("app.checkout.redirecting"));
        window.location.assign(res.redirect_url);
      } else navigate(`/orders/${res.order.public_id}`, { replace: true });
    },
    onError: (e) => {
      setBump((n) => n + 1);
      if (e instanceof ApiError && e.code === "account_exists") {
        setFields({});
        setFormError("");
        const by = e.fields?.phone ? "phone" : "email";
        setExists({ who: by === "phone" ? phone.trim() : email.trim().toLowerCase(), by, passwordless: e.fields?.[by] === "account_exists_link" });
        return;
      }
      track("checkout_error", { code: e instanceof ApiError ? e.code : "generic" });
      setFields(fieldErrors(e));
      setFormError(e instanceof ApiError && e.code !== "validation" ? err(e.code) : "");
      setGatewayDown(e instanceof ApiError && e.code === "gateway_error");
    },
  });

  if (student === undefined) return <Spinner />;
  if (online) return <PayChooser methods={online.methods} all={online.all} total={online.total} missing={online.missing} onBack={() => setOnline(null)} />;
  // someone signed in who has no mobile number or address on file yet: the same two boxes as a visitor sees
  const needsDetails = !!student && (!student.phone || !student.address);
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
    setGatewayDown(false);
    // name, mobile number and address are needed (a signed-in student already has a name); the e-mail is up to them
    const missing: Record<string, string> = {};
    if (!student && !name.trim()) missing.name = t("err.required");
    if ((!student || needsDetails) && !phone.trim()) missing.phone = t("err.required");
    if ((!student || needsDetails) && address.trim().length < 5) missing.address = t("err.required");
    if (Object.keys(missing).length) {
      setFields(missing);
      document.getElementById(missing.name ? "g-name" : missing.phone ? "g-phone" : "g-address")?.focus();
      return;
    }
    // a way-of-paying button sent the form (bKash, Nagad …) — or the main Pay button did, and SSLCommerz's list comes next
    const tapped = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "via" ? ((e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") as PayVia) : null;
    const chosen = tapped && (PAY_VIA as readonly string[]).includes(tapped) ? tapped : null;
    setVia(chosen);
    pay.mutate({ as: student ? "student" : "guest", via: chosen });
  };
  const policy = lang === "en" ? "/en/policies" : "/policies";

  return (
    <>
      <div className="page-head">
        <h1>{t("app.checkout.title")}</h1>
      </div>
      <form className="checkout" onSubmit={submit} noValidate>
        <div className="stack">
          {(!student || needsDetails) && (
            <section className="panel" aria-labelledby="you-h">
              <h2 id="you-h">{t("app.checkout.you.title")}</h2>
              <p className="muted">{student ? t("app.checkout.you.fixDetails") : t("app.checkout.you.sub")}</p>
              {!student && (
                <Field id="g-name" label={t("app.checkout.you.name")} required error={fields.name}>
                  <TextInput id="g-name" autoComplete="name" aria-required="true" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
                </Field>
              )}
              <Field id="g-phone" label={t("app.checkout.you.phone")} required hint={t("app.checkout.you.phoneHint")} error={fields.phone}>
                <TextInput id="g-phone" type="tel" inputMode="tel" autoComplete="tel" aria-required="true" placeholder="01XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} error={fields.phone} />
              </Field>
              <Field id="g-address" label={t("app.checkout.you.address")} required hint={t("app.checkout.you.addressHint")} error={fields.address}>
                <textarea id="g-address" className="input" rows={2} maxLength={300} autoComplete="street-address" aria-required="true" aria-invalid={fields.address ? true : undefined} aria-describedby={fields.address ? "g-address-err" : undefined} value={address} onChange={(e) => setAddress(e.target.value)} />
              </Field>
              {!student && (
                <Field id="g-email" label={t("app.checkout.you.email")} hint={t("app.checkout.you.emailHint")} error={fields.email}>
                  <TextInput id="g-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
                </Field>
              )}
              {!student && site.data?.turnstile_site_key && <Turnstile siteKey={site.data.turnstile_site_key} onToken={setCaptcha} resetKey={bump} />}
              {!student && (
                <p className="small">
                  {t("app.checkout.you.haveAccount")}{" "}
                  <Link className="link" to={`/login?next=${encodeURIComponent(`/checkout${search}`)}`}>
                    {t("app.checkout.you.login")}
                  </Link>
                </p>
              )}
              {!student && exists && (
                <ExistingAccount
                  who={exists.who}
                  passwordless={exists.passwordless}
                  onSignedIn={(s) => {
                    setExists(null);
                    pay.mutate({ as: "student", gaps: { phone: !s.phone, address: !s.address }, via });
                  }}
                  onOther={() => {
                    setExists(null);
                    if (exists.by === "email") setEmail("");
                    else setPhone("");
                    document.getElementById(exists.by === "email" ? "g-email" : "g-phone")?.focus();
                  }}
                />
              )}
            </section>
          )}
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
                      <PayMarks channel={c} sslLogo={q.ssl_logo ?? null} />
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {channel === "sslcommerz" && !free && (
              <PayTiles ways={q.ssl_ways ?? PAY_VIA.map((v) => ({ via: v, logo: null }))} busy={pay.isPending ? (pay.variables?.via ?? null) : null} pending={pay.isPending} />
            )}

            {channel === "manual" && !free && q.manual && (
              <div className="manual-box">
                <ol className="how-list">
                  <li>{t("app.checkout.manual.how1")}</li>
                  <li>{t("app.checkout.manual.how2", { min: lang === "bn" ? toBnDigits(q.manual.window_min) : q.manual.window_min })}</li>
                  <li>{t("app.checkout.manual.how3")}</li>
                </ol>
                <Field id="m-method" label={t("app.checkout.manual.method")}>
                  <select id="m-method" className="input" value={chosenMethod} onChange={(e) => setMethod(e.target.value as Method)}>
                    {manualMethods.map((m) => (
                      <option key={m} value={m}>
                        {t(`method.${m}` as "method.bkash")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="m-payer" label={t("app.checkout.manual.payer")} error={fields.payer_number} hint={t("app.checkout.manual.payerHint")}>
                  <TextInput id="m-payer" type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" value={payer} onChange={(e) => setPayer(e.target.value)} error={fields.payer_number} />
                </Field>
                <p className="hint">{t("app.checkout.manual.note")}</p>
              </div>
            )}
            {formError && (
              <div className="flash err mt" role="alert">
                {formError}
                {gatewayDown && channels.includes("manual") && (
                  <>
                    <br />
                    {t("app.checkout.gatewayManual")}
                    <div className="mt">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          setChannel("manual");
                          setFormError("");
                          setGatewayDown(false);
                        }}
                      >
                        {t("app.checkout.useManual")}
                      </button>
                    </div>
                  </>
                )}
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
              <Button className="btn-primary btn-block btn-lg" type="submit" busy={pay.isPending} disabled={!free && (channels.length === 0 || (channel === "manual" && !payer.trim()))}>
                {free ? t("app.checkout.enrollFree") : channel === "manual" ? t("app.checkout.continueManual") : t("app.checkout.place", { amount: money(q.total) })}
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
