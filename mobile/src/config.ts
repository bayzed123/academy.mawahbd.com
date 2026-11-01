import Constants from "expo-constants";

/** The website and its API. Test builds can point elsewhere with EXPO_PUBLIC_API_URL (app.config.ts). */
export const API_URL: string = ((Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "https://mawahacademy.com").replace(/\/+$/, "");

export const APP_VERSION: string = Constants.expoConfig?.version ?? "1.0.0";
