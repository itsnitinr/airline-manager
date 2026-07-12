import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  calculateBookingInterval,
  generateAggregateCompetition,
  generateDirectMarketForecast,
  recommendedPricing,
  type BookingIntervalInput,
  type DirectMarketInput,
  type MarketRules,
  type PricingStrategy,
} from "./market.js";

const rules: MarketRules = {
  version: "market-v1",
  demandFormulaVersion: "direct-demand-v1",
  competitionFormulaVersion: "aggregate-pressure-v1",
  pricingFormulaVersion: "economy-rm-v1",
  worldSeed: "offline-fixture-seed-v1",
  referenceFarePerNmMinor: { CHF: "12", EUR: "11", GBP: "10", JPY: "1400", KWD: "35", USD: "12" },
  minimumReferenceFareMinor: {
    CHF: "6000",
    EUR: "5500",
    GBP: "5000",
    JPY: "700000",
    KWD: "18000",
    USD: "6000",
  },
};

const marketInput: DirectMarketInput = {
  originAirportId: "origin",
  destinationAirportId: "destination",
  originIataCode: "JFK",
  destinationIataCode: "LAX",
  originLatitudeDeg: "40.639801",
  originLongitudeDeg: "-73.7789",
  destinationLatitudeDeg: "33.942501",
  destinationLongitudeDeg: "-118.407997",
  originRunwayFt: 14511,
  destinationRunwayFt: 12091,
  catalogReleaseVersion: "catalog-v1",
  worldRulesetVersion: "world-v1",
  marketRulesVersion: "market-v1",
};

function bookingInput(overrides: Partial<BookingIntervalInput> = {}): BookingIntervalInput {
  const forecast = generateDirectMarketForecast(
    marketInput,
    rules,
    new Date("2026-07-12T00:00:00Z"),
  );
  const strategy: PricingStrategy = {
    id: "pricing-1",
    version: 1,
    effectiveTo: null,
    ...recommendedPricing(
      "market-1",
      "airline-1",
      "USD",
      forecast.distanceNm,
      rules,
      new Date("2026-07-01T00:00:00Z"),
    ),
  };
  return {
    seed: rules.worldSeed,
    marketId: "market-1",
    offerId: "offer-1",
    intervalStart: new Date("2026-07-12T00:00:00Z"),
    intervalEnd: new Date("2026-07-13T00:00:00Z"),
    departureAt: new Date("2026-07-20T12:00:00Z"),
    remainingSeats: 180n,
    economySellableCapacity: 180n,
    bookedPassengers: 0n,
    realizedRevenueMinor: 0n,
    bookingHorizonSeconds: 20n * 86_400n,
    elapsedBookingSeconds: 86_400n,
    referenceFareMinor: BigInt(strategy.baseFareMinor),
    segmentDailyDemand: Object.fromEntries(
      forecast.segments.map((item) => [item.segment, BigInt(item.dailyDemand)]),
    ) as BookingIntervalInput["segmentDailyDemand"],
    strategy,
    competition: generateAggregateCompetition(forecast, rules, new Date("2026-07-13T00:00:00Z")),
    scheduleQualityBasisPoints: 9_000,
    durationMinutes: 360,
    referenceDurationMinutes: 360,
    serviceQualityBasisPoints: 8_000,
    reputationBasisPoints: 8_000,
    seasonalityBasisPoints: forecast.seasonalityBasisPoints,
    ...overrides,
  };
}

describe("direct passenger market simulation", () => {
  it("is deterministic and labels derived/balance demand and aggregate simulated competition", () => {
    const at = new Date("2026-07-12T00:00:00Z");
    const left = generateDirectMarketForecast(marketInput, rules, at);
    expect(generateDirectMarketForecast(marketInput, rules, at)).toEqual(left);
    expect(left.segments.map(({ segment }) => segment)).toEqual(["business", "leisure", "vfr"]);
    expect(left.provenance.marketSize.classification).toBe("balance");
    expect(generateAggregateCompetition(left, rules, at)).toMatchObject({
      classification: "simulated_aggregate_market_pressure",
      formulaVersion: "aggregate-pressure-v1",
    });
  });

  it("keeps bookings and exact revenue non-negative, deterministic, and within capacity", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 250 }), (capacity) => {
        const input = bookingInput({ remainingSeats: BigInt(capacity) });
        const first = calculateBookingInterval(input);
        expect(calculateBookingInterval(input)).toEqual(first);
        expect(first.passengers).toBeGreaterThanOrEqual(0n);
        expect(first.passengers).toBeLessThanOrEqual(BigInt(capacity));
        expect(first.revenueMinor).toBe(
          first.aggregates.reduce(
            (sum, row) => sum + BigInt(row.passengers) * BigInt(row.realizedFareMinor),
            0n,
          ),
        );
      }),
    );
  });

  it("has monotonic segment-appropriate price, schedule, duration, service, reputation, and competition responses", () => {
    const baseline = bookingInput({
      remainingSeats: 1_000_000n,
      economySellableCapacity: 1_000_000n,
    });
    const count = (input: BookingIntervalInput) => calculateBookingInterval(input).passengers;
    const expensive: PricingStrategy = {
      ...baseline.strategy,
      baseFareMinor: "60000",
      maximumFareMinor: "90000",
    };
    expect(count({ ...baseline, strategy: expensive })).toBeLessThan(count(baseline));
    expect(count({ ...baseline, scheduleQualityBasisPoints: 5_000 })).toBeLessThanOrEqual(
      count(baseline),
    );
    expect(count({ ...baseline, durationMinutes: 600 })).toBeLessThanOrEqual(count(baseline));
    expect(count({ ...baseline, serviceQualityBasisPoints: 5_000 })).toBeLessThanOrEqual(
      count(baseline),
    );
    expect(count({ ...baseline, reputationBasisPoints: 5_000 })).toBeLessThanOrEqual(
      count(baseline),
    );
    expect(
      count({
        ...baseline,
        competition: {
          ...baseline.competition,
          capacitySeats: (BigInt(baseline.competition.capacitySeats) * 2n).toString(),
          farePressureBasisPoints: 14_000,
          scheduleQualityBasisPoints: 10_000,
          frequencyPerWeek: 35,
          serviceQualityBasisPoints: 10_000,
        },
      }),
    ).toBeLessThan(count(baseline));
  });

  it("always realizes economy booking-class fares inside exact strategy bounds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 720 }), (hours) => {
        const input = bookingInput({
          intervalEnd: new Date("2026-07-13T00:00:00Z"),
          departureAt: new Date(Date.parse("2026-07-13T00:00:00Z") + hours * 3_600_000),
        });
        const result = calculateBookingInterval(input);
        for (const fare of Object.values(result.effectiveFares)) {
          expect(BigInt(fare)).toBeGreaterThanOrEqual(BigInt(input.strategy.minimumFareMinor));
          expect(BigInt(fare)).toBeLessThanOrEqual(BigInt(input.strategy.maximumFareMinor));
        }
      }),
    );
  });
});
