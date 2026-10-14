import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Chip, ErrorState, Field, Icon, PageHeader, Panel, Spinner, Switch, TextArea, TextInput, useConfirm, useToast } from "../components/ui";

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
      toast(e instanceof ApiError && e.code === "validation" ? t("err.validation") : err(e instanceof ApiError ? e.code : "generic"), true);
    } finally {
      setBusy("");
    }
  };
  const base = `/chatbot/providers/${p.provider}`;
  const test = () =>
    run("test", async () => {
      const r = await adm<{ result: { ok: boolean; detail: string } }>(`${base}/test`, { json: {} });
      toast(r.result.ok ? t("adm.chat.testOk") : `${t("adm.chat.testFail")}: ${r.result.detail}`, !r.result.ok);
    });

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
          <TextInput id={`${p.provider}-tokens`} type="number" min={50} max={2000} value={String(tokens)} disabled={!canWrite} onChange={(e) => setTokens(Number(e.target.value) || 0)} />
        </Field>
      </div>

      {p.needs_key ? (
        <div className="key-box">
          <b>{t("adm.chat.apiKey")}</b>
          <p className="hint">{p.key_source === "admin" ? t("adm.chat.keySavedAdmin", { hint: p.key_hint ?? "" }) : p.key_source === "secret" ? t("adm.chat.keySavedSecret", { hint: p.key_hint ?? "" }) : t("adm.chat.keyMissing")}</p>
          {canWrite && (
            <div className="row nowrap">
              <TextInput type="password" autoComplete="off" placeholder={t("adm.chat.keyPlaceholder")} value={key} onChange={(e) => setKey(e.target.value)} aria-label={t("adm.chat.apiKey")} />
              <Button
                className="btn-outline"
                busy={busy === "key"}
                disabled={key.trim().length < 20}
                onClick={() =>
                  run("key", async () => {
                    await adm(`${base}/key`, { method: "PUT", json: { api_key: key.trim() } });
                    setKey("");
                  }, t("adm.chat.keySaved"))
                }
              >
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
          <p className="hint">{t("adm.chat.keyNote")}</p>
        </div>
      ) : (
        <p className="hint">{t("adm.chat.noKeyNeeded")}</p>
      )}

      {canWrite && (
        <div className="row">
          <Button className="btn-dark" busy={busy === "save"} onClick={() => run("save", () => adm(base, { method: "PUT", json: { enabled: true, model, temperature: temp, max_tokens: tokens } }), t("adm.saved"))}>
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
