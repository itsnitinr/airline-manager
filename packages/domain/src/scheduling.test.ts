import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  greatCircleDistanceNm,
  isLocalTimeInCurfew,
  localDateTimeToUtc,
  localDisplay,
  validateRotationIntervals,
  validateRoute,
  type AircraftSchedulingFacts,
  type AirportSchedulingFacts,
  type RouteForecast,
} from "./scheduling.js";

const airport = (overrides: Partial<AirportSchedulingFacts> = {}): AirportSchedulingFacts => ({
  id: "a",
  iataCode: "LHR",
  countryCode: "GB",
  timezoneName: "Europe/London",
  latitudeDeg: "51.470000",
  longitudeDeg: "-0.454300",
  longestRunwayFt: 12799,
  outsourcedServiceEligible: true,
  hourlyMovementCeiling: 18,
  congestionFeeBasisPoints: 500,
  minimumTurnaroundAdjustmentMinutes: 0,
  ...overrides,
});
const plane: AircraftSchedulingFacts = {
  id: "p",
  airlineId: "x",
  currentAirportId: "a",
  variantCode: "a320neo",
  category: "narrow_body",
  rangeNm: 3400,
  minimumRunwayFt: 6000,
  economySeats: 180,
  deliveryState: "delivered",
};
const forecast: RouteForecast = {
  distanceNm: 300,
  plannedBlockMinutes: 70,
  minimumTurnaroundMinutes: 50,
  provisionalOperatingCostMinor: "100",
  provisionalDailyDemand: "20",
  operatingCostFormulaVersion: "schedule-cost-v1",
  blockTimeFormulaVersion: "schedule-block-v1",
  outsourcedService: true,
};

describe("scheduling domain", () => {
  it("calculates symmetric great-circle distances", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        (lat1, lon1, lat2, lon2) => {
          const left = { latitudeDeg: String(lat1), longitudeDeg: String(lon1) };
          const right = { latitudeDeg: String(lat2), longitudeDeg: String(lon2) };
          expect(greatCircleDistanceNm(left, right)).toBe(greatCircleDistanceNm(right, left));
        },
      ),
    );
  });

  it("returns actionable performance, runway, delivery, and cabotage errors", () => {
    const issues = validateRoute(
      airport({ countryCode: "FR", longestRunwayFt: 5000 }),
      airport({ id: "b", iataCode: "ORY", countryCode: "FR", longestRunwayFt: 5000 }),
      { ...plane, rangeNm: 200, deliveryState: "pending" },
      "GB",
      forecast,
    );
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "aircraft_unavailable",
        "range_exceeded",
        "runway_too_short",
        "cabotage_prohibited",
      ]),
    );
    expect(issues.every((issue) => issue.suggestedCorrection.length > 0)).toBe(true);
  });

  it("converts recurring local times across both DST transitions", () => {
    expect(localDateTimeToUtc("2026-03-29", "02:30", "Europe/London").toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    expect(localDateTimeToUtc("2026-10-25", "01:30", "Europe/London").toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    expect(localDisplay(new Date("2026-10-25T01:30:00.000Z"), "Europe/London")).toBe(
      "2026-10-25T01:30",
    );
    expect(() => localDateTimeToUtc("2026-03-29", "01:30", "Europe/London")).toThrow(
      /does not exist/,
    );
  });

  it("enforces non-overlap, turnaround, chronology, and position continuity", () => {
    const start = new Date("2026-08-01T08:00:00Z");
    const issues = validateRotationIntervals(
      [
        {
          originAirportId: "a",
          destinationAirportId: "b",
          departureAt: start,
          arrivalAt: new Date("2026-08-01T09:00:00Z"),
          readyAt: new Date("2026-08-01T10:00:00Z"),
        },
        {
          originAirportId: "c",
          destinationAirportId: "a",
          departureAt: new Date("2026-08-01T09:30:00Z"),
          arrivalAt: new Date("2026-08-01T11:00:00Z"),
          readyAt: new Date("2026-08-01T11:40:00Z"),
        },
      ],
      "a",
    );
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["turnaround_too_short", "aircraft_position_mismatch"]),
    );
  });

  it("applies overnight airport curfews in local wall time", () => {
    const curfew = { startsLocal: "23:30", endsLocal: "06:00" };
    expect(isLocalTimeInCurfew("23:45", curfew)).toBe(true);
    expect(isLocalTimeInCurfew("05:59", curfew)).toBe(true);
    expect(isLocalTimeInCurfew("06:00", curfew)).toBe(false);
    expect(isLocalTimeInCurfew("22:00", curfew)).toBe(false);
  });
});
