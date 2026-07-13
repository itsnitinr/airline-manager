import {
  browserDeliveryDecision,
  type BrowserPermission,
  type NotificationPreferences,
  type PlayerNotification,
} from "@airline-manager/domain";

export type BrowserNotificationApi = Readonly<{
  permission: BrowserPermission;
  requestPermission(): Promise<BrowserPermission>;
  show(
    title: string,
    options: Readonly<{ body: string; tag: string; data: Readonly<{ path: string | null }> }>,
  ): void;
}>;

export class BrowserNotificationController {
  public constructor(private readonly api: BrowserNotificationApi | null) {}

  public async optIn(explicitPlayerAction: boolean): Promise<BrowserPermission> {
    if (!this.api) return "unsupported";
    if (!explicitPlayerAction) return this.api.permission;
    return this.api.requestPermission();
  }

  public deliver(
    notification: PlayerNotification,
    preferences: NotificationPreferences,
    at = new Date(),
  ) {
    const permission = this.api?.permission ?? "unsupported";
    const decision = browserDeliveryDecision({
      severity: notification.severity,
      permission,
      preferences,
      at,
    });
    if (decision !== "deliver" || !this.api) return decision;
    this.api.show(notification.title, {
      body: notification.body,
      tag: `airline-manager-notification-${notification.id}`,
      data: { path: notification.recoveryAction?.path ?? null },
    });
    return decision;
  }
}

export function browserNotificationApi(): BrowserNotificationApi | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  return {
    get permission() {
      return window.Notification.permission;
    },
    requestPermission: () => window.Notification.requestPermission(),
    show: (title, options) => {
      new window.Notification(title, options);
    },
  };
}
