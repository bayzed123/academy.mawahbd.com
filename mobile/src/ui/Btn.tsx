import { ActivityIndicator, View, type StyleProp, type ViewStyle } from "react-native";
import { usePrefs } from "../prefs";
import { RADIUS } from "../theme";
import { Icon, type IconName } from "./Icon";
import { Press } from "./Press";
import { Txt } from "./Txt";

interface Props {
  title: string;
  onPress?: () => void;
  kind?: "primary" | "secondary" | "ghost";
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/** One solid orange (red by day) for the main action, a flat grey one for the rest — like the website's buttons. */
export function Btn({ title, onPress, kind = "primary", icon, iconRight, loading, disabled, small, style, accessibilityHint }: Props) {
  const { c } = usePrefs();
  const bg = kind === "primary" ? c.accent : kind === "secondary" ? c.raised : "transparent";
  const fg = kind === "primary" ? c.onAccent : kind === "secondary" ? c.text : c.link;
  return (
    <Press
      onPress={onPress}
      disabled={disabled || loading}
      haptic={kind === "primary"}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={[
        {
          minHeight: small ? 40 : 50,
          paddingHorizontal: small ? 14 : 20,
          borderRadius: RADIUS.m,
          backgroundColor: bg,
          borderWidth: kind === "secondary" ? 1 : 0,
          borderColor: c.line2,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={small ? 17 : 19} color={fg} /> : null}
        <Txt v="label" color={fg} style={{ fontSize: small ? 13.5 : 15 }}>
          {title}
        </Txt>
        {iconRight && !loading ? <Icon name={iconRight} size={small ? 16 : 18} color={fg} /> : null}
      </View>
    </Press>
  );
}
