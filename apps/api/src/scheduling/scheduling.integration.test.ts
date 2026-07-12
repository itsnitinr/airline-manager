import { randomUUID } from "node:crypto";
import { MarketService, SchedulingService } from "@airline-manager/application";
import {
  KyselyAirlineFoundingRepository,
  KyselyFleetRepository,
  KyselyIdentityRepository,
  KyselyMarketRepository,
  KyselySchedulingRepository,
  createDatabaseRuntime,
  readDatabasePoolOptions,
  seedSliceOneCatalog,
  type DatabaseRuntime,
} from "@airline-manager/database";
import type { FoundingSelection } from "@airline-manager/domain";
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiServer } from "../app.js";

let runtime: DatabaseRuntime;
let app: FastifyInstance | undefined;
const now = new Date("2026-07-12T00:00:00.000Z");

async function playerAirlineAndAircraft() {
  const user = await sql<{
    id: string;
  }>`INSERT INTO auth_user (name, email, "emailVerified") VALUES ('Schedule API', ${`schedule-api-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{
    id: string;
  }>`SELECT id FROM player_accounts WHERE authentication_user_id = ${user.rows[0]?.id}::uuid`.execute(
    runtime.database,
  );
  const playerId = player.rows[0]?.id;
  if (!playerId) throw new Error("Scheduling API player missing.");
  const selection: FoundingSelection = {
    airlineName: `API Schedule ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "AS" },
    acceptFoundingLoan: false,
    worldRulesetVersion: "contemporary-2026.07.11",
  };
  const founded = await new KyselyAirlineFoundingRepository(runtime.database).confirm(
    playerId,
    selection,
    `api-found-${randomUUID()}`,
    now,
  );
  const lease = await new KyselyFleetRepository(runtime.database).acceptFounderLease(
    playerId,
    founded.airlineId,
    "founder-atr-72-600",
    `api-lease-${randomUUID()}`,
    now,
  );
  return { playerId, airlineId: founded.airlineId, aircraftId: lease.aircraft.id };
}

function fixture(playerId: string) {
  const identities = new KyselyIdentityRepository(runtime.database);
  const markets = new KyselyMarketRepository(runtime.database);
  app = createApiServer({
    logger: false,
    authorizationResolver: async () => ({
      authenticated: true,
      authenticationUserId: randomUUID(),
      playerAccountId: playerId,
      emailVerified: true,
      roles: ["player"],
    }),
    marketService: new MarketService(markets, identities, { now: () => now }),
    schedulingService: new SchedulingService(
      new KyselySchedulingRepository(runtime.database),
      markets,
      identities,
      { now: () => now },
    ),
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

describe("authenticated scheduling API", () => {
  it("researches and activates a direct timetable whose dated flights cross the ticket 11 offer boundary", async () => {
    const owner = await playerAirlineAndAircraft();
    const api = fixture(owner.playerId);
    const research = await api.inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/routes/research?origin=JFK&destination=PHL&aircraftId=${owner.aircraftId}`,
    });
    expect(research.statusCode).toBe(200);
    expect(research.json()).toMatchObject({
      valid: true,
      forecast: { outsourcedService: true },
      issues: [],
    });
    const created = await api.inject({
      method: "POST",
      url: `/v1/airlines/${owner.airlineId}/routes`,
      headers: { "idempotency-key": "schedule-route-create" },
      payload: { originIataCode: "JFK", destinationIataCode: "PHL", aircraftId: owner.aircraftId },
    });
    expect(created.statusCode).toBe(201);
    const routeId = String(created.json().id);
    const activation = await api.inject({
      method: "POST",
      url: `/v1/airlines/${owner.airlineId}/routes/${routeId}/timetables`,
      headers: { "idempotency-key": "schedule-activate-one" },
      payload: {
        aircraftId: owner.aircraftId,
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
    });
    expect(activation.statusCode, activation.body).toBe(201);
    expect(activation.json()).toMatchObject({
      version: 1,
      generatedThrough: "2026-07-26",
      validation: { valid: true },
    });
    expect(activation.json().flights).toHaveLength(4);
    const offers = await sql<{
      value: string;
    }>`SELECT count(*)::text AS value FROM commercial_flight_offers WHERE source_type = 'external_dated_flight'`.execute(
      runtime.database,
    );
    expect(offers.rows[0]?.value).toBe("4");
  });

  it("denies cross-airline route research", async () => {
    const owner = await playerAirlineAndAircraft();
    const foreign = await playerAirlineAndAircraft();
    const api = fixture(foreign.playerId);
    const denied = await api.inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/routes/research?origin=JFK&destination=PHL&aircraftId=${owner.aircraftId}`,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});
