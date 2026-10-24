/* MAWAH Equipment Shop — the cart and the wishlist on the shop's pages. Both live in this browser (localStorage), and hold only ids and
   quantities: every name and price at checkout comes from the website again (/app/shop/cart). Loaded only on the shop's pages.
   Without it (or without storage) the product pages still read and link as usual; only the cart buttons need it. */
(function () {
  "use strict";
  var d = document;
  var CART = "mawah_cart";
  var WISH = "mawah_wish";
  var MAX_QTY = 20;
  var MAX_LINES = 30;
  var bn = (d.documentElement.getAttribute("lang") || "") === "bn";
  var digits = function (n) {
    var s = String(n);
    return bn ? s.replace(/\d/g, function (c) { return "০১২৩৪৫৬৭৮৯".charAt(+c); }) : s;
  };
  var $ = function (s, r) { return (r || d).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); };

  // the grid's sorting takes effect as soon as it is chosen (its button stays for browsers without this script)
  $$("select[data-autosubmit]").forEach(function (sel) {
    var btn = sel.form && sel.form.querySelector("[data-autosubmit-btn]");
    if (btn) btn.hidden = true;
    sel.addEventListener("change", function () {
      if (sel.form.requestSubmit) sel.form.requestSubmit();
      else sel.form.submit();
    });
  });
  // on a phone the price and stock filters start folded, so the products come first (open again when one is in use)
  var filters = $("[data-shop-filters]");
  if (filters && window.matchMedia && window.matchMedia("(max-width: 899px)").matches && !/[?&](min|max|stock)=/.test(location.search)) filters.open = false;

  var store;
  try {
    store = window.localStorage;
    store.setItem("mawah_t", "1");
    store.removeItem("mawah_t");
  } catch (e) {
    store = null;
  }
  if (!store) {
    $$("[data-buy-hint]").forEach(function (el) { el.hidden = false; });
    return;
  }
  var read = function (key) {
    try {
      var v = JSON.parse(store.getItem(key) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  };
  var write = function (key, v) {
    try { store.setItem(key, JSON.stringify(v)); } catch (e) { /* full: nothing to do */ }
  };
  var cart = function () {
    return read(CART).filter(function (l) { return l && l.variant_id > 0 && l.qty > 0; });
  };

  function counts() {
    var n = cart().reduce(function (s, l) { return s + Math.min(MAX_QTY, l.qty | 0); }, 0);
    $$("[data-cart-count]").forEach(function (el) { el.textContent = digits(n); el.hidden = n === 0; });
    var w = read(WISH).length;
    $$("[data-wish-count]").forEach(function (el) { el.textContent = digits(w); el.hidden = w === 0; });
  }

  var toast = $("[data-shop-toast]");
  var toastTimer;
  function say(full) {
    if (!toast) return;
    var text = $("[data-toast-text]", toast);
    text.textContent = text.getAttribute(full ? "data-full" : "data-added");
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 6000);
  }

  /** Add `qty` of a weight to the cart; false when the cart cannot take it (too many different things). */
  function add(variantId, qty) {
    var list = cart();
    var line = list.filter(function (l) { return l.variant_id === variantId; })[0];
    if (line) line.qty = Math.min(MAX_QTY, line.qty + qty);
    else if (list.length >= MAX_LINES) return false;
    else list.push({ variant_id: variantId, qty: Math.min(MAX_QTY, qty) });
    write(CART, list);
    counts();
    return true;
  }

  /* "Add to cart" on a card: a product with one weight */
  $$("[data-add]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      say(!add(+btn.getAttribute("data-add"), 1));
    });
  });

  /* the product page: the weight chosen changes the price, the usual price, the "% off" and the stock line */
  var form = $("[data-buy-form]");
  if (form) {
    // the price on show (each weight's own price, usual price and stock are on its radio button as data-price, data-list …)
    var price = $("[data-now]");
    var list = $("[data-was]");
    var listAmount = $("[data-list-amount]");
    var off = $("[data-off]");
    var stockLine = $("[data-stock-line]");
    var qty = form.querySelector("input[name=qty]");
    var offTpl = form.getAttribute("data-off-tpl") || "-%n%";
    var leftTpl = form.getAttribute("data-left-tpl") || "%n";
    var inStockText = stockLine ? stockLine.getAttribute("data-in") || "" : "";
    $$("input[name=variant][type=radio]", form).forEach(function (r) {
      r.addEventListener("change", function () {
        if (!r.checked) return;
        price.textContent = r.getAttribute("data-price");
        var l = r.getAttribute("data-list");
        list.hidden = !l;
        listAmount.textContent = l;
        var pct = r.getAttribute("data-pct");
        off.hidden = !pct;
        off.textContent = pct ? offTpl.replace("%n", pct) : "";
        var stock = r.getAttribute("data-stock");
        // "Only 3 left" for five or fewer; otherwise the page's own "In stock"
        if (stockLine) stockLine.textContent = stock !== "" && Number(stock) <= 5 ? leftTpl.replace("%n", r.getAttribute("data-stock-label")) : inStockText;
      });
    });
    $$("[data-qty]", form).forEach(function (b) {
      b.addEventListener("click", function () {
        var v = Math.max(1, Math.min(MAX_QTY, (parseInt(qty.value, 10) || 1) + Number(b.getAttribute("data-qty"))));
        qty.value = String(v);
      });
    });
    var which = "add";
    $$("[data-buy]", form).forEach(function (b) {
      b.addEventListener("click", function () { which = b.getAttribute("data-buy"); });
    });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var chosen = form.querySelector("input[name=variant]:checked") || form.querySelector("input[name=variant][type=hidden]");
      if (!chosen) return;
      var n = Math.max(1, Math.min(MAX_QTY, parseInt(qty.value, 10) || 1));
      var okAdd = add(+chosen.value, n);
      if (which === "now" && okAdd) window.location.assign("/app/shop/cart");
      else say(!okAdd);
    });
  }

  /* the pictures: a small one shows large in the main frame */
  var main = $("[data-main-img]");
  $$("[data-thumb]").forEach(function (a) {
    a.addEventListener("click", function (ev) {
      if (!main) return;
      ev.preventDefault();
      main.src = a.getAttribute("data-thumb");
      $$("[data-thumb]").forEach(function (o) { o.removeAttribute("aria-current"); });
      a.setAttribute("aria-current", "true");
    });
  });

  /* the wishlist hearts */
  function paintWish() {
    var ids = read(WISH);
    $$("[data-wish]").forEach(function (b) {
      var on = ids.indexOf(+b.getAttribute("data-wish")) !== -1;
      b.hidden = false;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      var a = $("[data-wish-off]", b);
      var z = $("[data-wish-on]", b);
      if (a) a.hidden = on;
      if (z) z.hidden = !on;
    });
    counts();
  }
  $$("[data-wish]").forEach(function (b) {
    b.addEventListener("click", function () {
      var id = +b.getAttribute("data-wish");
      var ids = read(WISH);
      var at = ids.indexOf(id);
      if (at === -1) ids.unshift(id);
      else ids.splice(at, 1);
      write(WISH, ids.slice(0, 60));
      paintWish();
    });
  });
  // another tab changed the cart or the list
  window.addEventListener("storage", function (e) {
    if (e.key === CART || e.key === WISH) paintWish();
  });
  paintWish();
})();
