import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CertificateDTO, StudentMe } from "@mawah/shared";
import { track } from "../lib/analytics";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { KeepAccount } from "../components/KeepAccount";
import { Button, Empty, ErrorState, Field, Icon, Spinner, TextInput, useFieldErrors, useToast } from "../components/ui";

/* ------------------------------------------------------------------------------------------- certificates */
export function Certificates() {
  const { t, pick, date, lang } = useI18n();
  const toast = useToast();
  const q = useQuery({ queryKey: ["certificates"], queryFn: async () => (await api<{ certificates: CertificateDTO[] }>("/student/certificates")).certificates });
  const home = lang === "en" ? "/en" : "";
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${home}/verify/${code}`);
      toast(t("app.certs.copied"));
    } catch {
      toast(`${location.origin}${home}/verify/${code}`);
    }
  };
  return (
    <>
      <div className="page-head">
        <h1>{t("app.certs.title")}</h1>
        <p>{t("app.certs.sub")}</p>
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && (
        <Empty icon="award" title={t("app.certs.empty")}>
          <Link className="btn btn-primary" to="/">
            {t("app.nav.learning")}
          </Link>
        </Empty>
      )}
      {q.data?.map((c) => (
        <div className="cert-card" key={c.id}>
          <span className="seal">
            <Icon name="award" />
          </span>
          <div className="grow">
            <h3>{pick(c, "course_title")}</h3>
            <div className="small muted">
              {date(c.issued_at)} · {t("app.certs.code")}: <code>{c.code}</code>
            </div>
            {c.revoked_at && <span className="chip failed">{t("app.certs.revoked")}</span>}
          </div>
          {!c.revoked_at && (
            <div className="row">
              <a className="btn btn-primary btn-sm" href={`${home}/certificate/${c.code}`} target="_blank" rel="noopener noreferrer" onClick={() => track("certificate_view", { course_id: c.course_id })}>
                {t("app.certs.view")}
              </a>
              {/* the certificate's own page does it as soon as it opens: the print window (Save as PDF), or the picture's download */}
              <a className="btn btn-outline btn-sm" href={`${home}/certificate/${c.code}?print=1`} target="_blank" rel="noopener noreferrer">
                <Icon name="download" /> {t("app.certs.pdf")}
              </a>
              <a className="btn btn-outline btn-sm" href={`${home}/certificate/${c.code}?download=png`} target="_blank" rel="noopener noreferrer">
                <Icon name="image" /> {t("app.certs.png")}
              </a>
              <button className="btn btn-outline btn-sm" type="button" onClick={() => copy(c.code)}>
                {t("app.certs.copy")}
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/* ----------------------------------------------------------------------------------------------- profile */
export function Profile() {
  const { t, lang, setLang, err } = useI18n();
  const { student, setStudent } = useAuth();
  const toast = useToast();
  const fieldErrors = useFieldErrors();
  const [name, setName] = useState(student?.name ?? "");
  const [phone, setPhone] = useState(student?.phone ?? "");
  const [address, setAddress] = useState(student?.address ?? "");
  const [newEmail, setNewEmail] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [pwFields, setPwFields] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async () =>
      (await api<{ student: StudentMe }>("/auth/profile", { method: "PATCH", json: { name: name.trim(), phone: phone.trim(), address: address.trim() || undefined, email: newEmail.trim() || undefined, locale: lang } })).student,
    onSuccess: (s) => {
      setStudent(s);
      setNewEmail("");
      setFields({});
      toast(t("app.profile.saved"));
    },
    onError: (e) => {
      setFields(fieldErrors(e));
      if (!(e instanceof ApiError && e.code === "validation")) toast(err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });

  const change = useMutation({
    mutationFn: () => api("/auth/change-password", { json: { current: cur, next } }),
    onSuccess: () => {
      setCur("");
      setNext("");
      setPwFields({});
      toast(t("app.profile.password.changed"));
    },
    onError: (e) => {
      setPwFields(fieldErrors(e));
      if (!(e instanceof ApiError && (e.code === "validation" || e.code === "invalid_credentials"))) toast(err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });

  if (!student) return null;
  const onSave = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const onChange = (e: FormEvent) => {
    e.preventDefault();
    change.mutate();
  };

  return (
    <>
      <div className="page-head">
        <h1>{t("app.profile.title")}</h1>
      </div>
      <form className="panel" onSubmit={onSave} noValidate>
        <h2>{t("app.profile.details")}</h2>
        <Field id="p-name" label={t("label.name")} error={fields.name}>
          <TextInput id="p-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
        </Field>
        <Field id="p-code" label={t("app.account.id")}>
          <input id="p-code" className="input" value={student.code} readOnly />
        </Field>
        {student.email ? (
          <Field id="p-email" label={t("label.email")} hint={t("app.profile.emailNote")}>
            <input id="p-email" className="input" value={student.email} readOnly disabled />
          </Field>
        ) : (
          // a buyer who gave no e-mail can add one (it only ever adds a way in; the number keeps working)
          <Field id="p-email" label={t("app.profile.addEmail")} hint={t("app.profile.addEmailHint")} error={fields.email}>
            <TextInput id="p-email" type="email" inputMode="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} error={fields.email} />
          </Field>
        )}
        <Field id="p-phone" label={t("label.phone")} error={fields.phone}>
          <TextInput id="p-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={fields.phone} />
        </Field>
        <Field id="p-address" label={t("app.profile.address")} error={fields.address}>
          <textarea id="p-address" className="input" rows={2} maxLength={300} autoComplete="street-address" aria-invalid={fields.address ? true : undefined} aria-describedby={fields.address ? "p-address-err" : undefined} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field id="p-lang" label={t("app.profile.language")}>
          <select id="p-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value as "bn" | "en")}>
            <option value="bn">বাংলা</option>
            <option value="en">English</option>
          </select>
        </Field>
        <p className="hint">{t("app.profile.signinNote", { code: student.code })}</p>
        <Button type="submit" className="btn-dark" busy={save.isPending}>
          {t("btn.save")}
        </Button>
      </form>

      {/* an account made at checkout has no password yet: choosing one is the only thing to do here */}
      {!student.has_password && <KeepAccount />}
      {student.has_password && (
      <form className="panel" onSubmit={onChange} noValidate>
        <h2>{t("app.profile.password.title")}</h2>
        <Field id="pw-cur" label={t("app.profile.password.current")} error={pwFields.current}>
          <TextInput id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} error={pwFields.current} />
        </Field>
        <Field id="pw-new" label={t("app.profile.password.new")} error={pwFields.next} hint={t("app.profile.password.hint")}>
          <TextInput id="pw-new" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} error={pwFields.next} />
        </Field>
        <Button type="submit" className="btn-dark" busy={change.isPending} disabled={!cur || next.length < 8}>
          {t("btn.save")}
        </Button>
      </form>
      )}
    </>
  );
}
