import { useRouter } from "expo-router";
import { useMemo } from "react";
import { useWindowDimensions, View } from "react-native";
import { useResource } from "../../src/api";
import { DemoCard, FreeCard } from "../../src/components/Cards";
import { contentWidth, tileWidth } from "../../src/lib/layout";
import { usePrefs } from "../../src/prefs";
import type { CourseList } from "../../src/types";
import { Header } from "../../src/ui/Header";
import { Page, SectionTitle } from "../../src/ui/Page";
import { CardSkeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";

/**
 * "Free classes" (the button beside night / day on Home): everything that can be learned free in the app, in one place — the app's own free
 * classes (free from start to finish with an account) and the free demo of each class. No price anywhere (Google Play).
 */
export default function FreeClasses() {
  const { c, t } = usePrefs();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const free = useResource<CourseList>("/api/app/courses");
  const catalog = useResource<CourseList>("/api/courses?per_page=48");
  const demos = useMemo(() => (catalog.data?.courses ?? []).filter((x) => x.has_demo), [catalog.data]);
  const inner = contentWidth(width);
  const cols = inner >= 520 ? 3 : 2;
  const tile = tileWidth(inner, cols);
  const refresh = () => {
    void free.refresh();
    void catalog.refresh();
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={t("home.freeBtn")} />
      <Page under onRefresh={refresh} refreshing={free.refreshing || catalog.refreshing}>
        <View style={{ gap: 12 }}>
          <SectionTitle title={t("home.free.title")} sub={t("home.free.sub")} />
          {free.loading ? (
            <CardSkeleton />
          ) : free.error && !free.data ? (
            <ErrorState error={free.error} onRetry={() => void free.refresh()} />
          ) : (free.data?.courses ?? []).length === 0 ? (
            <EmptyState icon="gift" title={t("freeList.empty")} />
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {(free.data?.courses ?? []).map((x) => (
                <FreeCard key={x.id} course={x} width={tile} onPress={() => router.push(`/free/${x.slug}`)} />
              ))}
            </View>
          )}
        </View>

        {catalog.loading || demos.length ? (
          <View style={{ gap: 12 }}>
            <SectionTitle title={t("home.demo.title")} sub={t("home.demo.sub")} />
            {catalog.loading ? (
              <CardSkeleton />
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {demos.map((x) => (
                  <DemoCard key={x.id} course={x} width={tile} onPress={() => router.push(`/demo/${x.slug}`)} />
                ))}
              </View>
            )}
          </View>
        ) : null}
      </Page>
    </View>
  );
}
