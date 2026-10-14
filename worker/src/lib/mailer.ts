import { isDev, type Env } from "../env";
import { escapeHtml } from "./html";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailResult {
  ok: boolean;
  provider: "resend" | "dev-outbox" | "none";
  error?: string;
}

/**
 * Transactional e-mail through Resend's HTTPS API (RESEND_API_KEY is a Wrangler secret).
 * In development with no key, messages are kept in a KV "outbox" so flows (password reset, receipts)
 * can be tested end to end without sending anything.
 */
export async function sendMail(env: Env, msg: MailMessage): Promise<MailResult> {
  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      });
      if (!res.ok) return { ok: false, provider: "resend", error: `resend_${res.status}` };
      return { ok: true, provider: "resend" };
    } catch (err) {
      return { ok: false, provider: "resend", error: err instanceof Error ? err.message : "network" };
    }
  }
  if (isDev(env)) {
    const key = `outbox:${String(Date.now()).padStart(14, "0")}:${Math.random().toString(36).slice(2, 8)}`;
    await env.KV.put(key, JSON.stringify({ ...msg, at: new Date().toISOString() }), { expirationTtl: 3600 });
    return { ok: true, provider: "dev-outbox" };
  }
  console.warn("mail_not_configured", msg.subject);
  return { ok: false, provider: "none", error: "RESEND_API_KEY missing" };
}

/**
 * Many messages at once (launch announcements). Resend's batch endpoint takes up to 100 per call, which keeps a
 * 500-person launch to five subrequests. If a batch is refused (one bad address spoils it) we fall back to
 * one-by-one so a single typo can never block everyone else. Returns one boolean per input message.
 */
export async function sendBatch(env: Env, msgs: MailMessage[]): Promise<boolean[]> {
  const results: boolean[] = new Array(msgs.length).fill(false);
  if (!env.RESEND_API_KEY) {
    for (let i = 0; i < msgs.length; i++) results[i] = (await sendMail(env, msgs[i])).ok;
    return results;
  }
  for (let start = 0; start < msgs.length; start += 100) {
    const chunk = msgs.slice(start, start + 100);
    let batchOk = false;
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((m) => ({ from: env.MAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }))),
      });
      batchOk = res.ok;
    } catch {
      batchOk = false;
    }
    if (batchOk) {
      for (let i = 0; i < chunk.length; i++) results[start + i] = true;
    } else {
      for (let i = 0; i < chunk.length; i++) results[start + i] = (await sendMail(env, chunk[i])).ok;
    }
  }
  return results;
}

export async function readOutbox(env: Env, to?: string): Promise<(MailMessage & { at: string })[]> {
  const list = await env.KV.list({ prefix: "outbox:", limit: 100 });
  const rows = await Promise.all(list.keys.map((k) => env.KV.get<MailMessage & { at: string }>(k.name, "json")));
  return rows.filter((r): r is MailMessage & { at: string } => !!r && (!to || r.to.toLowerCase() === to.toLowerCase()));
}

/* ------------------------------------------------------------------------------------------------
 * Branded templates (black / red / gold / ivory — the colours of the logo), bilingual. Table layout + inline styles for mail clients.
 * ---------------------------------------------------------------------------------------------- */
type Lang = "bn" | "en";

function layout(lang: Lang, title: string, bodyHtml: string, brand: string): string {
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f5efe1;font-family:'Hind Siliguri',Segoe UI,Arial,sans-serif;color:#1b1213">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe1;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fffdf8;border-radius:16px;overflow:hidden;border:1px solid #e6dfcc">
<tr><td style="background:#070304;padding:22px 28px;color:#e6dc8c;font-size:20px;letter-spacing:.12em;font-weight:600">${escapeHtml(brand)}</td></tr>
<tr><td style="height:3px;background:#db1718"></td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#070304">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:22px 0"><a href="${escapeHtml(href)}" style="background:#db1718;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;display:inline-block">${escapeHtml(label)}</a></p>`;

const brandName = (lang: Lang) => (lang === "bn" ? "মাওয়াহ একাডেমি" : "MAWAH Academy");

export function passwordResetMail(lang: Lang, link: string): Omit<MailMessage, "to"> {
  const subject = lang === "bn" ? "পাসওয়ার্ড রিসেট করুন" : "Reset your password";
  const intro =
    lang === "bn"
      ? "আপনার অ্যাকাউন্টের পাসওয়ার্ড রিসেটের অনুরোধ পাওয়া গেছে। নিচের বোতামে ক্লিক করে নতুন পাসওয়ার্ড দিন। লিংকটি ১ ঘণ্টা পর্যন্ত কাজ করবে।"
      : "We received a request to reset your account password. Press the button below to choose a new one. The link works for 1 hour.";
  const ignore = lang === "bn" ? "আপনি অনুরোধ না করলে এই ইমেইল উপেক্ষা করুন।" : "If you did not request this, you can ignore this email.";
  const label = lang === "bn" ? "নতুন পাসওয়ার্ড দিন" : "Choose a new password";
  return {
    subject: `${subject} — ${brandName(lang)}`,
    html: layout(lang, subject, `<p style="font-size:16px;line-height:1.6">${escapeHtml(intro)}</p>${button(link, label)}<p style="color:#6d5f60;font-size:14px">${escapeHtml(ignore)}</p>`, brandName(lang)),
    text: `${intro}\n\n${link}\n\n${ignore}`,
  };
}

export function orderReceiptMail(
  lang: Lang,
  d: { name: string; invoiceNo: string; total: string; items: string[]; learnUrl: string; invoiceUrl: string },
): Omit<MailMessage, "to"> {
  const subject = lang === "bn" ? "ভর্তি নিশ্চিত হয়েছে" : "Your enrollment is confirmed";
  const hello = lang === "bn" ? `আসসালামু আলাইকুম ${d.name},` : `Hello ${d.name},`;
  const intro =
    lang === "bn"
      ? "আপনার পেমেন্ট সফলভাবে যাচাই হয়েছে এবং ক্লাসে ভর্তি নিশ্চিত হয়েছে। এখনই শেখা শুরু করতে পারেন।"
      : "Your payment is verified and your enrollment is confirmed. You can start learning right now.";
  const list = d.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  const meta =
    lang === "bn"
      ? `<p style="color:#4a3d3e">ইনভয়েস: <b>${escapeHtml(d.invoiceNo)}</b> · মোট: <b>${escapeHtml(d.total)}</b></p>`
      : `<p style="color:#4a3d3e">Invoice: <b>${escapeHtml(d.invoiceNo)}</b> · Total: <b>${escapeHtml(d.total)}</b></p>`;
  const cta = lang === "bn" ? "ক্লাস শুরু করুন" : "Start learning";
  const inv = lang === "bn" ? "ইনভয়েস দেখুন" : "View invoice";
  return {
    subject: `${subject} — ${d.invoiceNo}`,
    html: layout(
      lang,
      subject,
      `<p style="font-size:16px">${escapeHtml(hello)}</p><p style="font-size:16px;line-height:1.6">${escapeHtml(intro)}</p><ul style="line-height:1.8">${list}</ul>${meta}${button(d.learnUrl, cta)}<p><a href="${escapeHtml(d.invoiceUrl)}" style="color:#b50f12">${escapeHtml(inv)}</a></p>`,
      brandName(lang),
    ),
    text: `${hello}\n${intro}\n\n${d.items.join("\n")}\n\n${d.invoiceNo} · ${d.total}\n${d.learnUrl}\n${d.invoiceUrl}`,
  };
}

export function manualPaymentReceivedMail(lang: Lang, d: { name: string; total: string }): Omit<MailMessage, "to"> {
  const subject = lang === "bn" ? "পেমেন্টের তথ্য পেয়েছি" : "We received your payment details";
  const body =
    lang === "bn"
      ? `আপনার পেমেন্টের তথ্য (${d.total}) আমরা পেয়েছি। যাচাই শেষ হলেই ক্লাস চালু হয়ে যাবে এবং আপনাকে ইমেইলে জানানো হবে।`
      : `We received your payment details (${d.total}). As soon as we verify them your class will open and we will email you.`;
  return {
    subject: `${subject} — ${brandName(lang)}`,
    html: layout(lang, subject, `<p style="font-size:16px;line-height:1.6">${escapeHtml(body)}</p>`, brandName(lang)),
    text: body,
  };
}

export function classLaunchMail(lang: Lang, d: { title: string; url: string }): Omit<MailMessage, "to"> {
  const subject = lang === "bn" ? `চালু হয়েছে: ${d.title}` : `Now open: ${d.title}`;
  const body =
    lang === "bn"
      ? "আপনি যে ক্লাসটির জন্য অপেক্ষা করছিলেন, সেটি এখন ভর্তির জন্য খোলা হয়েছে।"
      : "The class you were waiting for is now open for enrollment.";
  const label = lang === "bn" ? "ক্লাসটি দেখুন" : "See the class";
  return {
    subject,
    html: layout(lang, subject, `<p style="font-size:16px;line-height:1.6">${escapeHtml(body)}</p>${button(d.url, label)}`, brandName(lang)),
    text: `${body}\n\n${d.url}`,
  };
}

export function contactAckMail(lang: Lang, d: { name: string }): Omit<MailMessage, "to"> {
  const subject = lang === "bn" ? "আপনার বার্তা পেয়েছি" : "We got your message";
  const body =
    lang === "bn" ? `${d.name}, আপনার বার্তার জন্য ধন্যবাদ। আমরা শীঘ্রই উত্তর দেব।` : `Thank you ${d.name}. We will reply soon.`;
  return {
    subject: `${subject} — ${brandName(lang)}`,
    html: layout(lang, subject, `<p style="font-size:16px;line-height:1.6">${escapeHtml(body)}</p>`, brandName(lang)),
    text: body,
  };
}

export function manualPaymentRejectedMail(lang: Lang, d: { name: string; reason: string }): Omit<MailMessage, "to"> {
  const subject = lang === "bn" ? "পেমেন্ট যাচাই করা যায়নি" : "We could not verify your payment";
  const body =
    lang === "bn"
      ? `${d.name}, দুঃখিত — আপনার পাঠানো পেমেন্টের তথ্য আমরা যাচাই করতে পারিনি।${d.reason ? ` কারণ: ${d.reason}` : ""} সঠিক ট্রানজ্যাকশন আইডি দিয়ে আবার চেষ্টা করুন অথবা আমাদের সাথে যোগাযোগ করুন।`
      : `${d.name}, sorry — we could not verify the payment details you sent.${d.reason ? ` Reason: ${d.reason}.` : ""} Please try again with the correct transaction id or contact us.`;
  return {
    subject: `${subject} — ${brandName(lang)}`,
    html: layout(lang, subject, `<p style="font-size:16px;line-height:1.6">${escapeHtml(body)}</p>`, brandName(lang)),
    text: body,
  };
}
