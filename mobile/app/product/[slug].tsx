import { formatMoney, loc } from "@mawah/shared/format";
import { percentOff } from "@mawah/shared/shop";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResource } from "../../src/api";
import { API_URL } from "../../src/config";
import { siteLinks } from "../../src/lib/links";
import { contentWidth } from "../../src/lib/layout";
import { plainText } from "../../src/lib/text";
import { openPage } from "../../src/open";
import { usePrefs } from "../../src/prefs";
import { RADIUS } from "../../src/theme";
import type { ShopProduct } from "../../src/types";
import { Btn } from "../../src/ui/Btn";
import { Card } from "../../src/ui/Card";
import { Header } from "../../src/ui/Header";
import { Icon } from "../../src/ui/Icon";
import { Page, SectionTitle } from "../../src/ui/Page";
import { Skeleton } from "../../src/ui/Skeleton";
import { ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

/** A product of the equipment shop. Ordering (cash on delivery or online) opens the website's own product page, in the browser. */
export default function Product() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { c, t, lang, n } = usePrefs();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // the pictures fill the content column (the whole width on a phone, a centred column on a tablet)
  const width = contentWidth(windowWidth) + 32;
  const res = useResource<ShopProduct>(`/api/shop/products/${encodeURIComponent(slug)}`);
  const p = res.data?.product;
  const [slide, setSlide] = useState(0);
  const pictures = p ? (p.images.length ? p.images.map((i) => i.large) : p.image ? [p.image] : []) : [];
  const off = p ? percentOff(p.price, p.list_price) : null;
  const body = p ? plainText(loc(p, "body", lang) || loc(p, "short", lang)) : "";

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={p ? loc(p, "name", lang) : ""} />
      <Page under onRefresh={() => void res.refresh()} refreshing={res.refreshing} contentStyle={{ paddingBottom: 120 }}>
        {res.loading ? (
          <View style={{ gap: 14 }}>
            <Skeleton h={width - 32} r={20} />
            <Skeleton w="70%" h={22} />
          </View>
        ) : res.error && !p ? (
          <ErrorState error={res.error} onRetry={() => void res.refresh()} />
        ) : p ? (
          <>
            <View style={{ borderRadius: RADIUS.l, overflow: "hidden", backgroundColor: c.raised }}>
              {pictures.length ? (
                <FlatList
                  data={pictures}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(u, i) => `${i}-${u}`}
                  onMomentumScrollEnd={(e) => setSlide(Math.round(e.nativeEvent.contentOffset.x / (width - 32)))}
                  renderItem={({ item }) => <Image source={{ uri: `${API_URL}${item}` }} style={{ width: width - 32, aspectRatio: 1 }} contentFit="cover" transition={180} cachePolicy="memory-disk" />}
                />
              ) : (
                <View style={{ aspectRatio: 1, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="shop" size={48} color={c.text3} />
                </View>
              )}
              {pictures.length > 1 ? (
                <View style={{ position: "absolute", bottom: 10, alignSelf: "center", flexDirection: "row", gap: 6 }}>
                  {pictures.map((_, i) => (
                    <View key={i} style={{ width: i === slide ? 18 : 7, height: 7, borderRadius: 4, backgroundColor: i === slide ? c.accent : "rgba(255,255,255,0.6)" }} />
                  ))}
                </View>
              ) : null}
            </View>

            <View style={{ gap: 8 }}>
              <Txt v="title">{loc(p, "name", lang)}</Txt>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <Txt v="title" color={c.accent}>
                  {p.several ? t("shop.from", { price: formatMoney(p.price, lang) }) : formatMoney(p.price, lang)}
                </Txt>
                {off ? (
                  <>
                    <Txt v="body" color={c.text3} style={{ textDecorationLine: "line-through" }}>
                      {formatMoney(p.list_price, lang)}
                    </Txt>
                    <Txt v="label" color={c.accent}>
                      -{n(off)}%
                    </Txt>
                  </>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                <Txt v="small" color={p.in_stock ? c.ok : c.bad}>
                  {p.in_stock ? t("shop.inStock") : t("shop.outOfStock")}
                </Txt>
                {p.rating && p.reviews ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Icon name="star" size={14} color="#f5b301" />
                    <Txt v="small" color={c.text2}>
                      {n(p.rating.toFixed(1))} · {t("shop.reviews", { n: p.reviews })}
                    </Txt>
                  </View>
                ) : null}
              </View>
            </View>

            {p.variants.length > 1 ? (
              <View style={{ gap: 10 }}>
                <SectionTitle title={t("shop.options")} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {p.variants.map((v) => (
                    <View key={v.id} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.m, borderWidth: 1, borderColor: v.in_stock ? c.line2 : c.line, backgroundColor: c.surface, opacity: v.in_stock ? 1 : 0.55 }}>
                      <Txt v="label">{loc(v, "label", lang)}</Txt>
                      <Txt v="small" color={c.accent}>
                        {formatMoney(v.price, lang)}
                      </Txt>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {body ? (
              <View style={{ gap: 10 }}>
                <SectionTitle title={t("shop.details")} />
                <Card>
                  <Txt v="body" color={c.text2}>
                    {body}
                  </Txt>
                </Card>
              </View>
            ) : null}
          </>
        ) : null}
      </Page>

      {p ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line, gap: 6 }}>
          <Btn title={t("shop.order")} icon="cart" disabled={!p.in_stock} onPress={() => void openPage(siteLinks(API_URL, lang).product(p.slug), c.surface)} />
          <Txt v="tiny" color={c.text3} center>
            {t("shop.orderNote")}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
