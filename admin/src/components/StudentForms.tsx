import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PAST_METHODS, studentCode } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { CourseRow, ListResponse } from "../lib/types";
import { Button, Chip, ErrorState, Field, Icon, Select, SlideOver, Spinner, Switch, TextArea, TextInput, useFieldErrors, useToast } from "./ui";

/** Today in Bangladesh (UTC+6) as YYYY-MM-DD — the latest day a class or a payment can be dated. */
export const dhakaToday = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

/** Every class that can be opened for a person (drafts and coming-soon too: the team may open any class by hand). */
export function useClassOptions() {
  return useQuery({ queryKey: ["course-options"], queryFn: () => adm<ListResponse<CourseRow>>("/courses?per_page=100&sort=title_en"), staleTime: 60_000 });
}

/* ================================================================================================ classes, date and payment */
export interface AccessValue {
  classIds: number[];
  /** the day they really joined (empty = today) */
  since: string;
  pay: boolean;
  amount: string;
  method: string;
  txn: string;
  /** the day they really paid (empty = the day they joined) */
  paidOn: string;
}
export const emptyAccess = (): AccessValue => ({ classIds: [], since: "", pay: false, amount: "", method: "bkash", txn: "", paidOn: "" });

/** The request fields for "these classes, from this day, and this payment". */
export function accessPayload(v: AccessValue) {
  const amount = Number(v.amount.replace(/[^\d]/g, ""));
  return {
    course_ids: v.classIds,
    ...(v.since ? { enrolled_on: v.since } : {}),
    payment: v.pay && v.amount.trim() ? { amount, method: v.method, txn_id: v.txn.trim(), ...(v.paidOn ? { paid_on: v.paidOn } : {}) } : null,
  };
}

/**
 * Tick the classes this person has, say from which day, and whether (and how much) they paid. The same block is used when a student
 * is added and when a class is opened for one who exists. `have` = classes they already have (shown, not tickable).
 */
export function AccessFields({ value, onChange, have = [], errors = {} }: { value: AccessValue; onChange: (v: AccessValue) => void; have?: number[]; errors?: Record<string, string> }) {
  const { t, pick, money } = useI18n();
  const classes = useClassOptions();
  const [search, setSearch] = useState("");
  const owned = useMemo(() => new Set(have), [have]);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (classes.data?.items ?? []).filter((c) => !needle || `${c.title_en} ${c.title_bn} ${c.slug}`.toLowerCase().includes(needle));
  }, [classes.data, search]);
  const sum = useMemo(() => (classes.data?.items ?? []).filter((c) => value.classIds.includes(c.id)).reduce((a, c) => a + c.price, 0), [classes.data, value.classIds]);
  const toggle = (id: number) => onChange({ ...value, classIds: value.classIds.includes(id) ? value.classIds.filter((x) => x !== id) : [...value.classIds, id] });
  const today = dhakaToday();

  return (
    <>
      <fieldset className="class-pick">
        <legend>{t("adm.stu.classes")}</legend>
        <p className="hint">{t("adm.stu.classesHelp")}</p>
        {classes.isPending && <Spinner />}
        {classes.isError && <ErrorState error={classes.error} onRetry={() => classes.refetch()} />}
        {classes.data && (
          <>
            <TextInput aria-label={t("adm.stu.classSearch")} placeholder={t("adm.stu.classSearch")} value={search} onChange={(e) => setSearch(e.target.value)} />
            <ul className="class-list">
              {shown.length === 0 && <li className="muted">{t("adm.stu.classNone")}</li>}
              {shown.map((c) => {
                const has = owned.has(c.id);
                const id = `cp-${c.id}`;
                return (
                  <li key={c.id}>
                    <label htmlFor={id} className={has ? "muted" : undefined}>
                      <input id={id} type="checkbox" checked={has || value.classIds.includes(c.id)} disabled={has} onChange={() => toggle(c.id)} />
                      <span>
                        {pick(c, "title")} <small className="muted">· {c.price === 0 ? t("label.free") : money(c.price)}</small>
                      </span>
                      {has && <Chip tone="ok">{t("adm.stu.has")}</Chip>}
                    </label>
                  </li>
                );
              })}
            </ul>
            {value.classIds.length > 0 && (
              <p className="hint" aria-live="polite">
                {t("adm.stu.picked", { n: value.classIds.length })}
              </p>
            )}
          </>
        )}
        {errors.course_ids && (
          <p className="err-text" role="alert">
            {errors.course_ids}
          </p>
        )}
      </fieldset>

      {value.classIds.length > 0 && (
        <>
          <Field id="ac-since" label={t("adm.stu.since")} hint={t("adm.stu.sinceHint")} error={errors.enrolled_on}>
            <TextInput id="ac-since" type="date" max={today} value={value.since} error={errors.enrolled_on} onChange={(e) => onChange({ ...value, since: e.target.value })} />
          </Field>

          <div className="pay-block">
            <Switch id="ac-pay" checked={value.pay} onChange={(on) => onChange({ ...value, pay: on })} label={t("adm.stu.pay")} />
            <p className="hint">{t("adm.stu.payHelp")}</p>
            {value.pay && (
              <>
                <Field id="ac-amount" label={t("adm.stu.payAmount")} hint={t("adm.stu.payAmountHint", { sum: money(sum) })} error={errors["payment.amount"]}>
                  <TextInput id="ac-amount" inputMode="numeric" value={value.amount} error={errors["payment.amount"]} onChange={(e) => onChange({ ...value, amount: e.target.value })} />
                </Field>
                <Field id="ac-method" label={t("adm.stu.payMethod")}>
                  <Select id="ac-method" value={value.method} onChange={(e) => onChange({ ...value, method: e.target.value })}>
                    {PAST_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(`adm.stu.method.${m}` as "adm.stu.method.bkash")}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="ac-txn" label={t("adm.stu.payTxn")} hint={t("adm.stu.payTxnHint")} error={errors["payment.txn_id"]}>
                  <TextInput id="ac-txn" autoComplete="off" value={value.txn} error={errors["payment.txn_id"]} onChange={(e) => onChange({ ...value, txn: e.target.value })} />
                </Field>
                <Field id="ac-paid" label={t("adm.stu.payDate")} hint={t("adm.stu.payDateHint")} error={errors["payment.paid_on"]}>
                  <TextInput id="ac-paid" type="date" max={today} value={value.paidOn} error={errors["payment.paid_on"]} onChange={(e) => onChange({ ...value, paidOn: e.target.value })} />
                </Field>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ================================================================================================ a way in */
/**
 * A student added by hand has no password. Two ways to let them in: an e-mail with a link to choose one, or the link itself for the team
 * to send on WhatsApp / Messenger. Neither shows or sets a password — whoever has the link chooses it.
 */
export function InviteBox({ studentId, name, hasPassword }: { studentId: number; name: string; hasPassword: boolean }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const [link, setLink] = useState<{ url: string; days: number } | null>(null);
  const mail = useMutation({
    mutationFn: () => adm<{ sent: boolean; days: number }>(`/students/${studentId}/invite`, { json: { mode: "email" } }),
    onSuccess: (r) => toast(r.sent ? t("adm.stu.inviteSent", { days: r.days }) : t("adm.stu.inviteNotSent"), !r.sent),
    onError: (e) => toast(err(e instanceof ApiError ? e.code : "generic"), true),
  });
  const getLink = useMutation({
    mutationFn: () => adm<{ link: string; days: number }>(`/students/${studentId}/invite`, { json: { mode: "link" } }),
    onSuccess: (r) => setLink({ url: r.link, days: r.days }),
    onError: (e) => toast(err(e instanceof ApiError ? e.code : "generic"), true),
  });
  if (hasPassword) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link!.url);
      toast(t("adm.stu.linkCopied"));
    } catch {
      document.getElementById("invite-link")?.focus();
    }
  };
  return (
    <div className="notice">
      <Icon name="lock" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p>{t("adm.stu.noPassword")}</p>
        <div className="row">
          <Button className="btn-outline" busy={mail.isPending} onClick={() => mail.mutate()}>
            <Icon name="mail" /> {t("adm.stu.inviteMail")}
          </Button>
          <Button className="btn-outline" busy={getLink.isPending} onClick={() => getLink.mutate()}>
            <Icon name="link" /> {t("adm.stu.inviteLink")}
          </Button>
        </div>
        {link && (
          <div className="invite-link" role="region" aria-label={t("adm.stu.linkTitle", { name })}>
            <b>{t("adm.stu.linkTitle", { name })}</b>
            <p>{t("adm.stu.linkHelp", { days: link.days })}</p>
            <label htmlFor="invite-link">{t("adm.stu.linkLabel")}</label>
            <div className="row nowrap">
              <input id="invite-link" className="input" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" className="btn-primary" onClick={() => void copy()}>
                {t("adm.stu.linkCopy")}
              </Button>
            </div>
            <p className="hint">{t("adm.stu.linkWarn")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================================================ add / change a student */
export interface StudentFormValue {
  name: string;
  email: string;
  phone: string;
  locale: "bn" | "en";
  notes: string;
  marketing: boolean;
}

/** Add a student by hand (with classes and the payment already made), or change one. `onSaved(id)` runs after a save. */
export function StudentFormDrawer({ student, onClose, onSaved, onOpenStudent }: { student?: { id: number } & StudentFormValue; onClose: () => void; onSaved: () => void; onOpenStudent?: (id: number) => void }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const editing = !!student;
  const [v, setV] = useState<StudentFormValue>(student ?? { name: "", email: "", phone: "", locale: "bn", notes: "", marketing: false });
  const [access, setAccess] = useState<AccessValue>(emptyAccess());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [made, setMade] = useState<{ id: number; name: string; email: string } | null>(null);

  const done = () => {
    void qc.invalidateQueries({ queryKey: ["/students"] });
    void qc.invalidateQueries({ queryKey: ["student-detail"] });
    onSaved();
  };
  const save = useMutation({
    mutationFn: async () => {
      const common = { name: v.name.trim(), email: v.email.trim(), phone: v.phone.trim(), locale: v.locale, notes: v.notes.trim(), marketing_opt_in: v.marketing };
      if (editing) return adm(`/students/${student!.id}`, { method: "PATCH", json: common });
      return adm<{ id: number; granted: number }>("/students", { json: { ...common, ...accessPayload(access) } });
    },
    onSuccess: (r) => {
      setErrors({});
      if (editing) {
        toast(t("adm.saved"));
        done();
        onClose();
      } else {
        setMade({ id: (r as { id: number }).id, name: v.name.trim(), email: v.email.trim() });
        done();
      }
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!(e instanceof ApiError && (e.code === "validation" || e.code === "email_taken"))) toast(err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });
  const set = <K extends keyof StudentFormValue>(k: K, val: StudentFormValue[K]) => setV((x) => ({ ...x, [k]: val }));

  if (made) {
    return (
      <SlideOver
        open
        onClose={onClose}
        title={t("adm.stu.new")}
        footer={
          <div className="row end">
            <Button
              className="btn-ghost"
              onClick={() => {
                setMade(null);
                setV({ name: "", email: "", phone: "", locale: "bn", notes: "", marketing: false });
                setAccess(emptyAccess());
              }}
            >
              {t("adm.stu.another")}
            </Button>
            {onOpenStudent && (
              <Button className="btn-primary" onClick={() => onOpenStudent(made.id)}>
                {t("adm.stu.open")}
              </Button>
            )}
          </div>
        }
      >
        <div className="stack">
          <div className="notice ok" role="status">
            <Icon name="check" />
            <div>
              <b>{t("adm.stu.created", { name: made.name })}</b>
              <p>{t("adm.stu.createdBody")}</p>
              <p className="small">
                {t("adm.stu.id")}: <b className="student-code">{studentCode(made.id)}</b>
              </p>
            </div>
          </div>
          <InviteBox studentId={made.id} name={made.name} hasPassword={false} />
        </div>
      </SlideOver>
    );
  }

  return (
    <SlideOver
      open
      onClose={onClose}
      title={editing ? t("adm.stu.edit") : t("adm.stu.new")}
      footer={
        <div className="row end">
          <Button className="btn-ghost" onClick={onClose}>
            {t("btn.cancel")}
          </Button>
          <Button className="btn-primary" busy={save.isPending} onClick={() => save.mutate()}>
            {editing ? t("btn.save") : t("adm.stu.create")}
          </Button>
        </div>
      }
    >
      <div className="stack">
        {!editing && <p className="muted">{t("adm.stu.newSub")}</p>}
        <Field id="sf-name" label={t("label.name")} error={errors.name}>
          <TextInput id="sf-name" autoComplete="off" value={v.name} error={errors.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field id="sf-email" label={t("label.email")} hint={editing ? t("adm.stu.fEmailHint") : undefined} error={errors.email}>
          <TextInput id="sf-email" type="email" inputMode="email" autoComplete="off" value={v.email} error={errors.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field id="sf-phone" label={t("label.phone")} error={errors.phone}>
          <TextInput id="sf-phone" type="tel" inputMode="tel" autoComplete="off" placeholder="01XXXXXXXXX" value={v.phone} error={errors.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field id="sf-lang" label={t("adm.f.language")}>
          <Select id="sf-lang" value={v.locale} onChange={(e) => set("locale", e.target.value as "bn" | "en")}>
            <option value="bn">বাংলা</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field id="sf-notes" label={t("adm.stu.fNote")} hint={t("adm.stu.fNoteHint")} error={errors.notes}>
          <TextArea id="sf-notes" rows={3} maxLength={500} value={v.notes} error={errors.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <Switch id="sf-marketing" checked={v.marketing} onChange={(on) => set("marketing", on)} label={t("adm.stu.fMarketing")} />
        {!editing && <AccessFields value={access} onChange={setAccess} errors={errors} />}
      </div>
    </SlideOver>
  );
}

/* ================================================================================================ open classes for a student who exists */
export function GrantDrawer({ student, have, onClose, onSaved }: { student: { id: number; name: string }; have: number[]; onClose: () => void; onSaved: () => void }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const [access, setAccess] = useState<AccessValue>(emptyAccess());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => adm<{ granted: number; already_had: number }>(`/students/${student.id}/enroll`, { json: accessPayload(access) }),
    onSuccess: (r) => {
      toast(t("adm.stu.granted", { n: r.granted, m: r.already_had }));
      void qc.invalidateQueries({ queryKey: ["/students"] });
      onSaved();
      onClose();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!(e instanceof ApiError && e.code === "validation")) toast(err(e instanceof ApiError ? e.code : "generic"), true);
    },
  });
  return (
    <SlideOver
      open
      onClose={onClose}
      title={t("adm.stu.grantTitle", { name: student.name })}
      footer={
        <div className="row end">
          <Button className="btn-ghost" onClick={onClose}>
            {t("btn.cancel")}
          </Button>
          <Button className="btn-primary" busy={save.isPending} disabled={access.classIds.length === 0} onClick={() => save.mutate()}>
            {t("adm.stu.grantSave")}
          </Button>
        </div>
      }
    >
      <div className="stack">
        <AccessFields value={access} onChange={setAccess} have={have} errors={errors} />
      </div>
    </SlideOver>
  );
}
