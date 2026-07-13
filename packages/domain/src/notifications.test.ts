import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  browserDeliveryDecision,
  isWithinQuietHours,
  notificationIntentForOutbox,
  notificationSeverities,
  validateNotificationPreferences,
} from "./notifications.js";

describe("notifications", () => {
  it("orders browser severity preferences monotonically", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...notificationSeverities),
        fc.constantFrom(...notificationSeverities),
        (severity, minimumBrowserSeverity) => {
          const decision = browserDeliveryDecision({
            severity,
            permission: "granted",
            preferences: { browserEnabled: true, minimumBrowserSeverity, quietHours: null },
            at: new Date("2026-07-13T12:00:00Z"),
          });
          expect(decision === "deliver").toBe(
            notificationSeverities.indexOf(severity) >=
              notificationSeverities.indexOf(minimumBrowserSeverity),
          );
        },
      ),
    );
  });

  it("supports overnight quiet hours and keeps permission denial advisory", () => {
    const preferences = {
      browserEnabled: true,
      minimumBrowserSeverity: "info" as const,
      quietHours: { start: "22:00", end: "07:00", timeZone: "UTC" },
    };
    expect(isWithinQuietHours(new Date("2026-07-13T23:00:00Z"), preferences)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-07-13T12:00:00Z"), preferences)).toBe(false);
    expect(
      browserDeliveryDecision({
        severity: "critical",
        permission: "denied",
        preferences,
        at: new Date("2026-07-13T12:00:00Z"),
      }),
    ).toBe("permission_denied");
  });

  it("validates time zones and maps actionable lifecycle events", () => {
    expect(() =>
      validateNotificationPreferences({
        browserEnabled: true,
        minimumBrowserSeverity: "warning",
        quietHours: { start: "25:00", end: "07:00", timeZone: "UTC" },
      }),
    ).toThrow();
    expect(
      notificationIntentForOutbox({
        eventType: "flight.state_changed.v1",
        aggregateType: "dated_flight",
        aggregateId: "11111111-1111-4111-8111-111111111111",
        payload: { to: "suspended", reasonCode: "insufficient_fuel" },
      }),
    ).toMatchObject({
      severity: "critical",
      eventType: "fuel.shortage",
      recoveryAction: { label: "Review recovery" },
    });
  });
});
