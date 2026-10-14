import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Field, Icon, TextInput, useFieldErrors } from "../components/ui";

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width={54} height={54} />
          <div>
            <b>{lang === "bn" ? t("brand.name") : "MAWAH Academy"}</b>
            <small>{t("adm.title")}</small>
          </div>
        </div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
        {children}
        <button type="button" className="lang-btn" lang={lang === "bn" ? "en" : "bn"} onClick={() => setLang(lang === "bn" ? "en" : "bn")}>
          {t("lang.switch")}
        </button>
      </div>
    </div>
  );
}

function useAction() {
  const { err } = useI18n();
  const fieldErrors = useFieldErrors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setFields({});
    try {
      await fn();
    } catch (e) {
      setFields(fieldErrors(e));
      setError(e instanceof ApiError && e.code !== "validation" ? err(e.code) : e instanceof ApiError ? "" : err("generic"));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, fields, run };
}

/** Staff sign-in. On a brand-new site (no staff yet) it turns into the one-time "create the first admin" form. */
export function Login() {
  const { t } = useI18n();
  const { login, setup } = useAuth();
  const status = useQuery({ queryKey: ["setup-status"], queryFn: () => adm<{ needs_setup: boolean; setup_enabled: boolean }>("/auth/setup-status"), staleTime: 60_000 });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const { busy, error, fields, run } = useAction();

  if (status.data?.needs_setup) {
    if (!status.data.setup_enabled) {
      return (
        <Card title={t("adm.setup.title")}>
          <div className="notice">
            <Icon name="lock" />
            <div>
              <b>{t("adm.setup.disabledTitle")}</b>
              <p>{t("adm.setup.disabledBody")}</p>
              <code className="block">wrangler secret put SETUP_TOKEN</code>
            </div>
          </div>
        </Card>
      );
    }
    return (
      <Card title={t("adm.setup.title")} sub={t("adm.setup.sub")}>
        <form
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(async () => void (await setup({ setup_token: token, name: name.trim(), email: email.trim(), password })));
          }}
        >
          {error && <div className="flash err" role="alert">{error}</div>}
          <Field id="s-token" label={t("adm.setup.token")} hint={t("adm.setup.tokenHint")} error={fields.setup_token}>
            <TextInput id="s-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} error={fields.setup_token} />
          </Field>
          <Field id="s-name" label={t("label.name")} error={fields.name}>
            <TextInput id="s-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
          </Field>
          <Field id="s-email" label={t("label.email")} error={fields.email}>
            <TextInput id="s-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
          </Field>
          <Field id="s-pass" label={t("label.password")} hint={t("adm.password.hint")} error={fields.password}>
            <TextInput id="s-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} />
          </Field>
          <Button className="btn-gold btn-block" type="submit" busy={busy}>
            {t("adm.setup.create")}
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card title={t("adm.login.title")} sub={t("adm.login.sub")}>
      <form
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(async () => void (await login(email.trim(), password)));
        }}
      >
        {error && <div className="flash err" role="alert">{error}</div>}
        <Field id="l-email" label={t("label.email")} error={fields.email}>
          <TextInput id="l-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
        </Field>
        <Field id="l-pass" label={t("label.password")} error={fields.password}>
          <TextInput id="l-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} />
        </Field>
        <Button className="btn-gold btn-block" type="submit" busy={busy}>
          {t("btn.login")}
        </Button>
      </form>
    </Card>
  );
}

/** A teammate with a temporary password must choose their own before anything else is reachable. */
export function ForcePasswordChange() {
  const { t } = useI18n();
  const { refresh, logout } = useAuth();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const { busy, error, fields, run } = useAction();
  return (
    <Card title={t("adm.force.title")} sub={t("adm.force.sub")}>
      <form
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(async () => {
            await adm("/auth/change-password", { json: { current: cur, next } });
            await refresh();
          });
        }}
      >
        {error && <div className="flash err" role="alert">{error}</div>}
        <Field id="c-cur" label={t("adm.force.current")} error={fields.current}>
          <TextInput id="c-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} error={fields.current} />
        </Field>
        <Field id="c-new" label={t("adm.force.new")} hint={t("adm.password.hint")} error={fields.next}>
          <TextInput id="c-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={fields.next} />
        </Field>
        <div className="row">
          <Button className="btn-gold" type="submit" busy={busy}>
            {t("btn.save")}
          </Button>
          <Button className="btn-ghost" onClick={() => void logout()}>
            {t("btn.logout")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
