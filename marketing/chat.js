/* MAWAH Academy — AI support assistant widget (vanilla JS; used by the public site AND the React apps).
   Never contains a key: it only talks to POST /api/chat on the same origin. */
(function () {
  "use strict";
  if (window.MawahChat) return;
  var d = document;
  var lang = (d.documentElement.lang || "bn").slice(0, 2) === "en" ? "en" : "bn";
  var T = {
    bn: { title: "মাওয়াহ সহকারী", ph: "আপনার প্রশ্ন লিখুন…", send: "পাঠান", close: "বন্ধ করুন", open: "সহকারীকে জিজ্ঞাসা করুন", busy: "উত্তর লেখা হচ্ছে…", err: "দুঃখিত, এখন উত্তর দেওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।", limit: "অনেকগুলো বার্তা পাঠানো হয়েছে। এক মিনিট পরে আবার চেষ্টা করুন।", hello: "আসসালামু আলাইকুম! ক্লাস, দাম বা সার্টিফিকেট নিয়ে প্রশ্ন করুন।", wa: "হোয়াটসঅ্যাপে সাপোর্টে কথা বলুন", supportTitle: "দ্রুত সাপোর্ট", whatsapp: "WhatsApp", messenger: "Messenger", bot: "AI Bot", botHint: "এখানেই প্রশ্ন করুন", note: "এটি একটি এআই সহকারী। পেমেন্ট ও রিফান্ডের সিদ্ধান্তে আমাদের টিমের সাথে কথা বলুন।" },
    en: { title: "MAWAH Assistant", ph: "Type your question…", send: "Send", close: "Close", open: "Ask our assistant", busy: "Writing…", err: "Sorry, I cannot answer right now. Please try again in a moment.", limit: "Too many messages. Please wait a minute and try again.", hello: "Hello! Ask me about classes, prices or certificates.", wa: "Talk to support on WhatsApp", supportTitle: "Need help quickly?", whatsapp: "WhatsApp", messenger: "Messenger", bot: "AI Bot", botHint: "Ask here", note: "This is an AI assistant. For payment or refund decisions, please talk to our team." },
  }[lang];
  var MESSENGER_URL = "https://www.facebook.com/mawahcookingschool/?rdid=MRdfBI65oWmOpDDh";

  var history = [];
  try { history = JSON.parse(sessionStorage.getItem("mawah_chat") || "[]").slice(-12); } catch (e) { history = []; }
  var panel, list, input, form, sendBtn, launcher, whatsappLink, lastFocus, whatsapp = "", greeting = T.hello, ready = false;

  function el(tag, cls, text) { var n = d.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  function save() { try { sessionStorage.setItem("mawah_chat", JSON.stringify(history.slice(-12))); } catch (e) { /* private mode */ } }

  /* assistant text -> safe DOM (no innerHTML): paragraphs, **bold**, and clickable http(s) links */
  function rich(target, text) {
    text.split(/\n{2,}/).forEach(function (para) {
      var p = el("p");
      para.split(/(https?:\/\/[^\s<>)]+|\*\*[^*]+\*\*)/g).forEach(function (part) {
        if (!part) return;
        if (/^https?:\/\//.test(part)) {
          var a = el("a", "", part); a.href = part; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; p.appendChild(a);
        } else if (/^\*\*[^*]+\*\*$/.test(part)) p.appendChild(el("strong", "", part.slice(2, -2)));
        else {
          part.split("\n").forEach(function (line, i) { if (i) p.appendChild(d.createElement("br")); p.appendChild(d.createTextNode(line)); });
        }
      });
      target.appendChild(p);
    });
  }

  function add(role, text, escalate) {
    var b = el("div", "mc-msg mc-" + role);
    if (role === "assistant") rich(b, text); else b.textContent = text;
    if (escalate && whatsapp) {
      var a = el("a", "mc-wa", T.wa); a.href = "https://wa.me/" + whatsapp.replace(/\D/g, ""); a.target = "_blank"; a.rel = "noopener noreferrer"; b.appendChild(a);
    }
    list.appendChild(b);
    list.scrollTop = list.scrollHeight;
    return b;
  }

  function supportIcon(kind) {
    var span = el("span", "mc-support-icon mc-support-" + kind);
    span.setAttribute("aria-hidden", "true");
    if (kind === "whatsapp") span.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 3.2a8.7 8.7 0 0 0-7.5 13l-1 3.3 3.4-1A8.7 8.7 0 1 0 12 3.2Z"/><path d="M8.9 8.1c.2-.3.4-.3.7-.3h.4c.2 0 .3.1.4.4l.6 1.4c.1.2 0 .4-.1.6l-.5.6c.5 1 1.3 1.7 2.3 2.2l.6-.5c.2-.2.4-.2.6-.1l1.4.7c.2.1.3.2.3.4v.4c0 .3-.1.5-.4.7-.4.3-1 .4-1.4.2-2.5-.6-4.4-2.5-5.5-4.5-.2-.4-.2-1 0-1.4Z"/></svg>';
    else if (kind === "messenger") span.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 3.4c-5.1 0-9 3.6-9 8.2 0 2.6 1.3 5 3.5 6.5v2.5l2.6-1.4c.9.3 1.9.5 2.9.5 5.1 0 9-3.6 9-8.2s-3.9-8.1-9-8.1Z"/><path d="m7.2 13.4 3-3.2 1.9 1.7 3.6-2-3 3.3-1.9-1.7-3.6 1.9Z"/></svg>';
    else span.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><rect x="4" y="5" width="16" height="14" rx="4"/><path d="M8 5V3m8 2V3M8 12h.01M12 12h.01M16 12h.01M9 16h6"/></svg>';
    return span;
  }

  function supportChoice(kind, label, hint, href) {
    var node = href ? el("a", "mc-support-choice mc-support-link") : el("button", "mc-support-choice");
    if (!href) node.type = "button";
    node.appendChild(supportIcon(kind));
    var copy = el("span", "mc-support-copy"); copy.appendChild(el("strong", "", label)); copy.appendChild(el("small", "", hint)); node.appendChild(copy);
    if (href) { node.href = href; node.target = "_blank"; node.rel = "noopener noreferrer"; }
    return node;
  }

  function build() {
    if (ready) return;
    ready = true;
    var css = d.createElement("link"); css.rel = "stylesheet"; css.href = "/chat.css"; d.head.appendChild(css);
    panel = el("section", "mc-panel"); panel.id = "mawah-chat-panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-labelledby", "mawah-chat-title"); panel.hidden = true;
    var head = el("header", "mc-head"); var title = el("b", "", T.title); title.id = "mawah-chat-title"; head.appendChild(title);
    var close = el("button", "mc-x", "×"); close.type = "button"; close.setAttribute("aria-label", T.close); close.onclick = hide; head.appendChild(close);
    list = el("div", "mc-list"); list.setAttribute("role", "log"); list.setAttribute("aria-live", "polite");
    form = el("form", "mc-form"); input = el("input", "mc-in"); input.type = "text"; input.maxLength = 500; input.placeholder = T.ph; input.setAttribute("aria-label", T.ph); input.autocomplete = "off";
    sendBtn = el("button", "mc-send", T.send); sendBtn.type = "submit"; form.appendChild(input); form.appendChild(sendBtn);
    var support = el("div", "mc-support"); support.setAttribute("aria-label", T.supportTitle);
    support.appendChild(el("span", "mc-support-title", T.supportTitle));
    var choices = el("div", "mc-support-grid");
    whatsappLink = supportChoice("whatsapp", T.whatsapp, T.wa, "#"); whatsappLink.classList.add("is-pending"); whatsappLink.setAttribute("aria-disabled", "true"); whatsappLink.addEventListener("click", function (e) { if (whatsappLink.classList.contains("is-pending")) e.preventDefault(); });
    var messengerLink = supportChoice("messenger", T.messenger, "Facebook", MESSENGER_URL);
    var botChoice = supportChoice("bot", T.bot, T.botHint); botChoice.addEventListener("click", function () { input.focus(); });
    choices.appendChild(whatsappLink); choices.appendChild(messengerLink); choices.appendChild(botChoice); support.appendChild(choices);
    panel.appendChild(head); panel.appendChild(support); panel.appendChild(list); panel.appendChild(el("p", "mc-note", T.note)); panel.appendChild(form);
    d.body.appendChild(panel);
    launcher = launcher || d.querySelector("[data-chat-open]");
    if (launcher) { launcher.setAttribute("aria-controls", "mawah-chat-panel"); launcher.setAttribute("aria-expanded", "false"); }
    form.addEventListener("submit", function (e) { e.preventDefault(); send(); });
    d.addEventListener("keydown", function (e) {
      if (!panel || panel.hidden) return;
      if (e.key === "Escape") return hide();
      if (e.key !== "Tab") return;
      var focusable = Array.prototype.slice.call(panel.querySelectorAll("button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex='-1'])")).filter(function (node) { return !node.hidden; });
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    fetch("/api/site", { credentials: "omit" }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.site) { whatsapp = j.site.contact.whatsapp || ""; if (whatsapp) { whatsappLink.href = "https://wa.me/" + whatsapp.replace(/\D/g, ""); whatsappLink.classList.remove("is-pending"); whatsappLink.removeAttribute("aria-disabled"); } var g = j.site.greeting && j.site.greeting[lang]; if (g) greeting = g; }
    }).catch(function () {}).then(function () {
      add("assistant", greeting);
      history.forEach(function (m) { add(m.role, m.content); });
    });
  }

  function show() {
    if (window.MawahOffer) { window.MawahOffer.suspend(); window.MawahOffer.close(); }
    build();
    lastFocus = d.activeElement;
    panel.hidden = false;
    d.documentElement.classList.add("chat-open");
    if (launcher) { launcher.setAttribute("aria-expanded", "true"); launcher.setAttribute("aria-hidden", "true"); launcher.dataset.previousTabindex = launcher.getAttribute("tabindex") || ""; launcher.setAttribute("tabindex", "-1"); }
    setTimeout(function () { input.focus(); }, 30);
  }
  function hide() {
    if (!panel) return;
    panel.hidden = true;
    d.documentElement.classList.remove("chat-open");
    if (launcher) { launcher.setAttribute("aria-expanded", "false"); launcher.removeAttribute("aria-hidden"); if (launcher.dataset.previousTabindex) launcher.setAttribute("tabindex", launcher.dataset.previousTabindex); else launcher.removeAttribute("tabindex"); }
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus({ preventScroll: true });
  }

  function send() {
    var text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    input.value = "";
    add("user", text);
    history.push({ role: "user", content: text });
    if (window.mawahTrack) window.mawahTrack("chatbot_message", { turn: history.filter(function (m) { return m.role === "user"; }).length }); // how many questions — never what was asked
    sendBtn.disabled = true;
    var typing = add("assistant", T.busy);
    typing.classList.add("mc-typing");
    var ctx = window.MAWAH_CHAT || {};
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ messages: history.slice(-8), lang: lang, course_id: ctx.courseId || undefined }),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        typing.remove();
        if (res.status === 429) return add("assistant", T.limit);
        if (!res.body || !res.body.ok) return add("assistant", T.err);
        history.push({ role: "assistant", content: res.body.reply });
        save();
        if (res.body.escalate && window.mawahTrack) window.mawahTrack("chatbot_handoff");
        add("assistant", res.body.reply, res.body.escalate);
      })
      .catch(function () { typing.remove(); add("assistant", T.err); })
      .then(function () { sendBtn.disabled = false; input.focus(); });
  }

  window.MawahChat = { open: show, close: hide };

  /* In the React apps there is no server-rendered launcher: add one. */
  d.addEventListener("DOMContentLoaded", function () {
    if (d.querySelector("[data-chat-open]") || d.documentElement.hasAttribute("data-no-chat-launcher")) return;
    var css = d.createElement("link"); css.rel = "stylesheet"; css.href = "/chat.css"; d.head.appendChild(css);
    var b = el("button", "mc-launch"); launcher = b; b.type = "button"; b.setAttribute("aria-label", T.open); b.setAttribute("aria-controls", "mawah-chat-panel"); b.setAttribute("aria-expanded", "false"); b.title = T.open;
    b.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4.5h12A2.5 2.5 0 0 1 20.5 7v7.5A2.5 2.5 0 0 1 18 17h-6l-4.5 3.5V17H6a2.5 2.5 0 0 1-2.5-2.5V7A2.5 2.5 0 0 1 6 4.5z"/><path d="M8.5 9.5h7M8.5 12.5h4"/></svg>';
    b.onclick = show;
    d.body.appendChild(b);
  });
})();
