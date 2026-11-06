import { loc } from "@mawah/shared/format";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { api, ApiError, clearCache, useResource } from "../../src/api";
import { CourseArt } from "../../src/components/Cards";
import { LessonList } from "../../src/components/LessonList";
import { plainText } from "../../src/lib/text";
import { usePrefs } from "../../src/prefs";
import { useSession } from "../../src/session";
import { errorKey } from "../../src/strings";
import { RADIUS } from "../../src/theme";
import type { FreeClass } from "../../src/types";
import { Btn } from "../../src/ui/Btn";
import { Card } from "../../src/ui/Card";
import { Header } from "../../src/ui/Header";
import { Icon } from "../../src/ui/Icon";
import { Page, SectionTitle } from "../../src/ui/Page";
import { Skeleton } from "../../src/ui/Skeleton";
import { ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

/**
 * One of the app's free classes (Admin → Android app). Free for everyone with an account: "Start for free" makes it the student's at once
 * (nothing is bought — there is no price, no payment and no link to one), then it is studied like any other class. Signed out, the same
 * button opens the free sign-up; a student signs in and comes back here.
 */
export default function FreeClassScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { c, t, lang } = usePrefs();
  const { status } = useSession();
  const router = useRouter();
  const res = useResource<FreeClass>(`/api/app/courses/${encodeURIComponent(slug)}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = res.data;

  // signing in (or making the account) from here comes back to this screen: ask again whether the class is the student's already
  const seen = useRef(status);
  useEffect(() => {
    if (seen.current !== status) {
      seen.current = status;
      void res.refresh();
    }
  }, [status, res]);

  const open = () => router.push(`/course/${encodeURIComponent(slug)}`);
  const start = async (lessonId?: number) => {
    if (status !== "in") {
      router.push("/signup");
      return;
    }
    if (data?.joined) {
      if (lessonId) router.push(`/lesson/${lessonId}`);
      else open();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/app/courses/${encodeURIComponent(slug)}/join`, { method: "POST", body: {} });
      // "My classes" and Home show it from now on
      clearCache();
      await res.refresh();
      if (lessonId) router.push(`/lesson/${lessonId}`);
      else open();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "server";
      setError(code === "network" ? t("err.network") : t(errorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  const about = data ? plainText(loc(data.course, "long", lang) || loc(data.course, "short", lang)) : "";
  const teacher = data?.course.instructor ? loc(data.course.instructor, "name", lang) : "";

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={t("free.title")} />
      <Page under onRefresh={() => void res.refresh()} refreshing={res.refreshing}>
        {res.loading ? (
          <View style={{ gap: 14 }}>
            <Skeleton h={200} r={20} />
            <Skeleton w="70%" h={22} />
            <Skeleton h={52} r={14} />
          </View>
        ) : res.error && !data ? (
          <ErrorState error={res.error} onRetry={() => void res.refresh()} />
        ) : data ? (
          <>
            <View style={{ borderRadius: RADIUS.l, overflow: "hidden" }}>
              <CourseArt course={data.course} height={200} />
            </View>

            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.okBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill }}>
                  <Icon name="gift" size={13} color={c.ok} />
                  <Txt v="tiny" color={c.ok}>
                    {t("free.badge")}
                  </Txt>
                </View>
                {data.course.lesson_count ? (
                  <Txt v="small" color={c.text3}>
                    {t("course.lessons", { n: data.course.lesson_count })}
                  </Txt>
                ) : null}
              </View>
              <Txt v="title">{loc(data.course, "title", lang)}</Txt>
              {teacher ? (
                <Txt v="small" color={c.text2}>
                  {t("free.by", { name: teacher })}
                </Txt>
              ) : null}
              {loc(data.course, "short", lang) ? (
                <Txt v="body" color={c.text2}>
                  {loc(data.course, "short", lang)}
                </Txt>
              ) : null}
            </View>

            {data.revoked ? (
              <View accessibilityLiveRegion="polite" style={{ backgroundColor: c.badBg, borderRadius: RADIUS.m, padding: 12, borderWidth: 1, borderColor: c.bad }}>
                <Txt v="small" color={c.bad}>
                  {t("err.enrollment_revoked")}
                </Txt>
              </View>
            ) : data.joined ? (
              <Card style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Icon name="check" size={20} color={c.ok} />
                  <Txt v="body" style={{ flex: 1 }}>
                    {t("free.joined")}
                  </Txt>
                </View>
                <Btn title={t("free.open")} icon="play" onPress={open} />
              </Card>
            ) : (
              <View style={{ gap: 10 }}>
                {error ? (
                  <View accessibilityLiveRegion="polite" style={{ backgroundColor: c.badBg, borderRadius: RADIUS.m, padding: 12, borderWidth: 1, borderColor: c.bad }}>
                    <Txt v="small" color={c.bad}>
                      {error}
                    </Txt>
                  </View>
                ) : null}
                <Btn title={t("free.start")} icon="play" onPress={() => void start()} loading={busy} />
                {status === "in" ? (
                  <Txt v="small" color={c.text3} center>
                    {t("free.forAll")}
                  </Txt>
                ) : (
                  <>
                    <Txt v="small" color={c.text3} center>
                      {t("free.loginFirst")}
                    </Txt>
                    <Btn kind="secondary" title={t("profile.login")} onPress={() => router.push("/login")} />
                  </>
                )}
              </View>
            )}

            {about ? (
              <View style={{ gap: 8 }}>
                <SectionTitle title={t("free.about")} />
                <Txt v="body" color={c.text2}>
                  {about}
                </Txt>
              </View>
            ) : null}

            {data.curriculum.some((m) => m.lessons.length) ? (
              <View style={{ gap: 12 }}>
                <SectionTitle title={t("free.lessons")} />
                {/* before "Start for free" only the free previews open, and opening one starts the class; after, every lesson opens */}
                <LessonList modules={data.curriculum} previewOnly={!data.joined} onOpen={(id) => void start(id)} />
              </View>
            ) : (
              <Txt v="small" color={c.text3}>
                {t("course.noLessons")}
              </Txt>
            )}
          </>
        ) : null}
      </Page>
    </View>
  );
}
