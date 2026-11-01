import { loc } from "@mawah/shared/format";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useResource } from "../../src/api";
import { CourseArt } from "../../src/components/Cards";
import { LessonList } from "../../src/components/LessonList";
import { Materials } from "../../src/components/Materials";
import { API_URL } from "../../src/config";
import { siteLinks } from "../../src/lib/links";
import { openPage } from "../../src/open";
import { usePrefs } from "../../src/prefs";
import { RADIUS } from "../../src/theme";
import type { Materials as MaterialsAnswer, StudentCourse } from "../../src/types";
import { Btn } from "../../src/ui/Btn";
import { Card } from "../../src/ui/Card";
import { Header } from "../../src/ui/Header";
import { Icon } from "../../src/ui/Icon";
import { Page, SectionTitle } from "../../src/ui/Page";
import { ProgressBar } from "../../src/ui/ProgressBar";
import { CardSkeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

/** One of my classes: how far I am, "Continue", the lessons, the materials and the certificate. */
export default function Course() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { c, t, lang } = usePrefs();
  const router = useRouter();
  const view = useResource<StudentCourse>(`/api/student/courses/${encodeURIComponent(slug)}`);
  const mats = useResource<MaterialsAnswer>(`/api/student/courses/${encodeURIComponent(slug)}/materials`);
  const data = view.data;
  const lessons = data ? data.curriculum.flatMap((m) => m.lessons) : [];
  const now = Date.now();
  const open = (l: (typeof lessons)[number]) => !l.available_at || Date.parse(l.available_at) <= now;
  const next = lessons.find((l) => !l.completed && open(l)) ?? lessons.find(open);
  const started = lessons.some((l) => l.completed);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={data ? loc(data.course, "title", lang) : ""} />
      <Page
        under
        onRefresh={() => {
          void view.refresh();
          void mats.refresh();
        }}
        refreshing={view.refreshing}
      >
        {view.loading ? (
          <CardSkeleton />
        ) : view.error && !data ? (
          view.error.status === 403 ? <EmptyState icon="lock" title={t("course.notEnrolled")} /> : <ErrorState error={view.error} onRetry={() => void view.refresh()} />
        ) : data ? (
          <>
            <View style={{ borderRadius: RADIUS.l, overflow: "hidden", borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
              <CourseArt course={data.course} height={190} />
              <View style={{ padding: 16, gap: 10 }}>
                <Txt v="title">{loc(data.course, "title", lang)}</Txt>
                <ProgressBar pct={data.progress.pct} />
                <Txt v="small" color={c.text3}>
                  {data.progress.pct >= 100 ? t("learning.finished") : t("learning.progress", { done: data.progress.done, total: data.progress.total })}
                </Txt>
                {next ? <Btn title={started ? t("course.resume") : t("course.start")} icon="play" onPress={() => router.push(`/lesson/${next.id}`)} /> : null}
              </View>
            </View>

            {data.certificate && !data.certificate.revoked_at ? (
              <Card style={{ flexDirection: "row", alignItems: "center", gap: 14, borderColor: c.ok }}>
                <Icon name="award" size={28} color={c.ok} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Txt v="heading">{t("lesson.certEarned")}</Txt>
                  <Btn small kind="secondary" title={t("course.certificate.get")} icon="external" onPress={() => void openPage(siteLinks(API_URL, lang).certificate(data.certificate!.code), c.surface)} />
                </View>
              </Card>
            ) : (
              <Txt v="small" color={c.text3}>
                {t("course.certificate.hint")}
              </Txt>
            )}

            <View style={{ gap: 12 }}>
              <SectionTitle title={t("course.curriculum")} sub={lessons.length ? t("course.lessons", { n: lessons.length }) : undefined} />
              {lessons.length ? <LessonList modules={data.curriculum} onOpen={(id) => router.push(`/lesson/${id}`)} /> : <EmptyState icon="clock" title={t("course.noLessons")} />}
            </View>

            {mats.data?.materials.length ? (
              <View style={{ gap: 12 }}>
                <SectionTitle title={t("course.materials")} />
                <Materials items={mats.data.materials} />
              </View>
            ) : null}
          </>
        ) : null}
      </Page>
    </View>
  );
}
