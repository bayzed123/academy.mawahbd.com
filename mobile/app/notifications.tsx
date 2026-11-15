import { formatDateTime, loc } from "@mawah/shared/format";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useInbox } from "../src/inbox";
import { screenOf } from "../src/lib/pushPath";
import { usePrefs } from "../src/prefs";
import { RADIUS } from "../src/theme";
import type { InboxItem } from "../src/types";
import { Header } from "../src/ui/Header";
import { Icon, type IconName } from "../src/ui/Icon";
import { Page } from "../src/ui/Page";
import { Press } from "../src/ui/Press";
import { CardSkeleton } from "../src/ui/Skeleton";
import { EmptyState } from "../src/ui/States";
import { Txt } from "../src/ui/Txt";

const ICON: Record<InboxItem["kind"], IconName> = { new_class: "gift", new_lessons: "play", manual: "bell" };

/**
 * The bell's list: the notifications sent lately (a new class, a new lesson in one of my classes, news from the academy), newest first. The
 * ones that are new since the last look are marked; a tap opens what it is about. Opening the list counts them all as seen.
 */
export default function NotificationsScreen() {
  const { c, t, lang } = usePrefs();
  const router = useRouter();
  const inbox = useInbox();
  // what was new when the list was opened stays marked while it is open
  const [before] = useState(inbox.seen);
  const [refreshing, setRefreshing] = useState(false);
  const { markSeen, items } = inbox;
  useEffect(() => {
    markSeen();
  }, [markSeen, items]);

  const refresh = async () => {
    setRefreshing(true);
    await inbox.refresh();
    setRefreshing(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={t("inbox.title")} />
      <Page under onRefresh={() => void refresh()} refreshing={refreshing}>
        <Txt v="small" color={c.text3}>
          {t("inbox.sub")}
        </Txt>
        {inbox.loading && !items.length ? (
          <View style={{ gap: 12 }}>
            <CardSkeleton />
          </View>
        ) : items.length === 0 ? (
          <EmptyState icon="bell" title={t("inbox.empty.title")} body={t("inbox.empty.body")} />
        ) : (
          <View style={{ gap: 10 }}>
            {items.map((n) => {
              const fresh = n.id > before;
              const to = screenOf(n.path);
              const title = loc(n, "title", lang);
              const body = loc(n, "body", lang);
              return (
                <Press
                  key={n.id}
                  disabled={!to}
                  onPress={() => (to === "/" ? router.navigate("/") : to ? router.push(to as never) : undefined)}
                  accessibilityRole="button"
                  accessibilityLabel={`${fresh ? `${t("inbox.new")}: ` : ""}${title}. ${body}`}
                  scale={0.99}
                  style={{ flexDirection: "row", gap: 12, padding: 14, borderRadius: RADIUS.l, backgroundColor: fresh ? c.accentSoft : c.surface, borderWidth: 1, borderColor: fresh ? c.accent : c.line }}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: fresh ? c.accent : c.raised }}>
                    <Icon name={ICON[n.kind] ?? "bell"} size={19} color={fresh ? c.onAccent : c.accent} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Txt v="label" style={{ flex: 1 }} numberOfLines={2}>
                        {title}
                      </Txt>
                      {fresh ? (
                        <View style={{ paddingHorizontal: 8, paddingVertical: 1, borderRadius: RADIUS.pill, backgroundColor: c.accent }}>
                          <Txt v="tiny" color={c.onAccent}>
                            {t("inbox.new")}
                          </Txt>
                        </View>
                      ) : null}
                    </View>
                    <Txt v="body" color={c.text2}>
                      {body}
                    </Txt>
                    <Txt v="tiny" color={c.text3}>
                      {formatDateTime(n.created_at, lang)}
                    </Txt>
                  </View>
                  {to && to !== "/" ? <Icon name="chevronRight" size={18} color={c.text3} /> : null}
                </Press>
              );
            })}
          </View>
        )}
      </Page>
    </View>
  );
}
