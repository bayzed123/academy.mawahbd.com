import { useRouter } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "../src/api";
import { API_URL } from "../src/config";
import { siteLinks } from "../src/lib/links";
import { openPage } from "../src/open";
import { usePrefs } from "../src/prefs";
import { useSession } from "../src/session";
import { errorKey, type StringKey } from "../src/strings";
import { FONT, RADIUS } from "../src/theme";
import { Btn } from "../src/ui/Btn";
import { Icon } from "../src/ui/Icon";
import { Press } from "../src/ui/Press";
import { Txt } from "../src/ui/Txt";

type Field = "name" | "phone" | "email" | "password";

/**
 * A free account, made in the app, to study its free classes: a name, a mobile number (how they log in), a password — and an e-mail only
 * if they want one. The account is the same as one made on the website (Profile → Delete my account removes it). Opened from Home, the
 * login screen and a free class; once made, the app is signed in and goes back to where it came from.
 */
export default function Signup() {
  const { c, t, lang } = usePrefs();
  const { register } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const links = siteLinks(API_URL, lang);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const phoneRef = useRef<ComponentRef<typeof TextInput>>(null);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const pwRef = useRef<ComponentRef<typeof TextInput>>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const submit = async () => {
    const missing: Partial<Record<Field, string>> = {};
    if (name.trim().length < 2) missing.name = t("err.required");
    if (!phone.trim()) missing.phone = t("err.required");
    if (password.length < 8) missing.password = t("err.weak_password");
    if (Object.keys(missing).length) {
      setFieldErrors(missing);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await register({ name: name.trim(), phone: phone.trim(), email: email.trim() || undefined, password, lang });
      close();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        // the server names the field and why (phone_taken, invalid_phone, email_taken, weak_password …)
        const next: Partial<Record<Field, string>> = {};
        for (const [k, code] of Object.entries(err.fields)) if (k === "name" || k === "phone" || k === "email" || k === "password") next[k] = t(errorKey(code === "required" ? "required" : code));
        setFieldErrors(next);
        if (!Object.keys(next).length) setError(t(errorKey(err.code)));
      } else {
        const code = err instanceof ApiError ? err.code : "server";
        setError(code === "network" ? t("err.network") : t(errorKey(code)));
      }
    } finally {
      setBusy(false);
    }
  };

  const field = { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line2, borderRadius: RADIUS.m, minHeight: 52, paddingHorizontal: 14, color: c.text, fontFamily: FONT.regular, fontSize: 16 } as const;
  const bad = (k: Field) => (fieldErrors[k] ? { borderColor: c.bad } : null);
  const label = (k: Field, key: StringKey) => (
    <Txt v="label" color={c.text2} nativeID={`su-${k}`}>
      {t(key)}
    </Txt>
  );
  const problem = (k: Field) =>
    fieldErrors[k] ? (
      <Txt v="small" color={c.bad} accessibilityLiveRegion="polite">
        {fieldErrors[k]}
      </Txt>
    ) : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 16, width: "100%", maxWidth: 560, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Press onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
            <Icon name="close" size={20} color={c.text} />
          </Press>
        </View>
        <View style={{ alignItems: "center", gap: 10, marginBottom: 4 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.okBg, alignItems: "center", justifyContent: "center" }}>
            <Icon name="gift" size={26} color={c.ok} />
          </View>
          <Txt v="display" center>
            {t("signup.title")}
          </Txt>
          <Txt v="body" color={c.text2} center>
            {t("signup.sub")}
          </Txt>
        </View>

        <View style={{ gap: 8 }}>
          {label("name", "signup.name")}
          <TextInput value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" textContentType="name" returnKeyType="next" onSubmitEditing={() => phoneRef.current?.focus()} accessibilityLabelledBy="su-name" style={[field, bad("name")]} maxLength={80} />
          {problem("name")}
        </View>

        <View style={{ gap: 8 }}>
          {label("phone", "signup.phone")}
          <TextInput
            ref={phoneRef}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            placeholder="01XXXXXXXXX"
            placeholderTextColor={c.text3}
            accessibilityLabelledBy="su-phone"
            style={[field, bad("phone")]}
            maxLength={20}
          />
          {problem("phone")}
        </View>

        <View style={{ gap: 8 }}>
          {label("email", "signup.email")}
          <TextInput
            ref={emailRef}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => pwRef.current?.focus()}
            accessibilityLabelledBy="su-email"
            style={[field, bad("email")]}
            maxLength={254}
          />
          {problem("email") ?? (
            <Txt v="small" color={c.text3}>
              {t("signup.emailHint")}
            </Txt>
          )}
        </View>

        <View style={{ gap: 8 }}>
          {label("password", "signup.password")}
          <View>
            <TextInput
              ref={pwRef}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              accessibilityLabelledBy="su-password"
              style={[field, { paddingRight: 52 }, bad("password")]}
              maxLength={128}
            />
            <Press onPress={() => setShow((s) => !s)} accessibilityRole="button" accessibilityLabel={show ? t("login.hide") : t("login.show")} hitSlop={8} style={{ position: "absolute", right: 6, top: 6, width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
              <Icon name={show ? "eyeOff" : "eye"} size={20} color={c.text3} />
            </Press>
          </View>
          {problem("password") ?? (
            <Txt v="small" color={c.text3}>
              {t("signup.passwordHint")}
            </Txt>
          )}
        </View>

        {error ? (
          <View accessibilityLiveRegion="polite" style={{ backgroundColor: c.badBg, borderRadius: RADIUS.m, padding: 12, borderWidth: 1, borderColor: c.bad }}>
            <Txt v="small" color={c.bad}>
              {error}
            </Txt>
          </View>
        ) : null}

        <Btn title={t("signup.submit")} onPress={() => void submit()} loading={busy} />

        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: 4 }}>
          <Txt v="small" color={c.text3}>
            {t("signup.agree")}
          </Txt>
          <Press onPress={() => void openPage(links.policy("terms"), c.surface)} accessibilityRole="link" hitSlop={6}>
            <Txt v="small" color={c.link}>
              {t("signup.terms")}
            </Txt>
          </Press>
          <Txt v="small" color={c.text3}>
            {t("signup.and")}
          </Txt>
          <Press onPress={() => void openPage(links.policy("privacy"), c.surface)} accessibilityRole="link" hitSlop={6}>
            <Txt v="small" color={c.link}>
              {t("signup.privacy")}
            </Txt>
          </Press>
        </View>

        <Press onPress={() => router.replace("/login")} accessibilityRole="link" style={{ alignSelf: "center", padding: 6 }}>
          <Txt v="label" color={c.link}>
            {t("signup.have")}
          </Txt>
        </Press>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
