export const ROLES = ["super_admin", "content_manager", "support", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, { bn: string; en: string }> = {
  super_admin: { bn: "সুপার অ্যাডমিন", en: "Super Admin" },
  content_manager: { bn: "কনটেন্ট ম্যানেজার", en: "Content Manager" },
  support: { bn: "সাপোর্ট", en: "Support" },
  viewer: { bn: "শুধু দেখার অনুমতি", en: "Read-only Viewer" },
};

export const COURSE_STATUSES = ["draft", "coming_soon", "published", "archived"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const ORDER_STATUSES = ["pending", "awaiting_verification", "paid", "failed", "cancelled", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ["bkash", "nagad", "rocket", "card", "manual", "free", "mock"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Everything the owner can be told about by e-mail the moment it happens (Admin → Settings → E-mail → Notifications). */
export const NOTIFY_KINDS = ["order_paid", "payment_waiting", "payment_failed", "contact_message", "new_student", "course_question", "review_pending", "chat_handoff", "group_request", "notify_me", "newsletter", "shop_order", "shop_review", "shop_courier"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** Where a student account came from: they registered, they were made at checkout for a buyer who did not register, staff added them, or an old list was imported. */
export const STUDENT_SOURCES = ["signup", "checkout", "admin", "import"] as const;
export type StudentSource = (typeof STUDENT_SOURCES)[number];

export const LESSON_TYPES = ["video", "external", "text", "resource"] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

/** Per-category accent tag — used consistently on cards, banners and pages (wayfinding, not a re-theme). */
export const ACCENTS = ["snack", "cake", "dessert", "cook", "sweet", "frozen"] as const;
export type Accent = (typeof ACCENTS)[number];

/**
 * Role-based access control matrix. The Worker enforces it on every admin route and the admin UI
 * reads the very same table to hide actions a role cannot perform — one source of truth.
 */
const ALL: readonly Role[] = ROLES;
const SA: readonly Role[] = ["super_admin"];
const SA_CM: readonly Role[] = ["super_admin", "content_manager"];
const SA_SP: readonly Role[] = ["super_admin", "support"];
const SA_CM_SP: readonly Role[] = ["super_admin", "content_manager", "support"];
const SA_SP_VW: readonly Role[] = ["super_admin", "support", "viewer"];
const SA_VW: readonly Role[] = ["super_admin", "viewer"];

export const PERMISSIONS = {
  "dashboard:read": ALL,
  "courses:read": ALL,
  "courses:write": SA_CM,
  "courses:delete": SA_CM,
  "courses:publish": SA_CM,
  "instructors:read": ALL,
  "instructors:write": SA_CM,
  "categories:read": ALL,
  "categories:write": SA_CM,
  "blog:read": ALL,
  "blog:write": SA_CM,
  "bundles:read": ALL,
  "bundles:write": SA_CM,
  "banners:read": ALL,
  "banners:write": SA_CM,
  "landing:read": ALL,
  "landing:write": SA_CM,
  "faqs:read": ALL,
  "faqs:write": SA_CM,
  "materials:read": ALL,
  "materials:write": SA_CM,
  "coupons:read": ALL,
  "coupons:write": SA_CM,
  // the tools shop: products and categories like the class catalogue; orders and reviews like class orders and reviews
  "shop:read": ALL,
  "shop:write": SA_CM,
  "shop:orders": SA_SP_VW,
  "shop:orders_write": SA_SP,
  "shop:reviews": SA_SP,
  "media:write": SA_CM,
  "orders:read": SA_SP_VW,
  "orders:verify": SA_SP,
  "orders:refund": SA,
  "students:read": SA_SP_VW,
  "students:write": SA_SP,
  "reviews:read": ALL,
  "reviews:moderate": SA_SP,
  "questions:read": ALL,
  "questions:answer": SA_CM_SP,
  "certificates:read": ALL,
  "certificates:write": SA_SP,
  "signups:read": ALL,
  "signups:write": SA_CM_SP,
  "messages:read": ALL,
  "messages:write": SA_CM_SP,
  "chatbot:read": ["super_admin", "content_manager", "viewer"],
  "chatbot:write": SA,
  "reports:learning": ALL,
  "reports:revenue": SA_VW,
  "analytics:read": ["super_admin", "content_manager", "viewer"],
  "analytics:manage": SA,
  "staff:read": SA,
  "staff:write": SA,
  "settings:read": ALL,
  "settings:write": SA,
  "activity:read": SA_VW,
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Admin-facing sidebar order (matches the spec). */
export const ADMIN_NAV = [
  { key: "dashboard", path: "", perm: "dashboard:read" },
  { key: "courses", path: "courses", perm: "courses:read" },
  { key: "materials", path: "materials", perm: "materials:read" },
  { key: "instructors", path: "instructors", perm: "instructors:read" },
  { key: "orders", path: "orders", perm: "orders:read" },
  { key: "students", path: "students", perm: "students:read" },
  { key: "reviews", path: "reviews", perm: "reviews:read" },
  { key: "questions", path: "questions", perm: "questions:read" },
  { key: "blog", path: "blog", perm: "blog:read" },
  { key: "coupons", path: "coupons", perm: "coupons:read" },
  { key: "bundles", path: "bundles", perm: "bundles:read" },
  { key: "shop", path: "shop", perm: "shop:read" },
  { key: "banners", path: "banners", perm: "banners:read" },
  { key: "videos", path: "videos", perm: "banners:read" },
  { key: "landing", path: "landing", perm: "landing:read" },
  { key: "faqs", path: "faqs", perm: "faqs:read" },
  { key: "certificates", path: "certificates", perm: "certificates:read" },
  { key: "signups", path: "signups", perm: "signups:read" },
  { key: "messages", path: "messages", perm: "messages:read" },
  { key: "chatbot", path: "chatbot", perm: "chatbot:read" },
  { key: "reports", path: "reports", perm: "reports:learning" },
  { key: "analytics", path: "analytics", perm: "analytics:read" },
  { key: "staff", path: "staff", perm: "staff:read" },
  { key: "settings", path: "settings", perm: "settings:read" },
  { key: "activity", path: "activity", perm: "activity:read" },
  { key: "help", path: "help", perm: "dashboard:read" },
] as const satisfies readonly { key: string; path: string; perm: Permission }[];

/** Where a banner is shown: the slider at the top of the home page, the offer pop-up, or the slider at the top of the shop's pages. */
export const BANNER_PLACEMENTS = ["hero", "popup", "shop"] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

/** How a banner is laid out: the words on the left over the picture, in the middle, or in their own panel beside the picture. */
export const BANNER_LAYOUTS = ["left", "center", "split"] as const;
export type BannerLayout = (typeof BANNER_LAYOUTS)[number];
/** The colour of a banner: the brand's dark, its red, its gold, or ivory paper. */
export const BANNER_THEMES = ["dark", "ruby", "gold", "ivory"] as const;
export type BannerTheme = (typeof BANNER_THEMES)[number];
/** Which part of a tall or wide photo stays in view when the banner crops it. */
export const BANNER_FOCUS = ["top", "center", "bottom"] as const;
export type BannerFocus = (typeof BANNER_FOCUS)[number];

/** Pictures a class can show besides its main one (Admin → a class → Pictures). */
export const MAX_CLASS_PICTURES = 12;

/** What a question is about (site-wide questions are grouped by it on the FAQ page). */
export const FAQ_TOPICS = ["general", "payment", "learning", "certificate", "refund"] as const;
export type FaqTopic = (typeof FAQ_TOPICS)[number];

/**
 * What the owner can add to a class beyond its lessons (Admin → Materials), in the order the type cards are shown:
 * files to download (video, PDF, ZIP, book), a live class (link + time), a plain link, and a private group.
 */
export const MATERIAL_KINDS = ["video", "pdf", "zip", "book", "live", "link", "group"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
/** These can be an uploaded file or, instead, a link (Google Drive, YouTube …); the other kinds are always a link. */
export const FILE_MATERIAL_KINDS = ["video", "pdf", "zip", "book"] as const satisfies readonly MaterialKind[];
export const LIVE_PLATFORMS = ["zoom", "meet", "facebook", "youtube", "other"] as const;
export const GROUP_PLATFORMS = ["facebook", "whatsapp", "telegram", "other"] as const;
/** Cloudflare accepts request bodies up to 100 MB on its Free and Pro plans: a file is sent in one piece, so stay under it. */
export const MAX_UPLOAD_MATERIAL_BYTES = 95 * 1024 * 1024;

/** Icons available for category tags and generated class banners (see marketing/public/sprite.svg). */
export const CLASS_ICONS = ["cake", "snack", "glass", "bowl", "sweet", "snowflake", "cupcake", "brownie", "pastry", "pot", "crescent", "tiffin", "mango"] as const;
export type ClassIcon = (typeof CLASS_ICONS)[number];

export const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_RESOURCE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

/** Manual (send-money) payments: the student is asked to pay within this many minutes; the owner can change it in Settings → Payments. */
export const MANUAL_WINDOW_DEFAULT_MIN = 20;
export const MANUAL_WINDOW_RANGE_MIN = { min: 5, max: 120 } as const;
/** A payment screenshot is a phone screenshot: after the browser shrinks it, 3 MB is far more than enough. */
export const MAX_PROOF_IMAGE_BYTES = 3 * 1024 * 1024;
/** Screenshots show wallet balances and phone numbers, so they are deleted this long after the order is settled. */
export const PROOF_RETENTION_DAYS = 90;
