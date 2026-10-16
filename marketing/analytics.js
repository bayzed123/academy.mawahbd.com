/* MAWAH Academy — counting visits (Google Analytics 4; optionally Microsoft Clarity and Meta Pixel).
   A page carries this script only when the owner has set an ID AND the page is on the real site (never on a test machine or the
   fallback address). Everything here is optional: the pages, forms and links work without it.
   - Nobody is counted who asked not to be: "Do Not Track", "Global Privacy Control", the footer switch — and visitors in Europe
     and the UK only after they say yes. Robots and test browsers are not visitors.
   - Nothing personal is ever sent: only what a visitor looks at and clicks (class names, prices, page names). A value that looks like
     an e-mail address or a phone number is cut out before it leaves the page.
   - It starts after the page has finished loading and the browser is idle, so it cannot slow the page down.
   window.mawahTrack(name, params) is the one door for events; the student app uses it too (see docs/analytics.md). */
(function () {
  "use strict";
  var w = window, d = document, n = navigator;
  var meta = function (name) { var m = d.querySelector('meta[name="' + name + '"]'); return m ? m.getAttribute("content") || "" : ""; };
  var ga = meta("mawah:ga4"), clarity = meta("mawah:clarity"), pixel = meta("mawah:pixel");
  w.mawahTrack = function () { /* nothing is counted until this script decides it may */ };
  if (!ga && !clarity && !pixel) return;

  var read = function (k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } };
  var write = function (k, v) { try { if (v === null) w.localStorage.removeItem(k); else w.localStorage.setItem(k, v); } catch (e) { /* private mode: the choice lasts until the page is closed */ } };
  var lang = ((d.documentElement.lang || read("mawah_lang") || "bn") + "").slice(0, 2) === "en" ? "en" : "bn";
  var CURRENCY = "BDT";

  /* ------------------------------------------------------------------------------------------ who is not counted */
  var automated = !!n.webdriver || /headlesschrome|chrome-lighthouse|ptst|gtmetrix|pingdom|uptimerobot|googlebot|bingbot|yandex|baiduspider|duckduckbot|slurp|facebookexternalhit|crawler|spider|\bbot\b/i.test(n.userAgent || "");
  var asked = n.doNotTrack === "1" || w.doNotTrack === "1" || n.msDoNotTrack === "1" || n.globalPrivacyControl === true; // the browser itself says "do not track me"
  if (automated || asked) return;

  var geo = /(?:^|;\s*)mawah_geo=(eu|row)(?:;|$)/.exec(d.cookie || ""); // set by the server from the visitor's country; see worker/src/middleware/geo.ts
  var europe = !geo || geo[1] === "eu"; // no cookie at all (cookies blocked, a page restored from the browser's cache): ask first, never count first
  var off = function () { return read("mawah_ga") === "off" || read("mawah_consent") === "no"; }; // a "no" stays a "no" wherever the visitor is next
  var needsAnswer = function () { return europe && read("mawah_consent") !== "yes" && read("mawah_consent") !== "no" && read("mawah_ga") !== "off"; };

  /* ------------------------------------------------------------------------------------------ what may leave the page */
  var EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  var PHONE = /(?:^|\D)(?:\+?88)?01[3-9]\d{8}(?:\D|$)/;
  var NUMBERISH = /^\+?\d[\d\s-]{8,}$/;
  function scrub(v) {
    if (typeof v === "string") return EMAIL.test(v) || PHONE.test(v) || NUMBERISH.test(v) ? "(removed)" : v.slice(0, 100);
    if (Array.isArray(v)) return v.slice(0, 50).map(scrub);
    if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { if (v[k] !== undefined && v[k] !== null && v[k] !== "") o[k] = scrub(v[k]); }); return o; }
    return v;
  }

  /* The address of a page is reported with everything the page does. A code or token in it, and any value of the query that looks like a person's own
     details, are cut out first (a certificate check has the code in its address). Search words stay: they are what the "searched for" figures are made of. */
  var SECRET_PARAM = /^(?:code|token|key|secret|pass|password|pwd|otp|e-?mail|phone|mobile|tel|name|address)$/i;
  function cleanUrl(href) {
    try {
      var u = new URL(href, location.href);
      var path = u.pathname.replace(/^(\/(?:en\/)?(?:verify|certificate))\/[^/]+/i, "$1/(code)").replace(/^(\/app\/reset)\/[^/]+/i, "$1/(token)");
      if (path !== u.pathname) u.pathname = path;
      var keys = [];
      u.searchParams.forEach(function (v, k) { keys.push(k); });
      keys.forEach(function (k) {
        var v = u.searchParams.get(k) || "";
        var c = SECRET_PARAM.test(k) ? "(removed)" : scrub(v);
        if (c !== v) u.searchParams.set(k, c);
      });
      return u.toString();
    } catch (e) { return ""; }
  }

  /* ------------------------------------------------------------------------------------------ sending */
  var live = false, waiting = true, queue = [], started = false;
  function gtag() { w.dataLayer.push(arguments); }
  function emit(name, params) {
    if (live && ga) gtag("event", name, params);
    else if (waiting && queue.length < 60) queue.push([name, params]);
  }
  w.mawahTrack = function (name, params) { try { emit(String(name).slice(0, 40), scrub(params || {})); } catch (e) { /* counting must never break a page */ } };

  function begin() {
    if (off()) return; // said no between the page loading and this moment (the footer switch, another tab): nothing starts
    if (started) { live = true; waiting = false; if (ga) w["ga-disable-" + ga] = false; return; }
    started = true;
    if (ga) {
      w.dataLayer = w.dataLayer || [];
      w["ga-disable-" + ga] = false;
      gtag("js", new Date());
      var cfg = { transport_type: "beacon", allow_google_signals: false, allow_ad_personalization_signals: false };
      var here = cleanUrl(location.href), from = d.referrer ? cleanUrl(d.referrer) : "";
      if (here && here !== location.href) cfg.page_location = here; // only when something had to be cut out (a fixed address would hide the student app's own page changes)
      if (from && from !== d.referrer) cfg.page_referrer = from;
      if (/[?&]ga_debug=1(?:&|$)/.test(location.search)) cfg.debug_mode = true; // open any page with ?ga_debug=1 and watch it in GA4 → Admin → DebugView
      gtag("config", ga, cfg);
      var g = d.createElement("script");
      g.async = true;
      g.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ga);
      d.head.appendChild(g);
    }
    if (clarity) {
      (function (c, l, a, r, i) {
        c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
        var t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
        var y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
      })(w, d, "clarity", "script", clarity);
    }
    if (pixel) {
      (function (f, b, e, v) {
        if (f.fbq) return;
        var q = (f.fbq = function () { q.callMethod ? q.callMethod.apply(q, arguments) : q.queue.push(arguments); });
        if (!f._fbq) f._fbq = q;
        q.push = q; q.loaded = true; q.version = "2.0"; q.queue = [];
        var t = b.createElement(e); t.async = true; t.src = v;
        var s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      })(w, d, "script", "https://connect.facebook.net/en_US/fbevents.js");
      w.fbq("init", pixel);
      w.fbq("track", "PageView");
    }
    live = true;
    waiting = false;
    var held = queue;
    queue = [];
    held.forEach(function (e) { emit(e[0], e[1]); });
  }
  function stop() {
    live = false;
    waiting = false;
    queue = [];
    if (ga) w["ga-disable-" + ga] = true; // Google's own switch: nothing more is sent from this page
    try { if (w.clarity) w.clarity("stop"); } catch (e) { /* the tool may not have started */ }
    try { if (w.fbq) w.fbq("consent", "revoke"); } catch (e) { /* idem */ }
  }
  function afterLoad(fn) {
    var go = function () { if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 2000 }); else w.setTimeout(fn, 800); };
    if (d.readyState === "complete") go(); else w.addEventListener("load", go);
  }

  /* ------------------------------------------------------------------------------------------ the question for Europe and the UK */
  var TEXT = {
    bn: { label: "কুকি ও ভিজিট গোনা", text: "কোন ক্লাস বেশি দেখা হচ্ছে বুঝতে আমরা Google Analytics দিয়ে ভিজিট গুনি। নাম, ইমেইল বা ফোন নম্বর কখনো পাঠানো হয় না।", yes: "ঠিক আছে", no: "না, ধন্যবাদ", more: "গোপনীয়তা নীতি", href: "/policies/privacy" },
    en: { label: "Cookies and visit counting", text: "We count visits with Google Analytics to see which classes people read. Names, e-mails and phone numbers are never sent.", yes: "Accept", no: "No thanks", more: "Privacy policy", href: "/en/policies/privacy" },
  }[lang];
  function style(el, rules) { Object.keys(rules).forEach(function (k) { el.style[k] = rules[k]; }); }
  var banner = null;
  function ask() {
    var box = d.createElement("div");
    banner = box;
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", TEXT.label);
    style(box, { position: "fixed", left: "0", right: "0", bottom: "0", zIndex: "2147483000", background: "#070304", color: "#fff", padding: "14px 16px", display: "flex", flexWrap: "wrap", gap: "10px 16px", alignItems: "center", justifyContent: "center", boxShadow: "0 -6px 24px rgba(0,0,0,.35)", fontSize: "15px", lineHeight: "1.5", fontFamily: "inherit" });
    var p = d.createElement("p");
    style(p, { margin: "0", maxWidth: "60ch" });
    p.appendChild(d.createTextNode(TEXT.text + " "));
    var a = d.createElement("a");
    a.href = TEXT.href;
    a.textContent = TEXT.more;
    style(a, { color: "#e6dc8c", textDecoration: "underline" });
    p.appendChild(a);
    var mk = function (label, primary, onClick) {
      var b = d.createElement("button");
      b.type = "button";
      b.textContent = label;
      style(b, { minHeight: "44px", minWidth: "44px", padding: "8px 18px", borderRadius: "999px", fontWeight: "600", fontSize: "15px", fontFamily: "inherit", cursor: "pointer", border: "2px solid #c4b14a", background: primary ? "#c4b14a" : "transparent", color: primary ? "#070304" : "#fff" });
      b.addEventListener("click", onClick);
      return b;
    };
    box.appendChild(p);
    box.appendChild(mk(TEXT.yes, true, function () { write("mawah_ga", null); write("mawah_consent", "yes"); box.remove(); banner = null; begin(); syncChoice(); }));
    box.appendChild(mk(TEXT.no, false, function () { write("mawah_consent", "no"); box.remove(); banner = null; stop(); syncChoice(); }));
    d.body.appendChild(box);
  }

  /* ------------------------------------------------------------------------------------------ the footer switch */
  var choice = d.querySelector("[data-ga-choices]");
  var said = d.querySelector("[data-ga-status]");
  function syncChoice() { if (choice) choice.textContent = choice.getAttribute(off() ? "data-on" : "data-off") || choice.textContent; }
  if (choice) {
    choice.hidden = false;
    syncChoice();
    choice.addEventListener("click", function () {
      if (off()) {
        write("mawah_ga", null);
        write("mawah_consent", "yes"); // they asked to be counted again: that is a yes
        begin();
      } else {
        write("mawah_ga", "off");
        if (europe) write("mawah_consent", "no");
        if (banner) { banner.remove(); banner = null; }
        stop();
      }
      syncChoice();
      if (said) said.textContent = choice.getAttribute(off() ? "data-is-off" : "data-is-on") || "";
    });
  }

  if (off()) stop(); // an earlier "no": nothing is queued or sent — the footer switch can still turn counting back on
  // a "no" given in another tab, or a page brought back from the browser's cache after one: this page stops too
  w.addEventListener("storage", function (ev) {
    if ((ev.key === "mawah_ga" || ev.key === "mawah_consent") && off()) { if (banner) { banner.remove(); banner = null; } stop(); syncChoice(); }
  });
  w.addEventListener("pageshow", function (ev) { if (ev.persisted && off()) { stop(); syncChoice(); } });

  /* ------------------------------------------------------------------------------------------ what the page tells us */
  var page = {};
  try { var blob = d.getElementById("mawah-ga"); if (blob) page = JSON.parse(blob.textContent || "{}") || {}; } catch (e) { page = {}; }
  var q = function (sel, root) { return Array.prototype.slice.call((root || d).querySelectorAll(sel)); };
  var closest = function (el, sel) { return el && el.closest ? el.closest(sel) : null; };
  var parse = function (s) { try { return JSON.parse(s); } catch (e) { return null; } };
  var LISTS = { home_featured: "Home - featured classes", home_beginners: "Home - start here", classes: "All classes", related: "Related classes" };

  function itemOf(el) {
    var card = closest(el, "[data-ga-item]");
    var it = card ? parse(card.getAttribute("data-ga-item")) : null;
    return it ? Object.assign({ quantity: 1 }, it) : null;
  }
  function listOf(el) {
    var list = closest(el, "[data-ga-list]");
    var id = list ? list.getAttribute("data-ga-list") : "";
    return id ? { item_list_id: id, item_list_name: LISTS[id] || id } : {};
  }
  function itemBySlug(slug) {
    var el = q("[data-ga-item]").filter(function (e) { var it = parse(e.getAttribute("data-ga-item")); return it && it.item_id === slug; })[0];
    var it = el ? parse(el.getAttribute("data-ga-item")) : null;
    if (!it && page.item && page.item.item_id === slug) it = page.item;
    return Object.assign({ quantity: 1 }, it || { item_id: slug });
  }
  function placement(el) {
    if (closest(el, ".buybar")) return "sticky_bar";
    if (closest(el, ".bn-band, .offer")) return "banner";
    if (closest(el, ".site-header")) return "header";
    if (closest(el, ".site-footer")) return "footer";
    if (closest(el, ".floats")) return "floating_button";
    if (closest(el, ".card")) return "card";
    if (closest(el, "aside")) return "buy_box";
    return "page";
  }

  /* a class page was opened */
  if (page.item) emit("view_item", { currency: CURRENCY, value: page.item.price || 0, items: [Object.assign({ quantity: 1 }, page.item)] });
  (page.events || []).forEach(function (e) { if (e && e[0]) emit(e[0], e[1] || {}); });

  /* class lists are "viewed" when they come on screen (a list far down the page that nobody scrolls to is not a view). It is the FIRST card that is
     watched, not the whole list: a long list is taller than the screen, so "a fifth of it is visible" would never come true. */
  var seenLists = [];
  function watchLists() {
    q("[data-ga-list]").forEach(function (list) {
      if (seenLists.indexOf(list) >= 0) return;
      seenLists.push(list);
      var fire = function () {
        var meta = listOf(list.firstElementChild || list);
        var items = q("[data-ga-item]", list).map(function (el, i) { var it = parse(el.getAttribute("data-ga-item")); return it ? Object.assign({ index: i + 1, quantity: 1 }, it, meta) : null; }).filter(Boolean);
        if (items.length) emit("view_item_list", Object.assign({ items: items }, meta));
      };
      if (!("IntersectionObserver" in w)) return fire();
      var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fire(); } }, { threshold: 0.5 });
      io.observe(q("[data-ga-item]", list)[0] || list);
    });
  }
  watchLists();
  d.addEventListener("mawah:fragment", watchLists); // the related classes arrive later (site.js)

  /* banners: a slide counts as seen once it is mostly on screen; the offer pop-up once it opens */
  function promo(el, kind) {
    var all = q(kind === "hero" ? ".bn-slide" : "[data-offer]");
    var i = Math.max(0, all.indexOf(el));
    var title = ((el.querySelector(".bn-title, .offer-title") || {}).textContent || "").trim();
    var id = kind === "hero" ? "hero-" + (i + 1) : "offer-" + (el.getAttribute("data-id") || "1");
    var p = { promotion_id: id, promotion_name: title || id, creative_name: kind === "hero" ? "slide-" + (i + 1) : "popup", creative_slot: String(i + 1), location_id: kind === "hero" ? "home_hero" : "offer_popup" };
    return Object.assign({ items: [{ item_id: id, item_name: p.promotion_name, promotion_id: id, promotion_name: p.promotion_name, creative_name: p.creative_name, creative_slot: p.creative_slot, location_id: p.location_id }] }, p);
  }
  var slides = q(".bn-slide");
  if (slides.length && "IntersectionObserver" in w) {
    var sio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { sio.unobserve(e.target); emit("view_promotion", promo(e.target, "hero")); } });
    }, { threshold: 0.6 });
    slides.forEach(function (s) { sio.observe(s); });
  }
  var offer = d.querySelector("[data-offer]");
  if (offer && "MutationObserver" in w) {
    var shown = false;
    new MutationObserver(function () { if (!offer.hidden && !shown) { shown = true; emit("view_promotion", promo(offer, "offer")); } }).observe(offer, { attributes: true, attributeFilter: ["hidden"] });
  }

  /* clicks: one listener for the whole page (the cards and links the page adds later are covered too) */
  d.addEventListener("click", function (ev) {
    var a = closest(ev.target, "a[href]");
    var btn = closest(ev.target, "button,[data-chat-open]");
    if (!a && btn) {
      if (btn.hasAttribute("data-chat-open")) emit("chatbot_open", { placement: placement(btn) });
      else if (btn.hasAttribute("data-offer-close")) { var o = closest(btn, "[data-offer]"); if (o) emit("popup_dismiss", { promotion_name: promo(o, "offer").promotion_name, method: btn.classList.contains("offer-no") ? "no_thanks" : "close" }); }
      return;
    }
    if (!a) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (e) { return; }
    if (a.hasAttribute("data-shop")) return emit("shop_click", { placement: placement(a) });
    if (closest(a, ".bn-slide")) return emit("select_promotion", promo(closest(a, ".bn-slide"), "hero"));
    if (closest(a, "[data-offer]")) return emit("select_promotion", promo(closest(a, "[data-offer]"), "offer"));
    if (a.classList.contains("lang-toggle")) return emit("language_switch", { from: lang, to: lang === "bn" ? "en" : "bn" });
    if (url.origin === location.origin && url.pathname === "/app/checkout") {
      var slug = url.searchParams.get("c");
      var item = slug ? itemBySlug(slug) : { item_id: "bundle-" + (url.searchParams.get("bundle") || "") };
      return emit("add_to_cart", { currency: CURRENCY, value: item.price || 0, items: [item], placement: placement(a) });
    }
    var card = closest(a, "[data-ga-item]");
    if (card && /\/courses\/[^/]+\/?$/.test(url.pathname)) {
      var it = itemOf(a);
      var meta2 = listOf(a);
      var n2 = q("[data-ga-item]", closest(a, "[data-ga-list]") || d).indexOf(card);
      return emit("select_item", Object.assign({ items: [Object.assign({ index: n2 + 1 }, it, meta2)] }, meta2));
    }
    if (/(?:^|\.)(?:wa\.me|whatsapp\.com)$/.test(url.hostname)) return emit("contact_click", { method: "whatsapp", placement: placement(a) });
    if (url.protocol === "tel:") return emit("contact_click", { method: "phone", placement: placement(a) });
    if (url.protocol === "mailto:") return emit("contact_click", { method: "email", placement: placement(a) });
    var social = /(?:^|\.)(facebook|instagram|youtube)\.com$|(?:^|\.)youtu\.be$/.exec(url.hostname);
    if (social) return emit("contact_click", { method: social[1] || "youtube", placement: placement(a) });
  }, true);

  /* questions opened on the FAQ page and in a class's FAQ */
  d.addEventListener("toggle", function (ev) {
    var el = ev.target;
    if (!el || el.tagName !== "DETAILS" || !el.open || !closest(el, "[data-ga-faq]")) return;
    var s = el.querySelector("summary");
    emit("faq_expand", { question: ((s && s.textContent) || "").trim().slice(0, 100), placement: closest(el, "[data-ga-faq]").getAttribute("data-ga-faq") });
  }, true);

  /* forms the visitor filled in (site.js says when one went through) */
  d.addEventListener("mawah:form", function (ev) {
    var f = ev.target;
    var action = (f.getAttribute && f.getAttribute("action")) || "";
    var type = /notify/.test(action) ? "notify_me" : /newsletter/.test(action) ? "newsletter" : /contact/.test(action) ? "contact" : "form";
    var c = f.querySelector && f.querySelector('input[name="course"]');
    emit("generate_lead", { lead_type: type, course: c && c.value ? c.value : undefined, placement: placement(f) });
  });

  /* ------------------------------------------------------------------------------------------ go */
  if (off()) { /* waiting for the footer switch */ }
  else if (needsAnswer()) afterLoad(function () { if (needsAnswer()) ask(); });
  else afterLoad(begin);
})();
