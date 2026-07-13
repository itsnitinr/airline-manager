import { describe, expect, it } from "vitest";
import {
  assertFlightTransition,
  canTransition,
  flightStates,
  realizeFlight,
} from "./operations.js";

describe("flight lifecycle", () => {
  it("defines every legal and illegal transition explicitly", () => {
    const legal = new Set([
      "scheduled:suspended",
      "scheduled:cancelled",
      "scheduled:delayed",
      "scheduled:boarding",
      "suspended:cancelled",
      "suspended:delayed",
      "suspended:boarding",
      "delayed:suspended",
      "delayed:cancelled",
      "delayed:boarding",
      "boarding:suspended",
      "boarding:cancelled",
      "boarding:delayed",
      "boarding:departed",
      "departed:diverted",
      "departed:arrived",
      "diverted:arrived",
      "arrived:settled",
      "cancelled:settled",
    ]);
    for (const from of flightStates)
      for (const to of flightStates)
        expect(canTransition(from, to)).toBe(legal.has(`${from}:${to}`));
    expect(() => assertFlightTransition("settled", "scheduled")).toThrow(/cannot transition/);
  });

  it("is deterministic, bounded, exact, and capacity-safe", () => {
    const input = {
      plannedBlockMinutes: 90,
      bookedPassengers: 70n,
      sellableSeats: 72n,
      bookedRevenueMinor: 700_000n,
      weatherBlockTimeBasisPoints: 11_000,
      weatherFuelBurnBasisPoints: 10_500,
      weatherDelayRiskBasisPoints: 10_000,
      weatherDiversionRiskBasisPoints: 10_000,
      distanceNm: 300,
      economySeats: 72,
      seed: "flight-17-replay-seed",
    } as const;
    expect(realizeFlight(input)).toEqual(realizeFlight(input));
    const outcome = realizeFlight(input);
    expect(BigInt(outcome.passengersCarried)).toBeLessThanOrEqual(72n);
    expect(outcome.delayMinutes).toBeGreaterThanOrEqual(5);
    expect(outcome.diverted).toBe(true);
    expect(outcome.realizedBlockMinutes).toBeLessThanOrEqual(90 * 2);
  });
});
