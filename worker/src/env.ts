import type { Context } from "hono";
import type { Role } from "@mawah/shared";

/** Everything the Worker can see. Optional entries are features that degrade gracefully when absent. */
export interface Env {
  // ---- bindings (wrangler.toml) ----
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  ASSETS: Fetcher;
  AI?: Ai;
  STREAM?: StreamBinding;
  RL_AUTH?: RateLimit;
  RL_CHECKOUT?: RateLimit;
  RL_CHAT?: RateLimit;
  RL_FORM?: RateLimit;
  RL_API?: RateLimit;

  // ---- public vars (wrangler.toml [vars]) ----
  ENVIRONMENT: string;
  SITE_URL: string;
  BRAND_CODE: string;
  DEFAULT_LANG: string;
  PAYMENT_MODE: string;
  MAIL_FROM: string;
  /** where notifications (payments, messages, questions …) go unless Admin → Settings → E-mail names other addresses */
  NOTIFY_EMAIL?: string;
  /** a student who replies to a receipt reaches this inbox (the Resend sender address itself is a no-reply one) */
  MAIL_REPLY_TO?: string;
  STREAM_CUSTOMER_CODE: string;
  TURNSTILE_SITE_KEY: string;
  /** Google Analytics 4: the property and the data stream of the shop (public numbers; the report in Admin → Analytics reads that property) */
  GA_PROPERTY_ID?: string;
  GA_STREAM_ID?: string;

  // ---- secrets (`wrangler secret put`) — never committed ----
  APP_SECRET: string;
  APP_SECRET_PREVIOUS?: string;
  SETUP_TOKEN?: string;
  SSLCOMMERZ_STORE_ID?: string;
  SSLCOMMERZ_STORE_PASSWORD?: string;
  BKASH_APP_KEY?: string;
  BKASH_APP_SECRET?: string;
  BKASH_USERNAME?: string;
  BKASH_PASSWORD?: string;
  RESEND_API_KEY?: string;
  /** the SMS company (msg.mram.com.bd): the key from its panel, and its address (the website's own address is enough) */
  SMS_API_KEY?: string;
  SMS_API_URL?: string;
  GEMINI_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * The Google "service account" key file (the whole JSON, or that text in base64) of an account the owner added as a Viewer of the
   * Google Analytics property: it lets Admin → Analytics read the numbers. A secret — never committed, never shown, never logged.
   */
  /** the Google service-account key file (a Secret): the file's text, or that text in base64 */
  GOOGLE_SERVICE_ACCOUNT?: string;
  /** Local development / tests only: enables the simulated payment gateway. */
  ALLOW_MOCK_PAYMENTS?: string;
  /** Local development / tests only: lets pages carry the analytics tag (it never does outside the real site otherwise). Ignored in production. */
  ANALYTICS_DEV?: string;
  /** Local development / tests only: where "Google" is (a stand-in served by the dev Worker itself). Ignored in production. */
  GOOGLE_API_BASE?: string;
}

export type Lang = "bn" | "en";

export interface StudentCtx {
  id: number;
  name: string;
  /** a buyer who gave no e-mail has a made-up address here (see isNoEmail in @mawah/shared): never mail it, never show it */
  email: string;
  phone: string | null;
  /** where they live, as given at checkout (absent = unknown) */
  address?: string;
  locale: Lang;
  /** false for an account made at checkout that has no password yet (absent = unknown, treated as having one) */
  has_password?: boolean;
}

export interface StaffCtx {
  id: number;
  name: string;
  email: string;
  role: Role;
  must_change_password: boolean;
}

export interface Vars {
  ip: string;
  reqId: string;
  student?: StudentCtx;
  staff?: StaffCtx;
}

export type AppEnv = { Bindings: Env; Variables: Vars };
export type Ctx = Context<AppEnv>;

export const isProd = (env: Env) => env.ENVIRONMENT === "production";
export const isDev = (env: Env) => env.ENVIRONMENT !== "production";
