/*
 * Landing pages (Admin → Landing pages): a page built from blocks, in the owner's order. Each block holds the owner's words in both
 * languages; a block whose words are empty in one language shows the other language's. The Worker checks every block before it is
 * stored (worker/src/services/landing.ts) and draws the page (worker/src/views/pages/landing.tsx); the admin edits them
 * (admin/src/pages/Landing.tsx).
 */
export const LANDING_BLOCKS = ["hero", "text", "pictures", "video", "class", "price", "faq", "reviews", "whatsapp"] as const;
export type LandingBlockType = (typeof LANDING_BLOCKS)[number];

export const LANDING_MAX_BLOCKS = 30;
export const LANDING_MAX_PICTURES = 12;
export const LANDING_MAX_FAQS = 20;

/** A big picture with a heading, a line of words and a button. */
export interface HeroBlock {
  type: "hero";
  image_key: string | null;
  heading_bn: string;
  heading_en: string;
  text_bn: string;
  text_en: string;
  button_bn: string;
  button_en: string;
  /** a page of this site, an https address, tel: or mailto: — or "" (no button) */
  link: string;
}
/** A heading and words (Markdown: **bold**, lists, links). */
export interface TextBlock {
  type: "text";
  heading_bn: string;
  heading_en: string;
  body_bn: string;
  body_en: string;
}
export interface PicturesBlock {
  type: "pictures";
  heading_bn: string;
  heading_en: string;
  items: { image_key: string; caption_bn: string; caption_en: string }[];
}
/** A YouTube or Vimeo video, played on the page. */
export interface VideoBlock {
  type: "video";
  heading_bn: string;
  heading_en: string;
  url: string;
}
/** One of the classes, with its price and its Enroll button; the owner may give a usual price to show the saving. */
export interface ClassBlock {
  type: "class";
  course_id: number;
  list_price: number;
  button_bn: string;
  button_en: string;
}
/** A price with the usual price struck through and the "% off", and a button. */
export interface PriceBlock {
  type: "price";
  heading_bn: string;
  heading_en: string;
  price: number;
  list_price: number;
  note_bn: string;
  note_en: string;
  button_bn: string;
  button_en: string;
  link: string;
}
/** Questions and answers (the answers in Markdown); also given to search engines as an FAQ. */
export interface FaqBlock {
  type: "faq";
  heading_bn: string;
  heading_en: string;
  items: { question_bn: string; question_en: string; answer_bn: string; answer_en: string }[];
}
/** Students' approved reviews: of one class, or of every class (course_id 0). */
export interface ReviewsBlock {
  type: "reviews";
  heading_bn: string;
  heading_en: string;
  course_id: number;
  count: number;
}
/** A WhatsApp button to the number in Settings → Contact, with a message already written. */
export interface WhatsappBlock {
  type: "whatsapp";
  heading_bn: string;
  heading_en: string;
  button_bn: string;
  button_en: string;
  message_bn: string;
  message_en: string;
}

export type LandingBlock = HeroBlock | TextBlock | PicturesBlock | VideoBlock | ClassBlock | PriceBlock | FaqBlock | ReviewsBlock | WhatsappBlock;

/** A new block of a kind, empty, as the editor adds it. */
export function emptyBlock(type: LandingBlockType): LandingBlock {
  switch (type) {
    case "hero":
      return { type, image_key: null, heading_bn: "", heading_en: "", text_bn: "", text_en: "", button_bn: "", button_en: "", link: "" };
    case "text":
      return { type, heading_bn: "", heading_en: "", body_bn: "", body_en: "" };
    case "pictures":
      return { type, heading_bn: "", heading_en: "", items: [] };
    case "video":
      return { type, heading_bn: "", heading_en: "", url: "" };
    case "class":
      return { type, course_id: 0, list_price: 0, button_bn: "", button_en: "" };
    case "price":
      return { type, heading_bn: "", heading_en: "", price: 0, list_price: 0, note_bn: "", note_en: "", button_bn: "", button_en: "", link: "" };
    case "faq":
      return { type, heading_bn: "", heading_en: "", items: [] };
    case "reviews":
      return { type, heading_bn: "", heading_en: "", course_id: 0, count: 6 };
    case "whatsapp":
      return { type, heading_bn: "", heading_en: "", button_bn: "", button_en: "", message_bn: "", message_en: "" };
  }
}

/** The saving a usual price above the price makes, as a whole percent rounded down ("−20%"); null when there is none worth showing. */
export function offPercent(price: number, listPrice: number): number | null {
  if (!(listPrice > price) || price <= 0) return null;
  const p = Math.floor(((listPrice - price) / listPrice) * 100);
  return p >= 1 ? p : null;
}
