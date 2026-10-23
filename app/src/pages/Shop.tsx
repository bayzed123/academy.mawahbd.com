import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SHOP_MAX_QTY, percentOff, type GeoPlaceDTO, type ShopCardDTO, type ShopOrderDTO, type ShopPayment, type ShopQuoteDTO } from "@mawah/shared";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSite } from "../lib/hooks";
import { useI18n } from "../lib/i18n";
import { addToCart, markPlaced, orderKey, placedDone, readCart, readWish, rememberOrderKey, writeCart, writeWish } from "../lib/shopCart";
import { Button, Empty, ErrorState, Field, Icon, Spinner, TextInput, Turnstile, useFieldErrors, useToast } from "../components/ui";

/*
 * The tools shop in the app: the cart, the checkout (a Bangladesh address picked level by level: division, district, upazila or town
 * area, union), the order page the buyer's link opens, and the wishlist. The product pages themselves are the website's (/shop/…).
 */

interface ShopConfig {
  open: boolean;
  home_district: number;
  fee_home: number;
  fee_other: number;
  free_over: number;
  free_delivery: boolean;
  delivery_bn: string;
  delivery_en: string;
}

const useShopConfig = () => useQuery({ queryKey: ["shop-config"], queryFn: () => api<ShopConfig>("/shop/config"), staleTime: 60_000 });
const site = (lang: string, path: string) => (lang === "en" ? `/en${path}` : path);

/** A sentence naming the shop's {terms}, {returns} and {privacy}: each a link to its page, in a new tab so the checkout stays as it is. */
function ShopPolicyText({ text }: { text: string }) {
  const { t, lang } = useI18n();
  const page = { terms: "shop-terms", returns: "shop-returns", privacy: "privacy" } as const;
  return (
    <>
      {text.split(/(\{(?:terms|returns|privacy)\})/).map((part, i) => {
        const k = /^\{(terms|returns|privacy)\}$/.exec(part)?.[1] as keyof typeof page | undefined;
        return k ? (
          <a key={i} className="link" href={site(lang, `/policies/${page[k]}`)} target="_blank" rel="noopener noreferrer">
            {t(`app.shop.agree.${k}`)}
          </a>
        ) : (
          part
        );
      })}
    </>
  );
}

function useQuote(lines: { variant_id: number; qty: number }[], districtId: number | null) {
  return useQuery({
    queryKey: ["shop-quote", lines, districtId],
    queryFn: async () => (await api<{ quote: ShopQuoteDTO }>("/shop/quote", { json: { items: lines, district_id: districtId } })).quote,
    enabled: lines.length > 0,
    placeholderData: (prev) => prev,
  });
}

function Thumb({ src }: { src: string | null }) {
  return <span className="shop-thumb">{src ? <img src={src} alt="" width="72" height="72" loading="lazy" decoding="async" /> : <Icon name="shop" />}</span>;
}

/* ------------------------------------------------------------------------------------------------------------------------ cart */
export function ShopCart() {
  const { t, lang, money, pick } = useI18n();
  const config = useShopConfig();
  const [lines, setLines] = useState(readCart);
  const quote = useQuote(lines, null);
  const heading = useRef<HTMLHeadingElement>(null);

  // the Worker's answer is the truth: anything gone is dropped and a quantity that is not there any more is lowered, here and in storage
  useEffect(() => {
    const q = quote.data;
    if (!q) return;
    const fixed = lines.filter((l) => !q.gone.includes(l.variant_id)).map((l) => ({ ...l, qty: q.lines.find((x) => x.variant_id === l.variant_id)?.qty ?? l.qty }));
    if (fixed.length !== lines.length || fixed.some((l, i) => l.qty !== lines[i].qty)) {
      writeCart(fixed);
      setLines(fixed);
    }
  }, [quote.data, lines]);

  const setQty = (variantId: number, qty: number) => {
    const next = lines.map((l) => (l.variant_id === variantId ? { ...l, qty: Math.max(0, Math.min(SHOP_MAX_QTY, qty)) } : l)).filter((l) => l.qty > 0);
    writeCart(next);
    setLines(next);
  };

  if (config.isPending) return <Spinner />;
  if (config.data && !config.data.open) {
    return <Empty icon="shop" title={t("app.shop.closed")} />;
  }
  if (!lines.length) {
    return (
      <Empty icon="shop" title={t("app.shop.cartEmpty")}>
        <a className="btn btn-primary" href={site(lang, "/shop")}>
          {t("app.shop.browse")}
        </a>
      </Empty>
    );
  }
  if (quote.isError) return <ErrorState error={quote.error} onRetry={() => quote.refetch()} />;
  const q = quote.data;
  return (
    <>
      <div className="page-head">
        <h1 ref={heading}>{t("app.shop.cart")}</h1>
      </div>
      {!q ? (
        <Spinner />
      ) : (
        <div className="checkout">
          <section className="panel" aria-labelledby="cart-h">
            <h2 id="cart-h" className="vh">
              {t("app.shop.cart")}
            </h2>
            {(q.gone.length > 0 || q.lines.some((l) => l.limited)) && (
              <p className="notice" role="status">
                <Icon name="help" />
                <span>{t("app.shop.changed")}</span>
              </p>
            )}
            <ul className="cart-lines">
              {q.lines.map((l) => {
                const name = pick(l, "name");
                const label = pick(l, "label");
                return (
                  <li key={l.variant_id} className="cart-line">
                    <Thumb src={l.image} />
                    <div className="cart-info">
                      <a href={site(lang, `/shop/p/${l.product_slug}`)}>
                        <b>{name}</b>
                      </a>
                      {label && <span className="muted small">{label}</span>}
                      <span>
                        {money(l.price)}
                        {l.list_price > l.price && <s className="muted small"> {money(l.list_price)}</s>}
                      </span>
                    </div>
                    <div className="cart-qty">
                      <div className="qty" role="group" aria-label={t("app.shop.qtyOf", { name })}>
                        <button type="button" className="qty-btn" aria-label={t("app.shop.less")} onClick={() => setQty(l.variant_id, l.qty - 1)}>
                          −
                        </button>
                        <span className="qty-n" aria-live="polite">
                          {lang === "bn" ? l.qty.toLocaleString("bn-BD") : l.qty}
                        </span>
                        <button type="button" className="qty-btn" aria-label={t("app.shop.more")} disabled={l.qty >= SHOP_MAX_QTY} onClick={() => setQty(l.variant_id, l.qty + 1)}>
                          +
                        </button>
                      </div>
                      <button type="button" className="link small" onClick={() => setQty(l.variant_id, 0)}>
                        {t("app.shop.remove")}
                        <span className="vh"> — {name}</span>
                      </button>
                    </div>
                    <b className="cart-sum">{money(l.price * l.qty)}</b>
                  </li>
                );
              })}
            </ul>
            <a className="link" href={site(lang, "/shop")}>
              {t("app.shop.continue")}
            </a>
          </section>
          <aside className="sticky">
            <section className="panel">
              <h2>{t("app.checkout.summary")}</h2>
              <div className="sum-row">
                <span>{t("label.subtotal")}</span>
                <span>{money(q.subtotal)}</span>
              </div>
              <div className="sum-row">
                <span>{t("app.shop.delivery")}</span>
                <span className="muted">{t("app.shop.deliveryLater")}</span>
              </div>
              {q.free_over > 0 && <p className="hint">{t("app.shop.freeOver", { amount: money(q.free_over) })}</p>}
              <div className="mt">
                <Link className="btn btn-primary btn-block btn-lg" to="/shop/checkout">
                  {t("app.shop.toCheckout")}
                </Link>
              </div>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------------------- checkout */
function PlaceSelect({ id, label, value, onChange, places, required, first, error, disabled }: { id: string; label: string; value: number; onChange: (v: number) => void; places: GeoPlaceDTO[] | undefined; required?: boolean; first?: { value: number; label: string }; error?: string; disabled?: boolean }) {
  const { lang, t } = useI18n();
  return (
    <Field id={id} label={label} required={required} error={error}>
      <select id={id} className="input" value={value || (first ? String(first.value) : "")} disabled={disabled || !places} aria-invalid={error ? true : undefined} aria-required={required || undefined} onChange={(e) => onChange(Number(e.target.value))}>
        {!first && <option value="">{t("app.shop.choosePlace")}</option>}
        {first && <option value={first.value}>{first.label}</option>}
        {places?.map((p) => (
          <option key={p.id} value={p.id}>
            {lang === "bn" ? p.name_bn : p.name_en}
          </option>
        ))}
      </select>
    </Field>
  );
}

const geo = (level: string, key?: string, parent?: number) => api<{ items: GeoPlaceDTO[] }>(`/shop/geo/${level}${key ? `?${key}=${parent}` : ""}`).then((r) => r.items);

export function ShopCheckout() {
  const { t, lang, money, pick, err } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const fieldErrors = useFieldErrors();
  const { student } = useAuth();
  const siteCfg = useSite();
  const qc = useQueryClient();
  const config = useShopConfig();
  const [lines] = useState(readCart);
  const [name, setName] = useState(student?.name ?? "");
  const [phone, setPhone] = useState(student?.phone ?? "");
  const [email, setEmail] = useState("");
  const [division, setDivision] = useState(0);
  const [district, setDistrict] = useState(0);
  // -1 = not chosen yet; 0 = the district's town or city area
  const [upazila, setUpazila] = useState(-1);
  const [union, setUnion] = useState(0);
  const [address, setAddress] = useState(student?.address ?? "");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<ShopPayment | "">("");
  const [agree, setAgree] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [bump, setBump] = useState(0);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const divisions = useQuery({ queryKey: ["geo", "divisions"], queryFn: () => geo("divisions"), staleTime: Infinity });
  const districts = useQuery({ queryKey: ["geo", "districts", division], queryFn: () => geo("districts", "division", division), enabled: division > 0, staleTime: Infinity });
  const upazilas = useQuery({ queryKey: ["geo", "upazilas", district], queryFn: () => geo("upazilas", "district", district), enabled: district > 0, staleTime: Infinity });
  const unions = useQuery({ queryKey: ["geo", "unions", upazila], queryFn: () => geo("unions", "upazila", upazila), enabled: upazila > 0, staleTime: Infinity });
  const quote = useQuote(lines, district || null);
  const q = quote.data;
  const districtName = useMemo(() => {
    const d = districts.data?.find((x) => x.id === district);
    return d ? (lang === "bn" ? d.name_bn : d.name_en) : "";
  }, [districts.data, district, lang]);

  useEffect(() => {
    if (q && !payment && q.payments.length) setPayment(q.payments[0]);
  }, [q, payment]);

  const place = useMutation({
    mutationFn: () =>
      api<{ order: { public_id: string; total: number; status: string }; link: string; redirect_url?: string }>("/shop/orders", {
        json: {
          items: lines,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          division_id: division,
          district_id: district,
          upazila_id: Math.max(0, upazila),
          union_id: upazila > 0 ? union : 0,
          address: address.trim(),
          note: note.trim(),
          payment,
          agree: true,
          turnstile: captcha || undefined,
        },
      }),
    onSuccess: (res) => {
      markPlaced(res.order.public_id);
      rememberOrderKey(res.order.public_id, new URL(res.link, window.location.origin).searchParams.get("k") ?? "");
      const to = res.link.replace(/^\/app/, "");
      // the online payment: straight to SSLCommerz's own page, where the buyer chooses bKash, Nagad, Rocket, a card …
      if (res.redirect_url) {
        toast(t("app.checkout.redirecting"));
        window.location.assign(res.redirect_url);
      } else {
        placedDone(res.order.public_id);
        navigate(to, { replace: true });
      }
    },
    onError: (e) => {
      setBump((n) => n + 1);
      const code = e instanceof ApiError ? e.code : "generic";
      if (code === "cart_changed") {
        void qc.invalidateQueries({ queryKey: ["shop-quote"] });
        setFormError(t("app.shop.changed"));
        return;
      }
      setFields(fieldErrors(e));
      setFormError(code === "validation" ? "" : code === "gateway_error" ? t("app.shop.gatewayDown") : err(code));
    },
  });

  if (config.isPending || (lines.length && quote.isPending)) return <Spinner />;
  if (config.data && !config.data.open) return <Empty icon="shop" title={t("app.shop.closed")} />;
  if (!lines.length) {
    return (
      <Empty icon="shop" title={t("app.shop.cartEmpty")}>
        <a className="btn btn-primary" href={site(lang, "/shop")}>
          {t("app.shop.browse")}
        </a>
      </Empty>
    );
  }
  if (quote.isError || !q) return <ErrorState error={quote.error} onRetry={() => quote.refetch()} />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFields({});
    setFormError("");
    const missing: Record<string, string> = {};
    if (!name.trim()) missing.name = t("err.required");
    if (!phone.trim()) missing.phone = t("err.required");
    if (!division) missing.division_id = t("err.required");
    if (!district) missing.district_id = t("err.required");
    if (upazila < 0) missing.upazila_id = t("err.required");
    if (address.trim().length < 5) missing.address = t("err.required");
    if (!payment) missing.payment = t("err.required");
    if (!agree) missing.agree = t("app.checkout.agree.needed");
    if (Object.keys(missing).length) {
      setFields(missing);
      const order = ["name", "phone", "division_id", "district_id", "upazila_id", "address", "payment", "agree"];
      const first = order.find((k) => missing[k]);
      document.getElementById({ name: "s-name", phone: "s-phone", division_id: "s-div", district_id: "s-dist", upazila_id: "s-upa", address: "s-addr", payment: "s-pay-0", agree: "s-agree" }[first!] ?? "s-name")?.focus();
      return;
    }
    place.mutate();
  };
  const cfg = config.data!;
  const delivery = lang === "bn" ? cfg.delivery_bn || cfg.delivery_en : cfg.delivery_en || cfg.delivery_bn;

  return (
    <>
      <div className="page-head">
        <h1>{t("app.shop.checkout")}</h1>
      </div>
      <form className="checkout" onSubmit={submit} noValidate>
        <div className="stack">
          <section className="panel" aria-labelledby="who-h">
            <h2 id="who-h">{t("app.shop.who")}</h2>
            <Field id="s-name" label={t("app.checkout.you.name")} required error={fields.name}>
              <TextInput id="s-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} aria-required="true" />
            </Field>
            <Field id="s-phone" label={t("app.checkout.you.phone")} required hint={t("app.shop.phoneHint")} error={fields.phone}>
              <TextInput id="s-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} error={fields.phone} aria-required="true" />
            </Field>
            <Field id="s-email" label={t("app.checkout.you.email")} hint={t("app.shop.emailHint")} error={fields.email}>
              <TextInput id="s-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
            </Field>
          </section>

          <section className="panel" aria-labelledby="where-h">
            <h2 id="where-h">{t("app.shop.where")}</h2>
            <div className="geo-grid">
              <PlaceSelect
                id="s-div"
                label={t("app.shop.division")}
                required
                value={division}
                places={divisions.data}
                error={fields.division_id}
                onChange={(v) => {
                  setDivision(v);
                  setDistrict(0);
                  setUpazila(-1);
                  setUnion(0);
                }}
              />
              <PlaceSelect
                id="s-dist"
                label={t("app.shop.district")}
                required
                value={district}
                places={division ? districts.data : undefined}
                error={fields.district_id}
                disabled={!division}
                onChange={(v) => {
                  setDistrict(v);
                  setUpazila(-1);
                  setUnion(0);
                }}
              />
              <Field id="s-upa" label={t("app.shop.upazila")} required error={fields.upazila_id}>
                <select
                  id="s-upa"
                  className="input"
                  value={upazila < 0 ? "" : String(upazila)}
                  disabled={!district || !upazilas.data}
                  aria-required="true"
                  aria-invalid={fields.upazila_id ? true : undefined}
                  onChange={(e) => {
                    setUpazila(e.target.value === "" ? -1 : Number(e.target.value));
                    setUnion(0);
                  }}
                >
                  <option value="">{t("app.shop.choosePlace")}</option>
                  {district > 0 && <option value="0">{t("app.shop.town", { district: districtName })}</option>}
                  {upazilas.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {lang === "bn" ? p.name_bn : p.name_en}
                    </option>
                  ))}
                </select>
              </Field>
              {upazila > 0 && <PlaceSelect id="s-uni" label={t("app.shop.union")} value={union} places={unions.data} first={{ value: 0, label: t("app.shop.unionNone") }} onChange={setUnion} />}
            </div>
            <Field id="s-addr" label={t("app.shop.address")} required hint={t("app.shop.addressHint")} error={fields.address}>
              <textarea id="s-addr" className="input" rows={2} maxLength={300} autoComplete="street-address" aria-required="true" aria-invalid={fields.address ? true : undefined} aria-describedby={fields.address ? "s-addr-err" : undefined} value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <Field id="s-note" label={t("app.shop.note")} hint={t("app.shop.noteHint")}>
              <textarea id="s-note" className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {delivery && (
              <p className="hint">
                <Icon name="truck" /> {delivery}
              </p>
            )}
          </section>

          <section className="panel" aria-labelledby="pay-h">
            <h2 id="pay-h">{t("app.shop.payHow")}</h2>
            <fieldset className="pay-opts" aria-describedby={fields.payment ? "s-pay-err" : undefined}>
              <legend className="vh">{t("app.shop.payHow")}</legend>
              {q.payments.map((p, i) => (
                <label key={p} className="pay-opt">
                  <input id={`s-pay-${i}`} type="radio" name="payment" value={p} checked={payment === p} onChange={() => setPayment(p)} />
                  <span className="pay-ico">
                    <Icon name={p === "cod" ? "truck" : "wallet"} />
                  </span>
                  <span>
                    <b>{t(`app.shop.pay.${p}` as "app.shop.pay.cod")}</b>
                    <small>{t(`app.shop.pay.${p}.sub` as "app.shop.pay.cod.sub")}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            {fields.payment && (
              <p className="err-text" id="s-pay-err">
                {fields.payment}
              </p>
            )}
            <div className={fields.agree ? "agree-box err" : "agree-box"}>
              <label className="agree" htmlFor="s-agree">
                <input
                  id="s-agree"
                  type="checkbox"
                  checked={agree}
                  aria-invalid={fields.agree ? true : undefined}
                  aria-describedby={fields.agree ? "s-agree-err" : undefined}
                  onChange={(e) => {
                    setAgree(e.target.checked);
                    if (e.target.checked) setFields(({ agree: _a, ...rest }) => rest);
                  }}
                />
                <span>
                  <ShopPolicyText text={t("app.shop.agree")} />
                </span>
              </label>
              {fields.agree && (
                <p className="err-text" id="s-agree-err">
                  {fields.agree}
                </p>
              )}
            </div>
            {siteCfg.data?.turnstile_site_key && <Turnstile siteKey={siteCfg.data.turnstile_site_key} onToken={setCaptcha} resetKey={bump} />}
            {formError && (
              <div className="flash err mt" role="alert">
                {formError}
                {place.error instanceof ApiError && (place.error.code === "gateway_error" || place.error.code === "gateway_amount_limit") && q.payments.includes("cod") && (
                  <div className="mt">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setPayment("cod");
                        setFormError("");
                      }}
                    >
                      {t("app.shop.useCod")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="sticky">
          <section className="panel">
            <h2>{t("app.checkout.summary")}</h2>
            {q.lines.map((l) => (
              <div className="summary-item" key={l.variant_id}>
                <span>
                  {pick(l, "name")}
                  {pick(l, "label") ? ` · ${pick(l, "label")}` : ""} × {lang === "bn" ? l.qty.toLocaleString("bn-BD") : l.qty}
                </span>
                <b>{money(l.price * l.qty)}</b>
              </div>
            ))}
            <div className="sum-row">
              <span>{t("label.subtotal")}</span>
              <span>{money(q.subtotal)}</span>
            </div>
            <div className="sum-row">
              <span>{t("app.shop.delivery")}</span>
              <span>{q.delivery_fee === null ? <span className="muted">{t("app.shop.chooseDistrict")}</span> : q.delivery_fee === 0 ? t("app.shop.free") : money(q.delivery_fee)}</span>
            </div>
            <div className="sum-row total">
              <span>{t("label.total")}</span>
              <span>{money(q.total)}</span>
            </div>
            <div className="mt">
              <Button className="btn-primary btn-block btn-lg" type="submit" busy={place.isPending}>
                {payment === "cod" ? t("app.shop.placeCod", { amount: money(q.total) }) : t("app.checkout.place", { amount: money(q.total) })}
              </Button>
            </div>
            <p className="hint tc">
              <Icon name="shield" className="inline-icon" /> {t("app.shop.safe")}
            </p>
          </section>
        </aside>
      </form>
    </>
  );
}

/* ----------------------------------------------------------------------------------------------------------------- the order */
const STEPS = ["placed", "confirmed", "shipped", "delivered"] as const;

export function ShopOrder() {
  const { t, lang, money, pick } = useI18n();
  const { publicId = "" } = useParams();
  const [params] = useSearchParams();
  // the link's key, or (back from SSLCommerz's page, which is not given it) the one this browser kept when the order was placed
  const key = params.get("k") || orderKey(publicId);
  useEffect(() => {
    rememberOrderKey(publicId, params.get("k") ?? "");
  }, [publicId, params]);
  const order = useQuery({
    queryKey: ["shop-order", publicId, key],
    queryFn: async () => (await api<{ order: ShopOrderDTO }>(`/shop/orders/${encodeURIComponent(publicId)}?k=${encodeURIComponent(key)}`)).order,
    // an online payment SSLCommerz has not confirmed yet: look again for a minute
    refetchInterval: (q) => (q.state.data?.status === "pending" && q.state.dataUpdateCount < 12 ? 5000 : false),
  });
  const o = order.data;
  useEffect(() => {
    if (o && o.status !== "pending" && o.status !== "failed" && o.status !== "cancelled") placedDone(o.public_id);
  }, [o]);
  if (order.isPending) return <Spinner />;
  if (order.isError || !o) return <ErrorState error={order.error} />;
  const reached = o.status === "paid" || o.status === "review" ? 0 : (STEPS as readonly string[]).indexOf(o.status);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }) : "");
  const closed = o.status === "failed" || o.status === "cancelled" || o.status === "refunded";
  return (
    <>
      <div className="page-head">
        <h1>{t("app.shop.order", { code: o.public_id })}</h1>
        <p className="muted">{when(o.created_at)}</p>
      </div>
      <section className="panel" aria-labelledby="st-h">
        <h2 id="st-h">{t(`app.shop.st.${o.status}` as "app.shop.st.placed")}</h2>
        <p>{t(`app.shop.st.${o.status}.sub` as "app.shop.st.placed.sub")}</p>
        {!closed && o.status !== "pending" && (
          <ol className="steps-line">
            {STEPS.map((s, i) => (
              <li key={s} className={i <= reached ? "done" : undefined} aria-current={i === reached ? "step" : undefined}>
                {t(`app.shop.step.${s}` as "app.shop.step.placed")}
              </li>
            ))}
          </ol>
        )}
        {o.courier_ref && <p>{t("app.shop.courier", { ref: o.courier_ref })}</p>}
        {closed && (
          <Link className="btn btn-outline" to="/shop/cart">
            {t("app.shop.backToCart")}
          </Link>
        )}
      </section>
      <section className="panel" aria-labelledby="it-h">
        <h2 id="it-h">{t("app.shop.items")}</h2>
        {o.items.map((i, n) => (
          <div className="summary-item" key={n}>
            <span>
              {pick(i, "name")}
              {pick(i, "label") ? ` · ${pick(i, "label")}` : ""} × {lang === "bn" ? i.qty.toLocaleString("bn-BD") : i.qty}
            </span>
            <b>{money(i.price * i.qty)}</b>
          </div>
        ))}
        <div className="sum-row">
          <span>{t("label.subtotal")}</span>
          <span>{money(o.subtotal)}</span>
        </div>
        <div className="sum-row">
          <span>{t("app.shop.delivery")}</span>
          <span>{o.delivery_fee === 0 ? t("app.shop.free") : money(o.delivery_fee)}</span>
        </div>
        <div className="sum-row total">
          <span>{t("label.total")}</span>
          <span>{money(o.total)}</span>
        </div>
        <p className="muted">{o.payment === "cod" ? t("app.shop.pay.cod") : t("app.shop.pay.sslcommerz")}</p>
      </section>
      <section className="panel" aria-labelledby="ad-h">
        <h2 id="ad-h">{t("app.shop.where")}</h2>
        <p>
          <b>{o.name}</b> · {o.phone}
          <br />
          {o.address}
          <br />
          {o.place}
        </p>
        {o.note && <p className="muted">{o.note}</p>}
        <p className="hint">{t("app.shop.keepLink")}</p>
      </section>
    </>
  );
}

/* ----------------------------------------------------------------------------------------------------------------- wishlist */
export function ShopWishlist() {
  const { t, lang, money, pick } = useI18n();
  const toast = useToast();
  const [ids, setIds] = useState(readWish);
  const list = useQuery({
    queryKey: ["shop-wish", ids],
    queryFn: async () => (await api<{ items: ShopCardDTO[] }>(`/shop/products?ids=${ids.join(",")}`)).items,
    enabled: ids.length > 0,
  });
  const remove = (id: number) => {
    const next = ids.filter((x) => x !== id);
    writeWish(next);
    setIds(next);
  };
  if (!ids.length) {
    return (
      <Empty icon="heart" title={t("app.shop.wishEmpty")}>
        <a className="btn btn-primary" href={site(lang, "/shop")}>
          {t("app.shop.browse")}
        </a>
      </Empty>
    );
  }
  if (list.isPending) return <Spinner />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  // keep the order the buyer saved them in; products taken off sale are simply not there
  const items = ids.map((id) => list.data.find((p) => p.id === id)).filter((p): p is ShopCardDTO => !!p);
  return (
    <>
      <div className="page-head">
        <h1>{t("app.shop.wishlist")}</h1>
      </div>
      <ul className="cart-lines panel">
        {items.map((p) => {
          const name = pick(p, "name");
          const off = percentOff(p.price, p.list_price);
          return (
            <li key={p.id} className="cart-line">
              <Thumb src={p.image} />
              <div className="cart-info">
                <a href={site(lang, `/shop/p/${p.slug}`)}>
                  <b>{name}</b>
                </a>
                <span>
                  {p.several ? `${t("app.shop.from")} ` : ""}
                  {money(p.price)}
                  {p.list_price > p.price && <s className="muted small"> {money(p.list_price)}</s>}
                  {off && <span className="off-inline"> −{off}%</span>}
                </span>
              </div>
              <div className="cart-qty">
                {p.in_stock && p.variant_id ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => toast(addToCart(p.variant_id!) ? t("app.shop.added") : t("app.shop.full"), false)}
                  >
                    {t("app.shop.add")}
                    <span className="vh"> — {name}</span>
                  </button>
                ) : (
                  <a className="btn btn-outline btn-sm" href={site(lang, `/shop/p/${p.slug}`)}>
                    {p.in_stock ? t("app.shop.choose") : t("app.shop.out")}
                    <span className="vh"> — {name}</span>
                  </a>
                )}
                <button type="button" className="link small" onClick={() => remove(p.id)}>
                  {t("app.shop.remove")}
                  <span className="vh"> — {name}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <Link className="btn btn-dark" to="/shop/cart">
        <Icon name="cart" /> {t("app.shop.cart")}
      </Link>
    </>
  );
}
