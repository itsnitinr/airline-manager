import type { CurrencyCode } from "./finance.js";
import { roundHalfEven } from "./finance.js";

export type FuelMovementType =
  | "purchase"
  | "consumption"
  | "reservation"
  | "release"
  | "correction"
  | "reversal"
  | "capacity_adjustment";

export type FuelPrice = Readonly<{
  currency: CurrencyCode;
  bucketStart: string;
  bucketEnd: string;
  unit: "kg";
  unitPriceNumerator: string;
  unitPriceDenominator: string;
  pricePerTonneMinor: string;
  rulesetVersion: string;
  fuelRulesVersion: string;
  priceFormulaVersion: string;
}>;

export type FuelQuote = Readonly<{
  id: string;
  airlineId: string;
  quantityKg: string;
  currency: CurrencyCode;
  unitPriceNumerator: string;
  unitPriceDenominator: string;
  totalPriceMinor: string;
  rulesetVersion: string;
  priceFormulaVersion: string;
  bucketStart: string;
  createdAt: string;
  expiresAt: string;
}>;

export type FuelInventory = Readonly<{
  airlineId: string;
  unit: "kg";
  onHandKg: string;
  planningReservedKg: string;
  minimumReserveKg: string;
  protectedKg: string;
  availableKg: string;
  capacityKg: string;
  capacityTier: number;
  utilizationBasisPoints: string;
  inventoryValueMinor: string;
  currency: CurrencyCode;
  weightedUnitCostNumerator: string;
  weightedUnitCostDenominator: string;
  version: string;
}>;

export type FuelLot = Readonly<{
  id: string;
  quoteId: string;
  quantityKg: string;
  costBasisMinor: string;
  derivedRemainingQuantityKg: string;
  derivedRemainingCostMinor: string;
  currency: CurrencyCode;
  unitPriceNumerator: string;
  unitPriceDenominator: string;
  fuelRulesVersion: string;
  priceFormulaVersion: string;
  appliedFxSnapshot: Readonly<{
    importId: string | null;
    numerator: string;
    denominator: string;
  }>;
  purchasedAt: string;
  provenance: Readonly<Record<string, unknown>>;
}>;

export type FuelMovement = Readonly<{
  id: string;
  type: FuelMovementType;
  quantityDeltaKg: string;
  reservedDeltaKg: string;
  inventoryValueDeltaMinor: string;
  balanceAfterKg: string;
  reservedAfterKg: string;
  inventoryValueAfterMinor: string;
  sourceType: string;
  sourceId: string;
  reversesMovementId: string | null;
  occurredAt: string;
}>;

export type FuelPurchase = Readonly<{
  quote: FuelQuote;
  lot: FuelLot;
  inventory: FuelInventory;
  journalEntryId: string;
  movementId: string;
}>;

export type FuelCapacityOffer = Readonly<{
  tier: number;
  capacityKg: string;
  incrementalCapacityKg: string;
  currency: CurrencyCode;
  priceMinor: string;
  fuelRulesVersion: string;
}>;

export type FuelCapacityUpgrade = Readonly<{
  airlineId: string;
  fromTier: number;
  toTier: number;
  capacityKg: string;
  priceMinor: string;
  currency: CurrencyCode;
  journalEntryId: string;
  inventory: FuelInventory;
}>;

export type FuelForecast = Readonly<{
  airlineId: string;
  onHandKg: string;
  planningReservedKg: string;
  minimumReserveKg: string;
  projectedConsumptionKg: string;
  projectedOnHandKg: string;
  projectedAvailableKg: string;
  projectedShortageKg: string;
  advisoryOnly: true;
}>;

export class FuelDomainError extends Error {
  public constructor(
    readonly code:
      | "fuel_not_found"
      | "invalid_fuel_quantity"
      | "fuel_quote_not_found"
      | "fuel_quote_expired"
      | "fuel_quote_already_accepted"
      | "fuel_quote_wrong_airline"
      | "insufficient_cash"
      | "fuel_capacity_exceeded"
      | "insufficient_fuel"
      | "fuel_reserve_exceeds_inventory"
      | "fuel_upgrade_not_found"
      | "fuel_upgrade_not_next_tier"
      | "fuel_movement_not_found"
      | "fuel_movement_already_reversed"
      | "idempotency_conflict",
    message: string,
  ) {
    super(message);
    this.name = "FuelDomainError";
  }
}

export type FuelPriceRule = Readonly<{
  worldSeed: string;
  rulesetVersion: string;
  fuelRulesVersion: string;
  priceFormulaVersion: string;
  bucketMinutes: number;
  volatilityBasisPoints: number;
  basePricePerTonneMinor: bigint;
  currency: CurrencyCode;
}>;

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function fnv1a64(value: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

/** Deterministic exact price; no ambient clock, randomness, provider, or floating point. */
export function generateFuelPrice(rule: FuelPriceRule, at: Date): FuelPrice {
  if (
    rule.bucketMinutes < 1 ||
    rule.volatilityBasisPoints < 0 ||
    rule.basePricePerTonneMinor <= 0n
  ) {
    throw new Error("Fuel price rule is invalid.");
  }
  const bucketMilliseconds = BigInt(rule.bucketMinutes) * 60_000n;
  const atMilliseconds = BigInt(at.getTime());
  const bucketMillisecondsStart = (atMilliseconds / bucketMilliseconds) * bucketMilliseconds;
  const bucketStart = new Date(Number(bucketMillisecondsStart));
  const bucketEnd = new Date(Number(bucketMillisecondsStart + bucketMilliseconds));
  const material = [
    rule.worldSeed,
    rule.rulesetVersion,
    rule.fuelRulesVersion,
    rule.priceFormulaVersion,
    rule.currency,
    bucketStart.toISOString(),
  ].join("|");
  const sample = fnv1a64(material);
  const span = BigInt(rule.volatilityBasisPoints * 2 + 1);
  const displacement = Number(sample % span) - rule.volatilityBasisPoints;
  const factor = BigInt(10_000 + displacement);
  const rawNumerator = rule.basePricePerTonneMinor * factor;
  const rawDenominator = 10_000n * 1_000n;
  const divisor = greatestCommonDivisor(rawNumerator, rawDenominator);
  const numerator = rawNumerator / divisor;
  const denominator = rawDenominator / divisor;
  return {
    currency: rule.currency,
    bucketStart: bucketStart.toISOString(),
    bucketEnd: bucketEnd.toISOString(),
    unit: "kg",
    unitPriceNumerator: numerator.toString(),
    unitPriceDenominator: denominator.toString(),
    pricePerTonneMinor: roundHalfEven(numerator * 1_000n, denominator).toString(),
    rulesetVersion: rule.rulesetVersion,
    fuelRulesVersion: rule.fuelRulesVersion,
    priceFormulaVersion: rule.priceFormulaVersion,
  };
}

export function priceFuelQuantity(
  quantityKg: bigint,
  unitPriceNumerator: bigint,
  unitPriceDenominator: bigint,
): bigint {
  if (quantityKg <= 0n || unitPriceNumerator <= 0n || unitPriceDenominator <= 0n) {
    throw new FuelDomainError("invalid_fuel_quantity", "Fuel quantity and price must be positive.");
  }
  return roundHalfEven(quantityKg * unitPriceNumerator, unitPriceDenominator);
}

/** Exact perpetual weighted-average cost removal with final-balance reconciliation. */
export function weightedConsumptionCost(
  onHandKg: bigint,
  inventoryValueMinor: bigint,
  consumedKg: bigint,
): bigint {
  if (onHandKg <= 0n || consumedKg <= 0n || consumedKg > onHandKg || inventoryValueMinor < 0n) {
    throw new FuelDomainError("insufficient_fuel", "Fuel consumption exceeds on-hand inventory.");
  }
  return consumedKg === onHandKg
    ? inventoryValueMinor
    : roundHalfEven(inventoryValueMinor * consumedKg, onHandKg);
}

export function forecastFuel(
  airlineId: string,
  onHandKg: bigint,
  planningReservedKg: bigint,
  minimumReserveKg: bigint,
  projectedConsumptionKg: bigint,
): FuelForecast {
  if (projectedConsumptionKg < 0n) {
    throw new FuelDomainError("invalid_fuel_quantity", "Projected consumption cannot be negative.");
  }
  const protectedKg = planningReservedKg > minimumReserveKg ? planningReservedKg : minimumReserveKg;
  const projectedOnHand =
    onHandKg > projectedConsumptionKg ? onHandKg - projectedConsumptionKg : 0n;
  const shortage =
    projectedConsumptionKg + protectedKg > onHandKg
      ? projectedConsumptionKg + protectedKg - onHandKg
      : 0n;
  const available = projectedOnHand > protectedKg ? projectedOnHand - protectedKg : 0n;
  return {
    airlineId,
    onHandKg: onHandKg.toString(),
    planningReservedKg: planningReservedKg.toString(),
    minimumReserveKg: minimumReserveKg.toString(),
    projectedConsumptionKg: projectedConsumptionKg.toString(),
    projectedOnHandKg: projectedOnHand.toString(),
    projectedAvailableKg: available.toString(),
    projectedShortageKg: shortage.toString(),
    advisoryOnly: true,
  };
}

export interface FuelRepository {
  currentPrices(
    playerAccountId: string,
    airlineId: string,
    now: Date,
    recentBuckets: number,
  ): Promise<readonly FuelPrice[]>;
  createQuote(
    playerAccountId: string,
    airlineId: string,
    quantityKg: bigint,
    now: Date,
  ): Promise<FuelQuote>;
  purchase(
    playerAccountId: string,
    airlineId: string,
    quoteId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelPurchase>;
  inventory(playerAccountId: string, airlineId: string): Promise<FuelInventory>;
  lots(playerAccountId: string, airlineId: string): Promise<readonly FuelLot[]>;
  movements(playerAccountId: string, airlineId: string): Promise<readonly FuelMovement[]>;
  setReserve(
    playerAccountId: string,
    airlineId: string,
    reservedKg: bigint,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelInventory>;
  forecast(
    playerAccountId: string,
    airlineId: string,
    projectedConsumptionKg: bigint,
  ): Promise<FuelForecast>;
  capacityOffers(playerAccountId: string, airlineId: string): Promise<readonly FuelCapacityOffer[]>;
  purchaseCapacity(
    playerAccountId: string,
    airlineId: string,
    tier: number,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelCapacityUpgrade>;
  consume(
    airlineId: string,
    quantityKg: bigint,
    sourceType: string,
    sourceId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelInventory>;
  correct(
    airlineId: string,
    quantityDeltaKg: bigint,
    valueDeltaMinor: bigint,
    sourceId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelInventory>;
  reverseMovement(
    airlineId: string,
    movementId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<FuelInventory>;
}
