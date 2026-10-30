/* MAWAH Academy — AI support assistant widget (vanilla JS; used by the public site AND the React apps).
   Never contains a key: it only talks to POST /api/chat on the same origin. */
(function () {
  "use strict";
  if (window.MawahChat) return;
  var d = document;
  var lang = (d.documentElement.lang || "bn").slice(0, 2) === "en" ? "en" : "bn";
  var T = {
    bn: { title: "মাওয়াহ সহকারী", ph: "আপনার প্রশ্ন লিখুন…", send: "পাঠান", close: "বন্ধ করুন", open: "সহকারীকে জিজ্ঞাসা করুন", busy: "উত্তর লেখা হচ্ছে…", err: "দুঃখিত, এখন উত্তর দেওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।", limit: "অনেকগুলো বার্তা পাঠানো হয়েছে। এক মিনিট পরে আবার চেষ্টা করুন।", hello: "আসসালামু আলাইকুম! ক্লাস, দাম বা সার্টিফিকেট নিয়ে প্রশ্ন করুন।", wa: "হোয়াটসঅ্যাপে সাপোর্টে কথা বলুন", supportTitle: "দ্রুত সাপোর্ট", whatsapp: "WhatsApp", messenger: "Messenger", bot: "AI Bot", botHint: "এখানেই প্রশ্ন করুন", note: "এটি একটি এআই সহকারী। পেমেন্ট ও রিফান্ডের সিদ্ধান্তে আমাদের টিমের সাথে কথা বলুন।",
      helpOpen: "আমাদের সাথে কথা বলুন", helpH: "আমাদের সাথে কথা বলুন", helpSub: "কীভাবে কথা বলতে চান, বেছে নিন।", waT: "হোয়াটসঅ্যাপ", waS: "আমাদের টিমের সাথে চ্যাট করুন", msT: "মেসেঞ্জার", msS: "আমাদের ফেসবুক পেজে মেসেজ দিন", aiT: "এআই সহকারী", aiS: "সঙ্গে সঙ্গে উত্তর, যেকোনো সময়", newTab: "নতুন ট্যাবে খুলবে" },
    en: { title: "MAWAH Assistant", ph: "Type your question…", send: "Send", close: "Close", open: "Ask our assistant", busy: "Writing…", err: "Sorry, I cannot answer right now. Please try again in a moment.", limit: "Too many messages. Please wait a minute and try again.", hello: "Hello! Ask me about classes, prices or certificates.", wa: "Talk to support on WhatsApp", supportTitle: "Need help quickly?", whatsapp: "WhatsApp", messenger: "Messenger", bot: "AI Bot", botHint: "Ask here", note: "This is an AI assistant. For payment or refund decisions, please talk to our team.",
      helpOpen: "Talk to us", helpH: "Talk to us", helpSub: "Choose how you would like to talk to us.", waT: "WhatsApp", waS: "Chat with our team", msT: "Messenger", msS: "Message our Facebook page", aiT: "AI assistant", aiS: "Answers right away, any time", newTab: "opens in a new tab" },
  }[lang];

  var history = [];
  try { history = JSON.parse(sessionStorage.getItem("mawah_chat") || "[]").slice(-12); } catch (e) { history = []; }
  var panel, list, input, form, sendBtn, opener, support, whatsappLink, messengerLink, lastFocus, whatsapp = "", greeting = T.hello, ready = false;

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
    // the ways to a person instead (WhatsApp, Messenger), above the conversation: each only once the site says it has one
    support = el("div", "mc-support"); support.setAttribute("aria-label", T.supportTitle);
    support.appendChild(el("span", "mc-support-title", T.supportTitle));
    var choices = el("div", "mc-support-grid");
    whatsappLink = supportChoice("whatsapp", T.whatsapp, T.wa, "#"); whatsappLink.classList.add("is-pending"); whatsappLink.setAttribute("aria-disabled", "true"); whatsappLink.addEventListener("click", function (e) { if (whatsappLink.classList.contains("is-pending")) e.preventDefault(); });
    messengerLink = supportChoice("messenger", T.messenger, "Facebook", "#"); messengerLink.hidden = true;
    var botChoice = supportChoice("bot", T.bot, T.botHint); botChoice.addEventListener("click", function () { input.focus(); });
    choices.appendChild(whatsappLink); choices.appendChild(messengerLink); choices.appendChild(botChoice); support.appendChild(choices);
    panel.appendChild(head); panel.appendChild(support); panel.appendChild(list); panel.appendChild(el("p", "mc-note", T.note)); panel.appendChild(form);
    d.body.appendChild(panel);
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
      if (j && j.site) {
        whatsapp = j.site.contact.whatsapp || "";
        if (whatsapp) { whatsappLink.href = "https://wa.me/" + whatsapp.replace(/\D/g, ""); whatsappLink.classList.remove("is-pending"); whatsappLink.removeAttribute("aria-disabled"); }
        else whatsappLink.hidden = true;
        if (j.site.contact.messenger) { messengerLink.href = j.site.contact.messenger; messengerLink.hidden = false; }
        // without a WhatsApp number or a Messenger address there is no one else to offer here
        if (whatsappLink.hidden && messengerLink.hidden) support.hidden = true;
        var g = j.site.greeting && j.site.greeting[lang]; if (g) greeting = g;
      }
    }).catch(function () {}).then(function () {
      add("assistant", greeting);
      history.forEach(function (m) { add(m.role, m.content); });
    });
  }

  /* `from` is what was pressed: a "[data-chat-open]" button (it says the window is open), or a choice in the talk-to-us card — the focus
     then comes back to the card's own round button, as the choice itself is folded away. While the window is open the round buttons in
     the corner step aside (shared/styles/help.css: they used to sit on its Send button), and an offer pop-up gives way. */
  function show(from) {
    if (window.MawahOffer) { window.MawahOffer.suspend(); window.MawahOffer.close(); }
    build();
    from = from && from.nodeType === 1 ? from : d.activeElement;
    var card = from && from.closest ? from.closest("[data-help]") : null;
    lastFocus = card ? card.querySelector("summary") : from;
    opener = from && from.matches && from.matches("[data-chat-open]") ? from : null;
    panel.hidden = false;
    d.documentElement.classList.add("chat-open");
    if (opener) { opener.setAttribute("aria-controls", "mawah-chat-panel"); opener.setAttribute("aria-expanded", "true"); }
    setTimeout(function () { input.focus(); }, 30);
  }
  function hide() {
    if (!panel) return;
    panel.hidden = true;
    d.documentElement.classList.remove("chat-open");
    if (opener) opener.setAttribute("aria-expanded", "false");
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

  /* In the React apps there is no server-rendered talk-to-us button: build the same one as the public site's (views/layout.tsx; its look is
     shared/styles/help.css, part of the app's stylesheet) — WhatsApp, Messenger and the assistant in a small card, or the one way alone. */
  var icon = function (name, cls) { return '<svg class="icon' + (cls ? " " + cls : "") + '" aria-hidden="true" focusable="false"><use href="/sprite.svg#i-' + name + '"></use></svg>'; };
  function talkToUs(site) {
    var c = site && site.contact ? site.contact : {};
    var wa = String(c.whatsapp || "").replace(/\D/g, "");
    var ways = [];
    if (wa) ways.push({ cls: "wa", href: "https://wa.me/" + wa, t: T.waT, s: T.waS, icon: "whatsapp" });
    if (c.messenger) ways.push({ cls: "ms", href: c.messenger, t: T.msT, s: T.msS, icon: "messenger" });
    // the assistant only while the owner has it switched on (Admin → AI chat), as on the site; with no answer from the server, it stays
    if (!site || site.chat_enabled !== false) ways.push({ cls: "ai", t: T.aiT, s: T.aiS, icon: "bot" });
    if (!ways.length) return;
    var corner = el("div", "floats mc-floats");
    if (ways.length === 1) {
      var w1 = ways[0], one = el(w1.href ? "a" : "button", "fab fab-" + (w1.href ? w1.cls : "chat"));
      var name1 = w1.href ? w1.t + " (" + T.newTab + ")" : T.open;
      if (w1.href) { one.href = w1.href; one.target = "_blank"; one.rel = "noopener noreferrer"; } else { one.type = "button"; one.setAttribute("data-chat-open", ""); one.onclick = function () { show(one); }; }
      one.setAttribute("aria-label", name1); one.title = name1; one.innerHTML = icon(w1.href ? w1.icon : "chat");
      corner.appendChild(one);
    } else {
      var box = el("details", "help"); box.setAttribute("data-help", "");
      var sum = el("summary", "fab fab-help"); sum.setAttribute("aria-label", T.helpOpen); sum.title = T.helpOpen; sum.innerHTML = icon("chat", "chat") + icon("x", "x");
      var pop = el("div", "help-pop"); pop.setAttribute("role", "group"); pop.setAttribute("aria-label", T.helpH);
      pop.appendChild(el("p", "help-h", T.helpH)); pop.appendChild(el("p", "help-sub", T.helpSub));
      var list = el("ul", "help-list");
      ways.forEach(function (w) {
        var li = el("li"), o = el(w.href ? "a" : "button", "help-opt help-" + w.cls);
        if (w.href) { o.href = w.href; o.target = "_blank"; o.rel = "noopener noreferrer"; } else o.type = "button";
        o.innerHTML = '<span class="help-ico">' + icon(w.icon) + '</span><span class="help-txt"><b></b><small></small></span>' + icon("arrow", "help-go");
        o.querySelector("b").textContent = w.t;
        o.querySelector("small").textContent = w.s;
        if (w.href) { var vh = el("span", "vh", " (" + T.newTab + ")"); o.querySelector("b").appendChild(vh); }
        o.addEventListener("click", function () { if (!w.href) show(o); box.open = false; });
        li.appendChild(o); list.appendChild(li);
      });
      pop.appendChild(list);
      box.appendChild(sum); box.appendChild(pop); corner.appendChild(box);
      d.addEventListener("keydown", function (e) { if (e.key === "Escape" && box.open) { box.open = false; sum.focus(); } });
      d.addEventListener("click", function (e) { if (box.open && !box.contains(e.target)) box.open = false; });
    }
    d.body.appendChild(corner);
  }
  d.addEventListener("DOMContentLoaded", function () {
    if (d.querySelector("[data-chat-open], [data-help]") || d.documentElement.hasAttribute("data-no-chat-launcher")) return;
    fetch("/api/site", { credentials: "omit" }).then(function (r) { return r.json(); }).then(function (j) { talkToUs(j && j.site); }).catch(function () { talkToUs(null); });
  });
})();
