import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PrefsProvider, usePrefs } from "../src/prefs";
import { SessionProvider, useSession } from "../src/session";

export { ErrorBoundary } from "expo-router";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // only the three weights the app uses (the font package's index would pull in all five)
  const [fonts] = useFonts({
    HindSiliguri_400Regular: require("@expo-google-fonts/hind-siliguri/400Regular/HindSiliguri_400Regular.ttf"),
    HindSiliguri_600SemiBold: require("@expo-google-fonts/hind-siliguri/600SemiBold/HindSiliguri_600SemiBold.ttf"),
    HindSiliguri_700Bold: require("@expo-google-fonts/hind-siliguri/700Bold/HindSiliguri_700Bold.ttf"),
  });
  return (
    <SafeAreaProvider>
      <PrefsProvider>
        <SessionProvider>
          <Shell fonts={fonts} />
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
      </Stack>
    </>
  );
}
