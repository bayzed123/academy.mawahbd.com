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
      .then(function (html) {
        if (html) { el.innerHTML = html; el.dispatchEvent(new CustomEvent("mawah:fragment", { bubbles: true })); } // analytics.js counts the classes in it
        el.removeAttribute("aria-busy");
      })
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
          if (res.ok) { form.reset(); form.dispatchEvent(new CustomEvent("mawah:form", { bubbles: true })); } // analytics.js counts it as a lead
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
})();
