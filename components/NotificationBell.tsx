"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type NotificationItem = {
  id: number;
  type:
    | "job_match"
    | "message"
    | "connection_request"
    | "connection_accepted"
    | "application_received"
    | "application_update";
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};

type NotificationResponse = {
  notifications: NotificationItem[];
  unreadCount: number;
  pushPublicKey: string | null;
  pushSetupError: string | null;
};

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

function decodeApplicationServerKey(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = window.atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  const buffer: ArrayBuffer = new ArrayBuffer(decoded.length);
  const key = new Uint8Array(buffer);
  for (let index = 0; index < decoded.length; index += 1) {
    key[index] = decoded.charCodeAt(index);
  }
  return buffer;
}

function timeLabel(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

export default function NotificationBell({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushSetupError, setPushSetupError] = useState("");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await fetch("/api/notifications", { cache: "no-store", signal });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(payload, "We couldn't load notifications."));
      const data = payload as NotificationResponse;
      setItems(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(Number.isSafeInteger(data.unreadCount) ? data.unreadCount : 0);
      setPushPublicKey(typeof data.pushPublicKey === "string" ? data.pushPublicKey : null);
      setPushSetupError(typeof data.pushSetupError === "string" ? data.pushSetupError : "");
      setError("");
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "We couldn't load notifications.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadNotifications(controller.signal));
    let interval: number | undefined;
    if (typeof window !== "undefined") interval = window.setInterval(() => void loadNotifications(), 45_000);
    const refreshOnFocus = () => void loadNotifications();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      controller.abort();
      if (interval !== undefined) window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [enabled, loadNotifications]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: MouseEvent) {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    let active = true;
    void navigator.serviceWorker.getRegistration("/").then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      if (active) setPushSubscribed(Boolean(subscription));
    }).catch((subscriptionError: unknown) => {
      console.error("Checking browser notification subscription failed.", subscriptionError);
    });
    return () => { active = false; };
  }, [enabled]);

  async function updateReadState(id?: number) {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id === undefined ? { all: true } : { id }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(payload, "We couldn't update notification status."));
    await loadNotifications();
  }

  async function enablePush() {
    if (!pushPublicKey) {
      setError(pushSetupError || "Browser notifications are not configured on this server.");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setError("This browser does not support push notifications. In-app notifications will still work.");
      return;
    }
    setPushBusy(true);
    setError("");
    try {
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") {
        throw new Error(permission === "denied"
          ? "Browser notifications are blocked. Change the permission in your browser settings to enable them."
          : "Browser notification permission was not granted.");
      }
      const registration = await navigator.serviceWorker.register("/careerverse-sw.js", { scope: "/" });
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(pushPublicKey),
      });
      const response = await fetch("/api/notifications/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error(errorMessage(payload, "We couldn't enable browser notifications."));
      }
      setPushSubscribed(true);
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "We couldn't enable browser notifications.");
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        setPushSubscribed(false);
        return;
      }
      const response = await fetch("/api/notifications/push", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(payload, "We couldn't disable browser notifications."));
      await subscription.unsubscribe();
      setPushSubscribed(false);
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "We couldn't disable browser notifications.");
    } finally {
      setPushBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <div className="notification-bell" ref={panelRef}>
      <button
        className="notification-bell-button"
        type="button"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => { setOpen((current) => !current); if (!open) void loadNotifications(); }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        <span>Notifications</span>
        {unreadCount > 0 && <span className="notification-badge" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>
      {open && <section className="notification-panel" id="notification-panel" aria-label="Notifications">
        <div className="notification-panel-heading">
          <div><strong>Notifications</strong><span>{unreadCount ? `${unreadCount} unread` : "You’re all caught up"}</span></div>
          {unreadCount > 0 && <button type="button" onClick={() => void updateReadState().catch((readError: unknown) => setError(readError instanceof Error ? readError.message : "Could not mark notifications as read."))}>Mark all read</button>}
        </div>
        {error && <p className="notification-error" role="alert">{error}</p>}
        {loading && items.length === 0 && <p className="notification-empty" role="status">Loading notifications…</p>}
        {!loading && !error && items.length === 0 && <p className="notification-empty">New messages, connection activity, and relevant jobs will appear here.</p>}
        {items.length > 0 && <ul className="notification-list">
          {items.map((item) => (
            <li className={item.readAt ? "notification-item" : "notification-item notification-item-unread"} key={item.id}>
              <Link href={item.href} onClick={() => {
                if (!item.readAt) void updateReadState(item.id).catch((readError: unknown) => setError(readError instanceof Error ? readError.message : "Could not mark this notification as read."));
                setOpen(false);
              }}>
                <strong>{item.title}</strong><span>{item.body}</span><time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time>
              </Link>
              {!item.readAt && <button className="notification-mark-read" type="button" aria-label={`Mark as read: ${item.title}`} onClick={() => void updateReadState(item.id).catch((readError: unknown) => setError(readError instanceof Error ? readError.message : "Could not mark this notification as read."))}>Mark read</button>}
            </li>
          ))}
        </ul>}
        <div className="notification-push-controls">
          {pushSubscribed
            ? <button type="button" disabled={pushBusy} onClick={() => void disablePush()}>{pushBusy ? "Updating…" : "Turn off browser alerts"}</button>
            : <button type="button" disabled={pushBusy || !pushPublicKey} onClick={() => void enablePush()}>{pushBusy ? "Enabling…" : "Enable browser alerts"}</button>}
          {pushSetupError && !pushPublicKey && <small>{pushSetupError}</small>}
          {!pushPublicKey && !pushSetupError && <small>Browser alerts aren’t configured yet; your in-app inbox still works.</small>}
          {"Notification" in window && Notification.permission === "denied" && <small>Permission is blocked in browser settings.</small>}
        </div>
      </section>}
    </div>
  );
}
