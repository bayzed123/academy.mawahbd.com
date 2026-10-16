import { isNoEmail } from "@mawah/shared";
import type { Env } from "../env";
import { sendMail, type MailMessage, type MailResult } from "../lib/mailer";
import { getSettings } from "../lib/settings";
import { allowVisitorSms, sendSms, type SmsResult } from "../lib/sms";

/** How to reach a student: the e-mail they gave (a buyer who gave none has a made-up one, which counts as none) and their mobile number. */
export interface Reach {
  email: string | null | undefined;
  phone: string | null | undefined;
}

export interface Told {
  mail: MailResult | null;
  sms: SmsResult | null;
}

/**
 * Tell a student something: by e-mail when they have one, and by text message to their mobile number when the shop sends them
 * (Admin → Settings → SMS) — always by text when there is no e-mail to use, since that is then the only way. `smsAlso` sends the text even
 * when the owner has switched off texts for people who gave an e-mail (a sign-in link that was asked for by number). `capped`: something a
 * visitor can set off by typing a number (sending "payment details" for an order they made up) — only a few texts per number per hour
 * and per day for the whole site, so nobody can run up the SMS bill or flood a stranger's phone. Never throws: a message that cannot be
 * sent must not break the payment or the page it comes from.
 */
export async function tellStudent(env: Env, who: Reach, msg: { mail?: Omit<MailMessage, "to">; sms?: string }, opts: { smsAlso?: boolean; capped?: boolean } = {}): Promise<Told> {
  const told: Told = { mail: null, sms: null };
  const hasEmail = !!who.email && !isNoEmail(who.email);
  try {
    if (hasEmail && msg.mail) told.mail = await sendMail(env, { to: who.email!, ...msg.mail });
    if (msg.sms && who.phone) {
      const s = (await getSettings(env)).sms;
      if (s.enabled && (!hasEmail || s.with_email || opts.smsAlso) && (!opts.capped || (await allowVisitorSms(env, who.phone)))) {
        told.sms = await sendSms(env, { to: who.phone, text: msg.sms }, { sender: s.sender_id });
      }
    }
  } catch (err) {
    console.error("tell_student_failed", err instanceof Error ? err.message : err);
  }
  return told;
}
