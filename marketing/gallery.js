/* MAWAH Academy — the class page's pictures: a full-screen viewer for the main picture and the ones under it.
   Optional: without this file (or in a browser without <dialog>) every picture is an ordinary link that opens the picture itself. */
(function () {
  "use strict";
  var d = document;
  var dlg = d.querySelector("[data-lightbox]");
  var links = Array.prototype.slice.call(d.querySelectorAll("[data-gallery-item]"));
  if (!dlg || !links.length || typeof dlg.showModal !== "function") return;
  var img = dlg.querySelector("[data-lb-img]");
  var cap = dlg.querySelector("[data-lb-cap]");
  var count = dlg.querySelector("[data-lb-count]");
  var fig = dlg.querySelector("[data-lb-fig]");
  var prev = dlg.querySelector("[data-lb-prev]");
  var next = dlg.querySelector("[data-lb-next]");
  var tpl = dlg.getAttribute("data-count") || "%n / %t";
  var bn = (d.documentElement.getAttribute("lang") || "") === "bn";
  var digits = function (n) {
    var s = String(n);
    return bn ? s.replace(/\d/g, function (c) { return "০১২৩৪৫৬৭৮৯".charAt(+c); }) : s;
  };
  var many = links.length > 1;
  var index = 0;
  var opener = null;
  if (!many) { prev.hidden = true; next.hidden = true; }

  function href(i) { return links[(i + links.length) % links.length].getAttribute("href"); }
  function show(i) {
    index = (i + links.length) % links.length;
    var a = links[index];
    img.alt = a.getAttribute("data-alt") || "";
    img.src = href(index);
    cap.textContent = a.getAttribute("data-caption") || "";
    count.textContent = tpl.replace("%n", digits(index + 1)).replace("%t", digits(links.length));
    if (many) { // the next and the previous picture are fetched while this one is looked at
      new Image().src = href(index + 1);
      new Image().src = href(index - 1);
    }
  }
  function open(i, from) {
    opener = from;
    show(i);
    d.documentElement.classList.add("lb-open");
    dlg.showModal();
  }

  links.forEach(function (a, i) {
    a.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // "open in a new tab" still works
      e.preventDefault();
      open(i, a);
    });
  });
  prev.addEventListener("click", function () { show(index - 1); });
  next.addEventListener("click", function () { show(index + 1); });
  dlg.querySelector("[data-lb-close]").addEventListener("click", function () { dlg.close(); });
  // the dark area around the picture closes it, like Escape (which the browser handles itself)
  dlg.addEventListener("click", function (e) { if (e.target === dlg || e.target === fig) dlg.close(); });
  dlg.addEventListener("close", function () {
    d.documentElement.classList.remove("lb-open");
    img.removeAttribute("src");
    if (opener && opener.focus) opener.focus();
  });
  dlg.addEventListener("keydown", function (e) {
    if (e.key === "Tab") { // the keyboard goes round inside the viewer (the page behind it is not reachable)
      var f = dlg.querySelectorAll("button:not([hidden])");
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (!many) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); show(index - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); show(index + 1); }
  });
  // a swipe moves to the next or the previous picture
  var x0 = null;
  dlg.addEventListener("touchstart", function (e) { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  dlg.addEventListener("touchend", function (e) {
    if (x0 === null || !many) return;
    var dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
  }, { passive: true });
})();
