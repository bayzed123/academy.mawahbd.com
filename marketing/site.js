/* MAWAH Academy — small progressive-enhancement script for the public pages. Everything here is optional: pages, forms and links work
   without it. scripts/build-marketing.mjs bundles it with Framer Motion (framer-motion, MIT): its small Web Animations animate(), inView()
   and stagger() — about 4.5 KB gzipped — drive the scroll reveals. */
import { animate } from "framer-motion/dom/mini";
import { inView, stagger } from "framer-motion/dom";

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

  /* 6. motion: sections, headings, text blocks and cards fade in and rise 20px as they come into view — Framer Motion animates them from
     { opacity: 0, y: 20 } to { opacity: 1, y: 0 } (0.5 s, ease-out), the cards of a row one after another. Only for visitors who have not
     asked for less motion: the CSS waits for .motion. What is on screen when the page opens is never hidden first, and an element gets
     its own hover back once it is in. */
  var still = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (!still && "IntersectionObserver" in window && "animate" in Element.prototype) {
    var html = d.documentElement;
    var targets = [];
    var mark = function (sel) {
      $$(sel).forEach(function (el) {
        if (el.mawahRv || el.closest(".car-track")) return; // a slider's cards move sideways instead
        el.mawahRv = true;
        targets.push(el);
      });
    };
    ["main .sec-head", ".trust-item", ".grid>.card", ".tile", ".step", ".person", ".carousel", ".faq-side", ".faq-item", ".rev-sum",
      ".review", ".news>*", ".band-dark .sec-head~*", ".detail-main>section", ".curr details", ".lp-card", ".lp-offer-card", ".lp-pic-grid>li",
      ".lp-frame", ".page-contact", ".foot-grid>*"].forEach(mark);
    html.classList.add("motion");
    var fold = (window.innerHeight || html.clientHeight) * 0.92;
    var later = targets.filter(function (el) { return el.getBoundingClientRect().top > fold; });
    later.forEach(function (el) { el.classList.add("rv"); });
    // what comes into view together rises together, one after another (at most 0.4 s apart from the first)
    var queue = [], queued = false, step = stagger(0.08);
    var rise = function () {
      queued = false;
      var batch = queue.splice(0);
      animate(batch, { opacity: [0, 1], transform: ["translate3d(0,20px,0)", "none"] }, {
        duration: 0.5,
        ease: "easeOut",
        delay: function (i, n) { return Math.min(step(i, n), 0.4); },
      }).then(function () {
        // the end state is the page's own: the element is back to its CSS (and its hover lift)
        batch.forEach(function (el) {
          el.classList.remove("rv");
          el.style.removeProperty("opacity");
          el.style.removeProperty("transform");
        });
      });
    };
    if (later.length) inView(later, function (el) {
      queue.push(el);
      if (!queued) { queued = true; requestAnimationFrame(rise); }
    }, { margin: "0px 0px -6% 0px", amount: 0.1 });
  }

  /* 7. the announcement bar's countdown to the end of the owner's offer: the numbers move every second; at zero the bar goes away */
  var cd = $("[data-countdown]");
  if (cd) {
    var end = Date.parse(cd.getAttribute("data-countdown"));
    var cells = {};
    ["d", "h", "m", "s"].forEach(function (u) { cells[u] = $('[data-cd="' + u + '"]', cd); });
    var bnDigits = d.documentElement.lang === "bn";
    var two = function (n) {
      var v = (n < 10 ? "0" : "") + n;
      return bnDigits ? v.replace(/\d/g, function (c) { return "০১২৩৪৫৬৭৮৯".charAt(+c); }) : v;
    };
    var tick = function () {
      var left = Math.floor((end - Date.now()) / 1000);
      if (!(left > 0)) {
        cd.hidden = true;
        d.documentElement.classList.remove("has-topbar");
        return false;
      }
      var parts = { d: Math.floor(left / 86400), h: Math.floor((left % 86400) / 3600), m: Math.floor((left % 3600) / 60), s: left % 60 };
      for (var u in parts) if (cells[u] && cells[u].textContent !== two(parts[u])) cells[u].textContent = two(parts[u]);
      return true;
    };
    if (tick()) var cdTimer = setInterval(function () { if (!tick()) clearInterval(cdTimer); }, 1000);
  }

  /* 8. sliders: the arrows, and dragging with a mouse (a finger scrolls them by itself); the click that ends a drag opens nothing */
  $$("[data-carousel]").forEach(function (car) {
    var track = $(".car-track", car), nav = $(".car-nav", car), prev = $("[data-car-prev]", car), next = $("[data-car-next]", car);
    if (!track) return;
    var step = function () {
      var first = track.firstElementChild;
      return first ? first.getBoundingClientRect().width + (parseFloat(getComputedStyle(track).columnGap) || 16) : track.clientWidth;
    };
    var update = function () {
      var max = track.scrollWidth - track.clientWidth - 2;
      if (nav) nav.hidden = max <= 0;
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= max;
    };
    var go = function (dir) { track.scrollBy({ left: dir * step(), behavior: still ? "auto" : "smooth" }); };
    if (prev) prev.addEventListener("click", function () { go(-1); });
    if (next) next.addEventListener("click", function () { go(1); });
    track.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    var drag = null, swallow = false;
    track.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button === 0) drag = { x: e.clientX, left: track.scrollLeft, moved: false };
    });
    window.addEventListener("pointermove", function (e) {
      if (!drag) return;
      if (!(e.buttons & 1)) return end(); // let go where the page did not see it
      var dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; track.classList.add("dragging"); }
      if (drag.moved) track.scrollLeft = drag.left - dx;
    });
    // where the dragged row comes to rest: the card nearest to where it was let go (snapping alone would go back to the card it left)
    var nearest = function () {
      var start = track.getBoundingClientRect().left + (parseFloat(getComputedStyle(track).paddingLeft) || 0), best = 0, gap = Infinity;
      Array.prototype.forEach.call(track.children, function (card) {
        var x = card.getBoundingClientRect().left - start + track.scrollLeft;
        if (Math.abs(x - track.scrollLeft) < gap) { gap = Math.abs(x - track.scrollLeft); best = x; }
      });
      return Math.max(0, Math.min(best, track.scrollWidth - track.clientWidth));
    };
    var end = function () {
      if (!drag) return;
      if (drag.moved) {
        var rest = nearest();
        track.classList.remove("dragging");
        track.scrollTo({ left: rest, behavior: "auto" });
        swallow = true;
        setTimeout(function () { swallow = false; }, 0);
      }
      drag = null;
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    track.addEventListener("click", function (e) { if (swallow) { e.preventDefault(); e.stopPropagation(); } }, true);
    track.addEventListener("dragstart", function (e) { e.preventDefault(); });
  });

  /* 9. "back to the top": the round button above WhatsApp appears once the visitor is a screen and a half down the page, and takes them
     back up (smoothly, unless they asked for less motion). From the keyboard, the focus goes back to the top too. */
  var toTop = $("[data-to-top]");
  if (toTop) {
    var shown = false, ticking = false;
    var place = function () {
      ticking = false;
      var on = (window.scrollY || d.documentElement.scrollTop) > (window.innerHeight || 800) * 1.5;
      if (on !== shown) { shown = on; toTop.classList.toggle("on", on); }
    };
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(place); } }, { passive: true });
    place();
    toTop.addEventListener("click", function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
      var home = e.detail === 0 && $(".site-header .brand"); // a key press, not a click
      if (home) home.focus({ preventScroll: true });
    });
  }

  /* 10. night and day: the sun / moon button in the header switches the look, and the choice is kept in this browser (shared/src/theme.ts
     sets it again before the next page is drawn). A change made in another tab follows here too. */
  var root = d.documentElement;
  var themeBtns = $$("[data-theme-toggle]");
  var themeSync = function () {
    var light = root.getAttribute("data-theme") === "light";
    themeBtns.forEach(function (b) { b.setAttribute("aria-pressed", light ? "true" : "false"); });
    var tc = $('meta[name="theme-color"]'), cs = $('meta[name="color-scheme"]');
    if (tc) tc.setAttribute("content", light ? "#ffffff" : "#000000");
    if (cs) cs.setAttribute("content", light ? "light" : "dark");
  };
  var themeSet = function (light) {
    if (light) root.setAttribute("data-theme", "light"); else root.removeAttribute("data-theme");
    themeSync();
  };
  themeBtns.forEach(function (b) {
    b.hidden = false;
    b.addEventListener("click", function () {
      var light = root.getAttribute("data-theme") !== "light";
      themeSet(light);
      try { localStorage.setItem("mawah_theme", light ? "light" : "dark"); } catch (e) { /* private mode: this page only */ }
    });
  });
  themeSync();
  window.addEventListener("storage", function (e) { if (e.key === "mawah_theme") themeSet(e.newValue === "light"); });

  /* 11. talk to us: the round orange button bottom right opens a small card with the ways to reach the academy — WhatsApp, Messenger and
     the assistant (shared/styles/help.css). It is a native <details>, so it opens without this script; here it also closes with Escape
     (the focus goes back to the button), with a click anywhere else, and as soon as a way is chosen (the assistant's then opens, 4.). */
  var help = $("[data-help]");
  if (help) {
    var helpBtn = $("summary", help);
    var helpClose = function (focus) { if (!help.open) return; help.open = false; if (focus && helpBtn) helpBtn.focus(); };
    d.addEventListener("keydown", function (e) { if (e.key === "Escape") helpClose(true); });
    d.addEventListener("click", function (e) { if (help.open && !help.contains(e.target)) helpClose(false); });
    $$(".help-opt", help).forEach(function (o) { o.addEventListener("click", function () { helpClose(false); }); });
  }

  /* 12. videos (the home page's, and a class's demo): pressing the picture puts the video site's own player in its place and starts it —
     on this page, never a link away. The player's address is the server's (data-player), never anything the page was given. */
  $$("[data-player]").forEach(function (box) {
    var play = $(".vid-play", box);
    if (!play) return;
    // a picture that cannot be fetched (the video removed, YouTube out of reach) leaves the play button on its own, not a broken-picture mark
    var pic = $("img", box);
    if (pic) {
      var drop = function () { pic.remove(); };
      if (pic.complete && pic.naturalWidth === 0 && pic.currentSrc) drop(); else pic.addEventListener("error", drop);
    }
    play.addEventListener("click", function (e) {
      e.preventDefault();
      var f = d.createElement("iframe");
      f.src = box.getAttribute("data-player");
      f.title = box.getAttribute("data-title") || "";
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.setAttribute("allowfullscreen", "");
      f.referrerPolicy = "strict-origin-when-cross-origin";
      box.replaceChildren(f);
      f.focus();
    });
  });

  /* 13. "Watch the demo class" in a class page's price box: down to the demo and it starts — one press, not two. Without this script (or a
     demo), the link is a plain jump to the video. */
  $$("[data-play-demo]").forEach(function (link) {
    link.addEventListener("click", function (e) {
      var box = $("#demo"), play = box && $(".vid-play", box);
      if (!play) return;
      e.preventDefault();
      var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      box.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
      play.click();
    });
  });
})();
