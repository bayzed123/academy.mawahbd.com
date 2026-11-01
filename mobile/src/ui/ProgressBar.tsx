import { View } from "react-native";
import { usePrefs } from "../prefs";

export function ProgressBar({ pct, height = 6 }: { pct: number; height?: number }) {
  const { c } = usePrefs();
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: p }}
      style={{ height, borderRadius: height, backgroundColor: c.raised, overflow: "hidden" }}
    >
      <View style={{ width: `${p}%`, height: "100%", borderRadius: height, backgroundColor: p >= 100 ? c.ok : c.accent }} />
    </View>
  );
}
