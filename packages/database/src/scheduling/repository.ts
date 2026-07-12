import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  SchedulingDomainError,
  localDateTimeToUtc,
  localDisplay,
  isLocalTimeInCurfew,
  validateRoute,
  type ActivateTimetableInput,
  type AircraftSchedulingFacts,
  type AirportSchedulingFacts,
  type DatedFlight,
  type Route,
  type RouteForecast,
  type SchedulingRepository,
  type SchedulingValidationIssue,
  type TimetableActivation,
} from "@airline-manager/domain";
import type { DB } from "../generated/database.js";
import type { Database } from "../database.js";
import { runInTransaction } from "../transactions.js";

type Queryable = Database | Transaction<DB>;
const RULESET_VERSION = "scheduling-v1";

function schedulingConstraint(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23P01") {
    throw new SchedulingDomainError(
      "invalid_rotation",
      "The aircraft is already assigned during part of this rotation.",
      [
        {
          code: "chronology_conflict",
          message: "Aircraft occupancy overlaps an existing dated flight at the database boundary.",
          field: "legs",
          suggestedCorrection:
            "Move the conflicting departure until after the existing flight and turnaround.",
        },
      ],
    );
  }
  throw error;
}

type AirlineContext = Readonly<{
  airline_id: string;
  game_world_id: string;
  home_jurisdiction: string;
  catalog_release_id: string;
  scheduling_ruleset_version_id: string;
  scheduling_ruleset_version: string;
  default_horizon_days: number;
  maximum_horizon_days: number;
}>;

type RouteRow = Readonly<{
  id: string;
  airline_id: string;
  market_id: string;
  origin_airport_id: string;
  destination_airport_id: string;
  route_number: number;
  distance_nm: number;
  forecast_snapshot: unknown;
  ruleset_version: string;
  status: "researched" | "active";
  created_at: Date;
  origin_iata: string;
  origin_country: string;
  origin_timezone: string;
  origin_latitude: string;
  origin_longitude: string;
  origin_runway: number;
  destination_iata: string;
  destination_country: string;
  destination_timezone: string;
  destination_latitude: string;
  destination_longitude: string;
  destination_runway: number;
  origin_outsourced: boolean;
  origin_ceiling: number;
  origin_curfew_start: string | null;
  origin_curfew_end: string | null;
  origin_fee_basis_points: number;
  origin_turnaround_adjustment: number;
  destination_outsourced: boolean;
  destination_ceiling: number;
  destination_curfew_start: string | null;
  destination_curfew_end: string | null;
  destination_fee_basis_points: number;
  destination_turnaround_adjustment: number;
}>;

type TimetableRow = Readonly<{
  id: string;
  route_id: string;
  version: number;
  effective_from: Date | string;
  generated_through: Date | string;
  aircraft_id: string;
  rotation_id: string;
}>;

type TemplateRow = Readonly<{
  id: string;
  sequence: number;
  day_of_week: number;
  origin_airport_id: string;
  destination_airport_id: string;
  origin_iata: string;
  destination_iata: string;
  departure_local_time: string;
  origin_timezone: string;
  destination_timezone: string;
  planned_block_minutes: number;
  minimum_turnaround_minutes: number;
}>;

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function context(
  database: Queryable,
  playerAccountId: string,
  airlineId: string,
): Promise<AirlineContext> {
  const result =
    await sql<AirlineContext>`SELECT a.id AS airline_id, a.game_world_id, a.home_jurisdiction,
    c.catalog_release_id, sr.id AS scheduling_ruleset_version_id, sr.version AS scheduling_ruleset_version,
    sr.default_horizon_days, sr.maximum_horizon_days FROM airlines a JOIN careers c ON c.id = a.career_id
    JOIN scheduling_ruleset_versions sr ON sr.world_ruleset_id = c.world_ruleset_id AND sr.status = 'active'
    JOIN resource_ownerships own ON own.resource_type = 'airline' AND own.resource_id = a.id
      AND own.player_account_id = ${playerAccountId}::uuid
    WHERE a.id = ${airlineId}::uuid AND a.status = 'active'`.execute(database);
  const row = result.rows[0];
  if (!row)
    throw new SchedulingDomainError("route_not_found", "Scheduling resources are unavailable.");
  return row;
}

async function airport(
  database: Queryable,
  catalogReleaseId: string,
  schedulingRulesetVersionId: string,
  iataCode: string,
): Promise<AirportSchedulingFacts> {
  const result = await sql<
    Record<string, unknown>
  >`SELECT a.id, a.iata_code, a.country_code, a.timezone_name,
    a.latitude_deg::text, a.longitude_deg::text, a.longest_runway_ft,
    rule.outsourced_service_eligible, rule.hourly_movement_ceiling,
    rule.curfew_starts_local::text, rule.curfew_ends_local::text,
    rule.congestion_fee_basis_points, rule.minimum_turnaround_adjustment_minutes
    FROM catalog_release_airports member JOIN curated_airports a ON a.id = member.airport_id
    JOIN airport_scheduling_rules rule ON rule.airport_id = a.id
      AND rule.scheduling_ruleset_version_id = ${schedulingRulesetVersionId}::uuid
    WHERE member.release_id = ${catalogReleaseId}::uuid AND a.iata_code = ${iataCode}`.execute(
    database,
  );
  const row = result.rows[0];
  if (!row)
    throw new SchedulingDomainError("invalid_route", `${iataCode} is not a playable airport.`);
  return {
    id: String(row.id),
    iataCode: String(row.iata_code),
    countryCode: String(row.country_code),
    timezoneName: String(row.timezone_name),
    latitudeDeg: String(row.latitude_deg),
    longitudeDeg: String(row.longitude_deg),
    longestRunwayFt: Number(row.longest_runway_ft),
    outsourcedServiceEligible: Boolean(row.outsourced_service_eligible),
    ...(row.curfew_starts_local && row.curfew_ends_local
      ? {
          curfew: {
            startsLocal: String(row.curfew_starts_local).slice(0, 5),
            endsLocal: String(row.curfew_ends_local).slice(0, 5),
          },
        }
      : {}),
    hourlyMovementCeiling: Number(row.hourly_movement_ceiling),
    congestionFeeBasisPoints: Number(row.congestion_fee_basis_points),
    minimumTurnaroundAdjustmentMinutes: Number(row.minimum_turnaround_adjustment_minutes),
  };
}

async function aircraft(
  database: Queryable,
  airlineId: string,
  aircraftId: string,
): Promise<AircraftSchedulingFacts> {
  const result = await sql<
    Record<string, unknown>
  >`SELECT ac.id, ac.operator_airline_id, ac.current_airport_id,
    ac.delivery_state, ac.variant_snapshot, cabin.economy_seats
    FROM aircraft ac JOIN aircraft_cabin_configurations cabin ON cabin.aircraft_id = ac.id
    WHERE ac.id = ${aircraftId}::uuid AND ac.operator_airline_id = ${airlineId}::uuid`.execute(
    database,
  );
  const row = result.rows[0];
  if (!row) throw new SchedulingDomainError("aircraft_not_found", "Aircraft is unavailable.");
  const snapshot = row.variant_snapshot as Record<string, unknown>;
  return {
    id: String(row.id),
    airlineId: String(row.operator_airline_id),
    currentAirportId: String(row.current_airport_id ?? ""),
    variantCode: String(snapshot.code),
    category: snapshot.category as AircraftSchedulingFacts["category"],
    rangeNm: Number(snapshot.rangeNm ?? snapshot.range_nm),
    minimumRunwayFt: Number(snapshot.minimumRunwayFt ?? snapshot.minimum_runway_ft),
    economySeats: Number(row.economy_seats),
    deliveryState: row.delivery_state as AircraftSchedulingFacts["deliveryState"],
  };
}

function factsFromRoute(row: RouteRow, side: "origin" | "destination"): AirportSchedulingFacts {
  const prefix = side === "origin" ? "origin" : "destination";
  const runway = row[`${prefix}_runway` as keyof RouteRow] as number;
  const iata = row[`${prefix}_iata` as keyof RouteRow] as string;
  const curfewStart = row[`${prefix}_curfew_start` as keyof RouteRow] as string | null;
  const curfewEnd = row[`${prefix}_curfew_end` as keyof RouteRow] as string | null;
  return {
    id: row[`${prefix}_airport_id` as keyof RouteRow] as string,
    iataCode: iata,
    countryCode: row[`${prefix}_country` as keyof RouteRow] as string,
    timezoneName: row[`${prefix}_timezone` as keyof RouteRow] as string,
    latitudeDeg: row[`${prefix}_latitude` as keyof RouteRow] as string,
    longitudeDeg: row[`${prefix}_longitude` as keyof RouteRow] as string,
    longestRunwayFt: runway,
    outsourcedServiceEligible: row[`${prefix}_outsourced` as keyof RouteRow] as boolean,
    ...(curfewStart && curfewEnd
      ? { curfew: { startsLocal: curfewStart.slice(0, 5), endsLocal: curfewEnd.slice(0, 5) } }
      : {}),
    hourlyMovementCeiling: row[`${prefix}_ceiling` as keyof RouteRow] as number,
    congestionFeeBasisPoints: row[`${prefix}_fee_basis_points` as keyof RouteRow] as number,
    minimumTurnaroundAdjustmentMinutes: row[
      `${prefix}_turnaround_adjustment` as keyof RouteRow
    ] as number,
  };
}

function routeFrom(row: RouteRow): Route {
  return {
    id: row.id,
    airlineId: row.airline_id,
    marketId: row.market_id,
    routeNumber: row.route_number,
    origin: factsFromRoute(row, "origin"),
    destination: factsFromRoute(row, "destination"),
    distanceNm: row.distance_nm,
    status: row.status,
    rulesetVersion: row.ruleset_version,
    createdAt: row.created_at.toISOString(),
  };
}

async function loadRoute(
  database: Queryable,
  airlineId: string,
  routeId?: string,
): Promise<RouteRow[]> {
  const result =
    await sql<RouteRow>`SELECT r.*, oa.iata_code AS origin_iata, oa.country_code AS origin_country,
    oa.timezone_name AS origin_timezone, oa.latitude_deg::text AS origin_latitude, oa.longitude_deg::text AS origin_longitude,
    oa.longest_runway_ft AS origin_runway, da.iata_code AS destination_iata, da.country_code AS destination_country,
    da.timezone_name AS destination_timezone, da.latitude_deg::text AS destination_latitude,
    da.longitude_deg::text AS destination_longitude, da.longest_runway_ft AS destination_runway,
    osr.outsourced_service_eligible AS origin_outsourced, osr.hourly_movement_ceiling AS origin_ceiling,
    osr.curfew_starts_local::text AS origin_curfew_start, osr.curfew_ends_local::text AS origin_curfew_end,
    osr.congestion_fee_basis_points AS origin_fee_basis_points,
    osr.minimum_turnaround_adjustment_minutes AS origin_turnaround_adjustment,
    dsr.outsourced_service_eligible AS destination_outsourced, dsr.hourly_movement_ceiling AS destination_ceiling,
    dsr.curfew_starts_local::text AS destination_curfew_start, dsr.curfew_ends_local::text AS destination_curfew_end,
    dsr.congestion_fee_basis_points AS destination_fee_basis_points,
    dsr.minimum_turnaround_adjustment_minutes AS destination_turnaround_adjustment
    FROM airline_routes r JOIN curated_airports oa ON oa.id = r.origin_airport_id
    JOIN curated_airports da ON da.id = r.destination_airport_id
    JOIN airlines al ON al.id = r.airline_id JOIN careers career ON career.id = al.career_id
    JOIN scheduling_ruleset_versions srv ON srv.world_ruleset_id = career.world_ruleset_id AND srv.status = 'active'
    JOIN airport_scheduling_rules osr ON osr.scheduling_ruleset_version_id = srv.id AND osr.airport_id = oa.id
    JOIN airport_scheduling_rules dsr ON dsr.scheduling_ruleset_version_id = srv.id AND dsr.airport_id = da.id
    WHERE r.airline_id = ${airlineId}::uuid ${routeId ? sql`AND r.id = ${routeId}::uuid` : sql``}
    ORDER BY r.route_number`.execute(database);
  return [...result.rows];
}

type Planned = Readonly<{
  template: TemplateRow;
  serviceDate: string;
  departureAt: Date;
  arrivalAt: Date;
  readyAt: Date;
  departureLocal: string;
  arrivalLocal: string;
}>;

function planOccurrences(
  templates: readonly TemplateRow[],
  from: string,
  through: string,
): Planned[] {
  const planned: Planned[] = [];
  for (let cursor = from; cursor <= through; cursor = addDays(cursor, 1)) {
    const weekday = new Date(`${cursor}T12:00:00Z`).getUTCDay();
    for (const template of templates.filter((item) => item.day_of_week === weekday)) {
      const departureAt = localDateTimeToUtc(
        cursor,
        template.departure_local_time.slice(0, 5),
        template.origin_timezone,
      );
      const arrivalAt = new Date(departureAt.getTime() + template.planned_block_minutes * 60_000);
      const readyAt = new Date(arrivalAt.getTime() + template.minimum_turnaround_minutes * 60_000);
      planned.push({
        template,
        serviceDate: cursor,
        departureAt,
        arrivalAt,
        readyAt,
        departureLocal: localDisplay(departureAt, template.origin_timezone),
        arrivalLocal: localDisplay(arrivalAt, template.destination_timezone),
      });
    }
  }
  return planned.sort((left, right) => left.departureAt.getTime() - right.departureAt.getTime());
}

function validatePlanned(
  planned: readonly Planned[],
  initialAirportId: string,
  airports: ReadonlyMap<string, AirportSchedulingFacts>,
): SchedulingValidationIssue[] {
  const issues: SchedulingValidationIssue[] = [];
  const first = planned[0];
  if (first && first.template.origin_airport_id !== initialAirportId)
    issues.push({
      code: "aircraft_position_mismatch",
      message: "The first leg does not depart from the aircraft's current airport.",
      field: "legs",
      suggestedCorrection:
        "Start the rotation at the aircraft's current airport or add a positioning leg.",
    });
  for (let index = 0; index < planned.length; index += 1) {
    const current = planned[index]!;
    const next = planned[index + 1];
    if (next && current.readyAt > next.departureAt)
      issues.push({
        code: "turnaround_too_short",
        message: `Leg ${current.template.sequence} is not ready before the following departure.`,
        field: "legs",
        suggestedCorrection: `Move the next departure to ${current.readyAt.toISOString()} or later.`,
      });
    if (next && current.template.destination_airport_id !== next.template.origin_airport_id)
      issues.push({
        code: "aircraft_position_mismatch",
        message: "Consecutive legs do not preserve aircraft position.",
        field: "legs",
        suggestedCorrection: `Make the next leg depart from ${current.template.destination_iata} or add a positioning leg.`,
      });
    const origin = airports.get(current.template.origin_airport_id);
    const destination = airports.get(current.template.destination_airport_id);
    if (origin?.curfew && isLocalTimeInCurfew(current.departureLocal.slice(11), origin.curfew))
      issues.push({
        code: "curfew_conflict",
        message: `${origin.iataCode} departure is inside its curfew.`,
        field: "legs",
        suggestedCorrection: `Schedule outside ${origin.curfew.startsLocal}-${origin.curfew.endsLocal} local.`,
      });
    if (
      destination?.curfew &&
      isLocalTimeInCurfew(current.arrivalLocal.slice(11), destination.curfew)
    )
      issues.push({
        code: "curfew_conflict",
        message: `${destination.iataCode} arrival is inside its curfew.`,
        field: "legs",
        suggestedCorrection: `Schedule arrival outside ${destination.curfew.startsLocal}-${destination.curfew.endsLocal} local.`,
      });
  }
  const movements = new Map<string, number>();
  for (const item of planned)
    for (const [airportId, local] of [
      [item.template.origin_airport_id, item.departureLocal],
      [item.template.destination_airport_id, item.arrivalLocal],
    ] as const) {
      const key = `${airportId}|${local.slice(0, 13)}`;
      movements.set(key, (movements.get(key) ?? 0) + 1);
      const airportFacts = airports.get(airportId);
      if (airportFacts && movements.get(key)! > airportFacts.hourlyMovementCeiling)
        issues.push({
          code: "congestion_ceiling",
          message: `${airportFacts.iataCode}'s hourly scheduling ceiling is exceeded.`,
          field: "legs",
          suggestedCorrection: "Move one or more legs to an adjacent local hour.",
        });
    }
  return issues;
}

async function validateCongestionAgainstPersisted(
  database: Queryable,
  planned: readonly Planned[],
  airports: ReadonlyMap<string, AirportSchedulingFacts>,
): Promise<SchedulingValidationIssue[]> {
  const proposed = new Map<string, { airportId: string; bucket: string; count: number }>();
  for (const item of planned)
    for (const [airportId, local] of [
      [item.template.origin_airport_id, item.departureLocal],
      [item.template.destination_airport_id, item.arrivalLocal],
    ] as const) {
      const bucket = local.slice(0, 13);
      const key = `${airportId}|${bucket}`;
      proposed.set(key, { airportId, bucket, count: (proposed.get(key)?.count ?? 0) + 1 });
    }
  const issues: SchedulingValidationIssue[] = [];
  for (const movement of proposed.values()) {
    const existing = await sql<{ count: string }>`SELECT count(*)::text AS count FROM (
      SELECT origin_airport_id AS airport_id, left(departure_local, 13) AS bucket FROM dated_flights WHERE status <> 'cancelled'
      UNION ALL
      SELECT destination_airport_id AS airport_id, left(arrival_local, 13) AS bucket FROM dated_flights WHERE status <> 'cancelled'
    ) movements WHERE airport_id = ${movement.airportId}::uuid AND bucket = ${movement.bucket}`.execute(
      database,
    );
    const facts = airports.get(movement.airportId);
    if (
      facts &&
      Number(existing.rows[0]?.count ?? 0) + movement.count > facts.hourlyMovementCeiling
    )
      issues.push({
        code: "congestion_ceiling",
        message: `${facts.iataCode}'s ${movement.bucket}:00 local scheduling ceiling is exceeded.`,
        field: "legs",
        suggestedCorrection: "Move the departure or arrival to an adjacent local hour.",
      });
  }
  return issues;
}

function flightFromRow(
  row: Record<string, unknown>,
  route: Route,
  economySeats: number,
): DatedFlight {
  const departureAt = new Date(String(row.departure_at));
  const arrivalAt = new Date(String(row.arrival_at));
  const id = String(row.id);
  const duration = Number(row.planned_block_minutes);
  return {
    id,
    routeId: route.id,
    timetableVersionId: String(row.timetable_version_id),
    aircraftId: String(row.aircraft_id),
    flightNumber: String(row.flight_number),
    serviceDate: dateOnly(row.service_date as Date | string),
    originIataCode: String(row.origin_iata),
    destinationIataCode: String(row.destination_iata),
    departureLocal: String(row.departure_local),
    arrivalLocal: String(row.arrival_local),
    departureAt: departureAt.toISOString(),
    arrivalAt: arrivalAt.toISOString(),
    readyAt: new Date(String(row.ready_at)).toISOString(),
    status: row.status as DatedFlight["status"],
    commercialOffer: {
      offerId: id,
      airlineId: route.airlineId,
      marketId: route.marketId,
      economySellableCapacity: economySeats,
      bookingOpensAt: new Date(departureAt.getTime() - 30 * 86_400_000).toISOString(),
      departureAt: departureAt.toISOString(),
      scheduledArrivalAt: arrivalAt.toISOString(),
      durationMinutes: duration,
      scheduleQualityBasisPoints: 8_000,
      serviceQualityBasisPoints: 6_500,
      reputationBasisPoints: 5_000,
      sourceType: "external_dated_flight",
      sourceVersion: RULESET_VERSION,
      sourceReference: id,
    },
  };
}

export class KyselySchedulingRepository implements SchedulingRepository {
  public constructor(private readonly database: Database) {}

  public async airlineHomeJurisdiction(
    airlineId: string,
    playerAccountId: string,
  ): Promise<string> {
    return (await context(this.database, playerAccountId, airlineId)).home_jurisdiction;
  }

  public async airportFacts(airlineId: string, iataCode: string, playerAccountId: string) {
    const ctx = await context(this.database, playerAccountId, airlineId);
    return airport(
      this.database,
      ctx.catalog_release_id,
      ctx.scheduling_ruleset_version_id,
      iataCode,
    );
  }
  public async aircraftFacts(airlineId: string, aircraftId: string, playerAccountId: string) {
    await context(this.database, playerAccountId, airlineId);
    return aircraft(this.database, airlineId, aircraftId);
  }

  public async createRoute(
    playerAccountId: string,
    airlineId: string,
    marketId: string,
    originIataCode: string,
    destinationIataCode: string,
    forecast: RouteForecast,
    now: Date,
  ): Promise<Route> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        const ctx = await context(transaction, playerAccountId, airlineId);
        const origin = await airport(
          transaction,
          ctx.catalog_release_id,
          ctx.scheduling_ruleset_version_id,
          originIataCode,
        );
        const destination = await airport(
          transaction,
          ctx.catalog_release_id,
          ctx.scheduling_ruleset_version_id,
          destinationIataCode,
        );
        await sql`INSERT INTO airline_routes (airline_id, market_id, origin_airport_id, destination_airport_id, route_number,
        distance_nm, forecast_snapshot, ruleset_version, status, created_at)
        VALUES (${airlineId}::uuid, ${marketId}::uuid, ${origin.id}::uuid, ${destination.id}::uuid,
          (SELECT COALESCE(MAX(route_number), 0) + 1 FROM airline_routes WHERE airline_id = ${airlineId}::uuid),
          ${forecast.distanceNm}, ${JSON.stringify(forecast)}::jsonb, ${RULESET_VERSION}, 'researched', ${now.toISOString()}::timestamptz)
        ON CONFLICT (airline_id, market_id) DO NOTHING`.execute(transaction);
        const row = (await loadRoute(transaction, airlineId)).find(
          (item) => item.market_id === marketId,
        );
        if (!row) throw new Error("Route was not persisted.");
        return routeFrom(row);
      },
      { isolationLevel: "serializable" },
    ).catch(schedulingConstraint);
  }

  public async listRoutes(playerAccountId: string, airlineId: string): Promise<readonly Route[]> {
    await context(this.database, playerAccountId, airlineId);
    return (await loadRoute(this.database, airlineId)).map(routeFrom);
  }

  public async activateTimetable(
    playerAccountId: string,
    airlineId: string,
    routeId: string,
    input: ActivateTimetableInput,
    now: Date,
  ): Promise<TimetableActivation> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        const ctx = await context(transaction, playerAccountId, airlineId);
        const horizonDays = input.horizonDays ?? ctx.default_horizon_days;
        if (horizonDays < 7 || horizonDays > ctx.maximum_horizon_days)
          throw new SchedulingDomainError(
            "invalid_rotation",
            `Scheduling horizon must be between 7 and ${ctx.maximum_horizon_days} days.`,
          );
        const row = (await loadRoute(transaction, airlineId, routeId))[0];
        if (!row) throw new SchedulingDomainError("route_not_found", "Route is unavailable.");
        const route = routeFrom(row);
        const plane = await aircraft(transaction, airlineId, input.aircraftId);
        const tomorrow = addDays(now.toISOString().slice(0, 10), 1);
        if (input.effectiveFromLocalDate < tomorrow)
          throw new SchedulingDomainError(
            "invalid_rotation",
            "A timetable must take effect prospectively.",
            [
              {
                code: "effective_date_too_soon",
                message: "The effective date is not after the current server date.",
                field: "effectiveFromLocalDate",
                suggestedCorrection: `Use ${tomorrow} or a later date.`,
              },
            ],
          );
        const endpoints = new Map([
          [route.origin.iataCode, route.origin],
          [route.destination.iataCode, route.destination],
        ]);
        if (input.legs.length === 0)
          throw new SchedulingDomainError(
            "invalid_rotation",
            "At least one weekly leg is required.",
          );
        const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.aircraftId}, 12))`.execute(
          transaction,
        );
        const existing =
          await sql<TimetableRow>`SELECT tv.id, tv.route_id, tv.version, tv.effective_from, tv.generated_through,
        ar.aircraft_id, ar.id AS rotation_id FROM timetable_versions tv JOIN aircraft_rotations ar ON ar.timetable_version_id = tv.id
        WHERE tv.route_id = ${routeId}::uuid AND tv.effective_from = ${input.effectiveFromLocalDate}::date AND tv.input_hash = ${hash}`.execute(
            transaction,
          );
        if (existing.rows[0])
          return this.readActivation(transaction, route, existing.rows[0], plane.economySeats);

        const routeIssues = validateRoute(
          route.origin,
          route.destination,
          plane,
          ctx.home_jurisdiction,
          row.forecast_snapshot as RouteForecast,
        );
        if (routeIssues.length)
          throw new SchedulingDomainError(
            "invalid_rotation",
            "The route is not compatible with this aircraft.",
            routeIssues,
          );
        for (const leg of input.legs)
          if (
            !endpoints.has(leg.originIataCode) ||
            !endpoints.has(leg.destinationIataCode) ||
            leg.originIataCode === leg.destinationIataCode ||
            leg.dayOfWeek < 0 ||
            leg.dayOfWeek > 6
          )
            throw new SchedulingDomainError(
              "invalid_rotation",
              "Every leg must be a valid direction of the researched direct route.",
            );
        const templates: TemplateRow[] = input.legs.map((leg, index) => {
          const origin = endpoints.get(leg.originIataCode)!;
          const destination = endpoints.get(leg.destinationIataCode)!;
          return {
            id: randomUUID(),
            sequence: index + 1,
            day_of_week: leg.dayOfWeek,
            origin_airport_id: origin.id,
            destination_airport_id: destination.id,
            origin_iata: origin.iataCode,
            destination_iata: destination.iataCode,
            departure_local_time: leg.departureLocalTime,
            origin_timezone: origin.timezoneName,
            destination_timezone: destination.timezoneName,
            planned_block_minutes: (row.forecast_snapshot as RouteForecast).plannedBlockMinutes,
            minimum_turnaround_minutes: (row.forecast_snapshot as RouteForecast)
              .minimumTurnaroundMinutes,
          };
        });
        const through = addDays(input.effectiveFromLocalDate, horizonDays - 1);
        const airportMap = new Map([
          [route.origin.id, route.origin],
          [route.destination.id, route.destination],
        ]);
        const validationPlan = planOccurrences(templates, input.effectiveFromLocalDate, through);
        const issues = [
          ...validatePlanned(validationPlan, plane.currentAirportId, airportMap),
          ...(await validateCongestionAgainstPersisted(transaction, validationPlan, airportMap)),
        ];
        if (issues.length)
          throw new SchedulingDomainError(
            "invalid_rotation",
            "The aircraft rotation is not physically coherent.",
            issues,
          );

        const active = await sql<
          Record<string, unknown>
        >`SELECT * FROM timetable_versions WHERE route_id = ${routeId}::uuid AND status = 'active' FOR UPDATE`.execute(
          transaction,
        );
        const previous = active.rows[0];
        if (
          previous &&
          input.effectiveFromLocalDate <= dateOnly(previous.generated_through as Date | string)
        )
          throw new SchedulingDomainError(
            "historical_flight_protected",
            `A replacement version must take effect after the protected generated horizon ${dateOnly(previous.generated_through as Date | string)}.`,
          );
        if (previous) {
          await sql`UPDATE timetable_versions SET status = 'superseded', effective_to = ${input.effectiveFromLocalDate}::date
          WHERE id = ${String(previous.id)}::uuid`.execute(transaction);
        }
        const version = Number(previous?.version ?? 0) + 1;
        const timetableId = randomUUID();
        const rotationId = randomUUID();
        await sql`INSERT INTO timetable_versions (id, route_id, version, effective_from, status, input_hash, ruleset_version, generated_through, activated_at)
        VALUES (${timetableId}::uuid, ${routeId}::uuid, ${version}, ${input.effectiveFromLocalDate}::date, 'active', ${hash}, ${RULESET_VERSION}, ${through}::date, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        for (const template of templates)
          await sql`INSERT INTO flight_leg_templates (id, timetable_version_id, sequence, day_of_week, origin_airport_id,
        destination_airport_id, departure_local_time, origin_timezone, destination_timezone, planned_block_minutes, minimum_turnaround_minutes)
        VALUES (${template.id}::uuid, ${timetableId}::uuid, ${template.sequence}, ${template.day_of_week}, ${template.origin_airport_id}::uuid,
          ${template.destination_airport_id}::uuid, ${template.departure_local_time}::time, ${template.origin_timezone}, ${template.destination_timezone},
          ${template.planned_block_minutes}, ${template.minimum_turnaround_minutes})`.execute(
            transaction,
          );
        await sql`INSERT INTO aircraft_rotations (id, timetable_version_id, aircraft_id, initial_airport_id, ruleset_version, activated_at)
        VALUES (${rotationId}::uuid, ${timetableId}::uuid, ${plane.id}::uuid, ${plane.currentAirportId}::uuid, ${RULESET_VERSION}, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        for (const template of templates)
          await sql`INSERT INTO rotation_leg_assignments (rotation_id, flight_leg_template_id, sequence)
        VALUES (${rotationId}::uuid, ${template.id}::uuid, ${template.sequence})`.execute(
            transaction,
          );
        await sql`UPDATE airline_routes SET status = 'active' WHERE id = ${routeId}::uuid`.execute(
          transaction,
        );
        await this.persistFlights(
          transaction,
          route,
          {
            id: timetableId,
            route_id: routeId,
            version,
            effective_from: input.effectiveFromLocalDate,
            generated_through: through,
            aircraft_id: plane.id,
            rotation_id: rotationId,
          },
          templates,
          plane,
          input.effectiveFromLocalDate,
          through,
          now,
        );
        await sql`INSERT INTO outbox_events (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
        VALUES ('timetable', ${timetableId}::uuid, ${version}, 'scheduling.horizon_generated.v1',
          ${JSON.stringify({ timetableVersionId: timetableId, generatedThrough: through })}::jsonb, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        return this.readActivation(
          transaction,
          { ...route, status: "active" },
          {
            id: timetableId,
            route_id: routeId,
            version,
            effective_from: input.effectiveFromLocalDate,
            generated_through: through,
            aircraft_id: plane.id,
            rotation_id: rotationId,
          },
          plane.economySeats,
        );
      },
      { isolationLevel: "serializable", maximumAttempts: 4 },
    ).catch(schedulingConstraint);
  }

  public async extendHorizon(
    playerAccountId: string,
    airlineId: string,
    timetableVersionId: string,
    through: Date,
    now: Date,
  ): Promise<TimetableActivation> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        const ctx = await context(transaction, playerAccountId, airlineId);
        const result =
          await sql<TimetableRow>`SELECT tv.id, tv.route_id, tv.version, tv.effective_from, tv.generated_through,
        ar.aircraft_id, ar.id AS rotation_id FROM timetable_versions tv JOIN aircraft_rotations ar ON ar.timetable_version_id = tv.id
        JOIN airline_routes r ON r.id = tv.route_id WHERE tv.id = ${timetableVersionId}::uuid AND r.airline_id = ${airlineId}::uuid FOR UPDATE`.execute(
            transaction,
          );
        const found = result.rows[0];
        if (!found)
          throw new SchedulingDomainError("timetable_not_found", "Timetable is unavailable.");
        let timetable: TimetableRow = found;
        const target = through.toISOString().slice(0, 10);
        const maximum = addDays(now.toISOString().slice(0, 10), ctx.maximum_horizon_days);
        if (target > maximum)
          throw new SchedulingDomainError(
            "invalid_rotation",
            `The generated horizon cannot exceed ${ctx.maximum_horizon_days} days from authoritative server time.`,
          );
        const rows = await loadRoute(transaction, airlineId, timetable.route_id);
        const route = routeFrom(rows[0]!);
        const plane = await aircraft(transaction, airlineId, timetable.aircraft_id);
        if (target > dateOnly(timetable.generated_through)) {
          const templates = await this.templates(transaction, timetable.id);
          const from = addDays(dateOnly(timetable.generated_through), 1);
          const airportMap = new Map([
            [route.origin.id, route.origin],
            [route.destination.id, route.destination],
          ]);
          const plan = planOccurrences(templates, from, target);
          const issues = [
            ...validatePlanned(
              plan,
              plan[0]?.template.origin_airport_id ?? plane.currentAirportId,
              airportMap,
            ),
            ...(await validateCongestionAgainstPersisted(transaction, plan, airportMap)),
          ];
          if (issues.length)
            throw new SchedulingDomainError(
              "invalid_rotation",
              "The requested horizon extension is not physically or operationally feasible.",
              issues,
            );
          await this.persistFlights(
            transaction,
            route,
            timetable,
            templates,
            plane,
            from,
            target,
            now,
          );
          await sql`UPDATE timetable_versions SET generated_through = ${target}::date WHERE id = ${timetable.id}::uuid`.execute(
            transaction,
          );
          timetable = { ...timetable, generated_through: target };
          await sql`INSERT INTO outbox_events (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
          VALUES ('timetable', ${timetable.id}::uuid, ${Math.floor(through.getTime() / 86_400_000) + 1}, 'scheduling.horizon_extended.v1',
            ${JSON.stringify({ timetableVersionId: timetable.id, generatedThrough: target })}::jsonb, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
          ON CONFLICT DO NOTHING`.execute(transaction);
        }
        return this.readActivation(transaction, route, timetable, plane.economySeats);
      },
      { isolationLevel: "serializable", maximumAttempts: 4 },
    );
  }

  private async templates(database: Queryable, timetableId: string): Promise<TemplateRow[]> {
    const result =
      await sql<TemplateRow>`SELECT t.*, oa.iata_code AS origin_iata, da.iata_code AS destination_iata,
      t.departure_local_time::text FROM flight_leg_templates t JOIN curated_airports oa ON oa.id = t.origin_airport_id
      JOIN curated_airports da ON da.id = t.destination_airport_id WHERE t.timetable_version_id = ${timetableId}::uuid ORDER BY t.sequence`.execute(
        database,
      );
    return [...result.rows];
  }

  private async persistFlights(
    database: Queryable,
    route: Route,
    timetable: TimetableRow,
    templates: readonly TemplateRow[],
    plane: AircraftSchedulingFacts,
    from: string,
    through: string,
    now: Date,
  ): Promise<void> {
    const planned = planOccurrences(templates, from, through);
    for (const item of planned) {
      const id = randomUUID();
      const forecast = {
        rulesetVersion: RULESET_VERSION,
        distanceNm: route.distanceNm,
        plannedBlockMinutes: item.template.planned_block_minutes,
        minimumTurnaroundMinutes: item.template.minimum_turnaround_minutes,
      };
      await sql`INSERT INTO dated_flights (id, route_id, timetable_version_id, flight_leg_template_id, rotation_id, aircraft_id,
        market_id, service_date, flight_number, origin_airport_id, destination_airport_id, departure_local, arrival_local,
        departure_at, arrival_at, ready_at, planned_block_minutes, minimum_turnaround_minutes, status, ruleset_version, forecast_snapshot, created_at)
        VALUES (${id}::uuid, ${route.id}::uuid, ${timetable.id}::uuid, ${item.template.id}::uuid, ${timetable.rotation_id}::uuid,
          ${plane.id}::uuid, ${route.marketId}::uuid, ${item.serviceDate}::date, ${`AM${route.routeNumber}${item.template.sequence}`},
          ${item.template.origin_airport_id}::uuid, ${item.template.destination_airport_id}::uuid, ${item.departureLocal}, ${item.arrivalLocal},
          ${item.departureAt.toISOString()}::timestamptz, ${item.arrivalAt.toISOString()}::timestamptz, ${item.readyAt.toISOString()}::timestamptz,
          ${item.template.planned_block_minutes}, ${item.template.minimum_turnaround_minutes}, 'scheduled', ${RULESET_VERSION},
          ${JSON.stringify(forecast)}::jsonb, ${now.toISOString()}::timestamptz)
        ON CONFLICT (flight_leg_template_id, service_date) DO NOTHING`.execute(database);
    }
  }

  private async readActivation(
    database: Queryable,
    route: Route,
    timetable: TimetableRow,
    economySeats: number,
  ): Promise<TimetableActivation> {
    const result = await sql<
      Record<string, unknown>
    >`SELECT df.*, oa.iata_code AS origin_iata, da.iata_code AS destination_iata
      FROM dated_flights df JOIN curated_airports oa ON oa.id = df.origin_airport_id JOIN curated_airports da ON da.id = df.destination_airport_id
      WHERE df.timetable_version_id = ${timetable.id}::uuid AND df.status <> 'cancelled' ORDER BY df.departure_at, df.id`.execute(
      database,
    );
    return {
      route,
      timetableVersionId: timetable.id,
      version: timetable.version,
      effectiveFrom: dateOnly(timetable.effective_from),
      generatedThrough: dateOnly(timetable.generated_through),
      aircraftId: timetable.aircraft_id,
      flights: result.rows.map((row) => flightFromRow(row, route, economySeats)),
      validation: { valid: true, issues: [] },
    };
  }
}
