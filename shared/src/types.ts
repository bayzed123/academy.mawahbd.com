import type { Accent, CourseStatus, LessonType, OrderStatus, PaymentMethod, Role } from "./constants";
import type { PayVia } from "./payLogos";

/** Every JSON error from the API has this shape. `code` maps to a localized message on the client. */
export interface ApiErrorBody {
  ok: false;
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface CategoryDTO {
  id: number;
  slug: string;
  name_bn: string;
  name_en: string;
  blurb_bn: string;
  blurb_en: string;
  accent: Accent;
  icon: string;
  course_count?: number;
}

export interface CourseCardDTO {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  short_bn: string;
  short_en: string;
  banner_key: string | null;
  icon: string | null;
  /** the price the class sells at now: its offer price while an offer runs (lib/price.ts), else its regular price */
  price: number;
  /** the regular price: higher than `price` while an offer runs, and then shown crossed out (shared/src/offer.ts) */
  regular_price: number;
  /** when the running offer ends (UTC); null when there is none or it has no end */
  offer_ends_at: string | null;
  status: CourseStatus;
  level: "beginner" | "intermediate" | "advanced" | null;
  rating_avg: number;
  rating_count: number;
  lesson_count: number;
  featured: boolean;
  /** the class has a demo anyone can watch on its page before enrolling (the card says so) */
  has_demo: boolean;
  category: Pick<CategoryDTO, "slug" | "name_bn" | "name_en" | "accent" | "icon"> | null;
}

export interface StudentMe {
  kind: "student";
  id: number;
  name: string;
  /** empty for a buyer who gave no e-mail (their mobile number is how they sign in) */
  email: string;
  phone: string | null;
  /** where they live, as given at checkout (empty when not given) */
  address: string;
  locale: "bn" | "en";
  /** the student ID shown on the profile and the receipts (STU-000123) */
  code: string;
  /** false for an account made at checkout until its owner sets a password (the profile then offers to) */
  has_password: boolean;
}

export interface StaffMe {
  kind: "staff";
  id: number;
  name: string;
  email: string;
  role: Role;
  must_change_password: boolean;
}

export interface Progress {
  done: number;
  total: number;
  pct: number;
}

export interface MyCourseDTO {
  course: CourseCardDTO;
  progress: Progress;
  enrolled_at: string;
  certificate_code: string | null;
  resume_lesson_id: number | null;
  /**
   * a free class (it costs nothing: price 0 on the website, or one of the Android app's free classes): My Learning shows it under "Free classes",
   * apart from the paid ones. A paid class given for nothing (a 100 % coupon, staff) stays a paid class. Older servers do not send it.
   */
  free?: boolean;
}

export interface CurriculumLessonDTO {
  id: number;
  title_bn: string;
  title_en: string;
  type: LessonType;
  duration_sec: number;
  is_preview: boolean;
  completed?: boolean;
  /** drip content: ISO date when this lesson unlocks (null = available now) */
  available_at?: string | null;
}

export interface CurriculumModuleDTO {
  id: number;
  title_bn: string;
  title_en: string;
  drip_days: number;
  lessons: CurriculumLessonDTO[];
}

export interface LessonResourceDTO {
  id: number;
  title_bn: string;
  title_en: string;
  filename: string;
  size_bytes: number;
}

export interface LessonContentDTO {
  id: number;
  course_id: number;
  title_bn: string;
  title_en: string;
  type: LessonType;
  body_html_bn: string;
  body_html_en: string;
  video: { embed_url: string } | null;
  /**
   * A link lesson. `embed_url` = a YouTube / Vimeo player; `media_url` = a video the website plays itself (a Google Drive file shared with the
   * website's Google account); `pending` = a Google Drive video the website cannot play yet ("being prepared"). For a Drive link `url` is always
   * empty: the owner's Drive address is never given to a student. Neither of the three = just a link to open (any other website).
   */
  external: { url: string; embed_url: string | null; media_url: string | null; pending: boolean } | null;
  resources: LessonResourceDTO[];
  completed: boolean;
  prev_id: number | null;
  next_id: number | null;
}

export interface OrderItemDTO {
  course_id: number;
  /** class slug (for "go to class" links and as the class's name in Google Analytics) */
  slug?: string;
  title_bn: string;
  title_en: string;
  price: number;
  list_price: number;
  /** at checkout only: the class's regular price, when it sells at an offer price now (shown crossed out); never stored */
  regular_price?: number;
}

export interface OrderDTO {
  id: number;
  public_id: string;
  invoice_no: string | null;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  total: number;
  coupon_code: string | null;
  method: PaymentMethod | null;
  gateway: string | null;
  gateway_txn: string | null;
  payer_number: string | null;
  created_at: string;
  paid_at: string | null;
  /** manual payments: the time the student was asked to pay by, when they sent proof (TrxID and/or screenshot), and whether a screenshot is on file */
  pay_by: string | null;
  proof_at: string | null;
  has_proof_image: boolean;
  /** paid on the shop's SSLCommerz payment link — an older way of paying, no longer offered; kept so past orders still say how they were paid */
  via_link: boolean;
  /** paid (or to be paid) by scanning the shop's Bangla QR — checked by staff like a send-money payment */
  via_qr: boolean;
  /** only while a manual order is still open: where to send the money */
  manual?: ManualPayInfo | null;
  items: OrderItemDTO[];
}

/** Where a manual payment goes (send-money to a number, or the shop's Bangla QR), and how long the student has. */
export interface ManualPayInfo {
  numbers: { bkash: string; nagad: string; rocket: string };
  note_bn: string;
  note_en: string;
  /** minutes the student is asked to pay within */
  window_min: number;
  /** the shop's Bangla QR while it is switched on (Admin → Settings → Payments): the picture to scan and the name it pays; null = not offered */
  qr: BanglaQrInfo | null;
}

/** The shop's Bangla QR: one picture any bank or mobile-banking app that takes Bangla QR can scan, and the name the payment goes to. */
export interface BanglaQrInfo {
  /** the address of the uploaded picture (/media/payments/…) */
  image: string;
  /** the account the QR pays, as the paying app shows it (the owner types it); "" = not given */
  name: string;
}

/**
 * How the student pays: send money to the shop's number (manual), SSLCommerz's own page (automatic: bKash, Nagad, Rocket, cards …), the
 * shop's Bangla QR (scanned in any banking app, checked by staff like send-money), or the dev-only mock.
 */
export type Channel = "manual" | "sslcommerz" | "bangla_qr" | "mock";

export interface QuoteDTO {
  items: OrderItemDTO[];
  subtotal: number;
  discount: number;
  total: number;
  coupon_code: string | null;
  bundle_id: number | null;
  /** payment channels that can be used right now (empty when total is 0: enrolment is instant) */
  channels: Channel[];
  manual: ManualPayInfo | null;
  /** SSLCommerz's picture of the ways to pay for the online-payment choice: the one the owner pasted, else the copy the owner sent (SSL_BANNER); null = the small marks */
  ssl_logo: string | null;
  /**
   * SSLCommerz refused this much lately because of the store's limit per payment (only SSLCommerz can lift it): the online payment is shown as
   * not open for this amount yet, and send-money is offered instead
   */
  ssl_limited: boolean;
}

/**
 * One way of paying that SSLCommerz offers this store (bKash, Nagad, Rocket, Upay, a card, a bank …), as SSLCommerz described it when a
 * payment was opened: its own name and logo, and its address there. "Check the connection" names them for the owner; the buyer chooses among
 * them on SSLCommerz's own page. Only SSLCommerz's https addresses ever get here.
 */
export interface PayMethodDTO {
  name: string;
  /** which of the checkout's own buttons this is (bKash, Nagad … Visa); null = a way the checkout has no button for (a bank, another wallet) */
  via: PayVia | null;
  /** mobile wallets, cards, internet banking, anything else — the order they are shown in */
  group: "mobile" | "card" | "bank" | "other";
  /** SSLCommerz's picture of it (on sslcommerz.com); null = the name alone */
  logo: string | null;
  url: string;
}

export interface CertificateDTO {
  id: number;
  code: string;
  course_id: number;
  course_title_bn: string;
  course_title_en: string;
  student_name: string;
  issued_at: string;
  revoked_at: string | null;
}

export interface ReviewDTO {
  id: number;
  course_id: number;
  rating: number;
  body: string;
  status: "pending" | "approved" | "rejected";
  reply: string | null;
  created_at: string;
  author: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
