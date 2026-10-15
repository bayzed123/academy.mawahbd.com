import type { Accent, CourseStatus, LessonType, OrderStatus, PaymentMethod, Role } from "./constants";

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
  price: number;
  status: CourseStatus;
  level: "beginner" | "intermediate" | "advanced" | null;
  rating_avg: number;
  rating_count: number;
  lesson_count: number;
  featured: boolean;
  category: Pick<CategoryDTO, "slug" | "name_bn" | "name_en" | "accent" | "icon"> | null;
}

export interface StudentMe {
  kind: "student";
  id: number;
  name: string;
  email: string;
  phone: string | null;
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
  external: { url: string; embed_url: string | null } | null;
  resources: LessonResourceDTO[];
  completed: boolean;
  prev_id: number | null;
  next_id: number | null;
}

export interface OrderItemDTO {
  course_id: number;
  /** class slug (for "go to class" links); absent on quotes built before the class row is joined */
  slug?: string;
  title_bn: string;
  title_en: string;
  price: number;
  list_price: number;
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
  /** only while a manual order is still open: where to send the money */
  manual?: ManualPayInfo | null;
  items: OrderItemDTO[];
}

/** Where a manual (send-money) payment goes, and how long the student has. */
export interface ManualPayInfo {
  numbers: { bkash: string; nagad: string; rocket: string };
  note_bn: string;
  note_en: string;
  /** minutes the student is asked to pay within */
  window_min: number;
}

/** How the student pays: SSLCommerz hosted page (bKash/Nagad/Rocket/cards), bKash direct, manual send-money, or the dev-only mock. */
export type Channel = "sslcommerz" | "bkash" | "manual" | "mock";

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
