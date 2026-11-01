import * as Haptics from "expo-haptics";
import { useRef, type ReactNode } from "react";
import { Animated, Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

interface Props extends Omit<PressableProps, "style" | "children"> {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** a light tap felt in the hand (main actions only) */
  haptic?: boolean;
  /** how far it sinks when pressed (0.97 = 3%) */
  scale?: number;
}

/** Where a thing sits among its neighbours (flex, width, margins …) — set on the outer touch area, so "flex: 1" shares a row evenly. */
const LAYOUT = new Set([
  "flex", "flexGrow", "flexShrink", "flexBasis", "alignSelf", "width", "minWidth", "maxWidth",
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight", "marginHorizontal", "marginVertical", "marginStart", "marginEnd",
  "position", "top", "left", "right", "bottom", "zIndex",
]);

/** Anything tappable: it sinks a little under the finger (on the native thread, so it stays smooth while the app is busy). */
export function Press({ style, children, haptic, scale = 0.97, onPressIn, onPressOut, onPress, disabled, ...rest }: Props) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (value: number) => Animated.spring(s, { toValue: value, useNativeDriver: Platform.OS !== "web", speed: 40, bounciness: 0 }).start();
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (LAYOUT.has(k) ? outer : inner)[k] = v;
  if ("flex" in outer || "width" in outer || "flexGrow" in outer) inner.flexGrow = 1;
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={outer as ViewStyle}
      onPressIn={(e) => {
        to(scale);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic && Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
    >
      <Animated.View style={[inner as ViewStyle, { transform: [{ scale: s }] }, disabled ? { opacity: 0.55 } : null]}>{children}</Animated.View>
    </Pressable>
  );
}
