import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { parseJobEnvelope } from "@airline-manager/application";
import {
  KyselyAirlineFoundingRepository,
  KyselyFleetRepository,
  KyselyFuelRepository,
  KyselyMarketRepository,
  KyselySchedulingRepository,
  KyselyWorkforceRepository,
  createDatabaseRuntime,
  readDatabasePoolOptions,
  seedSliceOneCatalog,
  type DatabaseRuntime,
} from "@airline-manager/database";
import { forecastRoute, type FoundingSelection } from "@airline-manager/domain";
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

beforeAll(async () => {
  database = createDatabaseRuntime(readDatabasePoolOptions("test"));
  await seedSliceOneCatalog(database.database);
});
beforeEach(async () => {
  if (worker) {
    await worker.shutdown();
    worker = undefined;
  }
  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.obliterate({ force: true });
  await queue.close();
  await sql`TRUNCATE game_worlds, ledger_books, auth_user, idempotency_commands,
    worker_replay_audits, worker_dead_letters, simulation_milestones, outbox_events CASCADE`.execute(
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

  it("settles an overdue flight with the API/browser offline after Redis work is deleted", async () => {
    const scheduledAt = new Date("2026-07-12T00:00:00.000Z");
    const simulatedNow = new Date("2026-07-21T00:00:00.000Z");
    const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
      VALUES ('Offline Flight', ${`offline-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
      database.database,
    );
    const account = await sql<{ id: string }>`SELECT id FROM player_accounts
      WHERE authentication_user_id=${user.rows[0]!.id}::uuid`.execute(database.database);
    const playerId = account.rows[0]!.id;
    const selection: FoundingSelection = {
      airlineName: `Offline ${randomUUID().slice(0, 8)}`,
      fictionalIdentityConfirmed: true,
      homeJurisdiction: "US",
      principalBaseIataCode: "JFK",
      reportingCurrency: "USD",
      brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "OF" },
      acceptFoundingLoan: false,
      worldRulesetVersion: "contemporary-2026.07.11",
    };
    const founded = await new KyselyAirlineFoundingRepository(database.database).confirm(
      playerId,
      selection,
      `found-${randomUUID()}`,
      scheduledAt,
    );
    const lease = await new KyselyFleetRepository(database.database).acceptFounderLease(
      playerId,
      founded.airlineId,
      "founder-atr-72-600",
      `lease-${randomUUID()}`,
      scheduledAt,
    );
    const markets = new KyselyMarketRepository(database.database);
    const scheduling = new KyselySchedulingRepository(database.database);
    const market = await markets.research(playerId, founded.airlineId, "JFK", "PHL", scheduledAt);
    const [origin, destination, aircraft] = await Promise.all([
      scheduling.airportFacts(founded.airlineId, "JFK", playerId),
      scheduling.airportFacts(founded.airlineId, "PHL", playerId),
      scheduling.aircraftFacts(founded.airlineId, lease.aircraft.id, playerId),
    ]);
    const route = await scheduling.createRoute(
      playerId,
      founded.airlineId,
      market.marketId,
      "JFK",
      "PHL",
      forecastRoute(origin, destination, aircraft, market),
      scheduledAt,
    );
    const activation = await scheduling.activateTimetable(
      playerId,
      founded.airlineId,
      route.id,
      {
        aircraftId: lease.aircraft.id,
        effectiveFromLocalDate: "2026-07-20",
        horizonDays: 7,
        legs: [
          {
            dayOfWeek: 1,
            originIataCode: "JFK",
            destinationIataCode: "PHL",
            departureLocalTime: "08:00",
          },
        ],
      },
      scheduledAt,
    );
    const flight = activation.flights[0]!;
    await markets.createPricingStrategy(
      playerId,
      founded.airlineId,
      {
        marketId: market.marketId,
        effectiveFrom: scheduledAt.toISOString(),
        posture: market.recommendedPricing.posture,
        baseFareMinor: market.recommendedPricing.baseFareMinor,
        minimumFareMinor: market.recommendedPricing.minimumFareMinor,
        maximumFareMinor: market.recommendedPricing.maximumFareMinor,
        loadFactorTargetBasisPoints: market.recommendedPricing.loadFactorTargetBasisPoints,
        revenueTargetMinor: market.recommendedPricing.revenueTargetMinor,
      },
      scheduledAt,
    );
    await markets.createCommercialOffer(
      playerId,
      { ...flight.commercialOffer, bookingOpensAt: scheduledAt.toISOString() },
      scheduledAt,
    );
    const workforce = new KyselyWorkforceRepository(database.database);
    for (const [role, capacity, qualificationAircraftVariantId] of [
      ["pilot", 2, lease.aircraft.variantId],
      ["cabin_crew", 2, undefined],
      ["line_maintenance", 1, undefined],
    ] as const)
      await workforce.hire(
        playerId,
        founded.airlineId,
        {
          role,
          capacity,
          ...(qualificationAircraftVariantId ? { qualificationAircraftVariantId } : {}),
        },
        `hire-${role}-${randomUUID()}`,
        scheduledAt,
      );
    const fuel = new KyselyFuelRepository(database.database);
    const quote = await fuel.createQuote(playerId, founded.airlineId, 20_000n, scheduledAt);
    await fuel.purchase(playerId, founded.airlineId, quote.id, `fuel-${randomUUID()}`, scheduledAt);

    worker = new SimulationWorkerRuntime({
      databaseRuntime: database,
      redisUrl,
      pollMilliseconds: 50,
      now: () => simulatedNow,
    });
    await worker.reconcile();
    const missing = (await worker.queue.getWaiting())[0] ?? (await worker.queue.getDelayed())[0];
    expect(missing).toBeTruthy();
    await missing!.remove();
    await worker.start();
    await waitFor(async () => {
      await worker!.reconcile();
      const state = await sql<{ status: string }>`SELECT status FROM dated_flights
        WHERE id=${flight.id}::uuid`.execute(database.database);
      return state.rows[0]?.status === "settled";
    }, 20_000);
    const exact = await sql<{ fuel: string; utilization: string; snapshot: string }>`SELECT
      (SELECT count(*)::text FROM fuel_inventory_movements WHERE source_type='dated_flight' AND source_id=${flight.id}) fuel,
      (SELECT count(*)::text FROM flight_completion_utilization_inputs WHERE completion_key=${`flight:${flight.id}:utilization`}) utilization,
      (SELECT count(*)::text FROM settled_flight_snapshots WHERE flight_id=${flight.id}::uuid) snapshot`.execute(
      database.database,
    );
    expect(exact.rows[0]).toEqual({ fuel: "1", utilization: "1", snapshot: "1" });
  });
});
