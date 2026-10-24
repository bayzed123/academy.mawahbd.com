/* MAWAH Academy — the banner slider and the offer pop-up. Loaded only on pages that have one.
   Everything here is optional: without it the slider is a swipeable row, every button is a normal link and the pop-up stays hidden. */
(function () {
  "use strict";
  var d = document;
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ------------------------------------------------------------------------------------------ slider */
  each(d.querySelectorAll("[data-slider]"), function (root) {
    var track = root.querySelector(".bn-track");
    var slides = root.querySelectorAll(".bn-slide");
    var dots = root.querySelectorAll("[data-go]");
    var count = slides.length;
    if (!track || count < 2) return;
    var ctrl = root.querySelector(".bn-ctrl");
    var toggle = root.querySelector("[data-toggle]");
    var index = 0;
    var playing = !reduce && root.hasAttribute("data-autoplay"); // the owner's slider moves by itself only if nobody asked for less motion
    var held = false; // the pointer or the keyboard is on the slider
    var timer = 0;
    root.classList.add("js");
    if (ctrl) ctrl.hidden = false;

    function mark(i) {
      index = i;
      each(dots, function (dot, n) { if (n === i) dot.setAttribute("aria-current", "true"); else dot.removeAttribute("aria-current"); });
    }
    function go(i, smooth) {
      var n = (i + count) % count;
      mark(n);
      track.scrollTo({ left: n * track.clientWidth, behavior: smooth === false || reduce ? "auto" : "smooth" });
    }
    function tick() { if (playing && !held && !d.hidden) go(index + 1); }
    function sync() {
      root.setAttribute("aria-live", playing ? "off" : "polite"); // a moving slider must not chatter; a still one may announce
      if (toggle) {
        toggle.setAttribute("aria-pressed", playing ? "false" : "true");
        toggle.setAttribute("aria-label", toggle.getAttribute(playing ? "data-pause" : "data-play"));
        toggle.classList.toggle("is-paused", !playing);
      }
      window.clearInterval(timer);
      if (playing) timer = window.setInterval(tick, 6000);
    }

    var raf = 0;
    track.addEventListener("scroll", function () {
      if (raf) return;
      raf = window.requestAnimationFrame(function () {
        raf = 0;
        var i = Math.round(track.scrollLeft / track.clientWidth);
        if (i !== index && i >= 0 && i < count) mark(i);
      });
    }, { passive: true });

    each(dots, function (dot, n) { dot.addEventListener("click", function () { go(n); }); });
    var prev = root.querySelector("[data-prev]");
    var next = root.querySelector("[data-next]");
    if (prev) prev.addEventListener("click", function () { go(index - 1); });
    if (next) next.addEventListener("click", function () { go(index + 1); });
    if (toggle) toggle.addEventListener("click", function () { playing = !playing; sync(); });
    root.addEventListener("keydown", function (e) {
      if (e.target.closest && e.target.closest("a,button") && e.target !== track) return; // arrows belong to the buttons and links
      if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
    });
    ["mouseenter", "focusin", "touchstart"].forEach(function (ev) { root.addEventListener(ev, function () { held = true; }, { passive: true }); });
    ["mouseleave", "focusout", "touchend"].forEach(function (ev) { root.addEventListener(ev, function () { held = false; }, { passive: true }); });
    window.addEventListener("resize", function () { go(index, false); });
    sync();
  });

  /* ---------------------------------------------------------------------------------------- offer pop-up */
  var pop = d.querySelector("[data-offer]");
  if (!pop) return;
  var id = pop.getAttribute("data-id");
  var version = pop.getAttribute("data-v") || "";
  var days = Number(pop.getAttribute("data-days")) || 0; // 0 = ask once per visit, N = again after N days
  var delay = (Number(pop.getAttribute("data-delay")) || 0) * 1000;
  var store = function () { return days > 0 ? window.localStorage : window.sessionStorage; };
  var key = "mawah_offer_" + id;
  var lastFocus = null, openTimer = 0;

  function seen() {
    try {
      var rec = JSON.parse(store().getItem(key) || "null");
      // an edited banner (new version) is shown again; the same one only until its repeat time has passed
      return !!rec && rec.v === version && (days === 0 || Date.now() - rec.t < days * 864e5);
    } catch (e) { return false; }
  }
  function remember() {
    try { store().setItem(key, JSON.stringify({ v: version, t: Date.now() })); } catch (e) { /* private mode: it simply asks again next time */ }
  }
  function focusable() { return pop.querySelectorAll("a[href],button:not([disabled])"); }
  function open() {
    var a = d.activeElement;
    // never interrupt someone who is typing, or a chat window that is open
    if ((a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || d.querySelector(".mc-panel:not([hidden])")) { openTimer = window.setTimeout(open, 5000); return; }
    lastFocus = a;
    pop.hidden = false;
    d.documentElement.classList.add("offer-open");
    pop.classList.remove("is-open");
    window.requestAnimationFrame(function () { if (!pop.hidden) pop.classList.add("is-open"); });
    var f = focusable();
    if (f.length) f[0].focus();
  }
  function close() {
    window.clearTimeout(openTimer);
    if (pop.hidden) return;
    pop.hidden = true;
    d.documentElement.classList.remove("offer-open");
    remember();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  each(pop.querySelectorAll("[data-offer-close]"), function (b) { b.addEventListener("click", close); });
  pop.addEventListener("click", function (e) {
    if (e.target === pop) close(); // the dark area around the card
    var link = e.target.closest && e.target.closest("a[href]");
    if (link) remember(); // going to the offer counts as an answer: do not ask again
  });
  d.addEventListener("keydown", function (e) {
    if (pop.hidden) return;
    if (e.key === "Escape") { close(); return; }
    if (e.key !== "Tab") return;
    var f = focusable();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  window.MawahOffer = {
    close: close,
    suspend: function () { window.clearTimeout(openTimer); },
  };
  if (!seen()) openTimer = window.setTimeout(open, delay);
})();
