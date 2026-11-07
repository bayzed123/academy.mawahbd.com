/** The web build used for testing has no fonts built in: it loads the three weights the app uses (fonts.ts says why Android needs none). */
export const APP_FONTS: Record<string, number> = {
  HindSiliguri_400Regular: require("@expo-google-fonts/hind-siliguri/400Regular/HindSiliguri_400Regular.ttf"),
  HindSiliguri_600SemiBold: require("@expo-google-fonts/hind-siliguri/600SemiBold/HindSiliguri_600SemiBold.ttf"),
  HindSiliguri_700Bold: require("@expo-google-fonts/hind-siliguri/700Bold/HindSiliguri_700Bold.ttf"),
};
