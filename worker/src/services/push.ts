import type { Env } from "../env";
import { all, first, nowIso, run, safeJson } from "../lib/db";
import { fcmSend, pushSetup, topicChange, type PushProblem } from "../lib/fcm";
import { getSettings } from "../lib/settings";

/*
 * The Android app's notifications (lib/fcm.ts does the talking to Google):
 *  - a phone that allowed them is kept in push_devices with the topics it was added to: its language (lang-bn / lang-en) and, while a student
 *    is signed in on it, each class they study (class-<id>). The app hands its address over at every start, at sign-in and sign-out and when
 *    the language changes; only the difference is sent to Google;
 *  - staff send their own from Admin → Android app, to everyone or to one class's students; two go out by themselves (each can be switched
 *    off there): one of the app's free classes going live (to everyone, once per class) and a new lesson in a live class (to its students, at
 *    most once in NEW_LESSONS_GAP_H hours per class, so a teacher adding ten lessons in an evening sends one);
 *  - every send is written down (push_sends), with how it went.
 * Nothing here is ever about buying: the texts speak of classes and lessons, which Google Play allows the app to announce.
 */

export type PushKind = "manual" | "new_class" | "new_lessons";
export type PushLang = "bn" | "en";

export const langTopic = (lang: PushLang): string => `lang-${lang}`;
export const classTopic = (courseId: number): string => `class-${courseId}`;

/** The address Google gives a copy of the app (a "registration token"): letters, digits and - _ : . (about 160 characters). */
export const PUSH_TOKEN_RE = /^[A-Za-z0-9_:.-]{32,4096}$/;
/** a phone follows at most this many classes, the newest first (a student has far fewer; each one is one call to Google) */
const MAX_CLASS_TOPICS = 30;
/** one "new lessons" notification per class in this many hours */
export const NEW_LESSONS_GAP_H = 12;
/** a phone that has not opened the app for this long is not counted as getting notifications (the app checks in at every start) */
export const ACTIVE_DAYS = 60;
/** how long Google keeps a notification for a phone that is offline: a week (after that, news is old) */
const TTL_SECONDS = 7 * 86_400;

interface DeviceRow {
  id: number;
  token: string;
  student_id: number | null;
  lang: PushLang;
  topics: string;
}

const topicsOf = (raw: string): string[] => safeJson<unknown[]>(raw, []).filter((t): t is string => typeof t === "string");

/** The topics a phone should be in: its language, and the classes its student studies now. */
async function wantedTopics(env: Env, studentId: number | null, lang: PushLang): Promise<string[]> {
  const topics = [langTopic(lang)];
  if (studentId) {
    const rows = await all<{ course_id: number }>(
      env.DB,
      `SELECT e.course_id FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.student_id = ? AND e.status = 'active' AND c.deleted_at IS NULL ORDER BY e.enrolled_at DESC, e.id DESC LIMIT ?`,
      studentId,
      MAX_CLASS_TOPICS,
    );
    topics.push(...rows.map((r) => classTopic(r.course_id)));
  }
  return topics;
}

/**
 * Brings one phone's topics in line with what it should get. What Google did is what is written down: a topic it would not add is tried again
 * next time, one it would not remove stays listed (so it is removed next time). `gone`: Google does not know this phone any more.
 */
async function syncTopics(env: Env, token: string, had: string[], wanted: string[]): Promise<{ topics: string[]; gone: boolean; problem: PushProblem | null }> {
  const add = wanted.filter((t) => !had.includes(t));
  const remove = had.filter((t) => !wanted.includes(t));
  const [added, removed] = await Promise.all([
    Promise.all(add.map((t) => topicChange(env, "add", t, [token]))),
    Promise.all(remove.map((t) => topicChange(env, "remove", t, [token]))),
  ]);
  if (added.some((r) => r.ok && r.gone.length > 0)) return { topics: [], gone: true, problem: null };
  const failure = [...added, ...removed].find((r) => !r.ok);
  // still in: every topic it had that was not to be removed, or that Google would not remove; now in: every one Google added
  const stillIn = had.filter((t) => {
    const k = remove.indexOf(t);
    return k === -1 || !removed[k]!.ok;
  });
  const nowIn = add.filter((_, k) => added[k]!.ok);
  return { topics: [...new Set([...stillIn, ...nowIn])], gone: false, problem: failure && !failure.ok ? failure.problem : null };
}

export interface RegisterResult {
  /** false: Google does not know this phone's address (the app asks it for a new one) */
  registered: boolean;
  /** why the topics could not all be set yet (they are tried again at the app's next start) */
  problem: PushProblem | null;
}

/** A phone that allowed notifications checks in: kept (or brought up to date), with its topics set. `studentId` null = signed out on it. */
export async function registerDevice(env: Env, d: { token: string; studentId: number | null; lang: PushLang }): Promise<RegisterResult> {
  const setup = pushSetup(env);
  // notifications are not set up on the website yet: nothing is kept (Google cannot vouch for the address); the app checks in again at its next
  // start, and is set up then
  if (!setup.ok) return { registered: true, problem: setup.problem };
  const existing = await first<DeviceRow>(env.DB, "SELECT id, token, student_id, lang, topics FROM push_devices WHERE token = ?", d.token);
  const synced = await syncTopics(env, d.token, existing ? topicsOf(existing.topics) : [], await wantedTopics(env, d.studentId, d.lang));
  if (synced.gone) {
    if (existing) await run(env.DB, "DELETE FROM push_devices WHERE id = ?", existing.id);
    return { registered: false, problem: null };
  }
  const { topics, problem } = synced;
  const now = nowIso();
  await run(
    env.DB,
    `INSERT INTO push_devices (token, student_id, lang, topics, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET student_id = excluded.student_id, lang = excluded.lang, topics = excluded.topics, updated_at = excluded.updated_at`,
    d.token,
    d.studentId,
    d.lang,
    JSON.stringify(topics),
    now,
    now,
  );
  return { registered: true, problem };
}

/** The phone turned notifications off (Profile → Notifications): taken off every topic and forgotten. */
export async function unregisterDevice(env: Env, token: string): Promise<void> {
  const row = await first<DeviceRow>(env.DB, "SELECT id, token, student_id, lang, topics FROM push_devices WHERE token = ?", token);
  if (!row) return;
  if (pushSetup(env).ok) await Promise.all(topicsOf(row.topics).map((t) => topicChange(env, "remove", t, [token])));
  await run(env.DB, "DELETE FROM push_devices WHERE id = ?", row.id);
}

/** A copy of the app got a new address from Google: the old one is forgotten (Google stops using it on its own). */
export async function forgetDevice(env: Env, token: string): Promise<void> {
  await run(env.DB, "DELETE FROM push_devices WHERE token = ?", token);
}

/** A student's classes changed (they joined one in the app): their phones are added to its topic now rather than at the app's next start. */
export async function syncStudentDevices(env: Env, studentId: number): Promise<void> {
  if (!pushSetup(env).ok) return;
  const rows = await all<DeviceRow>(env.DB, "SELECT id, token, student_id, lang, topics FROM push_devices WHERE student_id = ? ORDER BY updated_at DESC LIMIT 5", studentId);
  for (const r of rows) await registerDevice(env, { token: r.token, studentId, lang: r.lang === "en" ? "en" : "bn" });
}

/* ---------------------------------------------------------------------------------------------------- sending */

export interface PushText {
  title_bn: string;
  body_bn: string;
  title_en: string;
  body_en: string;
}

export interface PushSendRow extends PushText {
  id: number;
  kind: PushKind;
  course_id: number | null;
  audience: "all" | "class";
  path: string;
  status: "sent" | "failed";
  problem: PushProblem | null;
  staff_id: number | null;
  created_at: string;
}

/**
 * Sends one notification in both languages — each phone gets the one in its language — to everyone with the app (`audience` all) or to the
 * students of one class, and writes it down. `path` is what a tap opens in the app.
 */
export async function sendPush(
  env: Env,
  o: { kind: PushKind; courseId: number | null; audience: "all" | "class"; text: PushText; path: string; staffId: number | null },
): Promise<PushSendRow> {
  if (o.audience === "class" && !o.courseId) throw new Error("a class notification needs its class");
  const results = await Promise.all(
    (["bn", "en"] as const).map((lang) =>
      fcmSend(env, {
        to: o.audience === "all" ? { topic: langTopic(lang) } : { condition: `'${classTopic(o.courseId!)}' in topics && '${langTopic(lang)}' in topics` },
        title: lang === "bn" ? o.text.title_bn : o.text.title_en,
        body: lang === "bn" ? o.text.body_bn : o.text.body_en,
        path: o.path,
        data: { kind: o.kind },
        ttlSeconds: TTL_SECONDS,
        // new lessons of one class replace each other in the phone's list instead of piling up
        ...(o.kind === "new_lessons" && o.courseId ? { tag: classTopic(o.courseId) } : {}),
      }),
    ),
  );
  const failed = results.find((r) => !r.ok);
  const problem = failed && !failed.ok ? failed.problem : null;
  const res = await run(
    env.DB,
    `INSERT INTO push_sends (kind, course_id, audience, title_bn, body_bn, title_en, body_en, path, status, problem, staff_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    o.kind,
    o.courseId,
    o.audience,
    o.text.title_bn,
    o.text.body_bn,
    o.text.title_en,
    o.text.body_en,
    o.path,
    problem ? "failed" : "sent",
    problem,
    o.staffId,
    nowIso(),
  );
  return (await first<PushSendRow>(env.DB, "SELECT * FROM push_sends WHERE id = ?", res.meta.last_row_id as number))!;
}

/* ---------------------------------------------------------------------------------------------------- the automatic ones */

/** What the automatic notifications say (shown by the phone as they are: plain words, no buying). (Exported for the tests.) */
export const AUTO_TEXT = {
  new_class: (title: { bn: string; en: string }): PushText => ({
    title_bn: "নতুন ফ্রি ক্লাস এসেছে",
    body_bn: `${title.bn} — অ্যাপে এখনই শুরু করুন।`,
    title_en: "A new free class is here",
    body_en: `${title.en} — start it now in the app.`,
  }),
  new_lessons: (course: { bn: string; en: string }, lesson: { bn: string; en: string }): PushText => ({
    title_bn: `নতুন লেসন: ${course.bn}`,
    body_bn: lesson.bn,
    title_en: `New lesson: ${course.en}`,
    body_en: lesson.en,
  }),
};

interface CourseRow {
  id: number;
  slug: string;
  title_bn: string;
  title_en: string;
  status: string;
  channel: string;
  deleted_at: string | null;
}

const courseRow = (env: Env, id: number) =>
  first<CourseRow>(env.DB, "SELECT id, slug, title_bn, title_en, status, channel, deleted_at FROM courses WHERE id = ?", id);

/**
 * One of the app's free classes went live for the first time: everyone with the app hears of it (once per class, ever). A class sold on the
 * website is not announced in the app — Google Play does not let an app point people to buying outside it; staff may still write their own.
 */
export async function announceNewClass(env: Env, courseId: number): Promise<PushSendRow | null> {
  if (!pushSetup(env).ok || !(await getSettings(env)).push.new_class) return null;
  const course = await courseRow(env, courseId);
  if (!course || course.deleted_at || course.status !== "published" || course.channel !== "app") return null;
  if (await first(env.DB, "SELECT id FROM push_sends WHERE kind = 'new_class' AND course_id = ? AND status = 'sent' LIMIT 1", courseId)) return null;
  return sendPush(env, {
    kind: "new_class",
    courseId,
    audience: "all",
    text: AUTO_TEXT.new_class({ bn: course.title_bn, en: course.title_en }),
    path: `/free/${course.slug}`,
    staffId: null,
  });
}

/** A lesson was added to a live class: its students hear of it, at most once in NEW_LESSONS_GAP_H hours per class. */
export async function announceNewLesson(env: Env, courseId: number, lesson: { title_bn: string; title_en: string }): Promise<PushSendRow | null> {
  if (!pushSetup(env).ok || !(await getSettings(env)).push.new_lessons) return null;
  const course = await courseRow(env, courseId);
  if (!course || course.deleted_at || course.status !== "published") return null;
  if (!(await first(env.DB, "SELECT id FROM enrollments WHERE course_id = ? AND status = 'active' LIMIT 1", courseId))) return null;
  const since = nowIso(new Date(Date.now() - NEW_LESSONS_GAP_H * 3_600_000));
  if (await first(env.DB, "SELECT id FROM push_sends WHERE kind = 'new_lessons' AND course_id = ? AND status = 'sent' AND created_at > ? LIMIT 1", courseId, since)) return null;
  return sendPush(env, {
    kind: "new_lessons",
    courseId,
    audience: "class",
    text: AUTO_TEXT.new_lessons({ bn: course.title_bn, en: course.title_en }, { bn: lesson.title_bn, en: lesson.title_en }),
    path: `/course/${course.slug}`,
    staffId: null,
  });
}

/* ---------------------------------------------------------------------------------------------------- Admin → Android app */

export interface PushOverview {
  /** the website has a key and a project to send with (whether Google agrees: Check the connection) */
  ready: boolean;
  problem: PushProblem | null;
  project: string | null;
  account: string | null;
  /** phones that allowed notifications and opened the app in the last ACTIVE_DAYS days; of them, with a student signed in */
  phones: number;
  signed_in: number;
  auto: { new_class: boolean; new_lessons: boolean };
  /** the live classes staff may point a notification at (has_demo: a website class the app shows by its free demo) */
  choices: { id: number; title_bn: string; title_en: string; channel: "website" | "app"; has_demo: number }[];
  recent: (PushSendRow & { course_title_bn: string | null; course_title_en: string | null; staff_name: string | null })[];
}

export async function pushOverview(env: Env): Promise<PushOverview> {
  const setup = pushSetup(env);
  const since = nowIso(new Date(Date.now() - ACTIVE_DAYS * 86_400_000));
  const [counts, choices, recent, s] = await Promise.all([
    first<{ phones: number; signed_in: number }>(
      env.DB,
      "SELECT COUNT(*) AS phones, COUNT(student_id) AS signed_in FROM push_devices WHERE updated_at >= ?",
      since,
    ),
    all<PushOverview["choices"][number]>(
      env.DB,
      `SELECT id, title_bn, title_en, channel, (demo_url IS NOT NULL AND demo_url <> '') AS has_demo FROM courses
       WHERE status = 'published' AND deleted_at IS NULL ORDER BY channel = 'app' DESC, sort, id LIMIT 300`,
    ),
    all<PushOverview["recent"][number]>(
      env.DB,
      `SELECT p.*, c.title_bn AS course_title_bn, c.title_en AS course_title_en, st.name AS staff_name
       FROM push_sends p LEFT JOIN courses c ON c.id = p.course_id LEFT JOIN staff st ON st.id = p.staff_id
       ORDER BY p.id DESC LIMIT 20`,
    ),
    getSettings(env, { fresh: true }),
  ]);
  return {
    ready: setup.ok,
    problem: setup.ok ? null : setup.problem,
    project: setup.ok ? setup.setup.project : null,
    account: setup.ok ? setup.setup.email : null,
    phones: counts?.phones ?? 0,
    signed_in: counts?.signed_in ?? 0,
    auto: s.push,
    choices,
    recent,
  };
}
