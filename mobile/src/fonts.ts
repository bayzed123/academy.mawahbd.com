/**
 * The fonts to load while the app starts — none on Android: the three weights the app uses (Hind Siliguri 400, 600, 700) are built into
 * the app (app.config.ts, the expo-font plugin), so they are there the moment it opens and the splash screen waits only for the settings
 * and the sign-in. The web build used for testing loads them instead (fonts.web.ts).
 */
export const APP_FONTS: Record<string, number> = {};
