import type { CommercialFlightOfferInput, MarketResearch } from "./market.js";

export type SchedulingValidationCode =
  | "aircraft_unavailable"
  | "range_exceeded"
  | "runway_too_short"
  | "curfew_conflict"
  | "congestion_ceiling"
  | "outsourced_service_unavailable"
  | "cabotage_prohibited"
  | "chronology_conflict"
  | "turnaround_too_short"
  | "aircraft_position_mismatch"
  | "invalid_local_time"
  | "effective_date_too_soon";

export type SchedulingValidationIssue = Readonly<{
  code: SchedulingValidationCode;
  message: string;
  field?: string;
  suggestedCorrection: string;
}>;

export class SchedulingDomainError extends Error {
  public constructor(
    readonly code:
      | "route_not_found"
      | "aircraft_not_found"
      | "timetable_not_found"
      | "invalid_route"
      | "invalid_rotation"
      | "idempotency_conflict"
      | "historical_flight_protected",
    message: string,
    readonly issues: readonly SchedulingValidationIssue[] = [],
  ) {
    super(message);
    this.name = "SchedulingDomainError";
  }
}

export type AirportSchedulingFacts = Readonly<{
  id: string;
  iataCode: string;
  countryCode: string;
  timezoneName: string;
  latitudeDeg: string;
  longitudeDeg: string;
  longestRunwayFt: number;
  outsourcedServiceEligible: boolean;
  curfew?: Readonly<{ startsLocal: string; endsLocal: string }>;
  hourlyMovementCeiling: number;
  congestionFeeBasisPoints: number;
  minimumTurnaroundAdjustmentMinutes: number;
}>;

export type AircraftSchedulingFacts = Readonly<{
  id: string;
  airlineId: string;
  currentAirportId: string;
  variantCode: string;
  category: "turboprop" | "regional_jet" | "narrow_body";
  rangeNm: number;
  minimumRunwayFt: number;
  economySeats: number;
  deliveryState: "delivered" | "pending" | "returned" | "defaulted";
}>;

export type RouteForecast = Readonly<{
  distanceNm: number;
  plannedBlockMinutes: number;
  minimumTurnaroundMinutes: number;
  provisionalOperatingCostMinor: string;
  provisionalDailyDemand: string;
  currency: string;
  expectedDailyRevenueRangeMinor: readonly [string, string];
  expectedDailyProfitRangeMinor: readonly [string, string];
  economicsEffectiveAt: string;
  economicsAssumptions: readonly string[];
  operatingCostFormulaVersion: "schedule-cost-v1";
  economicsFormulaVersion: "schedule-economics-v1";
  blockTimeFormulaVersion: "schedule-block-v1";
  outsourcedService: true;
}>;

export type RouteResearch = Readonly<{
  market: MarketResearch;
  forecast: RouteForecast;
  valid: boolean;
  issues: readonly SchedulingValidationIssue[];
  explanations: readonly string[];
}>;

export type Route = Readonly<{
  id: string;
  airlineId: string;
  marketId: string;
  routeNumber: number;
  origin: AirportSchedulingFacts;
  destination: AirportSchedulingFacts;
  distanceNm: number;
  status: "researched" | "active";
  rulesetVersion: string;
  createdAt: string;
}>;

export type WeeklyLegInput = Readonly<{
  dayOfWeek: number;
  originIataCode: string;
  destinationIataCode: string;
  departureLocalTime: string;
}>;

export type ActivateTimetableInput = Readonly<{
  aircraftId: string;
  effectiveFromLocalDate: string;
  legs: readonly WeeklyLegInput[];
  horizonDays?: number;
}>;

export type DatedFlight = Readonly<{
  id: string;
  routeId: string;
  timetableVersionId: string;
  aircraftId: string;
  flightNumber: string;
  serviceDate: string;
  originIataCode: string;
  destinationIataCode: string;
  departureLocal: string;
  arrivalLocal: string;
  departureAt: string;
  arrivalAt: string;
  readyAt: string;
  status:
    | "scheduled"
    | "suspended"
    | "cancelled"
    | "delayed"
    | "boarding"
    | "departed"
    | "diverted"
    | "arrived"
    | "settled";
  commercialOffer: CommercialFlightOfferInput;
}>;

export type TimetableActivation = Readonly<{
  route: Route;
  timetableVersionId: string;
  version: number;
  effectiveFrom: string;
  generatedThrough: string;
  aircraftId: string;
  flights: readonly DatedFlight[];
  validation: Readonly<{ valid: true; issues: readonly [] }>;
}>;

export type RoutePlanningSnapshot = Readonly<{
  route: Route;
  forecast: RouteForecast;
  timetable?: Readonly<{
    timetableVersionId: string;
    version: number;
    effectiveFrom: string;
    generatedThrough: string;
    aircraftId: string;
    legs: readonly WeeklyLegInput[];
    flights: readonly DatedFlight[];
  }>;
}>;

export interface SchedulingRepository {
  airlineHomeJurisdiction(airlineId: string, playerAccountId: string): Promise<string>;
  airportFacts(
    airlineId: string,
    iataCode: string,
    playerAccountId: string,
  ): Promise<AirportSchedulingFacts>;
  aircraftFacts(
    airlineId: string,
    aircraftId: string,
    playerAccountId: string,
  ): Promise<AircraftSchedulingFacts>;
  createRoute(
    playerAccountId: string,
    airlineId: string,
    marketId: string,
    originIataCode: string,
    destinationIataCode: string,
    forecast: RouteForecast,
    now: Date,
  ): Promise<Route>;
  listRoutes(playerAccountId: string, airlineId: string): Promise<readonly Route[]>;
  getRoutePlanning(
    playerAccountId: string,
    airlineId: string,
    routeId: string,
  ): Promise<RoutePlanningSnapshot>;
  activateTimetable(
    playerAccountId: string,
    airlineId: string,
    routeId: string,
    input: ActivateTimetableInput,
    now: Date,
  ): Promise<TimetableActivation>;
  extendHorizon(
    playerAccountId: string,
    airlineId: string,
    timetableVersionId: string,
    through: Date,
    now: Date,
  ): Promise<TimetableActivation>;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function greatCircleDistanceNm(
  origin: Pick<AirportSchedulingFacts, "latitudeDeg" | "longitudeDeg">,
  destination: Pick<AirportSchedulingFacts, "latitudeDeg" | "longitudeDeg">,
): number {
  const lat1 = radians(Number(origin.latitudeDeg));
  const lat2 = radians(Number(destination.latitudeDeg));
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(Number(destination.longitudeDeg) - Number(origin.longitudeDeg));
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return Math.round(3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function forecastRoute(
  origin: AirportSchedulingFacts,
  destination: AirportSchedulingFacts,
  aircraft: AircraftSchedulingFacts,
  market: MarketResearch,
): RouteForecast {
  const distanceNm = greatCircleDistanceNm(origin, destination);
  const cruiseKnots =
    aircraft.category === "turboprop" ? 275 : aircraft.category === "regional_jet" ? 430 : 455;
  const plannedBlockMinutes = Math.ceil((distanceNm * 60) / cruiseKnots) + 30;
  const minimumTurnaroundMinutes =
    (aircraft.category === "turboprop" ? 35 : aircraft.category === "regional_jet" ? 40 : 50) +
    Math.max(
      origin.minimumTurnaroundAdjustmentMinutes,
      destination.minimumTurnaroundAdjustmentMinutes,
    );
  const costPerNm =
    aircraft.category === "turboprop" ? 115 : aircraft.category === "regional_jet" ? 190 : 265;
  const provisionalDailyDemand = market.forecast.segments
    .reduce((sum, segment) => sum + Number(segment.dailyDemand), 0)
    .toFixed(3);
  const dailyDemand = Number(provisionalDailyDemand);
  const sellablePassengers = Math.max(0, Math.min(aircraft.economySeats, dailyDemand));
  const fare = BigInt(market.recommendedPricing.baseFareMinor);
  const operatingCost = BigInt(
    Math.round(
      ((distanceNm * costPerNm + plannedBlockMinutes * 75) *
        (10_000 + origin.congestionFeeBasisPoints + destination.congestionFeeBasisPoints)) /
        10_000,
    ),
  );
  const revenueMidpoint = BigInt(Math.round(sellablePassengers)) * fare;
  const revenueLow = (revenueMidpoint * 8n) / 10n;
  const revenueHigh = (revenueMidpoint * 12n) / 10n;
  return {
    distanceNm,
    plannedBlockMinutes,
    minimumTurnaroundMinutes,
    provisionalOperatingCostMinor: operatingCost.toString(),
    provisionalDailyDemand,
    currency: market.recommendedPricing.currency,
    expectedDailyRevenueRangeMinor: [revenueLow.toString(), revenueHigh.toString()],
    expectedDailyProfitRangeMinor: [
      (revenueLow - operatingCost).toString(),
      (revenueHigh - operatingCost).toString(),
    ],
    economicsEffectiveAt: market.competition.asOf,
    economicsAssumptions: [
      "One daily direct departure with the selected aircraft economy capacity.",
      "Revenue uses the authoritative recommended base fare and an 80%-120% demand uncertainty range.",
      "Profit subtracts the scheduling operating-cost forecast and excludes future settlement variance.",
    ],
    operatingCostFormulaVersion: "schedule-cost-v1",
    economicsFormulaVersion: "schedule-economics-v1",
    blockTimeFormulaVersion: "schedule-block-v1",
    outsourcedService: true,
  };
}

export function validateRoute(
  origin: AirportSchedulingFacts,
  destination: AirportSchedulingFacts,
  aircraft: AircraftSchedulingFacts,
  airlineHomeJurisdiction: string,
  forecast: RouteForecast,
): readonly SchedulingValidationIssue[] {
  const issues: SchedulingValidationIssue[] = [];
  if (aircraft.deliveryState !== "delivered")
    issues.push({
      code: "aircraft_unavailable",
      message: "The aircraft has not been delivered and cannot operate a timetable.",
      field: "aircraftId",
      suggestedCorrection: "Wait for delivery or select a delivered aircraft.",
    });
  if (forecast.distanceNm > aircraft.rangeNm)
    issues.push({
      code: "range_exceeded",
      message: `The ${forecast.distanceNm} nm route exceeds the aircraft range of ${aircraft.rangeNm} nm.`,
      field: "aircraftId",
      suggestedCorrection: "Select an aircraft with more range or choose a shorter route.",
    });
  for (const airport of [origin, destination])
    if (!airport.outsourcedServiceEligible)
      issues.push({
        code: "outsourced_service_unavailable",
        message: `${airport.iataCode} is not eligible for outsourced slice-one service.`,
        field: airport === origin ? "originIataCode" : "destinationIataCode",
        suggestedCorrection: "Choose an airport eligible for outsourced service.",
      });
  for (const airport of [origin, destination])
    if (airport.longestRunwayFt < aircraft.minimumRunwayFt)
      issues.push({
        code: "runway_too_short",
        message: `${airport.iataCode}'s ${airport.longestRunwayFt} ft runway is shorter than the required ${aircraft.minimumRunwayFt} ft.`,
        field: airport === origin ? "originIataCode" : "destinationIataCode",
        suggestedCorrection: "Use a runway-compatible aircraft or another airport.",
      });
  if (
    origin.countryCode === destination.countryCode &&
    origin.countryCode !== airlineHomeJurisdiction
  )
    issues.push({
      code: "cabotage_prohibited",
      message: `Foreign domestic service within ${origin.countryCode} is not permitted for this airline.`,
      suggestedCorrection:
        "Choose an international route or a domestic route in the airline's home jurisdiction.",
    });
  return issues;
}

export type RotationInterval = Readonly<{
  originAirportId: string;
  destinationAirportId: string;
  departureAt: Date;
  arrivalAt: Date;
  readyAt: Date;
}>;

export function validateRotationIntervals(
  intervals: readonly RotationInterval[],
  initialAirportId: string,
): readonly SchedulingValidationIssue[] {
  const issues: SchedulingValidationIssue[] = [];
  const ordered = [...intervals].sort(
    (left, right) => left.departureAt.getTime() - right.departureAt.getTime(),
  );
  const first = ordered[0];
  if (first && first.originAirportId !== initialAirportId)
    issues.push({
      code: "aircraft_position_mismatch",
      message: "The first leg does not start at the aircraft's position.",
      field: "legs",
      suggestedCorrection: "Start at the current aircraft airport or add a positioning leg.",
    });
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = ordered[index + 1];
    if (current.departureAt >= current.arrivalAt || current.arrivalAt >= current.readyAt)
      issues.push({
        code: "chronology_conflict",
        message: "A leg must depart, arrive, and finish turnaround in chronological order.",
        field: "legs",
        suggestedCorrection: "Correct block time and turnaround values.",
      });
    if (next && current.readyAt > next.departureAt)
      issues.push({
        code: "turnaround_too_short",
        message: "Aircraft occupancy overlaps the next leg.",
        field: "legs",
        suggestedCorrection: `Move the next departure to ${current.readyAt.toISOString()} or later.`,
      });
    if (next && current.destinationAirportId !== next.originAirportId)
      issues.push({
        code: "aircraft_position_mismatch",
        message: "Consecutive legs do not preserve aircraft position.",
        field: "legs",
        suggestedCorrection:
          "Depart the next leg from the previous destination or add a positioning leg.",
      });
  }
  return issues;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };
function partsAt(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

export function localDateTimeToUtc(localDate: string, localTime: string, timezone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const time = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!match || !time)
    throw new SchedulingDomainError("invalid_rotation", "Local date or time is invalid.", [
      {
        code: "invalid_local_time",
        message: "Use ISO local date and 24-hour time values.",
        suggestedCorrection: "Use YYYY-MM-DD and HH:MM.",
      },
    ]);
  const target: LocalParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(time[1]),
    minute: Number(time[2]),
  };
  const naive = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const candidates: Date[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(naive - offsetMinutes * 60_000);
    const actual = partsAt(candidate, timezone);
    if (
      Object.keys(target).every(
        (key) => actual[key as keyof LocalParts] === target[key as keyof LocalParts],
      )
    )
      candidates.push(candidate);
  }
  if (candidates.length === 0)
    throw new SchedulingDomainError(
      "invalid_rotation",
      `The local time ${localDate} ${localTime} does not exist in ${timezone}.`,
      [
        {
          code: "invalid_local_time",
          message: "The selected local time falls in a daylight-saving clock gap.",
          suggestedCorrection: "Move the departure after the DST transition gap.",
        },
      ],
    );
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0]!;
}

export function localDisplay(instant: Date, timezone: string): string {
  const value = partsAt(instant, timezone);
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}T${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
}

export function isLocalTimeInCurfew(
  localTime: string,
  curfew: Readonly<{ startsLocal: string; endsLocal: string }>,
): boolean {
  const minutes = (value: string) => {
    const [hour, minute] = value.slice(0, 5).split(":").map(Number);
    return hour! * 60 + minute!;
  };
  const value = minutes(localTime);
  const start = minutes(curfew.startsLocal);
  const end = minutes(curfew.endsLocal);
  return start < end ? value >= start && value < end : value >= start || value < end;
}
