import { useEffect, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useSite } from "../lib/hooks";
import { useI18n } from "../lib/i18n";
import { ThemeToggle } from "./ThemeToggle";
import { Icon, Spinner } from "./ui";

const TABS = [
  { to: "/", end: true, icon: "book", key: "app.nav.learning" },
  { to: "/orders", end: false, icon: "wallet", key: "app.nav.orders" },
  { to: "/certificates", end: false, icon: "award", key: "app.nav.certificates" },
  { to: "/profile", end: false, icon: "user", key: "app.nav.profile" },
] as const;

export function Shell() {
  const { t, lang, setLang } = useI18n();
  const { student, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // a block body on purpose: newer browsers return a Promise from scrollTo(), and React would take it for a cleanup function
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  // while the bottom tab bar shows (a signed-in student), the round talk-to-us button in the corner sits above it (app.css)
  const signedIn = !!student;
  useEffect(() => {
    document.body.classList.toggle("has-tabbar", signedIn);
    return () => document.body.classList.remove("has-tabbar");
  }, [signedIn]);

  // keep the saved preference in step with the toggle for signed-in students (best effort)
  const switchLang = () => {
    const next = lang === "bn" ? "en" : "bn";
    setLang(next);
    if (student) void api("/auth/profile", { method: "PATCH", json: { name: student.name, phone: student.phone ?? "", locale: next } }).catch(() => undefined);
  };

  const home = lang === "en" ? "/en" : "/";
  const initial = (student?.name ?? "?").trim().charAt(0).toUpperCase();
  const shop = useSite().data?.shop ?? null;
  const shopLabel = shop ? (lang === "bn" ? shop.label_bn || shop.label_en : shop.label_en || shop.label_bn) || t("app.nav.shop") : "";
  // the tools shop is part of this website (the English pages under /en); the owner's other shop opens in a new tab
  const shopHref = shop?.internal ? `${home === "/" ? "" : home}${shop.url}` : (shop?.url ?? "");
  const shopOut = shop?.internal ? {} : { target: "_blank", rel: "noopener noreferrer" };

  return (
    <>
      <a className="skip" href="#main">
        {lang === "bn" ? "মূল অংশে যান" : "Skip to content"}
      </a>
      <header className="app-header">
        <div className="wrap app-nav">
          <a className="brand" href={home} aria-label={t("brand.name")}>
            <img src="/logo-sm.webp" alt="" width={99} height={54} />
            <span className="brand-text">
              <span className="brand-name">{t("brand.academy")}</span>
            </span>
          </a>
          <nav className="nav-links" aria-label="Main">
            {student &&
              TABS.slice(0, 3).map((x) => (
                <NavLink key={x.to} to={x.to} end={x.end}>
                  {t(x.key)}
                </NavLink>
              ))}
            <a href={`${home === "/" ? "" : home}/courses`}>{t("app.nav.browse")}</a>
            {shop && (
              <a className="nav-shop" href={shopHref} {...shopOut}>
                <Icon name="shop" /> {shopLabel}
                {!shop.internal && (
                  <>
                    <Icon name="external" />
                    <span className="vh"> ({t("app.nav.opensNew")})</span>
                  </>
                )}
              </a>
            )}
          </nav>
          <ThemeToggle />
          <button type="button" className="lang-btn" onClick={switchLang} lang={lang === "bn" ? "en" : "bn"}>
            {t("lang.switch")}
          </button>
          {student ? (
            <details className="user-menu">
              <summary aria-label={t("app.nav.profile")}>
                <span className="avatar-sm">{initial}</span>
                <span className="name">{student.name.split(" ")[0]}</span>
              </summary>
              <div className="menu-pop">
                <Link to="/profile">
                  <Icon name="user" /> {t("app.nav.profile")}
                </Link>
                <Link to="/orders">
                  <Icon name="wallet" /> {t("app.nav.orders")}
                </Link>
                <a href={`${home === "/" ? "" : home}/courses`}>
                  <Icon name="search" /> {t("app.nav.browse")}
                </a>
                {shop && (
                  <a href={shopHref} {...shopOut}>
                    <Icon name="shop" /> {shopLabel}
                    {!shop.internal && <span className="vh"> ({t("app.nav.opensNew")})</span>}
                  </a>
                )}
                <hr />
                <button
                  onClick={async () => {
                    await logout();
                    navigate("/login");
                  }}
                >
                  <Icon name="arrow" /> {t("btn.logout")}
                </button>
              </div>
            </details>
          ) : (
            <Link className="btn btn-primary btn-sm" to="/login">
              {t("btn.login")}
            </Link>
          )}
        </div>
      </header>

      <main id="main" className="app-main">
        <div className="wrap">
          <Outlet />
        </div>
      </main>

      <footer className="app-foot">
        <div className="wrap">
          <a className="link" href={home}>
            {t("app.nav.site")}
          </a>{" "}
          · © {new Date().getFullYear()} {t("brand.name")}
        </div>
      </footer>

      {student && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map((x) => (
            <NavLink key={x.to} to={x.to} end={x.end}>
              <Icon name={x.icon} />
              {t(x.key)}
            </NavLink>
          ))}
        </nav>
      )}
    </>
  );
}

/** Pages that need an account: unknown visitors are sent to log in and brought back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { student } = useAuth();
  const { pathname, search } = useLocation();
  if (student === undefined) return <Spinner />;
  if (!student) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  return <>{children}</>;
}
