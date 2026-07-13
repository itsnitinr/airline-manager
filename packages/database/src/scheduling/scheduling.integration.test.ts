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
import { KyselySchedulingRepository } from "./repository.js";

let runtime: DatabaseRuntime;
const now = new Date("2026-07-12T00:00:00.000Z");

async function createPlayer(): Promise<string> {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Scheduling Test', ${`schedule-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{
    id: string;
  }>`SELECT id FROM player_accounts WHERE authentication_user_id = ${user.rows[0]?.id}::uuid`.execute(
    runtime.database,
  );
  if (!player.rows[0]) throw new Error("Scheduling player was not created.");
  return player.rows[0].id;
}

function selection(): FoundingSelection {
  return {
    airlineName: `Schedule ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "SC" },
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
    now,
  );
  return { playerId, founded, lease, scheduling, route };
}

const rotation = (aircraftId: string, effectiveFromLocalDate = "2026-07-13") => ({
  aircraftId,
  effectiveFromLocalDate,
  horizonDays: 14,
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
      departureLocalTime: "11:00",
    },
  ],
});

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

describe("PostgreSQL routes, timetables, rotations, and dated flights", () => {
  it("activates a coherent weekly rotation and generates a bounded local/UTC horizon", async () => {
    const fixture = await setup();
    const activation = await fixture.scheduling.activateTimetable(
      fixture.playerId,
      fixture.founded.airlineId,
      fixture.route.id,
      rotation(fixture.lease.aircraft.id),
      now,
    );
    expect(activation).toMatchObject({
      version: 1,
      effectiveFrom: "2026-07-13",
      generatedThrough: "2026-07-26",
      validation: { valid: true },
    });
    expect(activation.flights).toHaveLength(4);
    expect(activation.flights[0]).toMatchObject({
      originIataCode: "JFK",
      destinationIataCode: "PHL",
      departureLocal: "2026-07-13T08:00",
    });
    expect(new Date(activation.flights[0]!.departureAt).toISOString()).toBe(
      "2026-07-13T12:00:00.000Z",
    );
    expect(
      activation.flights.every((flight) => new Date(flight.readyAt) > new Date(flight.arrivalAt)),
    ).toBe(true);
    const records = await sql<{
      routes: string;
      versions: string;
      templates: string;
      rotations: string;
      flights: string;
      intents: string;
    }>`SELECT
      (SELECT count(*)::text FROM airline_routes) routes, (SELECT count(*)::text FROM timetable_versions) versions,
      (SELECT count(*)::text FROM flight_leg_templates) templates, (SELECT count(*)::text FROM aircraft_rotations) rotations,
      (SELECT count(*)::text FROM dated_flights) flights,
      (SELECT count(*)::text FROM outbox_events WHERE event_type = 'scheduling.horizon_generated.v1') intents`.execute(
      runtime.database,
    );
    expect(records.rows[0]).toEqual({
      routes: "1",
      versions: "1",
      templates: "2",
      rotations: "1",
      flights: "4",
      intents: "1",
    });
  });

  it("is concurrency-safe and retry-safe for activation and horizon extension", async () => {
    const fixture = await setup();
    const input = rotation(fixture.lease.aircraft.id);
    const [left, right] = await Promise.all([
      fixture.scheduling.activateTimetable(
        fixture.playerId,
        fixture.founded.airlineId,
        fixture.route.id,
        input,
        now,
      ),
      fixture.scheduling.activateTimetable(
        fixture.playerId,
        fixture.founded.airlineId,
        fixture.route.id,
        input,
        now,
      ),
    ]);
    expect(right.timetableVersionId).toBe(left.timetableVersionId);
    const through = new Date("2026-08-10T00:00:00Z");
    const [extended, repeated] = await Promise.all([
      fixture.scheduling.extendHorizon(
        fixture.playerId,
        fixture.founded.airlineId,
        left.timetableVersionId,
        through,
        now,
      ),
      fixture.scheduling.extendHorizon(
        fixture.playerId,
        fixture.founded.airlineId,
        left.timetableVersionId,
        through,
        now,
      ),
    ]);
    expect(repeated.flights).toEqual(extended.flights);
    const count = await sql<{
      value: string;
    }>`SELECT count(*)::text AS value FROM dated_flights`.execute(runtime.database);
    expect(count.rows[0]?.value).toBe(String(extended.flights.length));
  });

  it("protects sold flights from prospective version replacement", async () => {
    const fixture = await setup();
    const first = await fixture.scheduling.activateTimetable(
      fixture.playerId,
      fixture.founded.airlineId,
      fixture.route.id,
      rotation(fixture.lease.aircraft.id),
      now,
    );
    const protectedFlight = first.flights.find((flight) => flight.serviceDate === "2026-07-20")!;
    await sql`UPDATE dated_flights SET status = 'boarding', version = version + 1,
      state_effective_at = departure_at - INTERVAL '30 minutes' WHERE id = ${protectedFlight.id}::uuid`.execute(
      runtime.database,
    );
    await expect(
      fixture.scheduling.activateTimetable(
        fixture.playerId,
        fixture.founded.airlineId,
        fixture.route.id,
        {
          ...rotation(fixture.lease.aircraft.id, "2026-07-20"),
          legs: [
            {
              dayOfWeek: 1,
              originIataCode: "JFK",
              destinationIataCode: "PHL",
              departureLocalTime: "09:00",
            },
            {
              dayOfWeek: 1,
              originIataCode: "PHL",
              destinationIataCode: "JFK",
              departureLocalTime: "12:00",
            },
          ],
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "historical_flight_protected" });
    const retained = await sql<{
      status: string;
      departure_at: Date;
    }>`SELECT status, departure_at FROM dated_flights WHERE id = ${protectedFlight.id}::uuid`.execute(
      runtime.database,
    );
    expect(retained.rows[0]).toEqual({
      status: "boarding",
      departure_at: new Date(protectedFlight.departureAt),
    });
    await expect(
      sql`DELETE FROM dated_flights WHERE id = ${protectedFlight.id}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("creates prospective versions after the protected horizon without rewriting prior flights", async () => {
    const fixture = await setup();
    const first = await fixture.scheduling.activateTimetable(
      fixture.playerId,
      fixture.founded.airlineId,
      fixture.route.id,
      rotation(fixture.lease.aircraft.id),
      now,
    );
    const second = await fixture.scheduling.activateTimetable(
      fixture.playerId,
      fixture.founded.airlineId,
      fixture.route.id,
      {
        ...rotation(fixture.lease.aircraft.id, "2026-08-03"),
        legs: [
          {
            dayOfWeek: 1,
            originIataCode: "JFK",
            destinationIataCode: "PHL",
            departureLocalTime: "09:00",
          },
          {
            dayOfWeek: 1,
            originIataCode: "PHL",
            destinationIataCode: "JFK",
            departureLocalTime: "12:00",
          },
        ],
      },
      now,
    );
    expect(second.version).toBe(2);
    expect(second.timetableVersionId).not.toBe(first.timetableVersionId);
    const versions = await sql<{
      version: number;
      status: string;
      effective_to: string | null;
    }>`SELECT version, status, effective_to::text FROM timetable_versions ORDER BY version`.execute(
      runtime.database,
    );
    expect(versions.rows).toMatchObject([
      { version: 1, status: "superseded", effective_to: "2026-08-03" },
      { version: 2, status: "active", effective_to: null },
    ]);
    const retained = await sql<{
      value: string;
    }>`SELECT count(*)::text AS value FROM dated_flights WHERE timetable_version_id = ${first.timetableVersionId}::uuid`.execute(
      runtime.database,
    );
    expect(retained.rows[0]?.value).toBe("4");
  });

  it("keeps active scheduling and airport policy versions immutable", async () => {
    await setup();
    await expect(
      sql`UPDATE airport_scheduling_rules SET hourly_movement_ceiling = hourly_movement_ceiling + 1`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`DELETE FROM scheduling_ruleset_versions WHERE status = 'active'`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("enforces aircraft occupancy overlap in PostgreSQL independently of domain validation", async () => {
    const fixture = await setup();
    const activation = await fixture.scheduling.activateTimetable(
      fixture.playerId,
      fixture.founded.airlineId,
      fixture.route.id,
      rotation(fixture.lease.aircraft.id),
      now,
    );
    const flightId = activation.flights[0]!.id;
    const templateId = randomUUID();
    await sql`INSERT INTO flight_leg_templates (id, timetable_version_id, sequence, day_of_week, origin_airport_id, destination_airport_id,
      departure_local_time, origin_timezone, destination_timezone, planned_block_minutes, minimum_turnaround_minutes)
      SELECT ${templateId}::uuid, timetable_version_id, 99, day_of_week, origin_airport_id, destination_airport_id, departure_local_time,
        origin_timezone, destination_timezone, planned_block_minutes, minimum_turnaround_minutes FROM flight_leg_templates
      WHERE timetable_version_id = ${activation.timetableVersionId}::uuid LIMIT 1`.execute(
      runtime.database,
    );
    await expect(
      sql`INSERT INTO dated_flights (id, route_id, timetable_version_id, flight_leg_template_id, rotation_id, aircraft_id, market_id,
      service_date, flight_number, origin_airport_id, destination_airport_id, departure_local, arrival_local, departure_at, arrival_at, ready_at,
      planned_block_minutes, minimum_turnaround_minutes, status, ruleset_version, forecast_snapshot, created_at)
      SELECT gen_random_uuid(), route_id, timetable_version_id, ${templateId}::uuid, rotation_id, aircraft_id, market_id, service_date, 'AM999',
        origin_airport_id, destination_airport_id, departure_local, arrival_local, departure_at, arrival_at, ready_at, planned_block_minutes,
        minimum_turnaround_minutes, status, ruleset_version, forecast_snapshot, created_at FROM dated_flights WHERE id = ${flightId}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "23P01" });
  });
});
