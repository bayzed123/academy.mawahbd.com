import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isDev, type AppEnv } from "../../env";
import { HttpError, ok } from "../../lib/http";
import { readOutbox } from "../../lib/mailer";
import { originGuard } from "../../middleware/csrf";
import { rateLimit } from "../../middleware/ratelimit";
import { apiHeaders } from "../../middleware/security";
import { adminAuthRoutes } from "./admin/auth";
import { adminApi } from "./admin";
import { authRoutes } from "./auth";
import { chatRoutes } from "./chat";
import { checkoutRoutes } from "./checkout";
import { courierRoutes } from "./courier";
import { devCourier } from "./dev-courier";
import { devGoogle } from "./dev-google";
import { paymentRoutes } from "./payments";
import { publicRoutes } from "./public";
import { shopRoutes } from "./shop";
import { studentRoutes } from "./student";

export const api = new Hono<AppEnv>();

api.use("*", apiHeaders);
api.use("*", originGuard);
// JSON endpoints never need big bodies; the upload routes (images, lesson files, payment screenshots) enforce their own larger caps
const jsonLimit = bodyLimit({
  maxSize: 256 * 1024,
  onError: () => {
    throw new HttpError(413, "payload_too_large");
  },
});
const isUpload = (method: string, path: string) =>
  method === "POST" &&
  (path === "/api/admin/media/image" || /^\/api\/admin\/lessons\/\d+\/resources$/.test(path) || /^\/api\/checkout\/[a-z0-9]+\/proof-image$/.test(path));
api.use("*", (c, next) => (isUpload(c.req.method, new URL(c.req.url).pathname) ? next() : jsonLimit(c, next)));
// payment gateway callbacks and the couriers' webhooks come from those companies' servers, not a browser: exempt from the per-IP limiter.
// So are the two video routes: one playing video asks many times (to start, to skip around) and a phone network shows many students as
// one address — they have limits of their own
const DOES_ITS_OWN_LIMIT = /^\/api\/(?:payments\/|courier\/|(?:student|preview)\/lessons\/\d+\/media$)/;
api.use("*", async (c, next) => {
  if (DOES_ITS_OWN_LIMIT.test(new URL(c.req.url).pathname)) return next();
  return rateLimit("RL_API")(c, next);
});

api.get("/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS up").first<{ up: number }>();
  return ok(c, { status: row?.up === 1 ? "up" : "degraded", env: c.env.ENVIRONMENT });
});

api.route("/auth", authRoutes);
api.route("/admin/auth", adminAuthRoutes);
api.route("/admin", adminApi);
api.route("/student", studentRoutes);
api.route("/checkout", checkoutRoutes);
api.route("/payments", paymentRoutes);
api.route("/chat", chatRoutes);
api.route("/shop", shopRoutes);
api.route("/courier", courierRoutes);
api.route("/", publicRoutes);

// development and tests only: a stand-in for Google, so Admin → Analytics can be exercised without a Google account
api.route("/dev/google", devGoogle);
// development and tests only: a stand-in for Steadfast and Pathao, so sending a parcel can be exercised without a courier account
api.route("/dev/courier", devCourier);

// development only: read e-mails the app "sent" (password-reset links etc.) so flows can be tested end to end
api.get("/dev/outbox", async (c) => {
  if (!isDev(c.env)) throw new HttpError(404, "not_found");
  return ok(c, { messages: await readOutbox(c.env, c.req.query("to")) });
});
