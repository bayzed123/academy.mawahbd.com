import { playStoreUrl } from "@mawah/shared";
import type { PageCtx } from "./ctx";
import { Icon, SectionHead } from "./ui";

/*
 * "Get the app": the Android app, in the footer of every page and as a section of the home page. Until the owner adds the app's Google Play
 * address (Admin → Android app → "Get the app" on the website) it says the app is coming soon, with nothing to press; with the address, the
 * same place is the button to Google Play. Admin can take it off the website. Only an app's own Google Play page is ever linked (checked
 * again here). Kept small: the home page has a size budget, so the phone is a cached picture (/app-phone.svg) and the icons come from the
 * sprite.
 */

/** The Google Play address, or "" (not live yet); null when the owner took it off the website. */
export function playOf(ctx: PageCtx): string | null {
  const p = ctx.settings.play;
  if (!p.show) return null;
  return p.url ? (playStoreUrl(p.url) ?? "") : "";
}

/** The Google Play button: a link once the app is live, a quiet "coming soon" until then. */
export function PlayBadge({ ctx, url, where }: { ctx: PageCtx; url: string; where: "footer" | "home" }) {
  const { t } = ctx;
  const inner = (
    <>
      <Icon name="gplay" />
      <span>
        <small>{t(url ? "app.badge.get" : "app.badge.soon")}</small>
        <b>Google Play</b>
      </span>
    </>
  );
  if (!url) return <p class="play-badge is-soon">{inner}</p>;
  return (
    <a class="play-badge" href={url} target="_blank" rel="noopener noreferrer" data-play={where}>
      {inner}
      <span class="vh"> ({t("shop.opens")})</span>
    </a>
  );
}

/** The footer's corner: the app's name and its button — on every page but the home page, whose own section says it all just above. */
export function FooterApp({ ctx }: { ctx: PageCtx }) {
  const url = playOf(ctx);
  if (url === null || ctx.path === "/") return null;
  return (
    <div class="foot-app">
      <p class="foot-h">{ctx.t("app.foot.title")}</p>
      <PlayBadge ctx={ctx} url={url} where="footer" />
    </div>
  );
}

/** The home page's section: what the app gives, its button, and a drawing of the app on a phone. */
export function HomeApp({ ctx }: { ctx: PageCtx }) {
  const url = playOf(ctx);
  if (url === null) return null;
  const { t } = ctx;
  return (
    <section class="section" id="app" aria-labelledby="app-h">
      <div class="wrap">
        <div class="app-card">
        <div>
          <SectionHead id="app-h" eyebrow={t("app.home.eyebrow")} title={t("app.home.title")} hl={t("app.home.title.hl")} sub={t(url ? "app.home.sub.live" : "app.home.sub.soon")} />
          <ul class="app-points">
            {(["gift", "user", "bell"] as const).map((icon, n) => (
              <li>
                <span class="tile-ico">
                  <Icon name={icon} />
                </span>
                {t(`app.home.p${n + 1}` as "app.home.p1")}
              </li>
            ))}
          </ul>
          <PlayBadge ctx={ctx} url={url} where="home" />
        </div>
        <img class="app-phone" src="/app-phone.svg" alt="" width="300" height="560" loading="lazy" decoding="async" />
        </div>
      </div>
    </section>
  );
}
