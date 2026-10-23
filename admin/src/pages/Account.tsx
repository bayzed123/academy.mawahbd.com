import { useState, type FormEvent } from "react";
import { ROLE_LABELS } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Field, KV, PageHeader, Panel, TextInput, useFieldErrors, useToast } from "../components/ui";

/**
 * Every team member's own account: who they are signed in as, and changing their own password — the owner's too, which nobody else can
 * reset (Team → Reset password is for the others). Other devices are signed out; this one stays signed in.
 */
export function Account() {
  const { t, err, lang } = useI18n();
  const { staff } = useAuth();
  const toast = useToast();
  const fieldErrors = useFieldErrors();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFields({});
    setError("");
    const missing: Record<string, string> = {};
    if (!current) missing.current = t("err.required");
    if (!next) missing.next = t("err.required");
    if (Object.keys(missing).length) {
      setFields(missing);
      document.getElementById(missing.current ? "me-cur" : "me-new")?.focus();
      return;
    }
    setBusy(true);
    try {
      await adm("/auth/change-password", { json: { current, next } });
      setCurrent("");
      setNext("");
      toast(t("adm.account.changed"));
    } catch (x) {
      const f = fieldErrors(x);
      // a wrong current password is said about that box ("wrong e-mail or password" would be the sign-in screen's words)
      if (x instanceof ApiError && x.fields?.current === "invalid_credentials") f.current = t("adm.account.wrongCurrent");
      setFields(f);
      setError(x instanceof ApiError ? (["validation", "invalid_credentials"].includes(x.code) ? "" : err(x.code)) : err("generic"));
      document.getElementById(f.current ? "me-cur" : "me-new")?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t("adm.account.title")} sub={t("adm.account.sub")} />
      <Panel title={t("adm.account.who")}>
        <KV
          items={[
            { label: t("label.name"), value: staff?.name },
            { label: t("label.email"), value: staff?.email },
            { label: t("adm.staff.role"), value: staff ? ROLE_LABELS[staff.role][lang] : undefined },
          ]}
        />
      </Panel>
      <Panel title={t("adm.account.password")}>
        <form onSubmit={submit} noValidate className="form-grid account-form">
          {error && (
            <div className="flash err" role="alert">
              {error}
            </div>
          )}
          <Field id="me-cur" label={t("adm.account.current")} error={fields.current}>
            <TextInput id="me-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={fields.current} />
          </Field>
          <Field id="me-new" label={t("adm.account.new")} hint={t("adm.account.newHint")} error={fields.next}>
            <TextInput id="me-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={fields.next} />
          </Field>
          <Button className="btn-primary" type="submit" busy={busy}>
            {t("adm.account.save")}
          </Button>
        </form>
      </Panel>
    </>
  );
}
