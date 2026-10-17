import type {
  CertificateDTO,
  CourseCardDTO,
  CurriculumModuleDTO,
  LessonContentDTO,
  LessonResourceDTO,
  LessonType,
  MyCourseDTO,
  Progress,
} from "@mawah/shared";
import type { Env } from "../env";
import { auditAs } from "../lib/audit";
import { generateCertificateCode, normalizeCertificateCode } from "../lib/crypto";
import { addSeconds, all, first, nowIso, run } from "../lib/db";
import { forbidden, HttpError, notFound, unauthorized } from "../lib/http";
import { renderMarkdown } from "../lib/markdown";
import { driveReadable, driveRef } from "../lib/drive";
import { externalEmbed, streamEmbedUrl } from "../lib/stream";
import { getCurriculum, getCourseBySlug, toCard } from "./catalog";

export const CERT_PREFIX = "MWH";

export const pct = (done: number, total: number) => (total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0);

export async function activeEnrollment(env: Env, studentId: number, courseId: number) {
  return first<{ id: number; enrolled_at: string }>(
    env.DB,
    "SELECT id, enrolled_at FROM enrollments WHERE student_id = ? AND course_id = ? AND status = 'active'",
    studentId,
    courseId,
  );
}

export async function progressFor(env: Env, studentId: number, courseId: number): Promise<Progress> {
  const row = await first<{ total: number; done: number }>(
    env.DB,
    `SELECT (SELECT COUNT(*) FROM lessons WHERE course_id = ?1) AS total,
            (SELECT COUNT(*) FROM lesson_progress WHERE student_id = ?2 AND course_id = ?1) AS done`,
    courseId,
    studentId,
  );
  const total = row?.total ?? 0;
  const done = Math.min(row?.done ?? 0, total);
  return { done, total, pct: pct(done, total) };
}

/* ------------------------------------------------ My Learning ------------------------------------------------ */
export async function myCourses(env: Env, studentId: number): Promise<MyCourseDTO[]> {
  const rows = await all<Record<string, unknown>>(
    env.DB,
    `SELECT e.enrolled_at,
            c.id, c.slug, c.title_bn, c.title_en, c.short_bn, c.short_en, c.banner_key, c.icon, c.price, c.status, c.level,
            c.rating_avg, c.rating_count, c.lesson_count, c.featured,
            cat.slug AS cat_slug, cat.name_bn AS cat_name_bn, cat.name_en AS cat_name_en, cat.accent AS cat_accent, cat.icon AS cat_icon,
            (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS total,
            (SELECT COUNT(*) FROM lesson_progress lp WHERE lp.student_id = e.student_id AND lp.course_id = c.id) AS done,
            (SELECT ce.code FROM certificates ce WHERE ce.student_id = e.student_id AND ce.course_id = c.id AND ce.revoked_at IS NULL) AS cert_code,
            (SELECT l.id FROM lessons l JOIN modules m ON m.id = l.module_id
              WHERE l.course_id = c.id AND l.id NOT IN (SELECT lesson_id FROM lesson_progress WHERE student_id = e.student_id)
              ORDER BY m.sort, m.id, l.sort, l.id LIMIT 1) AS resume_lesson
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id AND c.deleted_at IS NULL
     LEFT JOIN categories cat ON cat.id = c.category_id
     WHERE e.student_id = ? AND e.status = 'active'
     ORDER BY e.enrolled_at DESC`,
    studentId,
  );
  return rows.map((r) => {
    const total = Number(r.total);
    const done = Math.min(Number(r.done), total);
    return {
      course: toCard(r as never) as CourseCardDTO,
      progress: { done, total, pct: pct(done, total) },
      enrolled_at: r.enrolled_at as string,
      certificate_code: (r.cert_code as string | null) ?? null,
      resume_lesson_id: (r.resume_lesson as number | null) ?? null,
    };
  });
}

/* ------------------------------------------------- course view ------------------------------------------------- */
export interface StudentCourseView {
  course: NonNullable<Awaited<ReturnType<typeof getCourseBySlug>>>;
  enrolled_at: string;
  progress: Progress;
  curriculum: CurriculumModuleDTO[];
  certificate: CertificateDTO | null;
  review: { id: number; rating: number; body: string; status: string; reply: string | null } | null;
}

export async function courseForStudent(env: Env, studentId: number, slug: string): Promise<StudentCourseView> {
  const course = await getCourseBySlug(env, slug, { includeHidden: true });
  if (!course) throw notFound();
  const enrollment = await activeEnrollment(env, studentId, course.id);
  if (!enrollment) throw forbidden("not_enrolled");

  const [curriculum, doneRows, progress, certificate, review] = await Promise.all([
    getCurriculum(env, course.id),
    all<{ lesson_id: number }>(env.DB, "SELECT lesson_id FROM lesson_progress WHERE student_id = ? AND course_id = ?", studentId, course.id),
    progressFor(env, studentId, course.id),
    first<CertRow>(env.DB, "SELECT * FROM certificates WHERE student_id = ? AND course_id = ?", studentId, course.id),
    first<{ id: number; rating: number; body: string; status: string; reply: string | null }>(
      env.DB,
      "SELECT id, rating, body, status, reply FROM reviews WHERE student_id = ? AND course_id = ?",
      studentId,
      course.id,
    ),
  ]);
  const done = new Set(doneRows.map((r) => r.lesson_id));
  for (const m of curriculum) {
    const availableAt = m.drip_days > 0 ? addSeconds(enrollment.enrolled_at, m.drip_days * 86400) : null;
    const locked = availableAt !== null && Date.parse(availableAt) > Date.now();
    for (const l of m.lessons) {
      l.completed = done.has(l.id);
      l.available_at = locked && !l.is_preview ? availableAt : null;
    }
  }
  return { course, enrolled_at: enrollment.enrolled_at, progress, curriculum, certificate: certificate ? toCertificate(certificate) : null, review };
}

/* -------------------------------------------------- lessons --------------------------------------------------- */
interface LessonRow {
  id: number;
  course_id: number;
  module_id: number;
  title_bn: string;
  title_en: string;
  type: LessonType;
  stream_uid: string | null;
  external_url: string | null;
  body_bn: string;
  body_en: string;
  is_preview: number;
  drip_days: number;
  course_status: string;
  course_deleted: string | null;
}

async function loadLesson(env: Env, lessonId: number): Promise<LessonRow> {
  const row = await first<LessonRow>(
    env.DB,
    `SELECT l.id, l.course_id, l.module_id, l.title_bn, l.title_en, l.type, l.stream_uid, l.external_url, l.body_bn, l.body_en, l.is_preview,
            m.drip_days, c.status AS course_status, c.deleted_at AS course_deleted
     FROM lessons l JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = l.course_id WHERE l.id = ?`,
    lessonId,
  );
  if (!row || row.course_deleted) throw notFound();
  return row;
}

/** Authorise access to one lesson: enrolled (and past any drip date), or a free preview of a live class. */
async function authoriseLesson(env: Env, lesson: LessonRow, studentId: number | null): Promise<{ enrolled: boolean }> {
  const enrollment = studentId ? await activeEnrollment(env, studentId, lesson.course_id) : null;
  if (enrollment) {
    if (lesson.drip_days > 0 && !lesson.is_preview) {
      const availableAt = addSeconds(enrollment.enrolled_at, lesson.drip_days * 86400);
      if (Date.parse(availableAt) > Date.now()) throw new HttpError(403, "lesson_locked", "lesson_locked", { available_at: availableAt });
    }
    return { enrolled: true };
  }
  if (lesson.is_preview && lesson.course_status === "published") return { enrolled: false };
  if (!studentId) throw unauthorized();
  throw forbidden("not_enrolled");
}

export async function lessonContent(env: Env, lessonId: number, studentId: number | null): Promise<LessonContentDTO> {
  const lesson = await loadLesson(env, lessonId);
  const { enrolled } = await authoriseLesson(env, lesson, studentId);

  const [resources, order, completed] = await Promise.all([
    // downloadable files are for enrolled students only — previews never include them
    enrolled
      ? all<LessonResourceDTO>(env.DB, "SELECT id, title_bn, title_en, filename, size_bytes FROM lesson_resources WHERE lesson_id = ? ORDER BY id", lessonId)
      : Promise.resolve([] as LessonResourceDTO[]),
    all<{ id: number }>(
      env.DB,
      `SELECT l.id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.course_id = ? ORDER BY m.sort, m.id, l.sort, l.id`,
      lesson.course_id,
    ),
    studentId && enrolled
      ? first(env.DB, "SELECT 1 AS x FROM lesson_progress WHERE student_id = ? AND lesson_id = ?", studentId, lessonId)
      : Promise.resolve(null),
  ]);
  const ids = order.map((o) => o.id);
  const idx = ids.indexOf(lessonId);

  let video: LessonContentDTO["video"] = null;
  let external: LessonContentDTO["external"] = null;
  if (lesson.type === "video" && lesson.stream_uid) {
    const embed = await streamEmbedUrl(env, lesson.stream_uid);
    video = { embed_url: embed ?? "" };
  } else if (lesson.type === "external" && lesson.external_url) {
    const drive = driveRef(lesson.external_url);
    if (drive?.kind === "file" || drive?.kind === "folder") {
      // A Google Drive video plays only inside the portal, for the people who may watch this lesson (lib/drive.ts) — a student is never sent to
      // Drive: it would only ask them for permission, and it is the owner's private Drive. Until the website's own Google account can read the
      // file, the lesson says the video is being prepared; the owner sees why in the lesson editor ("Check access").
      external =
        drive.kind === "file" && (await driveReadable(env, drive.id))
          ? { url: "", embed_url: null, media_url: `/api/${enrolled ? "student" : "preview"}/lessons/${lesson.id}/media`, pending: false }
          : { url: "", embed_url: null, media_url: null, pending: true };
    } else {
      external = { url: lesson.external_url, embed_url: externalEmbed(lesson.external_url), media_url: null, pending: false };
    }
  }

  return {
    id: lesson.id,
    course_id: lesson.course_id,
    title_bn: lesson.title_bn,
    title_en: lesson.title_en,
    type: lesson.type,
    body_html_bn: renderMarkdown(lesson.body_bn),
    body_html_en: renderMarkdown(lesson.body_en),
    video,
    external,
    resources,
    completed: !!completed,
    prev_id: idx > 0 ? ids[idx - 1] : null,
    next_id: idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null,
  };
}

/**
 * Which Drive file this lesson plays, for a person who may watch the lesson (enrolled and past any drip date, or a free preview). The file is the one
 * the owner put in the lesson's link — never anything the student sends. 404 when the lesson is not a Drive video.
 */
export async function lessonDriveFile(env: Env, lessonId: number, studentId: number | null): Promise<string> {
  const lesson = await loadLesson(env, lessonId);
  await authoriseLesson(env, lesson, studentId);
  const ref = lesson.type === "external" && lesson.external_url ? driveRef(lesson.external_url) : null;
  if (ref?.kind !== "file") throw notFound();
  return ref.id;
}

/** Authorise + locate a downloadable lesson file. Enrolled students only. */
export async function resourceForDownload(env: Env, resourceId: number, studentId: number) {
  const res = await first<{ id: number; lesson_id: number; course_id: number; r2_key: string; filename: string; mime: string }>(
    env.DB,
    "SELECT id, lesson_id, course_id, r2_key, filename, mime FROM lesson_resources WHERE id = ?",
    resourceId,
  );
  if (!res) throw notFound();
  const lesson = await loadLesson(env, res.lesson_id);
  const { enrolled } = await authoriseLesson(env, lesson, studentId);
  if (!enrolled) throw forbidden("not_enrolled");
  return res;
}

export async function setLessonComplete(
  env: Env,
  studentId: number,
  lessonId: number,
  done: boolean,
): Promise<{ progress: Progress; certificate: CertificateDTO | null }> {
  const lesson = await loadLesson(env, lessonId);
  const { enrolled } = await authoriseLesson(env, lesson, studentId);
  if (!enrolled) throw forbidden("not_enrolled");

  if (done) {
    await run(
      env.DB,
      "INSERT OR IGNORE INTO lesson_progress (student_id, lesson_id, course_id, completed_at) VALUES (?, ?, ?, ?)",
      studentId,
      lessonId,
      lesson.course_id,
      nowIso(),
    );
  } else {
    await run(env.DB, "DELETE FROM lesson_progress WHERE student_id = ? AND lesson_id = ?", studentId, lessonId);
  }
  const progress = await progressFor(env, studentId, lesson.course_id);
  const certificate = done && progress.total > 0 && progress.done >= progress.total ? await issueCertificateIfEligible(env, studentId, lesson.course_id) : null;
  return { progress, certificate };
}

/* ------------------------------------------------- certificates ------------------------------------------------ */
export interface CertRow {
  id: number;
  code: string;
  student_id: number;
  course_id: number;
  student_name: string;
  course_title_bn: string;
  course_title_en: string;
  template: string;
  issued_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export const toCertificate = (r: CertRow): CertificateDTO => ({
  id: r.id,
  code: r.code,
  course_id: r.course_id,
  course_title_bn: r.course_title_bn,
  course_title_en: r.course_title_en,
  student_name: r.student_name,
  issued_at: r.issued_at,
  revoked_at: r.revoked_at,
});

/** Issue (once) the certificate for a fully completed class. Idempotent and race-safe (UNIQUE student+course). */
export async function issueCertificateIfEligible(env: Env, studentId: number, courseId: number): Promise<CertificateDTO | null> {
  const existing = await first<CertRow>(env.DB, "SELECT * FROM certificates WHERE student_id = ? AND course_id = ?", studentId, courseId);
  if (existing) return toCertificate(existing);

  const enrollment = await activeEnrollment(env, studentId, courseId);
  if (!enrollment) return null;
  const course = await first<{ cert_enabled: number }>(env.DB, "SELECT cert_enabled FROM courses WHERE id = ?", courseId);
  if (!course?.cert_enabled) return null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const code = generateCertificateCode(CERT_PREFIX);
    try {
      await run(
        env.DB,
        `INSERT INTO certificates (code, student_id, course_id, enrollment_id, student_name, course_title_bn, course_title_en, template, issued_at)
         SELECT ?, s.id, c.id, ?, s.name, c.title_bn, c.title_en, c.cert_template, ? FROM students s, courses c WHERE s.id = ? AND c.id = ?
         ON CONFLICT(student_id, course_id) DO NOTHING`,
        code,
        enrollment.id,
        nowIso(),
        studentId,
        courseId,
      );
      break;
    } catch (err) {
      if (!String(err).includes("UNIQUE") || attempt === 3) throw err; // astronomically unlikely code collision: retry
    }
  }
  const row = await first<CertRow>(env.DB, "SELECT * FROM certificates WHERE student_id = ? AND course_id = ?", studentId, courseId);
  if (!row) return null;
  await auditAs(env, { type: "system", id: null, name: "" }, { action: "certificate.issued", entity: "certificate", entityId: row.id, summary: row.code, meta: { studentId, courseId } });
  return toCertificate(row);
}

export async function certificatesFor(env: Env, studentId: number): Promise<CertificateDTO[]> {
  const rows = await all<CertRow>(env.DB, "SELECT * FROM certificates WHERE student_id = ? ORDER BY issued_at DESC", studentId);
  return rows.map(toCertificate);
}

/** Public lookup by verification code. Accepts sloppy input ("mwh 4k2p..." / lowercase / O instead of 0). */
export async function certificateByCode(env: Env, input: string): Promise<CertRow | null> {
  const code = normalizeCertificateCode(input, CERT_PREFIX);
  if (!code) return null;
  return first<CertRow>(env.DB, "SELECT * FROM certificates WHERE code = ?", code);
}
