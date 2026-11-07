import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Platform, TextInput, View } from "react-native";
import { ApiError } from "../src/api";
import { API_URL } from "../src/config";
import { siteLinks } from "../src/lib/links";
import { openPage } from "../src/open";
import { usePrefs } from "../src/prefs";
import { useSession } from "../src/session";
import { errorKey } from "../src/strings";
import { FONT, RADIUS } from "../src/theme";
import { Btn } from "../src/ui/Btn";
import { Card } from "../src/ui/Card";
import { Header } from "../src/ui/Header";
import { Icon, type IconName } from "../src/ui/Icon";
import { Page } from "../src/ui/Page";
import { Press } from "../src/ui/Press";
import { Txt } from "../src/ui/Txt";

/**
 * Profile → Delete my account (Google Play requires it inside the app): what is deleted and what is kept, the password when the account has
 * one, an "I understand" tick, and the button. The account is deleted on the server (so on the website too) and the app forgets it.
 */
export default function DeleteAccount() {
  const { c, t, lang } = usePrefs();
  const { status, me, deleteAccount } = useSession();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const links = siteLinks(API_URL, lang);
  // an account made at checkout may have no password yet: being signed in on this phone is then enough
  const needsPassword = me?.has_password ?? true;
  const ready = sure && (!needsPassword || password.length > 0);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(needsPassword ? password : undefined);
      router.replace("/");
      if (Platform.OS !== "web") Alert.alert(t("del.title"), t("del.done"));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "server";
      setError(code === "network" ? t("err.network") : code === "invalid_credentials" ? t("del.wrongPassword") : t(errorKey(code)));
      setBusy(false);
    }
  };

  const field = { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line2, borderRadius: RADIUS.m, minHeight: 52, paddingHorizontal: 14, color: c.text, fontFamily: FONT.regular, fontSize: 16 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={t("del.title")} />
      <Page under keyboard>
        {status !== "in" || !me ? (
          <Card style={{ gap: 12 }}>
            <Txt v="body" color={c.text2}>
              {t("profile.loggedOut")}
            </Txt>
            <Btn title={t("profile.login")} onPress={() => router.push("/login")} />
          </Card>
        ) : (
          <>
            <Txt v="body" color={c.text2}>
              {t("del.lead")}
            </Txt>

            <Card style={{ gap: 12 }}>
              <Txt v="heading">{t("del.gone")}</Txt>
              <Point icon="close" color={c.bad} text={t("del.gone1")} />
              <Point icon="close" color={c.bad} text={t("del.gone2")} />
              <Point icon="close" color={c.bad} text={t("del.gone3")} />
              <Txt v="heading" style={{ marginTop: 6 }}>
                {t("del.kept")}
              </Txt>
              <Point icon="shield" color={c.text3} text={t("del.kept1")} />
              <Btn kind="ghost" small title={t("del.more")} iconRight="external" onPress={() => void openPage(links.accountDelete, c.surface)} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
            </Card>

            {needsPassword ? (
              <View style={{ gap: 8 }}>
                <Txt v="label" color={c.text2} nativeID="del-pw">
                  {t("del.password")}
                </Txt>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="done"
                  accessibilityLabelledBy="del-pw"
                  style={field}
                />
              </View>
            ) : null}

            <Press
              onPress={() => setSure((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: sure }}
              accessibilityLabel={t("del.confirm")}
              scale={0.99}
              style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 4 }}
            >
              <View style={{ width: 24, height: 24, marginTop: 1, borderRadius: 6, borderWidth: 2, borderColor: sure ? c.bad : c.line2, backgroundColor: sure ? c.bad : "transparent", alignItems: "center", justifyContent: "center" }}>
                {sure ? <Icon name="check" size={16} color={c.onAccent} /> : null}
              </View>
              <Txt v="body" style={{ flex: 1 }}>
                {t("del.confirm")}
              </Txt>
            </Press>

            {error ? (
              <View accessibilityLiveRegion="polite" style={{ backgroundColor: c.badBg, borderRadius: RADIUS.m, padding: 12, borderWidth: 1, borderColor: c.bad }}>
                <Txt v="small" color={c.bad}>
                  {error}
                </Txt>
              </View>
            ) : null}

            <Btn kind="danger" icon="trash" title={t("del.button")} onPress={() => void submit()} loading={busy} disabled={!ready} />
          </>
        )}
      </Page>
    </View>
  );
}

function Point({ icon, color, text }: { icon: IconName; color: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <View style={{ marginTop: 2 }}>
        <Icon name={icon} size={18} color={color} />
      </View>
      <Txt v="body" style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}
