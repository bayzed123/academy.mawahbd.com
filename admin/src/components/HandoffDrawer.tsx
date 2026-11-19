import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { waNumber } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button, Chip, Field, Icon, KV, Select, SlideOver, Spinner, StatusChip, Switch, TextArea, useToast } from "./ui";

interface Handoff {
  id: number;
  question: string;
  reason: string;
  lang: "bn" | "en";
  status: string;
  created_at: string;
  asked: number;
  last_asked_at: string | null;
  answer: string | null;
  answered_at: string | null;
  course_title_en: string | null;
  course_title_bn: string | null;
  course_slug: string | null;
  student: { id: number; code: string; name: string | null; email: string | null; phone: string | null } | null;
  taught: { id: number; question: string; answer: string; lang: string; active: number } | null;
}

/**
 * One question the chatbot could not answer, opened: what was asked (and how often), by whom, about which class; the team writes the
 * right answer — or starts from one the AI suggests from the academy's own facts — and saves it. Saved with "Teach the chatbot" on, the
 * chatbot gives that answer itself the next time anyone asks.
 */
export function HandoffDrawer({ id, onClose, canWrite }: { id: number | null; onClose: () => void; canWrite: boolean }) {
  const { t, err, pick, dateTime, num } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const item = useQuery({ queryKey: ["escalation", id], enabled: id !== null, queryFn: async () => (await adm<{ item: Handoff }>(`/escalations/${id}`)).item });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [lang, setLang] = useState<"bn" | "en" | "any">("any");
  const [teach, setTeach] = useState(true);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [fieldErr, setFieldErr] = useState("");

  useEffect(() => {
    const h = item.data;
    if (!h) return;
    setQuestion(h.taught?.question ?? h.question);
    setAnswer(h.taught?.answer ?? h.answer ?? "");
    setLang((h.taught?.lang as "bn" | "en" | "any") ?? h.lang);
    setTeach(true);
    setNote("");
    setFieldErr("");
  }, [item.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["/escalations"] });
    void qc.invalidateQueries({ queryKey: ["escalation", id] });
    void qc.invalidateQueries({ queryKey: ["/chatbot/knowledge"] });
    void qc.invalidateQueries({ queryKey: ["badges"] });
  };

  const suggest = async () => {
    setBusy("suggest");
    setNote("");
    try {
      const r = await adm<{ answer: string; grounded: boolean }>(`/escalations/${id}/suggest`, { json: {} });
      if (r.grounded && r.answer) {
        setAnswer(r.answer);
        setNote(t("adm.handoff.suggested"));
      } else setNote(t("adm.handoff.noFacts"));
    } catch (e) {
      setNote(err(e instanceof ApiError ? e.code : "generic"));
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setBusy("save");
    setFieldErr("");
    try {
      await adm(`/escalations/${id}/answer`, { json: { answer, question, lang, teach } });
      toast(teach ? t("adm.handoff.taught") : t("adm.handoff.answered"));
      refresh();
      onClose();
    } catch (e) {
      const f = e instanceof ApiError ? (e.fields?.answer ?? e.fields?.question) : undefined;
      if (f) setFieldErr(err(f));
      toast(f ? err(f) : err(e instanceof ApiError ? e.code : "generic"), true);
    } finally {
      setBusy("");
    }
  };

  const reopen = async (status: "open" | "handled") => {
    setBusy(status);
    try {
      await adm(`/escalations/${id}/status`, { json: { status } });
      refresh();
      toast(t("adm.saved"));
    } catch (e) {
      toast(err(e instanceof ApiError ? e.code : "generic"), true);
    } finally {
      setBusy("");
    }
  };

  const h = item.data;
  const reply = answer.trim() ? `${answer.trim()}\n\n— MAWAH Academy` : "";
  const wa = h?.student?.phone ? waNumber(h.student.phone) : null;

  return (
    <SlideOver
      open={id !== null}
      onClose={onClose}
      title={t("adm.handoff.title")}
      wide
      footer={
        canWrite && h ? (
          <div className="row">
            <Button className="btn-primary" busy={busy === "save"} disabled={answer.trim().length < 2} onClick={save}>
              <Icon name={teach ? "sparkle" : "check"} /> {teach ? t("adm.handoff.saveTeach") : t("adm.handoff.save")}
            </Button>
            {h.status === "open" ? (
              <Button className="btn-ghost" busy={busy === "handled"} onClick={() => reopen("handled")}>
                {t("adm.messages.markHandled")}
              </Button>
            ) : (
              <Button className="btn-ghost" busy={busy === "open"} onClick={() => reopen("open")}>
                {t("adm.messages.reopen")}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {item.isPending || !h ? (
        <Spinner />
      ) : (
        <div className="stack handoff">
          <blockquote className="handoff-q" lang={h.lang}>
            {h.question}
          </blockquote>
          <div className="row">
            <StatusChip status={h.status} />
            <Chip tone={h.asked > 1 ? "warn" : "neutral"}>{t("adm.handoff.asked", { n: num(h.asked) })}</Chip>
            <Chip>{t(`adm.escalation.${h.reason}` as "adm.escalation.low_confidence")}</Chip>
            {h.taught?.active ? <Chip tone="ok">{t("adm.handoff.isTaught")}</Chip> : null}
          </div>
          <KV
            items={[
              { label: t("adm.handoff.when"), value: dateTime(h.last_asked_at ?? h.created_at) },
              { label: t("adm.handoff.lang"), value: h.lang === "bn" ? "বাংলা" : "English" },
              { label: t("adm.nav.courses"), value: h.course_title_en ? pick({ a_bn: h.course_title_bn ?? "", a_en: h.course_title_en }, "a") : t("adm.messages.general") },
              {
                label: t("adm.handoff.who"),
                value: h.student ? (
                  <span className="cell-title">
                    <b>
                      {h.student.name} · {h.student.code}
                    </b>
                    <small>{[h.student.email, h.student.phone].filter(Boolean).join(" · ")}</small>
                  </span>
                ) : (
                  t("adm.handoff.visitor")
                ),
              },
            ]}
          />

          {canWrite ? (
            <>
              <Field id="ho-q" label={t("adm.handoff.question")} hint={t("adm.handoff.questionHint")}>
                <TextArea id="ho-q" rows={2} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} />
              </Field>
              <Field id="ho-a" label={t("adm.handoff.answer")} hint={t("adm.handoff.answerHint")} error={fieldErr || undefined}>
                <TextArea id="ho-a" rows={6} maxLength={2000} value={answer} error={fieldErr || undefined} onChange={(e) => setAnswer(e.target.value)} />
              </Field>
              <div className="row">
                <Button className="btn-outline btn-sm" busy={busy === "suggest"} onClick={suggest}>
                  <Icon name="sparkle" /> {t("adm.handoff.suggest")}
                </Button>
                {note && (
                  <p className="hint" role="status">
                    {note}
                  </p>
                )}
              </div>
              <div className="form-grid">
                <div className="field">
                  <Switch checked={teach} onChange={setTeach} label={t("adm.handoff.teach")} />
                  <p className="hint">{t("adm.handoff.teachHint")}</p>
                </div>
                {teach && (
                  <Field id="ho-lang" label={t("adm.handoff.forLang")}>
                    <Select id="ho-lang" value={lang} onChange={(e) => setLang(e.target.value as "bn" | "en" | "any")}>
                      <option value="any">{t("adm.handoff.langAny")}</option>
                      <option value="bn">বাংলা</option>
                      <option value="en">English</option>
                    </Select>
                  </Field>
                )}
              </div>
            </>
          ) : (
            h.answer && (
              <div>
                <b>{t("adm.handoff.answer")}</b>
                <p className="pre-wrap">{h.answer}</p>
              </div>
            )
          )}

          {h.student && reply && (
            <div className="row">
              {h.student.email && (
                <a className="btn btn-outline btn-sm" href={`mailto:${h.student.email}?subject=${encodeURIComponent("MAWAH Academy")}&body=${encodeURIComponent(reply)}`}>
                  <Icon name="mail" /> {t("adm.handoff.replyEmail")}
                </a>
              )}
              {wa && (
                <a className="btn btn-outline btn-sm" href={`https://wa.me/${wa}?text=${encodeURIComponent(reply)}`} target="_blank" rel="noopener noreferrer">
                  <Icon name="whatsapp" /> {t("adm.handoff.replyWa")}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </SlideOver>
  );
}
