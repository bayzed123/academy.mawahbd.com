import { Alert, Platform, ToastAndroid } from "react-native";
import { FC_UNIT_NAMES, fcMoney, type FcProblem, type FcResult, type FcUnit } from "@mawah/shared/foodcost";
import { usePrefs } from "../prefs";
import { errorKey, type StringKey } from "../strings";

/*
 * What the app's FoodCost screens share (app/(tabs)/foodcost.tsx, app/foodcost/*): money, units and problems in the reader's language. The
 * costing itself is the website's and the server's (@mawah/shared/foodcost), so a recipe costs the same everywhere.
 */

export function useFc() {
  const { t, lang, n, c } = usePrefs();
  const money = (minor: number | null | undefined) => (minor === null || minor === undefined ? "—" : fcMoney(minor, lang));
  const unit = (u: FcUnit) => FC_UNIT_NAMES[u][lang];
  /** "৳37.92 / cupcake"; "—" while there is nothing to share out */
  const per = (minor: number | null, label: string, u: FcUnit) => (minor === null ? "—" : `${money(minor)} / ${label || unit(u)}`);
  return { t, lang, n, c, money, unit, per };
}

/** A problem in words, on the form line it is about (the lines sent leave out the empty ones). */
export function problemText(p: FcProblem, result: FcResult, rows: number[], t: ReturnType<typeof usePrefs>["t"]): string {
  const line = p.line !== undefined ? rows[p.line] + 1 : "";
  const name = p.line !== undefined ? (result.lines[p.line]?.name ?? "") : "";
  return t(`fc.p.${p.code}` as StringKey, { line, cost: p.cost !== undefined ? p.cost + 1 : "", name });
}

/** A field's error code in words. */
export function codeText(code: string, t: ReturnType<typeof usePrefs>["t"]): string {
  return code === "required" ? t("err.required") : t(errorKey(code === "invalid" ? "validation" : code));
}

/** A short note that something was done: Android's own toast; elsewhere (the web build used for testing) the screen's note line. */
export function say(text: string, note?: (text: string) => void) {
  if (Platform.OS === "android") ToastAndroid.show(text, ToastAndroid.SHORT);
  else note?.(text);
}

/** "Delete this?" with a safe way out, like the rest of the app (the web build used for testing has no Alert buttons). */
export function ask(title: string, body: string, yes: string, no: string, onYes: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(body ? `${title}\n${body}` : title)) onYes();
    return;
  }
  Alert.alert(title, body, [
    { text: no, style: "cancel" },
    { text: yes, style: "destructive", onPress: onYes },
  ]);
}
