import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, Field, Icon, Panel, Select, Switch, TextArea, TextInput, useConfirm, useFieldErrors, useToast } from "./ui";

/** How Firebase can say no (worker/src/lib/fcm.ts PushProblem): each has a title and a body in adm.push.p.* */
export type PushProblem = string;

export interface PushSend {
  id: number;
  kind: "manual" | "new_class" | "new_lessons";
  course_id: number | null;
  audience: "all" | "class";
  title_bn: string;
  title_en: string;
  body_bn: string;
  body_en: string;
  path: string;
  status: "sent" | "failed";
  problem: PushProblem | null;
  staff_name: string | null;
  course_title_bn: string | null;
  course_title_en: string | null;
  created_at: string;
}

export interface PushOverview {
  ready: boolean;
  problem: PushProblem | null;
  project: string | null;
  account: string | null;
  phones: number;
  signed_in: number;
  auto: { new_class: boolean; new_lessons: boolean };
  choices: { id: number; title_bn: string; title_en: string; channel: "website" | "app"; has_demo: number }[];
  recent: PushSend[];
}

type Check = { connected: true; project: string; account: string } | { connected: false; problem: PushProblem; detail: string | null };

const EMPTY = { title_bn: "", body_bn: "", title_en: "", body_en: "" };

/**
 * Admin → Android app → Notifications: whether they are set up (and a check that asks Google), how many phones get them, the two that go out
 * by themselves, staff's own (to everyone or to one class's students), and what went out lately.
 */
export function AppNotifications({ push }: { push: PushOverview }) {
  const { t, err, num, pick, dateTime } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const canSend = can("courses:publish");
  const canSwitch = can("settings:write");

  const [checked, setChecked] = useState<Check | null>(null);
  const [audience, setAudience] = useState<"all" | "class">("all");
  const [courseId, setCourseId] = useState<number | null>(null);
  const [text, setText] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const refresh = () => void qc.invalidateQueries({ queryKey: ["android-app"] });

  const check = useMutation({
    mutationFn: () => adm<Check>("/app/push/check", { method: "POST", json: {} }),
    onSuccess: setChecked,
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  const auto = useMutation({
    mutationFn: (next: PushOverview["auto"]) => adm("/settings/push", { method: "PUT", json: next }),
    onSuccess: () => {
      toast(t("adm.saved"));
      refresh();
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  const send = useMutation({
    mutationFn: () => adm<{ send: PushSend }>("/app/push", { method: "POST", json: { audience, course_id: courseId, ...text } }),
    onSuccess: ({ send: s }) => {
      setErrors({});
      if (s.status === "sent") {
        toast(t("adm.push.sentOk"));
        setText(EMPTY);
      } else toast(t("adm.push.sentFailed", { why: t(`adm.push.p.${s.problem ?? "other"}.title` as "adm.push.p.other.title") }), true);
      refresh();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true);
    },
  });

  // for everyone, a tap can open only what the app shows: its own free classes, and a website class's free demo
  const choices = push.choices.filter((c) => audience === "class" || c.channel === "app" || !!c.has_demo);
  const chosen = push.choices.find((c) => c.id === courseId);
  const onAudience = (a: "all" | "class") => {
    setAudience(a);
    if (a === "all" && chosen && chosen.channel !== "app" && !chosen.has_demo) setCourseId(null);
  };
  const onSend = async () => {
    const body = audience === "all" ? t("adm.push.confirmAll", { n: num(push.phones) }) : t("adm.push.confirmClass", { class: chosen ? pick(chosen, "title") : "—" });
    const res = await confirm({ title: t("adm.push.confirmTitle"), body, confirmLabel: t("adm.push.sendNow") });
    if (res.ok) send.mutate();
  };

  // what is wrong, if anything: the last check's answer, or what the website can tell without asking Google
  const shown = checked && !checked.connected ? { problem: checked.problem, detail: checked.detail } : !push.ready ? { problem: push.problem ?? "not_configured", detail: null } : null;
  const disabled = !push.ready || !canSend;
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setText((v) => ({ ...v, [k]: e.target.value }));

  return (
    <Panel
      title={t("adm.push.title")}
      actions={
        canSend && push.ready ? (
          <Button className="btn-outline" busy={check.isPending} onClick={() => check.mutate()}>
            <Icon name="refresh" /> {t("adm.push.check")}
          </Button>
        ) : undefined
      }
    >
      <p className="muted">{t("adm.push.sub")}</p>

      {shown ? (
        <div className="notice bad-note" role="status">
          <Icon name="bell" />
          <div>
            <b>{t(`adm.push.p.${shown.problem}.title` as "adm.push.p.other.title")}</b>
            <p>{t(`adm.push.p.${shown.problem}.body` as "adm.push.p.other.body")}</p>
            {shown.detail ? (
              <p className="said">
                {t("adm.an.said")}: <q>{shown.detail}</q>
              </p>
            ) : null}
            {shown.problem === "not_configured" ? <p>{t("adm.push.guide")}</p> : null}
          </div>
        </div>
      ) : (
        <div className="notice ok-note" role="status">
          <Icon name="check" />
          <div>
            <b>{t("adm.push.ready", { project: push.project ?? "—" })}</b>
            {checked?.connected ? <p>{t("adm.push.checkOk")}</p> : null}
          </div>
        </div>
      )}

      <div className="push-count">
        <Icon name="phone" />
        <div>
          <b>
            {num(push.phones)} · {t("adm.push.phones")}
          </b>
          <small>{t("adm.push.phonesSub", { n: num(push.signed_in) })}</small>
        </div>
      </div>

      <h3>{t("adm.push.auto")}</h3>
      <div className="stack">
        <Switch id="push-auto-class" checked={push.auto.new_class} disabled={!canSwitch || auto.isPending} onChange={(v) => auto.mutate({ ...push.auto, new_class: v })} label={t("adm.push.autoNewClass")} />
        <Switch id="push-auto-lessons" checked={push.auto.new_lessons} disabled={!canSwitch || auto.isPending} onChange={(v) => auto.mutate({ ...push.auto, new_lessons: v })} label={t("adm.push.autoNewLessons")} />
      </div>
      {!canSwitch && <p className="hint">{t("adm.app.readonly")}</p>}

      <h3>{t("adm.push.send")}</h3>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void onSend();
        }}
        noValidate
      >
        <div className="form-grid push-form">
          <Field id="push-audience" label={t("adm.push.audience")} wide>
            <div className="segmented" role="radiogroup" aria-label={t("adm.push.audience")}>
              {(["all", "class"] as const).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={audience === a} className={audience === a ? "on" : ""} disabled={disabled} onClick={() => onAudience(a)}>
                  <Icon name={a === "all" ? "users" : "book"} /> {t(a === "all" ? "adm.push.audienceAll" : "adm.push.audienceClass")}
                </button>
              ))}
            </div>
          </Field>
          <Field id="push-course" label={audience === "all" ? t("adm.push.courseOpens") : t("adm.push.course")} hint={audience === "all" ? t("adm.push.courseHint") : undefined} error={errors.course_id} wide>
            <Select id="push-course" value={courseId ?? ""} error={errors.course_id} disabled={disabled} onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : null)}>
              {audience === "all" ? <option value="">{t("adm.push.courseHome")}</option> : <option value="">—</option>}
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c, "title")}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="push-title-bn" label={t("adm.push.titleBn")} error={errors.title_bn}>
            <TextInput id="push-title-bn" value={text.title_bn} maxLength={65} error={errors.title_bn} disabled={disabled} onChange={set("title_bn")} />
          </Field>
          <Field id="push-title-en" label={t("adm.push.titleEn")} error={errors.title_en}>
            <TextInput id="push-title-en" value={text.title_en} maxLength={65} error={errors.title_en} disabled={disabled} onChange={set("title_en")} />
          </Field>
          <Field id="push-body-bn" label={t("adm.push.bodyBn")} error={errors.body_bn}>
            <TextArea id="push-body-bn" rows={3} value={text.body_bn} maxLength={240} error={errors.body_bn} disabled={disabled} onChange={set("body_bn")} />
          </Field>
          <Field id="push-body-en" label={t("adm.push.bodyEn")} error={errors.body_en}>
            <TextArea id="push-body-en" rows={3} value={text.body_en} maxLength={240} error={errors.body_en} disabled={disabled} onChange={set("body_en")} />
          </Field>
        </div>
        <p className="hint">{t("adm.push.lengthHint")}</p>
        <div className="row">
          <Button className="btn-primary" type="submit" busy={send.isPending} disabled={disabled}>
            <Icon name="bell" /> {t("adm.push.sendNow")}
          </Button>
          {!canSend && <span className="hint">{t("adm.push.readonly")}</span>}
        </div>
      </form>

      <h3>{t("adm.push.recent")}</h3>
      {push.recent.length === 0 ? (
        <p className="muted">{t("adm.push.none")}</p>
      ) : (
        <ul className="push-sends">
          {push.recent.map((s) => (
            <li key={s.id}>
              <div className="cell-title">
                <b>{pick(s, "title")}</b>
                <small>{pick(s, "body")}</small>
                <small className="muted">
                  {dateTime(s.created_at)} · {t(`adm.push.kind.${s.kind}` as "adm.push.kind.manual")} ·{" "}
                  {s.audience === "all" ? t("adm.push.toAll") : t("adm.push.toClass", { class: s.course_title_en ? pick({ title_bn: s.course_title_bn ?? "", title_en: s.course_title_en }, "title") : "—" })} ·{" "}
                  {s.staff_name ? t("adm.push.by", { name: s.staff_name }) : t("adm.push.byAuto")}
                </small>
              </div>
              {s.status === "sent" ? (
                <Chip tone="ok">{t("adm.push.sentChip")}</Chip>
              ) : (
                <span title={t(`adm.push.p.${s.problem ?? "other"}.title` as "adm.push.p.other.title")}>
                  <Chip tone="bad">{t("status.failed")}</Chip>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
