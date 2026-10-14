import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv, Ctx } from "./env";
import { HttpError } from "./lib/http";
import { langFromPath, pageCtxFor } from "./lib/pagectx";
import { renderHtml } from "./lib/render";
import { baseSecurity } from "./middleware/security";
import { api } from "./routes/api";
import { mediaRoutes } from "./routes/media";
import { fragmentRoutes, pageRoutes } from "./routes/pages";
import { seoRoutes } from "./routes/seo";
import { spaRoutes } from "./routes/spa";
import { ErrorPage } from "./views/pages/misc";

export const app = new Hono<AppEnv>();

// request context: id + client IP (Cloudflare supplies CF-Connecting-IP; never trust X-Forwarded-For blindly)
app.use("*", async (c, next) => {
  c.set("reqId", crypto.randomUUID().slice(0, 8));
  c.set("ip", c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? "unknown");
  await next();
});
app.use("*", baseSecurity);

app.route("/api", api);
app.route("/media", mediaRoutes);
app.route("/_f", fragmentRoutes);
app.route("/", seoRoutes);
app.route("/", spaRoutes);
app.route("/en", pageRoutes("en"));
app.route("/", pageRoutes("bn"));

async function errorPage(c: Ctx, status: 404 | 500): Promise<Response> {
  const pathname = new URL(c.req.url).pathname;
  const lang = langFromPath(pathname);
  try {
    const ctx = await pageCtxFor(c, lang, "/");
    return await renderHtml(c, ctx, <ErrorPage ctx={ctx} status={status} />, { status });
  } catch {
    // last resort: never fail while rendering the failure page
    return new Response(status === 404 ? "Not found" : "Something went wrong", { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    return c.json({ ok: false, error: { code: "not_found", message: "not_found" } }, 404);
  }
  return errorPage(c, 404);
});

app.onError((err, c) => {
  const isApi = new URL(c.req.url).pathname.startsWith("/api/");
  let status = 500;
  let code = "server_error";
  let fields: Record<string, string> | undefined;

  if (err instanceof HttpError) {
    status = err.status;
    code = err.code;
    fields = err.fields;
  } else if (err instanceof HTTPException) {
    status = err.status;
    code = err.status === 413 ? "payload_too_large" : "http_error";
  } else {
    console.error("unhandled_error", c.get("reqId"), err);
  }

  if (isApi) {
    return c.json({ ok: false, error: { code, message: code, ...(fields ? { fields } : {}) } }, status as ContentfulStatusCode);
  }
  if (status === 404) return errorPage(c, 404);
  if (status >= 500) return errorPage(c, 500);
  return c.text(code === "rate_limited" ? "Too many requests — please wait a minute." : "Request refused", status as ContentfulStatusCode);
});
