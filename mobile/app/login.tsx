import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, useResource } from "../src/api";
import { API_URL } from "../src/config";
import { siteLinks, whatsappLink } from "../src/lib/links";
import { openApp, openPage } from "../src/open";
import { usePrefs } from "../src/prefs";
import { useSession } from "../src/session";
import { errorKey } from "../src/strings";
import { FONT, RADIUS } from "../src/theme";
import type { SiteInfo } from "../src/types";
import { Btn } from "../src/ui/Btn";
import { Icon } from "../src/ui/Icon";
import { Press } from "../src/ui/Press";
import { Txt } from "../src/ui/Txt";

export default function Login() {
  const { c, t, lang } = usePrefs();
  const { login } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const site = useResource<SiteInfo>("/api/site");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pw = useRef<ComponentRef<typeof TextInput>>(null);
  const wa = site.data ? whatsappLink(site.data.site.contact.whatsapp) : null;

  const submit = async () => {
    if (!identifier.trim() || !password) {
      setError(t("err.required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "server";
      setError(code === "network" ? t("err.network") : t(errorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  const field = { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line2, borderRadius: RADIUS.m, minHeight: 52, paddingHorizontal: 14, color: c.text, fontFamily: FONT.regular, fontSize: 16 } as const;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 18 }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Press onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
            <Icon name="close" size={20} color={c.text} />
          </Press>
        </View>
        <View style={{ alignItems: "center", gap: 14, marginBottom: 6 }}>
          <Image source={require("../assets/logo-wide.png")} style={{ width: 170, height: 88, borderRadius: 12 }} contentFit="contain" accessibilityLabel="MAWAH Academy" />
          <Txt v="display" center>
            {t("login.title")}
          </Txt>
          <Txt v="body" color={c.text2} center>
            {t("login.sub")}
          </Txt>
        </View>

        <View style={{ gap: 8 }}>
          <Txt v="label" color={c.text2} nativeID="who">
            {t("login.identifier")}
          </Txt>
          <TextInput
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => pw.current?.focus()}
            placeholder="01XXXXXXXXX"
            placeholderTextColor={c.text3}
            accessibilityLabelledBy="who"
            style={field}
          />
        </View>

        <View style={{ gap: 8 }}>
          <Txt v="label" color={c.text2} nativeID="pw">
            {t("login.password")}
          </Txt>
          <View>
            <TextInput
              ref={pw}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              accessibilityLabelledBy="pw"
              style={[field, { paddingRight: 52 }]}
            />
            <Press onPress={() => setShow((s) => !s)} accessibilityRole="button" accessibilityLabel={show ? t("login.hide") : t("login.show")} hitSlop={8} style={{ position: "absolute", right: 6, top: 6, width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
              <Icon name={show ? "eyeOff" : "eye"} size={20} color={c.text3} />
            </Press>
          </View>
        </View>

        {error ? (
          <View accessibilityLiveRegion="polite" style={{ backgroundColor: c.badBg, borderRadius: RADIUS.m, padding: 12, borderWidth: 1, borderColor: c.bad }}>
            <Txt v="small" color={c.bad}>
              {error}
            </Txt>
          </View>
        ) : null}

        <Btn title={t("login.submit")} onPress={() => void submit()} loading={busy} />

        <Press onPress={() => void openPage(siteLinks(API_URL, lang).forgot, c.surface)} accessibilityRole="link" style={{ alignSelf: "center", padding: 6 }}>
          <Txt v="label" color={c.link}>
            {t("login.forgot")}
          </Txt>
        </Press>

        <Txt v="small" color={c.text3} center>
          {t("login.hint")}
        </Txt>

        {wa ? (
          <Press onPress={() => void openApp(wa)} accessibilityRole="button" style={{ alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, padding: 8 }}>
            <Icon name="whatsapp" size={18} color="#25D366" />
            <Txt v="label" color={c.text2}>
              {t("login.help")}
            </Txt>
          </Press>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
