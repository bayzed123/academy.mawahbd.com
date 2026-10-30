/*
 * MAWAH Academy — a certificate's page (views/certificate.tsx, loaded only there). Two jobs:
 *   1. A name or a class longer than the sheet's line is narrowed to fit (the server chose the size from an estimate of the width).
 *   2. "Download picture": the very drawing on the page, with the fonts and the logo it uses put inside it, drawn twice as large into a
 *      picture (PNG) that downloads. Nothing leaves the browser: the fonts and the logo come from this website.
 * "Download PDF" is the browser's own print window (marketing/site.js), which sets Bangla letters right. The student app's buttons open the
 * page with ?download=png or ?print=1, and the page does that as soon as its fonts are in.
 */
(function () {
  "use strict";
  var d = document;
  var art = d.querySelector("[data-cert-art]");
  if (!art) return;
  var btn = d.querySelector("[data-cert-png]");
  var status = d.querySelector("[data-cert-status]");
  var ready = d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve();
  var SVG = "http://www.w3.org/2000/svg";

  function say(text) {
    if (status) status.textContent = text || "";
  }

  function fit() {
    Array.prototype.forEach.call(art.querySelectorAll("text[data-fit]"), function (t) {
      var max = Number(t.getAttribute("data-fit"));
      t.removeAttribute("textLength");
      t.removeAttribute("lengthAdjust");
      try {
        if (t.getComputedTextLength() > max) {
          t.setAttribute("textLength", String(max));
          t.setAttribute("lengthAdjust", "spacingAndGlyphs");
        }
      } catch (e) {
        /* not drawn (a hidden page): left as the server made it */
      }
    });
  }

  function base64(buf) {
    var bytes = new Uint8Array(buf), out = "", i;
    for (i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }
  function inline(url, type) {
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error(url);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        return "data:" + type + ";base64," + base64(buf);
      });
  }

  // the page's own @font-face rules for the drawing's fonts, each with its file inside (a picture made from a drawing cannot fetch anything)
  function fontRules() {
    var rules = [];
    Array.prototype.forEach.call(d.styleSheets, function (sheet) {
      var list;
      try {
        list = sheet.cssRules;
      } catch (e) {
        return;
      }
      Array.prototype.forEach.call(list || [], function (r) {
        if (r.type === 5 && /Hind Siliguri|Tiro Bangla|Playfair Display/.test(r.style.getPropertyValue("font-family"))) rules.push(r.cssText);
      });
    });
    return Promise.all(
      rules.map(function (css) {
        var m = /url\(["']?([^"')]+)["']?\)/.exec(css);
        if (!m) return "";
        return inline(m[1], "font/woff2").then(function (u) {
          return css.replace(m[0], 'url("' + u + '")');
        });
      }),
    ).then(function (all) {
      return all.join("\n");
    });
  }

  function draw(src) {
    return new Promise(function (ok, fail) {
      var img = new Image();
      img.onload = function () {
        // the fonts inside a drawing are set up as it loads: give them a moment before it is copied
        setTimeout(function () {
          ok(img);
        }, 120);
      };
      img.onerror = fail;
      img.src = src;
    });
  }

  var made = null;
  function picture() {
    if (made) return made;
    var logo = art.querySelector("image");
    made = Promise.all([fontRules(), logo ? inline(logo.getAttribute("href"), "image/webp") : Promise.resolve("")])
      .then(function (parts) {
        var copy = art.cloneNode(true);
        copy.setAttribute("xmlns", SVG);
        var style = d.createElementNS(SVG, "style");
        style.textContent = parts[0];
        copy.insertBefore(style, copy.firstChild);
        var img = copy.querySelector("image");
        if (img && parts[1]) img.setAttribute("href", parts[1]);
        return draw("data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(copy)));
      })
      .then(function (img) {
        var w = Number(art.getAttribute("width")), h = Number(art.getAttribute("height")), scale = 2;
        var canvas = d.createElement("canvas");
        canvas.width = w * scale;
        canvas.height = h * scale;
        var g = canvas.getContext("2d");
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        return new Promise(function (ok, fail) {
          canvas.toBlob(function (blob) {
            if (blob) ok(blob);
            else fail(new Error("no picture"));
          }, "image/png");
        });
      });
    made.catch(function () {
      made = null;
    });
    return made;
  }

  function save(blob) {
    var a = d.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (btn && btn.getAttribute("data-file")) || "certificate.png";
    d.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 10000);
  }

  if (btn && typeof HTMLCanvasElement !== "undefined" && HTMLCanvasElement.prototype.toBlob && window.fetch) {
    btn.hidden = false;
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      say(btn.getAttribute("data-making"));
      ready
        .then(fit)
        .then(picture)
        .then(
          function (blob) {
            save(blob);
            say("");
          },
          function () {
            say(btn.getAttribute("data-fail"));
          },
        )
        .then(function () {
          btn.disabled = false;
          btn.removeAttribute("aria-busy");
        });
    });
  }

  ready.then(function () {
    fit();
    var q = location.search;
    if (/[?&]download=png(&|$)/.test(q) && btn && !btn.hidden) btn.click();
    else if (/[?&]print=1(&|$)/.test(q)) window.print();
  });
})();
