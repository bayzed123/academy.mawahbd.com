import { useEffect, useRef } from "react";
import { Animated, Platform, View, type DimensionValue } from "react-native";
import { usePrefs } from "../prefs";

/** Grey shapes that softly pulse where content is coming (nicer to wait on than a spinner). */
export function Skeleton({ w = "100%", h = 16, r = 8 }: { w?: DimensionValue; h?: DimensionValue; r?: number }) {
  const { c } = usePrefs();
  const o = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(o, { toValue: 0.55, duration: 700, useNativeDriver: Platform.OS !== "web" }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={{ width: w, height: h, borderRadius: r, backgroundColor: c.skeleton, opacity: o }} />;
}

export function CardSkeleton({ image = true }: { image?: boolean }) {
  const { c } = usePrefs();
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.line, overflow: "hidden" }}>
      {image ? <Skeleton h={150} r={0} /> : null}
      <View style={{ padding: 16, gap: 10 }}>
        <Skeleton w="80%" h={18} />
        <Skeleton w="50%" h={14} />
      </View>
    </View>
  );
}
