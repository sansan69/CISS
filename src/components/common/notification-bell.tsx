"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  BellSimple as Bell,
  BellSimpleZ as BellActive,
  Check,
  Warning as AlertTriangle,
} from "@phosphor-icons/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAppAuth } from "@/context/auth-context";
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { cn } from "@/lib/utils";

type WebNotification = {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  createdAt: Date | null;
};

function toWebNotification(doc: QueryDocumentSnapshot): WebNotification {
  const data = doc.data();
  const createdAt =
    typeof (data.createdAt as any)?.toDate === "function"
      ? (data.createdAt as any).toDate()
      : data.createdAt instanceof Date
        ? data.createdAt
        : null;
  return {
    id: doc.id,
    title: typeof data.title === "string" ? data.title : "Notification",
    body: typeof data.body === "string" ? data.body : "",
    type: typeof data.type === "string" ? data.type : "broadcast",
    read: data.read === true,
    createdAt,
  };
}

/**
 * In-app notification bell for the web shell. Listens to the user's own
 * notifications (recipientUid) in real time; supports mark-read on click and
 * mark-all-read. Rendered for field officers, who are the web users that
 * receive targeted broadcasts.
 */
export function NotificationBell() {
  const { user, userRole } = useAppAuth();
  const [notifications, setNotifications] = useState<WebNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const uid = user?.uid;
  const enabled = userRole === "fieldOfficer" && Boolean(uid);

  useEffect(() => {
    if (!enabled || !uid) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(
        collection(db, "notifications"),
        where("recipientUid", "==", uid),
        orderBy("createdAt", "desc"),
        limit(20),
      ),
      (snap) => {
        setNotifications(snap.docs.map(toWebNotification));
        setLoading(false);
      },
      (err) => {
        console.error("[notification-bell] listener failed:", err);
        setLoading(false);
      },
    );
    return () => {
      unsub();
    };
  }, [enabled, uid]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const markRead = useCallback(async (notification: WebNotification) => {
    if (notification.read) return;
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)),
    );
    try {
      await updateDoc(doc(db, "notifications", notification.id), {
        read: true,
        readAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("[notification-bell] mark-read failed:", err);
      // Roll back on failure so the user can retry
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: false } : n)),
      );
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await Promise.all(
        unread.map((n) =>
          updateDoc(doc(db, "notifications", n.id), {
            read: true,
            readAt: serverTimestamp(),
          }),
        ),
      );
    } catch (err) {
      console.error("[notification-bell] mark-all-read failed:", err);
    }
  }, [notifications]);

  if (!enabled) return null;

  const hasNotifications = notifications.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.97]"
        >
          {unreadCount > 0 ? (
            <BellActive className="h-5 w-5" weight="fill" aria-hidden="true" />
          ) : (
            <Bell className="h-5 w-5" weight="regular" aria-hidden="true" />
          )}
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white tabular-nums">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(92vw,360px)] overflow-hidden rounded-2xl border-border/80 p-0 shadow-brand-lg"
      >
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-foreground">Notifications</p>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary tabular-nums">
                {unreadCount} new
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-brand-blue transition-colors hover:bg-primary/10"
            >
              <Check className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
          {loading ? (
            <div className="space-y-3 px-4 py-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-4/5 animate-pulse rounded bg-muted/70" />
                </div>
              ))}
            </div>
          ) : !hasNotifications ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground/60">
                <Bell className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No notifications yet</p>
              <p className="text-xs text-muted-foreground/70">
                Alerts from your administrators will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => markRead(notification)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40",
                      !notification.read && "bg-primary/[0.03]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        notification.read ? "bg-border" : "bg-brand-blue",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-[13px] leading-tight",
                            notification.read
                              ? "font-medium text-muted-foreground"
                              : "font-bold text-foreground",
                          )}
                        >
                          {notification.title}
                        </span>
                        {notification.createdAt && (
                          <span className="shrink-0 text-[10px] font-medium text-muted-foreground/70 tabular-nums">
                            {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                          </span>
                        )}
                      </span>
                      {notification.body && (
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-4 text-muted-foreground">
                          {notification.body}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!loading && hasNotifications && notifications.some((n) => n.type === "shift_reminder") && (
          <div className="flex items-center gap-2 border-t border-border/70 bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3 shrink-0 text-warning-strong" />
            Some reminders may also arrive as push notifications on your phone.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
