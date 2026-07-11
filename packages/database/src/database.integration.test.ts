import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readDatabasePoolOptions } from "./config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "./database.js";
import { runInTransaction } from "./transactions.js";

let runtime: DatabaseRuntime;

beforeAll(() => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
});

afterAll(async () => {
  await runtime.destroy();
});

describe("transaction helper", () => {
  it("rolls back all writes when the callback fails", async () => {
    const id = randomUUID();
    await expect(
      runInTransaction(runtime.database, async (transaction) => {
        await sql`INSERT INTO outbox_events
          (id, aggregate_type, aggregate_id, aggregate_version, event_type, payload)
          VALUES (${id}::uuid, 'test', ${randomUUID()}::uuid, 1, 'rollback', '{}'::jsonb)`.execute(
          transaction,
        );
        throw new Error("rollback probe");
      }),
    ).rejects.toThrow("rollback probe");

    const result = await sql<{ count: string }>`SELECT count(*)::text AS count
      FROM outbox_events WHERE id = ${id}::uuid`.execute(runtime.database);
    expect(result.rows[0]?.count).toBe("0");
  });

  it.each(["read committed", "repeatable read", "serializable"] as const)(
    "selects %s isolation",
    async (isolationLevel) => {
      const actual = await runInTransaction(
        runtime.database,
        async (transaction) => {
          const result = await sql<{
            transaction_isolation: string;
          }>`SHOW transaction_isolation`.execute(transaction);
          return result.rows[0]?.transaction_isolation;
        },
        { isolationLevel },
      );
      expect(actual).toBe(isolationLevel);
    },
  );

  it.each(["40001", "40P01"])("retries recognized %s failures", async (code) => {
    let attempts = 0;
    const result = await runInTransaction(
      runtime.database,
      async () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("retry"), { code });
        return "committed";
      },
      { retryDelayMilliseconds: () => 0 },
    );
    expect(result).toBe("committed");
    expect(attempts).toBe(2);
  });

  it("never retries non-transaction failures", async () => {
    let attempts = 0;
    await expect(
      runInTransaction(
        runtime.database,
        async () => {
          attempts += 1;
          throw Object.assign(new Error("unique violation"), { code: "23505" });
        },
        { retryDelayMilliseconds: () => 0 },
      ),
    ).rejects.toMatchObject({ code: "23505" });
    expect(attempts).toBe(1);
  });
});

describe("foundation schema constraints and indexes", () => {
  it("enforces outbox identity, optimistic versions, and dispatch indexes", async () => {
    const aggregateId = randomUUID();
    await sql`INSERT INTO outbox_events
      (aggregate_type, aggregate_id, aggregate_version, event_type, payload)
      VALUES ('test', ${aggregateId}::uuid, 1, 'created', '{}'::jsonb)`.execute(runtime.database);
    await expect(
      sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload)
        VALUES ('test', ${aggregateId}::uuid, 1, 'created', '{}'::jsonb)`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload)
        VALUES ('test', ${randomUUID()}::uuid, 0, 'invalid', '{}'::jsonb)`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const indexes = await sql<{ indexname: string }>`SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'outbox_events'`.execute(runtime.database);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "outbox_events_available_unpublished_idx",
        "outbox_events_aggregate_idx",
      ]),
    );
  });

  it("enforces idempotency keys and completed response shape", async () => {
    const key = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await sql`INSERT INTO idempotency_commands
      (scope, idempotency_key, command_type, request_hash, expires_at)
      VALUES ('test', ${key}, 'probe', ${"a".repeat(64)}, ${expiresAt}::timestamptz)`.execute(
      runtime.database,
    );
    await expect(
      sql`INSERT INTO idempotency_commands
        (scope, idempotency_key, command_type, request_hash, expires_at)
        VALUES ('test', ${key}, 'probe', ${"a".repeat(64)}, ${expiresAt}::timestamptz)`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      sql`INSERT INTO idempotency_commands
        (scope, idempotency_key, command_type, request_hash, state, expires_at)
        VALUES ('test', ${randomUUID()}, 'probe', ${"b".repeat(64)}, 'completed', ${expiresAt}::timestamptz)`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const indexes = await sql<{ indexname: string }>`SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'idempotency_commands'`.execute(runtime.database);
    expect(indexes.rows.map(({ indexname }) => indexname)).toContain(
      "idempotency_commands_expiry_idx",
    );
  });

  it("enforces unique, append-only administrative audit records with lookup indexes", async () => {
    const requestId = randomUUID();
    const record = sql`INSERT INTO administrative_audit_records
      (actor_identifier, action, resource_type, resource_identifier, request_id, reason)
      VALUES ('admin:test', 'inspect', 'probe', 'one', ${requestId}::uuid, 'integration test')`;
    await record.execute(runtime.database);
    await expect(record.execute(runtime.database)).rejects.toMatchObject({ code: "23505" });
    await expect(
      sql`UPDATE administrative_audit_records SET reason = 'changed'
        WHERE request_id = ${requestId}::uuid`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "55000" });

    const indexes = await sql<{ indexname: string }>`SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'administrative_audit_records'`.execute(
      runtime.database,
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "administrative_audit_records_actor_time_idx",
        "administrative_audit_records_resource_time_idx",
      ]),
    );
  });
});
