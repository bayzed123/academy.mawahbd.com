import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
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
      setFields(fieldErrors(e));
      if (!(e instanceof ApiError && e.code === "validation")) toast(err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });
  if (!student || student.has_password) return null;
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
