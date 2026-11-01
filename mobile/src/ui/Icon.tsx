import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";
import { ICONS, type IconName } from "./iconData";

const PARTS = { path: Path, circle: Circle, rect: Rect, line: Line, polyline: Polyline } as const;
const camel = (k: string) => k.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());

export type { IconName };

/** The website's icons, drawn natively (sharp at any size, coloured by the theme). */
export function Icon({ name, size = 22, color, strokeWidth }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  const def = ICONS[name];
  const paint =
    def.mode === "fill"
      ? { fill: color }
      : { fill: "none", stroke: color, strokeWidth: strokeWidth ?? def.width, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${"vb" in def ? def.vb : 24} ${"vb" in def ? def.vb : 24}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {def.els.map(([tag, attrs], i) => {
        const Part = PARTS[tag] as React.ComponentType<Record<string, unknown>>;
        const props = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [camel(k), v]));
        return <Part key={i} {...props} {...paint} />;
      })}
    </Svg>
  );
}
