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
  STREAM_CUSTOMER_CODE: string;
  TURNSTILE_SITE_KEY: string;

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
  GEMINI_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Local development / tests only: enables the simulated payment gateway. */
  ALLOW_MOCK_PAYMENTS?: string;
}

export type Lang = "bn" | "en";

export interface StudentCtx {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  locale: Lang;
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
