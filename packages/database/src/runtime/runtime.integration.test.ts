import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readDatabasePoolOptions } from "../config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import { KyselyRuntimeRepository } from "./repository.js";

let runtime: DatabaseRuntime;
let repository: KyselyRuntimeRepository;

beforeAll(() => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
  repository = new KyselyRuntimeRepository(runtime.database);
});
beforeEach(async () => {
  await sql`TRUNCATE worker_replay_audits, worker_dead_letters, simulation_milestones, outbox_events CASCADE`.execute(
    runtime.database,
  );
});
afterAll(async () => runtime.destroy());

async function insertOutbox(availableAt = new Date("2026-07-12T12:00:00Z")): Promise<string> {
  const result = await sql<{ id: string }>`INSERT INTO outbox_events
    (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at, next_attempt_at)
    VALUES ('test_entity', ${randomUUID()}::uuid, 1, 'test.created.v1', '{}'::jsonb,
      ${availableAt.toISOString()}::timestamptz, ${availableAt.toISOString()}::timestamptz,
      ${availableAt.toISOString()}::timestamptz) RETURNING id`.execute(runtime.database);
  return result.rows[0]!.id;
}

describe("PostgreSQL authoritative background runtime", () => {
  it("claims with SKIP LOCKED exactly once across competing owners", async () => {
    await Promise.all([insertOutbox(), insertOutbox(), insertOutbox()]);
    const input = { now: new Date("2026-07-12T12:01:00Z"), leaseMilliseconds: 30_000, limit: 3 };
    const [left, right] = await Promise.all([
      repository.claimOutbox({ ...input, owner: "left" }),
      repository.claimOutbox({ ...input, owner: "right" }),
    ]);
    expect(new Set([...left, ...right].map(({ id }) => id)).size).toBe(3);
    expect(left.length + right.length).toBe(3);
  });

  it("recovers expired leases and records bounded retry state", async () => {
    const id = await insertOutbox();
    const now = new Date("2026-07-12T12:01:00Z");
    await repository.claimOutbox({ owner: "crashed", now, leaseMilliseconds: 1_000, limit: 1 });
    expect(
      await repository.claimOutbox({ owner: "early", now, leaseMilliseconds: 1_000, limit: 1 }),
    ).toHaveLength(0);
    const recovered = await repository.claimOutbox({
      owner: "recovery",
      now: new Date(now.getTime() + 1_001),
      leaseMilliseconds: 1_000,
      limit: 1,
    });
    expect(recovered).toHaveLength(1);
    await repository.releaseOutbox(
      id,
      "recovery",
      new Error("redis token=hidden"),
      new Date(now.getTime() + 1_001),
      2,
    );
    const state = await sql<{
      failure_count: number;
      failed_at: Date | null;
      last_error: string;
    }>`SELECT failure_count, failed_at, last_error FROM outbox_events WHERE id = ${id}::uuid`.execute(
      runtime.database,
    );
    expect(state.rows[0]).toMatchObject({ failure_count: 1 });
    expect(state.rows[0]?.failed_at).toBeInstanceOf(Date);
    expect(state.rows[0]?.last_error).not.toContain("hidden");
  });

  it("registers, claims, releases, and converges authoritative milestones idempotently", async () => {
    const entityId = randomUUID();
    const common = {
      commandId: randomUUID(),
      entityId,
      entityType: "test_entity",
      expectedVersion: "1",
      correlationId: randomUUID(),
      causationId: randomUUID(),
      targetTime: "2026-07-12T12:00:00.000Z",
      handlerKind: "test.handler",
      handlerVersion: 1,
      routing: { source: "test" },
    } as const;
    const first = await repository.registerMilestone(common);
    expect(await repository.registerMilestone(common)).toBe(first);
    const claimed = await repository.claimDueMilestones({
      owner: "worker",
      now: new Date("2026-07-12T12:01:00Z"),
      overdueBefore: new Date("2026-07-12T12:01:00Z"),
      leaseMilliseconds: 1_000,
      limit: 10,
    });
    expect(claimed).toHaveLength(1);
    await repository.releaseMilestone(claimed[0]!, "worker");
    const replayed = await repository.claimDueMilestones({
      owner: "worker-2",
      now: new Date("2026-07-12T12:01:01Z"),
      overdueBefore: new Date("2026-07-12T12:01:01Z"),
      leaseMilliseconds: 1_000,
      limit: 10,
    });
    await repository.markMilestoneApplied(replayed[0]!, new Date("2026-07-12T12:01:01Z"));
    expect(
      await repository.claimDueMilestones({
        owner: "worker-3",
        now: new Date("2026-07-12T12:02:00Z"),
        overdueBefore: new Date("2026-07-12T12:02:00Z"),
        leaseMilliseconds: 1_000,
        limit: 10,
      }),
    ).toHaveLength(0);
  });

  it("retains redacted dead letters and audits authorized same-path replay", async () => {
    const deadLetterId = await repository.recordDeadLetter({
      jobId: "job-1",
      queueName: "runtime",
      classification: "unsupported",
      diagnostic: { token: "hidden", safe: "visible" },
      now: new Date("2026-07-12T12:00:00Z"),
      retentionMilliseconds: 1_000,
    });
    expect(await repository.listDeadLetters()).toMatchObject([
      { diagnostic: { token: "[REDACTED]", safe: "visible" } },
    ]);
    const requestId = randomUUID();
    await repository.auditReplay(
      deadLetterId,
      {
        actorIdentifier: "admin@example.test",
        isAdministrator: true,
        reason: "inspect idempotent replay",
        requestId,
      },
      "replay-job-1",
    );
    await expect(
      repository.auditReplay(
        deadLetterId,
        {
          actorIdentifier: "admin@example.test",
          isAdministrator: true,
          reason: "inspect idempotent replay",
          requestId,
        },
        "replay-job-2",
      ),
    ).rejects.toMatchObject({ code: "23505" });
    const retained = await repository.retain(new Date("2026-07-12T12:00:02Z"));
    expect(retained.deadLetters).toBe(1);
    const audit = await sql<{ count: string }>`SELECT count(*)::text count FROM worker_replay_audits
      WHERE dead_letter_id = ${deadLetterId}::uuid`.execute(runtime.database);
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("removes published outbox rows only after bounded retention", async () => {
    await insertOutbox();
    const now = new Date("2026-07-12T12:01:00Z");
    const [claimed] = await repository.claimOutbox({
      owner: "publisher",
      now,
      leaseMilliseconds: 1_000,
      limit: 1,
    });
    await repository.markOutboxPublished(claimed!.id, "publisher", now, 1_000);
    expect((await repository.retain(new Date(now.getTime() + 999))).outbox).toBe(0);
    expect((await repository.retain(new Date(now.getTime() + 1_000))).outbox).toBe(1);
  });
});
