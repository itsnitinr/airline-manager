import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  MarketDomainError,
  calculateBookingInterval,
  generateAggregateCompetition,
  generateDirectMarketForecast,
  recommendedPricing,
  validatePricingStrategy,
  type AggregateCompetition,
  type BookingAggregate,
  type BookingCheckpoint,
  type CommercialFlightOffer,
  type CommercialFlightOfferInput,
  type CommercialOfferAnalytics,
  type CreatePricingStrategyInput,
  type CurrencyCode,
  type DirectMarketForecast,
  type DirectMarketInput,
  type MarketRepository,
  type MarketResearch,
  type MarketRules,
  type PassengerSegment,
  type PricingPosture,
  type PricingStrategy,
} from "@airline-manager/domain";
import type { Database } from "../database.js";
import type { DB } from "../generated/database.js";
import { runInTransaction } from "../transactions.js";

type Queryable = Database | Transaction<DB>;

type MarketContext = Readonly<{
  airline_id: string;
  game_world_id: string;
  catalog_release_id: string;
  catalog_release_version: string;
  world_ruleset_id: string;
  world_ruleset_version: string;
  market_ruleset_version_id: string;
  market_ruleset_version: string;
  demand_formula_version: string;
  competition_formula_version: string;
  pricing_formula_version: string;
  world_seed: string;
  reference_fare_per_nm_minor: unknown;
  minimum_reference_fare_minor: unknown;
  currency: CurrencyCode;
}>;

type AirportRow = Readonly<{
  id: string;
  iata_code: string;
  latitude_deg: string;
  longitude_deg: string;
  longest_runway_ft: number;
}>;

type MarketRow = Readonly<{
  id: string;
  origin_airport_id: string;
  destination_airport_id: string;
  stable_seed: string;
}>;

function exactCurrencyMap(value: unknown, label: string): Readonly<Record<CurrencyCode, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} is invalid.`);
  return value as Readonly<Record<CurrencyCode, string>>;
}

function rulesFrom(context: MarketContext): MarketRules {
  return {
    version: context.market_ruleset_version,
    demandFormulaVersion: context.demand_formula_version,
    competitionFormulaVersion: context.competition_formula_version,
    pricingFormulaVersion: context.pricing_formula_version,
    worldSeed: context.world_seed,
    referenceFarePerNmMinor: exactCurrencyMap(
      context.reference_fare_per_nm_minor,
      "Reference fare map",
    ),
    minimumReferenceFareMinor: exactCurrencyMap(
      context.minimum_reference_fare_minor,
      "Minimum reference fare map",
    ),
  };
}

async function airlineContext(
  database: Queryable,
  playerAccountId: string,
  airlineId: string,
): Promise<MarketContext> {
  const result = await sql<MarketContext>`SELECT a.id AS airline_id, a.game_world_id,
    c.catalog_release_id, cr.version AS catalog_release_version, c.world_ruleset_id,
    wr.version AS world_ruleset_version, mr.id AS market_ruleset_version_id,
    mr.version AS market_ruleset_version, mr.demand_formula_version,
    mr.competition_formula_version, mr.pricing_formula_version, mr.world_seed,
    mr.reference_fare_per_nm_minor, mr.minimum_reference_fare_minor,
    a.reporting_currency AS currency
    FROM airlines a
    JOIN careers c ON c.id = a.career_id
    JOIN catalog_releases cr ON cr.id = c.catalog_release_id AND cr.status = 'published'
    JOIN world_rulesets wr ON wr.id = c.world_ruleset_id AND wr.status = 'active'
    JOIN market_ruleset_versions mr ON mr.world_ruleset_id = wr.id AND mr.status = 'active'
    JOIN resource_ownerships own ON own.resource_type = 'airline' AND own.resource_id = a.id
      AND own.player_account_id = ${playerAccountId}::uuid
    WHERE a.id = ${airlineId}::uuid`.execute(database);
  const row = result.rows[0];
  if (!row) throw new MarketDomainError("market_not_found", "Passenger market is unavailable.");
  return row;
}

async function playableAirport(
  database: Queryable,
  catalogReleaseId: string,
  iataCode: string,
): Promise<AirportRow> {
  const result = await sql<AirportRow>`SELECT a.id, a.iata_code, a.latitude_deg::text,
    a.longitude_deg::text, a.longest_runway_ft
    FROM catalog_release_airports membership
    JOIN curated_airports a ON a.id = membership.airport_id
    WHERE membership.release_id = ${catalogReleaseId}::uuid AND a.iata_code = ${iataCode}`.execute(
    database,
  );
  const row = result.rows[0];
  if (!row)
    throw new MarketDomainError(
      "airport_not_playable",
      "Both airports must be real playable airports in the career's immutable catalog release.",
    );
  return row;
}

function directInput(
  context: MarketContext,
  origin: AirportRow,
  destination: AirportRow,
): DirectMarketInput {
  return {
    originAirportId: origin.id,
    destinationAirportId: destination.id,
    originIataCode: origin.iata_code,
    destinationIataCode: destination.iata_code,
    originLatitudeDeg: origin.latitude_deg,
    originLongitudeDeg: origin.longitude_deg,
    destinationLatitudeDeg: destination.latitude_deg,
    destinationLongitudeDeg: destination.longitude_deg,
    originRunwayFt: origin.longest_runway_ft,
    destinationRunwayFt: destination.longest_runway_ft,
    catalogReleaseVersion: context.catalog_release_version,
    worldRulesetVersion: context.world_ruleset_version,
    marketRulesVersion: context.market_ruleset_version,
  };
}

async function ensureMarket(
  database: Queryable,
  context: MarketContext,
  origin: AirportRow,
  destination: AirportRow,
  now: Date,
): Promise<MarketRow> {
  if (origin.id === destination.id)
    throw new MarketDomainError("same_airport_market", "Origin and destination must differ.");
  await sql`INSERT INTO passenger_markets
    (game_world_id, catalog_release_id, world_ruleset_id, market_ruleset_version_id,
     origin_airport_id, destination_airport_id, stable_seed, created_at)
    VALUES (${context.game_world_id}::uuid, ${context.catalog_release_id}::uuid,
      ${context.world_ruleset_id}::uuid, ${context.market_ruleset_version_id}::uuid,
      ${origin.id}::uuid, ${destination.id}::uuid,
      ${`${context.world_seed}|${origin.iata_code}-${destination.iata_code}`},
      ${now.toISOString()}::timestamptz)
    ON CONFLICT (game_world_id, origin_airport_id, destination_airport_id, market_ruleset_version_id)
    DO NOTHING`.execute(database);
  const result =
    await sql<MarketRow>`SELECT id, origin_airport_id, destination_airport_id, stable_seed
    FROM passenger_markets WHERE game_world_id = ${context.game_world_id}::uuid
      AND origin_airport_id = ${origin.id}::uuid AND destination_airport_id = ${destination.id}::uuid
      AND market_ruleset_version_id = ${context.market_ruleset_version_id}::uuid`.execute(database);
  const row = result.rows[0];
  if (!row) throw new Error("Passenger market was not persisted.");
  return row;
}

async function persistForecast(
  database: Queryable,
  marketId: string,
  input: DirectMarketInput,
  forecast: DirectMarketForecast,
  competition: AggregateCompetition,
): Promise<void> {
  await sql`INSERT INTO passenger_market_forecasts
    (market_id, generated_at, demand_formula_version, input_snapshot, forecast)
    VALUES (${marketId}::uuid, ${forecast.generatedAt}::timestamptz,
      ${forecast.demandFormulaVersion}, ${JSON.stringify(input)}::jsonb,
      ${JSON.stringify(forecast)}::jsonb)
    ON CONFLICT (market_id, generated_at, demand_formula_version) DO NOTHING`.execute(database);
  await sql`INSERT INTO market_competition_snapshots
    (market_id, bucket, as_of, competition_formula_version, classification, snapshot)
    VALUES (${marketId}::uuid, ${competition.bucket}, ${competition.asOf}::timestamptz,
      ${competition.formulaVersion}, ${competition.classification},
      ${JSON.stringify(competition)}::jsonb)
    ON CONFLICT (market_id, bucket, competition_formula_version) DO NOTHING`.execute(database);
}

type LoadedMarket = Readonly<{
  context: MarketContext;
  market: MarketRow;
  input: DirectMarketInput;
  forecast: DirectMarketForecast;
  competition: AggregateCompetition;
  rules: MarketRules;
}>;

async function loadMarket(
  database: Queryable,
  playerAccountId: string,
  airlineId: string,
  marketId: string,
  at: Date,
): Promise<LoadedMarket> {
  const context = await airlineContext(database, playerAccountId, airlineId);
  const result = await sql<MarketRow & { origin_iata: string; destination_iata: string }>`SELECT
    m.id, m.origin_airport_id, m.destination_airport_id, m.stable_seed,
    origin.iata_code AS origin_iata, destination.iata_code AS destination_iata
    FROM passenger_markets m
    JOIN curated_airports origin ON origin.id = m.origin_airport_id
    JOIN curated_airports destination ON destination.id = m.destination_airport_id
    WHERE m.id = ${marketId}::uuid AND m.game_world_id = ${context.game_world_id}::uuid
      AND m.catalog_release_id = ${context.catalog_release_id}::uuid
      AND m.world_ruleset_id = ${context.world_ruleset_id}::uuid`.execute(database);
  const market = result.rows[0];
  if (!market) throw new MarketDomainError("market_not_found", "Passenger market is unavailable.");
  const [origin, destination] = await Promise.all([
    playableAirport(database, context.catalog_release_id, market.origin_iata),
    playableAirport(database, context.catalog_release_id, market.destination_iata),
  ]);
  const input = directInput(context, origin, destination);
  const rules = rulesFrom(context);
  const forecast = generateDirectMarketForecast(input, rules, at);
  return {
    context,
    market,
    input,
    forecast,
    competition: generateAggregateCompetition(forecast, rules, at),
    rules,
  };
}

function strategyFromRow(row: Readonly<Record<string, unknown>>): PricingStrategy {
  return {
    id: String(row.id),
    airlineId: String(row.airline_id),
    marketId: String(row.market_id),
    version: Number(row.version),
    effectiveFrom: (row.effective_from as Date).toISOString(),
    effectiveTo: row.effective_to ? (row.effective_to as Date).toISOString() : null,
    posture: row.posture as PricingPosture,
    currency: row.currency as CurrencyCode,
    baseFareMinor: String(row.base_fare_minor),
    minimumFareMinor: String(row.minimum_fare_minor),
    maximumFareMinor: String(row.maximum_fare_minor),
    loadFactorTargetBasisPoints: Number(row.load_factor_target_basis_points),
    revenueTargetMinor: String(row.revenue_target_minor),
    formulaVersion: String(row.pricing_formula_version),
    recommendation: String(row.recommendation),
  };
}

function offerFromRow(row: Readonly<Record<string, unknown>>): CommercialFlightOffer {
  return {
    offerId: String(row.id),
    airlineId: String(row.airline_id),
    marketId: String(row.market_id),
    economySellableCapacity: Number(row.economy_sellable_capacity),
    bookingOpensAt: (row.booking_opens_at as Date).toISOString(),
    departureAt: (row.departure_at as Date).toISOString(),
    scheduledArrivalAt: (row.scheduled_arrival_at as Date).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    scheduleQualityBasisPoints: Number(row.schedule_quality_basis_points),
    serviceQualityBasisPoints: Number(row.service_quality_basis_points),
    reputationBasisPoints: Number(row.reputation_basis_points),
    sourceType: row.source_type as CommercialFlightOffer["sourceType"],
    sourceVersion: String(row.source_version),
    sourceReference: String(row.source_reference),
    bookedPassengers: String(row.booked_passengers),
    realizedRevenueMinor: String(row.realized_revenue_minor),
    lastCheckpointAt: (row.last_checkpoint_at as Date).toISOString(),
    version: String(row.version),
  };
}

function checkpointFromRow(row: Readonly<Record<string, unknown>>): BookingCheckpoint {
  return {
    id: String(row.id),
    offerId: String(row.offer_id),
    intervalStart: (row.interval_start as Date).toISOString(),
    intervalEnd: (row.interval_end as Date).toISOString(),
    pricingStrategyId: String(row.pricing_strategy_id),
    pricingStrategyVersion: Number(row.pricing_strategy_version),
    passengersAdded: String(row.passengers_added),
    revenueAddedMinor: String(row.revenue_added_minor),
    cumulativePassengers: String(row.cumulative_passengers),
    cumulativeRevenueMinor: String(row.cumulative_revenue_minor),
    aggregates: row.aggregates as readonly BookingAggregate[],
    materialInputSnapshot: row.material_input_snapshot as Readonly<Record<string, unknown>>,
  };
}

export class KyselyMarketRepository implements MarketRepository {
  public constructor(private readonly database: Database) {}

  public async research(
    playerAccountId: string,
    airlineId: string,
    originIataCode: string,
    destinationIataCode: string,
    at: Date,
  ): Promise<MarketResearch> {
    const context = await airlineContext(this.database, playerAccountId, airlineId);
    const [origin, destination] = await Promise.all([
      playableAirport(this.database, context.catalog_release_id, originIataCode),
      playableAirport(this.database, context.catalog_release_id, destinationIataCode),
    ]);
    const market = await ensureMarket(this.database, context, origin, destination, at);
    const input = directInput(context, origin, destination);
    const rules = rulesFrom(context);
    const forecast = generateDirectMarketForecast(input, rules, at);
    const competition = generateAggregateCompetition(forecast, rules, at);
    await persistForecast(this.database, market.id, input, forecast, competition);
    return {
      marketId: market.id,
      forecast,
      competition,
      recommendedPricing: recommendedPricing(
        market.id,
        airlineId,
        context.currency,
        forecast.distanceNm,
        rules,
        at,
      ),
      explanation: [
        "Demand is a versioned derived/balance forecast, not a sourced live passenger count.",
        "Competition is aggregate simulated pressure; no AI airline, fleet, or schedule entity exists.",
        "The market is directed and bound to the career's immutable catalog and world-ruleset versions.",
      ],
    };
  }

  public createPricingStrategy(
    playerAccountId: string,
    airlineId: string,
    input: CreatePricingStrategyInput,
    now: Date,
  ): Promise<PricingStrategy> {
    return runInTransaction(this.database, async (transaction) => {
      const loaded = await loadMarket(transaction, playerAccountId, airlineId, input.marketId, now);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${airlineId}:${input.marketId}:pricing`}))`.execute(
        transaction,
      );
      const existingAtTime = await sql<Record<string, unknown>>`SELECT *
        FROM pricing_strategy_versions WHERE airline_id = ${airlineId}::uuid
          AND market_id = ${input.marketId}::uuid
          AND effective_from = ${input.effectiveFrom}::timestamptz`.execute(transaction);
      if (existingAtTime.rows[0]) {
        const existing = strategyFromRow(existingAtTime.rows[0]);
        if (
          existing.posture === input.posture &&
          existing.baseFareMinor === input.baseFareMinor &&
          existing.minimumFareMinor === input.minimumFareMinor &&
          existing.maximumFareMinor === input.maximumFareMinor &&
          existing.loadFactorTargetBasisPoints === input.loadFactorTargetBasisPoints &&
          existing.revenueTargetMinor === input.revenueTargetMinor
        )
          return existing;
        throw new MarketDomainError(
          "idempotency_conflict",
          "A different pricing strategy already uses this effective timestamp.",
        );
      }
      const versionResult = await sql<{
        version: number;
      }>`SELECT COALESCE(max(version), 0) + 1 AS version
        FROM pricing_strategy_versions WHERE airline_id = ${airlineId}::uuid
          AND market_id = ${input.marketId}::uuid`.execute(transaction);
      const version = Number(versionResult.rows[0]?.version ?? 1);
      const strategy: PricingStrategy = {
        id: randomUUID(),
        airlineId,
        marketId: input.marketId,
        version,
        effectiveFrom: new Date(input.effectiveFrom).toISOString(),
        effectiveTo: null,
        posture: input.posture,
        currency: loaded.context.currency,
        baseFareMinor: input.baseFareMinor,
        minimumFareMinor: input.minimumFareMinor,
        maximumFareMinor: input.maximumFareMinor,
        loadFactorTargetBasisPoints: input.loadFactorTargetBasisPoints,
        revenueTargetMinor: input.revenueTargetMinor,
        formulaVersion: loaded.rules.pricingFormulaVersion,
        recommendation:
          "Player-selected prospective strategy; each booking checkpoint snapshots the effective immutable version.",
      };
      validatePricingStrategy(strategy);
      const effective = new Date(strategy.effectiveFrom);
      if (Number.isNaN(effective.getTime()) || effective < now)
        throw new MarketDomainError(
          "invalid_pricing_strategy",
          "Pricing changes must have a valid prospective effective timestamp.",
        );
      await sql`INSERT INTO pricing_strategy_versions
        (id, airline_id, market_id, version, effective_from, posture, currency,
         base_fare_minor, minimum_fare_minor, maximum_fare_minor,
         load_factor_target_basis_points, revenue_target_minor, pricing_formula_version,
         recommendation)
        VALUES (${strategy.id}::uuid, ${airlineId}::uuid, ${input.marketId}::uuid, ${version},
          ${strategy.effectiveFrom}::timestamptz, ${strategy.posture}, ${strategy.currency},
          ${strategy.baseFareMinor}::bigint, ${strategy.minimumFareMinor}::bigint,
          ${strategy.maximumFareMinor}::bigint, ${strategy.loadFactorTargetBasisPoints},
          ${strategy.revenueTargetMinor}::bigint, ${strategy.formulaVersion},
          ${strategy.recommendation})`.execute(transaction);
      return strategy;
    });
  }

  public async pricingStrategies(
    playerAccountId: string,
    airlineId: string,
    marketId: string,
  ): Promise<readonly PricingStrategy[]> {
    await loadMarket(this.database, playerAccountId, airlineId, marketId, new Date(0));
    const result = await sql<Record<string, unknown>>`SELECT p.*,
      lead(effective_from) OVER (ORDER BY effective_from) AS effective_to
      FROM pricing_strategy_versions p WHERE airline_id = ${airlineId}::uuid
        AND market_id = ${marketId}::uuid ORDER BY effective_from, version`.execute(this.database);
    return result.rows.map(strategyFromRow);
  }

  public createCommercialOffer(
    playerAccountId: string,
    input: CommercialFlightOfferInput,
    now: Date,
  ): Promise<CommercialFlightOffer> {
    return runInTransaction(this.database, async (transaction) => {
      const loaded = await loadMarket(
        transaction,
        playerAccountId,
        input.airlineId,
        input.marketId,
        now,
      );
      const bookingOpens = new Date(input.bookingOpensAt);
      const departure = new Date(input.departureAt);
      const arrival = new Date(input.scheduledArrivalAt);
      if (
        !/^[0-9a-f-]{36}$/i.test(input.offerId) ||
        input.economySellableCapacity < 1 ||
        bookingOpens >= departure ||
        departure >= arrival ||
        input.durationMinutes < 1 ||
        Math.abs(arrival.getTime() - departure.getTime() - input.durationMinutes * 60_000) >
          60_000 ||
        [
          input.scheduleQualityBasisPoints,
          input.serviceQualityBasisPoints,
          input.reputationBasisPoints,
        ].some((value) => value < 0 || value > 10_000)
      ) {
        throw new MarketDomainError(
          "invalid_commercial_offer",
          "Commercial offer capacity, horizon, timing, duration, quality, or opaque UUID is invalid.",
        );
      }
      const inserted = await sql<Record<string, unknown>>`INSERT INTO commercial_flight_offers
        (id, airline_id, market_id, economy_sellable_capacity, booking_opens_at, departure_at,
         scheduled_arrival_at, duration_minutes, schedule_quality_basis_points,
         service_quality_basis_points, reputation_basis_points, source_type, source_version,
         source_reference, catalog_release_id, world_ruleset_id, market_ruleset_version_id,
         created_at, last_checkpoint_at)
        VALUES (${input.offerId}::uuid, ${input.airlineId}::uuid, ${input.marketId}::uuid,
          ${input.economySellableCapacity}, ${input.bookingOpensAt}::timestamptz,
          ${input.departureAt}::timestamptz, ${input.scheduledArrivalAt}::timestamptz,
          ${input.durationMinutes}, ${input.scheduleQualityBasisPoints},
          ${input.serviceQualityBasisPoints}, ${input.reputationBasisPoints}, ${input.sourceType},
          ${input.sourceVersion}, ${input.sourceReference}, ${loaded.context.catalog_release_id}::uuid,
          ${loaded.context.world_ruleset_id}::uuid, ${loaded.context.market_ruleset_version_id}::uuid,
          ${now.toISOString()}::timestamptz, ${input.bookingOpensAt}::timestamptz)
        ON CONFLICT DO NOTHING RETURNING *`.execute(transaction);
      const row = inserted.rows[0];
      if (!row) {
        const existingResult = await sql<Record<string, unknown>>`SELECT *
          FROM commercial_flight_offers WHERE id = ${input.offerId}::uuid
            OR (airline_id = ${input.airlineId}::uuid AND source_type = ${input.sourceType}
              AND source_reference = ${input.sourceReference}) FOR UPDATE`.execute(transaction);
        const existingRow = existingResult.rows[0];
        if (existingRow) {
          const existing = offerFromRow(existingRow);
          const same =
            existing.offerId === input.offerId &&
            existing.airlineId === input.airlineId &&
            existing.marketId === input.marketId &&
            existing.economySellableCapacity === input.economySellableCapacity &&
            existing.bookingOpensAt === new Date(input.bookingOpensAt).toISOString() &&
            existing.departureAt === new Date(input.departureAt).toISOString() &&
            existing.scheduledArrivalAt === new Date(input.scheduledArrivalAt).toISOString() &&
            existing.durationMinutes === input.durationMinutes &&
            existing.scheduleQualityBasisPoints === input.scheduleQualityBasisPoints &&
            existing.serviceQualityBasisPoints === input.serviceQualityBasisPoints &&
            existing.reputationBasisPoints === input.reputationBasisPoints &&
            existing.sourceType === input.sourceType &&
            existing.sourceVersion === input.sourceVersion &&
            existing.sourceReference === input.sourceReference;
          if (same) return existing;
        }
        throw new MarketDomainError(
          "offer_already_exists",
          "Commercial offer or source reference is already bound; ticket 12 must reuse the atomic binding.",
        );
      }
      await sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at)
        VALUES ('commercial_flight_offer', ${input.offerId}::uuid, 1,
          'market.commercial_offer_created.v1',
          ${JSON.stringify({ offerId: input.offerId, sourceType: input.sourceType, sourceVersion: input.sourceVersion })}::jsonb,
          ${now.toISOString()}::timestamptz)`.execute(transaction);
      return offerFromRow(row);
    });
  }

  public refreshBookings(
    playerAccountId: string,
    airlineId: string,
    offerId: string,
    checkpointAt: Date,
    idempotencyKey: string,
  ): Promise<BookingCheckpoint> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        await airlineContext(transaction, playerAccountId, airlineId);
        const offerResult = await sql<
          Record<string, unknown>
        >`SELECT * FROM commercial_flight_offers
          WHERE id = ${offerId}::uuid AND airline_id = ${airlineId}::uuid FOR UPDATE`.execute(
          transaction,
        );
        const offerRow = offerResult.rows[0];
        if (!offerRow)
          throw new MarketDomainError(
            "commercial_offer_not_found",
            "Commercial offer is unavailable.",
          );
        const requestedIntervalEnd =
          checkpointAt > (offerRow.departure_at as Date)
            ? (offerRow.departure_at as Date)
            : checkpointAt;
        const prior = await sql<Record<string, unknown>>`SELECT * FROM booking_checkpoints
          WHERE offer_id = ${offerId}::uuid AND source_idempotency_key = ${idempotencyKey}`.execute(
          transaction,
        );
        if (prior.rows[0]) {
          if ((prior.rows[0].interval_end as Date).getTime() !== requestedIntervalEnd.getTime())
            throw new MarketDomainError(
              "idempotency_conflict",
              "Idempotency key was reused for a different booking checkpoint.",
            );
          return checkpointFromRow(prior.rows[0]);
        }
        const offer = offerFromRow(offerRow);
        const departure = new Date(offer.departureAt);
        const intervalEnd = checkpointAt > departure ? departure : checkpointAt;
        const intervalStart = new Date(offer.lastCheckpointAt);
        if (intervalEnd.getTime() === intervalStart.getTime()) {
          const existingInterval = await sql<Record<string, unknown>>`SELECT *
            FROM booking_checkpoints WHERE offer_id = ${offerId}::uuid
              AND interval_end = ${intervalEnd.toISOString()}::timestamptz
            ORDER BY created_at DESC LIMIT 1`.execute(transaction);
          if (existingInterval.rows[0]) return checkpointFromRow(existingInterval.rows[0]);
          throw new MarketDomainError(
            "stale_booking_checkpoint",
            "Checkpoint must advance persisted elapsed booking time.",
          );
        }
        if (intervalEnd < intervalStart)
          throw new MarketDomainError(
            "stale_booking_checkpoint",
            "Checkpoint must advance persisted elapsed booking time.",
          );
        if (intervalStart >= departure)
          throw new MarketDomainError("booking_window_closed", "The booking window is closed.");
        const strategyResult = await sql<Record<string, unknown>>`SELECT *
          FROM pricing_strategy_versions WHERE airline_id = ${airlineId}::uuid
            AND market_id = ${offer.marketId}::uuid
            AND effective_from < ${intervalEnd.toISOString()}::timestamptz
          ORDER BY effective_from, version`.execute(transaction);
        const strategies = strategyResult.rows.map(strategyFromRow);
        const effectiveAtStart = strategies.findLast(
          (strategy) => new Date(strategy.effectiveFrom) <= intervalStart,
        );
        if (!effectiveAtStart)
          throw new MarketDomainError(
            "pricing_strategy_not_found",
            "No pricing strategy is effective for this booking interval.",
          );
        const boundaries = strategies
          .filter((strategy) => {
            const effective = new Date(strategy.effectiveFrom);
            return effective > intervalStart && effective < intervalEnd;
          })
          .map((strategy) => new Date(strategy.effectiveFrom));
        const periodEnds = [...boundaries, intervalEnd];
        let periodStart = intervalStart;
        let cumulativePassengers = BigInt(offer.bookedPassengers);
        let cumulativeRevenue = BigInt(offer.realizedRevenueMinor);
        let totalPassengersAdded = 0n;
        let finalCheckpoint: BookingCheckpoint | undefined;
        for (const [index, periodEnd] of periodEnds.entries()) {
          const strategy = strategies.findLast(
            (candidate) => new Date(candidate.effectiveFrom) <= periodStart,
          );
          if (!strategy)
            throw new MarketDomainError(
              "pricing_strategy_not_found",
              "No pricing strategy is effective for this booking interval.",
            );
          const loaded = await loadMarket(
            transaction,
            playerAccountId,
            airlineId,
            offer.marketId,
            periodEnd,
          );
          const remaining = BigInt(offer.economySellableCapacity) - cumulativePassengers;
          const result = calculateBookingInterval({
            seed: loaded.market.stable_seed,
            marketId: offer.marketId,
            offerId,
            intervalStart: periodStart,
            intervalEnd: periodEnd,
            departureAt: departure,
            remainingSeats: remaining,
            economySellableCapacity: BigInt(offer.economySellableCapacity),
            bookedPassengers: cumulativePassengers,
            realizedRevenueMinor: cumulativeRevenue,
            bookingHorizonSeconds: BigInt(
              Math.max(
                1,
                Math.floor(
                  (departure.getTime() - new Date(offer.bookingOpensAt).getTime()) / 1_000,
                ),
              ),
            ),
            elapsedBookingSeconds: BigInt(
              Math.max(
                0,
                Math.floor(
                  (periodStart.getTime() - new Date(offer.bookingOpensAt).getTime()) / 1_000,
                ),
              ),
            ),
            referenceFareMinor: BigInt(
              recommendedPricing(
                offer.marketId,
                airlineId,
                loaded.context.currency,
                loaded.forecast.distanceNm,
                loaded.rules,
                periodStart,
              ).baseFareMinor,
            ),
            segmentDailyDemand: Object.fromEntries(
              loaded.forecast.segments.map((item) => [item.segment, BigInt(item.dailyDemand)]),
            ) as Readonly<Record<PassengerSegment, bigint>>,
            strategy,
            competition: loaded.competition,
            scheduleQualityBasisPoints: offer.scheduleQualityBasisPoints,
            durationMinutes: offer.durationMinutes,
            referenceDurationMinutes: Math.max(
              45,
              Math.round((loaded.forecast.distanceNm * 60) / 480),
            ),
            serviceQualityBasisPoints: offer.serviceQualityBasisPoints,
            reputationBasisPoints: offer.reputationBasisPoints,
            seasonalityBasisPoints: loaded.forecast.seasonalityBasisPoints,
          });
          cumulativePassengers += result.passengers;
          cumulativeRevenue += result.revenueMinor;
          totalPassengersAdded += result.passengers;
          const materialInputSnapshot = {
            schemaVersion: "booking-material-input-v1",
            catalogReleaseVersion: loaded.context.catalog_release_version,
            worldRulesetVersion: loaded.context.world_ruleset_version,
            marketRulesVersion: loaded.context.market_ruleset_version,
            demandFormulaVersion: loaded.rules.demandFormulaVersion,
            competitionFormulaVersion: loaded.rules.competitionFormulaVersion,
            pricingFormulaVersion: loaded.rules.pricingFormulaVersion,
            marketForecast: loaded.forecast,
            competition: loaded.competition,
            pricingStrategy: strategy,
            commercialOffer: offer,
            effectiveFares: result.effectiveFares,
            noLedgerRevenuePosted: true,
          };
          const checkpointKey =
            index === periodEnds.length - 1 ? idempotencyKey : `${idempotencyKey}:period:${index}`;
          const checkpointResult = await sql<
            Record<string, unknown>
          >`INSERT INTO booking_checkpoints
            (offer_id, interval_start, interval_end, pricing_strategy_id, pricing_strategy_version,
             passengers_added, revenue_added_minor, cumulative_passengers, cumulative_revenue_minor,
             aggregates, material_input_snapshot, source_idempotency_key)
            VALUES (${offerId}::uuid, ${periodStart.toISOString()}::timestamptz,
              ${periodEnd.toISOString()}::timestamptz, ${strategy.id}::uuid, ${strategy.version},
              ${result.passengers.toString()}::integer, ${result.revenueMinor.toString()}::bigint,
              ${cumulativePassengers.toString()}::integer, ${cumulativeRevenue.toString()}::bigint,
              ${JSON.stringify(result.aggregates)}::jsonb, ${JSON.stringify(materialInputSnapshot)}::jsonb,
              ${checkpointKey}) RETURNING *`.execute(transaction);
          for (const aggregate of result.aggregates) {
            await sql`INSERT INTO booking_aggregate_totals
              (offer_id, segment, booking_class, passengers, revenue_minor)
              VALUES (${offerId}::uuid, ${aggregate.segment}, ${aggregate.bookingClass},
                ${aggregate.passengers}::integer, ${aggregate.revenueMinor}::bigint)
              ON CONFLICT (offer_id, segment, booking_class) DO UPDATE SET
                passengers = booking_aggregate_totals.passengers + EXCLUDED.passengers,
                revenue_minor = booking_aggregate_totals.revenue_minor + EXCLUDED.revenue_minor`.execute(
              transaction,
            );
          }
          const checkpointRow = checkpointResult.rows[0];
          if (!checkpointRow) throw new Error("Booking checkpoint was not persisted.");
          finalCheckpoint = checkpointFromRow(checkpointRow);
          periodStart = periodEnd;
        }
        await sql`UPDATE commercial_flight_offers SET last_checkpoint_at = ${intervalEnd.toISOString()}::timestamptz,
          booked_passengers = ${cumulativePassengers.toString()}::integer,
          realized_revenue_minor = ${cumulativeRevenue.toString()}::bigint,
          version = version + 1 WHERE id = ${offerId}::uuid`.execute(transaction);
        await sql`INSERT INTO outbox_events
          (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at)
          VALUES ('commercial_flight_offer', ${offerId}::uuid, ${(BigInt(offer.version) + 1n).toString()}::bigint,
            'market.bookings_refreshed.v1',
            ${JSON.stringify({ offerId, checkpointAt: intervalEnd.toISOString(), passengersAdded: totalPassengersAdded.toString() })}::jsonb,
            ${intervalEnd.toISOString()}::timestamptz)`.execute(transaction);
        if (!finalCheckpoint) throw new Error("Booking checkpoint was not persisted.");
        return finalCheckpoint;
      },
      { isolationLevel: "serializable" },
    );
  }

  public async offerAnalytics(
    playerAccountId: string,
    airlineId: string,
    offerId: string,
    at: Date,
  ): Promise<CommercialOfferAnalytics> {
    await airlineContext(this.database, playerAccountId, airlineId);
    const result = await sql<Record<string, unknown>>`SELECT * FROM commercial_flight_offers
      WHERE id = ${offerId}::uuid AND airline_id = ${airlineId}::uuid`.execute(this.database);
    const row = result.rows[0];
    if (!row)
      throw new MarketDomainError("commercial_offer_not_found", "Commercial offer is unavailable.");
    const offer = offerFromRow(row);
    const loaded = await loadMarket(this.database, playerAccountId, airlineId, offer.marketId, at);
    const totals = await sql<Record<string, unknown>>`SELECT segment, booking_class,
      passengers::text, revenue_minor::text FROM booking_aggregate_totals
      WHERE offer_id = ${offerId}::uuid ORDER BY segment, booking_class`.execute(this.database);
    const checkpoints = await sql<Record<string, unknown>>`SELECT * FROM booking_checkpoints
      WHERE offer_id = ${offerId}::uuid ORDER BY interval_end, id`.execute(this.database);
    const segmentMix = Object.fromEntries(
      (["business", "leisure", "vfr"] as const).map((segment) => [
        segment,
        totals.rows
          .filter((item) => item.segment === segment)
          .reduce((sum, item) => sum + BigInt(String(item.passengers)), 0n)
          .toString(),
      ]),
    ) as Readonly<Record<PassengerSegment, string>>;
    const elapsedMs = Math.max(
      1,
      new Date(offer.lastCheckpointAt).getTime() - new Date(offer.bookingOpensAt).getTime(),
    );
    const booked = BigInt(offer.bookedPassengers);
    return {
      offer,
      bookingPacePassengersPerDay: ((booked * 86_400_000n) / BigInt(elapsedMs)).toString(),
      loadFactorBasisPoints: (
        (booked * 10_000n) /
        BigInt(offer.economySellableCapacity)
      ).toString(),
      yieldMinorPerPassenger:
        booked === 0n ? "0" : (BigInt(offer.realizedRevenueMinor) / booked).toString(),
      segmentMix,
      competition: loaded.competition,
      aggregates: totals.rows.map((item) => ({
        segment: item.segment as PassengerSegment,
        bookingClass: item.booking_class as BookingAggregate["bookingClass"],
        passengers: String(item.passengers),
        revenueMinor: String(item.revenue_minor),
        realizedFareMinor:
          BigInt(String(item.passengers)) === 0n
            ? "0"
            : (BigInt(String(item.revenue_minor)) / BigInt(String(item.passengers))).toString(),
      })),
      checkpoints: checkpoints.rows.map(checkpointFromRow),
      explanation: [
        "Bookings accrue only from persisted elapsed checkpoints and are capped by economy sellable capacity.",
        "Yield uses exact realized minor-unit revenue; no revenue journal entry exists before ticket 17 settlement.",
        "Segment mix is aggregate and contains no individual passenger entity.",
      ],
      ledgerRevenuePosted: false,
    };
  }
}
