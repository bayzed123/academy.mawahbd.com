import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";
import pkg from "./package.json";

/**
 * MAWAH Academy for Android. The package name can never change once the first build is on Google Play.
 *
 * Set by the Android build workflow (.github/workflows/android.yml):
 *  - ANDROID_VERSION_CODE: a higher number for every build (Google refuses an upload whose number it has seen before)
 *  - EXPO_PUBLIC_API_URL: only to point a test build at another server; the real app talks to https://mawahacademy.com
 *  - mobile/google-services.json: the Firebase project's file for the app's notifications, written from the GitHub secret GOOGLE_SERVICES_JSON
 *    (docs/android-app.md). Without it the app builds and works the same, and never offers notifications (`extra.push` is false).
 */
const firebaseFile = existsSync(join(typeof __dirname === "string" ? __dirname : process.cwd(), "google-services.json"));
const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? "1");
if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2_100_000_000) throw new Error(`Bad ANDROID_VERSION_CODE: ${process.env.ANDROID_VERSION_CODE}`);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "MAWAH Academy",
  slug: "mawah-academy",
  scheme: "mawahacademy",
  version: pkg.version,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#000000",
  android: {
    package: "com.mawahacademy.app",
    versionCode,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#000000" },
    predictiveBackGestureEnabled: false,
    ...(firebaseFile ? { googleServicesFile: "./google-services.json" } : {}),
    // the app needs the internet and its notifications, nothing else: no camera, microphone, location, contacts or files, no advertising ID,
    // and nothing that starts it with the phone (Google delivers the notifications itself)
    blockedPermissions: [
      "com.google.android.gms.permission.AD_ID",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_AUDIO",
    ],
  },
  web: { bundler: "metro", output: "single", favicon: "./assets/favicon.png" },
  plugins: [
    "expo-router",
    // the three weights the app uses, built into the app: there the moment it opens, nothing read while it starts (src/fonts.ts). Android
    // finds each by its file name, which is the name the styles use (src/theme.ts FONT)
    [
      "expo-font",
      {
        fonts: [
          "./node_modules/@expo-google-fonts/hind-siliguri/400Regular/HindSiliguri_400Regular.ttf",
          "./node_modules/@expo-google-fonts/hind-siliguri/600SemiBold/HindSiliguri_600SemiBold.ttf",
          "./node_modules/@expo-google-fonts/hind-siliguri/700Bold/HindSiliguri_700Bold.ttf",
        ],
      },
    ],
    "expo-web-browser",
    "expo-sharing",
    "expo-image",
    ["expo-secure-store", { configureAndroidBackup: true }],
    ["expo-video", { supportsBackgroundPlayback: false, supportsPictureInPicture: false }],
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 220, resizeMode: "contain", backgroundColor: "#000000" }],
    "expo-system-ui",
    // notifications: the small white icon in the status bar (assets/notification-icon.png), tinted with the app's colour, and the channel
    // they are filed under (the app makes it, by this id, before it asks to show them: src/push.tsx)
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#FF5722", defaultChannel: "classes" }],
    "./plugins/with-release-signing.js",
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || "https://mawahacademy.com",
    // this build can get notifications (it has the Firebase file)
    push: firebaseFile,
  },
});
