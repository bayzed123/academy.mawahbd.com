import { formatDate, formatDuration, loc } from "@mawah/shared/format";
import type { LessonType } from "@mawah/shared/constants";
import type { CurriculumModuleDTO } from "@mawah/shared/types";
import { useEffect, useRef } from "react";
import { FlatList, View } from "react-native";
import { usePrefs } from "../prefs";
import { RADIUS } from "../theme";
import { Icon, type IconName } from "../ui/Icon";
import { Press } from "../ui/Press";
import { Txt } from "../ui/Txt";

const CARD = 168;
const GAP = 12;
const TYPE_ICON: Record<LessonType, IconName> = { video: "play", external: "play", text: "file", resource: "download" };

export interface RailLesson {
  id: number;
  part: number;
  title_bn: string;
  title_en: string;
  type: LessonType;
  duration_sec: number;
  completed?: boolean;
  available_at?: string | null;
  module_bn: string;
  module_en: string;
}

/** The class's lessons in their order, numbered across the parts (1, 2, 3 …) as the student counts them. */
export function railLessons(curriculum: CurriculumModuleDTO[]): RailLesson[] {
  let part = 0;
  return curriculum.flatMap((m) =>
    m.lessons.map((l) => ({
      id: l.id,
      part: ++part,
      title_bn: l.title_bn,
      title_en: l.title_en,
      type: l.type,
      duration_sec: l.duration_sec,
      completed: l.completed,
      available_at: l.available_at,
      module_bn: m.title_bn,
      module_en: m.title_en,
    })),
  );
}

/**
 * The lessons of the class as one sideways row under the video, like a video app's playlist: the one playing is marked and scrolled into
 * view, a tap opens another. A lesson that opens later shows its date and a lock, and cannot be tapped yet.
 */
export function LessonRail({ lessons, currentId, onOpen }: { lessons: RailLesson[]; currentId: number; onOpen: (id: number) => void }) {
  const { c, t, lang, n } = usePrefs();
  const list = useRef<FlatList<RailLesson>>(null);
  const at = Math.max(0, lessons.findIndex((l) => l.id === currentId));
  const now = Date.now();
  useEffect(() => {
    if (!lessons.length) return;
    // the one playing sits near the middle (a little of the one before stays in view)
    const id = setTimeout(() => list.current?.scrollToIndex({ index: at, animated: false, viewPosition: 0.35 }), 0);
    return () => clearTimeout(id);
  }, [at, lessons.length]);
  if (!lessons.length) return null;
  return (
    <FlatList
      ref={list}
      horizontal
      data={lessons}
      keyExtractor={(l) => String(l.id)}
      getItemLayout={(_, index) => ({ length: CARD + GAP, offset: (CARD + GAP) * index, index })}
      onScrollToIndexFailed={() => undefined}
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -16 }}
      contentContainerStyle={{ paddingHorizontal: 16 }}
      ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
      renderItem={({ item: l }) => {
        const current = l.id === currentId;
        const lockedUntil = l.available_at && Date.parse(l.available_at) > now ? l.available_at : null;
        const icon: IconName = lockedUntil ? "lock" : l.completed && !current ? "check" : TYPE_ICON[l.type] ?? "play";
        const time = formatDuration(l.duration_sec, lang);
        return (
          <Press
            disabled={!!lockedUntil}
            onPress={() => (current ? undefined : onOpen(l.id))}
            scale={0.98}
            accessibilityRole="button"
            accessibilityLabel={`${t("lesson.part", { n: n(l.part), total: n(lessons.length) })}: ${loc(l, "title", lang)}${current ? `, ${t("lesson.nowPlaying")}` : l.completed ? `, ${t("lesson.done")}` : ""}`}
            accessibilityState={{ disabled: !!lockedUntil, selected: current }}
            style={{ width: CARD, gap: 8, padding: 6, borderRadius: RADIUS.m + 2, borderWidth: 1.5, borderColor: current ? c.accent : "transparent", backgroundColor: current ? c.accentSoft : "transparent", opacity: lockedUntil ? 0.6 : 1 }}
          >
            <View style={{ aspectRatio: 16 / 9, borderRadius: RADIUS.s + 2, backgroundColor: current ? c.accent : c.raised, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: c.line }}>
              <Txt v="title" color={current ? c.onAccent : c.text3} style={{ position: "absolute", left: 10, top: 2, opacity: 0.55 }}>
                {n(l.part)}
              </Txt>
              <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: current ? "rgba(0,0,0,0.18)" : l.completed ? c.okBg : c.surface }}>
                <Icon name={icon} size={18} color={current ? c.onAccent : l.completed ? c.ok : c.accent} />
              </View>
              {current ? (
                <View style={{ position: "absolute", left: 6, bottom: 6, paddingHorizontal: 7, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.72)" }}>
                  <Txt v="tiny" color="#fff">
                    {t("lesson.nowPlaying")}
                  </Txt>
                </View>
              ) : time ? (
                <View style={{ position: "absolute", right: 6, bottom: 6, paddingHorizontal: 7, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.72)" }}>
                  <Txt v="tiny" color="#fff">
                    {time}
                  </Txt>
                </View>
              ) : null}
            </View>
            <View style={{ gap: 1, paddingHorizontal: 2 }}>
              <Txt v="label" numberOfLines={2} style={{ fontSize: 13.5, lineHeight: 20 }}>
                {loc(l, "title", lang)}
              </Txt>
              <Txt v="tiny" color={c.text3} numberOfLines={1}>
                {lockedUntil ? t("course.locked", { date: formatDate(lockedUntil, lang) }) : loc({ title_bn: l.module_bn, title_en: l.module_en }, "title", lang)}
              </Txt>
            </View>
          </Press>
        );
      }}
    />
  );
}
