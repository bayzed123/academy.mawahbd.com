import { loc } from "@mawah/shared/format";
import type { ShopCardDTO } from "@mawah/shared/shop";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError, useResource } from "../../src/api";
import { ProductCard } from "../../src/components/Cards";
import { usePrefs } from "../../src/prefs";
import { RADIUS } from "../../src/theme";
import type { ShopCategories, ShopPage } from "../../src/types";
import { SectionTitle } from "../../src/ui/Page";
import { Press } from "../../src/ui/Press";
import { Skeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

/** The equipment shop: physical goods, two to a row, more as you scroll. Ordering happens on the website's secure page. */
export default function Shop() {
  const { c, t, lang } = usePrefs();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tile = (width - 16 * 2 - 12) / 2;
  const cats = useResource<ShopCategories>("/api/shop/categories");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<ShopCardDTO[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(
    async (nextPage: number, mode: "first" | "more" | "refresh") => {
      if (mode === "more") setMore(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        const q = `/api/shop/products?sort=featured&page=${nextPage}${category ? `&category=${encodeURIComponent(category)}` : ""}`;
        const res = await api<ShopPage>(q);
        setItems((prev) => (mode === "more" ? [...prev, ...res.items.filter((p) => !prev.some((x) => x.id === p.id))] : res.items));
        setPage(res.page);
        setPages(res.pages);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err : new ApiError(0, "network"));
      } finally {
        setLoading(false);
        setMore(false);
        setRefreshing(false);
      }
    },
    [category],
  );

  useEffect(() => {
    setLoading(true);
    void load(1, "first");
  }, [load]);

  const header = (
    <View style={{ gap: 14, paddingBottom: 14 }}>
      <SectionTitle title={t("shop.title")} sub={t("shop.sub")} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {[{ slug: "", name_bn: t("shop.all"), name_en: t("shop.all") }, ...(cats.data?.items ?? []).filter((x) => x.count > 0)].map((cat) => {
          const on = cat.slug === category;
          return (
            <Press
              key={cat.slug || "all"}
              onPress={() => setCategory(cat.slug)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={{ paddingHorizontal: 16, height: 36, borderRadius: RADIUS.pill, justifyContent: "center", backgroundColor: on ? c.accent : c.surface, borderWidth: 1, borderColor: on ? c.accent : c.line2 }}
            >
              <Txt v="label" color={on ? c.onAccent : c.text} style={{ fontSize: 13.5 }}>
                {loc(cat, "name", lang)}
              </Txt>
            </Press>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 32 }}
      data={loading ? [] : items}
      keyExtractor={(p) => String(p.id)}
      numColumns={2}
      columnWrapperStyle={{ gap: 12 }}
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      renderItem={({ item }) => <ProductCard p={item} width={tile} onPress={() => router.push(`/product/${item.slug}`)} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        loading ? (
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Skeleton w={tile} h={tile + 80} r={20} />
            <Skeleton w={tile} h={tile + 80} r={20} />
          </View>
        ) : error ? (
          <ErrorState error={error} onRetry={() => void load(1, "first")} />
        ) : (
          <EmptyState icon="shop" title={t("shop.empty")} />
        )
      }
      ListFooterComponent={more ? <ActivityIndicator color={c.accent} style={{ marginTop: 16 }} /> : undefined}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (!loading && !more && page < pages) void load(page + 1, "more");
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(1, "refresh")} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}
      showsVerticalScrollIndicator={false}
    />
  );
}
