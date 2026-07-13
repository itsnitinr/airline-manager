import { NotificationService } from "@airline-manager/application";
import type {
  NotificationPreferences,
  NotificationRepository,
  PlayerNotification,
} from "@airline-manager/domain";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "../app.js";

const left = "11111111-1111-4111-8111-111111111111";
const right = "22222222-2222-4222-8222-222222222222";
const item = (eventId: string, player: string): PlayerNotification => ({
  id: `${eventId.padStart(8, "0")}-0000-4000-8000-000000000000`,
  eventId,
  eventType: "flight.arrived",
  severity: "info",
  title: "Flight arrived",
  body: "Persisted arrival.",
  resourceType: "dated_flight",
  resourceId: player,
  recoveryAction: null,
  occurredAt: "2026-07-13T12:00:00.000Z",
  createdAt: "2026-07-13T12:00:00.000Z",
  readAt: null,
});

class MemoryNotifications implements NotificationRepository {
  readonly rows = new Map<string, PlayerNotification[]>([
    [left, [item("1", left), item("2", left)]],
    [right, [item("3", right)]],
  ]);
  readonly settings = new Map<string, NotificationPreferences>();
  async consumeOutbox() {
    return "noop" as const;
  }
  async list(player: string, after: bigint, limit: number) {
    return (this.rows.get(player) ?? [])
      .filter((entry) => BigInt(entry.eventId) > after)
      .slice(0, limit);
  }
  async markRead(player: string, id: string, read: boolean, at: Date) {
    const found = (this.rows.get(player) ?? []).find((entry) => entry.id === id);
    if (!found) throw new Error("Notification is unavailable.");
    return { ...found, readAt: read ? at.toISOString() : null };
  }
  async preferences(player: string) {
    return (
      this.settings.get(player) ?? {
        browserEnabled: false,
        minimumBrowserSeverity: "warning" as const,
        quietHours: null,
      }
    );
  }
  async savePreferences(player: string, preferences: NotificationPreferences) {
    this.settings.set(player, preferences);
    return preferences;
  }
}

let app: FastifyInstance;
let repository: MemoryNotifications;
beforeEach(async () => {
  repository = new MemoryNotifications();
  app = createApiServer({
    logger: false,
    sseHeartbeatMs: 20,
    notificationService: new NotificationService(
      repository,
      () => new Date("2026-07-13T12:30:00Z"),
    ),
    authorizationResolver: async ({ headers }) => {
      const player = typeof headers["x-player"] === "string" ? headers["x-player"] : undefined;
      return player
        ? { authenticated: true, playerAccountId: player, emailVerified: true, roles: ["player"] }
        : { authenticated: false, emailVerified: false, roles: [] };
    },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
});
afterEach(async () => app.close());

async function stream(path: string, player = left, expected: string) {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("TCP address unavailable.");
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    headers: { "x-player": player },
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  let body = "";
  for (let index = 0; index < 8 && !body.includes(expected); index += 1) {
    const chunk = await reader.read();
    body += new TextDecoder().decode(chunk.value);
  }
  controller.abort();
  return { response, body };
}

describe("notification API and recoverable SSE", () => {
  it("replays backlog, resumes by cursor or Last-Event-ID, heartbeats, and never leaks accounts", async () => {
    const backlog = await stream("/v1/events?cursor=0", left, ": heartbeat");
    expect(backlog.response.status).toBe(200);
    expect(backlog.body).toContain("id: 1");
    expect(backlog.body).toContain("id: 2");
    expect(backlog.body).not.toContain("id: 3");
    expect(backlog.body).toContain(": heartbeat");

    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("TCP address unavailable.");
    const controller = new AbortController();
    const resumed = await fetch(`http://127.0.0.1:${address.port}/v1/events`, {
      headers: { "x-player": left, "last-event-id": "1" },
      signal: controller.signal,
    });
    const chunk = new TextDecoder().decode((await resumed.body!.getReader().read()).value);
    controller.abort();
    expect(chunk).not.toContain("id: 1");
    expect(chunk).toContain("id: 2");
  });

  it("supports stale-cursor replay and disconnect/reconnect without duplication", async () => {
    expect(
      (await stream("/v1/events?cursor=0", left, "id: 2")).body.match(/event: notification/g),
    ).toHaveLength(2);
    repository.rows.get(left)!.push(item("4", left));
    const reconnected = await stream("/v1/events?cursor=2", left, "id: 4");
    expect(reconnected.body).not.toContain("id: 1");
    expect(reconnected.body).not.toContain("id: 2");
    expect(reconnected.body).toContain("id: 4");
  });

  it("requires verified authentication and exposes owner-scoped persisted queries", async () => {
    const unauthenticated = await app.inject({ method: "GET", url: "/v1/notifications" });
    expect(unauthenticated.statusCode).toBe(401);
    const owned = await app.inject({
      method: "GET",
      url: "/v1/notifications?cursor=0",
      headers: { "x-player": right },
    });
    expect(owned.json()).toMatchObject({ items: [{ eventId: "3" }], nextCursor: "3" });
  });
});
