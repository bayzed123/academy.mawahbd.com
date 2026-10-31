import { Hono } from "hono";
import { isDev, type AppEnv } from "../../env";
import { HttpError } from "../../lib/http";

/*
 * A stand-in for Steadfast and Pathao, for development and the automatic tests ONLY (it answers 404 anywhere else, and the real site can
 * never be pointed at it: services/courier.ts only takes a plain-http courier address outside production). With STEADFAST_BASE_URL and
 * PATHAO_BASE_URL pointing here (scripts/e2e-server.mjs does that, with made-up keys), "Send to Steadfast / Pathao" and "Check the
 * couriers" can be pressed like on the real site: the answers have the couriers' own shapes. It checks only that the keys are sent.
 */
export const devCourier = new Hono<AppEnv>();

devCourier.use("*", async (c, next) => {
  if (!isDev(c.env)) throw new HttpError(404, "not_found");
  return next();
});

const code = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

/* ---- Steadfast (portal.packzy.com/api/v1) ---- */
const steadfastKeys = (h: (k: string) => string | undefined) => !!h("api-key") && !!h("secret-key");

devCourier.get("/steadfast/get_balance", (c) => (steadfastKeys((k) => c.req.header(k)) ? c.json({ status: 200, current_balance: 1520 }) : c.json({ status: 401, message: "Unauthorized" }, 401)));

devCourier.post("/steadfast/create_order", async (c) => {
  if (!steadfastKeys((k) => c.req.header(k))) return c.json({ status: 401, message: "Unauthorized" }, 401);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!/^01\d{9}$/.test(String(b.recipient_phone ?? ""))) return c.json({ status: 400, message: "Validation failed", errors: { recipient_phone: ["The recipient phone must be 11 digits."] } }, 422);
  return c.json({
    status: 200,
    message: "Consignment has been created successfully.",
    consignment: { consignment_id: 1_400_000 + Math.floor(Math.random() * 99_999), invoice: b.invoice, tracking_code: code(8), recipient_name: b.recipient_name, cod_amount: b.cod_amount, status: "in_review" },
  });
});

/* ---- Pathao (api-hermes.pathao.com) ---- */
const PATHAO_TOKEN = "dev-pathao-token";
const login = async (c: { req: { json: () => Promise<unknown> } }) => {
  const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return !!b.client_id && !!b.client_secret;
};
devCourier.post("/pathao/aladdin/api/v1/external/login", async (c) =>
  (await login(c)) ? c.json({ type: "success", code: 200, data: { access_token: PATHAO_TOKEN, token_type: "Bearer", expires_in: 86_400 } }) : c.json({ message: "Invalid client credentials" }, 401),
);
devCourier.post("/pathao/aladdin/api/v1/issue-token", async (c) =>
  (await login(c)) ? c.json({ token_type: "Bearer", expires_in: 86_400, access_token: PATHAO_TOKEN, refresh_token: "dev-refresh" }) : c.json({ message: "Invalid credentials" }, 401),
);
const pathaoAuthed = (h: string | undefined) => h === `Bearer ${PATHAO_TOKEN}`;
devCourier.get("/pathao/aladdin/api/v1/stores", (c) =>
  pathaoAuthed(c.req.header("authorization"))
    ? c.json({ type: "success", code: 200, data: { data: [{ store_id: 130820, store_name: "MAWAH Chattogram (stand-in)", store_address: "Chandgaon, Chattogram", is_active: 1 }] } })
    : c.json({ message: "Unauthenticated." }, 401),
);
devCourier.post("/pathao/aladdin/api/v1/orders", async (c) => {
  if (!pathaoAuthed(c.req.header("authorization"))) return c.json({ message: "Unauthenticated." }, 401);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!b.store_id) return c.json({ message: "Please fix the given errors", errors: { store_id: ["The store id field is required."] } }, 422);
  return c.json({ type: "success", code: 200, message: "Order Created Successfully", data: { consignment_id: `DL${code(10)}`, merchant_order_id: b.merchant_order_id, order_status: "Pending", delivery_fee: 70 } });
});
