/* MAWAH Academy — tiny progressive-enhancement script for the public pages (target: < 3 KB gzipped).
   Everything here is optional: pages, forms and links work without it. */
(function () {
  "use strict";
  var d = document;
  var $ = function (s, r) { return (r || d).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); };
  var meta = function (n) { var m = $('meta[name="' + n + '"]'); return m ? m.getAttribute("content") || "" : ""; };

  /* the visitor's language follows them into the student app (same origin, so localStorage is shared) */
  try { localStorage.setItem("mawah_lang", (d.documentElement.lang || "bn").slice(0, 2)); } catch (e) { /* private mode */ }

  /* 1. cached HTML is anonymous; a non-secret cookie flag swaps "Log in" for "My Learning" */
  if (/(?:^|;\s*)mawah_in=1/.test(d.cookie)) {
    $$("[data-guest]").forEach(function (e) { e.hidden = true; });
    $$("[data-user]").forEach(function (e) { e.hidden = false; });
  }

  /* print / save-as-PDF buttons on certificates and invoices (inline handlers are blocked by CSP) */
  $$("[data-print]").forEach(function (b) { b.addEventListener("click", function () { window.print(); }); });

  /* 2. lazy fragments (reviews, related classes) load only when scrolled near */
  function loadFragment(el) {
    fetch(el.getAttribute("data-fragment"), { credentials: "omit" })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (html) { if (html) el.innerHTML = html; el.removeAttribute("aria-busy"); })
      .catch(function () { el.removeAttribute("aria-busy"); });
  }
  var frags = $$("[data-fragment]");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); loadFragment(e.target); } });
    }, { rootMargin: "400px" });
    frags.forEach(function (f) { io.observe(f); });
  } else frags.forEach(loadFragment);

  /* 3. forms: submit with fetch when possible (no page reload), otherwise the normal POST + redirect still works */
  $$("form[data-ajax]").forEach(function (form) {
    form.addEventListener("submit", function (ev) {
      if (!window.fetch || !window.FormData) return;
      ev.preventDefault();
      var status = $("[data-status]", form);
      var btn = $('button[type="submit"]', form);
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k === "cf-turnstile-response" ? "turnstile" : k] = v; });
      if (btn) btn.disabled = true;
      fetch(form.getAttribute("action"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok, status: r.status }; }); })
        .then(function (res) {
          if (status) {
            status.className = "status-line " + (res.ok ? "ok" : "err");
            status.textContent = res.ok ? form.getAttribute("data-ok") : form.getAttribute(res.status === 429 ? "data-limit" : "data-err");
          }
          if (res.ok) form.reset();
        })
        .catch(function () { if (status) { status.className = "status-line err"; status.textContent = form.getAttribute("data-err"); } })
        .then(function () { if (btn) btn.disabled = false; });
    });
  });

  /* 4. AI assistant: the widget script is fetched only when someone asks for it */
  var chatLoading;
  $$("[data-chat-open]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (window.MawahChat) return window.MawahChat.open();
      if (chatLoading) return;
      chatLoading = true;
      var s = d.createElement("script");
      s.src = "/chat.js";
      s.async = true;
      s.onload = function () { if (window.MawahChat) window.MawahChat.open(); };
      d.head.appendChild(s);
    });
  });

  /* 5. optional Cloudflare Turnstile on public forms */
  var tsKey = meta("mawah:turnstile");
  if (tsKey && $("[data-turnstile]")) {
    var ts = d.createElement("script");
    ts.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    ts.async = true;
    ts.onload = function () {
      $$("[data-turnstile]").forEach(function (el) { window.turnstile.render(el, { sitekey: tsKey }); });
    };
    d.head.appendChild(ts);
  }

  /* 6. analytics (GA4 / Microsoft Clarity / Meta Pixel) load AFTER the page is interactive, never before */
  var ga = meta("mawah:ga4"), clarity = meta("mawah:clarity"), pixel = meta("mawah:pixel");
  if (ga || clarity || pixel) {
    var started = false;
    var start = function () {
      if (started) return;
      started = true;
      if (ga) {
        var g = d.createElement("script");
        g.async = true;
        g.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ga);
        d.head.appendChild(g);
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag("js", new Date());
        window.gtag("config", ga);
      }
      if (clarity) {
        (function (c, l, a, r, i) {
          c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
          var t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
          var y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
        })(window, d, "clarity", "script", clarity);
      }
      if (pixel) {
        (function (f, b, e, v) {
          if (f.fbq) return;
          var n = (f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); });
          if (!f._fbq) f._fbq = n;
          n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
          var t = b.createElement(e); t.async = true; t.src = v;
          var s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
        })(window, d, "script", "https://connect.facebook.net/en_US/fbevents.js");
        window.fbq("init", pixel);
        window.fbq("track", "PageView");
      }
    };
    ["pointerdown", "keydown", "scroll", "touchstart"].forEach(function (ev) { addEventListener(ev, start, { once: true, passive: true }); });
    setTimeout(start, 6000);
  }
})();
