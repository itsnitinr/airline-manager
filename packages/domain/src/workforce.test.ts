import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  WorkforceDomainError,
  demandForFlight,
  forecastWorkforce,
  qualificationCode,
  recoveryEndsAt,
  type WorkforceFlightFacts,
  type WorkforcePool,
} from "./workforce.js";

const flight = (overrides: Partial<WorkforceFlightFacts> = {}): WorkforceFlightFacts => ({
  flightId: "00000000-0000-4000-8000-000000000101",
  flightNumber: "AM101",
  baseAirportId: "00000000-0000-4000-8000-000000000201",
  baseIataCode: "FRA",
  aircraftVariantId: "00000000-0000-4000-8000-000000000301",
  aircraftVariantCode: "airbus-a320neo",
  economySeats: 180,
  departureAt: "2026-07-20T10:00:00.000Z",
  arrivalAt: "2026-07-20T12:00:00.000Z",
  plannedBlockMinutes: 120,
  outsourcedGroundHandling: true,
  ...overrides,
});

const pool = (
  role: WorkforcePool["role"],
  capacity: number,
  code = role === "pilot" ? "variant:airbus-a320neo" : "general",
): WorkforcePool => ({
  id: `00000000-0000-4000-8000-00000000040${role.length % 10}`,
  airlineId: "00000000-0000-4000-8000-000000000501",
  baseAirportId: "00000000-0000-4000-8000-000000000201",
  baseIataCode: "FRA",
  role,
  qualification: { code },
  activeCapacity: capacity,
  pendingCapacity: 0,
  wagePerIntervalMinor: "1000",
  reportingCurrency: "EUR",
  wageCheckpointAt: "2026-07-20T00:00:00.000Z",
  nextWageDueAt: "2026-07-21T00:00:00.000Z",
  version: "1",
});

describe("qualified aggregate workforce", () => {
  it("requires a catalog variant type rating only for pilots", () => {
    expect(qualificationCode("pilot", "airbus-a320neo")).toBe("variant:airbus-a320neo");
    expect(qualificationCode("cabin_crew")).toBe("general");
    expect(() => qualificationCode("pilot")).toThrow(WorkforceDomainError);
    expect(() => qualificationCode("line_maintenance", "airbus-a320neo")).toThrow(
      WorkforceDomainError,
    );
  });

  it("derives slice-one demand and respects outsourced ground handling", () => {
    expect(demandForFlight(flight())).toEqual([
      { role: "pilot", qualificationCode: "variant:airbus-a320neo", requiredCapacity: 2 },
      { role: "cabin_crew", qualificationCode: "general", requiredCapacity: 4 },
      { role: "line_maintenance", qualificationCode: "general", requiredCapacity: 1 },
    ]);
    expect(demandForFlight(flight({ outsourcedGroundHandling: false }))).toContainEqual({
      role: "ground_handling",
      qualificationCode: "general",
      requiredCapacity: 1,
    });
  });

  it("does not accept an incompatible pilot rating", () => {
    const forecast = forecastWorkforce(
      [flight()],
      [
        pool("pilot", 2, "variant:boeing-737-8"),
        pool("cabin_crew", 4),
        pool("line_maintenance", 1),
      ],
      new Date("2026-07-19T00:00:00Z"),
      new Date("2026-07-21T00:00:00Z"),
    );
    expect(forecast.feasible).toBe(false);
    expect(forecast.shortages[0]).toMatchObject({
      role: "pilot",
      qualificationCode: "variant:airbus-a320neo",
      requiredCapacity: 2,
      availableCapacity: 0,
      shortfall: 2,
    });
  });

  it("prevents concurrent demand and fatigue recovery from double-consuming capacity", () => {
    const second = flight({
      flightId: "00000000-0000-4000-8000-000000000102",
      flightNumber: "AM102",
      departureAt: "2026-07-20T12:30:00.000Z",
      arrivalAt: "2026-07-20T14:30:00.000Z",
    });
    const forecast = forecastWorkforce(
      [flight(), second],
      [pool("pilot", 2), pool("cabin_crew", 4), pool("line_maintenance", 1)],
      new Date("2026-07-19T00:00:00Z"),
      new Date("2026-07-21T00:00:00Z"),
    );
    expect(recoveryEndsAt(flight(), "pilot")).toBe("2026-07-20T13:00:00.000Z");
    expect(forecast.shortages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ flightId: second.flightId, role: "pilot", shortfall: 2 }),
        expect.objectContaining({ flightId: second.flightId, role: "cabin_crew", shortfall: 4 }),
      ]),
    );
  });

  it("returns the same actionable forecast for every input ordering", () => {
    const second = flight({
      flightId: "00000000-0000-4000-8000-000000000102",
      flightNumber: "AM102",
      departureAt: "2026-07-20T12:30:00.000Z",
      arrivalAt: "2026-07-20T14:30:00.000Z",
    });
    const pools = [pool("pilot", 2), pool("cabin_crew", 4), pool("line_maintenance", 1)];
    const generated = new Date("2026-07-19T00:00:00Z");
    const through = new Date("2026-07-21T00:00:00Z");
    expect(forecastWorkforce([second, flight()], pools, generated, through)).toEqual(
      forecastWorkforce([flight(), second], [...pools].reverse(), generated, through),
    );
  });

  it("never reports negative availability or shortfall", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 500 }), (capacity) => {
        const result = forecastWorkforce(
          [flight()],
          [
            pool("pilot", capacity),
            pool("cabin_crew", capacity),
            pool("line_maintenance", capacity),
          ],
          new Date("2026-07-19T00:00:00Z"),
          new Date("2026-07-21T00:00:00Z"),
        );
        for (const shortage of result.shortages) {
          expect(shortage.availableCapacity).toBeGreaterThanOrEqual(0);
          expect(shortage.shortfall).toBeGreaterThan(0);
        }
      }),
    );
  });
});
