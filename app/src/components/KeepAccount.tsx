import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { StudentMe } from "@mawah/shared";
import { track } from "../lib/analytics";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Field, Icon, TextInput, useFieldErrors, useToast } from "./ui";

/**
 * For a student whose account was made at checkout and has no password yet: their student ID, and a place to choose a password so the
 * classes open on any phone or computer. (The receipt e-mail carries the same chance as a link.) Shows nothing for everyone else.
 */
export function KeepAccount() {
  const { t, err } = useI18n();
  const { student, setStudent } = useAuth();
  const toast = useToast();
  const fieldErrors = useFieldErrors();
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  // the payment may just have given this account a password (sent by text message): ask again, so the page says so instead of asking for one
  const unset = !!student && !student.has_password;
  // (the receipt is sent a moment after the payment: asked again a little later too, until it shows)
  useEffect(() => {
    if (!unset) return;
    void qc.invalidateQueries({ queryKey: ["me"] });
    const timers = [2500, 6000].map((ms) => window.setTimeout(() => void qc.invalidateQueries({ queryKey: ["me"] }), ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [unset, qc]);
  const save = useMutation({
    mutationFn: async () => (await api<{ student: StudentMe }>("/auth/set-password", { json: { password } })).student,
    onSuccess: (s) => {
      setStudent(s);
      track("account_secured"); // a buyer who was signed in at checkout chose a password
      setPassword("");
      setFields({});
      toast(t("app.account.keep.saved"));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "password_already_set") void qc.invalidateQueries({ queryKey: ["me"] });
      setFields(fieldErrors(e));
      if (!(e instanceof ApiError && e.code === "validation")) toast(err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });
  if (!student) return null;
  if (student.has_password) return student.password_sent ? <SentDetails /> : null;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form className="notice keep-account" onSubmit={onSubmit} noValidate aria-labelledby="keep-h">
      <Icon name="lock" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b id="keep-h">{t("app.account.keep.title")}</b>
        <p>{t("app.account.keep.body")}</p>
        <p className="small">
          {t("app.account.id")}: <b className="student-code">{student.code}</b>
        </p>
        <Field id="keep-pw" label={t("app.profile.password.new")} error={fields.password} hint={t("app.register.passwordHint")}>
          <TextInput id="keep-pw" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} />
        </Field>
        <Button type="submit" className="btn-primary" busy={save.isPending} disabled={password.length < 8}>
          {t("app.account.keep.save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * The website made this account's password when the payment arrived and sent it, with the student ID and the sign-in page, by text message
 * (and e-mail): said here too, with the ID and the address to open, for a buyer still inside Facebook or Messenger who will need them in
 * another browser. "Got it" hides it on this phone; it goes for good once the student chooses their own password.
 */
function SentDetails() {
  const { t } = useI18n();
  const { student } = useAuth();
  const key = `mawah_sent_seen_${student?.code ?? ""}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  if (!student || hidden) return null;
  const where = [student.phone ? t("app.account.sent.sms", { phone: student.phone }) : "", student.email ? t("app.account.sent.mail", { email: student.email }) : ""].filter(Boolean).join(t("app.account.sent.and"));
  const login = `${window.location.origin}/app/login`;
  return (
    <section className="notice keep-account" aria-labelledby="sent-h">
      <Icon name="lock" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b id="sent-h">{t("app.account.sent.title")}</b>
        <p>{t("app.account.sent.body", { where })}</p>
        <p className="small">
          {t("app.account.id")}: <b className="student-code">{student.code}</b>
        </p>
        <p className="small">
          {t("app.account.sent.open")} <b className="login-url">{login}</b>
        </p>
        <p className="small">{t("app.account.sent.change")}</p>
        <Button
          className="btn-outline"
          onClick={() => {
            try {
              localStorage.setItem(key, "1");
            } catch {
              /* private mode: it shows again next time */
            }
            setHidden(true);
          }}
        >
          {t("app.account.sent.ok")}
        </Button>
      </div>
    </section>
  );
}
