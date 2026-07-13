import { randomUUID } from "node:crypto";
import { FlightOperationsService } from "@airline-manager/application";
import type {
  FlightOperationsRepository,
  FlightStatus,
  SettledFlightSnapshot,
} from "@airline-manager/domain";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../app.js";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const airlineId = randomUUID();
const flightId = randomUUID();
const ownerId = randomUUID();
const status: FlightStatus = {
  id: flightId,
  airlineId,
  flightNumber: "OP17",
  state: "settled",
  version: "5",
  departureAt: "2026-07-20T12:00:00.000Z",
  scheduledArrivalAt: "2026-07-20T13:00:00.000Z",
  effectiveAt: "2026-07-20T13:00:00.000Z",
  timeline: [
    {
      sequence: "1",
      fromState: null,
      toState: "scheduled",
      milestone: "automatic",
      reasonCode: "flight_generated",
      explanation: "Generated.",
      effectiveAt: "2026-07-12T00:00:00.000Z",
    },
  ],
};
const settlement: SettledFlightSnapshot = {
  id: randomUUID(),
  flightId,
  schemaVersion: 1,
  settledAt: "2026-07-20T13:00:00.000Z",
  materialInputs: { booking_lock: {}, dispatch: {}, arrival: {} },
  outcome: {
    realizedBlockMinutes: 60,
    delayMinutes: 0,
    diverted: false,
    passengersCarried: "40",
    fuelBurnKg: "900",
    passengerRevenueMinor: "400000",
    refundMinor: "0",
    airportCostMinor: "20000",
    wageAllocationMinor: "5100",
    maintenanceAllocationMinor: "4900",
    operatingResultMinor: "370000",
    formulaVersion: "flight-realization-v1",
    fuelCostMinor: "30000",
  },
  journalEntryIds: [randomUUID()],
  reconciliation: { fuelMovementId: randomUUID() },
  contentHash: "a".repeat(64),
};

function server(playerId: string, owns: boolean) {
  const operations: FlightOperationsRepository = {
    advanceMilestone: async () => "noop",
    status: async () => status,
    settlement: async () => settlement,
  };
  app = createApiServer({
    logger: false,
    authorizationResolver: async () => ({
      authenticated: true,
      authenticationUserId: randomUUID(),
      playerAccountId: playerId,
      emailVerified: true,
      roles: ["player"],
    }),
    flightOperationsService: new FlightOperationsService(operations, {
      ownsResource: async (candidate, type, id) =>
        owns && candidate === ownerId && type === "airline" && id === airlineId,
    }),
  });
  return app;
}

describe("authenticated flight operations API", () => {
  it("returns explainable owner-only status and settlement results", async () => {
    const api = server(ownerId, true);
    const state = await api.inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}/flights/${flightId}/status`,
    });
    expect(state.statusCode, state.body).toBe(200);
    expect(state.json()).toMatchObject({
      id: flightId,
      state: "settled",
      timeline: [{ reasonCode: "flight_generated" }],
    });
    const result = await api.inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}/flights/${flightId}/settlement`,
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({
      flightId,
      schemaVersion: 1,
      outcome: { operatingResultMinor: "370000" },
    });
  });

  it("denies foreign ownership without leaking flight existence", async () => {
    const denied = await server(randomUUID(), false).inject({
      method: "GET",
      url: `/v1/airlines/${airlineId}/flights/${flightId}/status`,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});
