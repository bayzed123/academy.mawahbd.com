import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";
import type { CourseCardDTO } from "@mawah/shared";
import { ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";

/* ---------------------------------------------------------------- icons (shared SVG sprite served from the site root) */
export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <use href={`/sprite.svg#i-${name}`} />
    </svg>
  );
}

/* ---------------------------------------------------------------- course banner (generated art or uploaded image) */
export function Banner({ course }: { course: Pick<CourseCardDTO, "banner_key" | "icon" | "category"> }) {
  if (course.banner_key) {
    return (
      <div className="banner">
        <img src={`/media/${course.banner_key}`} alt="" width={640} height={400} loading="lazy" decoding="async" />
      </div>
    );
  }
  return (
    <div className="banner banner-art">
      <span className="frame" />
      <Icon name={course.icon ?? course.category?.icon ?? "cake"} />
    </div>
  );
}

export const accentClass = (course: Pick<CourseCardDTO, "category">) => `a-${course.category?.accent ?? "snack"}`;

/* ---------------------------------------------------------------- progress */
export function Progress({ pct, done, label }: { pct: number; done?: boolean; label: string }) {
  return (
    <div className={`progress${done ? " done" : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <i style={{ "--p": `${Math.max(0, Math.min(100, pct))}%` } as CSSProperties} />
    </div>
  );
}

/* ---------------------------------------------------------------- loading / error / empty */
export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;

export function Empty({ icon = "book", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, err } = useI18n();
  const code = error instanceof ApiError ? error.code : "generic";
  return (
    <div className="empty" role="alert">
      <Icon name="shield" />
      <h2>{err(code)}</h2>
      {onRetry && (
        <button className="btn btn-outline" onClick={onRetry}>
          {t("btn.tryAgain")}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- buttons / form fields */
export function Button({ busy, children, className = "btn-primary", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...rest} className={`btn ${className}`} aria-busy={busy || undefined} disabled={rest.disabled || busy}>
      {busy && <span className="spinner sm" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, id, required, children }: { label: string; error?: string; hint?: string; id: string; /** shows the red star of a box that must be filled in */ required?: boolean; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="err-text" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ error, ...rest }: InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return <input {...rest} className="input" aria-invalid={error ? true : undefined} aria-describedby={error && rest.id ? `${rest.id}-err` : undefined} />;
}

/** Translate `{field: code}` from a 422 into messages. Unknown codes fall back to the generic validation text. */
export function useFieldErrors() {
  const { err, t } = useI18n();
  return useCallback(
    (e: unknown): Record<string, string> => {
      if (!(e instanceof ApiError) || !e.fields) return {};
      const out: Record<string, string> = {};
      for (const [k, code] of Object.entries(e.fields)) out[k.replace(/^(manual|details)\./, "")] = code === "required" ? t("err.required") : err(code === "invalid" ? "validation" : code);
      return out;
    },
    [err, t],
  );
}

/* ---------------------------------------------------------------- toasts */
interface Toast {
  id: number;
  text: string;
  bad?: boolean;
}
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, bad?: boolean) => {
    const id = ++seq.current;
    setItems((x) => [...x.filter((i) => i.text !== text || !!i.bad !== !!bad).slice(-2), { id, text, bad }]);
    window.setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast${i.bad ? " bad" : ""}`}>
            <Icon name={i.bad ? "shield" : "check"} />
            {i.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------------------------------------------------------- Cloudflare Turnstile (only when configured) */
declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id: string) => void };
  }
}

let turnstileScript: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  turnstileScript ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile"));
    document.head.appendChild(s);
  });
  return turnstileScript;
}

export function Turnstile({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (t: string) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const { lang } = useI18n();
  useEffect(() => {
    let dead = false;
    loadTurnstile()
      .then(() => {
        if (dead || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          language: lang,
          callback: (t: string) => onToken(t),
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, lang]);
  useEffect(() => {
    if (resetKey && widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, [resetKey]);
  return <div ref={box} className="ts-box" />;
}
