import { Text, type TextProps, type TextStyle } from "react-native";
import { usePrefs } from "../prefs";
import { TYPE, type TextVariant } from "../theme";

interface Props extends TextProps {
  v?: TextVariant;
  color?: string;
  center?: boolean;
  style?: TextStyle | TextStyle[];
}

/** All text in the app: the brand font, sizes that leave room for Bangla vowel signs, and the theme's colours. */
export function Txt({ v = "body", color, center, style, ...rest }: Props) {
  const { c } = usePrefs();
  return <Text maxFontSizeMultiplier={1.35} {...rest} style={[TYPE[v], { color: color ?? c.text }, center ? { textAlign: "center" } : null, style]} />;
}
