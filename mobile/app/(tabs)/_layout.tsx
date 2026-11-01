import { Tabs } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrefs } from "../../src/prefs";
import { FONT, RADIUS } from "../../src/theme";
import { Icon, type IconName } from "../../src/ui/Icon";

/** Four tabs at the bottom, like any Android app; the selected one sits on a soft pill (Material 3). */
export default function TabsLayout() {
  const { c, t } = usePrefs();
  const insets = useSafeAreaInsets();
  const icon =
    (name: IconName) =>
    ({ color, focused }: { color: unknown; focused: boolean }) => (
      <View style={{ width: 56, height: 30, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", backgroundColor: focused ? c.accentSoft : "transparent" }}>
        <Icon name={name} size={22} color={String(color)} />
      </View>
    );
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.text3,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, borderTopWidth: 1, elevation: 0, height: 76 + insets.bottom, paddingTop: 8, paddingBottom: 10 + insets.bottom },
        tabBarLabelStyle: { fontFamily: FONT.semibold, fontSize: 11.5, lineHeight: 18, marginTop: 4 },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tab.home"), tabBarIcon: icon("home") }} />
      <Tabs.Screen name="learning" options={{ title: t("tab.learning"), tabBarIcon: icon("book") }} />
      <Tabs.Screen name="shop" options={{ title: t("tab.shop"), tabBarIcon: icon("shop") }} />
      <Tabs.Screen name="profile" options={{ title: t("tab.profile"), tabBarIcon: icon("user") }} />
    </Tabs>
  );
}
