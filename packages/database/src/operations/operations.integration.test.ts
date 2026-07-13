import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forecastRoute, type FoundingSelection } from "@airline-manager/domain";
import { KyselyAirlineFoundingRepository } from "../airline/repository.js";
import { seedSliceOneCatalog } from "../catalog/seed.js";
import { readDatabasePoolOptions } from "../config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import { KyselyFleetRepository } from "../fleet/repository.js";
import { KyselyFinanceReadRepository } from "../finance/repository.js";
import { KyselyFuelRepository } from "../fuel/repository.js";
import { KyselyMarketRepository } from "../market/repository.js";
import { KyselySchedulingRepository } from "../scheduling/repository.js";
import { KyselyWorkforceRepository } from "../workforce/repository.js";
import { KyselyFlightOperationsRepository } from "./repository.js";

let runtime: DatabaseRuntime;
const now = new Date("2026-07-12T00:00:00.000Z");

async function player() {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Operations Test', ${`ops-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const account = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id=${user.rows[0]!.id}::uuid`.execute(runtime.database);
  return account.rows[0]!.id;
}

function selection(): FoundingSelection {
  return {
    airlineName: `Ops ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "OP" },
    acceptFoundingLoan: false,
    worldRulesetVersion: "contemporary-2026.07.11",
  };
}

async function setup() {
  const playerId = await player();
  const founded = await new KyselyAirlineFoundingRepository(runtime.database).confirm(
    playerId,
    selection(),
    `found-${randomUUID()}`,
    now,
  );
  const lease = await new KyselyFleetRepository(runtime.database).acceptFounderLease(
    playerId,
    founded.airlineId,
    "founder-atr-72-600",
    `lease-${randomUUID()}`,
    now,
  );
  const markets = new KyselyMarketRepository(runtime.database);
  const scheduling = new KyselySchedulingRepository(runtime.database);
  const market = await markets.research(playerId, founded.airlineId, "JFK", "PHL", now);
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
    now,
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
    now,
  );
  const flight = activation.flights[0]!;
  await markets.createPricingStrategy(
    playerId,
    founded.airlineId,
    {
      marketId: market.marketId,
      effectiveFrom: now.toISOString(),
      posture: market.recommendedPricing.posture,
      baseFareMinor: market.recommendedPricing.baseFareMinor,
      minimumFareMinor: market.recommendedPricing.minimumFareMinor,
      maximumFareMinor: market.recommendedPricing.maximumFareMinor,
      loadFactorTargetBasisPoints: market.recommendedPricing.loadFactorTargetBasisPoints,
      revenueTargetMinor: market.recommendedPricing.revenueTargetMinor,
    },
    now,
  );
  await markets.createCommercialOffer(
    playerId,
    { ...flight.commercialOffer, bookingOpensAt: now.toISOString() },
    now,
  );
  const workforce = new KyselyWorkforceRepository(runtime.database);
  const variantId = lease.aircraft.variantId;
  for (const [role, capacity, qualificationAircraftVariantId] of [
    ["pilot", 2, variantId],
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
      now,
    );
  const fuel = new KyselyFuelRepository(runtime.database);
  const quote = await fuel.createQuote(playerId, founded.airlineId, 20_000n, now);
  await fuel.purchase(playerId, founded.airlineId, quote.id, `fuel-${randomUUID()}`, now);
  return { playerId, airlineId: founded.airlineId, flight, aircraftId: lease.aircraft.id };
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

describe("persistent flight lifecycle and settlement", () => {
  it("settles offline in effective-time order and retries every milestone exactly once", async () => {
    const fixture = await setup();
    const operations = new KyselyFlightOperationsRepository(runtime.database);
    const bookingLock = new Date(new Date(fixture.flight.departureAt).getTime() - 30 * 60_000);
    const commands = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const competing = await Promise.all([
      operations.advanceMilestone(
        fixture.flight.id,
        "booking_lock",
        1n,
        commands[0]!,
        bookingLock,
        new Date("2026-07-21T00:00:00Z"),
      ),
      operations.advanceMilestone(
        fixture.flight.id,
        "booking_lock",
        1n,
        commands[0]!,
        bookingLock,
        new Date("2026-07-21T00:00:00Z"),
      ),
    ]);
    expect(competing).toContain("applied");
    expect(competing.every((outcome) => ["applied", "duplicate", "stale"].includes(outcome))).toBe(
      true,
    );
    expect(
      await operations.advanceMilestone(
        fixture.flight.id,
        "booking_lock",
        1n,
        commands[0]!,
        bookingLock,
        new Date("2026-07-21T00:00:00Z"),
      ),
    ).toBe("duplicate");
    expect(
      await operations.advanceMilestone(
        fixture.flight.id,
        "dispatch",
        2n,
        commands[1]!,
        new Date(fixture.flight.departureAt),
        new Date("2026-07-21T00:00:00Z"),
      ),
    ).toBe("applied");
    const result = await sql<{
      realized_block_minutes: number;
    }>`SELECT realized_block_minutes FROM flight_operational_results
      WHERE flight_id=${fixture.flight.id}::uuid`.execute(runtime.database);
    const arrival = new Date(
      new Date(fixture.flight.departureAt).getTime() +
        result.rows[0]!.realized_block_minutes * 60_000,
    );
    expect(
      await operations.advanceMilestone(
        fixture.flight.id,
        "arrival",
        3n,
        commands[2]!,
        arrival,
        new Date("2026-07-21T00:00:00Z"),
      ),
    ).toBe("applied");
    const status = await operations.status(fixture.playerId, fixture.airlineId, fixture.flight.id);
    const arrivalVersion = BigInt(status.version);
    if (status.state === "diverted") {
      expect(
        await operations.advanceMilestone(
          fixture.flight.id,
          "arrival",
          arrivalVersion,
          randomUUID(),
          arrival,
          new Date("2026-07-21T00:00:00Z"),
        ),
      ).toBe("applied");
    }
    const arrived = await operations.status(fixture.playerId, fixture.airlineId, fixture.flight.id);
    expect(
      await operations.advanceMilestone(
        fixture.flight.id,
        "settlement",
        BigInt(arrived.version),
        commands[3]!,
        arrival,
        new Date("2026-07-21T00:00:00Z"),
      ),
    ).toBe("applied");
    const snapshot = await operations.settlement(
      fixture.playerId,
      fixture.airlineId,
      fixture.flight.id,
    );
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.journalEntryIds.length).toBeGreaterThan(0);
    const reconciliation = await sql<{ result: string }>`SELECT (
      COALESCE(sum(CASE WHEN account.code='4000' AND posting.side='credit' THEN posting.reporting_amount_minor
        WHEN account.code IN ('5000','5100','5200','5300','5900') AND posting.side='debit'
          THEN -posting.reporting_amount_minor ELSE 0 END), 0)
      )::text AS result FROM flight_settlement_journals component
      JOIN ledger_postings posting ON posting.journal_entry_id=component.journal_entry_id
      JOIN ledger_accounts account ON account.id=posting.account_id
      WHERE component.flight_id=${fixture.flight.id}::uuid`.execute(runtime.database);
    expect(reconciliation.rows[0]!.result).toBe(snapshot.outcome.operatingResultMinor);
    const counts = await sql<{
      fuel: string;
      workforce: string;
      utilization: string;
      snapshots: string;
    }>`SELECT
      (SELECT count(*)::text FROM fuel_inventory_movements WHERE source_type='dated_flight' AND source_id=${fixture.flight.id}) fuel,
      (SELECT count(*)::text FROM workforce_allocations WHERE dated_flight_id=${fixture.flight.id}::uuid) workforce,
      (SELECT count(*)::text FROM flight_completion_utilization_inputs WHERE completion_key=${`flight:${fixture.flight.id}:utilization`}) utilization,
      (SELECT count(*)::text FROM settled_flight_snapshots WHERE flight_id=${fixture.flight.id}::uuid) snapshots`.execute(
      runtime.database,
    );
    expect(counts.rows[0]).toEqual({ fuel: "1", workforce: "3", utilization: "1", snapshots: "1" });
    const finance = new KyselyFinanceReadRepository(runtime.database);
    const [overview, statements, journals] = await Promise.all([
      finance.overview(fixture.playerId, fixture.airlineId, new Date("2026-07-22T00:00:00Z")),
      finance.statements(
        fixture.playerId,
        fixture.airlineId,
        new Date("2026-07-01T00:00:00Z"),
        new Date("2026-08-01T00:00:00Z"),
      ),
      finance.journals(fixture.playerId, fixture.airlineId, 0, 10),
    ]);
    expect(overview.routeProfitability).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeId: fixture.flight.routeId,
          operatingResultMinor: snapshot.outcome.operatingResultMinor,
          settledFlights: 1,
        }),
      ]),
    );
    expect(statements.reconciliation).toEqual({
      journalsBalanced: true,
      trialBalanceDifferenceMinor: "0",
      balanceSheetDifferenceMinor: "0",
    });
    expect(journals.items.length).toBeGreaterThan(0);
    expect(journals.items.every(({ lines }) => lines.length >= 2)).toBe(true);
    await expect(
      sql`UPDATE settled_flight_snapshots SET outcome='{}'::jsonb WHERE flight_id=${fixture.flight.id}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("suspends hard shortages and stops after a bounded retry count", async () => {
    const fixture = await setup();
    await sql`UPDATE airline_fuel_inventories SET on_hand_kg=0, planning_reserved_kg=0, inventory_value_minor=0,
      version=version+1 WHERE airline_id=${fixture.airlineId}::uuid`.execute(runtime.database);
    const operations = new KyselyFlightOperationsRepository(runtime.database);
    const bookingLock = new Date(new Date(fixture.flight.departureAt).getTime() - 30 * 60_000);
    await operations.advanceMilestone(
      fixture.flight.id,
      "booking_lock",
      1n,
      randomUUID(),
      bookingLock,
      new Date("2026-07-21Z"),
    );
    let expected = 2n;
    let at = new Date(fixture.flight.departureAt);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        await operations.advanceMilestone(
          fixture.flight.id,
          "dispatch",
          expected,
          randomUUID(),
          at,
          new Date("2026-07-21Z"),
        ),
      ).toBe("applied");
      expected += 1n;
      at = new Date(at.getTime() + 15 * 60_000);
    }
    const status = await operations.status(fixture.playerId, fixture.airlineId, fixture.flight.id);
    expect(status.state).toBe("cancelled");
    expect(status.suspension?.retryCount).toBe(3);
  });

  it("returns bounded owner-scoped flight boards and offline changes", async () => {
    const fixture = await setup();
    const foreignPlayer = await player();
    const operations = new KyselyFlightOperationsRepository(runtime.database);
    const query = {
      from: new Date("2026-07-19T00:00:00Z"),
      to: new Date("2026-07-27T00:00:00Z"),
      states: ["scheduled" as const],
      limit: 10,
    };
    const board = await operations.board(fixture.playerId, fixture.airlineId, query);
    expect(board.items).toHaveLength(1);
    expect(board.items[0]).toMatchObject({
      id: fixture.flight.id,
      routeId: fixture.flight.routeId,
      aircraftId: fixture.aircraftId,
      state: "scheduled",
      origin: { iataCode: "JFK" },
      destination: { iataCode: "PHL" },
    });
    expect(board.truncated).toBe(false);
    expect(await operations.board(foreignPlayer, fixture.airlineId, query)).toMatchObject({
      items: [],
    });
    const changes = await operations.changes(
      fixture.playerId,
      fixture.airlineId,
      new Date("2026-07-11T00:00:00Z"),
      10,
    );
    expect(changes).toMatchObject({ total: 1, byState: { scheduled: 1 } });
    expect(
      await operations.changes(
        foreignPlayer,
        fixture.airlineId,
        new Date("2026-07-11T00:00:00Z"),
        10,
      ),
    ).toMatchObject({ total: 0 });
  });
});
