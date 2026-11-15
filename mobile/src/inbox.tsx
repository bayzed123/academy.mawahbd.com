import * as Notifications from "expo-notifications";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { api } from "./api";
import { newestId, unreadOf } from "./lib/inbox";
import { PUSH_BUILT } from "./push";
import { useSession } from "./session";
import { KEYS, readValue, writeValue } from "./storage";
import type { InboxAnswer, InboxItem } from "./types";

/*
 * The bell on Home (the server's side: GET /api/app/notifications, worker/src/services/push.ts inboxFor): the notifications sent lately —
 * the news for everyone and, while a student is signed in, their own classes' news. Fetched at start, at sign-in and sign-out, each time
 * the app comes back to the front, and when one arrives while it is open. What was read is kept on the phone only: the newest id the person
 * has looked at. The list works with notifications turned off too: it is the app's own, and the phone's notifications are only its echo.
 */

interface Inbox {
  items: InboxItem[];
  loading: boolean;
  failed: boolean;
  /** how many are new (lib/inbox.ts unreadOf) */
  unread: number;
  /** the newest id seen before the Notifications screen was opened this time: newer ones are marked "New" there */
  seen: number;
  refresh: () => Promise<void>;
  /** the list was looked at: everything in it counts as seen */
  markSeen: () => void;
}

const InboxContext = createContext<Inbox | null>(null);

export function InboxProvider({ children }: { children: ReactNode }) {
  const { status, me } = useSession();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState(0);
  const live = useRef(true);
  // who is signed in (-1: nobody; null while that is still being read): their classes' news comes with theirs
  const who = status === "loading" ? null : status === "in" ? (me?.id ?? 0) : -1;

  useEffect(() => {
    live.current = true;
    void readValue(KEYS.inboxSeen).then((v) => {
      const n = Number(v);
      if (live.current && Number.isInteger(n) && n > 0) setSeen(n);
    });
    return () => {
      live.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api<InboxAnswer>("/api/app/notifications", { timeout: 15 });
      if (!live.current) return;
      setItems(Array.isArray(res.notifications) ? res.notifications : []);
      setFailed(false);
    } catch {
      if (live.current) setFailed(true); // an older server, or no internet: the bell simply shows nothing new
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (who === null) return;
    void refresh();
  }, [who, refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    // one that arrives while the app is open is on the bell at once
    const got = PUSH_BUILT ? Notifications.addNotificationReceivedListener(() => void refresh()) : null;
    return () => {
      sub.remove();
      got?.remove();
    };
  }, [refresh]);

  const markSeen = useCallback(() => {
    const top = newestId(items);
    if (top <= 0) return;
    setSeen((before) => {
      if (top <= before) return before;
      void writeValue(KEYS.inboxSeen, String(top));
      return top;
    });
  }, [items]);

  const value = useMemo<Inbox>(() => ({ items, loading, failed, unread: unreadOf(items, seen), seen, refresh, markSeen }), [items, loading, failed, seen, refresh, markSeen]);
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): Inbox {
  const v = useContext(InboxContext);
  if (!v) throw new Error("useInbox outside InboxProvider");
  return v;
}
