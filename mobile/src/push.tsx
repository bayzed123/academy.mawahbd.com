import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useRootNavigationState, useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Linking, Platform } from "react-native";
import { api } from "./api";
import { tappedPath } from "./lib/pushPath";
import { usePrefs } from "./prefs";
import { useSession } from "./session";
import { KEYS, readValue, writeValue } from "./storage";
import type { Lang } from "./strings";

/*
 * Notifications (the server's side: worker/src/services/push.ts). Nothing is asked until the person chooses: Home offers them once (Allow /
 * Not now, or ✕), Profile has a switch. Allowing asks the phone (Android 13 and newer show their own question), then hands the address Google
 * gave this copy of the app to the website, with the app's language — again at every start, at sign-in and sign-out and when the language
 * changes, so the website knows which classes' news this phone should get. Google delivers them itself, with the app closed too.
 * Turning them off tells the website and has Google forget the address. A build without the Firebase file (a test build) never offers them.
 */

/** this copy of the app can get notifications: an Android build made with the Firebase file */
export const PUSH_BUILT = Platform.OS === "android" && Constants.expoConfig?.extra?.push === true;
/** the channel the website files them under (worker/src/lib/fcm.ts ANDROID_CHANNEL); the phone's settings show it by its name */
const CHANNEL = "classes";

/** what the person chose: "on", "off" (Profile), "later" (Not now or ✕ on Home), or null — not asked yet */
export type PushChoice = "on" | "off" | "later" | null;
/** what the phone allows: "blocked" = it no longer asks (turned off in its settings, or refused twice) */
export type PushPermission = "granted" | "undetermined" | "denied" | "blocked";

if (PUSH_BUILT) {
  // one that comes while the app is open is shown too, quietly
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

const permissionOf = (p: Notifications.NotificationPermissionsStatus): PushPermission =>
  p.granted ? "granted" : !p.canAskAgain ? "blocked" : p.status === "undetermined" ? "undetermined" : "denied";

const makeChannel = (name: string) =>
  Notifications.setNotificationChannelAsync(CHANNEL, { name, importance: Notifications.AndroidImportance.HIGH, lightColor: "#FF5722", vibrationPattern: [0, 180, 120, 180] });

/** Hands this copy's address to the website; true when the website took it. A stale address is swapped for a new one, once. */
async function checkIn(lang: Lang, channelName: string, retry = true): Promise<boolean> {
  await makeChannel(channelName); // the channel's name follows the app's language
  const { data } = await Notifications.getDevicePushTokenAsync();
  const token = typeof data === "string" ? data : "";
  if (!token) return false;
  const previous = await readValue(KEYS.pushToken);
  const res = await api<{ registered: boolean }>("/api/app/push", { method: "POST", body: { token, lang, ...(previous && previous !== token ? { previous } : {}) } });
  await writeValue(KEYS.pushToken, token);
  if (res.registered || !retry) return res.registered;
  // Google no longer knows this address: have it make a new one
  await Notifications.unregisterForNotificationsAsync();
  return checkIn(lang, channelName, false);
}

interface Push {
  /** whether to offer notifications at all (this build can get them, and what the person chose has been read) */
  available: boolean;
  choice: PushChoice;
  permission: PushPermission;
  busy: boolean;
  /** ask (if need be) and turn them on: "on", "refused" (the phone's own question was answered no), or "failed" (no internet, or Google) */
  allow: () => Promise<"on" | "refused" | "failed">;
  /** Not now, or ✕: Home stops offering them (Profile still can) */
  later: () => void;
  turnOff: () => Promise<void>;
  openSettings: () => void;
}

const PushContext = createContext<Push | null>(null);

export function PushProvider({ children }: { children: ReactNode }) {
  const { lang, t } = usePrefs();
  const { status, me } = useSession();
  const [choice, setChoice] = useState<PushChoice | undefined>(undefined); // undefined: not read yet
  const [permission, setPermission] = useState<PushPermission>("undetermined");
  const [busy, setBusy] = useState(false);
  // the check-in for this sign-in and language: running or done (a failed one is forgotten, so the next chance tries again)
  const done = useRef<{ key: string; result: Promise<boolean> } | null>(null);
  const channelName = t("push.channel");
  // who is signed in on the phone (-1: nobody); null while that is still being read
  const who = status === "loading" ? null : status === "in" ? (me?.id ?? 0) : -1;

  const sync = useCallback(
    (key: string) => {
      if (done.current?.key === key) return done.current.result;
      const result = checkIn(lang, channelName)
        .catch(() => false)
        .then((ok) => {
          if (!ok && done.current?.key === key) done.current = null;
          return ok;
        });
      done.current = { key, result };
      return result;
    },
    [lang, channelName],
  );

  // what the person chose and what the phone allows: read at start, and each time the app comes back to the front (the phone's settings may
  // have changed in between)
  useEffect(() => {
    if (!PUSH_BUILT) return;
    let live = true;
    const read = async () => {
      const [saved, p] = await Promise.all([readValue(KEYS.push), Notifications.getPermissionsAsync().catch(() => null)]);
      if (!live) return;
      setChoice(saved === "on" || saved === "off" || saved === "later" ? saved : null);
      if (p) setPermission(permissionOf(p));
    };
    void read();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void read();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  // checking in: at every start, at sign-in and sign-out, and when the language changes
  useEffect(() => {
    if (!PUSH_BUILT || choice !== "on" || permission !== "granted" || who === null) return;
    void sync(`${who}|${lang}`);
  }, [choice, permission, who, lang, sync]);

  const remember = useCallback((next: Exclude<PushChoice, null>) => {
    setChoice(next);
    void writeValue(KEYS.push, next);
  }, []);

  const allow = useCallback(async (): Promise<"on" | "refused" | "failed"> => {
    if (!PUSH_BUILT || who === null) return "failed";
    setBusy(true);
    try {
      // Android 13 and newer ask only once a channel exists
      await makeChannel(channelName);
      let p = await Notifications.getPermissionsAsync();
      if (!p.granted && p.canAskAgain) p = await Notifications.requestPermissionsAsync();
      const now = permissionOf(p);
      setPermission(now);
      if (now !== "granted") {
        // "Don't allow" on the phone's own question counts as Not now (Profile can ask again, or open the phone's settings)
        remember("later");
        return "refused";
      }
      remember("on");
      return (await sync(`${who}|${lang}`)) ? "on" : "failed";
    } catch {
      return "failed";
    } finally {
      setBusy(false);
    }
  }, [who, lang, channelName, remember, sync]);

  const later = useCallback(() => remember("later"), [remember]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      remember("off");
      done.current = null;
      const token = await readValue(KEYS.pushToken);
      if (token) await api("/api/app/push/off", { method: "POST", body: { token }, timeout: 10 }).catch(() => undefined);
      await Notifications.unregisterForNotificationsAsync().catch(() => undefined);
      await writeValue(KEYS.pushToken, null);
    } finally {
      setBusy(false);
    }
  }, [remember]);

  const value = useMemo<Push>(
    () => ({
      available: PUSH_BUILT && choice !== undefined,
      choice: choice ?? null,
      permission,
      busy,
      allow,
      later,
      turnOff,
      openSettings: () => void Linking.openSettings(),
    }),
    [choice, permission, busy, allow, later, turnOff],
  );
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush(): Push {
  const v = useContext(PushContext);
  if (!v) throw new Error("usePush outside PushProvider");
  return v;
}

/** A tapped notification opens what it is about. Rendered only in a build that can get notifications. */
export function NotificationTaps() {
  const router = useRouter();
  // a tap that opened the app arrives before its screens are up: it waits for them
  const ready = !!useRootNavigationState()?.key;
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const path = tappedPath(last);
    if (path && path !== "/") router.push(path as never);
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, [ready, last, router]);
  return null;
}
