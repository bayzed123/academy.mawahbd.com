import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useResource } from "../../src/api";
import { MyCourseCard } from "../../src/components/Cards";
import { usePrefs } from "../../src/prefs";
import { useSession } from "../../src/session";
import { RADIUS } from "../../src/theme";
import type { MyCourses } from "../../src/types";
import { Icon } from "../../src/ui/Icon";
import { Page, SectionTitle } from "../../src/ui/Page";
import { Press } from "../../src/ui/Press";
import { CardSkeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

type Tab = "mine" | "free";

/**
 * My classes, under two buttons: my courses, and the free classes I started (a class that costs nothing — one of the app's free classes, or a
 * free class of the website). No price and no word about buying here (Google Play), so the first button is simply "My courses".
 */
export default function Learning() {
  const { c, t, n } = usePrefs();
  const { status } = useSession();
  const router = useRouter();
  const mine = useResource<MyCourses>(status === "in" ? "/api/student/courses" : null);
  const [chosen, setChosen] = useState<Tab | null>(null);

  if (status !== "in") {
    return (
      <Page>
        <SectionTitle title={t("learning.title")} />
        <EmptyState icon="book" title={t("learning.loggedOut.title")} body={t("learning.loggedOut.body")} action={{ title: t("home.login.cta"), onPress: () => router.push("/login") }} />
      </Page>
    );
  }

  const courses = mine.data?.courses ?? [];
  const own = courses.filter((m) => !m.free);
  const free = courses.filter((m) => !!m.free);
  // with nothing chosen yet: my courses, unless every class is a free one
  const tab: Tab = chosen ?? (own.length === 0 && free.length > 0 ? "free" : "mine");
  const shown = tab === "free" ? free : own;

  return (
    <Page onRefresh={() => void mine.refresh()} refreshing={mine.refreshing}>
      <SectionTitle title={t("learning.title")} sub={t("learning.sub")} />
      {mine.loading ? (
        <View style={{ gap: 16 }}>
          <CardSkeleton />
          <CardSkeleton />
        </View>
      ) : mine.error && !mine.data ? (
        <ErrorState error={mine.error} onRetry={() => void mine.refresh()} />
      ) : courses.length === 0 ? (
        <EmptyState icon="book" title={t("learning.empty.title")} body={t("learning.empty.body")} action={{ title: t("learning.free.browse"), onPress: () => router.push("/free") }} />
      ) : (
        <>
          <View accessibilityRole="tablist" accessibilityLabel={t("learning.tabs")} style={{ flexDirection: "row", gap: 6, padding: 5, borderRadius: RADIUS.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            {(["mine", "free"] as const).map((x) => {
              const on = tab === x;
              const count = x === "free" ? free.length : own.length;
              return (
                <Press
                  key={x}
                  onPress={() => setChosen(x)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${t(x === "free" ? "learning.tab.free" : "learning.tab.mine")} (${n(count)})`}
                  scale={0.98}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 46, paddingHorizontal: 10, borderRadius: RADIUS.pill, backgroundColor: on ? c.accent : "transparent" }}
                >
                  <Icon name={x === "free" ? "gift" : "book"} size={17} color={on ? c.onAccent : c.text2} />
                  <Txt v="label" color={on ? c.onAccent : c.text2} numberOfLines={1}>
                    {t(x === "free" ? "learning.tab.free" : "learning.tab.mine")}
                  </Txt>
                  <View style={{ minWidth: 24, paddingHorizontal: 6, borderRadius: RADIUS.pill, backgroundColor: on ? "rgba(0,0,0,0.18)" : c.raised, alignItems: "center" }}>
                    <Txt v="label" color={on ? c.onAccent : c.text2} style={{ fontSize: 13, lineHeight: 20 }}>
                      {n(count)}
                    </Txt>
                  </View>
                </Press>
              );
            })}
          </View>
          {shown.length === 0 ? (
            tab === "free" ? (
              <EmptyState icon="gift" title={t("learning.free.empty.title")} body={t("learning.free.empty.body")} action={{ title: t("learning.free.browse"), onPress: () => router.push("/free") }} />
            ) : (
              <EmptyState icon="book" title={t("learning.mine.empty.title")} body={t("learning.mine.empty.body")} />
            )
          ) : (
            <View style={{ gap: 16 }}>
              {shown.map((m) => (
                <MyCourseCard key={m.course.id} item={m} wide onPress={() => router.push(`/course/${m.course.slug}`)} />
              ))}
            </View>
          )}
        </>
      )}
    </Page>
  );
}
