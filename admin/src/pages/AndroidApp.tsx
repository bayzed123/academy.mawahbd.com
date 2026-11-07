import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { AppNotifications, type PushOverview } from "../components/AppNotifications";
import { CourseStateChip } from "../components/CourseState";
import { Button, Empty, ErrorState, Field, Icon, KV, Kpi, PageHeader, Panel, Spinner, Switch, TextArea, useConfirm, useFieldErrors, useToast } from "../components/ui";

interface AppClass {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  status: "draft" | "coming_soon" | "published" | "archived";
  lesson_count: number;
  students: number;
}
interface AppOverview {
  push: PushOverview;
  classes: AppClass[];
  numbers: { days: number; sign_ins: number; sign_ups: number; joins: number; learners: number };
  notice: { notice_on: boolean; notice_bn: string; notice_en: string };
  review_account: { id: number; code: string; blocked: boolean; last_login_at: string | null; password_set_at: string; classes: number } | null;
}
interface ReviewSecret {
  code: string;
  password: string;
  created: boolean;
}

/**
 * Admin → Android app. The app's free classes (a class becomes one in its editor: "Where is this class shown?" → Android app only), how
 * much the app is used, its notifications, the notice at the top of its Home, and the test account Google Play's reviewers sign in with.
 */
export function AndroidApp() {
  const { t, pick, num, lang } = useI18n();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["android-app"], queryFn: () => adm<AppOverview>("/app") });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const n = d.numbers;

  return (
    <>
      <PageHeader
        title={t("adm.nav.app")}
        sub={t("adm.app.sub")}
        actions={
          can("courses:write") ? (
            <Link className="btn btn-primary btn-sm" to="/courses/new?channel=app">
              <Icon name="plus" /> {t("adm.app.add")}
            </Link>
          ) : undefined
        }
      />

      <section className="kpis" aria-label={t("adm.app.numbers", { days: num(n.days) })}>
        <Kpi icon="user" label={t("adm.app.signIns")} value={num(n.sign_ins)} sub={t("adm.app.numbers", { days: num(n.days) })} />
        <Kpi icon="users" label={t("adm.app.signUps")} value={num(n.sign_ups)} sub={t("adm.app.numbers", { days: num(n.days) })} />
        <Kpi icon="play" label={t("adm.app.joins")} value={num(n.joins)} sub={t("adm.app.numbers", { days: num(n.days) })} />
        <Kpi icon="book" label={t("adm.app.learners")} value={num(n.learners)} sub={t("adm.app.learnersSub")} />
      </section>

      <Panel title={t("adm.app.classes")}>
        <p className="muted">{t("adm.app.classesSub")}</p>
        {d.classes.length === 0 ? (
          <Empty icon="phone" title={t("adm.app.none")}>
            <p>{t("adm.app.noneBody")}</p>
          </Empty>
        ) : (
          <ul className="app-classes">
            {d.classes.map((c) => (
              <li key={c.id}>
                <Link to={`/courses/${c.id}`} className="cell-title">
                  <b>{pick(c, "title")}</b>
                  <small>
                    {t("adm.app.lessons", { n: num(c.lesson_count) })} · {t("adm.app.students", { n: num(c.students) })}
                  </small>
                </Link>
                <CourseStateChip status={c.status} />
                {can("courses:write") && (
                  <Link className="icon-btn" to={`/courses/${c.id}/edit`} aria-label={`${t("btn.edit")} — ${pick(c, "title")}`} title={t("btn.edit")}>
                    <Icon name="edit" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <AppNotifications push={d.push} />

      <div className="grid-2">
        <Panel title={t("adm.app.notice")}>
          <NoticeForm notice={d.notice} />
        </Panel>
        <Panel title={t("adm.app.review")}>
          <ReviewAccount account={d.review_account} lang={lang} />
        </Panel>
      </div>
    </>
  );
}

/** The notice at the top of the app's Home: saved like any other setting (PUT /settings/app). */
function NoticeForm({ notice }: { notice: AppOverview["notice"] }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const fieldErrors = useFieldErrors();
  const canWrite = can("settings:write");
  const [on, setOn] = useState(notice.notice_on);
  const [bn, setBn] = useState(notice.notice_bn);
  const [en, setEn] = useState(notice.notice_en);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setOn(notice.notice_on);
    setBn(notice.notice_bn);
    setEn(notice.notice_en);
  }, [notice]);

  const save = useMutation({
    mutationFn: () => adm("/settings/app", { method: "PUT", json: { notice_on: on, notice_bn: bn.trim(), notice_en: en.trim() } }),
    onSuccess: () => {
      setErrors({});
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["android-app"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast(e instanceof ApiError && e.code === "validation" ? t("err.validation") : t("err.generic"), true);
    },
  });

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        save.mutate();
      }}
      noValidate
    >
      <p className="muted">{t("adm.app.noticeSub")}</p>
      <div className="stack">
        <Switch id="app-notice-on" checked={on} disabled={!canWrite} onChange={setOn} label={t("adm.app.noticeOn")} />
      </div>
      <Field id="app-notice-bn" label={t("adm.app.noticeBn")} error={errors.notice_bn}>
        <TextArea id="app-notice-bn" rows={2} maxLength={240} value={bn} error={errors.notice_bn} disabled={!canWrite} onChange={(e) => setBn(e.target.value)} />
      </Field>
      <Field id="app-notice-en" label={t("adm.app.noticeEn")} error={errors.notice_en}>
        <TextArea id="app-notice-en" rows={2} maxLength={240} value={en} error={errors.notice_en} disabled={!canWrite} onChange={(e) => setEn(e.target.value)} />
      </Field>
      <div className="row">
        <Button className="btn-primary" type="submit" busy={save.isPending} disabled={!canWrite}>
          {t("btn.save")}
        </Button>
        {!canWrite && <span className="hint">{t("adm.app.readonly")}</span>}
      </div>
    </form>
  );
}

/**
 * The account Google Play's reviewers sign in with. Its password is shown once, right after it is made: it is stored as a hash like every
 * other, so a lost one is replaced with a new one (which also signs the account out everywhere).
 */
function ReviewAccount({ account, lang }: { account: AppOverview["review_account"]; lang: "bn" | "en" }) {
  const { t, err, num } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const canWrite = can("settings:write");
  const [secret, setSecret] = useState<ReviewSecret | null>(null);
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

  const make = useMutation({
    mutationFn: () => adm<ReviewSecret>("/app/review-account", { method: "POST", json: {} }),
    onSuccess: (r) => {
      setSecret(r);
      void qc.invalidateQueries({ queryKey: ["android-app"] });
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  const onMake = async () => {
    if (account) {
      const res = await confirm({ title: t("adm.app.reviewResetTitle"), body: t("adm.app.reviewResetBody"), confirmLabel: t("adm.app.reviewReset") });
      if (!res.ok) return;
    }
    make.mutate();
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("adm.copied"));
    } catch {
      /* clipboard blocked: the text is on screen to copy by hand */
    }
  };

  return (
    <>
      <p className="muted">{t("adm.app.reviewSub")}</p>
      {account ? (
        <KV
          items={[
            { label: t("adm.app.reviewId"), value: <code>{account.code}</code> },
            { label: t("adm.app.reviewSet"), value: when(account.password_set_at) },
            { label: t("adm.app.reviewLast"), value: account.last_login_at ? when(account.last_login_at) : t("adm.app.reviewNever") },
            { label: t("adm.app.reviewClasses"), value: num(account.classes) },
          ]}
        />
      ) : (
        <p>{t("adm.app.reviewNone")}</p>
      )}
      {account?.blocked && <p className="warn-text">{t("adm.app.reviewBlocked")}</p>}

      {secret && (
        <div className="notice ok-note review-secret" aria-live="polite">
          <Icon name="lock" />
          <div>
            <KV
              items={[
                {
                  label: t("adm.app.reviewId"),
                  value: (
                    <span className="row">
                      <code className="secret">{secret.code}</code>
                      <Button className="btn-outline" onClick={() => void copy(secret.code)}>
                        {t("adm.app.copy")}
                      </Button>
                    </span>
                  ),
                },
                {
                  label: t("adm.app.reviewPassword"),
                  value: (
                    <span className="row">
                      <code className="secret">{secret.password}</code>
                      <Button className="btn-outline" onClick={() => void copy(secret.password)}>
                        {t("adm.app.copy")}
                      </Button>
                    </span>
                  ),
                },
              ]}
            />
            <p>
              <b>{t("adm.app.reviewShownOnce")}</b>
            </p>
            <p>{t("adm.app.reviewSteps")}</p>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <Button className={account ? "btn-outline" : "btn-primary"} busy={make.isPending} disabled={!canWrite} onClick={() => void onMake()}>
          <Icon name={account ? "refresh" : "plus"} /> {account ? t("adm.app.reviewReset") : t("adm.app.reviewMake")}
        </Button>
        {account && can("students:read") && (
          <Link className="btn btn-ghost btn-sm" to={`/students?q=${encodeURIComponent(account.code)}`}>
            {t("adm.app.openStudent")}
          </Link>
        )}
        {!canWrite && <span className="hint">{t("adm.app.readonly")}</span>}
      </div>
    </>
  );
}
