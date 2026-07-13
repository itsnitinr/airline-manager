"use client";

import type {
  BrowserPermission,
  NotificationCenter,
  NotificationPreferences,
  NotificationSeverity,
  PlayerNotification,
} from "@airline-manager/domain";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";
import { browserNotificationApi, BrowserNotificationController } from "../browser-notifications";
import { formatDateTime } from "../lib/planning-format";
import { monitoringApi } from "../lib/ticket21-api";
import { LiveAuthorityStatus } from "./live-authority-status";

const category = (notification: PlayerNotification) =>
  notification.eventType.split(".")[0] ?? "other";
const safeRecoveryPath = (path: string | undefined) =>
  path?.startsWith("/app?") && !path.startsWith("//") ? path : null;

export function NotificationWorkspace({
  center,
  initialPreferences,
}: {
  center: NotificationCenter;
  initialPreferences: NotificationPreferences;
}) {
  const router = useRouter();
  const [severity, setSeverity] = useState<NotificationSeverity | "all">("all");
  const [readState, setReadState] = useState<"all" | "read" | "unread">("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [preferences, setPreferences] = useState(initialPreferences);
  const [permission, setPermission] = useState<BrowserPermission>("unsupported");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const categories = useMemo(() => [...new Set(center.items.map(category))].sort(), [center.items]);
  const items = useMemo(
    () =>
      center.items.filter(
        (notification) =>
          (severity === "all" || notification.severity === severity) &&
          (readState === "all" ||
            (readState === "read" ? notification.readAt !== null : notification.readAt === null)) &&
          (selectedCategory === "all" || category(notification) === selectedCategory),
      ),
    [center.items, readState, selectedCategory, severity],
  );

  useEffect(() => {
    queueMicrotask(() => setPermission(browserNotificationApi()?.permission ?? "unsupported"));
    const highest = center.items.reduce(
      (value, notification) =>
        BigInt(notification.eventId) > value ? BigInt(notification.eventId) : value,
      0n,
    );
    const stored = window.localStorage.getItem("airline-manager:browser-delivery-cursor");
    if (stored === null) {
      window.localStorage.setItem("airline-manager:browser-delivery-cursor", highest.toString());
      return;
    }
    const previous = /^\d+$/.test(stored) ? BigInt(stored) : highest;
    const controller = new BrowserNotificationController(browserNotificationApi());
    for (const notification of [...center.items].reverse()) {
      if (BigInt(notification.eventId) > previous) {
        controller.deliver(notification, preferences);
      }
    }
    if (highest > previous) {
      window.localStorage.setItem("airline-manager:browser-delivery-cursor", highest.toString());
    }
  }, [center.items, preferences]);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    setPending(true);
    setMessage("");
    try {
      await operation();
      setMessage(success);
      startTransition(() => router.refresh());
    } catch {
      setMessage(
        "The notification service could not apply that change. Your filters are preserved.",
      );
    } finally {
      setPending(false);
    }
  };
  const savePreferences = async (next: NotificationPreferences, success: string) => {
    setPreferences(next);
    await mutate(async () => {
      const saved = await monitoringApi.saveNotificationPreferences(next);
      setPreferences(saved);
    }, success);
  };
  const optIn = async () => {
    const controller = new BrowserNotificationController(browserNotificationApi());
    const nextPermission = await controller.optIn(true);
    setPermission(nextPermission);
    if (nextPermission === "granted") {
      await savePreferences(
        { ...preferences, browserEnabled: true },
        "Browser notifications enabled.",
      );
    } else {
      setMessage(
        nextPermission === "denied"
          ? "Browser permission was denied. Persisted in-game notifications remain available."
          : "Browser notifications are unsupported here. Persisted in-game notifications remain available.",
      );
    }
  };

  return (
    <section className="notification-workspace focused-workspace">
      <header className="notification-titlebar">
        <div>
          <p className="eyebrow">Persisted operational inbox</p>
          <h2>Alerts and notifications</h2>
          <small>
            {center.unreadCount} unread · as of {formatDateTime(center.asOf)}
          </small>
        </div>
        <LiveAuthorityStatus />
        <button
          type="button"
          className="button button-quiet"
          disabled={pending || center.unreadCount === 0}
          onClick={() =>
            void mutate(
              monitoringApi.markAllNotifications,
              "All current notifications marked read.",
            )
          }
        >
          Mark all read
        </button>
      </header>
      <div className="notification-layout">
        <section className="notification-inbox" aria-label="Notification inbox">
          <div className="notification-filters">
            <label>
              Severity
              <select
                value={severity}
                onChange={(event) =>
                  startTransition(() => setSeverity(event.target.value as typeof severity))
                }
              >
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Information</option>
              </select>
            </label>
            <label>
              State
              <select
                value={readState}
                onChange={(event) =>
                  startTransition(() => setReadState(event.target.value as typeof readState))
                }
              >
                <option value="all">Read and unread</option>
                <option value="unread">Unread</option>
                <option value="read">Read</option>
              </select>
            </label>
            <label>
              Category
              <select
                value={selectedCategory}
                onChange={(event) => startTransition(() => setSelectedCategory(event.target.value))}
              >
                <option value="all">All categories</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ol className="notification-list">
            {items.map((notification) => {
              const path = safeRecoveryPath(notification.recoveryAction?.path);
              return (
                <li
                  key={notification.id}
                  data-unread={notification.readAt === null}
                  data-severity={notification.severity}
                >
                  <span className="severity-shape" aria-hidden>
                    {notification.severity === "critical"
                      ? "!"
                      : notification.severity === "warning"
                        ? "△"
                        : "i"}
                  </span>
                  <div>
                    <div className="notification-heading">
                      <strong>{notification.title}</strong>
                      <span>{notification.severity}</span>
                    </div>
                    <p>{notification.body}</p>
                    <small>
                      Occurred {formatDateTime(notification.occurredAt)} · recorded{" "}
                      {formatDateTime(notification.createdAt)}
                    </small>
                    <div className="notification-actions">
                      {path && notification.recoveryAction ? (
                        <a className="button button-primary" href={path}>
                          {notification.recoveryAction.label}
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="button button-quiet"
                        disabled={pending}
                        onClick={() =>
                          void mutate(
                            () =>
                              monitoringApi.markNotification(
                                notification.id,
                                notification.readAt === null,
                              ),
                            notification.readAt === null
                              ? "Notification marked read."
                              : "Notification marked unread.",
                          )
                        }
                      >
                        Mark {notification.readAt === null ? "read" : "unread"}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {items.length === 0 ? (
            <p className="empty-inline">No persisted notifications match these filters.</p>
          ) : null}
          {center.nextCursor ? (
            <p className="bounded-note">
              Older persisted notifications are available through bounded pagination.
            </p>
          ) : null}
        </section>
        <aside className="notification-preferences" aria-label="Browser notification preferences">
          <p className="eyebrow">Optional delivery channel</p>
          <h3>Browser notifications</h3>
          <p>
            Browser delivery is advisory. Permission or quiet hours never change persisted state or
            safe operational suspension.
          </p>
          <dl className="permission-state">
            <div>
              <dt>Permission</dt>
              <dd>{permission}</dd>
            </div>
            <div>
              <dt>In-game inbox</dt>
              <dd>Always persisted</dd>
            </div>
          </dl>
          {permission === "default" ? (
            <button
              type="button"
              className="button button-primary"
              disabled={pending}
              onClick={() => void optIn()}
            >
              Enable browser notifications
            </button>
          ) : null}
          {permission === "denied" ? (
            <p className="operational-callout" data-severity="warning">
              Permission is denied in this browser. Change the site permission to opt in later.
            </p>
          ) : null}
          {permission === "unsupported" ? (
            <p className="operational-callout">
              This browser does not expose notification permission. The in-game inbox is unaffected.
            </p>
          ) : null}
          {permission === "granted" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void savePreferences(preferences, "Browser preferences saved.");
              }}
            >
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={preferences.browserEnabled}
                  onChange={(event) =>
                    setPreferences({ ...preferences, browserEnabled: event.target.checked })
                  }
                />
                <span>
                  <strong>Browser delivery enabled</strong>
                  <small>Persisted items remain regardless of this setting.</small>
                </span>
              </label>
              <label>
                Minimum browser severity
                <select
                  value={preferences.minimumBrowserSeverity}
                  onChange={(event) =>
                    setPreferences({
                      ...preferences,
                      minimumBrowserSeverity: event.target.value as NotificationSeverity,
                    })
                  }
                >
                  <option value="info">Information</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <fieldset>
                <legend>Quiet hours</legend>
                <label>
                  Start
                  <input
                    type="time"
                    value={preferences.quietHours?.start ?? "22:00"}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        quietHours: {
                          start: event.target.value,
                          end: preferences.quietHours?.end ?? "07:00",
                          timeZone:
                            preferences.quietHours?.timeZone ??
                            Intl.DateTimeFormat().resolvedOptions().timeZone,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  End
                  <input
                    type="time"
                    value={preferences.quietHours?.end ?? "07:00"}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        quietHours: {
                          start: preferences.quietHours?.start ?? "22:00",
                          end: event.target.value,
                          timeZone:
                            preferences.quietHours?.timeZone ??
                            Intl.DateTimeFormat().resolvedOptions().timeZone,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Time zone
                  <input
                    value={
                      preferences.quietHours?.timeZone ??
                      Intl.DateTimeFormat().resolvedOptions().timeZone
                    }
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        quietHours: {
                          start: preferences.quietHours?.start ?? "22:00",
                          end: preferences.quietHours?.end ?? "07:00",
                          timeZone: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() =>
                    setPreferences({
                      ...preferences,
                      quietHours: preferences.quietHours
                        ? null
                        : {
                            start: "22:00",
                            end: "07:00",
                            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                          },
                    })
                  }
                >
                  {preferences.quietHours ? "Disable quiet hours" : "Enable quiet hours"}
                </button>
              </fieldset>
              <button className="button button-primary" type="submit" disabled={pending}>
                Save preferences
              </button>
            </form>
          ) : null}
          {message ? (
            <p className="form-status" role="status" aria-live="polite">
              {message}
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
