import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, ErrorState, Field, Icon, IconButton, PageHeader, Panel, Select, SlideOver, Spinner, Switch, TextArea, TextInput, useConfirm, useToast } from "../components/ui";
import { DataTable } from "../components/DataTable";

interface Knowledge {
  id: number;
  question: string;
  answer: string;
  lang: "bn" | "en" | "any";
  active: number;
  used: number;
  escalation_id: number | null;
  updated_at: string;
}

/**
 * What the chatbot was taught: each a question and the team's answer. Most come from Messages → Chatbot hand-offs ("Teach the chatbot");
 * one can be added here by hand too, changed, switched off or deleted. The chatbot gives a taught answer word for word when someone asks
 * the same thing, and reads the closest ones as approved facts otherwise.
 */
function TaughtAnswers({ canWrite }: { canWrite: boolean }) {
  const { t, err, date, num } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<Knowledge> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["/chatbot/knowledge"] });

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setErrors({});
    try {
      const body = { question: edit.question ?? "", answer: edit.answer ?? "", lang: edit.lang ?? "any", active: edit.active !== 0 };
      await adm(edit.id ? `/chatbot/knowledge/${edit.id}` : "/chatbot/knowledge", { method: edit.id ? "PUT" : "POST", json: body });
      toast(t("adm.saved"));
      setEdit(null);
      refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, err(v)])));
      toast(err(e instanceof ApiError ? (Object.values(e.fields ?? {})[0] ?? e.code) : "generic"), true);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (k: Knowledge) => {
    try {
      await adm(`/chatbot/knowledge/${k.id}`, { method: "PUT", json: { active: !k.active } });
      refresh();
    } catch (e) {
      toast(err(e instanceof ApiError ? e.code : "generic"), true);
    }
  };
  const remove = async (k: Knowledge) => {
    const r = await confirm({ title: t("adm.taught.deleteTitle"), body: k.question, danger: true, confirmLabel: t("btn.delete") });
    if (!r.ok) return;
    try {
      await adm(`/chatbot/knowledge/${k.id}`, { method: "DELETE" });
      toast(t("adm.deleted"));
      refresh();
    } catch (e) {
      toast(err(e instanceof ApiError ? e.code : "generic"), true);
    }
  };

  return (
    <Panel
      title={t("adm.taught.title")}
      actions={
        canWrite ? (
          <Button className="btn-outline btn-sm" onClick={() => setEdit({ lang: "any", active: 1 })}>
            <Icon name="plus" /> {t("adm.taught.add")}
          </Button>
        ) : undefined
      }
    >
      <p className="muted">{t("adm.taught.sub")}</p>
      <DataTable<Knowledge>
        endpoint="/chatbot/knowledge"
        searchPlaceholder={t("btn.search")}
        filters={[{ key: "active", label: t("label.status"), options: [{ value: "1", label: t("adm.taught.on") }, { value: "0", label: t("adm.taught.off") }] }]}
        emptyTitle={t("adm.taught.empty")}
        onRowClick={canWrite ? (k) => setEdit(k) : undefined}
        columns={[
          { key: "q", label: t("adm.handoff.question"), render: (k) => (<span className="cell-title"><b>{k.question}</b><small className="clip wrap">{k.answer}</small></span>) },
          { key: "lang", label: t("adm.handoff.forLang"), desktopOnly: true, render: (k) => (k.lang === "any" ? t("adm.handoff.langAny") : k.lang === "bn" ? "বাংলা" : "English") },
          { key: "used", label: t("adm.taught.used"), desktopOnly: true, render: (k) => num(k.used) },
          { key: "date", label: t("label.date"), desktopOnly: true, render: (k) => date(k.updated_at) },
          { key: "active", label: t("label.status"), render: (k) => (k.active ? <Chip tone="ok">{t("adm.taught.on")}</Chip> : <Chip>{t("adm.taught.off")}</Chip>) },
        ]}
        rowActions={
          canWrite
            ? (k) => (
                <div className="row nowrap">
                  <IconButton icon={k.active ? "pause" : "play"} label={k.active ? t("adm.taught.turnOff") : t("adm.taught.turnOn")} onClick={() => void toggle(k)} />
                  <IconButton icon="trash" label={t("btn.delete")} onClick={() => void remove(k)} />
                </div>
              )
            : undefined
        }
      />
      <SlideOver
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit?.id ? t("adm.taught.edit") : t("adm.taught.add")}
        footer={
          <Button className="btn-primary" busy={busy} onClick={save}>
            {t("btn.save")}
          </Button>
        }
      >
        {edit && (
          <div className="stack">
            <Field id="kn-q" label={t("adm.handoff.question")} hint={t("adm.taught.questionHint")} error={errors.question}>
              <TextArea id="kn-q" rows={2} maxLength={500} value={edit.question ?? ""} error={errors.question} onChange={(e) => setEdit({ ...edit, question: e.target.value })} />
            </Field>
            <Field id="kn-a" label={t("adm.handoff.answer")} hint={t("adm.handoff.answerHint")} error={errors.answer}>
              <TextArea id="kn-a" rows={6} maxLength={2000} value={edit.answer ?? ""} error={errors.answer} onChange={(e) => setEdit({ ...edit, answer: e.target.value })} />
            </Field>
            <Field id="kn-lang" label={t("adm.handoff.forLang")}>
              <Select id="kn-lang" value={edit.lang ?? "any"} onChange={(e) => setEdit({ ...edit, lang: e.target.value as Knowledge["lang"] })}>
                <option value="any">{t("adm.handoff.langAny")}</option>
                <option value="bn">বাংলা</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Switch checked={edit.active !== 0} onChange={(v) => setEdit({ ...edit, active: v ? 1 : 0 })} label={t("adm.taught.on")} />
          </div>
        )}
      </SlideOver>
    </Panel>
  );
}

interface Provider {
  provider: "workers_ai" | "gemini";
  label: string;
  enabled: boolean;
  is_active: boolean;
  model: string;
  temperature: number;
  max_tokens: number;
  configured: boolean;
  key_source: "admin" | "secret" | "binding" | "none";
  key_hint: string | null;
  needs_key: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_detail: string | null;
}
interface ChatbotData {
  providers: Provider[];
  chat_enabled: boolean;
  open_escalations: number;
  messages_today: number;
}
interface ChatSettings {
  enabled: boolean;
  greeting_bn: string;
  greeting_en: string;
  faq_bn: string;
  faq_en: string;
}

function ProviderCard({ p, canWrite, onChange }: { p: Provider; canWrite: boolean; onChange: () => void }) {
  const { t, err, dateTime, num } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [model, setModel] = useState(p.model);
  const [temp, setTemp] = useState(p.temperature);
  const [tokens, setTokens] = useState(p.max_tokens);
  const [key, setKey] = useState("");
  const [keyErr, setKeyErr] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    setModel(p.model);
    setTemp(p.temperature);
    setTokens(p.max_tokens);
  }, [p.model, p.temperature, p.max_tokens]);

  const run = async (name: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(name);
    try {
      await fn();
      if (ok) toast(ok);
      onChange();
    } catch (e) {
      // say exactly what is wrong (the key's shape, the model's name…), next to the box and in the message — never only "check the fields"
      const field = e instanceof ApiError ? Object.values(e.fields ?? {})[0] : undefined;
      if (e instanceof ApiError && e.fields?.api_key) setKeyErr(err(e.fields.api_key));
      toast(field ? err(field) : err(e instanceof ApiError ? e.code : "generic"), true);
    } finally {
      setBusy("");
    }
  };
  const base = `/chatbot/providers/${p.provider}`;
  const probe = async () => {
    const r = await adm<{ result: { ok: boolean; detail: string } }>(`${base}/test`, { json: {} });
    toast(r.result.ok ? t("adm.chat.testOk") : `${t("adm.chat.testFail")}: ${r.result.detail}`, !r.result.ok);
  };
  const test = () => run("test", probe);
  // a pasted key is saved, then tried at once, so the owner sees straight away whether it works
  const saveKey = async () => {
    setKeyErr("");
    await adm(`${base}/key`, { method: "PUT", json: { api_key: key } });
    setKey("");
    toast(t("adm.chat.keySaved"));
    await probe();
  };

  return (
    <section className={`provider${p.is_active ? " active" : ""}`}>
      <header>
        <div>
          <h3>
            <Icon name="bot" /> {p.label}
          </h3>
          <div className="row">
            {p.is_active ? <Chip tone="ok">{t("adm.chat.active")}</Chip> : <Chip>{t("adm.chat.standby")}</Chip>}
            {p.configured ? <Chip tone="ok">{t("adm.chat.connected")}</Chip> : <Chip tone="warn">{t("adm.chat.notConnected")}</Chip>}
            {p.last_test_ok !== null && (
              <Chip tone={p.last_test_ok ? "ok" : "bad"}>
                {t("adm.chat.lastTest")}: {p.last_test_ok ? "✓" : "✗"} {p.last_test_at ? dateTime(p.last_test_at) : ""}
              </Chip>
            )}
          </div>
          {p.last_test_ok === false && p.last_test_detail && <p className="err-text">{p.last_test_detail}</p>}
        </div>
        {canWrite && !p.is_active && (
          <Button className="btn-primary" busy={busy === "activate"} disabled={!p.configured} onClick={() => run("activate", () => adm(`${base}/activate`, { json: {} }), t("adm.chat.activated"))}>
            {t("adm.chat.makeActive")}
          </Button>
        )}
      </header>

      <div className="form-grid">
        <Field id={`${p.provider}-model`} label={t("adm.chat.model")} hint={t("adm.chat.modelHint")}>
          <TextInput id={`${p.provider}-model`} value={model} disabled={!canWrite} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field id={`${p.provider}-temp`} label={t("adm.chat.temperature", { n: num(temp) })} hint={t("adm.chat.temperatureHint")}>
          <input id={`${p.provider}-temp`} type="range" min={0} max={1.5} step={0.1} value={temp} disabled={!canWrite} onChange={(e) => setTemp(Number(e.target.value))} />
        </Field>
        <Field id={`${p.provider}-tokens`} label={t("adm.chat.maxTokens")} hint={t("adm.chat.maxTokensHint")}>
          <TextInput id={`${p.provider}-tokens`} type="number" min={50} max={4000} value={String(tokens)} disabled={!canWrite} onChange={(e) => setTokens(Number(e.target.value) || 0)} />
        </Field>
      </div>

      {p.needs_key ? (
        <div className="key-box">
          <b>{t("adm.chat.apiKey")}</b>
          <p className="hint">{p.key_source === "admin" ? t("adm.chat.keySavedAdmin", { hint: p.key_hint ?? "" }) : p.key_source === "secret" ? t("adm.chat.keySavedSecret", { hint: p.key_hint ?? "" }) : t("adm.chat.keyMissing")}</p>
          {canWrite && (
            <div className="row nowrap">
              <TextInput
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("adm.chat.keyPlaceholder")}
                value={key}
                error={keyErr || undefined}
                aria-describedby={keyErr ? `${p.provider}-key-err` : undefined}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyErr("");
                }}
                aria-label={t("adm.chat.apiKey")}
              />
              <Button className="btn-outline" busy={busy === "key"} disabled={!key.trim()} onClick={() => run("key", saveKey)}>
                {t("btn.save")}
              </Button>
              {p.key_source === "admin" && (
                <Button
                  className="btn-ghost"
                  onClick={async () => {
                    const r = await confirm({ title: t("adm.chat.removeKeyTitle"), body: t("adm.chat.removeKeyBody"), danger: true, confirmLabel: t("btn.delete") });
                    if (r.ok) void run("rmkey", () => adm(`${base}/key`, { method: "DELETE" }), t("adm.deleted"));
                  }}
                >
                  {t("btn.delete")}
                </Button>
              )}
            </div>
          )}
          {keyErr && (
            <p className="err-text" id={`${p.provider}-key-err`} role="alert">
              {keyErr}
            </p>
          )}
          <p className="hint">{t("adm.chat.keyNote")}</p>
        </div>
      ) : (
        <p className="hint">{t("adm.chat.noKeyNeeded")}</p>
      )}

      {canWrite && (
        <div className="row">
          <Button
            className="btn-dark"
            busy={busy === "save"}
            onClick={() =>
              run("save", async () => {
                await adm(base, { method: "PUT", json: { enabled: true, model: model.trim(), temperature: Math.round(temp * 10) / 10, max_tokens: tokens } });
                // a key typed in the box is saved with the rest — one Save does it all
                if (p.needs_key && key.trim()) await saveKey();
                else toast(t("adm.saved"));
              })
            }
          >
            {t("btn.save")}
          </Button>
          <Button className="btn-outline" busy={busy === "test"} disabled={!p.configured} onClick={test}>
            <Icon name="refresh" /> {t("adm.chat.test")}
          </Button>
        </div>
      )}
    </section>
  );
}

export function Chatbot() {
  const { t, num } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can("chatbot:write");
  const data = useQuery({ queryKey: ["chatbot"], queryFn: () => adm<ChatbotData>("/chatbot") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => adm<{ settings: { chatbot: ChatSettings } }>("/settings") });
  const [content, setContent] = useState<ChatSettings | null>(null);
  useEffect(() => {
    if (settings.data) setContent(settings.data.settings.chatbot);
  }, [settings.data]);

  const saveContent = useMutation({
    mutationFn: () => adm("/settings/chatbot", { method: "PUT", json: content }),
    onSuccess: () => {
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["chatbot"] });
      void qc.invalidateQueries({ queryKey: ["health"] });
    },
    onError: () => toast(t("err.validation"), true),
  });

  if (data.isPending) return <Spinner />;
  if (data.isError) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["chatbot"] });
    void qc.invalidateQueries({ queryKey: ["health"] });
  };

  return (
    <>
      <PageHeader title={t("adm.nav.chatbot")} sub={t("adm.chat.sub")} />
      <div className="kpis small">
        <div className="kpi">
          <span className="kpi-ico">
            <Icon name="chat" />
          </span>
          <span className="kpi-body">
            <small>{t("adm.chat.today")}</small>
            <b>{num(data.data.messages_today)}</b>
          </span>
        </div>
        <Link className="kpi" to="/messages?tab=handoffs">
          <span className={`kpi-ico ${data.data.open_escalations > 0 ? "warn" : ""}`}>
            <Icon name="inbox" />
          </span>
          <span className="kpi-body">
            <small>{t("adm.chat.handoffs")}</small>
            <b>{num(data.data.open_escalations)}</b>
          </span>
        </Link>
      </div>

      <TaughtAnswers canWrite={can("messages:write")} />

      <Panel title={t("adm.chat.providers")}>
        <p className="muted">{t("adm.chat.providersSub")}</p>
        {data.data.providers.map((p) => (
          <ProviderCard key={p.provider} p={p} canWrite={canWrite} onChange={refresh} />
        ))}
      </Panel>

      {content && (
        <Panel title={t("adm.chat.content")}>
          <div className="form-grid">
            <div className="field wide">
              <Switch checked={content.enabled} disabled={!can("settings:write")} onChange={(v) => setContent({ ...content, enabled: v })} label={t("adm.chat.enabled")} />
              <p className="hint">{t("adm.chat.enabledHint")}</p>
            </div>
            <Field id="cg-bn" label={t("adm.chat.greetingBn")}>
              <TextInput id="cg-bn" value={content.greeting_bn} maxLength={300} disabled={!can("settings:write")} onChange={(e) => setContent({ ...content, greeting_bn: e.target.value })} />
            </Field>
            <Field id="cg-en" label={t("adm.chat.greetingEn")}>
              <TextInput id="cg-en" value={content.greeting_en} maxLength={300} disabled={!can("settings:write")} onChange={(e) => setContent({ ...content, greeting_en: e.target.value })} />
            </Field>
            <Field id="cf-bn" label={t("adm.chat.faqBn")} hint={t("adm.chat.faqHint")}>
              <TextArea id="cf-bn" rows={8} maxLength={6000} disabled={!can("settings:write")} value={content.faq_bn} onChange={(e) => setContent({ ...content, faq_bn: e.target.value })} />
            </Field>
            <Field id="cf-en" label={t("adm.chat.faqEn")}>
              <TextArea id="cf-en" rows={8} maxLength={6000} disabled={!can("settings:write")} value={content.faq_en} onChange={(e) => setContent({ ...content, faq_en: e.target.value })} />
            </Field>
          </div>
          {can("settings:write") && (
            <Button className="btn-primary" busy={saveContent.isPending} onClick={() => saveContent.mutate()}>
              {t("btn.save")}
            </Button>
          )}
          <div className="notice mt">
            <Icon name="shield" />
            <div>
              <b>{t("adm.chat.honestTitle")}</b>
              <p>{t("adm.chat.honestBody")}</p>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
