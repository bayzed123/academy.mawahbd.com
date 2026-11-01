import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrefs } from "../prefs";
import { Txt } from "./Txt";

interface Props {
  children: ReactNode;
  /** pull down to refresh */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** the screen has its own header (a stack screen): no top inset here */
  under?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
}

/** A screen's scrolling body: the theme's background, room for the phone's status bar and the tab bar, and pull-to-refresh. */
export function Page({ children, onRefresh, refreshing = false, under, contentStyle, scroll = true }: Props) {
  const { c } = usePrefs();
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: under ? 8 : insets.top + 12, paddingBottom: 32, paddingHorizontal: 16, gap: 20 };
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: c.bg }, pad, contentStyle]}>{children}</View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[pad, contentStyle]}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} /> : undefined}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/** A section title with an optional "See all" on the right. */
export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <SectionText title={title} sub={sub} />
      </View>
      {right}
    </View>
  );
}

function SectionText({ title, sub }: { title: string; sub?: string }) {
  const { c } = usePrefs();
  return (
    <>
      <Txt v="title">{title}</Txt>
      {sub ? (
        <Txt v="small" color={c.text3}>
          {sub}
        </Txt>
      ) : null}
    </>
  );
}
