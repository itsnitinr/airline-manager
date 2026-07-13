import { randomUUID } from "node:crypto";
import {
  authorizeReplay,
  parseJobEnvelope,
  redactDiagnostic,
  retryBackoffMilliseconds,
  type JobEnvelopeV1,
  type ReplayAuthorization,
} from "@airline-manager/application";
import { sql } from "kysely";
import type { Database } from "../database.js";
import { runInTransaction } from "../transactions.js";

export type ClaimedOutbox = Readonly<{ id: string; envelope: JobEnvelopeV1 }>;
export type MilestoneRegistration = Omit<JobEnvelopeV1, "envelopeVersion">;

type RuntimeRow = Readonly<Record<string, unknown>>;

function envelopeFromRow(row: RuntimeRow, source: string): JobEnvelopeV1 {
  const target = row.target_time ?? row.available_at;
  if (!(target instanceof Date)) throw new Error("Runtime target time was not decoded as a Date.");
  return parseJobEnvelope({
    envelopeVersion: 1,
    commandId: row.command_id,
    entityId: row.entity_id ?? row.aggregate_id,
    entityType: row.entity_type ?? row.aggregate_type,
    expectedVersion: String(row.expected_version ?? row.aggregate_version),
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    targetTime: target.toISOString(),
    handlerKind: row.handler_kind,
    handlerVersion: row.handler_version,
    routing: row.event_type ? { source, eventType: String(row.event_type) } : { source },
  });
}

export class KyselyRuntimeRepository {
  constructor(readonly database: Database) {}

  async claimOutbox(
    input: Readonly<{ owner: string; now: Date; leaseMilliseconds: number; limit: number }>,
  ): Promise<ClaimedOutbox[]> {
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMilliseconds);
    const result = await sql<RuntimeRow>`WITH candidates AS (
      SELECT id FROM outbox_events
      WHERE published_at IS NULL AND failed_at IS NULL
        AND available_at <= ${input.now.toISOString()}::timestamptz
        AND next_attempt_at <= ${input.now.toISOString()}::timestamptz
        AND (lease_expires_at IS NULL OR lease_expires_at <= ${input.now.toISOString()}::timestamptz)
      ORDER BY next_attempt_at, occurred_at, id
      LIMIT ${input.limit} FOR UPDATE SKIP LOCKED
    ) UPDATE outbox_events event SET lease_owner = ${input.owner},
        lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
        attempt_count = event.attempt_count + 1
      FROM candidates WHERE event.id = candidates.id RETURNING event.*`.execute(this.database);
    return result.rows.map((row) => ({
      id: row.id as string,
      envelope: envelopeFromRow(row, "outbox"),
    }));
  }

  async markOutboxPublished(
    id: string,
    owner: string,
    now: Date,
    retentionMilliseconds: number,
  ): Promise<boolean> {
    const retainedUntil = new Date(now.getTime() + retentionMilliseconds);
    const result =
      await sql`UPDATE outbox_events SET published_at = ${now.toISOString()}::timestamptz,
      retained_until = ${retainedUntil.toISOString()}::timestamptz, lease_owner = NULL,
      lease_expires_at = NULL, last_error = NULL WHERE id = ${id}::uuid AND lease_owner = ${owner}`.execute(
        this.database,
      );
    return result.numAffectedRows === 1n;
  }

  async releaseOutbox(
    id: string,
    owner: string,
    error: unknown,
    now: Date,
    maximumAttempts: number,
  ): Promise<void> {
    const diagnostic = JSON.stringify(
      redactDiagnostic({ message: error instanceof Error ? error.message : String(error) }),
    );
    await runInTransaction(this.database, async (transaction) => {
      const current = await sql<{ attempt_count: number }>`SELECT attempt_count FROM outbox_events
        WHERE id = ${id}::uuid AND lease_owner = ${owner} FOR UPDATE`.execute(transaction);
      const attempts = current.rows[0]?.attempt_count;
      if (attempts === undefined) return;
      const exhausted = attempts >= maximumAttempts;
      const nextAttempt = new Date(now.getTime() + retryBackoffMilliseconds(attempts));
      await sql`UPDATE outbox_events SET lease_owner = NULL, lease_expires_at = NULL,
        failure_count = failure_count + 1, last_error = ${diagnostic},
        next_attempt_at = ${nextAttempt.toISOString()}::timestamptz,
        failed_at = ${exhausted ? now.toISOString() : null}::timestamptz
        WHERE id = ${id}::uuid AND lease_owner = ${owner}`.execute(transaction);
    });
  }

  async releaseOwnerLeases(owner: string): Promise<number> {
    const result = await sql`UPDATE outbox_events SET lease_owner = NULL, lease_expires_at = NULL
      WHERE lease_owner = ${owner} AND published_at IS NULL`.execute(this.database);
    const milestones =
      await sql`UPDATE simulation_milestones SET lease_owner = NULL, lease_expires_at = NULL
      WHERE lease_owner = ${owner} AND state = 'pending'`.execute(this.database);
    return Number((result.numAffectedRows ?? 0n) + (milestones.numAffectedRows ?? 0n));
  }

  async registerMilestone(input: MilestoneRegistration): Promise<string> {
    const row = await sql<{ id: string }>`INSERT INTO simulation_milestones
      (entity_type, entity_id, expected_version, handler_kind, handler_version, target_time,
       command_id, correlation_id, causation_id, routing)
      VALUES (${input.entityType}, ${input.entityId}::uuid, ${input.expectedVersion}::bigint,
        ${input.handlerKind}, ${input.handlerVersion}, ${input.targetTime}::timestamptz,
        ${input.commandId}::uuid, ${input.correlationId}::uuid, ${input.causationId}::uuid,
        ${JSON.stringify(input.routing)}::jsonb)
      ON CONFLICT (entity_type, entity_id, expected_version, handler_kind, handler_version, target_time)
      DO UPDATE SET updated_at = simulation_milestones.updated_at RETURNING id`.execute(
      this.database,
    );
    return row.rows[0]!.id;
  }

  async synchronizeExistingIntents(): Promise<number> {
    const result = await sql<{ inserted: string }>`WITH inserted AS (
      INSERT INTO simulation_milestones
        (entity_type, entity_id, expected_version, handler_kind, handler_version, target_time,
         command_id, correlation_id, causation_id, routing)
      SELECT source.entity_type, source.entity_id, source.expected_version, source.handler_kind, 1,
        source.target_time, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), source.routing
      FROM (
        SELECT 'aircraft'::text entity_type, id entity_id, version expected_version,
          'aircraft.delivery'::text handler_kind, delivery_target_at target_time,
          jsonb_build_object('source', 'aircraft_delivery') routing
        FROM aircraft WHERE delivery_state = 'pending'
        UNION ALL
        SELECT 'workforce_pool', workforce_pool_id, 1, intent_type, available_at,
          jsonb_build_object('source', 'workforce_checkpoint') FROM workforce_checkpoint_intents
        UNION ALL
        SELECT 'aircraft', aircraft_id, 1, intent_type, available_at,
          jsonb_build_object('source', 'maintenance_checkpoint') FROM maintenance_checkpoint_intents
        UNION ALL
        SELECT scope, scope_id, 1, intent_type, available_at,
          jsonb_build_object('source', 'weather_snapshot') FROM weather_snapshot_intents
        UNION ALL
        SELECT 'dated_flight', flight.id, flight.version,
          CASE
            WHEN flight.status = 'scheduled' THEN 'flight.booking_lock'
            WHEN flight.status IN ('boarding','suspended','delayed') THEN 'flight.dispatch'
            WHEN flight.status IN ('departed','diverted') THEN 'flight.arrival'
            ELSE 'flight.settlement'
          END,
          CASE
            WHEN flight.status = 'scheduled' THEN flight.departure_at - INTERVAL '30 minutes'
            WHEN flight.status IN ('boarding','suspended','delayed')
              THEN COALESCE(flight.suspension_next_retry_at, flight.departure_at)
            WHEN flight.status IN ('departed','diverted')
              THEN COALESCE(flight.actual_departure_at, flight.departure_at)
                + COALESCE(result.realized_block_minutes, flight.planned_block_minutes) * INTERVAL '1 minute'
            ELSE COALESCE(flight.actual_arrival_at, flight.state_effective_at)
          END,
          jsonb_build_object('source', 'flight_lifecycle')
        FROM dated_flights flight
        LEFT JOIN flight_operational_results result ON result.flight_id = flight.id
        WHERE flight.status <> 'settled'
      ) source
      ON CONFLICT (entity_type, entity_id, expected_version, handler_kind, handler_version, target_time)
      DO NOTHING RETURNING 1
    ) SELECT count(*)::text inserted FROM inserted`.execute(this.database);
    return Number(result.rows[0]?.inserted ?? 0);
  }

  async claimDueMilestones(
    input: Readonly<{
      owner: string;
      now: Date;
      overdueBefore: Date;
      leaseMilliseconds: number;
      limit: number;
    }>,
  ): Promise<JobEnvelopeV1[]> {
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMilliseconds);
    const result = await sql<RuntimeRow>`WITH candidates AS (
      SELECT id FROM simulation_milestones WHERE state = 'pending'
        AND target_time <= ${input.overdueBefore.toISOString()}::timestamptz
        AND (lease_expires_at IS NULL OR lease_expires_at <= ${input.now.toISOString()}::timestamptz)
      ORDER BY target_time, id LIMIT ${input.limit} FOR UPDATE SKIP LOCKED
    ) UPDATE simulation_milestones milestone SET lease_owner = ${input.owner},
      lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
      attempt_count = milestone.attempt_count + 1, last_attempt_at = ${input.now.toISOString()}::timestamptz,
      updated_at = ${input.now.toISOString()}::timestamptz FROM candidates
      WHERE milestone.id = candidates.id RETURNING milestone.*`.execute(this.database);
    return result.rows.map((row) => envelopeFromRow(row, "reconciliation"));
  }

  async releaseMilestone(envelope: JobEnvelopeV1, owner: string): Promise<void> {
    await sql`UPDATE simulation_milestones SET lease_owner = NULL, lease_expires_at = NULL
      WHERE entity_type = ${envelope.entityType} AND entity_id = ${envelope.entityId}::uuid
        AND expected_version = ${envelope.expectedVersion}::bigint AND handler_kind = ${envelope.handlerKind}
        AND handler_version = ${envelope.handlerVersion} AND target_time = ${envelope.targetTime}::timestamptz
        AND lease_owner = ${owner}`.execute(this.database);
  }

  async markMilestoneApplied(envelope: JobEnvelopeV1, now: Date): Promise<void> {
    await sql`UPDATE simulation_milestones SET state = 'applied', applied_at = ${now.toISOString()}::timestamptz,
      updated_at = ${now.toISOString()}::timestamptz, lease_owner = NULL, lease_expires_at = NULL
      WHERE entity_type = ${envelope.entityType} AND entity_id = ${envelope.entityId}::uuid
        AND expected_version = ${envelope.expectedVersion}::bigint AND handler_kind = ${envelope.handlerKind}
        AND handler_version = ${envelope.handlerVersion} AND target_time = ${envelope.targetTime}::timestamptz`.execute(
      this.database,
    );
  }

  async recordDeadLetter(
    input: Readonly<{
      jobId: string;
      queueName: string;
      classification: "permanent" | "unsupported" | "exhausted";
      envelope?: JobEnvelopeV1;
      diagnostic: unknown;
      now: Date;
      retentionMilliseconds: number;
    }>,
  ): Promise<string> {
    const expiresAt = new Date(input.now.getTime() + input.retentionMilliseconds);
    const result = await sql<{ id: string }>`INSERT INTO worker_dead_letters
      (job_id, queue_name, command_id, entity_type, entity_id, handler_kind, handler_version,
       envelope_version, envelope, classification, diagnostic, failed_at, expires_at)
      VALUES (${input.jobId}, ${input.queueName}, ${input.envelope?.commandId ?? null}::uuid,
        ${input.envelope?.entityType ?? null}, ${input.envelope?.entityId ?? null}::uuid,
        ${input.envelope?.handlerKind ?? null}, ${input.envelope?.handlerVersion ?? null},
        ${input.envelope?.envelopeVersion ?? null}, ${input.envelope ? JSON.stringify(input.envelope) : null}::jsonb,
        ${input.classification},
        ${JSON.stringify(redactDiagnostic(input.diagnostic))}::jsonb, ${input.now.toISOString()}::timestamptz,
        ${expiresAt.toISOString()}::timestamptz)
      ON CONFLICT (queue_name, job_id) DO UPDATE SET diagnostic = EXCLUDED.diagnostic
      RETURNING id`.execute(this.database);
    return result.rows[0]!.id;
  }

  async listDeadLetters(limit = 100): Promise<RuntimeRow[]> {
    const result = await sql<RuntimeRow>`SELECT id, job_id, queue_name, command_id, entity_type,
      entity_id, handler_kind, handler_version, envelope_version, classification, diagnostic,
      failed_at, expires_at, replayed_at FROM worker_dead_letters ORDER BY failed_at DESC, id LIMIT ${limit}`.execute(
      this.database,
    );
    return result.rows;
  }

  async getDeadLetterEnvelope(id: string): Promise<JobEnvelopeV1> {
    const result = await sql<{ envelope: unknown }>`SELECT envelope FROM worker_dead_letters
      WHERE id = ${id}::uuid AND expires_at > CURRENT_TIMESTAMP`.execute(this.database);
    return parseJobEnvelope(result.rows[0]?.envelope);
  }

  async auditReplay(
    deadLetterId: string,
    authorization: ReplayAuthorization,
    replayJobId: string,
  ): Promise<void> {
    authorizeReplay(authorization);
    await runInTransaction(this.database, async (transaction) => {
      await sql`INSERT INTO worker_replay_audits
        (request_id, dead_letter_id, actor_identifier, reason, replay_job_id)
        VALUES (${authorization.requestId}::uuid, ${deadLetterId}::uuid, ${authorization.actorIdentifier},
          ${authorization.reason.trim()}, ${replayJobId})`.execute(transaction);
      await sql`UPDATE worker_dead_letters SET replayed_at = CURRENT_TIMESTAMP WHERE id = ${deadLetterId}::uuid`.execute(
        transaction,
      );
    });
  }

  async retain(now: Date): Promise<Readonly<{ outbox: number; deadLetters: number }>> {
    const outbox =
      await sql`DELETE FROM outbox_events WHERE retained_until <= ${now.toISOString()}::timestamptz`.execute(
        this.database,
      );
    const deadLetters =
      await sql`DELETE FROM worker_dead_letters WHERE expires_at <= ${now.toISOString()}::timestamptz`.execute(
        this.database,
      );
    return {
      outbox: Number(outbox.numAffectedRows ?? 0n),
      deadLetters: Number(deadLetters.numAffectedRows ?? 0n),
    };
  }

  async lag(now: Date): Promise<
    Readonly<{
      outbox: number;
      milestones: number;
      outboxLagSeconds: number;
      milestoneLagSeconds: number;
      failures: number;
    }>
  > {
    const result = await sql<{
      outbox: string;
      milestones: string;
      outbox_lag: string;
      milestone_lag: string;
      failures: string;
    }>`SELECT
      count(*) FILTER (WHERE published_at IS NULL AND failed_at IS NULL)::text outbox,
      COALESCE(EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - min(available_at) FILTER (WHERE published_at IS NULL AND failed_at IS NULL))), 0)::text outbox_lag,
      (SELECT count(*)::text FROM simulation_milestones WHERE state = 'pending' AND target_time <= ${now.toISOString()}::timestamptz) milestones,
      (SELECT COALESCE(EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - min(target_time))), 0)::text FROM simulation_milestones WHERE state = 'pending' AND target_time <= ${now.toISOString()}::timestamptz) milestone_lag,
      count(*) FILTER (WHERE failed_at IS NOT NULL)::text failures FROM outbox_events`.execute(
      this.database,
    );
    const row = result.rows[0]!;
    return {
      outbox: Number(row.outbox),
      milestones: Number(row.milestones),
      outboxLagSeconds: Math.max(0, Number(row.outbox_lag)),
      milestoneLagSeconds: Math.max(0, Number(row.milestone_lag)),
      failures: Number(row.failures),
    };
  }
}

export function runtimeIdentity(prefix = "worker"): string {
  return `${prefix}-${process.pid}-${randomUUID()}`;
}
