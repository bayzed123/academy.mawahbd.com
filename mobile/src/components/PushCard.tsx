import { Platform, Switch, ToastAndroid, View } from "react-native";
import { usePrefs } from "../prefs";
import { usePush } from "../push";
import { Btn } from "../ui/Btn";
import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { Press } from "../ui/Press";
import { Txt } from "../ui/Txt";

const toast = (text: string) => {
  if (Platform.OS === "android") ToastAndroid.show(text, ToastAndroid.SHORT);
};

/**
 * Home offers notifications once: Allow (the phone then asks its own question), Not now, or ✕. Either of the last two hides the card for
 * good; Profile → Notifications can still turn them on.
 */
export function PushCard() {
  const { c, t } = usePrefs();
  const push = usePush();
  if (!push.available || push.choice !== null) return null;
  const allow = async () => {
    const r = await push.allow();
    if (r !== "refused") toast(t(r === "on" ? "push.on" : "push.failed"));
  };
  return (
    <Card style={{ gap: 14 }} accessibilityLabel={t("push.card.title")}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name="bell" size={22} color={c.accent} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt v="heading">{t("push.card.title")}</Txt>
          <Txt v="small" color={c.text2}>
            {t("push.card.body")}
          </Txt>
        </View>
        <Press onPress={push.later} accessibilityRole="button" accessibilityLabel={t("push.close")} hitSlop={12} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16 }}>
          <Icon name="close" size={18} color={c.text3} />
        </Press>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Btn title={t("push.allow")} icon="bell" onPress={() => void allow()} loading={push.busy} style={{ flex: 1 }} />
        <Btn title={t("push.later")} kind="secondary" onPress={push.later} disabled={push.busy} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

/**
 * Profile → Notifications: a switch. On asks the phone if need be; when the phone no longer asks (turned off in its settings), it opens the
 * phone's settings instead. Off tells the website and has Google forget this copy's address.
 */
export function PushSetting() {
  const { c, t } = usePrefs();
  const push = usePush();
  if (!push.available) return null;
  const on = push.choice === "on" && push.permission === "granted";
  const toggle = async (next: boolean) => {
    if (!next) return push.turnOff();
    if (push.permission === "blocked") return push.openSettings();
    const r = await push.allow();
    if (r !== "refused") toast(t(r === "on" ? "push.on" : "push.failed"));
  };
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
          <Icon name="bell" size={18} color={c.accent} />
        </View>
        {/* the group's title above already says "Notifications": the row says what they are about */}
        <Txt v="body" style={{ flex: 1 }}>
          {t("push.sub")}
        </Txt>
        <Switch
          value={on}
          onValueChange={(v) => void toggle(v)}
          disabled={push.busy}
          accessibilityLabel={t("push.title")}
          accessibilityHint={t("push.sub")}
          trackColor={{ true: c.accent, false: c.line }}
          thumbColor="#ffffff"
          // the web preview colours the knob of a switch that is on by its own rule
          {...(Platform.OS === "web" ? ({ activeThumbColor: "#ffffff" } as object) : {})}
        />
      </View>
      {push.permission === "blocked" && push.choice !== "off" ? (
        <View style={{ gap: 8, alignItems: "flex-start" }}>
          <Txt v="small" color={c.text2}>
            {t("push.blocked")}
          </Txt>
          <Btn title={t("push.openSettings")} kind="secondary" small onPress={push.openSettings} />
        </View>
      ) : null}
    </Card>
  );
}
