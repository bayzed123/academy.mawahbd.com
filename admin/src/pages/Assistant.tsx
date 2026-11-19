import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { adm, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, Icon, IconButton, PageHeader, Panel, Spinner, TextArea, useToast } from "../components/ui";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const SUGGEST = {
  bn: ["আজ কী কী কাজ বাকি আছে?", "এই সপ্তাহে বিক্রি কেমন হলো?", "চ্যাটবট কোন প্রশ্নগুলোর উত্তর দিতে পারেনি?", "নতুন একটা ক্লাসের জন্য ফেসবুক পোস্ট লিখে দাও", "বাংলা QR চালু বা বন্ধ কোথায় করব?"],
  en: ["What needs my attention today?", "How were sales this week?", "Which questions could the chatbot not answer?", "Write a Facebook post for a new class", "Where do I switch Bangla QR on or off?"],
};

/**
 * The team's private AI assistant: it knows today's numbers (as far as this person's role may see them) and where everything is in the
 * admin, and it writes — posts, notices, replies, class words. The conversation lives only on this screen: nothing is stored, and it
 * never reaches a student.
 */
export function Assistant() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const status = useQuery({ queryKey: ["assistant"], queryFn: () => adm<{ ready: boolean; provider: string | null; model: string | null }>("/assistant") });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, busy]);

  const ask = async (q: string) => {
    const content = q.trim();
    if (!content || busy) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setText("");
    setBusy(true);
    try {
      const r = await adm<{ reply: string }>("/assistant", { json: { messages: next } });
      setTurns([...next, { role: "assistant", content: r.reply }]);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "generic";
      setTurns([...next, { role: "assistant", content: code === "ai_not_configured" ? t("adm.assistant.notReady") : err(code) }]);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast(t("adm.assistant.copied"));
    } catch {
      toast(t("err.generic"), true);
    }
  };

  return (
    <>
      <PageHeader
        title={t("adm.nav.assistant")}
        sub={t("adm.assistant.sub")}
        actions={
          turns.length > 0 ? (
            <Button className="btn-outline btn-sm" onClick={() => setTurns([])}>
              <Icon name="refresh" /> {t("adm.assistant.new")}
            </Button>
          ) : undefined
        }
      />
      {status.isPending ? (
        <Spinner />
      ) : !status.data?.ready ? (
        <Panel>
          <div className="notice">
            <Icon name="bot" />
            <div>
              <b>{t("adm.assistant.notReadyTitle")}</b>
              <p>
                {t("adm.assistant.notReady")} <Link to="/chatbot">{t("adm.nav.chatbot")}</Link>
              </p>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel className="assistant">
          <p className="hint">
            <Icon name="lock" /> {t("adm.assistant.private", { provider: status.data.provider ?? "", model: status.data.model ?? "" })}
          </p>
          <div className="assistant-log" aria-live="polite">
            {turns.length === 0 && (
              <div className="assistant-start">
                <p className="muted">{t("adm.assistant.try")}</p>
                <div className="row">
                  {SUGGEST[lang].map((s) => (
                    <button key={s} type="button" className="chip-btn" onClick={() => void ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                <div className="bubble-text">{m.content}</div>
                {m.role === "assistant" && <IconButton icon="file" label={t("adm.assistant.copy")} onClick={() => void copy(m.content)} />}
              </div>
            ))}
            {busy && (
              <div className="bubble assistant thinking" role="status">
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="vh">{t("adm.assistant.thinking")}</span>
              </div>
            )}
            <div ref={end} />
          </div>
          <form
            className="assistant-ask"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text);
            }}
          >
            <TextArea
              rows={2}
              value={text}
              maxLength={6000}
              aria-label={t("adm.assistant.ask")}
              placeholder={t("adm.assistant.ask")}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void ask(text);
                }
              }}
            />
            <Button className="btn-primary" type="submit" busy={busy} disabled={!text.trim()}>
              <Icon name="arrow" /> {t("adm.assistant.send")}
            </Button>
          </form>
        </Panel>
      )}
    </>
  );
}
