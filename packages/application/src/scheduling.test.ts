import { describe, expect, it, vi } from "vitest";
import type {
  IdentityRepository,
  MarketRepository,
  SchedulingRepository,
  TimetableActivation,
} from "@airline-manager/domain";
import { SchedulingService } from "./scheduling.js";
import type { AuthorizationContext, CommandContext } from "./index.js";

const authorization: AuthorizationContext = {
  authenticated: true,
  authenticationUserId: "auth",
  playerAccountId: "player",
  emailVerified: true,
  roles: ["player"],
};
const command: CommandContext = {
  requestId: "request",
  commandId: "command",
  transactionId: "transaction",
  idempotencyKey: "schedule-key",
  authorization,
};

describe("SchedulingService", () => {
  it("publishes every generated dated flight through ticket 11's opaque commercial boundary", async () => {
    const offer = {
      offerId: "11111111-1111-4111-8111-111111111111",
      airlineId: "airline",
      marketId: "market",
      economySellableCapacity: 70,
      bookingOpensAt: "2026-07-01T00:00:00.000Z",
      departureAt: "2026-08-01T10:00:00.000Z",
      scheduledArrivalAt: "2026-08-01T11:00:00.000Z",
      durationMinutes: 60,
      scheduleQualityBasisPoints: 8000,
      serviceQualityBasisPoints: 6500,
      reputationBasisPoints: 5000,
      sourceType: "external_dated_flight" as const,
      sourceVersion: "scheduling-v1",
      sourceReference: "11111111-1111-4111-8111-111111111111",
    };
    const activation = {
      route: { id: "route" },
      timetableVersionId: "timetable",
      version: 1,
      effectiveFrom: "2026-08-01",
      generatedThrough: "2026-08-07",
      aircraftId: "aircraft",
      flights: [{ id: offer.offerId, commercialOffer: offer }],
      validation: { valid: true, issues: [] },
    } as unknown as TimetableActivation;
    const activateTimetable = vi.fn().mockResolvedValue(activation);
    const createCommercialOffer = vi.fn().mockResolvedValue({});
    const scheduling = { activateTimetable } as unknown as SchedulingRepository;
    const markets = { createCommercialOffer } as unknown as MarketRepository;
    const identity = {
      ownsResource: vi.fn<IdentityRepository["ownsResource"]>().mockResolvedValue(true),
    };
    const service = new SchedulingService(scheduling, markets, identity, {
      now: () => new Date("2026-07-12T00:00:00Z"),
    });
    const result = await service.activateTimetable(
      "airline",
      "route",
      {
        aircraftId: "aircraft",
        effectiveFromLocalDate: "2026-08-01",
        legs: [
          {
            dayOfWeek: 6,
            originIataCode: "JFK",
            destinationIataCode: "PHL",
            departureLocalTime: "10:00",
          },
        ],
      },
      command,
    );
    expect(result).toBe(activation);
    expect(createCommercialOffer).toHaveBeenCalledWith(
      "player",
      offer,
      new Date("2026-07-12T00:00:00Z"),
    );
  });
});
