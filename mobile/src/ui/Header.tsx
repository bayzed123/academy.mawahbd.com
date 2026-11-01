import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrefs } from "../prefs";
import { Icon } from "./Icon";
import { Press } from "./Press";
import { Txt } from "./Txt";

/** The top of a screen opened from another one: a round back button and the title (Android's back gesture works too). */
export function Header({ title, right }: { title?: string; right?: ReactNode }) {
  const { c, t } = usePrefs();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.bg, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <Press
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        accessibilityRole="button"
        accessibilityLabel={t("common.back")}
        hitSlop={8}
        style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="chevronLeft" size={22} color={c.text} />
      </Press>
      <Txt v="heading" numberOfLines={1} style={{ flex: 1 }}>
        {title ?? ""}
      </Txt>
      {right}
    </View>
  );
}
