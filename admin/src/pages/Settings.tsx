import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BUILTIN_QR, dhakaMinuteMs, formatDateTime, readSslLogo, SSL_BANNER, SSL_LOGO_MAX } from "@mawah/shared";
import { adm, api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, ErrorState, Field, Icon, PageHeader, Panel, Spinner, Switch, Tabs, TextArea, TextInput, useConfirm, useFieldErrors, useToast } from "../components/ui";
import { EmailPanel } from "./EmailPanel";
import { PaymentCheck } from "./PaymentCheck";
import { SmsPanel } from "./SmsPanel";

interface S {
  contact: { whatsapp: string; phone: string; email: string; facebook: string; messenger: string; youtube: string; instagram: string; address_bn: string; address_en: string; trade_license: string };
  announcement: { enabled: boolean; bn: string; en: string; ends_at: string; button_bn: string; button_en: string; link: string };
  shop: { enabled: boolean; url: string; label_bn: string; label_en: string };
  payments: {
    sslcommerz: boolean;
    manual: boolean;
    manual_numbers: { bkash: string; nagad: string; rocket: string };
    manual_note_bn: string;
    manual_note_en: string;
    manual_window_min: number;
    ssl_logo: string;
    /** Bangla QR, Active / Inactive, its picture (an R2 key under payments/) and the name it pays */
    bangla_qr: boolean;
    qr_image: string;
    qr_name: string;
  };
  policies: {
    refund_bn: string;
    refund_en: string;
    privacy_bn: string;
    privacy_en: string;
    terms_bn: string;
    terms_en: string;
    delivery_bn: string;
    delivery_en: string;
    guide_bn: string;
    guide_en: string;
    order_bn: string;
    order_en: string;
    hotline_bn: string;
    hotline_en: string;
    shop_terms_bn: string;
    shop_terms_en: string;
    shop_returns_bn: string;
    shop_returns_en: string;
  };
  about: { bn: string; en: string };
  analytics: { ga4: string; clarity: string; meta_pixel: string; meta_capi_test: string; meta_graph_version: string };
}
type Key = keyof Pick<S, "contact" | "announcement" | "shop" | "payments" | "policies" | "about" | "analytics">;
type Tab = "contact" | "payments" | "email" | "sms" | "policies" | "about" | "analytics";

/**
 * SSLCommerz's logo as it will look, from what is in the box: SSLCommerz's picture when the box holds the link (or code) SSLCommerz gave, or
 * plainly why it does not — before Save, so a wrong paste is seen at once. With the box empty, the copy of SSLCommerz's picture the owner sent
 * is what the site shows (once the store's keys are set).
 */
function SslLogoPreview({ value, hasError }: { value: string; hasError: boolean }) {
  const { t } = useI18n();
  if (!value.trim()) {
    return (
      <div className="field wide ssl-preview">
        <p className="hint">{t("adm.pay.sslLogoOwn")}</p>
        <img src={SSL_BANNER.src} width={SSL_BANNER.width} height={SSL_BANNER.height} alt={t("adm.pay.sslLogoAlt")} />
      </div>
    );
  }
  const logo = readSslLogo(value);
  // after Save the box itself says what is wrong; the same words twice would be noise
  if (!logo && hasError) return null;
  return (
    <div className="field wide ssl-preview" aria-live="polite">
      {logo ? (
        <>
          <p className="hint">{t("adm.pay.sslLogoPreview")}</p>
          <img src={logo.src} alt={t("adm.pay.sslLogoAlt")} />
        </>
      ) : (
        <p className="err-text">{t("err.ssl_logo_invalid")}</p>
      )}
    </div>
  );
}

/**
 * What the countdown in the announcement bar will do with the time in the box: count down to it (with the moment written out, in
 * Bangladesh time), or nothing, because it has passed (the bar is then hidden on the website).
 */
function CountdownState({ endsAt }: { endsAt: string }) {
  const { t, lang } = useI18n();
  if (!endsAt) return null;
  const end = dhakaMinuteMs(endsAt);
  if (end === null) return null;
  const date = formatDateTime(new Date(end).toISOString(), lang);
  return (
    <div className="field wide" aria-live="polite">
      <p className={end > Date.now() ? "hint" : "err-text"}>{end > Date.now() ? t("adm.settings.countdownOn", { date }) : t("adm.settings.countdownOver", { date })}</p>
    </div>
  );
}

/**
 * Whether the announcement bar is on the website now: switched off (Inactive), its countdown over (Ended — the website hides it then),
 * or showing (Active). With nothing written and no time set there is nothing to show, so it reads Inactive too.
 */
function BarState({ v }: { v: S["announcement"] }) {
  const { t, lang } = useI18n();
  const end = v.ends_at ? dhakaMinuteMs(v.ends_at) : null;
  if (v.enabled && end !== null && end <= Date.now()) return <Chip tone="warn">{t("adm.settings.barEnded", { date: formatDateTime(new Date(end).toISOString(), lang) })}</Chip>;
  const shows = v.enabled && (!!(v.bn.trim() || v.en.trim()) || end !== null);
  return <Chip tone={shows ? "ok" : "neutral"}>{shows ? t("adm.settings.barActive") : t("adm.settings.barInactive")}</Chip>;
}

/**
 * The shop's Bangla QR picture: the built-in MAWAH QR until a different one is uploaded — exactly as the bank or wallet gave it — never shrunk or re-encoded, so it stays sharp enough to scan —
 * and shown large on white, so the owner can scan the preview with a phone before saving.
 */
function QrUpload({ value, onChange, disabled, error }: { value: string; onChange: (key: string) => void; disabled: boolean; error?: string }) {
  const { t, err } = useI18n();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem("");
    try {
      const res = await api<{ key: string }>("/admin/media/image?folder=payments", { body: file, contentType: file.type || "image/png" });
      onChange(res.key);
    } catch (e) {
      setProblem(err(e instanceof ApiError ? (e.code === "unsupported_file_type" ? "file_type" : e.code) : "generic"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="field wide qr-field">
      <span className="label" id="pn-qr-l">
        {t("adm.pay.qrImage")}
      </span>
      <div className="qr-upload">
        <figure className="qr-preview">
          <img src={value ? `/media/${value}` : BUILTIN_QR.src} alt={t("adm.pay.qrImage")} />
          {!value && <figcaption>{t("adm.pay.qrNone")}</figcaption>}
        </figure>
        <div className="stack">
          <label className={`btn btn-outline${disabled ? " disabled" : ""}`}>
            <input
              id="pn-qr"
              className="vh"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              aria-labelledby="pn-qr-l"
              aria-invalid={error || problem ? true : undefined}
              disabled={disabled || busy}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <Icon name="qr" /> {t(value ? "adm.pay.qrChange" : "adm.pay.qrPick")}
          </label>
          {busy && <span className="hint">{t("adm.pay.qrUploading")}</span>}
          {value && !disabled && (
            <Button className="btn-ghost btn-sm" onClick={() => onChange("")}>
              {t("adm.pay.qrRemove")}
            </Button>
          )}
          <p className="hint">{t("adm.pay.qrImageHint")}</p>
          {(problem || error) && (
            <p className="err-text" role="alert">
              {problem || err(error ?? "invalid")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface MetaStatus {
  pixel: string | null;
  token: { source: "admin" | "secret" | "none"; hint: string | null };
  ready: boolean;
  test_code: string | null;
  last: { at: string; event: string; test: boolean; ok: boolean; detail: string; trace: string | null } | null;
}

/**
 * Meta Conversions API: the purchase reported to Meta by the server as well as by the browser's Pixel (deduplicated by one event ID), so
 * ad blockers and late approvals do not lose it. The access token is pasted here once (saved encrypted; only its last four characters are
 * ever shown). "Send a test event" sends a Purchase marked with the test code — it shows in Events Manager → Test events within seconds —
 * and Meta's own answer is shown here, as is the answer to the latest real purchase.
 */
function MetaCapi({ canWrite }: { canWrite: boolean }) {
  const { t, err, dateTime } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["meta-capi"], queryFn: async () => (await adm<{ meta: MetaStatus }>("/analytics/meta")).meta });
  const [token, setToken] = useState("");
  const [tokenErr, setTokenErr] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ ok: boolean; detail: string; trace?: string } | null>(null);
  const m = q.data;
  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      const f = e instanceof ApiError ? Object.values(e.fields ?? {})[0] : undefined;
      if (name === "token" && f) setTokenErr(err(f));
      toast(f ? err(f) : err(e instanceof ApiError ? e.code : "generic"), true);
    } finally {
      setBusy("");
    }
  };
  const saveToken = () =>
    act("token", async () => {
      setTokenErr("");
      await adm("/analytics/meta/token", { method: "PUT", json: { token } });
      setToken("");
      toast(t("adm.meta.tokenSaved"));
      await q.refetch();
    });
  const removeToken = async () => {
    const r = await confirm({ title: t("adm.meta.removeTitle"), body: t("adm.meta.removeBody"), danger: true, confirmLabel: t("btn.delete") });
    if (r.ok) void act("rm", async () => {
      await adm("/analytics/meta/token", { method: "DELETE" });
      await q.refetch();
    });
  };
  const test = () =>
    act("test", async () => {
      const r = await adm<{ result: { ok: boolean; detail: string; trace?: string } }>("/analytics/meta/test", { json: code.trim() ? { test_code: code.trim() } : {} });
      setResult(r.result);
      await q.refetch();
    });
  if (!m) return null;
  return (
    <div className="key-box meta-capi">
      <div className="row">
        <b>{t("adm.meta.title")}</b>
        {m.ready ? <Chip tone="ok">{t("adm.meta.ready")}</Chip> : <Chip tone="warn">{t("adm.meta.notReady")}</Chip>}
      </div>
      <p className="hint">{t("adm.meta.sub")}</p>
      {!m.pixel && <p className="err-text">{t("adm.meta.needPixel")}</p>}
      <p className="hint">{m.token.source === "none" ? t("adm.meta.noToken") : t("adm.meta.tokenSet", { hint: m.token.hint ?? "" })}</p>
      {canWrite && (
        <div className="row nowrap">
          <TextInput
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("adm.meta.tokenPlaceholder")}
            aria-label={t("adm.meta.token")}
            value={token}
            error={tokenErr || undefined}
            onChange={(e) => {
              setToken(e.target.value);
              setTokenErr("");
            }}
          />
          <Button className="btn-outline" busy={busy === "token"} disabled={!token.trim()} onClick={() => void saveToken()}>
            {t("adm.meta.saveToken")}
          </Button>
          {m.token.source === "admin" && (
            <Button className="btn-ghost" busy={busy === "rm"} onClick={() => void removeToken()}>
              {t("btn.delete")}
            </Button>
          )}
        </div>
      )}
      {tokenErr && (
        <p className="err-text" role="alert">
          {tokenErr}
        </p>
      )}
      {canWrite && m.ready && (
        <div className="meta-test">
          <Field id="meta-test-code" label={t("adm.meta.testCode")} hint={t("adm.meta.testCodeHint")}>
            <div className="row nowrap">
              <TextInput id="meta-test-code" placeholder={m.test_code ?? "TEST12345"} value={code} spellCheck={false} onChange={(e) => setCode(e.target.value)} />
              <Button className="btn-dark" busy={busy === "test"} disabled={!code.trim() && !m.test_code} onClick={() => void test()}>
                <Icon name="activity" /> {t("adm.meta.sendTest")}
              </Button>
            </div>
          </Field>
          {result && (
            <p className={result.ok ? "ok-text" : "err-text"} role="status">
              {result.ok ? t("adm.meta.testOk", { detail: result.detail }) : t("adm.meta.testFail", { detail: result.detail })}
              {result.trace ? ` · fbtrace_id ${result.trace}` : ""}
            </p>
          )}
        </div>
      )}
      {m.last && (
        <p className="hint">
          {t("adm.meta.last")}: <Chip tone={m.last.ok ? "ok" : "bad"}>{m.last.ok ? "✓" : "✗"}</Chip> {m.last.event} · {dateTime(m.last.at)} · {m.last.detail}
        </p>
      )}
      {m.test_code && <p className="warn-text">{t("adm.meta.testOn", { code: m.test_code })}</p>}
    </div>
  );
}

/** One settings group: local edits, one Save button, server-side validation errors shown per field. */
function Group<K extends Key>({ name, data, canWrite, children }: { name: K; data: S[K]; canWrite: boolean; children: (v: S[K], set: (patch: Partial<S[K]>) => void, errors: Record<string, string>) => React.ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const [v, setV] = useState<S[K]>(data);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setV(data);
  }, [data]);
  const save = useMutation({
    mutationFn: () => adm(`/settings/${name}`, { method: "PUT", json: v }),
    onSuccess: () => {
      setErrors({});
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["health"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast(e instanceof ApiError && e.code === "validation" ? t("err.validation") : t("err.generic"), true);
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      noValidate
    >
      {children(v, (patch) => setV((s) => ({ ...s, ...patch })), errors)}
      {canWrite ? (
        <Button className="btn-primary" type="submit" busy={save.isPending}>
          {t("btn.save")}
        </Button>
      ) : (
        <p className="hint">{t("adm.settings.readonly")}</p>
      )}
    </form>
  );
}

export function Settings() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "contact";
  const q = useQuery({ queryKey: ["settings"], queryFn: () => adm<{ settings: S; meta: { key: string; updated_at: string; updated_by_name: string | null }[] }>("/settings") });
  const canWrite = can("settings:write");

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data.settings;

  return (
    <>
      <PageHeader title={t("adm.nav.settings")} sub={t("adm.settings.sub")} />
      <Tabs
        value={tab}
        onChange={(v) => setParams(v === "contact" ? {} : { tab: v })}
        tabs={[
          { value: "contact", label: t("adm.settings.tab.contact") },
          { value: "payments", label: t("adm.settings.tab.payments") },
          { value: "email", label: t("adm.settings.tab.email") },
          { value: "sms", label: t("adm.settings.tab.sms") },
          { value: "policies", label: t("adm.settings.tab.policies") },
          { value: "about", label: t("adm.settings.tab.about") },
          { value: "analytics", label: t("adm.settings.tab.analytics") },
        ]}
      />
      <Panel>
        {tab === "email" && <EmailPanel />}
        {tab === "sms" && <SmsPanel />}
        {tab === "contact" && (
          <Group name="contact" data={s.contact} canWrite={canWrite}>
            {(v, set, e) => (
              <div className="form-grid">
                <Field id="c-wa" label={t("adm.settings.whatsapp")} hint={t("adm.settings.whatsappHint")} error={e.whatsapp}>
                  <TextInput id="c-wa" inputMode="tel" value={v.whatsapp} error={e.whatsapp} disabled={!canWrite} onChange={(x) => set({ whatsapp: x.target.value })} />
                </Field>
                <Field id="c-ph" label={t("label.phone")} error={e.phone}>
                  <TextInput id="c-ph" inputMode="tel" value={v.phone} error={e.phone} disabled={!canWrite} onChange={(x) => set({ phone: x.target.value })} />
                </Field>
                <Field id="c-em" label={t("label.email")} error={e.email}>
                  <TextInput id="c-em" type="email" value={v.email} error={e.email} disabled={!canWrite} onChange={(x) => set({ email: x.target.value })} />
                </Field>
                <Field id="c-fb" label="Facebook" hint="https://facebook.com/…" error={e.facebook}>
                  <TextInput id="c-fb" value={v.facebook} error={e.facebook} disabled={!canWrite} onChange={(x) => set({ facebook: x.target.value })} />
                </Field>
                <Field id="c-ms" label="Messenger" hint={t("adm.settings.messengerHint")} error={e.messenger}>
                  <TextInput id="c-ms" value={v.messenger ?? ""} placeholder="https://m.me/…" error={e.messenger} disabled={!canWrite} onChange={(x) => set({ messenger: x.target.value })} />
                </Field>
                <Field id="c-yt" label="YouTube" error={e.youtube}>
                  <TextInput id="c-yt" value={v.youtube} error={e.youtube} disabled={!canWrite} onChange={(x) => set({ youtube: x.target.value })} />
                </Field>
                <Field id="c-ig" label="Instagram" error={e.instagram}>
                  <TextInput id="c-ig" value={v.instagram} error={e.instagram} disabled={!canWrite} onChange={(x) => set({ instagram: x.target.value })} />
                </Field>
                <Field id="c-tl" label={t("adm.settings.tradeLicense")} hint={t("adm.settings.tradeLicenseHint")} error={e.trade_license}>
                  <TextInput id="c-tl" value={v.trade_license} maxLength={60} error={e.trade_license} disabled={!canWrite} onChange={(x) => set({ trade_license: x.target.value })} />
                </Field>
                <Field id="c-ad-bn" label={`${t("adm.settings.address")} — বাংলা`} hint={t("adm.settings.addressHint")} error={e.address_bn}>
                  <TextInput id="c-ad-bn" value={v.address_bn} maxLength={200} error={e.address_bn} disabled={!canWrite} onChange={(x) => set({ address_bn: x.target.value })} />
                </Field>
                <Field id="c-ad-en" label={`${t("adm.settings.address")} — English`} error={e.address_en}>
                  <TextInput id="c-ad-en" value={v.address_en} maxLength={200} error={e.address_en} disabled={!canWrite} onChange={(x) => set({ address_en: x.target.value })} />
                </Field>
              </div>
            )}
          </Group>
        )}
        {tab === "contact" && (
          <>
            <hr className="sep" />
            <h3>{t("adm.settings.announcement")}</h3>
            <Group name="announcement" data={s.announcement} canWrite={canWrite}>
              {(v, set, e) => (
                <div className="form-grid">
                  <div className="field wide">
                    <div className="row bar-switch">
                      <Switch id="an-on" checked={v.enabled !== false} disabled={!canWrite} onChange={(x) => set({ enabled: x })} label={t("adm.settings.barOn")} />
                      <BarState v={{ ...v, enabled: v.enabled !== false }} />
                    </div>
                    <p className="hint">{t("adm.settings.barOnHint")}</p>
                  </div>
                  <Field id="an-bn" label={t("adm.settings.announcementBn")} hint={t("adm.settings.announcementHint")} error={e.bn}>
                    <TextInput id="an-bn" value={v.bn} maxLength={200} error={e.bn} disabled={!canWrite} onChange={(x) => set({ bn: x.target.value })} />
                  </Field>
                  <Field id="an-en" label={t("adm.settings.announcementEn")} error={e.en}>
                    <TextInput id="an-en" value={v.en} maxLength={200} error={e.en} disabled={!canWrite} onChange={(x) => set({ en: x.target.value })} />
                  </Field>
                  <Field id="an-end" label={t("adm.settings.countdown")} hint={t("adm.settings.countdownHint")} error={e.ends_at}>
                    <TextInput id="an-end" type="datetime-local" value={v.ends_at ?? ""} error={e.ends_at} disabled={!canWrite} onChange={(x) => set({ ends_at: x.target.value })} />
                  </Field>
                  <CountdownState endsAt={v.ends_at ?? ""} />
                  <Field id="an-btn-bn" label={t("adm.settings.barButtonBn")} hint={t("adm.settings.barButtonHint")} error={e.button_bn}>
                    <TextInput id="an-btn-bn" value={v.button_bn ?? ""} maxLength={40} error={e.button_bn} disabled={!canWrite} onChange={(x) => set({ button_bn: x.target.value })} />
                  </Field>
                  <Field id="an-btn-en" label={t("adm.settings.barButtonEn")} error={e.button_en}>
                    <TextInput id="an-btn-en" value={v.button_en ?? ""} maxLength={40} error={e.button_en} disabled={!canWrite} onChange={(x) => set({ button_en: x.target.value })} />
                  </Field>
                  <Field id="an-link" label={t("adm.settings.barLink")} hint={t("adm.settings.barLinkHint")} error={e.link} wide>
                    <TextInput id="an-link" inputMode="url" placeholder="/courses" value={v.link ?? ""} error={e.link} disabled={!canWrite} onChange={(x) => set({ link: x.target.value.trim() })} />
                  </Field>
                </div>
              )}
            </Group>
            <hr className="sep" />
            <h3>{t("adm.shop.title")}</h3>
            <p className="muted">{t("adm.shop.sub")}</p>
            <Group name="shop" data={s.shop} canWrite={canWrite}>
              {(v, set, e) => (
                <div className="form-grid">
                  <div className="field wide">
                    <Switch checked={v.enabled} disabled={!canWrite} onChange={(x) => set({ enabled: x })} label={t("adm.shop.enabled")} />
                  </div>
                  <Field id="sh-url" label={t("adm.shop.url")} hint={t("adm.shop.urlHint")} error={e.url} wide>
                    <TextInput id="sh-url" inputMode="url" placeholder="https://…" value={v.url} error={e.url} disabled={!canWrite} onChange={(x) => set({ url: x.target.value.trim() })} />
                  </Field>
                  <Field id="sh-bn" label={t("adm.shop.labelBn")} hint={t("adm.shop.labelHint")} error={e.label_bn}>
                    <TextInput id="sh-bn" value={v.label_bn} maxLength={24} error={e.label_bn} disabled={!canWrite} onChange={(x) => set({ label_bn: x.target.value })} />
                  </Field>
                  <Field id="sh-en" label={t("adm.shop.labelEn")} error={e.label_en}>
                    <TextInput id="sh-en" value={v.label_en} maxLength={24} error={e.label_en} disabled={!canWrite} onChange={(x) => set({ label_en: x.target.value })} />
                  </Field>
                </div>
              )}
            </Group>
          </>
        )}
        {tab === "payments" && (
          <>
            <Group name="payments" data={s.payments} canWrite={canWrite}>
              {(v, set, e) => (
                <div className="form-grid">
                  <div className="field wide">
                    <Switch checked={v.sslcommerz} disabled={!canWrite} onChange={(x) => set({ sslcommerz: x })} label={t("adm.pay.ssl")} />
                    <p className="hint">{t("adm.pay.sslHint")}</p>
                  </div>
                  <Field id="pn-ssl-logo" label={t("adm.pay.sslLogo")} hint={t("adm.pay.sslLogoHint")} error={e.ssl_logo} wide>
                    <TextArea id="pn-ssl-logo" rows={3} className="mono" maxLength={SSL_LOGO_MAX} spellCheck={false} value={v.ssl_logo} disabled={!canWrite} onChange={(x) => set({ ssl_logo: x.target.value })} />
                  </Field>
                  <SslLogoPreview value={v.ssl_logo} hasError={Boolean(e.ssl_logo)} />
                  <div className="field wide">
                    <Switch checked={v.manual} disabled={!canWrite} onChange={(x) => set({ manual: x })} label={t("adm.pay.manual")} />
                    <p className="hint">{t("adm.pay.manualHint")}</p>
                  </div>
                  <Field id="pn-window" label={t("adm.pay.window")} error={e.manual_window_min} hint={t("adm.pay.windowHint")}>
                    <TextInput id="pn-window" type="number" inputMode="numeric" min={5} max={120} value={String(v.manual_window_min)} error={e.manual_window_min} disabled={!canWrite} onChange={(x) => set({ manual_window_min: Number(x.target.value) })} />
                  </Field>
                  {(["bkash", "nagad", "rocket"] as const).map((m) => (
                    <Field key={m} id={`pn-${m}`} label={t("adm.pay.number", { name: t(`method.${m}` as "method.bkash") })} error={e[`manual_numbers.${m}`]}>
                      <TextInput id={`pn-${m}`} inputMode="tel" value={v.manual_numbers[m]} error={e[`manual_numbers.${m}`]} disabled={!canWrite} onChange={(x) => set({ manual_numbers: { ...v.manual_numbers, [m]: x.target.value } })} />
                    </Field>
                  ))}
                  <Field id="pn-note-bn" label={t("adm.pay.noteBn")} error={e.manual_note_bn}>
                    <TextArea id="pn-note-bn" rows={3} maxLength={500} value={v.manual_note_bn} disabled={!canWrite} onChange={(x) => set({ manual_note_bn: x.target.value })} />
                  </Field>
                  <Field id="pn-note-en" label={t("adm.pay.noteEn")} error={e.manual_note_en}>
                    <TextArea id="pn-note-en" rows={3} maxLength={500} value={v.manual_note_en} disabled={!canWrite} onChange={(x) => set({ manual_note_en: x.target.value })} />
                  </Field>
                  {/* the third way of paying: Bangla QR, Active / Inactive (the shop's own QR is built in) */}
                  <div className="field wide pay-qr-head">
                    <Switch checked={v.bangla_qr} disabled={!canWrite} onChange={(x) => set({ bangla_qr: x })} label={t("adm.pay.qr")} />
                    <Chip tone={v.bangla_qr ? "ok" : "neutral"}>{t(v.bangla_qr ? "adm.pay.qrActive" : "adm.pay.qrInactive")}</Chip>
                    <p className="hint">{t("adm.pay.qrHint")}</p>
                  </div>
                  <QrUpload value={v.qr_image} onChange={(key) => set({ qr_image: key })} disabled={!canWrite} error={e.qr_image} />
                  <Field id="pn-qr-name" label={t("adm.pay.qrName")} hint={t("adm.pay.qrNameHint")} error={e.qr_name} wide>
                    <TextInput id="pn-qr-name" maxLength={80} value={v.qr_name} error={e.qr_name} disabled={!canWrite} onChange={(x) => set({ qr_name: x.target.value })} />
                  </Field>
                  <div className="notice wide">
                    <Icon name="shield" />
                    <div>
                      <b>{t("adm.pay.secretsTitle")}</b>
                      <p>{t("adm.pay.secretsBody")}</p>
                    </div>
                  </div>
                </div>
              )}
            </Group>
            <PaymentCheck />
          </>
        )}
        {tab === "policies" && (
          <Group name="policies" data={s.policies} canWrite={canWrite}>
            {(v, set, e) => (
              <div className="form-grid">
                {(["refund", "terms", "privacy", "delivery", "guide", "order", "hotline", "shop_terms", "shop_returns"] as const).flatMap((k) =>
                  (["bn", "en"] as const).map((l) => {
                    const key = `${k}_${l}` as keyof S["policies"];
                    return (
                      <Field key={key} id={`po-${key}`} label={`${t(`adm.policy.${k}` as "adm.policy.refund")} — ${l === "bn" ? "বাংলা" : "English"}`} hint={k === "refund" && l === "bn" ? t("adm.policy.refundHint") : t("adm.markdown.hint")} error={e[key]} wide={false}>
                        <TextArea id={`po-${key}`} rows={8} className="mono" value={v[key]} disabled={!canWrite} onChange={(x) => set({ [key]: x.target.value } as Partial<S["policies"]>)} />
                      </Field>
                    );
                  }),
                )}
              </div>
            )}
          </Group>
        )}
        {tab === "about" && (
          <Group name="about" data={s.about} canWrite={canWrite}>
            {(v, set, e) => (
              <div className="form-grid">
                <Field id="ab-bn" label={`${t("adm.settings.aboutText")} — বাংলা`} hint={t("adm.markdown.hint")} error={e.bn}>
                  <TextArea id="ab-bn" rows={10} className="mono" value={v.bn} disabled={!canWrite} onChange={(x) => set({ bn: x.target.value })} />
                </Field>
                <Field id="ab-en" label={`${t("adm.settings.aboutText")} — English`} error={e.en}>
                  <TextArea id="ab-en" rows={10} className="mono" value={v.en} disabled={!canWrite} onChange={(x) => set({ en: x.target.value })} />
                </Field>
              </div>
            )}
          </Group>
        )}
        {tab === "analytics" && (
          <Group name="analytics" data={s.analytics} canWrite={canWrite}>
            {(v, set, e) => (
              <>
                <p className="muted">{t("adm.analytics.sub")}</p>
                <div className="form-grid">
                  <Field id="an-ga" label="Google Analytics 4" hint={t("adm.analytics.gaHint")} error={e.ga4}>
                    <TextInput id="an-ga" placeholder="G-XXXXXXXXXX" value={v.ga4} error={e.ga4} disabled={!canWrite} onChange={(x) => set({ ga4: x.target.value.trim() })} />
                  </Field>
                  <Field id="an-cl" label="Microsoft Clarity" hint={t("adm.analytics.clarityHint")} error={e.clarity}>
                    <TextInput id="an-cl" value={v.clarity} error={e.clarity} disabled={!canWrite} onChange={(x) => set({ clarity: x.target.value.trim() })} />
                  </Field>
                  <Field id="an-px" label="Meta Pixel" hint={t("adm.analytics.pixelHint")} error={e.meta_pixel}>
                    <TextInput id="an-px" inputMode="numeric" value={v.meta_pixel} error={e.meta_pixel} disabled={!canWrite} onChange={(x) => set({ meta_pixel: x.target.value.trim() })} />
                  </Field>
                  <Field id="an-graph" label={t("adm.meta.graphVersion")} hint={t("adm.meta.graphVersionHint")} error={e.meta_graph_version}>
                    <TextInput id="an-graph" spellCheck={false} placeholder="v24.0" value={v.meta_graph_version} error={e.meta_graph_version} disabled={!canWrite} onChange={(x) => set({ meta_graph_version: x.target.value.trim() })} />
                  </Field>
                  <Field id="an-capi-test" label={t("adm.meta.testCodeSaved")} hint={t("adm.meta.testCodeSavedHint")} error={e.meta_capi_test}>
                    <TextInput id="an-capi-test" spellCheck={false} placeholder="TEST12345" value={v.meta_capi_test} error={e.meta_capi_test} disabled={!canWrite} onChange={(x) => set({ meta_capi_test: x.target.value.trim() })} />
                  </Field>
                </div>
                <p className="hint">{t("adm.analytics.privacy")}</p>
                <MetaCapi canWrite={canWrite} />
                {can("analytics:read") && (
                  <p>
                    <Link className="btn btn-outline btn-sm" to="/analytics">
                      <Icon name="activity" /> {t("adm.analytics.open")}
                    </Link>
                  </p>
                )}
              </>
            )}
          </Group>
        )}
      </Panel>
    </>
  );
}
