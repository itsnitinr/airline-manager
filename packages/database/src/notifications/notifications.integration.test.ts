import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readDatabasePoolOptions } from "../config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import { KyselyNotificationRepository } from "./repository.js";

let runtime: DatabaseRuntime;
let repository: KyselyNotificationRepository;

beforeAll(() => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
  repository = new KyselyNotificationRepository(runtime.database);
});
beforeEach(async () => {
  await sql`TRUNCATE auth_user, outbox_events CASCADE`.execute(runtime.database);
});
afterAll(async () => runtime.destroy());

async function player(email: string) {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Notification Test', ${email}, true) RETURNING id`.execute(runtime.database);
  const account = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id=${user.rows[0]!.id}::uuid`.execute(runtime.database);
  return account.rows[0]!.id;
}

async function suspensionEvent(playerAccountId: string) {
  const airlineId = randomUUID();
  await sql`INSERT INTO resource_ownerships (resource_type, resource_id, player_account_id)
    VALUES ('airline', ${airlineId}::uuid, ${playerAccountId}::uuid)`.execute(runtime.database);
  await sql`INSERT INTO outbox_events (aggregate_type, aggregate_id, aggregate_version, event_type, payload)
    VALUES ('airline', ${airlineId}::uuid, 1, 'flight.state_changed.v1',
      ${JSON.stringify({ airlineId, flightId: randomUUID(), to: "suspended", reasonCode: "insufficient_fuel" })}::jsonb)`.execute(
    runtime.database,
  );
  return {
    entityType: "airline",
    entityId: airlineId,
    expectedVersion: 1n,
    eventType: "flight.state_changed.v1",
  };
}

describe("PostgreSQL notification projection", () => {
  it("creates account outbox work transactionally from security audit events", async () => {
    const owner = await player("notification-account@example.test");
    const audit = await sql<{ id: string }>`INSERT INTO security_audit_events
      (event_type, player_account_id, target_type, target_identifier, outcome)
      VALUES ('account.password_reset', ${owner}::uuid, 'player_account', ${owner}, 'succeeded')
      RETURNING id`.execute(runtime.database);
    const event = await sql<{
      aggregate_type: string;
      aggregate_id: string;
      aggregate_version: string;
      event_type: string;
    }>`SELECT aggregate_type, aggregate_id, aggregate_version::text, event_type
      FROM outbox_events WHERE aggregate_id=${audit.rows[0]!.id}::uuid`.execute(runtime.database);
    expect(event.rows[0]).toEqual({
      aggregate_type: "security_audit_event",
      aggregate_id: audit.rows[0]!.id,
      aggregate_version: "1",
      event_type: "account.password_reset.v1",
    });
    expect(
      await repository.consumeOutbox({
        entityType: "security_audit_event",
        entityId: audit.rows[0]!.id,
        expectedVersion: 1n,
        eventType: "account.password_reset.v1",
      }),
    ).toBe("applied");
    expect(await repository.list(owner, 0n, 10)).toMatchObject([
      { eventType: "account.password_reset", resourceId: owner, severity: "warning" },
    ]);
  });

  it("creates exactly one notification under concurrent duplicate and replayed delivery", async () => {
    const owner = await player("notification-owner@example.test");
    const event = await suspensionEvent(owner);
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => repository.consumeOutbox(event)),
    );
    expect(outcomes.filter((outcome) => outcome === "applied")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "duplicate")).toHaveLength(7);
    expect(await repository.consumeOutbox(event)).toBe("duplicate");
    expect(await repository.list(owner, 0n, 100)).toHaveLength(1);
    const counts = await sql<{ intents: string; notifications: string }>`SELECT
      (SELECT count(*)::text FROM notification_intents) intents,
      (SELECT count(*)::text FROM player_notifications) notifications`.execute(runtime.database);
    expect(counts.rows[0]).toEqual({ intents: "1", notifications: "1" });
  });

  it("isolates ownership, resumable cursors, read state, recovery actions, and preferences", async () => {
    const owner = await player("notification-left@example.test");
    const foreign = await player("notification-right@example.test");
    await repository.consumeOutbox(await suspensionEvent(owner));
    const [notification] = await repository.list(owner, 0n, 10);
    expect(notification).toMatchObject({
      severity: "critical",
      readAt: null,
      recoveryAction: { label: "Review recovery" },
    });
    expect(await repository.list(owner, BigInt(notification!.eventId), 10)).toEqual([]);
    expect(await repository.list(foreign, 0n, 10)).toEqual([]);
    await expect(repository.markRead(foreign, notification!.id, true)).rejects.toThrow(
      "unavailable",
    );
    const read = await repository.markRead(owner, notification!.id, true);
    expect(read.readAt).not.toBeNull();
    expect(new Date(read.readAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(read.createdAt).getTime(),
    );
    expect((await repository.markRead(owner, notification!.id, true)).readAt).not.toBeNull();
    expect(await repository.markRead(owner, notification!.id, false)).toMatchObject({
      readAt: null,
    });
    expect(await repository.center(owner, { limit: 10, readState: "unread" })).toMatchObject({
      unreadCount: 1,
      items: [{ id: notification!.id }],
      nextCursor: null,
    });
    expect(await repository.center(foreign, { limit: 10 })).toMatchObject({
      unreadCount: 0,
      items: [],
    });
    expect(await repository.markAllRead(owner)).toMatchObject({ updated: 1 });
    expect(await repository.markAllRead(owner)).toMatchObject({ updated: 0 });
    expect(
      await repository.savePreferences(
        owner,
        {
          browserEnabled: true,
          minimumBrowserSeverity: "critical",
          quietHours: { start: "22:00", end: "07:00", timeZone: "UTC" },
        },
        new Date(),
      ),
    ).toEqual({
      browserEnabled: true,
      minimumBrowserSeverity: "critical",
      quietHours: { start: "22:00", end: "07:00", timeZone: "UTC" },
    });
  });
});
