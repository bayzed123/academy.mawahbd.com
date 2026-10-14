import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";

/* ----------------------------------------------------------------------------------------------- icons */
export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <use href={`/sprite.svg#i-${name}`} />
    </svg>
  );
}

/* --------------------------------------------------------------------------------------------- buttons */
export function Button({ busy, children, className = "btn-emerald", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button type="button" {...rest} className={`btn btn-sm ${className}`} aria-busy={busy || undefined} disabled={rest.disabled || busy}>
      {busy && <span className="spinner sm" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button type="button" {...rest} className={`icon-btn ${rest.className ?? ""}`} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

/* ---------------------------------------------------------------------------------------------- fields */
export function Field({ label, error, hint, id, children, wide }: { label: string; error?: string; hint?: string; id: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`field${wide ? " wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
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

type WithError<T> = T & { error?: string };
const invalid = (id: string | undefined, error?: string) => ({ "aria-invalid": error ? true : undefined, "aria-describedby": error && id ? `${id}-err` : undefined });

export const TextInput = ({ error, ...rest }: WithError<InputHTMLAttributes<HTMLInputElement>>) => <input {...rest} className={`input ${rest.className ?? ""}`} {...invalid(rest.id, error)} />;
export const TextArea = ({ error, ...rest }: WithError<TextareaHTMLAttributes<HTMLTextAreaElement>>) => <textarea {...rest} className={`input ${rest.className ?? ""}`} {...invalid(rest.id, error)} />;
export const Select = ({ error, ...rest }: WithError<SelectHTMLAttributes<HTMLSelectElement>>) => <select {...rest} className={`input ${rest.className ?? ""}`} {...invalid(rest.id, error)} />;

export function Switch({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string; disabled?: boolean }) {
  const auto = useId();
  const sid = id ?? auto;
  return (
    <label className="switch" htmlFor={sid}>
      <input id={sid} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

/* ------------------------------------------------------------------------------------- status & badges */
export function Chip({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info" | "gold"; children: ReactNode }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, "neutral" | "ok" | "warn" | "bad" | "info" | "gold"> = {
  published: "ok", paid: "ok", approved: "ok", active: "ok", answered: "ok", handled: "ok", up: "ok",
  coming_soon: "gold", pending: "warn", awaiting_verification: "warn", open: "warn", new: "warn", draft: "neutral",
  failed: "bad", cancelled: "bad", refunded: "bad", rejected: "bad", revoked: "bad", hidden: "bad", archived: "neutral",
};

export function StatusChip({ status }: { status: string }) {
  const { tx } = useI18n();
  return <Chip tone={STATUS_TONE[status] ?? "neutral"}>{tx(`status.${status}`, status)}</Chip>;
}

/* ------------------------------------------------------------------------------------------ loading etc. */
export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;

export function Empty({ icon = "book", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h3>{title}</h3>
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
      <h3>{err(code)}</h3>
      {onRetry && (
        <Button className="btn-outline" onClick={onRetry}>
          {t("btn.tryAgain")}
        </Button>
      )}
    </div>
  );
}

export function useFieldErrors() {
  const { err, t } = useI18n();
  return useCallback(
    (e: unknown): Record<string, string> => {
      if (!(e instanceof ApiError) || !e.fields) return {};
      const out: Record<string, string> = {};
      for (const [k, code] of Object.entries(e.fields)) out[k] = code === "required" ? t("err.required") : err(code === "invalid" ? "validation" : code);
      return out;
    },
    [err, t],
  );
}

/* ------------------------------------------------------------------------------------------------ toast */
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
    // the same message twice in a row replaces the earlier one instead of stacking duplicates
    setItems((x) => [...x.filter((i) => i.text !== text || !!i.bad !== !!bad).slice(-3), { id, text, bad }]);
    window.setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), bad ? 7000 : 4500);
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

/* -------------------------------------------------------------------------------------------- slide-over */
export function SlideOver({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        // keep keyboard focus inside the drawer
        const f = panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    window.setTimeout(() => panel.current?.querySelector<HTMLElement>("input,select,textarea,button.close")?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={`slide${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <h2 id={titleId}>{title}</h2>
          <IconButton className="close" icon="x" label={t("btn.close")} onClick={onClose} />
        </header>
        <div className="slide-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ confirm box */
interface ConfirmOpts {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** ask for a typed reason (refunds, blocking …) — passed back to the caller */
  reason?: { label: string; required?: boolean };
}
type Ask = (o: ConfirmOpts) => Promise<{ ok: boolean; reason: string }>;
const ConfirmCtx = createContext<Ask>(async () => ({ ok: false, reason: "" }));
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<(ConfirmOpts & { resolve: (r: { ok: boolean; reason: string }) => void }) | null>(null);
  const [reason, setReason] = useState("");
  const ask = useCallback<Ask>((o) => new Promise((resolve) => { setReason(""); setState({ ...o, resolve }); }), []);
  const close = (ok: boolean) => {
    state?.resolve({ ok, reason: reason.trim() });
    setState(null);
  };
  const needs = !!state?.reason?.required && reason.trim().length === 0;
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <div className="overlay mid" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label={state.title}>
            <h2>{state.title}</h2>
            {state.body && <p>{state.body}</p>}
            {state.reason && (
              <Field id="confirm-reason" label={state.reason.label}>
                <TextArea id="confirm-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </Field>
            )}
            <div className="row end">
              <Button className="btn-ghost" onClick={() => close(false)}>
                {t("btn.cancel")}
              </Button>
              <Button className={state.danger ? "btn-danger" : "btn-emerald"} disabled={needs} onClick={() => close(true)}>
                {state.confirmLabel ?? t("btn.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

/* ---------------------------------------------------------------------------------------- small blocks */
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" aria-selected={tab.value === value} className={tab.value === value ? "on" : ""} onClick={() => onChange(tab.value)}>
          {tab.label}
          {tab.count ? <span className="count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Panel({ title, actions, children, className = "" }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Progress({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <i style={{ "--p": `${Math.max(0, Math.min(100, pct))}%` } as CSSProperties} />
    </div>
  );
}

export function PageHeader({ title, sub, actions, back }: { title: string; sub?: string; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {back}
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function KV({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv-grid">
      {items.map((i) => (
        <div key={i.label}>
          <dt>{i.label}</dt>
          <dd>{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}
