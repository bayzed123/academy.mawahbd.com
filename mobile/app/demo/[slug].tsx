import { loc } from "@mawah/shared/format";
import type { LessonContentDTO } from "@mawah/shared/types";
import { externalEmbed } from "@mawah/shared/videoEmbed";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api, useResource } from "../../src/api";
import { LessonList } from "../../src/components/LessonList";
import { VideoPlayer } from "../../src/components/VideoPlayer";
import { API_URL } from "../../src/config";
import { playerFor, type PlayerSource } from "../../src/lib/video";
import { usePrefs } from "../../src/prefs";
import type { PublicCourse } from "../../src/types";
import { Header } from "../../src/ui/Header";
import { Page, SectionTitle } from "../../src/ui/Page";
import { Skeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

/**
 * A class's free demo: the demo video the owner chose (Admin → Classes → Demo class), or its free preview lessons. Anyone may watch.
 * There is no price and no way to buy here (Google Play: classes are not sold in the app).
 */
export default function Demo() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { c, t, lang } = usePrefs();
  const res = useResource<PublicCourse>(`/api/courses/${encodeURIComponent(slug)}`);
  const data = res.data;
  const previews = data ? data.curriculum.flatMap((m) => m.lessons).filter((l) => l.is_preview) : [];
  const demoEmbed = data?.course.demo_url ? externalEmbed(data.course.demo_url) : null;
  const [lessonId, setLessonId] = useState<number | null>(null);
  const [preview, setPreview] = useState<LessonContentDTO | null>(null);

  useEffect(() => {
    if (!demoEmbed && previews.length && lessonId === null) setLessonId(previews[0].id);
  }, [demoEmbed, previews, lessonId]);

  useEffect(() => {
    if (lessonId === null) return;
    let live = true;
    api<{ lesson: LessonContentDTO }>(`/api/preview/lessons/${lessonId}`)
      .then((r) => live && setPreview(r.lesson))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [lessonId]);

  const source: PlayerSource | null = demoEmbed && lessonId === null ? { kind: "web", uri: demoEmbed } : preview ? playerFor(preview, API_URL) : null;
  const about = data ? loc(data.course, "short", lang) : "";

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={t("demo.title")} />
      <Page under onRefresh={() => void res.refresh()} refreshing={res.refreshing}>
        {res.loading ? (
          <View style={{ gap: 14 }}>
            <Skeleton h={200} r={20} />
            <Skeleton w="70%" h={22} />
          </View>
        ) : res.error && !data ? (
          <ErrorState error={res.error} onRetry={() => void res.refresh()} />
        ) : data ? (
          <>
            {source ? <VideoPlayer source={source} /> : !demoEmbed && !previews.length ? <EmptyState icon="video" title={t("demo.none")} /> : <Skeleton h={200} r={20} />}
            <View style={{ gap: 8 }}>
              <Txt v="title">{loc(data.course, "title", lang)}</Txt>
              {data.course.demo_url && lessonId === null ? (
                <Txt v="label" color={c.accent}>
                  {loc(data.course, "demo_title", lang) || t("demo.title")}
                </Txt>
              ) : null}
              {about ? (
                <Txt v="body" color={c.text2}>
                  {about}
                </Txt>
              ) : null}
            </View>
            {data.curriculum.some((m) => m.lessons.length) ? (
              <View style={{ gap: 12 }}>
                <SectionTitle title={t("demo.lessons")} />
                <LessonList modules={data.curriculum} previewOnly currentId={lessonId ?? undefined} onOpen={(id) => setLessonId(id)} />
              </View>
            ) : null}
          </>
        ) : null}
      </Page>
    </View>
  );
}
