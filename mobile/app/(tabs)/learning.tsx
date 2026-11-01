import { useRouter } from "expo-router";
import { View } from "react-native";
import { useResource } from "../../src/api";
import { MyCourseCard } from "../../src/components/Cards";
import { usePrefs } from "../../src/prefs";
import { useSession } from "../../src/session";
import type { MyCourses } from "../../src/types";
import { Page, SectionTitle } from "../../src/ui/Page";
import { CardSkeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";

export default function Learning() {
  const { t } = usePrefs();
  const { status } = useSession();
  const router = useRouter();
  const mine = useResource<MyCourses>(status === "in" ? "/api/student/courses" : null);

  if (status !== "in") {
    return (
      <Page>
        <SectionTitle title={t("learning.title")} />
        <EmptyState icon="book" title={t("learning.loggedOut.title")} body={t("learning.loggedOut.body")} action={{ title: t("home.login.cta"), onPress: () => router.push("/login") }} />
      </Page>
    );
  }

  const courses = mine.data?.courses ?? [];
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
        <EmptyState icon="book" title={t("learning.empty.title")} body={t("learning.empty.body")} />
      ) : (
        <View style={{ gap: 16 }}>
          {courses.map((m) => (
            <MyCourseCard key={m.course.id} item={m} wide onPress={() => router.push(`/course/${m.course.slug}`)} />
          ))}
        </View>
      )}
    </Page>
  );
}
