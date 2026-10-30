/* MAWAH Academy — AI support assistant widget (vanilla JS; used by the public site AND the React apps).
   Never contains a key: it only talks to POST /api/chat on the same origin. */
(function () {
  "use strict";
  if (window.MawahChat) return;
  var d = document;
  var lang = (d.documentElement.lang || "bn").slice(0, 2) === "en" ? "en" : "bn";
  var T = {
    bn: { title: "মাওয়াহ সহকারী", ph: "আপনার প্রশ্ন লিখুন…", send: "পাঠান", close: "বন্ধ করুন", open: "সহকারীকে জিজ্ঞাসা করুন", busy: "উত্তর লেখা হচ্ছে…", err: "দুঃখিত, এখন উত্তর দেওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।", limit: "অনেকগুলো বার্তা পাঠানো হয়েছে। এক মিনিট পরে আবার চেষ্টা করুন।", hello: "আসসালামু আলাইকুম! ক্লাস, দাম বা সার্টিফিকেট নিয়ে প্রশ্ন করুন।", wa: "হোয়াটসঅ্যাপে সাপোর্টে কথা বলুন", note: "এটি একটি এআই সহকারী। পেমেন্ট ও রিফান্ডের সিদ্ধান্তে আমাদের টিমের সাথে কথা বলুন।",
      helpOpen: "আমাদের সাথে কথা বলুন", helpH: "আমাদের সাথে কথা বলুন", helpSub: "কীভাবে কথা বলতে চান, বেছে নিন।", waT: "হোয়াটসঅ্যাপ", waS: "আমাদের টিমের সাথে চ্যাট করুন", msT: "মেসেঞ্জার", msS: "আমাদের ফেসবুক পেজে মেসেজ দিন", aiT: "এআই সহকারী", aiS: "সঙ্গে সঙ্গে উত্তর, যেকোনো সময়", newTab: "নতুন ট্যাবে খুলবে" },
    en: { title: "MAWAH Assistant", ph: "Type your question…", send: "Send", close: "Close", open: "Ask our assistant", busy: "Writing…", err: "Sorry, I cannot answer right now. Please try again in a moment.", limit: "Too many messages. Please wait a minute and try again.", hello: "Hello! Ask me about classes, prices or certificates.", wa: "Talk to support on WhatsApp", note: "This is an AI assistant. For payment or refund decisions, please talk to our team.",
      helpOpen: "Talk to us", helpH: "Talk to us", helpSub: "Choose how you would like to talk to us.", waT: "WhatsApp", waS: "Chat with our team", msT: "Messenger", msS: "Message our Facebook page", aiT: "AI assistant", aiS: "Answers right away, any time", newTab: "opens in a new tab" },
  }[lang];

  var history = [];
  try { history = JSON.parse(sessionStorage.getItem("mawah_chat") || "[]").slice(-12); } catch (e) { history = []; }
  var panel, list, input, form, sendBtn, whatsapp = "", greeting = T.hello, ready = false;

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

  function build() {
    if (ready) return;
    ready = true;
    var css = d.createElement("link"); css.rel = "stylesheet"; css.href = "/chat.css"; d.head.appendChild(css);
    panel = el("section", "mc-panel"); panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", T.title); panel.hidden = true;
    var head = el("header", "mc-head"); head.appendChild(el("b", "", T.title));
    var close = el("button", "mc-x", "×"); close.type = "button"; close.setAttribute("aria-label", T.close); close.onclick = hide; head.appendChild(close);
    list = el("div", "mc-list"); list.setAttribute("role", "log"); list.setAttribute("aria-live", "polite");
    form = el("form", "mc-form"); input = el("input", "mc-in"); input.type = "text"; input.maxLength = 500; input.placeholder = T.ph; input.setAttribute("aria-label", T.ph); input.autocomplete = "off";
    sendBtn = el("button", "mc-send", T.send); sendBtn.type = "submit"; form.appendChild(input); form.appendChild(sendBtn);
    panel.appendChild(head); panel.appendChild(list); panel.appendChild(el("p", "mc-note", T.note)); panel.appendChild(form);
    d.body.appendChild(panel);
    form.addEventListener("submit", function (e) { e.preventDefault(); send(); });
    d.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) hide(); });
    fetch("/api/site", { credentials: "omit" }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.site) { whatsapp = j.site.contact.whatsapp || ""; var g = j.site.greeting && j.site.greeting[lang]; if (g) greeting = g; }
    }).catch(function () {}).then(function () {
      add("assistant", greeting);
      history.forEach(function (m) { add(m.role, m.content); });
    });
  }

  // while the window is open the round buttons in the corner step aside (shared/styles/help.css): they used to sit on its Send button
  function show() { build(); panel.hidden = false; d.documentElement.classList.add("chat-open"); setTimeout(function () { input.focus(); }, 30); }
  function hide() { if (panel) panel.hidden = true; d.documentElement.classList.remove("chat-open"); }

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
  function launcher(site) {
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
      if (w1.href) { one.href = w1.href; one.target = "_blank"; one.rel = "noopener noreferrer"; } else { one.type = "button"; one.onclick = show; }
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
        o.addEventListener("click", function () { box.open = false; if (!w.href) show(); });
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
    fetch("/api/site", { credentials: "omit" }).then(function (r) { return r.json(); }).then(function (j) { launcher(j && j.site); }).catch(function () { launcher(null); });
  });
})();
