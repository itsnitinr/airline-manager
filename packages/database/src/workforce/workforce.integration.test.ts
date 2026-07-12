import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { forecastRoute, type FoundingSelection } from "@airline-manager/domain";
import { KyselyAirlineFoundingRepository } from "../airline/repository.js";
import { seedSliceOneCatalog } from "../catalog/seed.js";
import { readDatabasePoolOptions } from "../config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import { KyselyFleetRepository } from "../fleet/repository.js";
import { KyselyMarketRepository } from "../market/repository.js";
import { KyselySchedulingRepository } from "../scheduling/repository.js";
import { KyselyWorkforceRepository } from "./repository.js";

let runtime: DatabaseRuntime;
const hiredAt = new Date("2026-07-12T00:00:00.000Z");
const afterTraining = new Date("2026-07-15T00:00:00.000Z");

async function createPlayer(): Promise<string> {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Workforce Test', ${`workforce-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id = ${user.rows[0]?.id}::uuid`.execute(runtime.database);
  if (!player.rows[0]) throw new Error("Workforce player was not created.");
  return player.rows[0].id;
}

function selection(): FoundingSelection {
  return {
    airlineName: `Workforce ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "WF" },
    acceptFoundingLoan: false,
    worldRulesetVersion: "contemporary-2026.07.11",
  };
}

async function setup() {
  const playerId = await createPlayer();
  const founded = await new KyselyAirlineFoundingRepository(runtime.database).confirm(
    playerId,
    selection(),
    `found-${randomUUID()}`,
    hiredAt,
  );
  const lease = await new KyselyFleetRepository(runtime.database).acceptFounderLease(
    playerId,
    founded.airlineId,
    "founder-atr-72-600",
    `lease-${randomUUID()}`,
    hiredAt,
  );
  const markets = new KyselyMarketRepository(runtime.database);
  const scheduling = new KyselySchedulingRepository(runtime.database);
  const market = await markets.research(playerId, founded.airlineId, "JFK", "PHL", hiredAt);
  const [origin, destination, plane] = await Promise.all([
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
    forecastRoute(origin, destination, plane, market),
    hiredAt,
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
        {
          dayOfWeek: 1,
          originIataCode: "PHL",
          destinationIataCode: "JFK",
          departureLocalTime: "09:30",
        },
      ],
    },
    hiredAt,
  );
  return {
    playerId,
    founded,
    lease,
    activation,
    workforce: new KyselyWorkforceRepository(runtime.database),
  };
}

async function hireMinimum(fixture: Awaited<ReturnType<typeof setup>>) {
  const variantId = fixture.lease.aircraft.variantId;
  return Promise.all([
    fixture.workforce.hire(
      fixture.playerId,
      fixture.founded.airlineId,
      { role: "pilot", capacity: 2, qualificationAircraftVariantId: variantId },
      `pilot-${randomUUID()}`,
      hiredAt,
    ),
    fixture.workforce.hire(
      fixture.playerId,
      fixture.founded.airlineId,
      { role: "cabin_crew", capacity: 2 },
      `cabin-${randomUUID()}`,
      hiredAt,
    ),
    fixture.workforce.hire(
      fixture.playerId,
      fixture.founded.airlineId,
      { role: "line_maintenance", capacity: 1 },
      `maintenance-${randomUUID()}`,
      hiredAt,
    ),
  ]);
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

describe("PostgreSQL qualified workforce", () => {
  it("publishes all founder recommendations and keeps the active balance rules immutable", async () => {
    const fixture = await setup();
    const packages = await fixture.workforce.recommendations(
      fixture.playerId,
      fixture.founded.airlineId,
    );
    expect(packages.map(({ variantCode }) => variantCode)).toEqual([
      "airbus-a320neo",
      "atr-72-600",
      "boeing-737-8",
      "embraer-e175",
    ]);
    expect(
      packages.find(({ variantCode }) => variantCode === "atr-72-600")?.minimumCapacity,
    ).toEqual({ pilot: 4, cabin_crew: 4, line_maintenance: 2, ground_handling: 0 });
    await expect(
      sql`UPDATE workforce_role_rules SET training_lead_hours = 0`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("posts retry-safe hiring and training costs and activates capacity only after lead time", async () => {
    const fixture = await setup();
    const key = `pilot-${randomUUID()}`;
    const input = {
      role: "pilot" as const,
      capacity: 2,
      qualificationAircraftVariantId: fixture.lease.aircraft.variantId,
    };
    const first = await fixture.workforce.hire(
      fixture.playerId,
      fixture.founded.airlineId,
      input,
      key,
      hiredAt,
    );
    const replay = await fixture.workforce.hire(
      fixture.playerId,
      fixture.founded.airlineId,
      input,
      key,
      hiredAt,
    );
    expect(replay).toEqual(first);
    const expansion = await fixture.workforce.hire(
      fixture.playerId,
      fixture.founded.airlineId,
      { ...input, capacity: 1 },
      `pilot-expansion-${randomUUID()}`,
      new Date("2026-07-12T01:00:00Z"),
    );
    expect(expansion.pool.id).toBe(first.pool.id);
    expect(first).toMatchObject({ status: "training", availableAt: "2026-07-14T00:00:00.000Z" });
    expect(
      (
        await fixture.workforce.listPools(
          fixture.playerId,
          fixture.founded.airlineId,
          new Date("2026-07-13T23:59:59Z"),
        )
      )[0],
    ).toMatchObject({ activeCapacity: 0, pendingCapacity: 3 });
    expect(
      (
        await fixture.workforce.listPools(
          fixture.playerId,
          fixture.founded.airlineId,
          afterTraining,
        )
      )[0],
    ).toMatchObject({ activeCapacity: 3, pendingCapacity: 0 });
    const intents = await sql<{ count: string; versions: string }>`SELECT count(*)::text AS count,
      count(DISTINCT aggregate_version)::text AS versions FROM outbox_events
      WHERE aggregate_type = 'workforce_pool' AND aggregate_id = ${first.pool.id}::uuid
        AND event_type = 'workforce.training_due.v1'`.execute(runtime.database);
    expect(intents.rows[0]).toEqual({ count: "2", versions: "2" });
    const journals = await sql<{ count: string; debits: string; credits: string }>`SELECT
      count(DISTINCT j.id)::text AS count,
      COALESCE(sum(CASE WHEN p.side = 'debit' THEN p.reporting_amount_minor ELSE 0 END),0)::text AS debits,
      COALESCE(sum(CASE WHEN p.side = 'credit' THEN p.reporting_amount_minor ELSE 0 END),0)::text AS credits
      FROM journal_entries j JOIN ledger_postings p ON p.journal_entry_id = j.id
      WHERE j.id IN (${first.hiringJournalEntryId}::uuid, ${first.trainingJournalEntryId}::uuid)`.execute(
      runtime.database,
    );
    expect(journals.rows[0]).toMatchObject({ count: "2" });
    expect(journals.rows[0]?.debits).toBe(journals.rows[0]?.credits);
  });

  it("rejects catalog-incompatible pilot ratings and forecasts actionable shortages", async () => {
    const fixture = await setup();
    const otherVariant = await sql<{ id: string }>`SELECT id FROM curated_aircraft_variants
      WHERE code = 'boeing-737-8'`.execute(runtime.database);
    await fixture.workforce.hire(
      fixture.playerId,
      fixture.founded.airlineId,
      { role: "pilot", capacity: 4, qualificationAircraftVariantId: otherVariant.rows[0]!.id },
      `wrong-${randomUUID()}`,
      hiredAt,
    );
    const forecast = await fixture.workforce.forecast(
      fixture.playerId,
      fixture.founded.airlineId,
      new Date("2026-07-27T00:00:00Z"),
      afterTraining,
    );
    expect(forecast.feasible).toBe(false);
    expect(forecast.shortages).toContainEqual(
      expect.objectContaining({
        role: "pilot",
        qualificationCode: "variant:atr-72-600",
        availableCapacity: 0,
        baseIataCode: "JFK",
        requiredCapacity: 2,
        shortfall: 2,
      }),
    );
  });

  it("serializes concurrent flight allocations so fatigue capacity cannot be double-allocated", async () => {
    const fixture = await setup();
    await hireMinimum(fixture);
    await fixture.workforce.listPools(fixture.playerId, fixture.founded.airlineId, afterTraining);
    const [firstFlight, secondFlight] = fixture.activation.flights;
    const settled = await Promise.allSettled([
      fixture.workforce.allocateFlight(
        fixture.playerId,
        fixture.founded.airlineId,
        firstFlight!.id,
        afterTraining,
      ),
      fixture.workforce.allocateFlight(
        fixture.playerId,
        fixture.founded.airlineId,
        secondFlight!.id,
        afterTraining,
      ),
    ]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const rejected = settled.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "workforce_shortage" } });
    const pilotAllocations = await sql<{
      count: string;
      capacity: string;
    }>`SELECT count(*)::text AS count,
      COALESCE(sum(capacity),0)::text AS capacity FROM workforce_allocations
      WHERE role = 'pilot' AND status = 'reserved'`.execute(runtime.database);
    expect(pilotAllocations.rows[0]).toEqual({ count: "1", capacity: "2" });
  });

  it("accrues recurring wages exactly once from deterministic checkpoints", async () => {
    const fixture = await setup();
    await hireMinimum(fixture);
    await fixture.workforce.listPools(fixture.playerId, fixture.founded.airlineId, afterTraining);
    const through = new Date("2026-07-17T00:00:00.000Z");
    const first = await fixture.workforce.accrueWages(
      fixture.playerId,
      fixture.founded.airlineId,
      through,
      `wages-${randomUUID()}`,
      through,
    );
    const repeat = await fixture.workforce.accrueWages(
      fixture.playerId,
      fixture.founded.airlineId,
      through,
      `wages-repeat-${randomUUID()}`,
      through,
    );
    expect(first).toHaveLength(3);
    expect(repeat).toEqual([]);
    const reconciliation = await sql<{ state_total: string; ledger_total: string }>`SELECT
      (SELECT COALESCE(sum(amount_minor),0)::text FROM workforce_wage_accruals) AS state_total,
      (SELECT COALESCE(sum(p.reporting_amount_minor),0)::text FROM workforce_wage_accruals a
        JOIN journal_entries j ON j.id = a.journal_entry_id
        JOIN ledger_postings p ON p.journal_entry_id = j.id
        JOIN ledger_accounts account ON account.id = p.account_id
        WHERE account.code = '5100' AND p.side = 'debit') AS ledger_total`.execute(
      runtime.database,
    );
    expect(reconciliation.rows[0]?.state_total).toBe(reconciliation.rows[0]?.ledger_total);
  });
});
