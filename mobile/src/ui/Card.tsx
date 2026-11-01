import { View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { usePrefs } from "../prefs";
import { RADIUS } from "../theme";

/** A flat panel set off from the page by a thin see-through edge (the website's cards). */
export function Card({ style, pad = true, ...rest }: ViewProps & { style?: StyleProp<ViewStyle>; pad?: boolean }) {
  const { c } = usePrefs();
  return <View {...rest} style={[{ backgroundColor: c.surface, borderRadius: RADIUS.l, borderWidth: 1, borderColor: c.line, overflow: "hidden" }, pad ? { padding: 16 } : null, style]} />;
}
