import { formatMoney, loc } from "@mawah/shared/format";
import { percentOff, type ShopCardDTO } from "@mawah/shared/shop";
import type { CourseCardDTO, MyCourseDTO } from "@mawah/shared/types";
import { Image } from "expo-image";
import { View } from "react-native";
import { API_URL } from "../config";
import { siteLinks } from "../lib/links";
import { usePrefs } from "../prefs";
import { RADIUS } from "../theme";
import { Icon, type IconName } from "../ui/Icon";
import { ICONS } from "../ui/iconData";
import { Press } from "../ui/Press";
import { ProgressBar } from "../ui/ProgressBar";
import { Txt } from "../ui/Txt";

/** The website's illustration for a class's kind (cake, pastry …), or a cake when it names none. */
function artFor(course: Pick<CourseCardDTO, "icon" | "category">): IconName {
  const name = `art-${course.icon ?? course.category?.icon ?? "cake"}`;
  return (name in ICONS ? name : "art-cake") as IconName;
}

/** A class's picture, or (when it has none) its illustration in a thin frame on a flat panel, as on the website — never an empty box. */
export function CourseArt({ course, height }: { course: Pick<CourseCardDTO, "banner_key" | "icon" | "category">; height: number }) {
  const { c, lang } = usePrefs();
  if (course.banner_key) {
    return (
      <Image
        source={{ uri: siteLinks(API_URL, lang).media(course.banner_key) }}
        style={{ width: "100%", height, backgroundColor: c.raised }}
        contentFit="cover"
        transition={180}
        cachePolicy="memory-disk"
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={{ height, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
      <View pointerEvents="none" style={{ position: "absolute", top: 10, left: 10, right: 10, bottom: 10, borderRadius: RADIUS.m, borderWidth: 1, borderColor: c.line2 }} />
      <Icon name={artFor(course)} size={Math.min(76, height * 0.46)} color={c.accent} />
    </View>
  );
}

function Chip({ label, tone = "accent" }: { label: string; tone?: "accent" | "ok" }) {
  const { c } = usePrefs();
  return (
    <View style={{ alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 2, borderRadius: RADIUS.pill, backgroundColor: tone === "ok" ? c.okBg : c.raised, borderWidth: 1, borderColor: tone === "ok" ? c.ok : c.line2 }}>
      <Txt v="tiny" color={tone === "ok" ? c.ok : c.accent}>
        {label}
      </Txt>
    </View>
  );
}

/** One of my classes: picture, name and how far along I am. */
export function MyCourseCard({ item, onPress, wide }: { item: MyCourseDTO; onPress: () => void; wide?: boolean }) {
  const { c, t, lang } = usePrefs();
  const done = item.progress.pct >= 100;
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={loc(item.course, "title", lang)} style={{ width: wide ? "100%" : 260, backgroundColor: c.surface, borderRadius: RADIUS.l, borderWidth: 1, borderColor: c.line, overflow: "hidden" }}>
      <CourseArt course={item.course} height={wide ? 170 : 140} />
      <View style={{ padding: 14, gap: 8 }}>
        <Txt v="heading" numberOfLines={2}>
          {loc(item.course, "title", lang)}
        </Txt>
        <ProgressBar pct={item.progress.pct} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Txt v="small" color={c.text3}>
            {done ? t("learning.finished") : t("learning.progress", { done: item.progress.done, total: item.progress.total })}
          </Txt>
          {item.certificate_code ? <Chip tone="ok" label={t("learning.certificate")} /> : null}
        </View>
      </View>
    </Press>
  );
}

/** A class with a free demo (no price: classes are not sold in the app). */
export function DemoCard({ course, onPress }: { course: CourseCardDTO; onPress: () => void }) {
  const { c, t, lang } = usePrefs();
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={loc(course, "title", lang)} style={{ width: 230, backgroundColor: c.surface, borderRadius: RADIUS.l, borderWidth: 1, borderColor: c.line, overflow: "hidden" }}>
      <View>
        <CourseArt course={course} height={130} />
        <View style={{ position: "absolute", left: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.accent, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill }}>
          <Icon name="play" size={12} color={c.onAccent} />
          <Txt v="tiny" color={c.onAccent}>
            {t("demo.free")}
          </Txt>
        </View>
      </View>
      <View style={{ padding: 12, gap: 4 }}>
        <Txt v="label" numberOfLines={2}>
          {loc(course, "title", lang)}
        </Txt>
        {course.lesson_count ? (
          <Txt v="small" color={c.text3}>
            {t("course.lessons", { n: course.lesson_count })}
          </Txt>
        ) : null}
      </View>
    </Press>
  );
}

/** A product of the equipment shop (physical goods: price shown, ordered on the website). */
export function ProductCard({ p, onPress, width }: { p: ShopCardDTO; onPress: () => void; width: number }) {
  const { c, t, lang, n } = usePrefs();
  const off = percentOff(p.price, p.list_price);
  const price = formatMoney(p.price, lang);
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={`${loc(p, "name", lang)}, ${price}`} style={{ width, backgroundColor: c.surface, borderRadius: RADIUS.l, borderWidth: 1, borderColor: c.line, overflow: "hidden" }}>
      <View style={{ aspectRatio: 1, backgroundColor: c.raised }}>
        {p.image ? <Image source={{ uri: `${API_URL}${p.image}` }} style={{ flex: 1 }} contentFit="cover" transition={180} cachePolicy="memory-disk" /> : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Icon name="shop" size={30} color={c.text3} /></View>}
        {off ? (
          <View style={{ position: "absolute", top: 8, left: 8, backgroundColor: c.accent, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 1 }}>
            <Txt v="tiny" color={c.onAccent}>
              -{n(off)}%
            </Txt>
          </View>
        ) : null}
      </View>
      <View style={{ padding: 10, gap: 2 }}>
        <Txt v="label" numberOfLines={2} style={{ minHeight: 42 }}>
          {loc(p, "name", lang)}
        </Txt>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <Txt v="label" color={c.accent}>
            {p.several ? t("shop.from", { price }) : price}
          </Txt>
          {off ? (
            <Txt v="tiny" color={c.text3} style={{ textDecorationLine: "line-through" }}>
              {formatMoney(p.list_price, lang)}
            </Txt>
          ) : null}
        </View>
        {!p.in_stock ? (
          <Txt v="tiny" color={c.bad}>
            {t("shop.outOfStock")}
          </Txt>
        ) : null}
      </View>
    </Press>
  );
}
