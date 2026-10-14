import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, first, run } from "../../lib/db";
import { HttpError, intParam, notFound, ok, parseBody, parseQuery } from "../../lib/http";
import { contactAckMail, sendMail } from "../../lib/mailer";
import { emailSchema, langSchema, nameSchema, phoneSchema, textSchema, turnstileField } from "../../lib/schemas";
import { getSettings } from "../../lib/settings";
import { turnstileEnabled, verifyTurnstile } from "../../lib/turnstile";
import { loadStudent } from "../../middleware/auth";
import { rateLimit } from "../../middleware/ratelimit";
import { approvedReviews, getCourseBySlug, getCurriculum, listCategories, listCourses, relatedCourses } from "../../services/catalog";
import { certificateByCode, lessonContent } from "../../services/learning";

export const publicRoutes = new Hono<AppEnv>();

const cacheable = (c: Context<AppEnv>, seconds = 60) => c.header("Cache-Control", `public, max-age=${seconds}, s-maxage=${seconds * 2}`);

/** Non-sensitive site configuration for the React apps (contact channels, announcement, feature switches). */
publicRoutes.get("/site", async (c) => {
  const s = await getSettings(c.env);
  cacheable(c, 30);
  return ok(c, {
    site: {
      contact: { whatsapp: s.contact.whatsapp, phone: s.contact.phone, email: s.contact.email, facebook: s.contact.facebook },
      announcement: s.announcement,
      chat_enabled: s.chatbot.enabled,
      greeting: { bn: s.chatbot.greeting_bn, en: s.chatbot.greeting_en },
      turnstile_site_key: turnstileEnabled(c.env) ? c.env.TURNSTILE_SITE_KEY : "",
      environment: c.env.ENVIRONMENT,
    },
  });
});

const listQuery = z.object({
  cat: z.string().max(60).optional(),
  q: z.string().max(80).optional(),
  sort: z.enum(["featured", "new", "price_asc", "price_desc"]).optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
  per_page: z.coerce.number().int().min(1).max(60).optional(),
});

publicRoutes.get("/courses", async (c) => {
  const q = parseQuery(c, listQuery);
  const { items, total } = await listCourses(c.env, { category: q.cat, q: q.q, sort: q.sort, page: q.page, perPage: q.per_page });
  cacheable(c);
  return ok(c, { courses: items, total, page: q.page ?? 1, per_page: q.per_page ?? 12 });
});

publicRoutes.get("/courses/:slug", async (c) => {
  const course = await getCourseBySlug(c.env, c.req.param("slug"));
  if (!course) throw notFound();
  const [curriculum, reviews, related] = await Promise.all([getCurriculum(c.env, course.id), approvedReviews(c.env, course.id), relatedCourses(c.env, course)]);
  cacheable(c);
  return ok(c, { course, curriculum, reviews, related });
});

publicRoutes.get("/categories", async (c) => {
  cacheable(c, 300);
  return ok(c, { categories: await listCategories(c.env) });
});

publicRoutes.get("/bundles", async (c) => {
  const bundles = await all<{ id: number; slug: string; title_bn: string; title_en: string; desc_bn: string; desc_en: string; price: number }>(
    c.env.DB,
    "SELECT id, slug, title_bn, title_en, desc_bn, desc_en, price FROM bundles WHERE status = 'published' AND deleted_at IS NULL ORDER BY sort, id",
  );
  const items = bundles.length
    ? await all<{ bundle_id: number; slug: string; title_bn: string; title_en: string; price: number }>(
        c.env.DB,
        `SELECT bi.bundle_id, c.slug, c.title_bn, c.title_en, c.price FROM bundle_items bi JOIN courses c ON c.id = bi.course_id
         WHERE c.deleted_at IS NULL AND c.status = 'published'`,
      )
    : [];
  cacheable(c);
  return ok(c, {
    bundles: bundles.map((b) => ({
      ...b,
      courses: items.filter((i) => i.bundle_id === b.id).map(({ bundle_id: _b, ...rest }) => rest),
    })),
  });
});

/** Free preview lessons are watchable by anyone (that is the point of a preview). */
publicRoutes.get("/preview/lessons/:id", loadStudent, rateLimit("RL_FORM"), async (c) => {
  const lesson = await lessonContent(c.env, intParam(c, "id"), c.get("student")?.id ?? null);
  if (!c.get("student") && !lesson.video && !lesson.external && !lesson.body_html_bn && !lesson.body_html_en) throw notFound();
  return ok(c, { lesson });
});

/* --------------------------------------------------- public forms ---------------------------------------------------
 * These work without JavaScript (a plain <form method="post">): browsers get a 303 back to the page with a
 * flash flag, scripts get JSON. All are rate-limited and (when configured) protected by Cloudflare Turnstile. */
const wantsHtml = (c: Context<AppEnv>) => {
  const accept = c.req.header("accept") ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
};

function backWithFlag(c: Context<AppEnv>, flag: string) {
  let target = "/";
  try {
    const ref = new URL(c.req.header("referer") ?? "");
    if (ref.host === new URL(c.req.url).host) {
      ref.searchParams.set("n", flag);
      target = `${ref.pathname}${ref.search}#form-status`;
    }
  } catch {
    /* no usable referer */
  }
  return c.redirect(target, 303);
}

async function handleForm<S extends z.ZodType>(
  c: Context<AppEnv>,
  schema: S,
  okFlag: string,
  work: (body: z.output<S>) => Promise<void>,
) {
  try {
    const body = await parseBody(c, schema);
    const turnstile = (body as { turnstile?: string }).turnstile;
    if (!(await verifyTurnstile(c.env, turnstile, c.get("ip")))) throw new HttpError(400, "captcha");
    await work(body);
    return wantsHtml(c) ? backWithFlag(c, okFlag) : ok(c);
  } catch (err) {
    if (wantsHtml(c) && err instanceof HttpError && err.status !== 429) return backWithFlag(c, "err");
    throw err;
  }
}

const notifySchema = z.object({ course: z.string().trim().min(1).max(120), email: emailSchema, phone: phoneSchema, lang: langSchema.optional().default("bn"), turnstile: turnstileField });

publicRoutes.post("/notify", rateLimit("RL_FORM"), (c) =>
  handleForm(c, notifySchema, "notify_ok", async (b) => {
    const course = await first<{ id: number }>(c.env.DB, "SELECT id FROM courses WHERE slug = ? AND status = 'coming_soon' AND deleted_at IS NULL", b.course);
    if (!course) throw new HttpError(422, "course_unavailable");
    await run(c.env.DB, "INSERT INTO notify_signups (course_id, email, phone, lang) VALUES (?, ?, ?, ?) ON CONFLICT(course_id, email) DO NOTHING", course.id, b.email, b.phone, b.lang);
  }),
);

const newsletterSchema = z.object({ email: emailSchema, lang: langSchema.optional().default("bn"), turnstile: turnstileField });

publicRoutes.post("/newsletter", rateLimit("RL_FORM"), (c) =>
  handleForm(c, newsletterSchema, "news_ok", async (b) => {
    await run(c.env.DB, "INSERT INTO subscribers (email, lang, source) VALUES (?, ?, 'site') ON CONFLICT(email) DO UPDATE SET unsubscribed_at = NULL", b.email, b.lang);
  }),
);

const contactSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  message: textSchema(2000, 5),
  lang: langSchema.optional().default("bn"),
  turnstile: turnstileField,
});

publicRoutes.post("/contact", rateLimit("RL_FORM"), (c) =>
  handleForm(c, contactSchema, "contact_ok", async (b) => {
    await run(c.env.DB, "INSERT INTO contact_messages (name, email, phone, message) VALUES (?, ?, ?, ?)", b.name, b.email, b.phone ?? "", b.message);
    c.executionCtx.waitUntil(sendMail(c.env, { to: b.email, ...contactAckMail(b.lang, { name: b.name }) }));
  }),
);

/* -------------------------------------------------- certificate lookup -------------------------------------------------- */
publicRoutes.get("/certificates/verify/:code", rateLimit("RL_FORM"), async (c) => {
  const cert = await certificateByCode(c.env, c.req.param("code"));
  if (!cert) return ok(c, { valid: false, revoked: false, certificate: null });
  return ok(c, {
    valid: !cert.revoked_at,
    revoked: !!cert.revoked_at,
    certificate: {
      code: cert.code,
      student_name: cert.student_name,
      course_title_bn: cert.course_title_bn,
      course_title_en: cert.course_title_en,
      issued_at: cert.issued_at,
    },
  });
});
