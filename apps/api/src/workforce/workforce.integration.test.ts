import { randomUUID } from "node:crypto";
import { WorkforceService } from "@airline-manager/application";
import {
  KyselyAirlineFoundingRepository,
  KyselyFleetRepository,
  KyselyIdentityRepository,
  KyselyWorkforceRepository,
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

async function playerAirline() {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Workforce API', ${`workforce-api-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id = ${user.rows[0]?.id}::uuid`.execute(runtime.database);
  const playerId = player.rows[0]?.id;
  if (!playerId) throw new Error("Workforce API player missing.");
  const selection: FoundingSelection = {
    airlineName: `API Workforce ${randomUUID().slice(0, 8)}`,
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
  return { playerId, airlineId: founded.airlineId, variantId: lease.aircraft.variantId };
}

function fixture(playerId: string) {
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
    workforceService: new WorkforceService(
      new KyselyWorkforceRepository(runtime.database),
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

describe("authenticated workforce API", () => {
  it("returns founder packages and creates an idempotent qualified training order", async () => {
    const owner = await playerAirline();
    const api = fixture(owner.playerId);
    const recommendations = await api.inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/workforce/recommendations`,
    });
    expect(recommendations.statusCode).toBe(200);
    expect(recommendations.json()).toHaveLength(4);
    const request = {
      method: "POST" as const,
      url: `/v1/airlines/${owner.airlineId}/workforce/hiring`,
      headers: { "idempotency-key": "workforce-api-pilot" },
      payload: { role: "pilot", capacity: 2, qualificationAircraftVariantId: owner.variantId },
    };
    const hired = await api.inject(request);
    const replay = await api.inject(request);
    expect(hired.statusCode, hired.body).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(hired.json());
    expect(hired.json()).toMatchObject({
      capacity: 2,
      status: "training",
      availableAt: "2026-07-14T00:00:00.000Z",
      pool: { role: "pilot", qualification: { code: "variant:atr-72-600" } },
    });
  });

  it("denies cross-airline workforce reads and commands", async () => {
    const owner = await playerAirline();
    const foreign = await playerAirline();
    const api = fixture(foreign.playerId);
    const list = await api.inject({
      method: "GET",
      url: `/v1/airlines/${owner.airlineId}/workforce/pools`,
    });
    const hire = await api.inject({
      method: "POST",
      url: `/v1/airlines/${owner.airlineId}/workforce/hiring`,
      headers: { "idempotency-key": "foreign-workforce" },
      payload: { role: "cabin_crew", capacity: 2 },
    });
    expect(list.statusCode).toBe(403);
    expect(list.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(hire.statusCode).toBe(403);
  });
});
