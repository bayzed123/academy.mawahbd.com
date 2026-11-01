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
import type { Completed, LessonAnswer } from "../../src/types";
import { Btn } from "../../src/ui/Btn";
import { Card } from "../../src/ui/Card";
import { Header } from "../../src/ui/Header";
import { Icon } from "../../src/ui/Icon";
import { Page, SectionTitle } from "../../src/ui/Page";
import { Press } from "../../src/ui/Press";
import { Skeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

/** A lesson: the video, "done", the notes, the downloads, and the next lesson. Screenshots and screen recording are blocked here. */
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
  const { c, t, lang } = usePrefs();
  const [done, setDone] = useState(lesson.completed);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  useEffect(() => {
    setDone(lesson.completed);
  }, [lesson.completed]);
  const body = loc(lesson, "body_html", lang);

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

  return (
    <>
      <VideoPlayer source={playerFor(lesson, API_URL)} />

      <View style={{ gap: 12 }}>
        <Txt v="title">{loc(lesson, "title", lang)}</Txt>
        <Press
          onPress={() => void toggle()}
          disabled={saving}
          haptic
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done, busy: saving }}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start", paddingHorizontal: 14, minHeight: 44, borderRadius: RADIUS.pill, backgroundColor: done ? c.okBg : c.raised, borderWidth: 1, borderColor: done ? c.ok : c.line2 }}
        >
          {saving ? <ActivityIndicator size="small" color={c.accent} /> : <Icon name="check" size={18} color={done ? c.ok : c.text3} />}
          <Txt v="label" color={done ? c.ok : c.text}>
            {done ? t("lesson.done") : t("lesson.markDone")}
          </Txt>
        </Press>
        {note ? (
          <Card style={{ flexDirection: "row", gap: 10, alignItems: "center", borderColor: c.ok }}>
            <Icon name="award" size={22} color={c.ok} />
            <Txt v="label" style={{ flex: 1 }}>
              {note}
            </Txt>
          </Card>
        ) : null}
      </View>

      {body ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t("lesson.notes")} />
          <Html html={body} />
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

      <View style={{ flexDirection: "row", gap: 12 }}>
        {lesson.prev_id ? <Btn kind="secondary" title={t("lesson.prev")} icon="chevronLeft" onPress={() => onGo(lesson.prev_id!)} style={{ flex: 1 }} /> : null}
        {lesson.next_id ? <Btn title={t("lesson.next")} iconRight="chevronRight" onPress={() => onGo(lesson.next_id!)} style={{ flex: 1 }} /> : null}
      </View>
    </>
  );
}
