/* MAWAH Academy — shared day/night theme state. Runs before the first paint. */
(function () {
  "use strict";
  var KEY = "mawah_theme";
  var root = document.documentElement;
  function readStored() {
    try {
      var value = window.localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : "";
    } catch (e) {
      return "";
    }
  }
  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function apply(theme, persist) {
    var next = theme === "light" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    root.style.colorScheme = next;
    // the phone's address bar takes the page's own background (shared/styles/theme.css: ivory by day)
    var bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute("content", next === "light" ? "#fbf7ee" : "#000000");
    if (persist) {
      try { window.localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
    }
    root.dispatchEvent(new CustomEvent("mawah:theme", { bubbles: true, detail: { theme: next } }));
    return next;
  }
  var initial = readStored() || systemTheme();
  apply(initial, false);
  window.MawahTheme = {
    get: function () { return root.getAttribute("data-theme") || initial; },
    set: function (theme) { return apply(theme, true); },
    toggle: function () { return apply((root.getAttribute("data-theme") || initial) === "light" ? "dark" : "light", true); },
  };
})();
