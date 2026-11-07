import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { View } from "react-native";
import { fcNutrientText, type FcMeDTO, type FcRecipeSummaryDTO } from "@mawah/shared/foodcost";
import { useResource } from "../../src/api";
import { useFc } from "../../src/components/FoodCost";
import { useSession } from "../../src/session";
import { Btn } from "../../src/ui/Btn";
import { Card } from "../../src/ui/Card";
import { Page, SectionTitle } from "../../src/ui/Page";
import { Press } from "../../src/ui/Press";
import { CardSkeleton } from "../../src/ui/Skeleton";
import { EmptyState, ErrorState } from "../../src/ui/States";
import { Txt } from "../../src/ui/Txt";

type List = { recipes: FcRecipeSummaryDTO[]; me: FcMeDTO };

/** The plan in one line. In the app the Free limit is said plainly, with nothing about buying (Google Play). */
function planText(me: FcMeDTO, t: ReturnType<typeof useFc>["t"]): string {
  if (me.student) return t("fc.planStudent");
  if (me.limit === null) return t("fc.planPro");
  return `${t("fc.planFree", { used: me.used, limit: me.limit })}${me.used >= me.limit ? ` ${t("fc.atLimit")}` : ""}`;
}

/** FoodCost: one's recipes, what each costs and sells for (docs/foodcost.md). The same server and engine as the website. */
export default function FoodCostTab() {
  const { t, c, n, per, unit, lang } = useFc();
  const { status } = useSession();
  const router = useRouter();
  const list = useResource<List>(status === "in" ? "/api/fc/v1/recipes" : null);
  // back from a recipe (saved, copied, deleted): read the list again — the first time, opening the tab has just read it
  const seen = useRef(false);
  const { refresh } = list;
  useFocusEffect(
    useCallback(() => {
      if (seen.current && status === "in") void refresh();
      seen.current = true;
    }, [refresh, status]),
  );

  if (status !== "in") {
    return (
      <Page>
        <SectionTitle title={t("fc.title")} sub={t("fc.sub")} />
        <EmptyState icon="receipt" title={t("fc.loggedOut.title")} body={t("fc.loggedOut.body")} action={{ title: t("home.login.cta"), onPress: () => router.push("/login") }} />
      </Page>
    );
  }

  const recipes = list.data?.recipes ?? [];
  return (
    <Page onRefresh={() => void refresh()} refreshing={list.refreshing}>
      <SectionTitle title={t("fc.title")} sub={t("fc.sub")} />
      {list.data ? (
        <Txt v="small" color={list.data.me.limit !== null && list.data.me.used >= list.data.me.limit ? c.bad : c.text2}>
          {planText(list.data.me, t)}
        </Txt>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Btn title={t("fc.new")} icon="plus" onPress={() => router.push("/foodcost/new")} style={{ flexGrow: 1 }} />
        <Btn title={t("fc.ingredients")} icon="tag" kind="secondary" onPress={() => router.push("/foodcost/ingredients")} style={{ flexGrow: 1 }} />
      </View>
      {list.loading ? (
        <View style={{ gap: 16 }}>
          <CardSkeleton />
          <CardSkeleton />
        </View>
      ) : list.error && !list.data ? (
        <ErrorState error={list.error} onRetry={() => void refresh()} />
      ) : recipes.length === 0 ? (
        <EmptyState icon="receipt" title={t("fc.empty")} body={t("fc.emptyHelp")} />
      ) : (
        <View style={{ gap: 12 }}>
          {recipes.map((r) => (
            <Press key={r.id} onPress={() => router.push(`/foodcost/${r.id}`)} accessibilityRole="button">
              <Card style={{ gap: 6 }}>
                <Txt v="heading" numberOfLines={2}>
                  {r.name}
                </Txt>
                <Txt v="small" color={c.text3}>
                  {t("fc.makes", { qty: n(r.yield_qty), what: r.yield_label || unit(r.yield_unit) })}
                </Txt>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 4 }}>
                  <View>
                    <Txt v="tiny" color={c.text3}>
                      {t("fc.cost")}
                    </Txt>
                    <Txt v="label">{per(r.per_unit_minor, r.yield_label, r.yield_unit)}</Txt>
                  </View>
                  {r.suggested_minor !== null ? (
                    <View>
                      <Txt v="tiny" color={c.text3}>
                        {t("fc.price")}
                      </Txt>
                      <Txt v="label" color={c.accent}>
                        {per(r.suggested_minor, r.yield_label, r.yield_unit)}
                      </Txt>
                    </View>
                  ) : null}
                  {r.kcal_per_unit !== null ? (
                    <View>
                      <Txt v="tiny" color={c.text3}>
                        {t("fc.kcalShort")}
                      </Txt>
                      <Txt v="label">{fcNutrientText("kcal", r.kcal_per_unit, lang)}</Txt>
                    </View>
                  ) : null}
                </View>
                {!r.complete ? (
                  <Txt v="tiny" color={c.bad}>
                    {t("fc.partial")}
                  </Txt>
                ) : null}
              </Card>
            </Press>
          ))}
        </View>
      )}
    </Page>
  );
}
