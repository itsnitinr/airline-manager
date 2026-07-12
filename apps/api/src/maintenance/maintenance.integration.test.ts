import { randomUUID } from "node:crypto";
import { MaintenanceService } from "@airline-manager/application";
import {
  KyselyAirlineFoundingRepository,
  KyselyFleetRepository,
  KyselyIdentityRepository,
  KyselyMaintenanceRepository,
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
const foundedAt = new Date("2026-07-12T00:00:00.000Z");
const now = new Date("2026-07-15T00:00:00.000Z");

async function playerAirline() {
  const user = await sql<{ id: string }>`INSERT INTO auth_user (name, email, "emailVerified")
    VALUES ('Maintenance API', ${`maintenance-api-${randomUUID()}@example.test`}, true) RETURNING id`.execute(
    runtime.database,
  );
  const player = await sql<{ id: string }>`SELECT id FROM player_accounts
    WHERE authentication_user_id = ${user.rows[0]!.id}::uuid`.execute(runtime.database);
  const playerId = player.rows[0]!.id;
  const selection: FoundingSelection = {
    airlineName: `API Maintenance ${randomUUID().slice(0, 8)}`,
    fictionalIdentityConfirmed: true,
    homeJurisdiction: "US",
    principalBaseIataCode: "JFK",
    reportingCurrency: "USD",
    brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "AM" },
    acceptFoundingLoan: false,
    worldRulesetVersion: "contemporary-2026.07.11",
  };
  const founded = await new KyselyAirlineFoundingRepository(runtime.database).confirm(
    playerId,
    selection,
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
  await workforce.listPools(playerId, founded.airlineId, now);
  return { playerId, airlineId: founded.airlineId, aircraftId: lease.aircraft.id };
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
    maintenanceService: new MaintenanceService(
      new KyselyMaintenanceRepository(runtime.database),
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

describe("authenticated maintenance API", () => {
  it("exposes the versioned program, exact-once completion input, planning, forecast, and history", async () => {
    const owner = await playerAirline();
    const api = fixture(owner.playerId);
    const base = `/v1/airlines/${owner.airlineId}/aircraft/${owner.aircraftId}/maintenance`;
    const program = await api.inject({ method: "GET", url: `${base}/program` });
    expect(program.statusCode, program.body).toBe(200);
    expect(program.json()).toMatchObject({
      version: "maintenance-v1",
      aircraftVariantCode: "atr-72-600",
    });
    const completionRequest = {
      method: "POST" as const,
      url: `${base}/flight-completions`,
      headers: { "idempotency-key": "api-completion" },
      payload: {
        completionKey: "external-flight-001",
        completedAt: "2026-07-15T01:00:00.000Z",
        blockMinutes: 60,
        cycles: 1,
        faultSeed: "api-seed",
      },
    };
    const completion = await api.inject(completionRequest);
    const replay = await api.inject(completionRequest);
    expect(completion.statusCode, completion.body).toBe(200);
    expect(replay.json()).toEqual(completion.json());
    const planned = await api.inject({
      method: "POST",
      url: `${base}/windows`,
      headers: { "idempotency-key": "api-plan" },
      payload: { ruleCode: "atr_line_service", startsAt: "2026-07-16T00:00:00.000Z" },
    });
    expect(planned.statusCode, planned.body).toBe(201);
    expect(planned.json()).toMatchObject({ source: "planned", status: "planned" });
    const forecast = await api.inject({ method: "GET", url: `${base}/forecast` });
    const readiness = await api.inject({
      method: "GET",
      url: `${base}/readiness?at=2026-07-15T02%3A00%3A00.000Z`,
    });
    const history = await api.inject({ method: "GET", url: `${base}/history` });
    expect(forecast.statusCode, forecast.body).toBe(200);
    expect(readiness.statusCode, readiness.body).toBe(200);
    expect(forecast.json()).toMatchObject({ programVersion: "maintenance-v1" });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "program_assigned" }),
        expect.objectContaining({ eventType: "utilization_recorded" }),
        expect.objectContaining({ eventType: "work_planned" }),
      ]),
    );
  });

  it("denies cross-airline maintenance reads and commands", async () => {
    const owner = await playerAirline();
    const foreign = await playerAirline();
    const api = fixture(foreign.playerId);
    const base = `/v1/airlines/${owner.airlineId}/aircraft/${owner.aircraftId}/maintenance`;
    const program = await api.inject({ method: "GET", url: `${base}/program` });
    const completion = await api.inject({
      method: "POST",
      url: `${base}/flight-completions`,
      headers: { "idempotency-key": "foreign-completion" },
      payload: {
        completionKey: "foreign-flight",
        completedAt: "2026-07-15T01:00:00.000Z",
        blockMinutes: 60,
        cycles: 1,
        faultSeed: "foreign-seed",
      },
    });
    expect(program.statusCode).toBe(403);
    expect(program.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(completion.statusCode).toBe(403);
  });
});
