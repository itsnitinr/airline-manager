import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deterministicFault, forecastRoute, type FoundingSelection } from "@airline-manager/domain";
import { KyselyAirlineFoundingRepository } from "../airline/repository.js";
import { seedSliceOneCatalog } from "../catalog/seed.js";
import { readDatabasePoolOptions } from "../config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import { KyselyFleetRepository } from "../fleet/repository.js";
import { KyselyMarketRepository } from "../market/repository.js";
import { KyselySchedulingRepository } from "../scheduling/repository.js";
import { KyselyWorkforceRepository } from "../workforce/repository.js";
import { KyselyMaintenanceRepository } from "./repository.js";

let runtime: DatabaseRuntime;
const foundedAt = new Date("2026-07-12T00:00:00.000Z");
const afterTraining = new Date("2026-07-15T00:00:00.000Z");

async function createPlayer(): Promise<string> {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Maintenance Test', ${`maintenance-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id = ${user.rows[0]!.id}::uuid`.execute(runtime.database);
  return player.rows[0]!.id;
}

function selection(): FoundingSelection {
  return {
    airlineName: `Maintenance ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "MX" },
    acceptFoundingLoan: false,
    worldRulesetVersion: "contemporary-2026.07.11",
  };
}

async function setup(withSchedule = false) {
  const playerId = await createPlayer();
  const founded = await new KyselyAirlineFoundingRepository(runtime.database).confirm(
    playerId,
    selection(),
    `found-${randomUUID()}`,
    foundedAt,
  );
  const lease = await new KyselyFleetRepository(runtime.database).acceptFounderLease(
    playerId,
    founded.airlineId,
    "founder-atr-72-600",
    `lease-${randomUUID()}`,
    foundedAt,
  );
  const workforce = new KyselyWorkforceRepository(runtime.database);
  await workforce.hire(
    playerId,
    founded.airlineId,
    { role: "line_maintenance", capacity: 2 },
    `line-${randomUUID()}`,
    foundedAt,
  );
  await workforce.listPools(playerId, founded.airlineId, afterTraining);
  let flights: readonly Readonly<{
    id: string;
    departureAt: string;
    arrivalAt: string;
    readyAt: string;
  }>[] = [];
  if (withSchedule) {
    const markets = new KyselyMarketRepository(runtime.database);
    const scheduling = new KyselySchedulingRepository(runtime.database);
    const market = await markets.research(playerId, founded.airlineId, "JFK", "PHL", foundedAt);
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
      foundedAt,
    );
    flights = (
      await scheduling.activateTimetable(
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
        foundedAt,
      )
    ).flights;
  }
  return {
    playerId,
    airlineId: founded.airlineId,
    aircraftId: lease.aircraft.id,
    maintenance: new KyselyMaintenanceRepository(runtime.database),
    workforce,
    flights,
  };
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

describe("PostgreSQL aircraft maintenance", () => {
  it("publishes immutable aircraft-variant programs and real-day counters", async () => {
    const fixture = await setup();
    const program = await fixture.maintenance.program(
      fixture.playerId,
      fixture.airlineId,
      fixture.aircraftId,
      foundedAt,
    );
    expect(program).toMatchObject({
      version: "maintenance-v1",
      aircraftVariantCode: "atr-72-600",
      calendarSemantics: "elapsed_utc_days",
    });
    expect(program.rules).toHaveLength(2);
    const overdue = await fixture.maintenance.forecast(
      fixture.playerId,
      fixture.airlineId,
      fixture.aircraftId,
      new Date("2026-07-27T00:00:00.000Z"),
    );
    expect(overdue.dispatchReady).toBe(false);
    expect(overdue.due).toContainEqual(
      expect.objectContaining({ ruleCode: "atr_calendar_package", state: "hard_overdue" }),
    );
    expect(overdue.recoverySteps.join(" ")).toContain("qualified line-maintenance capacity");
    await expect(
      sql`UPDATE maintenance_program_rules SET duration_minutes = duration_minutes + 1`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("increments hours and cycles exactly once under retries and concurrent delivery", async () => {
    const fixture = await setup();
    const input = {
      completionKey: `completion-${randomUUID()}`,
      aircraftId: fixture.aircraftId,
      completedAt: "2026-07-15T01:00:00.000Z",
      blockMinutes: 75,
      cycles: 1,
      faultSeed: "stable-seed",
    };
    const [first, replay] = await Promise.all([
      fixture.maintenance.recordFlightCompletion(
        fixture.playerId,
        fixture.airlineId,
        input,
        afterTraining,
      ),
      fixture.maintenance.recordFlightCompletion(
        fixture.playerId,
        fixture.airlineId,
        input,
        afterTraining,
      ),
    ]);
    expect(replay).toEqual(first);
    const state = await sql<{
      hours: string;
      cycles: string;
      inputs: string;
      history: string;
    }>`SELECT
      (SELECT accumulated_hours_minutes::text FROM aircraft WHERE id = ${fixture.aircraftId}::uuid) AS hours,
      (SELECT accumulated_cycles::text FROM aircraft WHERE id = ${fixture.aircraftId}::uuid) AS cycles,
      (SELECT count(*)::text FROM flight_completion_utilization_inputs WHERE completion_key = ${input.completionKey}) AS inputs,
      (SELECT count(*)::text FROM maintenance_history WHERE aircraft_id = ${fixture.aircraftId}::uuid
        AND event_type = 'utilization_recorded') AS history`.execute(runtime.database);
    expect(state.rows[0]).toMatchObject({ hours: "75", cycles: "1", inputs: "1", history: "1" });
    await expect(
      fixture.maintenance.recordFlightCompletion(
        fixture.playerId,
        fixture.airlineId,
        { ...input, blockMinutes: 76 },
        afterTraining,
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("prevents planned maintenance from overlapping dated-flight occupancy", async () => {
    const fixture = await setup(true);
    const flight = fixture.flights[0]!;
    await expect(
      fixture.maintenance.scheduleWork(
        fixture.playerId,
        fixture.airlineId,
        fixture.aircraftId,
        { ruleCode: "atr_line_service", startsAt: flight.departureAt },
        `overlap-${randomUUID()}`,
        afterTraining,
      ),
    ).rejects.toMatchObject({ code: "occupancy_conflict" });
    const count = await sql<{
      count: string;
    }>`SELECT count(*)::text AS count FROM maintenance_windows`.execute(runtime.database);
    expect(count.rows[0]?.count).toBe("0");
  });

  it("persists reproducible bounded grounding faults with explicit repair requirements", async () => {
    const fixture = await setup();
    await fixture.maintenance.program(
      fixture.playerId,
      fixture.airlineId,
      fixture.aircraftId,
      foundedAt,
    );
    await sql`UPDATE aircraft SET condition_basis_points = 0,
      dispatch_reliability_basis_points = 5000, version = version + 1
      WHERE id = ${fixture.aircraftId}::uuid`.execute(runtime.database);
    const completionKey = `fault-${randomUUID()}`;
    const snapshot = {
      aircraftId: fixture.aircraftId,
      completionKey,
      programVersion: "maintenance-v1",
      conditionBasisPoints: 0,
      dispatchReliabilityBasisPoints: 8_000,
      accumulatedHoursMinutes: "60",
      accumulatedCycles: "1",
    };
    let faultSeed = "";
    for (let index = 0; index < 10_000; index += 1) {
      const candidate = `ground-${index}`;
      if (deterministicFault(candidate, snapshot).outcome === "grounding") {
        faultSeed = candidate;
        break;
      }
    }
    expect(faultSeed).not.toBe("");
    const input = {
      completionKey,
      aircraftId: fixture.aircraftId,
      completedAt: "2026-07-15T01:00:00.000Z",
      blockMinutes: 60,
      cycles: 1,
      faultSeed,
    };
    const result = await fixture.maintenance.recordFlightCompletion(
      fixture.playerId,
      fixture.airlineId,
      input,
      afterTraining,
    );
    const replay = await fixture.maintenance.recordFlightCompletion(
      fixture.playerId,
      fixture.airlineId,
      input,
      afterTraining,
    );
    expect(replay).toEqual(result);
    expect(result.fault).toMatchObject({
      outcome: "grounding",
      groundsAircraft: true,
      repairDurationMinutes: 360,
      repairWorkforceCapacity: 2,
      id: expect.any(String),
    });
    const readiness = await fixture.maintenance.dispatchReadiness(
      fixture.playerId,
      fixture.airlineId,
      fixture.aircraftId,
      afterTraining,
    );
    expect(readiness.dispatchReady).toBe(false);
    expect(readiness.recoverySteps.join(" ")).toContain(String(result.fault.id));
    const faultId = result.fault.id;
    if (!faultId) throw new Error("Grounding fault id was not persisted.");
    const repair = await fixture.maintenance.scheduleWork(
      fixture.playerId,
      fixture.airlineId,
      fixture.aircraftId,
      { faultId, startsAt: "2026-07-16T00:00:00.000Z" },
      `repair-${randomUUID()}`,
      afterTraining,
    );
    const completed = await fixture.maintenance.completeWork(
      fixture.playerId,
      fixture.airlineId,
      repair.id,
      "repair-complete",
      new Date(repair.endsAt),
    );
    expect(completed).toMatchObject({ source: "repair", status: "completed" });
    const fault = await sql<{ status: string; repaired_at: Date | null }>`SELECT status, repaired_at
      FROM maintenance_faults WHERE id = ${faultId}::uuid`.execute(runtime.database);
    expect(fault.rows[0]).toMatchObject({ status: "repaired", repaired_at: expect.any(Date) });
  });

  it("does not double-allocate line-maintenance capacity already reserved by flight readiness", async () => {
    const fixture = await setup(true);
    const flight = fixture.flights[0]!;
    await fixture.workforce.hire(
      fixture.playerId,
      fixture.airlineId,
      {
        role: "pilot",
        capacity: 2,
        qualificationAircraftVariantId: (
          await sql<{ aircraft_variant_id: string }>`SELECT aircraft_variant_id FROM aircraft
          WHERE id = ${fixture.aircraftId}::uuid`.execute(runtime.database)
        ).rows[0]!.aircraft_variant_id,
      },
      `pilot-${randomUUID()}`,
      foundedAt,
    );
    await fixture.workforce.hire(
      fixture.playerId,
      fixture.airlineId,
      { role: "cabin_crew", capacity: 2 },
      `cabin-${randomUUID()}`,
      foundedAt,
    );
    await fixture.workforce.listPools(fixture.playerId, fixture.airlineId, afterTraining);
    await fixture.workforce.allocateFlight(
      fixture.playerId,
      fixture.airlineId,
      flight.id,
      afterTraining,
    );
    const startsAt = new Date(flight.readyAt);
    await sql`UPDATE workforce_allocations SET recovery_ends_at = ${new Date(startsAt.getTime() + 60 * 60_000).toISOString()}::timestamptz
      WHERE dated_flight_id = ${flight.id}::uuid AND role = 'line_maintenance'`.execute(
      runtime.database,
    );
    await expect(
      fixture.maintenance.scheduleWork(
        fixture.playerId,
        fixture.airlineId,
        fixture.aircraftId,
        { ruleCode: "atr_calendar_package", startsAt: startsAt.toISOString() },
        `capacity-${randomUUID()}`,
        afterTraining,
      ),
    ).rejects.toMatchObject({ code: "workforce_shortage" });
  });

  it("completes work idempotently and reconciles append-only history to a balanced ledger journal", async () => {
    const fixture = await setup();
    const work = await fixture.maintenance.scheduleWork(
      fixture.playerId,
      fixture.airlineId,
      fixture.aircraftId,
      { ruleCode: "atr_line_service", startsAt: "2026-07-16T00:00:00.000Z" },
      `plan-${randomUUID()}`,
      afterTraining,
    );
    const completedAt = new Date(work.endsAt);
    const completed = await fixture.maintenance.completeWork(
      fixture.playerId,
      fixture.airlineId,
      work.id,
      "complete-stable",
      completedAt,
    );
    const replay = await fixture.maintenance.completeWork(
      fixture.playerId,
      fixture.airlineId,
      work.id,
      "complete-stable",
      completedAt,
    );
    expect(replay).toEqual(completed);
    expect(completed).toMatchObject({ status: "completed", journalEntryId: expect.any(String) });
    const reconciliation = await sql<{
      cost: string;
      debit: string;
      credit: string;
      history_journal: string;
    }>`SELECT package.cost_minor::text AS cost,
      COALESCE(sum(CASE WHEN posting.side = 'debit' THEN posting.reporting_amount_minor ELSE 0 END),0)::text AS debit,
      COALESCE(sum(CASE WHEN posting.side = 'credit' THEN posting.reporting_amount_minor ELSE 0 END),0)::text AS credit,
      (SELECT journal_entry_id::text FROM maintenance_history WHERE event_type = 'work_completed'
        AND details ->> 'workPackageId' = ${work.id}) AS history_journal
      FROM maintenance_work_packages package
      JOIN ledger_postings posting ON posting.journal_entry_id = package.journal_entry_id
      WHERE package.id = ${work.id}::uuid GROUP BY package.cost_minor`.execute(runtime.database);
    expect(reconciliation.rows[0]?.debit).toBe(reconciliation.rows[0]?.cost);
    expect(reconciliation.rows[0]?.credit).toBe(reconciliation.rows[0]?.cost);
    expect(reconciliation.rows[0]?.history_journal).toBe(completed.journalEntryId);
    await expect(
      sql`UPDATE maintenance_history SET event_type = 'work_planned' WHERE event_type = 'work_completed'`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});
