import { loc } from "@mawah/shared/format";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { FlatList, useWindowDimensions, View } from "react-native";
import { useResource } from "../../src/api";
import { CourseArt, DemoCard, FreeCard, MyCourseCard, ProductCard } from "../../src/components/Cards";
import { PushCard } from "../../src/components/PushCard";
import { useInbox } from "../../src/inbox";
import { badgeText } from "../../src/lib/inbox";
import { whatsappLink } from "../../src/lib/links";
import { contentWidth, gridColumns, tileWidth } from "../../src/lib/layout";
import { openApp } from "../../src/open";
import { usePrefs } from "../../src/prefs";
import { useSession } from "../../src/session";
import { RADIUS } from "../../src/theme";
import type { CourseList, MyCourses, ShopPage, SiteInfo } from "../../src/types";
import { Btn } from "../../src/ui/Btn";
import { Card } from "../../src/ui/Card";
import { Icon } from "../../src/ui/Icon";
import { Page, SectionTitle } from "../../src/ui/Page";
import { Press } from "../../src/ui/Press";
import { ProgressBar } from "../../src/ui/ProgressBar";
import { CardSkeleton, Skeleton } from "../../src/ui/Skeleton";
import { Txt } from "../../src/ui/Txt";

export default function Home() {
  const { c, t, lang, n, setLookPref } = usePrefs();
  const inbox = useInbox();
  // the newest notification not seen yet (lib/inbox.ts), for the bar under the greeting
  const latest = inbox.unread ? (inbox.items.find((x) => x.id > inbox.seen) ?? null) : null;
  const { status, me } = useSession();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const signedIn = status === "in";

  const mine = useResource<MyCourses>(signedIn ? "/api/student/courses" : null);
  const catalog = useResource<CourseList>("/api/courses?per_page=48");
  // the app's own free classes (Admin → Android app): free for everyone with an account, never on the website
  const free = useResource<CourseList>("/api/app/courses");
  const shop = useResource<ShopPage>("/api/shop/products?sort=featured");
  const site = useResource<SiteInfo>("/api/site");

  const demos = useMemo(() => (catalog.data?.courses ?? []).filter((x) => x.has_demo), [catalog.data]);
  const courses = mine.data?.courses ?? [];
  // the class to carry on with: the newest one not finished yet (the list comes newest first)
  const current = courses.find((m) => m.progress.pct < 100) ?? courses[0];
  const cols = gridColumns(contentWidth(width));
  // the top row (logo, Free classes, bell, night / day) has room for the button's words from about 350 points
  const narrow = width < 350;
  // one or two full rows: 4 on a phone (2 × 2), 3 or 4 on a tablet
  const products = (shop.data?.items ?? []).slice(0, cols === 3 ? 3 : 4);
  const tile = tileWidth(contentWidth(width), cols);
  const wa = site.data ? whatsappLink(site.data.site.contact.whatsapp) : null;
  const notice = site.data?.site.app_notice ? site.data.site.app_notice[lang] : "";
  // a free class the student has started already is under "My classes": the row offers the others
  const mineIds = new Set(courses.map((m) => m.course.id));
  const freeClasses = (free.data?.courses ?? []).filter((x) => !mineIds.has(x.id));

  const refreshing = mine.refreshing || catalog.refreshing || shop.refreshing || free.refreshing;
  const refresh = () => {
    void inbox.refresh();
    void mine.refresh();
    void free.refresh();
    void catalog.refresh();
    void shop.refresh();
    void site.refresh();
  };

  return (
    <Page onRefresh={refresh} refreshing={refreshing}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Image source={require("../../assets/logo-wide.png")} style={{ width: 76, height: 44, borderRadius: 8 }} contentFit="contain" accessibilityLabel="MAWAH Academy" />
          {/* every free class in one place, beside night / day (as on the website); a very narrow phone shows its gift only */}
          <Press
            onPress={() => router.push("/free")}
            accessibilityRole="button"
            accessibilityLabel={t("home.freeBtn")}
            hitSlop={4}
            style={{ marginLeft: "auto", flexShrink: 1, minWidth: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, paddingHorizontal: narrow ? 0 : 13, borderRadius: 22, backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accent }}
          >
            <Icon name="gift" size={18} color={c.accent} />
            {narrow ? null : (
              <Txt v="label" color={c.look === "night" ? c.link : c.accentPressed} numberOfLines={1} style={{ flexShrink: 1 }}>
                {t("home.freeBtn")}
              </Txt>
            )}
          </Press>
          {/* the bell: the notifications sent lately, with how many are new */}
          <Press
            onPress={() => router.push("/notifications")}
            accessibilityRole="button"
            accessibilityLabel={inbox.unread ? t("home.bellNew", { n: n(inbox.unread) }) : t("home.bell")}
            hitSlop={4}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.raised, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="bell" size={20} color={c.text} />
            {inbox.unread ? (
              <View style={{ position: "absolute", top: -3, right: -3, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: c.accent, borderWidth: 2, borderColor: c.bg, alignItems: "center", justifyContent: "center" }}>
                <Txt v="tiny" color={c.onAccent} style={{ fontSize: 10.5, lineHeight: 14 }}>
                  {badgeText(inbox.unread, n)}
                </Txt>
              </View>
            ) : null}
          </Press>
          {/* day or night in one tap (Profile → Look also offers "like my phone") */}
          <Press
            onPress={() => setLookPref(c.look === "night" ? "day" : "night")}
            accessibilityRole="button"
            accessibilityLabel={c.look === "night" ? t("home.toDay") : t("home.toNight")}
            hitSlop={4}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.raised, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name={c.look === "night" ? "sun" : "moon"} size={20} color={c.text} />
          </Press>
        </View>
        <View>
          <Txt v="heading" numberOfLines={1}>
            {signedIn && me ? t("home.hello", { name: me.name.split(" ")[0] ?? me.name }) : t("home.welcome")}
          </Txt>
          <Txt v="small" color={c.text3} numberOfLines={2}>
            {t("home.welcomeSub")}
          </Txt>
        </View>
      </View>

      {/* the notification bar: the newest notification not seen yet; a tap opens the list */}
      {latest ? (
        <Press
          onPress={() => router.push("/notifications")}
          accessibilityRole="button"
          accessibilityLabel={`${t("inbox.latest", { title: loc(latest, "title", lang) })}. ${loc(latest, "body", lang)}`}
          scale={0.99}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.surface, borderRadius: RADIUS.m, borderWidth: 1, borderColor: c.accent, paddingHorizontal: 14, paddingVertical: 12 }}
        >
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
            <Icon name="bell" size={18} color={c.onAccent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt v="label" numberOfLines={1}>
              {t("inbox.latest", { title: loc(latest, "title", lang) })}
            </Txt>
            <Txt v="small" color={c.text2} numberOfLines={2}>
              {loc(latest, "body", lang)}
            </Txt>
          </View>
          <Icon name="chevronRight" size={18} color={c.text3} />
        </Press>
      ) : null}

      {notice ? (
        <View accessibilityRole="summary" style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: c.accentSoft, borderRadius: RADIUS.m, paddingHorizontal: 14, paddingVertical: 12 }}>
          <Icon name="bell" size={18} color={c.accent} />
          <Txt v="body" style={{ flex: 1 }} accessibilityLabel={`${t("home.notice")}: ${notice}`}>
            {notice}
          </Txt>
        </View>
      ) : null}

      <PushCard />

      {signedIn ? (
        mine.loading ? (
          <CardSkeleton />
        ) : current ? (
          <Press
            onPress={() => router.push(current.resume_lesson_id ? `/lesson/${current.resume_lesson_id}` : `/course/${current.course.slug}`)}
            accessibilityRole="button"
            accessibilityLabel={`${t("home.continue")}: ${loc(current.course, "title", lang)}`}
            style={{ backgroundColor: c.surface, borderRadius: RADIUS.l, borderWidth: 1, borderColor: c.line, overflow: "hidden" }}
          >
            <CourseArt course={current.course} height={168} />
            <View style={{ padding: 16, gap: 10 }}>
              <Txt v="tiny" color={c.accent} style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
                {t("home.continue")}
              </Txt>
              <Txt v="title" numberOfLines={2}>
                {loc(current.course, "title", lang)}
              </Txt>
              <ProgressBar pct={current.progress.pct} />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Txt v="small" color={c.text3}>
                  {t("learning.progress", { done: current.progress.done, total: current.progress.total })}
                </Txt>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.accent, borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: 7 }}>
                  <Icon name="play" size={14} color={c.onAccent} />
                  <Txt v="label" color={c.onAccent} style={{ fontSize: 13.5 }}>
                    {t("home.continueCta")}
                  </Txt>
                </View>
              </View>
            </View>
          </Press>
        ) : null
      ) : (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name="book" size={22} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt v="heading">{t("home.login.title")}</Txt>
              <Txt v="small" color={c.text2}>
                {t("home.login.sub")}
              </Txt>
            </View>
          </View>
          <Btn title={t("home.login.cta")} onPress={() => router.push("/login")} />
          <Btn kind="secondary" title={t("home.login.signup")} icon="gift" onPress={() => router.push("/signup")} />
        </Card>
      )}

      {free.loading || freeClasses.length ? (
        <View style={{ gap: 12 }}>
          <SectionTitle title={t("home.free.title")} sub={t("home.free.sub")} />
          {free.loading ? (
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ width: 230 }}>
                <CardSkeleton />
              </View>
              <View style={{ width: 230 }}>
                <CardSkeleton />
              </View>
            </View>
          ) : (
            <FlatList
              horizontal
              data={freeClasses}
              keyExtractor={(x) => String(x.id)}
              renderItem={({ item }) => <FreeCard course={item} onPress={() => router.push(`/free/${item.slug}`)} />}
              ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -16 }}
              contentContainerStyle={{ paddingHorizontal: 16 }}
            />
          )}
        </View>
      ) : null}

      {signedIn && courses.length > 1 ? (
        <View style={{ gap: 12 }}>
          <SectionTitle title={t("home.myClasses")} right={<SeeAll onPress={() => router.push("/learning")} />} />
          <FlatList
            horizontal
            data={courses}
            keyExtractor={(m) => String(m.course.id)}
            renderItem={({ item }) => <MyCourseCard item={item} onPress={() => router.push(`/course/${item.course.slug}`)} />}
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -16 }}
            contentContainerStyle={{ paddingHorizontal: 16 }}
          />
        </View>
      ) : null}

      {catalog.loading || demos.length ? (
        <View style={{ gap: 12 }}>
          <SectionTitle title={t("home.demo.title")} sub={t("home.demo.sub")} />
          {catalog.loading ? (
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ width: 230 }}>
                <CardSkeleton />
              </View>
              <View style={{ width: 230 }}>
                <CardSkeleton />
              </View>
            </View>
          ) : (
            <FlatList
              horizontal
              data={demos}
              keyExtractor={(x) => String(x.id)}
              renderItem={({ item }) => <DemoCard course={item} onPress={() => router.push(`/demo/${item.slug}`)} />}
              ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -16 }}
              contentContainerStyle={{ paddingHorizontal: 16 }}
            />
          )}
        </View>
      ) : null}

      {shop.loading || products.length ? (
        <View style={{ gap: 12 }}>
          <SectionTitle title={t("home.shop.title")} sub={t("home.shop.sub")} right={<SeeAll onPress={() => router.push("/shop")} />} />
          {shop.loading ? (
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Skeleton w={tile} h={tile + 70} r={20} />
              <Skeleton w={tile} h={tile + 70} r={20} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {products.map((p) => (
                <ProductCard key={p.id} p={p} width={tile} onPress={() => router.push(`/product/${p.slug}`)} />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {wa ? (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: "#25D366", alignItems: "center", justifyContent: "center" }}>
            <Icon name="whatsapp" size={24} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Txt v="heading">{t("home.help.title")}</Txt>
            <Txt v="small" color={c.text2}>
              {t("home.help.sub")}
            </Txt>
          </View>
          <Press onPress={() => void openApp(wa)} accessibilityRole="button" accessibilityLabel={t("profile.whatsapp")} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
            <Icon name="arrowRight" size={20} color={c.text} />
          </Press>
        </Card>
      ) : null}
    </Page>
  );
}

function SeeAll({ onPress }: { onPress: () => void }) {
  const { c, t } = usePrefs();
  return (
    <Press onPress={onPress} accessibilityRole="button" hitSlop={10}>
      <Txt v="label" color={c.link}>
        {t("common.seeAll")}
      </Txt>
    </Press>
  );
}
