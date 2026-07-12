import { randomUUID } from "node:crypto";
import { MarketService } from "@airline-manager/application";
import {
  KyselyAirlineFoundingRepository,
  KyselyIdentityRepository,
  KyselyMarketRepository,
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

async function playerAndAirline() {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Market API', ${`market-api-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id = ${user.rows[0]?.id}::uuid`.execute(runtime.database);
  const playerId = player.rows[0]?.id;
  if (!playerId) throw new Error("Market API player missing.");
  const selection: FoundingSelection = {
    airlineName: `API Market ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "AP" },
    acceptFoundingLoan: false,
    worldRulesetVersion: "contemporary-2026.07.11",
  };
  const founded = await new KyselyAirlineFoundingRepository(runtime.database).confirm(
    playerId,
    selection,
    `api-found-${randomUUID()}`,
    now,
  );
  return { playerId, airlineId: founded.airlineId };
}

function createFixture(playerId: string) {
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
    marketService: new MarketService(new KyselyMarketRepository(runtime.database), identities, {
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
  await sql`TRUNCATE game_worlds, ledger_books, auth_user, idempotency_commands,
    outbox_events CASCADE`.execute(runtime.database);
});

afterAll(async () => {
  await app?.close();
  await runtime.destroy();
});

describe("authenticated direct passenger market API", () => {
  it("researches, prices, binds an opaque offer, refreshes, and explains commercial results", async () => {
    const owner = await playerAndAirline();
    const api = createFixture(owner.playerId);
    const research = await api.inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/markets/research?origin=JFK&destination=LAX&at=${encodeURIComponent(now.toISOString())}`,
    });
    expect(research.statusCode).toBe(200);
    expect(research.json()).toMatchObject({
      forecast: { originIataCode: "JFK", destinationIataCode: "LAX" },
      competition: { classification: "simulated_aggregate_market_pressure" },
    });
    const marketId = String(research.json().marketId);
    const pricing = await api.inject({
      method: "POST",
      url: `/v1/airlines/${owner.airlineId}/markets/pricing-strategies`,
      headers: { "idempotency-key": "market-pricing-one" },
      payload: {
        marketId,
        effectiveFrom: now.toISOString(),
        posture: "balanced",
        baseFareMinor: "30000",
        minimumFareMinor: "15000",
        maximumFareMinor: "60000",
        loadFactorTargetBasisPoints: 8200,
        revenueTargetMinor: "0",
      },
    });
    expect(pricing.statusCode).toBe(201);
    const offerId = randomUUID();
    const offer = await api.inject({
      method: "POST",
      url: `/v1/airlines/${owner.airlineId}/commercial-flight-offers`,
      headers: { "idempotency-key": "market-offer-one" },
      payload: {
        offerId,
        marketId,
        economySellableCapacity: 72,
        bookingOpensAt: now.toISOString(),
        departureAt: "2026-07-22T12:00:00.000Z",
        scheduledArrivalAt: "2026-07-22T18:00:00.000Z",
        durationMinutes: 360,
        scheduleQualityBasisPoints: 9000,
        serviceQualityBasisPoints: 8000,
        reputationBasisPoints: 8000,
        sourceType: "ticket11_fixture",
        sourceVersion: "fixture-v1",
        sourceReference: "api-fixture-flight",
      },
    });
    expect(offer.statusCode).toBe(201);
    const refreshInput = {
      method: "POST" as const,
      url: `/v1/airlines/${owner.airlineId}/commercial-flight-offers/${offerId}/bookings/refresh`,
      headers: { "idempotency-key": "market-refresh-one" },
      payload: { checkpointAt: "2026-07-20T00:00:00.000Z" },
    };
    const refreshed = await api.inject(refreshInput);
    const repeated = await api.inject(refreshInput);
    expect(refreshed.statusCode).toBe(200);
    expect(repeated.json()).toEqual(refreshed.json());
    const analytics = await api.inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/commercial-flight-offers/${offerId}/bookings?at=${encodeURIComponent("2026-07-20T00:00:00.000Z")}`,
    });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.json()).toMatchObject({
      offer: { offerId, economySellableCapacity: 72 },
      ledgerRevenuePosted: false,
      segmentMix: {
        business: expect.any(String),
        leisure: expect.any(String),
        vfr: expect.any(String),
      },
      explanation: expect.arrayContaining([expect.stringContaining("exact realized minor-unit")]),
    });
  });

  it("returns explainable validation and ownership denials without echoing sensitive input", async () => {
    const owner = await playerAndAirline();
    const foreign = await playerAndAirline();
    const api = createFixture(foreign.playerId);
    const denied = await api.inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/markets/research?origin=JFK&destination=LAX`,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "forbidden" } });
    const malformed = await api.inject({
      method: "POST",
      url: `/v1/airlines/${foreign.airlineId}/commercial-flight-offers`,
      headers: { "idempotency-key": "market-invalid-offer" },
      payload: { offerId: randomUUID(), sourceReference: "secret-token-must-not-echo" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain("secret-token-must-not-echo");
    expect(malformed.body).not.toMatch(/SELECT|constraint|password|cookie/i);
  });
});
