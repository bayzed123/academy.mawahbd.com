import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Small values the app keeps between launches. On the phone they live in Android's encrypted storage (the Keystore), so the sign-in token is
 * never in plain files. The web build (only used to preview the screens) falls back to the browser's storage.
 */
const web = Platform.OS === "web";

export async function readValue(key: string): Promise<string | null> {
  try {
    if (web) return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function writeValue(key: string, value: string | null): Promise<void> {
  try {
    if (web) {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
      return;
    }
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    /* a phone that cannot store it simply asks again next time */
  }
}

export const KEYS = {
  token: "mawah.token",
  me: "mawah.me",
  lang: "mawah.lang",
  look: "mawah.look",
  /** notifications: what the person chose (on / off / later), and the address Google gave this copy of the app */
  push: "mawah.push",
  pushToken: "mawah.pushToken",
} as const;
