export const notificationSeverities = ["info", "warning", "critical"] as const;
export type NotificationSeverity = (typeof notificationSeverities)[number];
export type BrowserPermission = "default" | "denied" | "granted" | "unsupported";

export type RecoveryAction = Readonly<{
  label: string;
  resourceType: string;
  resourceId: string;
  path: string;
}>;

export type NotificationIntent = Readonly<{
  eventType: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string;
  recoveryAction: RecoveryAction | null;
}>;

export type NotificationPreferences = Readonly<{
  browserEnabled: boolean;
  minimumBrowserSeverity: NotificationSeverity;
  quietHours: Readonly<{ start: string; end: string; timeZone: string }> | null;
}>;

export type PlayerNotification = Readonly<{
  id: string;
  eventId: string;
  eventType: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string;
  recoveryAction: RecoveryAction | null;
  occurredAt: string;
  createdAt: string;
  readAt: string | null;
}>;

export const notificationCategories = [
  "flight",
  "fuel",
  "maintenance",
  "workforce",
  "finance",
  "aircraft",
  "account",
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];
export type NotificationCenterQuery = Readonly<{
  beforeEventId?: bigint;
  limit: number;
  severities?: readonly NotificationSeverity[];
  categories?: readonly NotificationCategory[];
  readState?: "all" | "read" | "unread";
}>;
export type NotificationCenter = Readonly<{
  asOf: string;
  items: readonly PlayerNotification[];
  nextCursor: string | null;
  unreadCount: number;
}>;

export interface NotificationRepository {
  consumeOutbox(
    input: Readonly<{
      entityType: string;
      entityId: string;
      expectedVersion: bigint;
      eventType: string;
    }>,
  ): Promise<"applied" | "duplicate" | "noop">;
  list(
    playerAccountId: string,
    afterEventId: bigint,
    limit: number,
  ): Promise<readonly PlayerNotification[]>;
  markRead(
    playerAccountId: string,
    notificationId: string,
    read: boolean,
  ): Promise<PlayerNotification>;
  center(playerAccountId: string, query: NotificationCenterQuery): Promise<NotificationCenter>;
  markAllRead(playerAccountId: string): Promise<Readonly<{ updated: number; readAt: string }>>;
  preferences(playerAccountId: string): Promise<NotificationPreferences>;
  savePreferences(
    playerAccountId: string,
    preferences: NotificationPreferences,
    at: Date,
  ): Promise<NotificationPreferences>;
}

export class NotificationDomainError extends Error {
  readonly code = "notification_not_found";
  public constructor() {
    super("Notification is unavailable.");
    this.name = "NotificationDomainError";
  }
}

const severityRank: Readonly<Record<NotificationSeverity, number>> = {
  info: 0,
  warning: 1,
  critical: 2,
};
const timePattern = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

export function validateNotificationPreferences(input: NotificationPreferences): void {
  if (!notificationSeverities.includes(input.minimumBrowserSeverity)) {
    throw new Error("Notification severity preference is invalid.");
  }
  if (!input.quietHours) return;
  if (!timePattern.test(input.quietHours.start) || !timePattern.test(input.quietHours.end)) {
    throw new Error("Quiet hours must use HH:mm in 24-hour time.");
  }
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: input.quietHours.timeZone }).format(new Date());
  } catch {
    throw new Error("Quiet-hours time zone is invalid.");
  }
}

function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

const configuredMinutes = (value: string) => {
  const match = timePattern.exec(value);
  if (!match) throw new Error("Quiet hours must use HH:mm in 24-hour time.");
  return Number(match[1]) * 60 + Number(match[2]);
};

export function isWithinQuietHours(at: Date, preferences: NotificationPreferences): boolean {
  validateNotificationPreferences(preferences);
  const quiet = preferences.quietHours;
  if (!quiet) return false;
  const current = localMinutes(at, quiet.timeZone);
  const start = configuredMinutes(quiet.start);
  const end = configuredMinutes(quiet.end);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function browserDeliveryDecision(
  input: Readonly<{
    severity: NotificationSeverity;
    permission: BrowserPermission;
    preferences: NotificationPreferences;
    at: Date;
  }>,
): "deliver" | "disabled" | "permission_denied" | "unsupported" | "below_severity" | "quiet_hours" {
  validateNotificationPreferences(input.preferences);
  if (!input.preferences.browserEnabled) return "disabled";
  if (input.permission === "unsupported") return "unsupported";
  if (input.permission !== "granted") return "permission_denied";
  if (severityRank[input.severity] < severityRank[input.preferences.minimumBrowserSeverity]) {
    return "below_severity";
  }
  return isWithinQuietHours(input.at, input.preferences) ? "quiet_hours" : "deliver";
}

const stringValue = (payload: Readonly<Record<string, unknown>>, key: string) =>
  typeof payload[key] === "string" ? payload[key] : undefined;

export function notificationIntentForOutbox(
  input: Readonly<{
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Readonly<Record<string, unknown>>;
  }>,
): NotificationIntent | null {
  const resourceId =
    stringValue(input.payload, "flightId") ??
    stringValue(input.payload, "aircraftId") ??
    stringValue(input.payload, "airlineId") ??
    stringValue(input.payload, "playerAccountId") ??
    input.aggregateId;
  if (input.eventType === "flight.state_changed.v1") {
    const state = stringValue(input.payload, "to");
    const reason = stringValue(input.payload, "reasonCode") ?? "state_changed";
    const definitions: Readonly<Record<string, readonly [NotificationSeverity, string]>> = {
      delayed: ["warning", "Flight delayed"],
      suspended: ["critical", "Flight suspended"],
      cancelled: ["critical", "Flight cancelled"],
      arrived: ["info", "Flight arrived"],
      settled: ["info", "Flight settled"],
    };
    const definition = state ? definitions[state] : undefined;
    if (!definition) return null;
    const resourceEventType =
      state === "suspended" && reason.includes("fuel")
        ? "fuel.shortage"
        : state === "suspended" && reason.includes("workforce")
          ? "workforce.shortage"
          : state === "suspended" && reason.includes("maintenance")
            ? "maintenance.blocking"
            : `flight.${state}`;
    return {
      eventType: resourceEventType,
      severity: definition[0],
      title: definition[1],
      body: `The persisted flight lifecycle entered ${state} (${reason}).`,
      resourceType: "dated_flight",
      resourceId,
      recoveryAction:
        state === "suspended" || state === "cancelled"
          ? {
              label: "Review recovery",
              resourceType: "dated_flight",
              resourceId,
              path: `/app?view=operations&flight=${resourceId}`,
            }
          : null,
    };
  }
  const exact: Readonly<Record<string, readonly [NotificationSeverity, string, string]>> = {
    "aircraft.delivered.v1": ["info", "Aircraft delivered", "aircraft"],
    "maintenance.due.v1": ["warning", "Aircraft maintenance due", "aircraft"],
    "maintenance.fault_discovered.v1": ["critical", "Aircraft fault discovered", "aircraft"],
    "maintenance.work_due.v1": ["warning", "Maintenance work due", "maintenance_work_package"],
    "workforce.training_due.v1": ["warning", "Workforce capacity pending", "workforce_pool"],
    "account.registered.v1": ["info", "Account created", "player_account"],
    "account.email_verified.v1": ["info", "Account verified", "player_account"],
    "account.password_reset.v1": ["warning", "Password reset completed", "player_account"],
  };
  if (input.eventType === "finance.journal_posted.v1") {
    const commandType = stringValue(input.payload, "commandType") ?? "";
    if (!/(loan|lease|wage|obligation)/i.test(commandType)) return null;
    return {
      eventType: "finance.obligation_posted",
      severity: "warning",
      title: "Financial obligation posted",
      body: "A persisted financial obligation was posted to the authoritative ledger.",
      resourceType: "ledger_book",
      resourceId,
      recoveryAction: {
        label: "Review finances",
        resourceType: "ledger_book",
        resourceId,
        path: "/app?view=finance",
      },
    };
  }
  const definition = exact[input.eventType];
  if (definition) {
    return {
      eventType: input.eventType.replace(/\.v1$/, ""),
      severity: definition[0],
      title: definition[1],
      body: `${definition[1]} was recorded in authoritative persisted state.`,
      resourceType: definition[2],
      resourceId,
      recoveryAction:
        definition[0] !== "info"
          ? {
              label: "Review details",
              resourceType: definition[2],
              resourceId,
              path:
                definition[2] === "aircraft"
                  ? `/app?view=maintenance&aircraft=${resourceId}`
                  : definition[2] === "workforce_pool"
                    ? "/app?view=workforce"
                    : "/app?view=notifications",
            }
          : null,
    };
  }
  return null;
}
