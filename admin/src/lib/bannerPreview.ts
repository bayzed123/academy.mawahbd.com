import { bannerDesign, bannerIcon, loc, type Lang } from "@mawah/shared";

/**
 * The page of a banner preview: the banner as the website draws it (same markup, same stylesheet, same colour and layout classes —
 * `shared/styles/banners.css` is in the admin's stylesheet too), for the values typed in the form so far. It goes into an iframe, so
 * the phone view really is as wide as a phone and the layout answers to that width, exactly like the real page.
 * Everything the owner typed is escaped; nothing in it can run.
 */
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const icon = (name: string) => `<svg class="icon" aria-hidden="true" focusable="false"><use href="/sprite.svg#i-${esc(name)}"/></svg>`;
const text = (v: Record<string, unknown>, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const key = (v: Record<string, unknown>, k: string) => (typeof v[k] === "string" && /^banners\/[a-f0-9]{16,64}\.(png|jpe?g|webp|avif)$/.test(v[k] as string) ? (v[k] as string) : null);

function picture(v: Record<string, unknown>, alt: string): string {
  const main = key(v, "image_key");
  if (!main) return "";
  const phone = key(v, "mobile_image_key");
  return `<picture>${phone ? `<source media="(max-width: 720px)" srcset="/media/${phone}">` : ""}<img src="/media/${main}" alt="${esc(alt)}" width="1600" height="600"></picture>`;
}

export function bannerPreviewDoc(v: Record<string, unknown>, lang: Lang, stylesheet: string): string {
  const field = (k: string) => loc(Object.fromEntries(["bn", "en"].map((l) => [`${k}_${l}`, text(v, `${k}_${l}`)])), k, lang);
  const title = field("title");
  const body = field("text");
  const kicker = field("kicker");
  const label = field("button");
  const hasButton = !!label && !!text(v, "link_url").trim();
  const look = { theme: text(v, "theme") || null, layout: text(v, "layout") || null, focus: text(v, "focus") || null, icon: text(v, "icon") || null, image_key: key(v, "image_key") };
  const popup = v.placement === "popup";
  const button = hasButton ? `<a class="btn btn-primary btn-lg" href="#" tabindex="-1">${esc(label)}${icon("arrow")}</a>` : "";
  let inner: string;
  if (popup) {
    const design = bannerDesign(look, false);
    inner = `<div class="pv-offer"><div class="offer-card${design ? ` ${design}` : ""}">${look.image_key ? `<div class="offer-media">${picture(v, title)}</div>` : ""}${
      kicker || title || body || button
        ? `<div class="offer-copy">${kicker ? `<p class="offer-kicker bn-kicker">${esc(kicker)}</p>` : ""}${title ? `<p class="offer-title">${esc(title)}</p>` : ""}${body ? `<p class="offer-text">${esc(body)}</p>` : ""}${button}</div>`
        : ""
    }<span class="offer-no">${esc(lang === "bn" ? "না, ধন্যবাদ" : "No thanks")}</span></div></div>`;
  } else {
    const design = bannerDesign(look, true);
    const art = bannerIcon(look);
    inner = `<div class="bn-slide${look.image_key ? "" : " bn-plain"}${design ? ` ${design}` : ""}">${look.image_key ? `<div class="bn-media">${picture(v, title)}</div>` : ""}${art ? `<div class="bn-art" aria-hidden="true">${icon(art)}</div>` : ""}${
      kicker || title || body || button
        ? `<div class="bn-copy">${kicker ? `<p class="bn-kicker">${esc(kicker)}</p>` : ""}${title ? `<p class="bn-title">${esc(title)}</p>` : ""}${body ? `<p class="bn-text">${esc(body)}</p>` : ""}${button}</div>`
        : ""
    }</div>`;
  }
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${stylesheet ? `<link rel="stylesheet" href="${esc(stylesheet)}">` : ""}</head><body class="pv-body">${inner}</body></html>`;
}
