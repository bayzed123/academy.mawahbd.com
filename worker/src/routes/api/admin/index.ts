import { Hono } from "hono";
import type { AppEnv } from "../../../env";
import { requireStaff } from "../../../middleware/auth";
import { analytics } from "./analytics";
import { audience } from "./audience";
import { banners } from "./banners";
import { chatbot } from "./chatbot";
import { courseOverview } from "./course-overview";
import { blog, bundles, categories, coupons, courses, instructors } from "./content";
import { curriculum } from "./curriculum";
import { dashboard } from "./dashboard";
import { engagement } from "./engagement";
import { faqs } from "./faqs";
import { materials } from "./materials";
import { media } from "./media";
import { orders } from "./orders";
import { reports } from "./reports";
import { settings } from "./settings";
import { staff } from "./staff";
import { students } from "./students";

/**
 * Everything under /api/admin (except /auth, mounted earlier) needs a valid staff session.
 * Each route then adds its own RBAC check from the shared permission matrix (requirePerm).
 */
export const adminApi = new Hono<AppEnv>();

adminApi.use("*", requireStaff);

adminApi.route("/instructors", instructors);
adminApi.route("/categories", categories);
adminApi.route("/blog", blog);
adminApi.route("/bundles", bundles);
adminApi.route("/banners", banners);
adminApi.route("/faqs", faqs);
adminApi.route("/coupons", coupons);
adminApi.route("/courses", courses);

for (const router of [courseOverview, curriculum, materials, media, orders, students, engagement, audience, analytics, chatbot, settings, reports, dashboard, staff]) {
  adminApi.route("/", router);
}
