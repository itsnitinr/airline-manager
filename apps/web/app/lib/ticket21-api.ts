import type {
  FinanceOverview,
  FinanceStatements,
  FlightStatus,
  JournalPage,
  NotificationCenter,
  NotificationPreferences,
  PlayerNotification,
  SettledFlightSnapshot,
} from "@airline-manager/domain";
import { browserFetch } from "./client-api";

export const monitoringApi = {
  flightStatus: (airlineId: string, flightId: string) =>
    browserFetch<FlightStatus>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/flights/${encodeURIComponent(flightId)}/status`,
    ),
  flightSettlement: (airlineId: string, flightId: string) =>
    browserFetch<SettledFlightSnapshot>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/flights/${encodeURIComponent(flightId)}/settlement`,
    ),
  financeOverview: (airlineId: string) =>
    browserFetch<FinanceOverview>(`/v1/airlines/${encodeURIComponent(airlineId)}/finance/overview`),
  financeStatements: (airlineId: string, from: string, to: string) =>
    browserFetch<FinanceStatements>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/finance/statements?${new URLSearchParams({ from, to })}`,
    ),
  journals: (airlineId: string, cursor = 0, limit = 25) =>
    browserFetch<JournalPage>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/finance/journals?cursor=${cursor}&limit=${limit}`,
    ),
  notificationCenter: (query = "") =>
    browserFetch<NotificationCenter>(`/v1/notification-center${query ? `?${query}` : ""}`),
  markNotification: (notificationId: string, read: boolean) =>
    browserFetch<PlayerNotification>(
      `/v1/notifications/${encodeURIComponent(notificationId)}/read`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read }),
      },
    ),
  markAllNotifications: () =>
    browserFetch<{ updated: number; readAt: string }>("/v1/notifications/read-all", {
      method: "POST",
    }),
  saveNotificationPreferences: (preferences: NotificationPreferences) =>
    browserFetch<NotificationPreferences>("/v1/notification-preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(preferences),
    }),
};
