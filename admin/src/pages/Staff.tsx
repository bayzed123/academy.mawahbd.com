import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLES, ROLE_LABELS, type Role } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, ErrorState, Field, Icon, PageHeader, Panel, Select, SlideOver, Spinner, TextInput, useConfirm, useFieldErrors, useToast } from "../components/ui";

interface StaffRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: number;
  must_change_password: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

const ROLE_TONE: Record<Role, "gold" | "ok" | "info" | "neutral"> = { super_admin: "gold", content_manager: "ok", support: "info", viewer: "neutral" };

export function Staff() {
  const { t, lang, err, dateTime } = useI18n();
  const { staff: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "support" as Role });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const list = useQuery({ queryKey: ["staff"], queryFn: () => adm<{ items: StaffRow[] }>("/staff") });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["staff"] });
  const fail = (e: unknown) => toast(e instanceof ApiError ? (e.code === "validation" ? t("err.validation") : err(e.code)) : t("err.generic"), true);

  const create = useMutation({
    mutationFn: () => adm<{ staff: StaffRow; temp_password: string }>("/staff", { json: form }),
    onSuccess: (r) => {
      setOpen(false);
      setSecret({ who: r.staff.name, password: r.temp_password });
      setForm({ name: "", email: "", role: "support" });
      setErrors({});
      refresh();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      fail(e);
    },
  });

  const patch = async (row: StaffRow, body: Partial<{ role: Role; active: boolean }>) => {
    try {
      await adm(`/staff/${row.id}`, { method: "PATCH", json: body });
      toast(t("adm.saved"));
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const reset = async (row: StaffRow) => {
    const r = await confirm({ title: t("adm.staff.resetTitle", { name: row.name }), body: t("adm.staff.resetBody"), confirmLabel: t("adm.staff.reset") });
    if (!r.ok) return;
    try {
      const res = await adm<{ temp_password: string }>(`/staff/${row.id}/reset-password`, { json: {} });
      setSecret({ who: row.name, password: res.temp_password });
      refresh();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <PageHeader
        title={t("adm.nav.staff")}
        sub={t("adm.staff.sub")}
        actions={
          <Button className="btn-gold" onClick={() => setOpen(true)}>
            + {t("adm.staff.add")}
          </Button>
        }
      />
      <Panel title={t("adm.staff.roles")} className="compact">
        <ul className="role-help">
          {ROLES.map((r) => (
            <li key={r}>
              <Chip tone={ROLE_TONE[r]}>{ROLE_LABELS[r][lang]}</Chip> <span>{t(`adm.role.desc.${r}` as "adm.role.desc.super_admin")}</span>
            </li>
          ))}
        </ul>
      </Panel>
      {list.isPending && <Spinner />}
      {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t("label.name")}</th>
                <th>{t("adm.staff.role")}</th>
                <th>{t("label.status")}</th>
                <th className="desk">{t("adm.student.lastLogin")}</th>
                <th className="actions-col" />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((s) => {
                const self = s.id === me?.id;
                return (
                  <tr key={s.id} className={s.active ? "" : "dim"}>
                    <td>
                      <span className="cell-title">
                        <b>
                          {s.name} {self && <Chip>{t("adm.staff.you")}</Chip>}
                        </b>
                        <small>{s.email}</small>
                      </span>
                    </td>
                    <td>
                      <Select aria-label={t("adm.staff.role")} value={s.role} disabled={self} onChange={(e) => patch(s, { role: e.target.value as Role })}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r][lang]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      {s.active ? <Chip tone="ok">{t("status.active")}</Chip> : <Chip tone="bad">{t("adm.staff.inactive")}</Chip>}
                      {s.must_change_password ? <Chip tone="warn">{t("adm.staff.mustChange")}</Chip> : null}
                    </td>
                    <td className="desk muted">{s.last_login_at ? dateTime(s.last_login_at) : "—"}</td>
                    <td className="actions-col">
                      {!self && (
                        <div className="row nowrap">
                          <Button className="btn-outline" onClick={() => reset(s)}>
                            {t("adm.staff.reset")}
                          </Button>
                          <Button className={s.active ? "btn-danger" : "btn-outline"} onClick={() => patch(s, { active: !s.active })}>
                            {s.active ? t("adm.staff.deactivate") : t("adm.staff.activate")}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title={t("adm.staff.add")}
        footer={
          <div className="row end">
            <Button className="btn-ghost" onClick={() => setOpen(false)}>
              {t("btn.cancel")}
            </Button>
            <Button className="btn-gold" busy={create.isPending} onClick={() => create.mutate()}>
              {t("adm.staff.create")}
            </Button>
          </div>
        }
      >
        <div className="form-grid">
          <Field id="st-name" label={`${t("label.name")} *`} error={errors.name} wide>
            <TextInput id="st-name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field id="st-email" label={`${t("label.email")} *`} error={errors.email} wide>
            <TextInput id="st-email" type="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field id="st-role" label={t("adm.staff.role")} hint={t(`adm.role.desc.${form.role}` as "adm.role.desc.super_admin")} wide>
            <Select id="st-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r][lang]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="hint">{t("adm.staff.tempHint")}</p>
      </SlideOver>

      {secret && (
        <div className="overlay mid">
          <div className="dialog" role="alertdialog" aria-modal="true">
            <h2>{t("adm.staff.tempTitle", { name: secret.who })}</h2>
            <p>{t("adm.staff.tempBody")}</p>
            <code className="secret">{secret.password}</code>
            <div className="row end">
              <Button
                className="btn-outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(secret.password);
                    toast(t("adm.copied"));
                  } catch {
                    /* clipboard blocked */
                  }
                }}
              >
                <Icon name="download" /> {t("btn.copy")}
              </Button>
              <Button className="btn-gold" onClick={() => setSecret(null)}>
                {t("adm.staff.gotIt")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
