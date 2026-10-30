import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ADMIN_NAV, ROLE_LABELS, type Permission } from "@mawah/shared";
import { adm, qstring } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { Button, Icon, SlideOver, useDebounced } from "./ui";

const NAV_ICON: Record<string, string> = {
  dashboard: "grid", courses: "book", instructors: "user", orders: "wallet", students: "users", reviews: "star", questions: "chat",
  blog: "edit", coupons: "tag", bundles: "gift", shop: "shop", banners: "image", videos: "video", landing: "layers", faqs: "help", materials: "layers", certificates: "award", signups: "bell", messages: "inbox", chatbot: "bot",
  reports: "chart", analytics: "activity", staff: "shield", settings: "settings", activity: "activity", help: "help",
};

interface Badges {
  orders: number;
  reviews: number;
  questions: number;
  messages: number;
}
const BADGE_FOR: Record<string, keyof Badges> = { orders: "orders", reviews: "reviews", questions: "questions", messages: "messages" };

function useBadges() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["badges"],
    queryFn: () => adm<Badges>("/badges"),
    enabled: can("dashboard:read"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  }).data;
}

/* ----------------------------------------------------------------------------- right panel (search, team, account) */
interface Hit {
  to: string;
  title: string;
  sub: string;
  group: string;
}

function GlobalSearch({ onNavigate }: { onNavigate?: () => void }) {
  const { t, pick } = useI18n();
  const { can } = useAuth();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const hits = useQuery({
    queryKey: ["global-search", q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const out: Hit[] = [];
      const jobs: Promise<void>[] = [];
      if (can("courses:read"))
        jobs.push(adm<{ items: { id: number; title_bn: string; title_en: string; status: string }[] }>(`/courses${qstring({ q, per_page: 4 })}`).then((r) => r.items.forEach((c) => out.push({ group: "adm.nav.courses", to: `/courses/${c.id}`, title: pick(c, "title"), sub: c.status }))));
      if (can("orders:read"))
        jobs.push(adm<{ items: { id: number; public_id: string; invoice_no: string | null; customer_name: string; total: number }[] }>(`/orders${qstring({ q, per_page: 4 })}`).then((r) => r.items.forEach((o) => out.push({ group: "adm.nav.orders", to: `/orders?q=${encodeURIComponent(o.invoice_no ?? o.public_id)}`, title: o.invoice_no ?? o.public_id.slice(0, 10), sub: o.customer_name }))));
      if (can("students:read"))
        jobs.push(adm<{ items: { id: number; name: string; email: string }[] }>(`/students${qstring({ q, per_page: 4 })}`).then((r) => r.items.forEach((s) => out.push({ group: "adm.nav.students", to: `/students?q=${encodeURIComponent(s.email)}`, title: s.name, sub: s.email }))));
      await Promise.all(jobs);
      return out;
    },
  });
  return (
    <div className="gsearch">
      <div className="search">
        <Icon name="search" />
        <input className="input" type="search" placeholder={t("adm.search.global")} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("adm.search.global")} />
      </div>
      {hits.data && hits.data.length === 0 && q.length >= 2 && <p className="hint">{t("label.noResults")}</p>}
      <ul className="hits">
        {hits.data?.map((h, i) => (
          <li key={i}>
            <Link to={h.to} onClick={() => { setText(""); onNavigate?.(); }}>
              <b>{h.title}</b>
              <small>
                {t(h.group as "adm.nav.courses")} · {h.sub}
              </small>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RightPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { staff, logout } = useAuth();
  const navigate = useNavigate();
  const badges = useBadges();
  const online = useQuery({ queryKey: ["presence"], queryFn: () => adm<{ online: { id: number; name: string; role: string; path: string }[] }>("/presence"), refetchInterval: 45_000 });

  const todo = [
    { n: badges?.orders ?? 0, label: t("adm.attn.manual_payments"), to: "/orders?status=awaiting_verification", icon: "wallet" },
    { n: badges?.reviews ?? 0, label: t("adm.attn.reviews_pending"), to: "/reviews?status=pending", icon: "star" },
    { n: badges?.questions ?? 0, label: t("adm.attn.questions_open"), to: "/questions?status=open", icon: "chat" },
    { n: badges?.messages ?? 0, label: t("adm.attn.messages_new"), to: "/messages", icon: "inbox" },
  ].filter((x) => x.n > 0);

  return (
    <div className="rail-in">
      <section>
        <h3>{t("adm.rail.search")}</h3>
        <GlobalSearch onNavigate={onNavigate} />
      </section>
      <section>
        <h3>{t("adm.rail.attention")}</h3>
        {todo.length === 0 ? (
          <p className="hint">{t("adm.rail.allClear")}</p>
        ) : (
          <ul className="todo">
            {todo.map((x) => (
              <li key={x.to}>
                <Link to={x.to} onClick={onNavigate}>
                  <Icon name={x.icon} /> <span>{x.label}</span> <b>{x.n}</b>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>{t("adm.rail.online")}</h3>
        <ul className="online">
          {online.data?.online.map((p) => (
            <li key={p.id}>
              <span className="dot" /> <b>{p.name}</b> <small>{ROLE_LABELS[p.role as keyof typeof ROLE_LABELS]?.[lang] ?? p.role}</small>
            </li>
          ))}
        </ul>
      </section>
      <section className="account">
        <h3>{t("adm.rail.account")}</h3>
        <div className="me">
          <span className="avatar-sm">{(staff?.name ?? "?").charAt(0).toUpperCase()}</span>
          <div>
            <b>{staff?.name}</b>
            <small>{staff?.email}</small>
            <small className="gold">{staff ? ROLE_LABELS[staff.role][lang] : ""}</small>
          </div>
        </div>
        <div className="row">
          <Button className="btn-outline" onClick={() => setLang(lang === "bn" ? "en" : "bn")}>
            {t("lang.switch")}
          </Button>
          <Link className="btn btn-outline" to="/account" onClick={onNavigate}>
            {t("adm.account.open")}
          </Link>
          <Button
            className="btn-outline"
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            {t("btn.logout")}
          </Button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------- shell */
export function Layout() {
  const { t, lang, setLang } = useI18n();
  const { staff, can } = useAuth();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const badges = useBadges();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("mawah_admin_nav") === "1";
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false);
  const [panel, setPanel] = useState(false);
  const main = useRef<HTMLElement>(null);

  // presence heartbeat: lets teammates see who is online
  useEffect(() => {
    const ping = () =>
      void adm("/presence/ping", { json: { path: pathname } })
        .then(() => qc.invalidateQueries({ queryKey: ["presence"] }))
        .catch(() => undefined);
    ping();
    const id = window.setInterval(ping, 45_000);
    return () => window.clearInterval(id);
  }, [pathname]);

  useEffect(() => {
    setDrawer(false);
    main.current?.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("mawah_admin_nav", c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const nav = ADMIN_NAV.filter((n) => can(n.perm as Permission));

  const sidebar = (
    <nav aria-label="Admin">
      {nav.map((n) => {
        const badge = badges?.[BADGE_FOR[n.key]] ?? 0;
        return (
          <NavLink key={n.key} to={`/${n.path}`} end={n.path === ""} title={t(`adm.nav.${n.key}` as "adm.nav.courses")}>
            <Icon name={NAV_ICON[n.key] ?? "layers"} />
            <span className="lbl">{t(`adm.nav.${n.key}` as "adm.nav.courses")}</span>
            {badge > 0 && <span className="badge">{badge > 99 ? "99+" : badge}</span>}
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <div className={`admin-shell${collapsed ? " collapsed" : ""}`}>
      <a className="skip" href="#admin-main">
        {t("adm.skip")}
      </a>
      <aside className={`side${drawer ? " open" : ""}`}>
        <Link to="/" className="brand" aria-label={`${t("brand.name")} · ${t("adm.title")}`}>
          <img className="logo-wide" src="/logo-sm.webp" alt="" width={85} height={46} />
          <img className="logo-icon" src="/icon-192.png" alt="" width={44} height={44} />
          <span className="lbl">
            <small>{t("adm.title")}</small>
          </span>
        </Link>
        {sidebar}
        <div className="side-foot">
          <button type="button" className="collapse-btn" onClick={toggle} aria-label={t("adm.nav.collapse")} title={t("adm.nav.collapse")}>
            <Icon name="panel" />
            <span className="lbl">{t("adm.nav.collapse")}</span>
          </button>
          <a href={lang === "en" ? "/en" : "/"} target="_blank" rel="noopener noreferrer" className="site-link">
            <Icon name="external" />
            <span className="lbl">{t("adm.nav.viewSite")}</span>
          </a>
        </div>
      </aside>
      {drawer && <button type="button" className="scrim" aria-label={t("btn.close")} onClick={() => setDrawer(false)} />}

      <div className="stage">
        <header className="top">
          <button type="button" className="icon-btn menu-btn" aria-label={t("adm.nav.menu")} onClick={() => setDrawer(true)}>
            <Icon name="menu" />
          </button>
          <div className="grow" />
          <button type="button" className="lang-btn" lang={lang === "bn" ? "en" : "bn"} onClick={() => setLang(lang === "bn" ? "en" : "bn")}>
            {t("lang.switch")}
          </button>
          <button type="button" className="icon-btn rail-btn" aria-label={t("adm.rail.open")} onClick={() => setPanel(true)}>
            <Icon name="bell" />
            {(badges?.orders ?? 0) + (badges?.reviews ?? 0) + (badges?.questions ?? 0) + (badges?.messages ?? 0) > 0 && <span className="dot-badge" />}
          </button>
          <span className="avatar-sm" title={staff?.name}>
            {(staff?.name ?? "?").charAt(0).toUpperCase()}
          </span>
        </header>
        <main id="admin-main" ref={main} className="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <aside className="rail" aria-label={t("adm.rail.account")}>
        <RightPanel />
      </aside>
      <SlideOver open={panel} onClose={() => setPanel(false)} title={t("adm.rail.account")}>
        <RightPanel onNavigate={() => setPanel(false)} />
      </SlideOver>
    </div>
  );
}

export function RequirePerm({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  const { t } = useI18n();
  if (!can(perm)) {
    return (
      <div className="empty">
        <Icon name="lock" />
        <h3>{t("err.forbidden")}</h3>
      </div>
    );
  }
  return <>{children}</>;
}
