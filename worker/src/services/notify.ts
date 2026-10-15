import { formatMoney, orderCode, type NotifyKind } from "@mawah/shared";
import type { Env } from "../env";
import { ownerNoticeMail, sendMail, type MailResult } from "../lib/mailer";
import { getSettings, type Settings } from "../lib/settings";

/*
 * Telling the owner by e-mail the moment something happens on the site: a payment (to approve, or already received), a message, a new
 * student, a question, a review, a chatbot hand-off, a request to join a private group, someone waiting for a class to open, a newsletter sign-up.
 * Every note goes to the addresses in Admin → Settings → E-mail (by default NOTIFY_EMAIL), each kind can be switched off there, and a note
 * can never break what the visitor was doing: all of it happens after the answer is sent, and an error is only logged.
 */

export interface Notice {
  kind: NotifyKind;
  /** the one-line gist, e.g. "৳1,500 · Rina Akter" — it goes to the subject */
  headline: string;
  facts: { en: string; bn: string; value: string }[];
  /** a longer text, e.g. what the visitor wrote */
  note?: string;
}

const TITLE: Record<NotifyKind, { en: string; bn: string }> = {
  order_paid: { en: "New payment received", bn: "নতুন পেমেন্ট এসেছে" },
  payment_waiting: { en: "A payment is waiting for you to verify", bn: "একটি পেমেন্ট আপনার যাচাইয়ের অপেক্ষায়" },
  contact_message: { en: "New message from the website", bn: "ওয়েবসাইট থেকে নতুন বার্তা" },
  new_student: { en: "A new student signed up", bn: "নতুন শিক্ষার্থী সাইন-আপ করেছেন" },
  course_question: { en: "A student asked a question", bn: "একজন শিক্ষার্থী প্রশ্ন করেছেন" },
  review_pending: { en: "A new review is waiting for your approval", bn: "একটি নতুন রিভিউ আপনার অনুমোদনের অপেক্ষায়" },
  chat_handoff: { en: "The chatbot needs a person", bn: "চ্যাটবটের হয়ে একজন মানুষের উত্তর দরকার" },
  group_request: { en: "Someone asked to join a private group", bn: "কেউ প্রাইভেট গ্রুপে যোগ দিতে চেয়েছেন" },
  notify_me: { en: "Someone is waiting for a class to open", bn: "কেউ একটি ক্লাস চালুর অপেক্ষায় আছেন" },
  newsletter: { en: "A new newsletter subscriber", bn: "নিউজলেটারে নতুন সাবস্ক্রাইবার" },
};

/** The admin page each note links to. */
const OPEN: Record<NotifyKind, { path: string; en: string; bn: string }> = {
  order_paid: { path: "/admin/orders", en: "Open Orders", bn: "অর্ডার খুলুন" },
  payment_waiting: { path: "/admin/orders?status=awaiting_verification", en: "Open the order", bn: "অর্ডার খুলুন" },
  contact_message: { path: "/admin/messages", en: "Open Messages", bn: "বার্তা খুলুন" },
  new_student: { path: "/admin/students", en: "Open Students", bn: "শিক্ষার্থী খুলুন" },
  course_question: { path: "/admin/questions", en: "Open Questions", bn: "প্রশ্ন খুলুন" },
  review_pending: { path: "/admin/reviews", en: "Open Reviews", bn: "রিভিউ খুলুন" },
  chat_handoff: { path: "/admin/chatbot", en: "Open the chatbot", bn: "চ্যাটবট খুলুন" },
  group_request: { path: "/admin/materials/requests", en: "Open Group requests", bn: "অনুরোধ খুলুন" },
  notify_me: { path: "/admin/signups", en: "Open the waiting list", bn: "তালিকা খুলুন" },
  newsletter: { path: "/admin/signups", en: "Open Sign-ups", bn: "সাইন-আপ খুলুন" },
};

/** At most this many notes of one kind per hour — a burst (or someone hammering a form) cannot fill the inbox; the admin pages still show everything. */
const HOURLY_CAP: Record<NotifyKind, number> = {
  order_paid: 200,
  payment_waiting: 200,
  contact_message: 40,
  new_student: 40,
  course_question: 40,
  review_pending: 40,
  chat_handoff: 30,
  group_request: 40,
  notify_me: 30,
  newsletter: 30,
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fact = (en: string, bn: string, value: string | number | null | undefined) => ({ en, bn, value: clip(String(value ?? "").trim(), 300) });
const METHODS: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", card: "Card", free: "Free", manual: "Send money", mock: "Test payment" };
const methodName = (m: string | null | undefined) => (m ? (METHODS[m] ?? m) : "");

/** What each kind of note says. Callers give plain facts; the wording (English and Bangla) is here. */
export const notices = {
  orderPaid(d: { student: string; email: string; phone: string | null; items: string[]; total: number; method: string | null; invoiceNo: string }): Notice {
    return {
      kind: "order_paid",
      headline: `${d.total ? formatMoney(d.total, "en") : "Free"} · ${d.student}`,
      facts: [
        fact("Student", "শিক্ষার্থী", d.student),
        fact("E-mail", "ইমেইল", d.email),
        fact("Phone", "ফোন", d.phone),
        fact("Class", "ক্লাস", d.items.join("; ")),
        fact("Amount", "টাকা", d.total ? formatMoney(d.total, "en") : "Free · ফ্রি"),
        fact("Paid by", "যেভাবে দিয়েছেন", methodName(d.method)),
        fact("Invoice", "ইনভয়েস", d.invoiceNo),
      ],
    };
  },
  paymentWaiting(d: { student: string; email: string; phone: string | null; items: string[]; total: number; method: string | null; trx: string | null; payer: string | null; hasImage: boolean; publicId: string }): Notice {
    const method = methodName(d.method) || "mobile";
    return {
      kind: "payment_waiting",
      headline: `${formatMoney(d.total, "en")} · ${method} · ${d.student}`,
      facts: [
        fact("Student", "শিক্ষার্থী", d.student),
        fact("Phone", "ফোন", d.phone),
        fact("E-mail", "ইমেইল", d.email),
        fact("Class", "ক্লাস", d.items.join("; ")),
        fact("Amount", "টাকা", formatMoney(d.total, "en")),
        fact("Paid by", "যেভাবে দিয়েছেন", method),
        fact("TrxID", "ট্রানজ্যাকশন আইডি", d.trx),
        fact("Paid from", "যে নম্বর থেকে", d.payer),
        fact("Screenshot", "স্ক্রিনশট", d.hasImage ? "Yes · আছে" : "No · নেই"),
        fact("Order", "অর্ডার", orderCode(d.publicId)),
      ],
      note: `Open the order, compare the TrxID with your ${method} messages, then press “Approve payment”.\nঅর্ডারটি খুলে ট্রানজ্যাকশন আইডি আপনার ${method} মেসেজের সাথে মিলিয়ে “পেমেন্ট অনুমোদন” চাপুন।`,
    };
  },
  contactMessage(d: { name: string; email: string; phone: string | null; message: string }): Notice {
    return {
      kind: "contact_message",
      headline: d.name,
      facts: [fact("Name", "নাম", d.name), fact("E-mail", "ইমেইল", d.email), fact("Phone", "ফোন", d.phone)],
      note: clip(d.message, 1200),
    };
  },
  newStudent(d: { name: string; email: string; phone: string | null }): Notice {
    return { kind: "new_student", headline: d.name, facts: [fact("Name", "নাম", d.name), fact("E-mail", "ইমেইল", d.email), fact("Phone", "ফোন", d.phone)] };
  },
  courseQuestion(d: { student: string; course: string; lesson: string; body: string }): Notice {
    return {
      kind: "course_question",
      headline: `${d.student} — ${d.course}`,
      facts: [fact("Student", "শিক্ষার্থী", d.student), fact("Class", "ক্লাস", d.course), fact("Lesson", "লেসন", d.lesson)],
      note: clip(d.body, 1200),
    };
  },
  reviewPending(d: { student: string; course: string; rating: number; body: string }): Notice {
    return {
      kind: "review_pending",
      headline: `${"★".repeat(d.rating)} ${d.course}`,
      facts: [fact("Student", "শিক্ষার্থী", d.student), fact("Class", "ক্লাস", d.course), fact("Rating", "রেটিং", `${d.rating} / 5`)],
      note: clip(d.body, 1200),
    };
  },
  chatHandoff(d: { question: string; lang: string; reason: string; student: string | null }): Notice {
    return {
      kind: "chat_handoff",
      headline: clip(d.question, 70),
      facts: [fact("Language", "ভাষা", d.lang === "bn" ? "বাংলা" : "English"), fact("Why", "কেন", d.reason.replace(/_/g, " ")), fact("Student", "শিক্ষার্থী", d.student)],
      note: clip(d.question, 1200),
    };
  },
  groupRequest(d: { student: string; email: string; group: string; course: string; profile: string }): Notice {
    return {
      kind: "group_request",
      headline: `${d.student} → ${d.group}`,
      facts: [fact("Student", "শিক্ষার্থী", d.student), fact("E-mail", "ইমেইল", d.email), fact("Group", "গ্রুপ", d.group), fact("Class", "ক্লাস", d.course), fact("Facebook profile", "ফেসবুক প্রোফাইল", d.profile)],
    };
  },
  notifyMe(d: { email: string; phone: string | null; course: string }): Notice {
    return { kind: "notify_me", headline: `${d.email} → ${d.course}`, facts: [fact("E-mail", "ইমেইল", d.email), fact("Phone", "ফোন", d.phone), fact("Class", "ক্লাস", d.course)] };
  },
  newsletter(d: { email: string; lang: string }): Notice {
    return { kind: "newsletter", headline: d.email, facts: [fact("E-mail", "ইমেইল", d.email), fact("Language", "ভাষা", d.lang === "bn" ? "বাংলা" : "English")] };
  },
  /** The sample behind "Send a test notification". */
  test(): Notice {
    return {
      kind: "order_paid",
      headline: "TEST · ৳1,500 · Rina Akter",
      facts: [fact("Student", "শিক্ষার্থী", "Rina Akter (test)"), fact("Class", "ক্লাস", "Beginners baking class"), fact("Amount", "টাকা", formatMoney(1500, "en")), fact("Paid by", "যেভাবে দিয়েছেন", "bKash")],
      note: "This is only a test. Nothing was bought. · এটি শুধু একটি পরীক্ষা। কেউ কিছু কেনেনি।",
    };
  },
};

/** Who gets the notes: the addresses chosen in Admin → Settings → E-mail, else NOTIFY_EMAIL, else the contact e-mail of the site. */
export function notificationRecipients(env: Env, settings: Settings): { to: string[]; custom: boolean } {
  const custom = settings.notifications.emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (custom.length) return { to: [...new Set(custom)], custom: true };
  const fallback = (env.NOTIFY_EMAIL ?? "").trim().toLowerCase() || settings.contact.email.trim().toLowerCase();
  return { to: fallback ? [fallback] : [], custom: false };
}

/** The message for a note, ready to send. */
export function noticeMail(env: Env, n: Notice) {
  const open = OPEN[n.kind];
  return ownerNoticeMail({ title: TITLE[n.kind], headline: n.headline, facts: n.facts, note: n.note, open: { url: `${env.SITE_URL}${open.path}`, en: open.en, bn: open.bn } });
}

/** Sends a note to every address; returns what each address got (used by the "test notification" button, which wants the answer). */
export async function sendNotice(env: Env, settings: Settings, n: Notice): Promise<{ to: string; result: MailResult }[]> {
  const mail = noticeMail(env, n);
  const out: { to: string; result: MailResult }[] = [];
  for (const to of notificationRecipients(env, settings).to) out.push({ to, result: await sendMail(env, { to, ...mail, owner: true }) });
  return out;
}

async function underCap(env: Env, kind: NotifyKind): Promise<boolean> {
  const key = `notify:${kind}:${Math.floor(Date.now() / 3_600_000)}`;
  const used = Number((await env.KV.get(key)) ?? 0);
  if (used >= HOURLY_CAP[kind]) return false;
  await env.KV.put(key, String(used + 1), { expirationTtl: 3700 });
  return true;
}

/**
 * Tell the owner. Safe to call from anywhere: it returns a promise that never rejects (hand it to `waitUntil`), does nothing when this kind is
 * switched off or there is nobody to tell, and stays quiet past the hourly cap.
 */
export async function notifyOwner(env: Env, n: Notice): Promise<void> {
  try {
    const settings = await getSettings(env);
    if (settings.notifications.off.includes(n.kind)) return;
    if (notificationRecipients(env, settings).to.length === 0) return;
    if (!(await underCap(env, n.kind))) return;
    await sendNotice(env, settings, n);
  } catch (err) {
    console.error("notify_failed", n.kind, err instanceof Error ? err.message : err);
  }
}
