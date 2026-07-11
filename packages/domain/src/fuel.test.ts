import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  forecastFuel,
  generateFuelPrice,
  priceFuelQuantity,
  weightedConsumptionCost,
} from "./fuel.js";

const rule = {
  worldSeed: "offline-test-seed",
  rulesetVersion: "rules-v1",
  fuelRulesVersion: "fuel-v1",
  priceFormulaVersion: "seeded-bucket-fnv1a64-v1",
  bucketMinutes: 60,
  volatilityBasisPoints: 1200,
  basePricePerTonneMinor: 90_000n,
  currency: "USD" as const,
};

describe("exact global fuel rules", () => {
  it("reproduces a versioned price within a bucket and changes deterministically by context", () => {
    const first = generateFuelPrice(rule, new Date("2026-07-11T12:01:00Z"));
    expect(generateFuelPrice(rule, new Date("2026-07-11T12:59:59Z"))).toEqual(first);
    expect(generateFuelPrice(rule, new Date("2026-07-11T13:00:00Z"))).not.toEqual(first);
    expect(
      generateFuelPrice({ ...rule, worldSeed: "other" }, new Date("2026-07-11T12:01:00Z")),
    ).not.toEqual(first);
    expect(first).toMatchObject({ unit: "kg", bucketStart: "2026-07-11T12:00:00.000Z" });
  });

  it("preserves mass, non-negative value, and final ledger reconciliation for arbitrary purchases and consumes", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            purchaseKg: fc.bigInt({ min: 1n, max: 100_000n }),
            unitNumerator: fc.bigInt({ min: 1n, max: 10_000n }),
            unitDenominator: fc.bigInt({ min: 1n, max: 1_000n }),
            consumeBasisPoints: fc.integer({ min: 0, max: 10_000 }),
          }),
          { minLength: 1, maxLength: 50 },
        ),
        (operations) => {
          let quantity = 0n;
          let value = 0n;
          let purchasedValue = 0n;
          let consumedValue = 0n;
          for (const operation of operations) {
            const cost = priceFuelQuantity(
              operation.purchaseKg,
              operation.unitNumerator,
              operation.unitDenominator,
            );
            quantity += operation.purchaseKg;
            value += cost;
            purchasedValue += cost;
            const consume = (quantity * BigInt(operation.consumeBasisPoints)) / 10_000n;
            if (consume > 0n) {
              const removal = weightedConsumptionCost(quantity, value, consume);
              quantity -= consume;
              value -= removal;
              consumedValue += removal;
            }
            expect(quantity).toBeGreaterThanOrEqual(0n);
            expect(value).toBeGreaterThanOrEqual(0n);
          }
          if (quantity > 0n) {
            consumedValue += weightedConsumptionCost(quantity, value, quantity);
            quantity = 0n;
            value = 0n;
          }
          expect(quantity).toBe(0n);
          expect(value).toBe(0n);
          expect(consumedValue).toBe(purchasedValue);
        },
      ),
      { numRuns: 250 },
    );
  });

  it("keeps reserve and projected shortage advisory and bounded", () => {
    expect(forecastFuel("airline", 10_000n, 2_000n, 3_000n, 8_000n)).toEqual({
      airlineId: "airline",
      onHandKg: "10000",
      planningReservedKg: "2000",
      minimumReserveKg: "3000",
      projectedConsumptionKg: "8000",
      projectedOnHandKg: "2000",
      projectedAvailableKg: "0",
      projectedShortageKg: "1000",
      advisoryOnly: true,
    });
  });
});
