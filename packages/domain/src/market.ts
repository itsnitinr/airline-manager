import type { CurrencyCode } from "./finance.js";
import { roundHalfEven } from "./finance.js";

export const passengerSegments = ["business", "leisure", "vfr"] as const;
export type PassengerSegment = (typeof passengerSegments)[number];
export const economyBookingClasses = ["economy_saver", "economy_standard", "economy_flex"] as const;
export type EconomyBookingClass = (typeof economyBookingClasses)[number];
export type PricingPosture = "value" | "balanced" | "yield";

export type ProvenanceValue = Readonly<{
  classification: "sourced" | "derived" | "balance";
  version: string;
  explanation: string;
}>;

export type SegmentSensitivity = Readonly<{
  segment: PassengerSegment;
  price: number;
  schedule: number;
  duration: number;
  service: number;
  reputation: number;
  competition: number;
  explanation: string;
}>;

export const segmentSensitivities: readonly SegmentSensitivity[] = [
  {
    segment: "business",
    price: 3_200,
    schedule: 8_500,
    duration: 7_500,
    service: 5_500,
    reputation: 6_000,
    competition: 6_500,
    explanation: "Business demand values schedule convenience and journey time most strongly.",
  },
  {
    segment: "leisure",
    price: 8_500,
    schedule: 3_500,
    duration: 3_000,
    service: 2_500,
    reputation: 3_000,
    competition: 7_500,
    explanation: "Leisure demand is most sensitive to fare and competing capacity.",
  },
  {
    segment: "vfr",
    price: 7_000,
    schedule: 4_500,
    duration: 4_000,
    service: 3_000,
    reputation: 3_500,
    competition: 6_000,
    explanation: "VFR demand balances fare sensitivity with dependable schedule access.",
  },
] as const;

export type MarketRules = Readonly<{
  version: string;
  demandFormulaVersion: string;
  competitionFormulaVersion: string;
  pricingFormulaVersion: string;
  worldSeed: string;
  referenceFarePerNmMinor: Readonly<Record<CurrencyCode, string>>;
  minimumReferenceFareMinor: Readonly<Record<CurrencyCode, string>>;
}>;

export type DirectMarketInput = Readonly<{
  originAirportId: string;
  destinationAirportId: string;
  originIataCode: string;
  destinationIataCode: string;
  originLatitudeDeg: string;
  originLongitudeDeg: string;
  destinationLatitudeDeg: string;
  destinationLongitudeDeg: string;
  originRunwayFt: number;
  destinationRunwayFt: number;
  catalogReleaseVersion: string;
  worldRulesetVersion: string;
  marketRulesVersion: string;
}>;

export type DirectMarketForecast = Readonly<{
  marketKey: string;
  originIataCode: string;
  destinationIataCode: string;
  distanceNm: number;
  generatedAt: string;
  seed: string;
  catalogReleaseVersion: string;
  worldRulesetVersion: string;
  marketRulesVersion: string;
  demandFormulaVersion: string;
  directionalityBasisPoints: number;
  seasonalityBasisPoints: number;
  airportAttractivenessBasisPoints: number;
  annualGrowthBasisPoints: number;
  segments: readonly Readonly<{
    segment: PassengerSegment;
    dailyDemand: string;
    sensitivity: SegmentSensitivity;
  }>[];
  provenance: Readonly<{
    marketSize: ProvenanceValue;
    directionality: ProvenanceValue;
    seasonality: ProvenanceValue;
    airportAttractiveness: ProvenanceValue;
    marketGrowth: ProvenanceValue;
  }>;
  uncertaintyBasisPoints: number;
}>;

export type AggregateCompetition = Readonly<{
  asOf: string;
  bucket: string;
  capacitySeats: string;
  farePressureBasisPoints: number;
  scheduleQualityBasisPoints: number;
  frequencyPerWeek: number;
  serviceQualityBasisPoints: number;
  formulaVersion: string;
  classification: "simulated_aggregate_market_pressure";
  explanation: string;
}>;

export type PricingStrategy = Readonly<{
  id: string;
  airlineId: string;
  marketId: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  posture: PricingPosture;
  currency: CurrencyCode;
  baseFareMinor: string;
  minimumFareMinor: string;
  maximumFareMinor: string;
  loadFactorTargetBasisPoints: number;
  revenueTargetMinor: string;
  formulaVersion: string;
  recommendation: string;
}>;

export type CommercialFlightOfferInput = Readonly<{
  offerId: string;
  airlineId: string;
  marketId: string;
  economySellableCapacity: number;
  bookingOpensAt: string;
  departureAt: string;
  scheduledArrivalAt: string;
  durationMinutes: number;
  scheduleQualityBasisPoints: number;
  serviceQualityBasisPoints: number;
  reputationBasisPoints: number;
  sourceType: "external_dated_flight" | "ticket11_fixture";
  sourceVersion: string;
  sourceReference: string;
}>;

export type BookingAggregate = Readonly<{
  segment: PassengerSegment;
  bookingClass: EconomyBookingClass;
  passengers: string;
  realizedFareMinor: string;
  revenueMinor: string;
}>;

export type BookingCheckpoint = Readonly<{
  id: string;
  offerId: string;
  intervalStart: string;
  intervalEnd: string;
  pricingStrategyId: string;
  pricingStrategyVersion: number;
  passengersAdded: string;
  revenueAddedMinor: string;
  cumulativePassengers: string;
  cumulativeRevenueMinor: string;
  aggregates: readonly BookingAggregate[];
  materialInputSnapshot: Readonly<Record<string, unknown>>;
}>;

export type MarketResearch = Readonly<{
  marketId: string;
  forecast: DirectMarketForecast;
  competition: AggregateCompetition;
  recommendedPricing: Omit<PricingStrategy, "id" | "version" | "effectiveTo">;
  explanation: readonly string[];
}>;

export type CreatePricingStrategyInput = Readonly<{
  marketId: string;
  effectiveFrom: string;
  posture: PricingPosture;
  baseFareMinor: string;
  minimumFareMinor: string;
  maximumFareMinor: string;
  loadFactorTargetBasisPoints: number;
  revenueTargetMinor: string;
}>;

export type CommercialFlightOffer = CommercialFlightOfferInput &
  Readonly<{
    bookedPassengers: string;
    realizedRevenueMinor: string;
    lastCheckpointAt: string;
    version: string;
  }>;

export type CommercialOfferAnalytics = Readonly<{
  offer: CommercialFlightOffer;
  bookingPacePassengersPerDay: string;
  loadFactorBasisPoints: string;
  yieldMinorPerPassenger: string;
  segmentMix: Readonly<Record<PassengerSegment, string>>;
  competition: AggregateCompetition;
  aggregates: readonly BookingAggregate[];
  checkpoints: readonly BookingCheckpoint[];
  explanation: readonly string[];
  ledgerRevenuePosted: false;
}>;

export interface MarketRepository {
  research(
    playerAccountId: string,
    airlineId: string,
    originIataCode: string,
    destinationIataCode: string,
    at: Date,
  ): Promise<MarketResearch>;
  createPricingStrategy(
    playerAccountId: string,
    airlineId: string,
    input: CreatePricingStrategyInput,
    now: Date,
  ): Promise<PricingStrategy>;
  pricingStrategies(
    playerAccountId: string,
    airlineId: string,
    marketId: string,
  ): Promise<readonly PricingStrategy[]>;
  createCommercialOffer(
    playerAccountId: string,
    input: CommercialFlightOfferInput,
    now: Date,
  ): Promise<CommercialFlightOffer>;
  refreshBookings(
    playerAccountId: string,
    airlineId: string,
    offerId: string,
    checkpointAt: Date,
    idempotencyKey: string,
  ): Promise<BookingCheckpoint>;
  offerAnalytics(
    playerAccountId: string,
    airlineId: string,
    offerId: string,
    at: Date,
  ): Promise<CommercialOfferAnalytics>;
}

export type BookingIntervalInput = Readonly<{
  seed: string;
  marketId: string;
  offerId: string;
  intervalStart: Date;
  intervalEnd: Date;
  departureAt: Date;
  remainingSeats: bigint;
  economySellableCapacity: bigint;
  bookedPassengers: bigint;
  realizedRevenueMinor: bigint;
  bookingHorizonSeconds: bigint;
  elapsedBookingSeconds: bigint;
  referenceFareMinor: bigint;
  segmentDailyDemand: Readonly<Record<PassengerSegment, bigint>>;
  strategy: PricingStrategy;
  competition: AggregateCompetition;
  scheduleQualityBasisPoints: number;
  durationMinutes: number;
  referenceDurationMinutes: number;
  serviceQualityBasisPoints: number;
  reputationBasisPoints: number;
  seasonalityBasisPoints: number;
}>;

export type BookingIntervalResult = Readonly<{
  passengers: bigint;
  revenueMinor: bigint;
  aggregates: readonly BookingAggregate[];
  effectiveFares: Readonly<Record<EconomyBookingClass, string>>;
}>;

export class MarketDomainError extends Error {
  public constructor(
    readonly code:
      | "market_not_found"
      | "airport_not_playable"
      | "same_airport_market"
      | "pricing_strategy_not_found"
      | "invalid_pricing_strategy"
      | "commercial_offer_not_found"
      | "invalid_commercial_offer"
      | "offer_already_exists"
      | "booking_window_closed"
      | "stale_booking_checkpoint"
      | "idempotency_conflict",
    message: string,
  ) {
    super(message);
    this.name = "MarketDomainError";
  }
}

function fnv1a64(value: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

function sample(material: string, minimum: number, maximum: number): number {
  return minimum + Number(fnv1a64(material) % BigInt(maximum - minimum + 1));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function directDistanceNm(input: DirectMarketInput): number {
  const radians = Math.PI / 180;
  const lat1 = Number(input.originLatitudeDeg) * radians;
  const lat2 = Number(input.destinationLatitudeDeg) * radians;
  const deltaLat =
    (Number(input.destinationLatitudeDeg) - Number(input.originLatitudeDeg)) * radians;
  const deltaLon =
    (Number(input.destinationLongitudeDeg) - Number(input.originLongitudeDeg)) * radians;
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return Math.max(1, Math.round(3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))));
}

/** Pure direct-market generation. Time, seed, catalog and ruleset versions are all explicit. */
export function generateDirectMarketForecast(
  input: DirectMarketInput,
  rules: MarketRules,
  at: Date,
): DirectMarketForecast {
  if (input.originAirportId === input.destinationAirportId)
    throw new MarketDomainError("same_airport_market", "Origin and destination must differ.");
  const marketKey = `${input.originIataCode}-${input.destinationIataCode}`;
  const distanceNm = directDistanceNm(input);
  const month = at.getUTCMonth();
  const seasonByMonth = [
    9_400, 9_600, 9_850, 10_050, 10_300, 10_700, 11_000, 10_900, 10_250, 9_950, 9_700, 10_200,
  ];
  const seedMaterial = [rules.worldSeed, input.worldRulesetVersion, marketKey].join("|");
  const directionality = sample(`${seedMaterial}|direction`, 9_000, 11_000);
  const seasonality = seasonByMonth[month] ?? 10_000;
  const airportAttractiveness = clamp(
    4_000 + Math.round((input.originRunwayFt + input.destinationRunwayFt) / 4),
    6_000,
    12_000,
  );
  const annualGrowth = sample(`${seedMaterial}|growth`, -100, 450);
  const distanceFactor = clamp(14_000 - Math.round(distanceNm * 1.15), 3_000, 13_000);
  const base = BigInt(
    Math.max(
      18,
      Math.round(
        (airportAttractiveness * distanceFactor * directionality * seasonality) / 1_000_000_000_000,
      ),
    ),
  );
  const shares: Readonly<Record<PassengerSegment, bigint>> = {
    business: 2_700n,
    leisure: 4_500n,
    vfr: 2_800n,
  };
  const segments = passengerSegments.map((segment) => ({
    segment,
    dailyDemand: roundHalfEven(base * shares[segment], 10_000n).toString(),
    sensitivity: segmentSensitivities.find((item) => item.segment === segment)!,
  }));
  const derived = (version: string, explanation: string): ProvenanceValue => ({
    classification: "derived",
    version,
    explanation,
  });
  const balance = (explanation: string): ProvenanceValue => ({
    classification: "balance",
    version: rules.version,
    explanation,
  });
  return {
    marketKey,
    originIataCode: input.originIataCode,
    destinationIataCode: input.destinationIataCode,
    distanceNm,
    generatedAt: at.toISOString(),
    seed: rules.worldSeed,
    catalogReleaseVersion: input.catalogReleaseVersion,
    worldRulesetVersion: input.worldRulesetVersion,
    marketRulesVersion: input.marketRulesVersion,
    demandFormulaVersion: rules.demandFormulaVersion,
    directionalityBasisPoints: directionality,
    seasonalityBasisPoints: seasonality,
    airportAttractivenessBasisPoints: airportAttractiveness,
    annualGrowthBasisPoints: annualGrowth,
    segments,
    provenance: {
      marketSize: balance(
        "Playable market size calibrated for the single economic career ruleset.",
      ),
      directionality: derived(rules.demandFormulaVersion, "Stable seeded directional imbalance."),
      seasonality: balance("Versioned month-of-year balance curve; not a live travel statistic."),
      airportAttractiveness: derived(
        rules.demandFormulaVersion,
        "Derived from published playable-airport runway and catalog eligibility inputs.",
      ),
      marketGrowth: balance("Stable seeded annual market-growth balance input."),
    },
    uncertaintyBasisPoints: 1_500,
  };
}

/** Aggregate pressure only: it never creates airlines, fleets, schedules, or individual flights. */
export function generateAggregateCompetition(
  forecast: DirectMarketForecast,
  rules: MarketRules,
  at: Date,
): AggregateCompetition {
  const bucket = at.toISOString().slice(0, 7);
  const material = [
    rules.worldSeed,
    forecast.marketKey,
    rules.competitionFormulaVersion,
    bucket,
  ].join("|");
  const totalDaily = forecast.segments.reduce((sum, item) => sum + BigInt(item.dailyDemand), 0n);
  const capacityFactor = BigInt(sample(`${material}|capacity`, 6_500, 12_500));
  return {
    asOf: at.toISOString(),
    bucket,
    capacitySeats: roundHalfEven(totalDaily * 7n * capacityFactor, 10_000n).toString(),
    farePressureBasisPoints: sample(`${material}|fare`, 7_500, 11_500),
    scheduleQualityBasisPoints: sample(`${material}|schedule`, 6_000, 9_500),
    frequencyPerWeek: sample(`${material}|frequency`, 3, 28),
    serviceQualityBasisPoints: sample(`${material}|service`, 5_500, 9_000),
    formulaVersion: rules.competitionFormulaVersion,
    classification: "simulated_aggregate_market_pressure",
    explanation:
      "Versioned deterministic aggregate capacity, fare, schedule and service pressure; no hidden airline is operated.",
  };
}

export function validatePricingStrategy(input: PricingStrategy): void {
  const minimum = BigInt(input.minimumFareMinor);
  const base = BigInt(input.baseFareMinor);
  const maximum = BigInt(input.maximumFareMinor);
  if (
    minimum <= 0n ||
    base < minimum ||
    base > maximum ||
    input.loadFactorTargetBasisPoints < 1_000 ||
    input.loadFactorTargetBasisPoints > 10_000 ||
    BigInt(input.revenueTargetMinor) < 0n
  ) {
    throw new MarketDomainError(
      "invalid_pricing_strategy",
      "Pricing bounds, targets, and exact minor-unit fares are invalid.",
    );
  }
}

export function recommendedPricing(
  marketId: string,
  airlineId: string,
  currency: CurrencyCode,
  distanceNm: number,
  rules: MarketRules,
  effectiveFrom: Date,
): Omit<PricingStrategy, "id" | "version" | "effectiveTo"> {
  const perNm = BigInt(rules.referenceFarePerNmMinor[currency]);
  const floor = BigInt(rules.minimumReferenceFareMinor[currency]);
  const reference = floor > perNm * BigInt(distanceNm) ? floor : perNm * BigInt(distanceNm);
  return {
    airlineId,
    marketId,
    effectiveFrom: effectiveFrom.toISOString(),
    posture: "balanced",
    currency,
    baseFareMinor: reference.toString(),
    minimumFareMinor: roundHalfEven(reference * 6500n, 10_000n).toString(),
    maximumFareMinor: roundHalfEven(reference * 17_500n, 10_000n).toString(),
    loadFactorTargetBasisPoints: 8_200,
    revenueTargetMinor: "0",
    formulaVersion: rules.pricingFormulaVersion,
    recommendation:
      "Balanced beginner posture centered on modeled direct-market reference fare; advanced bounds remain player-controlled.",
  };
}

function multiplyBasisPoints(value: bigint, basisPoints: number): bigint {
  return roundHalfEven(value * BigInt(clamp(basisPoints, 0, 20_000)), 10_000n);
}

function responseFactor(value: number, sensitivity: number): number {
  return clamp(10_000 + Math.round(((value - 10_000) * sensitivity) / 10_000), 1_000, 15_000);
}

export function calculateBookingInterval(input: BookingIntervalInput): BookingIntervalResult {
  validatePricingStrategy(input.strategy);
  if (input.intervalEnd <= input.intervalStart || input.remainingSeats <= 0n)
    return { passengers: 0n, revenueMinor: 0n, aggregates: [], effectiveFares: classFares(input) };
  const seconds = BigInt(
    Math.floor((input.intervalEnd.getTime() - input.intervalStart.getTime()) / 1_000),
  );
  const fares = classFares(input);
  const effectiveFare = BigInt(fares.economy_standard);
  const fareValue = clamp(
    Number((input.referenceFareMinor * 10_000n) / effectiveFare),
    4_000,
    16_000,
  );
  const durationValue = clamp(
    Math.round((input.referenceDurationMinutes * 10_000) / Math.max(1, input.durationMinutes)),
    4_000,
    13_000,
  );
  const capacityPressure = clamp(
    Number(BigInt(input.competition.capacitySeats) / 10n),
    4_000,
    14_000,
  );
  const frequencyPressure = clamp(input.competition.frequencyPerWeek * 400, 2_000, 12_000);
  const compositeCompetitionPressure = Math.round(
    (capacityPressure +
      input.competition.farePressureBasisPoints +
      input.competition.scheduleQualityBasisPoints +
      input.competition.serviceQualityBasisPoints +
      frequencyPressure) /
      5,
  );
  const competitionValue = clamp(20_000 - compositeCompetitionPressure, 3_000, 12_500);
  const timeToDepartureHours = Math.max(
    0,
    Math.floor((input.departureAt.getTime() - input.intervalEnd.getTime()) / 3_600_000),
  );
  const aggregateRows: BookingAggregate[] = [];
  let seatsLeft = input.remainingSeats;
  for (const segment of passengerSegments) {
    if (seatsLeft === 0n) break;
    const sensitivity = segmentSensitivities.find((item) => item.segment === segment)!;
    let demand = roundHalfEven(input.segmentDailyDemand[segment] * seconds, 86_400n);
    demand = multiplyBasisPoints(demand, input.seasonalityBasisPoints);
    demand = multiplyBasisPoints(demand, responseFactor(fareValue, sensitivity.price));
    demand = multiplyBasisPoints(
      demand,
      responseFactor(input.scheduleQualityBasisPoints, sensitivity.schedule),
    );
    demand = multiplyBasisPoints(demand, responseFactor(durationValue, sensitivity.duration));
    demand = multiplyBasisPoints(
      demand,
      responseFactor(input.serviceQualityBasisPoints, sensitivity.service),
    );
    demand = multiplyBasisPoints(
      demand,
      responseFactor(input.reputationBasisPoints, sensitivity.reputation),
    );
    demand = multiplyBasisPoints(demand, responseFactor(competitionValue, sensitivity.competition));
    const jitter = sample(
      [
        input.seed,
        input.marketId,
        input.offerId,
        input.intervalStart.toISOString(),
        input.intervalEnd.toISOString(),
        segment,
      ].join("|"),
      9_500,
      10_500,
    );
    demand = multiplyBasisPoints(demand, jitter);
    const passengers = demand > seatsLeft ? seatsLeft : demand;
    if (passengers === 0n) continue;
    const bookingClass: EconomyBookingClass =
      segment === "business" && timeToDepartureHours < 96
        ? "economy_flex"
        : segment === "leisure" && timeToDepartureHours > 336
          ? "economy_saver"
          : "economy_standard";
    const fare = BigInt(fares[bookingClass]);
    aggregateRows.push({
      segment,
      bookingClass,
      passengers: passengers.toString(),
      realizedFareMinor: fare.toString(),
      revenueMinor: (passengers * fare).toString(),
    });
    seatsLeft -= passengers;
  }
  return {
    passengers: input.remainingSeats - seatsLeft,
    revenueMinor: aggregateRows.reduce((sum, row) => sum + BigInt(row.revenueMinor), 0n),
    aggregates: aggregateRows,
    effectiveFares: fares,
  };
}

function classFares(
  input: Pick<
    BookingIntervalInput,
    | "strategy"
    | "remainingSeats"
    | "departureAt"
    | "intervalEnd"
    | "economySellableCapacity"
    | "bookedPassengers"
    | "realizedRevenueMinor"
    | "bookingHorizonSeconds"
    | "elapsedBookingSeconds"
  >,
): Readonly<Record<EconomyBookingClass, string>> {
  const base = BigInt(input.strategy.baseFareMinor);
  const minimum = BigInt(input.strategy.minimumFareMinor);
  const maximum = BigInt(input.strategy.maximumFareMinor);
  const hours = Math.max(
    0,
    Math.floor((input.departureAt.getTime() - input.intervalEnd.getTime()) / 3_600_000),
  );
  const urgency = hours < 48 ? 12_500n : hours < 168 ? 11_000n : 10_000n;
  const posture =
    input.strategy.posture === "value"
      ? 9_500n
      : input.strategy.posture === "yield"
        ? 10_800n
        : 10_000n;
  const loadBasisPoints =
    input.economySellableCapacity === 0n
      ? 0n
      : (input.bookedPassengers * 10_000n) / input.economySellableCapacity;
  const loadAdjustment =
    loadBasisPoints > BigInt(input.strategy.loadFactorTargetBasisPoints) ? 11_000n : 9_700n;
  const targetPacePassengers =
    input.bookingHorizonSeconds === 0n
      ? 0n
      : (input.economySellableCapacity *
          BigInt(input.strategy.loadFactorTargetBasisPoints) *
          input.elapsedBookingSeconds) /
        (10_000n * input.bookingHorizonSeconds);
  const paceAdjustment = input.bookedPassengers > targetPacePassengers ? 10_500n : 9_500n;
  const revenueAdjustment =
    BigInt(input.strategy.revenueTargetMinor) > 0n &&
    input.realizedRevenueMinor < BigInt(input.strategy.revenueTargetMinor)
      ? 10_300n
      : 10_000n;
  const bounded = (numerator: bigint): string => {
    const value = roundHalfEven(
      base * numerator * urgency * posture * loadAdjustment * paceAdjustment * revenueAdjustment,
      10_000n ** 6n,
    );
    return (value < minimum ? minimum : value > maximum ? maximum : value).toString();
  };
  return {
    economy_saver: bounded(8_000n),
    economy_standard: bounded(10_000n),
    economy_flex: bounded(14_000n),
  };
}
