import type { ConfigContext, ExpoConfig } from "expo/config";
import pkg from "./package.json";

/**
 * MAWAH Academy for Android. The package name can never change once the first build is on Google Play.
 *
 * Set by the Android build workflow (.github/workflows/android.yml):
 *  - ANDROID_VERSION_CODE: a higher number for every build (Google refuses an upload whose number it has seen before)
 *  - EXPO_PUBLIC_API_URL: only to point a test build at another server; the real app talks to https://mawahacademy.com
 */
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
    // the app needs the internet and nothing else: no camera, microphone, location, contacts or files
    blockedPermissions: [
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
    "expo-font",
    "expo-web-browser",
    "expo-sharing",
    "expo-image",
    ["expo-secure-store", { configureAndroidBackup: true }],
    ["expo-video", { supportsBackgroundPlayback: false, supportsPictureInPicture: false }],
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 220, resizeMode: "contain", backgroundColor: "#000000" }],
    "expo-system-ui",
    "./plugins/with-release-signing.js",
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || "https://mawahacademy.com",
  },
});
