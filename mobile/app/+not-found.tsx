import { useRouter } from "expo-router";
import { usePrefs } from "../src/prefs";
import { Page } from "../src/ui/Page";
import { EmptyState } from "../src/ui/States";

export default function NotFound() {
  const { t } = usePrefs();
  const router = useRouter();
  return (
    <Page>
      <EmptyState icon="help" title={t("err.not_found")} action={{ title: t("tab.home"), onPress: () => router.replace("/") }} />
    </Page>
  );
}
