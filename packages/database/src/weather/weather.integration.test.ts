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
import { KyselyWeatherRepository } from "./repository.js";

let runtime: DatabaseRuntime;
const now = new Date("2026-07-12T00:00:00.000Z");

async function setup() {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Weather Test', ${`weather-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id = ${user.rows[0]!.id}::uuid`.execute(runtime.database);
  const playerId = player.rows[0]!.id;
  const selection: FoundingSelection = {
    airlineName: `Weather ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "WX" },
    acceptFoundingLoan: false,
    worldRulesetVersion: "contemporary-2026.07.11",
  };
  const founded = await new KyselyAirlineFoundingRepository(runtime.database).confirm(
    playerId,
    selection,
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
  const activation = await scheduling.activateTimetable(
    playerId,
    founded.airlineId,
    route.id,
    {
      aircraftId: lease.aircraft.id,
      effectiveFromLocalDate: "2026-07-13",
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
    },
    now,
  );
  return { playerId, airlineId: founded.airlineId, route, activation };
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

describe("PostgreSQL generated weather", () => {
  it("publishes provenance-tracked climate coverage for every playable airport", async () => {
    const coverage = await sql<{
      playable: string;
      profiles: string;
      missing_provenance: string;
    }>`SELECT
      (SELECT count(*)::text FROM catalog_release_airports member JOIN catalog_releases release ON release.id = member.release_id WHERE release.status = 'published') AS playable,
      (SELECT count(*)::text FROM airport_climate_profiles profile JOIN climate_profile_versions version ON version.id = profile.climate_profile_version_id WHERE version.status = 'published') AS profiles,
      (SELECT count(*)::text FROM airport_climate_profiles WHERE provenance = '{}'::jsonb) AS missing_provenance`.execute(
      runtime.database,
    );
    expect(coverage.rows[0]).toEqual({ playable: "250", profiles: "250", missing_provenance: "0" });
  });

  it("persists immutable idempotent route/departure forecasts and seeded realizations", async () => {
    const fixture = await setup();
    const weather = new KyselyWeatherRepository(runtime.database);
    const validAt = new Date("2026-07-13T12:00:00Z");
    const [left, retried] = await Promise.all([
      weather.forecastRoute(fixture.playerId, fixture.airlineId, fixture.route.id, now, validAt),
      weather.forecastRoute(fixture.playerId, fixture.airlineId, fixture.route.id, now, validAt),
    ]);
    expect(retried).toEqual(left);
    expect(left.plan.expectedBlockTimeBasisPoints).toBeGreaterThanOrEqual(9_000);
    expect(left.plan.expectedFuelBurnBasisPoints).toBeLessThanOrEqual(12_500);
    const departure = await weather.forecastDeparture(
      fixture.playerId,
      fixture.airlineId,
      fixture.activation.flights[0]!.id,
      now,
    );
    const realized = await weather.realizeForecast(departure.id, new Date(departure.validAt));
    const repeated = await weather.realizeForecast(departure.id, new Date(departure.validAt));
    expect(repeated).toEqual(realized);
    expect(realized.uncertaintyProcessVersion).toBe("seeded-lead-spread-v1");
    await expect(
      sql`UPDATE weather_forecast_snapshots SET valid_at = valid_at + interval '1 hour'
        WHERE id = ${left.id}::uuid`.execute(runtime.database),
    ).rejects.toThrow(/immutable/);
  });

  it("keeps ticket 12 schedule facts unchanged while preserving planning material inputs", async () => {
    const fixture = await setup();
    const before = await sql<{
      snapshot: unknown;
      departure_at: Date;
      status: string;
    }>`SELECT forecast_snapshot AS snapshot, departure_at, status
      FROM dated_flights WHERE id = ${fixture.activation.flights[0]!.id}::uuid`.execute(
      runtime.database,
    );
    const forecast = await new KyselyWeatherRepository(runtime.database).forecastDeparture(
      fixture.playerId,
      fixture.airlineId,
      fixture.activation.flights[0]!.id,
      now,
    );
    const after = await sql<{
      snapshot: unknown;
      departure_at: Date;
      status: string;
    }>`SELECT forecast_snapshot AS snapshot, departure_at, status
      FROM dated_flights WHERE id = ${fixture.activation.flights[0]!.id}::uuid`.execute(
      runtime.database,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(forecast.materialInputSnapshot).toMatchObject({
      rules: {
        worldSeed: "slice-one-weather-seed-v1",
        weatherRulesetVersion: "weather-v1",
        climateDataVersion: "slice-one-climate-v1",
      },
      uncertaintyProcessVersion: "seeded-lead-spread-v1",
    });
  });
});
