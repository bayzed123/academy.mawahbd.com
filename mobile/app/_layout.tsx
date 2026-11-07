import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { APP_FONTS } from "../src/fonts";
import { PrefsProvider, usePrefs } from "../src/prefs";
import { NotificationTaps, PUSH_BUILT, PushProvider } from "../src/push";
import { SessionProvider, useSession } from "../src/session";

export { ErrorBoundary } from "expo-router";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // the three weights the app uses are built into the Android app (nothing to load: ready at once); the web build loads them (src/fonts.ts)
  const [fonts] = useFonts(APP_FONTS);
  return (
    <SafeAreaProvider>
      <PrefsProvider>
        <SessionProvider>
          <PushProvider>
            <Shell fonts={fonts} />
          </PushProvider>
        </SessionProvider>
      </PrefsProvider>
    </SafeAreaProvider>
  );
}

/** The splash screen (the logo on black) stays until the font, the settings and the sign-in are read: no flash of the wrong look. */
function Shell({ fonts }: { fonts: boolean }) {
  const { ready, c } = usePrefs();
  const { status } = useSession();
  const done = fonts && ready && status !== "loading";
  useEffect(() => {
    if (done) void SplashScreen.hideAsync();
  }, [done]);
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg);
  }, [c.bg]);
  if (!done) return null;
  return (
    <>
      <StatusBar style={c.look === "night" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: "slide_from_right" }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="signup" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      </Stack>
      {PUSH_BUILT ? <NotificationTaps /> : null}
    </>
  );
}
