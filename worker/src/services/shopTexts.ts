import type { Env, Lang } from "../env";
import { auditAs } from "../lib/audit";
import { getSettings } from "../lib/settings";
import { shopSms, type ShopTextStep } from "../lib/smsText";
import { tellStudent, toldMeta } from "./studentMessages";

/** What a text about a tools-shop order needs from the order. */
export interface ShopTextOrder {
  id: number;
  public_id: string;
  phone: string;
  /** the language the buyer used on the website when they ordered */
  locale: string;
  total: number;
  payment: string;
  /** the courier the parcel was booked with from Admin (Steadfast / Pathao), when it was */
  courier?: string;
  /** the tracking number */
  courier_ref?: string;
}

const SYSTEM = { type: "system", id: null, name: "" } as const;

/**
 * Tell the buyer of a tools-shop order where it stands, by text message to the number on the order: when the site sends texts and the owner
 * keeps "Text shop buyers about their orders" on (Admin → Settings → SMS). The shop sends buyers no e-mail, so the text goes even when "also
 * text people who gave an e-mail" is off. `capped`: a step a visitor sets off with no payment behind it (a cash-on-delivery order, where
 * anyone could type a stranger's number) — a few texts per number per hour, and a cap for the whole site per day, as for the password
 * codes. How it went is kept in the activity log (`shop_orders.texted`). Never throws: a text that cannot go must not break the order.
 */
export async function textShopBuyer(env: Env, order: ShopTextOrder, step: ShopTextStep, opts: { capped?: boolean } = {}): Promise<void> {
  try {
    if (!order.phone || !(await getSettings(env)).sms.shop) return;
    const lang: Lang = order.locale === "en" ? "en" : "bn";
    const sms = shopSms(lang, step, { code: order.public_id, total: order.total, cod: order.payment === "cod", courier: order.courier, tracking: order.courier_ref });
    const told = await tellStudent(env, { email: null, phone: order.phone }, { sms }, { smsAlso: true, capped: opts.capped });
    await auditAs(env, SYSTEM, { action: "shop_orders.texted", entity: "shop_order", entityId: order.id, summary: `${order.public_id} · ${step}`, meta: { step, sms: toldMeta(told).sms } });
  } catch (err) {
    console.error("shop_text_failed", order.public_id, step, err instanceof Error ? err.message : err);
  }
}
