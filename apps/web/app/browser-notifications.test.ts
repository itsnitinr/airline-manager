import { describe, expect, it, vi } from "vitest";
import {
  BrowserNotificationController,
  type BrowserNotificationApi,
} from "./browser-notifications";

const item = {
  id: "11111111-1111-4111-8111-111111111111",
  eventId: "1",
  eventType: "flight.suspended",
  severity: "critical" as const,
  title: "Flight suspended",
  body: "Restore fuel.",
  resourceType: "dated_flight",
  resourceId: "22222222-2222-4222-8222-222222222222",
  recoveryAction: {
    label: "Review",
    resourceType: "dated_flight",
    resourceId: "22222222-2222-4222-8222-222222222222",
    path: "/flights/22222222-2222-4222-8222-222222222222",
  },
  occurredAt: "2026-07-13T12:00:00.000Z",
  createdAt: "2026-07-13T12:00:00.000Z",
  readAt: null,
};

describe("browser notification plumbing", () => {
  it("requests permission only after explicit opt-in and denial does not affect persisted items", async () => {
    const requestPermission = vi.fn(async () => "denied" as const);
    const api: BrowserNotificationApi = { permission: "default", requestPermission, show: vi.fn() };
    const controller = new BrowserNotificationController(api);
    expect(await controller.optIn(false)).toBe("default");
    expect(requestPermission).not.toHaveBeenCalled();
    expect(await controller.optIn(true)).toBe("denied");
    expect(
      controller.deliver(item, {
        browserEnabled: true,
        minimumBrowserSeverity: "warning",
        quietHours: null,
      }),
    ).toBe("permission_denied");
  });

  it("honors severity and quiet hours before browser delivery", () => {
    const show = vi.fn();
    const controller = new BrowserNotificationController({
      permission: "granted",
      requestPermission: vi.fn(),
      show,
    });
    expect(
      controller.deliver(
        item,
        {
          browserEnabled: true,
          minimumBrowserSeverity: "critical",
          quietHours: { start: "22:00", end: "07:00", timeZone: "UTC" },
        },
        new Date("2026-07-13T23:00:00Z"),
      ),
    ).toBe("quiet_hours");
    expect(show).not.toHaveBeenCalled();
    expect(
      controller.deliver(item, {
        browserEnabled: true,
        minimumBrowserSeverity: "critical",
        quietHours: null,
      }),
    ).toBe("deliver");
    expect(show).toHaveBeenCalledOnce();
  });
});
