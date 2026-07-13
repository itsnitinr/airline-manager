import { sql } from "kysely";
import {
  notificationIntentForOutbox,
  NotificationDomainError,
  type NotificationPreferences,
  type NotificationCenter,
  type NotificationCenterQuery,
  type NotificationRepository,
  type PlayerNotification,
  type RecoveryAction,
} from "@airline-manager/domain";
import type { Database } from "../database.js";
import { runInTransaction } from "../transactions.js";

type NotificationRow = Readonly<{
  id: string;
  event_sequence: string;
  event_type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  resource_type: string;
  resource_id: string;
  recovery_action: RecoveryAction | null;
  occurred_at: Date;
  created_at: Date;
  read_at: Date | null;
}>;

const notificationFromRow = (row: NotificationRow): PlayerNotification => ({
  id: row.id,
  eventId: row.event_sequence,
  eventType: row.event_type,
  severity: row.severity,
  title: row.title,
  body: row.body,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  recoveryAction: row.recovery_action,
  occurredAt: row.occurred_at.toISOString(),
  createdAt: row.created_at.toISOString(),
  readAt: row.read_at?.toISOString() ?? null,
});

const projection = sql<NotificationRow>`SELECT notification.id, notification.event_sequence::text,
  intent.event_type, intent.severity, intent.title, intent.body, intent.resource_type,
  intent.resource_id, intent.recovery_action, intent.occurred_at, notification.created_at,
  notification.read_at FROM player_notifications notification
  JOIN notification_intents intent ON intent.id=notification.intent_id`;

export class KyselyNotificationRepository implements NotificationRepository {
  public constructor(private readonly database: Database) {}

  public async consumeOutbox(
    input: Readonly<{
      entityType: string;
      entityId: string;
      expectedVersion: bigint;
      eventType: string;
    }>,
  ): Promise<"applied" | "duplicate" | "noop"> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        const source = await sql<{
          id: string;
          aggregate_type: string;
          aggregate_id: string;
          payload: Record<string, unknown>;
          correlation_id: string;
          causation_id: string;
          occurred_at: Date;
        }>`SELECT id, aggregate_type, aggregate_id, payload, correlation_id, causation_id, occurred_at
          FROM outbox_events WHERE aggregate_type=${input.entityType} AND aggregate_id=${input.entityId}::uuid
            AND aggregate_version=${input.expectedVersion.toString()}::bigint AND event_type=${input.eventType}`.execute(
          transaction,
        );
        const event = source.rows[0];
        if (!event) return "noop";
        const intent = notificationIntentForOutbox({
          eventType: input.eventType,
          aggregateType: event.aggregate_type,
          aggregateId: event.aggregate_id,
          payload: event.payload,
        });
        if (!intent) return "noop";

        const owner = await sql<{ player_account_id: string }>`SELECT player_account_id FROM (
          SELECT ownership.player_account_id FROM resource_ownerships ownership
            WHERE ownership.resource_type=${event.aggregate_type} AND ownership.resource_id=${event.aggregate_id}::uuid
          UNION ALL SELECT ownership.player_account_id FROM dated_flights flight
            JOIN airline_routes route ON route.id=flight.route_id
            JOIN resource_ownerships ownership ON ownership.resource_type='airline' AND ownership.resource_id=route.airline_id
            WHERE ${event.aggregate_type}='dated_flight' AND flight.id=${event.aggregate_id}::uuid
          UNION ALL SELECT ownership.player_account_id FROM aircraft item
            JOIN resource_ownerships ownership ON ownership.resource_type='airline' AND ownership.resource_id=item.operator_airline_id
            WHERE ${event.aggregate_type}='aircraft' AND item.id=${event.aggregate_id}::uuid
          UNION ALL SELECT ownership.player_account_id FROM maintenance_work_packages package
            JOIN aircraft item ON item.id=package.aircraft_id
            JOIN resource_ownerships ownership ON ownership.resource_type='airline' AND ownership.resource_id=item.operator_airline_id
            WHERE ${event.aggregate_type}='maintenance_work_package' AND package.id=${event.aggregate_id}::uuid
          UNION ALL SELECT ownership.player_account_id FROM workforce_pools pool
            JOIN resource_ownerships ownership ON ownership.resource_type='airline' AND ownership.resource_id=pool.airline_id
            WHERE ${event.aggregate_type}='workforce_pool' AND pool.id=${event.aggregate_id}::uuid
          UNION ALL SELECT ownership.player_account_id FROM ledger_books book
            JOIN resource_ownerships ownership ON ownership.resource_type='airline' AND ownership.resource_id=book.owner_id
            WHERE ${event.aggregate_type}='ledger_book' AND book.id=${event.aggregate_id}::uuid AND book.owner_type='airline'
          UNION ALL SELECT account.id FROM player_accounts account
            WHERE ${event.aggregate_type}='player_account' AND account.id=${event.aggregate_id}::uuid
          UNION ALL SELECT account.id FROM player_accounts account
            WHERE ${event.aggregate_type}='security_audit_event'
              AND account.id=(${JSON.stringify(event.payload)}::jsonb->>'playerAccountId')::uuid
        ) owner LIMIT 1`.execute(transaction);
        const playerAccountId = owner.rows[0]?.player_account_id;
        if (!playerAccountId) return "noop";
        const inserted = await sql<{ id: string }>`INSERT INTO notification_intents
          (source_outbox_event_id, player_account_id, event_type, severity, title, body,
           resource_type, resource_id, recovery_action, correlation_id, causation_id, occurred_at)
          VALUES (${event.id}::uuid, ${playerAccountId}::uuid, ${intent.eventType}, ${intent.severity},
            ${intent.title}, ${intent.body}, ${intent.resourceType}, ${intent.resourceId}::uuid,
            ${intent.recoveryAction ? JSON.stringify(intent.recoveryAction) : null}::jsonb,
            ${event.correlation_id}::uuid, ${event.causation_id}::uuid, ${event.occurred_at.toISOString()}::timestamptz)
          ON CONFLICT (source_outbox_event_id) DO NOTHING RETURNING id`.execute(transaction);
        const intentId = inserted.rows[0]?.id;
        if (!intentId) return "duplicate";
        await sql`INSERT INTO player_notifications (intent_id, player_account_id)
          VALUES (${intentId}::uuid, ${playerAccountId}::uuid)`.execute(transaction);
        return "applied";
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public async list(
    playerAccountId: string,
    afterEventId: bigint,
    limit: number,
  ): Promise<readonly PlayerNotification[]> {
    const result = await sql<NotificationRow>`${projection}
      WHERE notification.player_account_id=${playerAccountId}::uuid
        AND notification.event_sequence>${afterEventId.toString()}::bigint
      ORDER BY notification.event_sequence LIMIT ${limit}`.execute(this.database);
    return result.rows.map(notificationFromRow);
  }

  public async markRead(
    playerAccountId: string,
    notificationId: string,
    read: boolean,
  ): Promise<PlayerNotification> {
    const updated =
      await sql`UPDATE player_notifications SET read_at=${read ? sql`CURRENT_TIMESTAMP` : sql`NULL`}
      WHERE id=${notificationId}::uuid AND player_account_id=${playerAccountId}::uuid`.execute(
        this.database,
      );
    if (updated.numAffectedRows !== 1n) throw new NotificationDomainError();
    const result = await sql<NotificationRow>`${projection}
      WHERE notification.id=${notificationId}::uuid AND notification.player_account_id=${playerAccountId}::uuid`.execute(
      this.database,
    );
    return notificationFromRow(result.rows[0]!);
  }

  public async center(
    playerAccountId: string,
    query: NotificationCenterQuery,
  ): Promise<NotificationCenter> {
    const cursor = query.beforeEventId
      ? sql`AND notification.event_sequence<${query.beforeEventId.toString()}::bigint`
      : sql``;
    const severities = query.severities?.length
      ? sql`AND intent.severity=ANY(${query.severities}::text[])`
      : sql``;
    const categories = query.categories?.length
      ? sql`AND split_part(intent.event_type, '.', 1)=ANY(${query.categories}::text[])`
      : sql``;
    const state =
      query.readState === "read"
        ? sql`AND notification.read_at IS NOT NULL`
        : query.readState === "unread"
          ? sql`AND notification.read_at IS NULL`
          : sql``;
    const [items, unread] = await Promise.all([
      sql<NotificationRow>`${projection}
        WHERE notification.player_account_id=${playerAccountId}::uuid
          ${cursor} ${severities} ${categories} ${state}
        ORDER BY notification.event_sequence DESC LIMIT ${query.limit + 1}`.execute(this.database),
      sql<{ count: number }>`SELECT count(*)::integer AS count FROM player_notifications
        WHERE player_account_id=${playerAccountId}::uuid AND read_at IS NULL`.execute(
        this.database,
      ),
    ]);
    const page = items.rows.slice(0, query.limit);
    return {
      asOf: new Date().toISOString(),
      items: page.map(notificationFromRow),
      nextCursor: items.rows.length > query.limit ? (page.at(-1)?.event_sequence ?? null) : null,
      unreadCount: unread.rows[0]?.count ?? 0,
    };
  }

  public async markAllRead(
    playerAccountId: string,
  ): Promise<Readonly<{ updated: number; readAt: string }>> {
    const result = await sql<{ read_at: Date }>`UPDATE player_notifications
      SET read_at=CURRENT_TIMESTAMP WHERE player_account_id=${playerAccountId}::uuid
        AND read_at IS NULL RETURNING read_at`.execute(this.database);
    return {
      updated: Number(result.numAffectedRows ?? 0n),
      readAt: result.rows[0]?.read_at.toISOString() ?? new Date().toISOString(),
    };
  }

  public async preferences(playerAccountId: string): Promise<NotificationPreferences> {
    const result = await sql<{
      browser_enabled: boolean;
      minimum_browser_severity: "info" | "warning" | "critical";
      quiet_hours_start: string | null;
      quiet_hours_end: string | null;
      quiet_hours_time_zone: string | null;
    }>`SELECT browser_enabled, minimum_browser_severity, quiet_hours_start::text,
      quiet_hours_end::text, quiet_hours_time_zone FROM notification_preferences
      WHERE player_account_id=${playerAccountId}::uuid`.execute(this.database);
    const row = result.rows[0];
    if (!row) return { browserEnabled: false, minimumBrowserSeverity: "warning", quietHours: null };
    return {
      browserEnabled: row.browser_enabled,
      minimumBrowserSeverity: row.minimum_browser_severity,
      quietHours:
        row.quiet_hours_start && row.quiet_hours_end && row.quiet_hours_time_zone
          ? {
              start: row.quiet_hours_start.slice(0, 5),
              end: row.quiet_hours_end.slice(0, 5),
              timeZone: row.quiet_hours_time_zone,
            }
          : null,
    };
  }

  public async savePreferences(
    playerAccountId: string,
    preferences: NotificationPreferences,
    at: Date,
  ): Promise<NotificationPreferences> {
    await sql`INSERT INTO notification_preferences
      (player_account_id, browser_enabled, minimum_browser_severity, quiet_hours_start, quiet_hours_end,
       quiet_hours_time_zone, updated_at) VALUES (${playerAccountId}::uuid, ${preferences.browserEnabled},
        ${preferences.minimumBrowserSeverity}, ${preferences.quietHours?.start ?? null}::time,
        ${preferences.quietHours?.end ?? null}::time, ${preferences.quietHours?.timeZone ?? null},
        ${at.toISOString()}::timestamptz)
      ON CONFLICT (player_account_id) DO UPDATE SET browser_enabled=EXCLUDED.browser_enabled,
        minimum_browser_severity=EXCLUDED.minimum_browser_severity,
        quiet_hours_start=EXCLUDED.quiet_hours_start, quiet_hours_end=EXCLUDED.quiet_hours_end,
        quiet_hours_time_zone=EXCLUDED.quiet_hours_time_zone, updated_at=EXCLUDED.updated_at`.execute(
      this.database,
    );
    return this.preferences(playerAccountId);
  }
}
