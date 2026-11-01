import { formatDate, formatDuration, loc } from "@mawah/shared/format";
import type { CurriculumModuleDTO } from "@mawah/shared/types";
import { View } from "react-native";
import { usePrefs } from "../prefs";
import { Card } from "../ui/Card";
import { Icon, type IconName } from "../ui/Icon";
import { Press } from "../ui/Press";
import { Txt } from "../ui/Txt";

/** A class's lessons, by part. A lesson that opens later (drip) shows its date and cannot be tapped yet. */
export function LessonList({ modules, onOpen, currentId, previewOnly }: { modules: CurriculumModuleDTO[]; onOpen: (id: number) => void; currentId?: number; previewOnly?: boolean }) {
  const { c, t, lang } = usePrefs();
  const now = Date.now();
  return (
    <View style={{ gap: 14 }}>
      {modules.map((m) => (
        <View key={m.id} style={{ gap: 8 }}>
          {modules.length > 1 || loc(m, "title", lang).trim() ? (
            <Txt v="label" color={c.text3}>
              {loc(m, "title", lang)}
            </Txt>
          ) : null}
          <Card pad={false}>
            {m.lessons.map((l, i) => {
              const lockedUntil = l.available_at && Date.parse(l.available_at) > now ? l.available_at : null;
              const open = previewOnly ? l.is_preview : !lockedUntil;
              const icon: IconName = l.completed ? "check" : lockedUntil || (previewOnly && !l.is_preview) ? "lock" : l.type === "text" ? "file" : l.type === "resource" ? "download" : "play";
              const current = l.id === currentId;
              const time = formatDuration(l.duration_sec, lang);
              return (
                <Press
                  key={l.id}
                  disabled={!open}
                  onPress={() => onOpen(l.id)}
                  scale={0.99}
                  accessibilityRole="button"
                  accessibilityLabel={loc(l, "title", lang)}
                  accessibilityState={{ disabled: !open, selected: current }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, backgroundColor: current ? c.accentSoft : "transparent" }}
                >
                  <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: l.completed ? c.okBg : c.raised }}>
                    <Icon name={icon} size={16} color={l.completed ? c.ok : open ? c.accent : c.text3} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt v="label" numberOfLines={2} color={open ? c.text : c.text3}>
                      {loc(l, "title", lang)}
                    </Txt>
                    {lockedUntil ? (
                      <Txt v="small" color={c.text3}>
                        {t("course.locked", { date: formatDate(lockedUntil, lang) })}
                      </Txt>
                    ) : time ? (
                      <Txt v="small" color={c.text3}>
                        {time}
                      </Txt>
                    ) : null}
                  </View>
                  {previewOnly && l.is_preview ? (
                    <Txt v="tiny" color={c.accent}>
                      {t("demo.free")}
                    </Txt>
                  ) : null}
                </Press>
              );
            })}
          </Card>
        </View>
      ))}
    </View>
  );
}
