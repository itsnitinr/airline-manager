import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FoundingSelection } from "@airline-manager/domain";
import { KyselyAirlineFoundingRepository } from "../airline/repository.js";
import { seedSliceOneCatalog } from "../catalog/seed.js";
import { readDatabasePoolOptions } from "../config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import { KyselyMarketRepository } from "./repository.js";

let runtime: DatabaseRuntime;
const start = new Date("2026-07-12T00:00:00.000Z");

async function createPlayer(): Promise<string> {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Market Test', ${`market-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id = ${user.rows[0]?.id}::uuid`.execute(runtime.database);
  if (!player.rows[0]?.id) throw new Error("Market test player was not created.");
  return player.rows[0].id;
}

function selection(): FoundingSelection {
  return {
    airlineName: `Market ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "MK" },
    acceptFoundingLoan: false,
    worldRulesetVersion: "contemporary-2026.07.11",
  };
}

async function foundCareer() {
  const playerId = await createPlayer();
  const founded = await new KyselyAirlineFoundingRepository(runtime.database).confirm(
    playerId,
    selection(),
    `found-${randomUUID()}`,
    start,
  );
  return { playerId, founded, repository: new KyselyMarketRepository(runtime.database) };
}

beforeAll(async () => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
  await seedSliceOneCatalog(runtime.database);
});

beforeEach(async () => {
  await sql`TRUNCATE game_worlds, ledger_books, auth_user, idempotency_commands, outbox_events CASCADE`.execute(
    runtime.database,
  );
});

afterAll(async () => runtime.destroy());

describe("PostgreSQL direct passenger markets, pricing, and bookings", () => {
  it("persists directed version-bound markets and deterministic explainable forecasts", async () => {
    const { playerId, founded, repository } = await foundCareer();
    const first = await repository.research(playerId, founded.airlineId, "JFK", "LAX", start);
    const repeated = await repository.research(playerId, founded.airlineId, "JFK", "LAX", start);
    const reverse = await repository.research(playerId, founded.airlineId, "LAX", "JFK", start);
    expect(repeated).toEqual(first);
    expect(reverse.marketId).not.toBe(first.marketId);
    expect(first.forecast).toMatchObject({
      catalogReleaseVersion: "slice-one-2026.07.11",
      worldRulesetVersion: "contemporary-2026.07.11",
      marketRulesVersion: "market-v1",
      demandFormulaVersion: "direct-segmented-demand-v1",
    });
    expect(first.forecast.segments.map(({ segment }) => segment)).toEqual([
      "business",
      "leisure",
      "vfr",
    ]);
    expect(first.competition.classification).toBe("simulated_aggregate_market_pressure");
    const persisted = await sql<{ markets: string; forecasts: string; competition: string }>`SELECT
      (SELECT count(*)::text FROM passenger_markets) AS markets,
      (SELECT count(*)::text FROM passenger_market_forecasts) AS forecasts,
      (SELECT count(*)::text FROM market_competition_snapshots) AS competition`.execute(
      runtime.database,
    );
    expect(persisted.rows[0]).toEqual({ markets: "2", forecasts: "2", competition: "2" });
  });

  it("keeps pricing prospective and checkpoint history bound to the effective immutable version", async () => {
    const { playerId, founded, repository } = await foundCareer();
    const research = await repository.research(playerId, founded.airlineId, "JFK", "LAX", start);
    const first = await repository.createPricingStrategy(
      playerId,
      founded.airlineId,
      {
        marketId: research.marketId,
        effectiveFrom: start.toISOString(),
        posture: "balanced",
        baseFareMinor: "30000",
        minimumFareMinor: "15000",
        maximumFareMinor: "60000",
        loadFactorTargetBasisPoints: 8200,
        revenueTargetMinor: "0",
      },
      start,
    );
    const offerId = randomUUID();
    await repository.createCommercialOffer(
      playerId,
      {
        offerId,
        airlineId: founded.airlineId,
        marketId: research.marketId,
        economySellableCapacity: 180,
        bookingOpensAt: start.toISOString(),
        departureAt: "2026-07-22T12:00:00.000Z",
        scheduledArrivalAt: "2026-07-22T18:00:00.000Z",
        durationMinutes: 360,
        scheduleQualityBasisPoints: 9000,
        serviceQualityBasisPoints: 8000,
        reputationBasisPoints: 8000,
        sourceType: "ticket11_fixture",
        sourceVersion: "fixture-v1",
        sourceReference: "fixture-flight-11-a",
      },
      start,
    );
    const checkpointOne = await repository.refreshBookings(
      playerId,
      founded.airlineId,
      offerId,
      new Date("2026-07-14T00:00:00Z"),
      "refresh-first",
    );
    const second = await repository.createPricingStrategy(
      playerId,
      founded.airlineId,
      {
        marketId: research.marketId,
        effectiveFrom: "2026-07-15T00:00:00Z",
        posture: "yield",
        baseFareMinor: "40000",
        minimumFareMinor: "20000",
        maximumFareMinor: "80000",
        loadFactorTargetBasisPoints: 7800,
        revenueTargetMinor: "5000000",
      },
      new Date("2026-07-14T00:00:00Z"),
    );
    const checkpointTwo = await repository.refreshBookings(
      playerId,
      founded.airlineId,
      offerId,
      new Date("2026-07-16T00:00:00Z"),
      "refresh-second",
    );
    expect(checkpointOne.pricingStrategyId).toBe(first.id);
    expect(checkpointTwo.pricingStrategyId).toBe(second.id);
    expect(checkpointOne.materialInputSnapshot).toMatchObject({
      schemaVersion: "booking-material-input-v1",
      noLedgerRevenuePosted: true,
    });
    const effectiveHistory = await sql<{
      interval_start: Date;
      interval_end: Date;
      pricing_strategy_id: string;
    }>`SELECT interval_start, interval_end, pricing_strategy_id
      FROM booking_checkpoints WHERE offer_id = ${offerId}::uuid
      ORDER BY interval_start`.execute(runtime.database);
    expect(effectiveHistory.rows).toMatchObject([
      { pricing_strategy_id: first.id },
      {
        interval_start: new Date("2026-07-14T00:00:00Z"),
        interval_end: new Date("2026-07-15T00:00:00Z"),
        pricing_strategy_id: first.id,
      },
      {
        interval_start: new Date("2026-07-15T00:00:00Z"),
        interval_end: new Date("2026-07-16T00:00:00Z"),
        pricing_strategy_id: second.id,
      },
    ]);
    await expect(
      sql`UPDATE booking_checkpoints SET revenue_added_minor = 0
        WHERE id = ${checkpointOne.id}::uuid`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "55000" });
    expect(
      (await repository.pricingStrategies(playerId, founded.airlineId, research.marketId))[0],
    ).toMatchObject({ id: first.id, effectiveTo: "2026-07-15T00:00:00.000Z" });
  });

  it("serializes concurrent retries, remains idempotent, caps seats, and never posts ledger revenue", async () => {
    const { playerId, founded, repository } = await foundCareer();
    const research = await repository.research(playerId, founded.airlineId, "JFK", "LAX", start);
    await repository.createPricingStrategy(
      playerId,
      founded.airlineId,
      {
        marketId: research.marketId,
        effectiveFrom: start.toISOString(),
        posture: "value",
        baseFareMinor: "18000",
        minimumFareMinor: "12000",
        maximumFareMinor: "40000",
        loadFactorTargetBasisPoints: 9000,
        revenueTargetMinor: "0",
      },
      start,
    );
    const offerId = randomUUID();
    await repository.createCommercialOffer(
      playerId,
      {
        offerId,
        airlineId: founded.airlineId,
        marketId: research.marketId,
        economySellableCapacity: 12,
        bookingOpensAt: start.toISOString(),
        departureAt: "2026-07-22T12:00:00.000Z",
        scheduledArrivalAt: "2026-07-22T18:00:00.000Z",
        durationMinutes: 360,
        scheduleQualityBasisPoints: 10000,
        serviceQualityBasisPoints: 10000,
        reputationBasisPoints: 10000,
        sourceType: "ticket11_fixture",
        sourceVersion: "fixture-v1",
        sourceReference: "fixture-flight-11-cap",
      },
      start,
    );
    const at = new Date("2026-07-20T00:00:00Z");
    const [left, right] = await Promise.all([
      repository.refreshBookings(playerId, founded.airlineId, offerId, at, "same-refresh"),
      repository.refreshBookings(playerId, founded.airlineId, offerId, at, "same-refresh"),
    ]);
    expect(right).toEqual(left);
    expect(
      await repository.refreshBookings(
        playerId,
        founded.airlineId,
        offerId,
        at,
        "same-interval-different-delivery",
      ),
    ).toEqual(left);
    const analytics = await repository.offerAnalytics(playerId, founded.airlineId, offerId, at);
    expect(BigInt(analytics.offer.bookedPassengers)).toBeLessThanOrEqual(12n);
    expect(analytics.loadFactorBasisPoints).toBe("10000");
    expect(analytics.ledgerRevenuePosted).toBe(false);
    const checks = await sql<{ checkpoints: string; revenue_entries: string }>`SELECT
      (SELECT count(*)::text FROM booking_checkpoints WHERE offer_id = ${offerId}::uuid) AS checkpoints,
      (SELECT count(*)::text FROM journal_entries WHERE command_type = 'revenue') AS revenue_entries`.execute(
      runtime.database,
    );
    expect(checks.rows[0]).toEqual({ checkpoints: "1", revenue_entries: "0" });
  });

  it("denies ownership and ID substitution and defines no passenger-agent or AI-airline entities", async () => {
    const owner = await foundCareer();
    const foreign = await foundCareer();
    const research = await owner.repository.research(
      owner.playerId,
      owner.founded.airlineId,
      "JFK",
      "LAX",
      start,
    );
    await expect(
      foreign.repository.pricingStrategies(
        foreign.playerId,
        owner.founded.airlineId,
        research.marketId,
      ),
    ).rejects.toMatchObject({ code: "market_not_found" });
    const forbidden = await sql<{
      table_name: string;
    }>`SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND
        (table_name ~ '(individual_)?passengers?$' OR table_name ~ 'ai_airlines?$' OR
         table_name ~ 'competitor_(aircraft|flights|schedules)')`.execute(runtime.database);
    expect(forbidden.rows).toEqual([]);
  });
});
