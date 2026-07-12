import { randomUUID } from "node:crypto";
import { WeatherService } from "@airline-manager/application";
import {
  KyselyAirlineFoundingRepository,
  KyselyFleetRepository,
  KyselyIdentityRepository,
  KyselyMarketRepository,
  KyselySchedulingRepository,
  KyselyWeatherRepository,
  createDatabaseRuntime,
  readDatabasePoolOptions,
  seedSliceOneCatalog,
  type DatabaseRuntime,
} from "@airline-manager/database";
import { forecastRoute, type FoundingSelection } from "@airline-manager/domain";
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "../app.js";

let runtime: DatabaseRuntime;
let app: FastifyInstance | undefined;
const now = new Date("2026-07-12T00:00:00.000Z");

async function playerAndRoute() {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Weather API', ${`weather-api-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{
    id: string;
  }>`SELECT id FROM player_accounts WHERE authentication_user_id = ${user.rows[0]!.id}::uuid`.execute(
    runtime.database,
  );
  const playerId = player.rows[0]!.id;
  const selection: FoundingSelection = {
    airlineName: `API Weather ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "AW" },
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
  return {
    playerId,
    airlineId: founded.airlineId,
    routeId: route.id,
    flightId: activation.flights[0]!.id,
  };
}

function api(playerId: string) {
  const identities = new KyselyIdentityRepository(runtime.database);
  app = createApiServer({
    logger: false,
    authorizationResolver: async () => ({
      authenticated: true,
      authenticationUserId: randomUUID(),
      playerAccountId: playerId,
      emailVerified: true,
      roles: ["player"],
    }),
    weatherService: new WeatherService(new KyselyWeatherRepository(runtime.database), identities, {
      now: () => now,
    }),
  });
  return app;
}

beforeAll(async () => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
  await seedSliceOneCatalog(runtime.database);
});
beforeEach(async () => {
  await app?.close();
  app = undefined;
  await sql`TRUNCATE game_worlds, ledger_books, auth_user, idempotency_commands, outbox_events CASCADE`.execute(
    runtime.database,
  );
});
afterAll(async () => {
  await app?.close();
  await runtime.destroy();
});

describe("authenticated weather API", () => {
  it("returns explainable route and departure forecasts to the owner", async () => {
    const owner = await playerAndRoute();
    const server = api(owner.playerId);
    const route = await server.inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/routes/${owner.routeId}/weather-forecast?validAt=2026-07-13T12:00:00.000Z`,
    });
    expect(route.statusCode, route.body).toBe(200);
    expect(route.json()).toMatchObject({
      scope: "route",
      plan: { bounds: { blockTimeBasisPoints: [9000, 13500], fuelBurnBasisPoints: [9500, 12500] } },
    });
    const departure = await server.inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/departures/${owner.flightId}/weather-forecast`,
    });
    expect(departure.statusCode, departure.body).toBe(200);
    expect(departure.json()).toMatchObject({ scope: "departure", scopeId: owner.flightId });
  });

  it("denies cross-airline forecast access without leaking existence", async () => {
    const owner = await playerAndRoute();
    const foreign = await playerAndRoute();
    const denied = await api(foreign.playerId).inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/routes/${owner.routeId}/weather-forecast?validAt=2026-07-13T12:00:00.000Z`,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});
