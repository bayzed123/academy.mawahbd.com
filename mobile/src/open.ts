import * as WebBrowser from "expo-web-browser";
import { Linking, Platform } from "react-native";
import { safeWebUrl } from "./lib/links";

/**
 * A web page (the shop's checkout, a policy, a certificate) opens in a browser tab on top of the app, in the app's colours, and the
 * student comes straight back with the back button. Apps (WhatsApp, the phone dialler, Messenger) open with their own links.
 */
export async function openPage(url: string, color?: string) {
  const safe = safeWebUrl(url);
  if (!safe) return;
  if (Platform.OS === "web") {
    globalThis.open?.(safe, "_blank", "noopener");
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(safe, { toolbarColor: color, controlsColor: color, enableBarCollapsing: true, showTitle: true });
  } catch {
    await Linking.openURL(safe);
  }
}

export async function openApp(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    /* no app for it on this phone */
  }
}
