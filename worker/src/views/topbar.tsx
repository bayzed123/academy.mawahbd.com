import { dhakaMinuteMs, formatDateTime, timeLeft, toBnDigits } from "@mawah/shared";
import { bannerHref } from "./banners";
import type { PageCtx } from "./ctx";
import { Icon } from "./ui";

/**
 * The bar at the very top of the landing pages (Admin → Settings → Announcement bar; never on the home page, the classes or any other
 * page): the owner's words and, when the owner sets them, a live countdown to the end of the offer and a button ("Join now"). The
 * owner can switch the bar off (and on again) without losing its words.
 * The countdown is always the owner's own end time — never a made-up one, never one that starts again by itself — and once that time
 * has passed the bar is gone. marketing/site.js moves the numbers every second and hides the bar at zero (a cached page
 * may still carry it a little longer); without the script the numbers are those of when the page was made, and the end time itself is
 * the countdown's name for screen readers.
 */
export interface TopBarData {
  text: string;
  /** the end of the offer (ms since 1970), or null for a bar without a countdown */
  end: number | null;
  label: string;
  href: string;
}

export function topBar(ctx: PageCtx, now: number = Date.now()): TopBarData | null {
  const a = ctx.settings.announcement;
  if (a.enabled === false) return null;
  const text = (ctx.lang === "bn" ? a.bn || a.en : a.en || a.bn).trim();
  const end = a.ends_at ? dhakaMinuteMs(a.ends_at) : null;
  // the offer is over: the bar goes away with it
  if (end !== null && end <= now) return null;
  if (!text && end === null) return null;
  const href = a.link ? bannerHref(ctx, a.link) : "";
  const label = href ? (ctx.lang === "bn" ? a.button_bn || a.button_en : a.button_en || a.button_bn).trim() || ctx.t("bar.join") : "";
  return { text, end, label, href };
}

const UNITS = ["d", "h", "m", "s"] as const;

export function TopBar({ ctx, bar, now = Date.now() }: { ctx: PageCtx; bar: TopBarData; now?: number }) {
  const { t, lang } = ctx;
  const left = bar.end !== null ? timeLeft(bar.end, now) : null;
  const two = (n: number) => {
    const v = String(n).padStart(2, "0");
    return lang === "bn" ? toBnDigits(v) : v;
  };
  // the plain announcement (no countdown) scrolls away with the page, as before; a countdown stays in view with the header
  if (!left) {
    return (
      <div class="announce">
        {bar.text}
        {bar.href && (
          <>
            {" "}
            <a href={bar.href}>{bar.label}</a>
          </>
        )}
      </div>
    );
  }
  return (
    <div class="topbar has-cd" data-countdown={new Date(bar.end!).toISOString()}>
      <div class="wrap topbar-in">
        {bar.text && (
          <p class="topbar-text">
            <Icon name="clock" />
            {bar.text}
          </p>
        )}
        {/* the time and the button are centred together, under the words on a phone and beside them on a wider screen */}
        <div class="cd-row">
          <div class="cd" role="timer" aria-label={t("bar.ends", { date: formatDateTime(new Date(bar.end!).toISOString(), lang) })}>
            {UNITS.map((u, i) => (
              <>
                {i > 0 && <i aria-hidden="true">:</i>}
                <span class="cd-u">
                  <b data-cd={u}>{two(left[u])}</b>
                  <small>{t(`bar.${u}` as "bar.d")}</small>
                </span>
              </>
            ))}
          </div>
          {bar.href && (
            <a class="btn btn-primary btn-sm" href={bar.href}>
              {bar.label}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The Messenger chat for the owner's Facebook page (Settings → Contact → Facebook): m.me/<page>. Only a page's own address gives one — a
 * page name ("facebook.com/mawahacademy"), or a page's number ("profile.php?id=…", "/p/Name-1000…") — never a group, an event, a post …
 */
export function messengerHref(facebook: string): string | null {
  let u: URL;
  try {
    u = new URL(facebook);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!/(^|\.)(facebook\.com|fb\.com)$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const first = parts[0] ?? "";
  if (first === "profile.php") {
    const id = u.searchParams.get("id") ?? "";
    return /^\d{5,20}$/.test(id) ? `https://m.me/${id}` : null;
  }
  if (first === "p" || first === "pages" || first === "people") {
    const id = /(\d{8,20})$/.exec(parts.slice(1).join("/"))?.[1];
    return id ? `https://m.me/${id}` : null;
  }
  if (parts.length !== 1 || !/^[A-Za-z0-9.]{3,50}$/.test(first)) return null;
  if (/^(groups|events|watch|share|sharer|story\.php|permalink\.php|photo|photos|reel|reels|hashtag|marketplace|gaming|login|home\.php|help|policies)$/i.test(first)) return null;
  return `https://m.me/${first}`;
}

/**
 * A Messenger address the owner gave (Settings → Contact → Messenger): m.me/<page> or messenger.com/t/<page>, as m.me/<page>; else null. It
 * is how a page whose saved Facebook address is a share link (facebook.com/share/…, which names no page) still gets its Messenger button.
 */
export function messengerUrl(value: string): string | null {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const name = host === "m.me" ? parts[0] : host === "messenger.com" && parts[0] === "t" ? parts[1] : undefined;
  return name && /^[A-Za-z0-9.]{3,60}$/.test(name) ? `https://m.me/${name}` : null;
}

/** The Messenger chat of the owner's page: the address given for it, else the one worked out from the page's own Facebook address. */
export function messengerOf(contact: { messenger?: string; facebook: string }): string | null {
  const own = contact.messenger ? messengerUrl(contact.messenger) : null;
  if (own) return own;
  return /^https?:\/\//i.test(contact.facebook) ? messengerHref(contact.facebook) : null;
}
