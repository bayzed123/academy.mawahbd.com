import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams, Navigate } from "react-router";
import { api, ApiError, safeNext } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useSite } from "../lib/hooks";
import { useI18n } from "../lib/i18n";
import { Button, Field, Icon, TextInput, Turnstile, useFieldErrors } from "../components/ui";

function AuthCard({ title, sub, children, foot }: { title: string; sub?: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
        {children}
        {foot && <div className="auth-foot">{foot}</div>}
      </div>
    </div>
  );
}

function useSubmit() {
  const { err } = useI18n();
  const fieldErrors = useFieldErrors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setFields({});
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setFields(fieldErrors(e));
        setError(e.code === "validation" ? "" : err(e.code));
      } else setError(err("generic"));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, fields, run };
}

/* ---------------------------------------------------------------------------------------------- login */
export function Login() {
  const { t } = useI18n();
  const { student, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next")) ?? "/";
  const site = useSite();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [bump, setBump] = useState(0);
  const { busy, error, fields, run } = useSubmit();

  if (student) return <Navigate to={next} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        await login(email.trim(), password, token || undefined);
        navigate(next, { replace: true });
      } catch (e2) {
        setBump((n) => n + 1);
        throw e2;
      }
    });
  };

  return (
    <AuthCard
      title={t("app.login.title")}
      sub={t("app.login.sub")}
      foot={
        <>
          {t("app.login.noAccount")}{" "}
          <Link className="link" to={`/register${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}>
            {t("btn.register")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div className="flash err" role="alert">
            {error}
          </div>
        )}
        <Field id="email" label={t("label.email")} error={fields.email}>
          <TextInput id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
        </Field>
        <Field id="password" label={t("label.password")} error={fields.password}>
          <TextInput id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} />
        </Field>
        {site.data?.turnstile_site_key && <Turnstile siteKey={site.data.turnstile_site_key} onToken={setToken} resetKey={bump} />}
        <Button className="btn-gold btn-block btn-lg" type="submit" busy={busy}>
          {t("btn.login")}
        </Button>
        <p className="tc small mt">
          <Link className="link" to="/forgot">
            {t("app.login.forgot")}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

/* ------------------------------------------------------------------------------------------- register */
export function Register() {
  const { t, lang } = useI18n();
  const { student, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next")) ?? "/";
  const site = useSite();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", marketing: false });
  const [token, setToken] = useState("");
  const [bump, setBump] = useState(0);
  const { busy, error, fields, run } = useSubmit();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: k === "marketing" ? e.target.checked : e.target.value });

  if (student) return <Navigate to={next} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        await register({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, password: form.password, lang, marketing: form.marketing, turnstile: token || undefined });
        navigate(next, { replace: true });
      } catch (e2) {
        setBump((n) => n + 1);
        throw e2;
      }
    });
  };

  return (
    <AuthCard
      title={t("app.register.title")}
      sub={t("app.register.sub")}
      foot={
        <>
          {t("app.register.haveAccount")}{" "}
          <Link className="link" to={`/login${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}>
            {t("btn.login")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div className="flash err" role="alert">
            {error}
          </div>
        )}
        <Field id="name" label={t("label.name")} error={fields.name}>
          <TextInput id="name" autoComplete="name" required value={form.name} onChange={set("name")} error={fields.name} />
        </Field>
        <Field id="email" label={t("label.email")} error={fields.email}>
          <TextInput id="email" type="email" autoComplete="email" inputMode="email" required value={form.email} onChange={set("email")} error={fields.email} />
        </Field>
        <Field id="phone" label={`${t("label.phone")} (${t("label.optional")})`} error={fields.phone} hint={t("app.register.phoneHint")}>
          <TextInput id="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="01XXXXXXXXX" value={form.phone} onChange={set("phone")} error={fields.phone} />
        </Field>
        <Field id="password" label={t("label.password")} error={fields.password} hint={t("app.register.passwordHint")}>
          <TextInput id="password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set("password")} error={fields.password} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={form.marketing} onChange={set("marketing")} />
          <span>{t("app.register.marketing")}</span>
        </label>
        <div className="mt">
          {site.data?.turnstile_site_key && <Turnstile siteKey={site.data.turnstile_site_key} onToken={setToken} resetKey={bump} />}
          <Button className="btn-gold btn-block btn-lg" type="submit" busy={busy}>
            {t("btn.register")}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}

/* -------------------------------------------------------------------------------------------- forgot */
export function Forgot() {
  const { t, lang } = useI18n();
  const site = useSite();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, fields, run } = useSubmit();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("/auth/forgot", { json: { email: email.trim(), lang, turnstile: token || undefined } });
      setSent(true);
    });
  };

  return (
    <AuthCard title={t("app.forgot.title")} sub={sent ? undefined : t("app.forgot.sub")} foot={<Link className="link" to="/login">{t("btn.back")}</Link>}>
      {sent ? (
        <div className="notice ok">
          <Icon name="mail" />
          <div>
            <b>{t("app.forgot.sentTitle")}</b>
            <p>{t("app.forgot.sentBody")}</p>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          {error && (
            <div className="flash err" role="alert">
              {error}
            </div>
          )}
          <Field id="email" label={t("label.email")} error={fields.email}>
            <TextInput id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
          </Field>
          {site.data?.turnstile_site_key && <Turnstile siteKey={site.data.turnstile_site_key} onToken={setToken} />}
          <Button className="btn-gold btn-block btn-lg" type="submit" busy={busy}>
            {t("app.forgot.send")}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

/* --------------------------------------------------------------------------------------------- reset */
export function Reset() {
  const { t } = useI18n();
  const { token = "" } = useParams();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, fields, run } = useSubmit();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("/auth/reset", { json: { token, password } });
      setDone(true);
    });
  };

  return (
    <AuthCard title={t("app.reset.title")}>
      {done ? (
        <>
          <div className="notice ok">
            <Icon name="check" />
            <div>
              <b>{t("app.reset.done")}</b>
            </div>
          </div>
          <Link className="btn btn-gold btn-block btn-lg" to="/login">
            {t("btn.login")}
          </Link>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          {error && (
            <div className="flash err" role="alert">
              {error === t("err.generic") ? t("app.reset.invalid") : error}
            </div>
          )}
          <Field id="password" label={t("app.reset.newPassword")} error={fields.password} hint={t("app.register.passwordHint")}>
            <TextInput id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} />
          </Field>
          <Button className="btn-gold btn-block btn-lg" type="submit" busy={busy}>
            {t("btn.save")}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
