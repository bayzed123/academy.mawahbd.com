/**
 * Every event the shop sends to Google Analytics 4, in the order Admin → Analytics lists them. This list is the contract between the pages that
 * send an event (marketing/analytics.js, the student app), the report that counts them (worker/src/services/analytics.ts) and the screen that
 * names them in plain words (adm.an.ev.<name>); a test (scripts/lib/analytics-events.test.mjs) fails when a page sends an event that is not here.
 * docs/analytics.md says what each one carries.
 */
export const GA_EVENT_GROUPS = ["buying", "interest", "contact", "learning", "account"] as const;
export type GaEventGroup = (typeof GA_EVENT_GROUPS)[number];

export interface GaEventInfo {
  name: string;
  group: GaEventGroup;
  /** Google sends it by itself (enhanced measurement) — the shop's own pages do not */
  auto?: boolean;
}

export const GA_EVENTS = [
  // buying — the path from reading a class to paying for it
  { name: "view_item", group: "buying" },
  { name: "add_to_cart", group: "buying" },
  { name: "begin_checkout", group: "buying" },
  { name: "add_payment_info", group: "buying" },
  { name: "purchase", group: "buying" },
  { name: "payment_pending", group: "buying" },
  { name: "payment_proof_sent", group: "buying" },
  { name: "payment_failed", group: "buying" },
  { name: "coupon_applied", group: "buying" },
  { name: "coupon_failed", group: "buying" },
  { name: "checkout_error", group: "buying" },
  // interest — what visitors look at
  { name: "view_item_list", group: "interest" },
  { name: "select_item", group: "interest" },
  { name: "view_promotion", group: "interest" },
  { name: "select_promotion", group: "interest" },
  { name: "popup_dismiss", group: "interest" },
  { name: "faq_expand", group: "interest" },
  { name: "language_switch", group: "interest" },
  { name: "view_search_results", group: "interest", auto: true },
  { name: "file_download", group: "interest", auto: true },
  // contact — asking a question or leaving details
  { name: "generate_lead", group: "contact" },
  { name: "contact_click", group: "contact" },
  { name: "shop_click", group: "contact" },
  { name: "chatbot_open", group: "contact" },
  { name: "chatbot_message", group: "contact" },
  { name: "chatbot_handoff", group: "contact" },
  { name: "certificate_verify", group: "contact" },
  // learning — what students do after they have paid
  { name: "lesson_start", group: "learning" },
  { name: "lesson_complete", group: "learning" },
  { name: "course_complete", group: "learning" },
  { name: "certificate_earned", group: "learning" },
  { name: "certificate_view", group: "learning" },
  { name: "review_submit", group: "learning" },
  { name: "question_ask", group: "learning" },
  { name: "material_open", group: "learning" },
  { name: "material_join_request", group: "learning" },
  { name: "material_download", group: "learning" },
  { name: "resource_download", group: "learning" },
  { name: "invoice_download", group: "learning" },
  // account
  { name: "sign_up", group: "account" },
  { name: "login", group: "account" },
  { name: "account_secured", group: "account" },
] as const satisfies readonly GaEventInfo[];

export type GaEventName = (typeof GA_EVENTS)[number]["name"];

/** The steps a visitor takes towards paying, in order — the first five buying events. */
export const GA_FUNNEL = ["view_item", "add_to_cart", "begin_checkout", "add_payment_info", "purchase"] as const satisfies readonly GaEventName[];
