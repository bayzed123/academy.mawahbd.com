import { formatNumber } from "@mawah/shared";
import type { Lang } from "../env";
import { isMaskingSender } from "./sms";

/*
 * The text messages students get. Short on purpose: a message that is all English letters is one SMS for 160 characters; one with
 * Bangla in it is one SMS for only 70 — so the English ones say "Tk" (the taka sign would turn them into the shorter, dearer kind),
 * and every message says only what the student needs to act.
 */

const brand = (lang: Lang) => (lang === "bn" ? "মাওয়াহ একাডেমি" : "MAWAH Academy");

/** A text message to send: built in the student's language — or in another, when the shop's sender asks for it (wordsFor). */
export interface SmsText {
  lang: Lang;
  build: (lang: Lang) => string;
}
export const smsText = (lang: Lang, build: (lang: Lang) => string): SmsText => ({ lang, build });

/**
 * The words that go out from this sender. A number: the student's language, starting with the shop's name. A brand name (masking): Bangla,
 * whatever the student's language — the SMS company refuses English from one — and without the shop's name in front, since the phone shows
 * it as the sender already (which saves a whole SMS on the password code: 80 Bangla letters are two SMS, 63 are one).
 */
export function wordsFor(t: SmsText, sender: string | null | undefined): string {
  if (!isMaskingSender(sender)) return t.build(t.lang);
  const text = t.build("bn");
  const named = `${brand("bn")}: `;
  return text.startsWith(named) ? text.slice(named.length) : text;
}
const tk = (lang: Lang, amount: number) => (lang === "bn" ? `৳${formatNumber(Math.round(amount), "bn")}` : `Tk ${Math.round(amount)}`);

/**
 * The payment arrived (or the class was free) and the class is open. `setPasswordUrl`: an account made at checkout, so its owner can choose
 * a password and come back on any phone.
 */
export function receiptSms(lang: Lang, d: { total: number; learnUrl: string; code: string; setPasswordUrl?: string }): string {
  const paid = d.total > 0;
  if (lang === "bn") {
    const head = paid ? `পেমেন্ট পেয়েছি (${tk(lang, d.total)})।` : "আপনি ভর্তি হয়েছেন।";
    return `${brand(lang)}: ${head} আপনার ক্লাস খোলা হয়েছে: ${d.learnUrl} স্টুডেন্ট আইডি: ${d.code}।${d.setPasswordUrl ? ` পাসওয়ার্ড দিন: ${d.setPasswordUrl}` : ""}`;
  }
  const head = paid ? `payment received (${tk(lang, d.total)}).` : "you are enrolled.";
  return `${brand(lang)}: ${head} Your class is open: ${d.learnUrl} Student ID: ${d.code}.${d.setPasswordUrl ? ` Choose a password: ${d.setPasswordUrl}` : ""}`;
}

/** The student sent the TrxID or a screenshot; staff will check it. */
export function proofReceivedSms(lang: Lang, d: { total: number }): string {
  return lang === "bn"
    ? `${brand(lang)}: আপনার পেমেন্টের তথ্য পেয়েছি (${tk(lang, d.total)})। যাচাই হলেই ক্লাস খুলে যাবে।`
    : `${brand(lang)}: we got your payment details (${tk(lang, d.total)}). Your class opens as soon as we have checked them.`;
}

/** Staff could not match the payment. `reason` is staff's own short note. */
export function rejectedSms(lang: Lang, d: { reason: string }): string {
  const why = d.reason.replace(/\s+/g, " ").trim().slice(0, 70);
  return lang === "bn"
    ? `${brand(lang)}: আপনার পেমেন্ট মেলাতে পারিনি${why ? ` (${why})` : ""}। TrxID দেখে আবার পাঠান বা আমাদের জানান।`
    : `${brand(lang)}: we could not match your payment${why ? ` (${why})` : ""}. Please check the TrxID and send it again, or contact us.`;
}

/**
 * "Forgot password": the code to type on the website. No web address in it: the reset texts that carried a link never reached the
 * owner's phone, while the test text (which has none) did. The code is in plain digits so it reads the same in both languages.
 */
export function resetCodeSms(lang: Lang, d: { code: string }): string {
  return lang === "bn"
    ? `${brand(lang)}: পাসওয়ার্ড বদলানোর কোড ${d.code}। ১৫ মিনিট চলবে। কাউকে জানাবেন না।`
    : `${brand(lang)}: your password code is ${d.code}. It works for 15 minutes. Do not share it with anyone.`;
}

/**
 * "Forgot password" for a mobile number that several accounts share (none of them is the number's own): which accounts they are, by their
 * student IDs, so the person can ask again with the right one. No code in it, and no link (see resetCodeSms).
 */
export function sharedNumberSms(lang: Lang, d: { codes: string[] }): string {
  const list = d.codes.join(", ");
  return lang === "bn"
    ? `${brand(lang)}: এই নম্বরে ${formatNumber(d.codes.length, "bn")}টি অ্যাকাউন্ট: ${list}। “পাসওয়ার্ড ভুলে গেছেন?” পাতায় যেটির কোড চান সেটির স্টুডেন্ট আইডি লিখুন।`
    : `${brand(lang)}: ${d.codes.length} accounts use this number: ${list}. On "Forgot password", type the student ID you want a code for.`;
}

/** "I forgot my password", asked by mobile number. */
export function resetSms(lang: Lang, d: { link: string }): string {
  return lang === "bn" ? `${brand(lang)}: নতুন পাসওয়ার্ড দিতে এই লিংকে যান (১ ঘণ্টা চলবে): ${d.link}` : `${brand(lang)}: choose a new password here (works for 1 hour): ${d.link}`;
}

/** An account the shop made for someone (added by hand, or imported): their classes are in it, they only choose a password. */
export function inviteSms(lang: Lang, d: { link: string; days: number }): string {
  return lang === "bn"
    ? `${brand(lang)}: আপনার অ্যাকাউন্ট ও ক্লাস প্রস্তুত। পাসওয়ার্ড দিতে যান (${formatNumber(d.days, "bn")} দিন চলবে): ${d.link}`
    : `${brand(lang)}: your account and classes are ready. Choose a password here (works for ${d.days} days): ${d.link}`;
}

/** A step of a tools-shop order its buyer is told about by text message (services/shopTexts.ts). */
export type ShopTextStep = "placed" | "paid" | "confirmed" | "shipped" | "delivered" | "cancelled" | "refunded";

const COURIER_NAMES: Record<string, Record<Lang, string>> = { steadfast: { bn: "স্টেডফাস্ট", en: "Steadfast" }, pathao: { bn: "পাঠাও", en: "Pathao" } };

/**
 * A tools-shop order, told to its buyer: received (cash on delivery) or paid (online), confirmed, on its way (with the courier and its
 * tracking number when there is one), delivered, cancelled — and cancelled after an online payment, which is then paid back. Every text
 * carries the order code, so the buyer can quote it on the phone, and a cash-on-delivery one the amount to have ready. No web address in
 * any of them (see resetCodeSms).
 */
export function shopSms(lang: Lang, step: ShopTextStep, d: { code: string; total: number; cod: boolean; courier?: string; tracking?: string }): string {
  const b = brand(lang);
  const amount = tk(lang, d.total);
  // what staff typed as the tracking number: one short line
  const tracking = (d.tracking ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const courier = (d.courier && COURIER_NAMES[d.courier]?.[lang]) || "";
  if (lang === "bn") {
    const pay = d.cod ? ` ডেলিভারির সময় ${amount} দেবেন।` : "";
    const via = [courier, tracking ? `ট্র্যাকিং নম্বর ${tracking}` : ""].filter(Boolean).join(", ");
    const bn: Record<ShopTextStep, string> = {
      placed: `${b}: আপনার অর্ডার ${d.code} পেয়েছি (${amount}, ক্যাশ অন ডেলিভারি)। শিগগিরই কনফার্ম করব।`,
      paid: `${b}: অর্ডার ${d.code}-এর পেমেন্ট পেয়েছি (${amount})। শিগগিরই কনফার্ম করব।`,
      confirmed: `${b}: আপনার অর্ডার ${d.code} কনফার্ম হয়েছে, শিগগিরই পাঠানো হবে।${pay}`,
      shipped: `${b}: আপনার অর্ডার ${d.code} পাঠানো হয়েছে${via ? ` (${via})` : ""}।${pay}`,
      delivered: `${b}: আপনার অর্ডার ${d.code} ডেলিভারি হয়েছে। ধন্যবাদ!`,
      cancelled: `${b}: আপনার অর্ডার ${d.code} বাতিল হয়েছে। কোনো প্রশ্ন থাকলে আমাদের জানান।`,
      refunded: `${b}: আপনার অর্ডার ${d.code} বাতিল হয়েছে। আপনার পেমেন্ট (${amount}) ফেরত দেওয়া হবে।`,
    };
    return bn[step];
  }
  const pay = d.cod ? ` Please have ${amount} ready on delivery.` : "";
  const via = [courier ? `with ${courier}` : "", tracking ? `tracking no. ${tracking}` : ""].filter(Boolean).join(", ");
  const en: Record<ShopTextStep, string> = {
    placed: `${b}: we got your order ${d.code} (${amount}, cash on delivery). We will confirm it soon.`,
    paid: `${b}: payment received for order ${d.code} (${amount}). We will confirm it soon.`,
    confirmed: `${b}: your order ${d.code} is confirmed and will be sent soon.${pay}`,
    shipped: `${b}: your order ${d.code} is on its way${via ? ` (${via})` : ""}.${pay}`,
    delivered: `${b}: your order ${d.code} was delivered. Thank you!`,
    cancelled: `${b}: your order ${d.code} was cancelled. Please contact us if you have a question.`,
    refunded: `${b}: your order ${d.code} was cancelled. Your payment of ${amount} will be refunded.`,
  };
  return en[step];
}

/** Settings → SMS → "Send a test message". */
export function testSms(lang: Lang): string {
  return lang === "bn" ? `${brand(lang)}: পরীক্ষামূলক বার্তা — এসএমএস ঠিকমতো কাজ করছে।` : `${brand(lang)}: test message - SMS is working.`;
}
