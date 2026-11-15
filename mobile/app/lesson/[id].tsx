import { loc } from "@mawah/shared/format";
import type { LessonContentDTO } from "@mawah/shared/types";
import * as ScreenCapture from "expo-screen-capture";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { api, ApiError, useResource } from "../../src/api";
import { Html } from "../../src/components/Html";
import { VideoPlayer } from "../../src/components/VideoPlayer";
import { API_URL } from "../../src/config";
import { downloadAndOpen } from "../../src/download";
import { playerFor } from "../../src/lib/video";
import { usePrefs } from "../../src/prefs";
import { errorKey } from "../../src/strings";
import { RADIUS } from "../../src/theme";
import { LessonRail, railLessons } from "../../src/components/LessonRail";
import type { Completed, LessonAnswer, MyCourses, StudentCourse } from "../../src/types";
import { Btn } from "../../src/ui/Btn";
import { Card } from "../../src/ui/Card";
import { Header } from "../../src/ui/Header";
import { Icon } from "../../src/ui/Icon";
import { Page, SectionTitle } from "../../src/ui/Page";
import { Press } from "../../src/ui/Press";
import { Skeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

/**
 * A lesson, laid out like a video app: the video, its part and title, "done" and the way on (previous · next part), then every lesson of the
 * class in one sideways row, then the notes folded to a few lines, and the downloads. Screenshots and screen recording are blocked here.
 */
export default function Lesson() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, t, lang } = usePrefs();
  const router = useRouter();
  // the class's videos and notes are for enrolled students only: Android blacks out screenshots and screen recordings while a lesson is open
  // (a key of its own per lesson: going to the next lesson must not let the old screen's clean-up switch the protection off)
  useEffect(() => {
    if (Platform.OS === "web") return;
    const key = `lesson-${id}`;
    void ScreenCapture.preventScreenCaptureAsync(key).catch(() => undefined);
    return () => void ScreenCapture.allowScreenCaptureAsync(key).catch(() => undefined);
  }, [id]);
  const res = useResource<LessonAnswer>(`/api/student/lessons/${encodeURIComponent(id)}`);
  const lesson = res.data?.lesson;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={lesson ? loc(lesson, "title", lang) : ""} />
      <Page under onRefresh={() => void res.refresh()} refreshing={res.refreshing}>
        {res.loading ? (
          <View style={{ gap: 14 }}>
            <Skeleton h={200} r={20} />
            <Skeleton w="70%" h={22} />
            <Skeleton h={14} />
            <Skeleton w="90%" h={14} />
          </View>
        ) : res.error && !lesson ? (
          res.error.status === 403 ? <EmptyState icon="lock" title={t(errorKey(res.error.code))} /> : <ErrorState error={res.error} onRetry={() => void res.refresh()} />
        ) : lesson ? (
          <LessonBody key={lesson.id} lesson={lesson} onGo={(to) => router.replace(`/lesson/${to}`)} />
        ) : null}
      </Page>
    </View>
  );
}

function LessonBody({ lesson, onGo }: { lesson: LessonContentDTO; onGo: (id: number) => void }) {
  const { c, t, lang, n } = usePrefs();
  const [done, setDone] = useState(lesson.completed);
  const [saving, setSaving] = useState(false);
  const [going, setGoing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [notesHeight, setNotesHeight] = useState(0);
  useEffect(() => {
    setDone(lesson.completed);
  }, [lesson.completed]);
  const body = loc(lesson, "body_html", lang);

  // the class's lessons for the row under the video: the class is found among my classes (kept from Home, so usually at once)
  const mine = useResource<MyCourses>("/api/student/courses");
  const slug = mine.data?.courses.find((m) => m.course.id === lesson.course_id)?.course.slug ?? null;
  const view = useResource<StudentCourse>(slug ? `/api/student/courses/${encodeURIComponent(slug)}` : null);
  const lessons = view.data ? railLessons(view.data.curriculum).map((l) => (l.id === lesson.id ? { ...l, completed: done } : l)) : [];
  const at = lessons.findIndex((l) => l.id === lesson.id);
  const next = lesson.next_id ? lessons.find((l) => l.id === lesson.next_id) : undefined;
  const moduleName = at >= 0 ? loc({ title_bn: lessons[at]!.module_bn, title_en: lessons[at]!.module_en }, "title", lang) : "";

  const toggle = async () => {
    setSaving(true);
    setNote(null);
    try {
      const res = await api<Completed>(`/api/student/lessons/${lesson.id}/complete`, { method: done ? "DELETE" : "POST" });
      setDone(!done);
      if (!done && res.certificate) setNote(t("lesson.certEarned"));
      else if (!done && res.progress.pct >= 100) setNote(t("lesson.allDone"));
    } catch (err) {
      setNote(t(err instanceof ApiError && err.code === "network" ? "err.network" : "err.server"));
    } finally {
      setSaving(false);
    }
  };

  // "next part" also counts this lesson as done, so progress follows the student without extra taps (as on the website)
  const goNext = async () => {
    if (!lesson.next_id) return;
    if (!done) {
      setGoing(true);
      await api<Completed>(`/api/student/lessons/${lesson.id}/complete`, { method: "POST" }).catch(() => undefined);
      setGoing(false);
    }
    onGo(lesson.next_id);
  };

  const FOLD = 150;
  const long = notesHeight > FOLD + 24;

  return (
    <>
      <VideoPlayer source={playerFor(lesson, API_URL)} />

      <View style={{ gap: 10 }}>
        {at >= 0 ? (
          <Txt v="tiny" color={c.accent} numberOfLines={1}>
            {t("lesson.part", { n: n(at + 1), total: n(lessons.length) })}
            {moduleName ? ` · ${moduleName}` : ""}
          </Txt>
        ) : null}
        <Txt v="title">{loc(lesson, "title", lang)}</Txt>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Press
            onPress={() => void toggle()}
            disabled={saving}
            haptic
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done, busy: saving }}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 44, borderRadius: RADIUS.pill, backgroundColor: done ? c.okBg : c.raised, borderWidth: 1, borderColor: done ? c.ok : c.line2 }}
          >
            {saving ? <ActivityIndicator size="small" color={c.accent} /> : <Icon name="check" size={18} color={done ? c.ok : c.text3} />}
            <Txt v="label" color={done ? c.ok : c.text}>
              {done ? t("lesson.done") : t("lesson.markDone")}
            </Txt>
          </Press>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {lesson.prev_id ? <Btn kind="secondary" title={t("lesson.prevPart")} icon="chevronLeft" onPress={() => onGo(lesson.prev_id!)} style={{ flex: 1 }} /> : null}
          {lesson.next_id ? (
            <Btn title={t("lesson.nextPart")} iconRight="chevronRight" loading={going} onPress={() => void goNext()} style={{ flex: lesson.prev_id ? 1.4 : 1 }} />
          ) : (
            <View style={{ flex: 1, minHeight: 50, borderRadius: RADIUS.m, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center" }}>
              <Txt v="label" color={c.text3}>
                {t("lesson.lastPart")}
              </Txt>
            </View>
          )}
        </View>
        {next ? (
          <Txt v="small" color={c.text3} numberOfLines={1}>
            {t("lesson.nextPart")}: {loc(next, "title", lang)}
          </Txt>
        ) : null}
        {note ? (
          <Card style={{ flexDirection: "row", gap: 10, alignItems: "center", borderColor: c.ok }}>
            <Icon name="award" size={22} color={c.ok} />
            <Txt v="label" style={{ flex: 1 }}>
              {note}
            </Txt>
          </Card>
        ) : null}
      </View>

      {lessons.length > 1 ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t("lesson.rail")} sub={at >= 0 ? t("lesson.part", { n: n(at + 1), total: n(lessons.length) }) : undefined} />
          <LessonRail lessons={lessons} currentId={lesson.id} onOpen={onGo} />
        </View>
      ) : null}

      {body ? (
        <View style={{ gap: 6, padding: 14, borderRadius: RADIUS.l, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          <Txt v="heading">{t("lesson.notes")}</Txt>
          <View style={{ maxHeight: open || !long ? undefined : FOLD, overflow: "hidden" }}>
            <Html html={body} onHeight={setNotesHeight} />
          </View>
          {long ? (
            <Press onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 40 }}>
              <Txt v="label" color={c.link}>
                {open ? t("lesson.less") : t("lesson.more")}
              </Txt>
              <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
                <Icon name="chevronDown" size={18} color={c.link} />
              </View>
            </Press>
          ) : null}
        </View>
      ) : null}

      {lesson.resources.length ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t("lesson.resources")} />
          <Card pad={false}>
            {lesson.resources.map((r, i) => (
              <Press
                key={r.id}
                onPress={async () => {
                  setDownloading(r.id);
                  try {
                    await downloadAndOpen(`/api/student/resources/${r.id}/download`, r.filename);
                  } catch {
                    setNote(t("mat.failed"));
                  } finally {
                    setDownloading(null);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`${t("mat.download")}: ${loc(r, "title", lang) || r.filename}`}
                scale={0.99}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}
              >
                <Icon name="file" size={20} color={c.accent} />
                <Txt v="label" style={{ flex: 1 }} numberOfLines={2}>
                  {loc(r, "title", lang) || r.filename}
                </Txt>
                {downloading === r.id ? <ActivityIndicator color={c.accent} /> : <Icon name="download" size={20} color={c.text2} />}
              </Press>
            ))}
          </Card>
        </View>
      ) : null}
    </>
  );
}
