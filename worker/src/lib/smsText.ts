import { formatNumber } from "@mawah/shared";
import type { Lang } from "../env";

/*
 * The text messages students get. Short on purpose: a message that is all English letters is one SMS for 160 characters; one with
 * Bangla in it is one SMS for only 70 — so the English ones say "Tk" (the taka sign would turn them into the shorter, dearer kind),
 * and every message says only what the student needs to act.
 */

const brand = (lang: Lang) => (lang === "bn" ? "মাওয়াহ একাডেমি" : "MAWAH Academy");
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

/** Settings → SMS → "Send a test message". */
export function testSms(lang: Lang): string {
  return lang === "bn" ? `${brand(lang)}: পরীক্ষামূলক বার্তা — এসএমএস ঠিকমতো কাজ করছে।` : `${brand(lang)}: test message - SMS is working.`;
}
