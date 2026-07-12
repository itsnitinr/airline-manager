import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { parseJobEnvelope } from "@airline-manager/application";
import {
  createDatabaseRuntime,
  readDatabasePoolOptions,
  type DatabaseRuntime,
} from "@airline-manager/database";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { QUEUE_NAME, SimulationWorkerRuntime } from "./runtime.js";

let database: DatabaseRuntime;
let worker: SimulationWorkerRuntime | undefined;
const redisUrlValue = new URL(
  process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
);
redisUrlValue.pathname = "/15";
const redisUrl = redisUrlValue.toString();
const connection = {
  host: redisUrlValue.hostname,
  port: Number(redisUrlValue.port || 6379),
  db: 15,
  maxRetriesPerRequest: null as null,
};

async function waitFor(predicate: () => Promise<boolean>, timeout = 8_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for worker convergence.");
}

function envelope(kind: string, targetTime = new Date().toISOString()) {
  return parseJobEnvelope({
    envelopeVersion: 1,
    commandId: randomUUID(),
    entityId: randomUUID(),
    entityType: "test_entity",
    expectedVersion: "1",
    correlationId: randomUUID(),
    causationId: randomUUID(),
    targetTime,
    handlerKind: kind,
    handlerVersion: 1,
    routing: { source: "reconciliation" },
  });
}

beforeAll(() => {
  database = createDatabaseRuntime(readDatabasePoolOptions("test"));
});
beforeEach(async () => {
  if (worker) {
    await worker.shutdown();
    worker = undefined;
  }
  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.obliterate({ force: true });
  await queue.close();
  await sql`TRUNCATE worker_replay_audits, worker_dead_letters, simulation_milestones, outbox_events CASCADE`.execute(
    database.database,
  );
});
afterAll(async () => {
  if (worker) await worker.shutdown();
  await database.destroy();
});

describe("real Redis and BullMQ transport", () => {
  it("publishes committed outbox work, deduplicates delivery, retries, and dead-letters poison safely", async () => {
    worker = new SimulationWorkerRuntime({
      databaseRuntime: database,
      redisUrl,
      pollMilliseconds: 50,
    });
    let attempts = 0;
    worker.registry.register("test.retry", 1, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient redis-adjacent failure");
      return { kind: "applied" };
    });
    await worker.start();

    const outboxId = randomUUID();
    await sql`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, aggregate_version, event_type, payload)
      VALUES (${outboxId}::uuid, 'test_entity', ${randomUUID()}::uuid, 1, 'test.created.v1', '{}'::jsonb)`.execute(
      database.database,
    );
    await worker.publishOutbox();
    await waitFor(
      async () =>
        (
          await sql<{
            published: boolean;
          }>`SELECT published_at IS NOT NULL published FROM outbox_events WHERE id = ${outboxId}::uuid`.execute(
            database.database,
          )
        ).rows[0]?.published === true,
    );

    const retry = envelope("test.retry");
    await Promise.all([worker.enqueue(retry), worker.enqueue(retry)]);
    await waitFor(async () => worker!.metrics.get("handlerApplied") >= 1);
    expect(attempts).toBe(2);

    await worker.queue.add("poison", { envelopeVersion: 99 } as never, {
      jobId: `poison-${randomUUID()}`,
      attempts: 3,
      removeOnFail: false,
    });
    await waitFor(async () => (await worker!.repository.listDeadLetters()).length === 1);
    const [dead] = await worker.repository.listDeadLetters();
    expect(dead).toMatchObject({ classification: "unsupported", envelope_version: null });

    const replayableId = await worker.repository.recordDeadLetter({
      jobId: `retry-dead-${randomUUID()}`,
      queueName: QUEUE_NAME,
      classification: "exhausted",
      envelope: retry,
      diagnostic: { error: "retry exhausted", token: "hidden" },
      now: new Date(),
      retentionMilliseconds: 60_000,
    });
    const replayAuthorization = {
      actorIdentifier: "runtime-admin@example.test",
      isAdministrator: true,
      reason: "verify idempotent recovery",
      requestId: randomUUID(),
    } as const;
    await expect(
      worker.replay(replayableId, { ...replayAuthorization, isAdministrator: false }),
    ).rejects.toThrow();
    await worker.replay(replayableId, replayAuthorization);
    await waitFor(async () => attempts === 3);
    const audit = await sql<{ count: string }>`SELECT count(*)::text count FROM worker_replay_audits
      WHERE request_id = ${replayAuthorization.requestId}::uuid`.execute(database.database);
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("restores a deliberately deleted delayed job from PostgreSQL and converges once", async () => {
    worker = new SimulationWorkerRuntime({
      databaseRuntime: database,
      redisUrl,
      pollMilliseconds: 50,
    });
    let applied = 0;
    worker.registry.register("test.restore", 1, async () => {
      applied += 1;
      return { kind: applied === 1 ? "applied" : "duplicate" };
    });
    await worker.start();
    const target = new Date(Date.now() + 250);
    const intent = envelope("test.restore", target.toISOString());
    await worker.repository.registerMilestone({ ...intent });
    await worker.enqueue(intent);
    const jobId = (await worker.queue.getDelayed())[0]?.id;
    expect(jobId).toBeTruthy();
    await (await worker.queue.getJob(jobId!))!.remove();
    expect(await worker.queue.getJob(jobId!)).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await worker.reconcile();
    await waitFor(async () => applied === 1);
    await worker.reconcile();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(applied).toBe(1);
  });
});
