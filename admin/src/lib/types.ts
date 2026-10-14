/** Shapes of the admin API responses (the Worker returns exactly these). */
export interface PageInfo {
  page: number;
  per_page: number;
  total: number;
  pages: number;
}

export interface ListResponse<T> {
  items: T[];
  page: PageInfo;
}

export interface CourseRow {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  short_bn: string;
  short_en: string;
  long_bn: string;
  long_en: string;
  banner_key: string | null;
  icon: string | null;
  category_id: number | null;
  instructor_id: number | null;
  level: "beginner" | "intermediate" | "advanced" | null;
  price: number;
  status: "draft" | "coming_soon" | "published" | "archived";
  details_url: string | null;
  featured: number;
  cert_enabled: number;
  cert_template: string;
  seo_title_bn: string;
  seo_title_en: string;
  seo_desc_bn: string;
  seo_desc_en: string;
  rating_avg: number;
  rating_count: number;
  lesson_count: number;
  duration_sec: number;
  sort: number;
  launch_at: string | null;
  published_at: string | null;
  updated_at: string;
  deleted_at: string | null;
  enrolled_count?: number;
  notify_count?: number;
}

export interface OrderRow {
  id: number;
  public_id: string;
  invoice_no: string | null;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  coupon_code: string | null;
  method: string | null;
  gateway: string | null;
  gateway_txn: string | null;
  payer_number: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  note: string;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  student_id: number;
  item_count: number;
  items: string;
  /** manual payments: the time the student was asked to pay by, when they sent proof, and whether a screenshot is on file */
  pay_by: string | null;
  proof_at: string | null;
  has_proof_image: number;
}

export interface Option {
  value: string;
  label: string;
}
