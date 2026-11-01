import { View } from "react-native";
import type { ApiError } from "../api";
import { usePrefs } from "../prefs";
import { errorKey } from "../strings";
import { Btn } from "./Btn";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: { title: string; onPress: () => void } }) {
  const { c } = usePrefs();
  return (
    <View style={{ alignItems: "center", paddingVertical: 40, paddingHorizontal: 24, gap: 10 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.raised, alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
        <Icon name={icon} size={28} color={c.accent} />
      </View>
      <Txt v="heading" center>
        {title}
      </Txt>
      {body ? (
        <Txt v="small" color={c.text2} center style={{ maxWidth: 320 }}>
          {body}
        </Txt>
      ) : null}
      {action ? <Btn title={action.title} onPress={action.onPress} style={{ marginTop: 10, alignSelf: "stretch" }} /> : null}
    </View>
  );
}

/** "No internet" or "something went wrong", with a button to try again. */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const { t } = usePrefs();
  const offline = error.code === "network";
  return (
    <EmptyState
      icon={offline ? "globe" : "refresh"}
      title={offline ? t("common.offline") : t(errorKey(error.code))}
      action={{ title: t("common.retry"), onPress: onRetry }}
    />
  );
}
