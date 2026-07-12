export type ClimateZone = "tropical" | "arid" | "temperate" | "continental" | "polar";

export type AirportClimateProfile = Readonly<{
  airportId: string;
  iataCode: string;
  latitudeDeg: string;
  longitudeDeg: string;
  elevationFt: number | null;
  timezoneName: string;
  climateDataVersion: string;
  zone: ClimateZone;
  baselineWindKt: number;
  seasonalWindAmplitudeKt: number;
  storminessBasisPoints: number;
  lowVisibilityBasisPoints: number;
  wetSeasonPeakMonth: number;
  provenance: Readonly<Record<string, unknown>>;
}>;

export type WeatherRules = Readonly<{
  worldSeed: string;
  worldRulesetVersion: string;
  weatherRulesetVersion: string;
  climateDataVersion: string;
  formulaVersion: string;
  systemBucketHours: number;
  correlationCellDegrees: number;
  maximumForecastLeadHours: number;
}>;

export type WeatherConditions = Readonly<{
  windSpeedKt: number;
  windDirectionDeg: number;
  visibilityMeters: number;
  precipitationBasisPoints: number;
  convectiveRiskBasisPoints: number;
}>;

export type WeatherOperationalModifiers = Readonly<{
  runwayCapacityBasisPoints: number;
  congestionDelayRiskBasisPoints: number;
  blockTimeBasisPoints: number;
  diversionRiskBasisPoints: number;
  fuelBurnBasisPoints: number;
  reliabilityBasisPoints: number;
}>;

export type WeatherUncertainty = Readonly<{
  leadHours: number;
  spreadBasisPoints: number;
  windSpreadKt: number;
  visibilitySpreadMeters: number;
  processVersion: "seeded-lead-spread-v1";
}>;

export type AirportWeatherSnapshot = Readonly<{
  airportId: string;
  iataCode: string;
  issuedAt: string;
  validAt: string;
  rules: WeatherRules;
  climate: AirportClimateProfile;
  conditions: WeatherConditions;
  modifiers: WeatherOperationalModifiers;
  uncertainty: WeatherUncertainty;
  materialInputHash: string;
  explanations: readonly string[];
}>;

export type RouteWeatherPlan = Readonly<{
  origin: AirportWeatherSnapshot;
  destination: AirportWeatherSnapshot;
  expectedBlockTimeBasisPoints: number;
  expectedFuelBurnBasisPoints: number;
  runwayCapacityBasisPoints: number;
  congestionDelayRiskBasisPoints: number;
  diversionRiskBasisPoints: number;
  reliabilityBasisPoints: number;
  uncertaintyBasisPoints: number;
  bounds: Readonly<{
    blockTimeBasisPoints: readonly [9_000, 13_500];
    fuelBurnBasisPoints: readonly [9_500, 12_500];
    runwayCapacityBasisPoints: readonly [4_000, 10_000];
    reliabilityBasisPoints: readonly [8_000, 10_000];
  }>;
  explanations: readonly string[];
}>;

export type WeatherForecastSnapshot = Readonly<{
  id: string;
  scope: "route" | "departure";
  scopeId: string;
  issuedAt: string;
  validAt: string;
  plan: RouteWeatherPlan;
  materialInputSnapshot: Readonly<Record<string, unknown>>;
}>;

export type WeatherRealizedSnapshot = Readonly<{
  id: string;
  forecastSnapshotId: string;
  realizedAt: string;
  plan: RouteWeatherPlan;
  uncertaintyProcessVersion: "seeded-lead-spread-v1";
  materialInputSnapshot: Readonly<Record<string, unknown>>;
}>;

export class WeatherDomainError extends Error {
  public constructor(
    readonly code:
      | "weather_not_found"
      | "invalid_weather_time"
      | "forecast_horizon_exceeded"
      | "idempotency_conflict",
    message: string,
  ) {
    super(message);
    this.name = "WeatherDomainError";
  }
}

function hash32(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function sample(material: string, channel: string): number {
  return hash32(`${material}|${channel}`) / 4_294_967_295;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(left: number, right: number, fraction: number): number {
  return left + (right - left) * fraction;
}

function stableMaterialHash(value: string): string {
  return ["a", "b", "c", "d", "e", "f", "g", "h"]
    .map((channel) => hash32(`${channel}|${value}`).toString(16).padStart(8, "0"))
    .join("");
}

function systemSample(
  rules: WeatherRules,
  profile: AirportClimateProfile,
  validAt: Date,
  channel: string,
): number {
  const bucketMs = rules.systemBucketHours * 3_600_000;
  const bucket = Math.floor(validAt.getTime() / bucketMs);
  const fraction = (validAt.getTime() % bucketMs) / bucketMs;
  const cell = rules.correlationCellDegrees;
  const latitudeCell = Math.floor(Number(profile.latitudeDeg) / cell);
  const longitudeCell = Math.floor(Number(profile.longitudeDeg) / cell);
  const material = `${rules.worldSeed}|${rules.worldRulesetVersion}|${rules.weatherRulesetVersion}|${rules.climateDataVersion}|${latitudeCell}|${longitudeCell}`;
  return lerp(
    sample(`${material}|${bucket}`, channel),
    sample(`${material}|${bucket + 1}`, channel),
    fraction,
  );
}

function season(profile: AirportClimateProfile, validAt: Date): number {
  const month = validAt.getUTCMonth() + 1;
  const distance = Math.abs(month - profile.wetSeasonPeakMonth);
  const circularDistance = Math.min(distance, 12 - distance);
  return 1 - circularDistance / 6;
}

function uncertaintyFor(issuedAt: Date, validAt: Date): WeatherUncertainty {
  const leadHours = Math.max(0, Math.floor((validAt.getTime() - issuedAt.getTime()) / 3_600_000));
  const spreadBasisPoints = clamp(300 + leadHours * 45, 300, 3_000);
  return {
    leadHours,
    spreadBasisPoints,
    windSpreadKt: 2 + Math.floor(spreadBasisPoints / 250),
    visibilitySpreadMeters: 500 + spreadBasisPoints,
    processVersion: "seeded-lead-spread-v1",
  };
}

function operationalModifiers(conditions: WeatherConditions): WeatherOperationalModifiers {
  const visibilityPenalty = clamp(Math.floor((10_000 - conditions.visibilityMeters) / 2), 0, 3_000);
  const windPenalty = clamp((conditions.windSpeedKt - 12) * 75, 0, 2_500);
  const disruption = Math.floor(
    (conditions.precipitationBasisPoints + conditions.convectiveRiskBasisPoints) / 3,
  );
  return {
    runwayCapacityBasisPoints: clamp(
      10_000 - visibilityPenalty - windPenalty - disruption,
      4_000,
      10_000,
    ),
    congestionDelayRiskBasisPoints: clamp(
      500 + visibilityPenalty + windPenalty + disruption,
      0,
      8_000,
    ),
    blockTimeBasisPoints: clamp(
      10_000 + Math.floor(windPenalty / 2) + Math.floor(disruption / 3),
      9_000,
      13_500,
    ),
    diversionRiskBasisPoints: clamp(
      Math.floor(visibilityPenalty / 2) + Math.floor(disruption / 4),
      0,
      2_500,
    ),
    fuelBurnBasisPoints: clamp(
      10_000 + Math.floor(windPenalty / 3) + Math.floor(disruption / 4),
      9_500,
      12_500,
    ),
    reliabilityBasisPoints: clamp(
      10_000 - Math.floor(disruption / 2) - Math.floor(windPenalty / 3),
      8_000,
      10_000,
    ),
  };
}

export function generateAirportWeather(
  rules: WeatherRules,
  profile: AirportClimateProfile,
  issuedAt: Date,
  validAt: Date,
  mode: "forecast" | "realized" = "forecast",
): AirportWeatherSnapshot {
  if (validAt < issuedAt)
    throw new WeatherDomainError("invalid_weather_time", "Weather valid time precedes issue time.");
  const uncertainty = uncertaintyFor(issuedAt, validAt);
  if (uncertainty.leadHours > rules.maximumForecastLeadHours)
    throw new WeatherDomainError(
      "forecast_horizon_exceeded",
      `Weather lead time exceeds ${rules.maximumForecastLeadHours} hours.`,
    );
  const seasonal = season(profile, validAt);
  const baseMaterial = `${rules.worldSeed}|${rules.weatherRulesetVersion}|${profile.airportId}|${issuedAt.toISOString()}|${validAt.toISOString()}|${uncertainty.processVersion}`;
  const uncertaintyScale = mode === "forecast" ? uncertainty.spreadBasisPoints : 300;
  const uncertaintyDraw = (sample(baseMaterial, mode) * 2 - 1) * uncertaintyScale;
  const windSpeedKt = clamp(
    Math.round(
      profile.baselineWindKt +
        profile.seasonalWindAmplitudeKt * seasonal +
        (systemSample(rules, profile, validAt, "wind") * 2 - 1) * 18 +
        uncertaintyDraw / 500,
    ),
    0,
    65,
  );
  const precipitationBasisPoints = clamp(
    Math.round(
      profile.storminessBasisPoints * (0.55 + seasonal * 0.45) +
        (systemSample(rules, profile, validAt, "precipitation") * 2 - 1) * 2_000 +
        uncertaintyDraw / 2,
    ),
    0,
    10_000,
  );
  const convectiveRiskBasisPoints = clamp(
    Math.round(
      (profile.zone === "tropical" ? 1_400 : 300) +
        precipitationBasisPoints / 2 +
        uncertaintyDraw / 3,
    ),
    0,
    10_000,
  );
  const visibilityMeters = clamp(
    Math.round(
      18_000 -
        profile.lowVisibilityBasisPoints * 1.2 -
        precipitationBasisPoints * 0.7 +
        (systemSample(rules, profile, validAt, "visibility") * 2 - 1) * 3_000 -
        uncertaintyDraw,
    ),
    800,
    25_000,
  );
  const conditions: WeatherConditions = {
    windSpeedKt,
    windDirectionDeg: Math.round(systemSample(rules, profile, validAt, "direction") * 359),
    visibilityMeters,
    precipitationBasisPoints,
    convectiveRiskBasisPoints,
  };
  const modifiers = operationalModifiers(conditions);
  const materialInput = JSON.stringify({ rules, profile, issuedAt, validAt, mode });
  return {
    airportId: profile.airportId,
    iataCode: profile.iataCode,
    issuedAt: issuedAt.toISOString(),
    validAt: validAt.toISOString(),
    rules,
    climate: profile,
    conditions,
    modifiers,
    uncertainty,
    materialInputHash: stableMaterialHash(materialInput),
    explanations: [
      `${profile.iataCode} uses ${profile.zone} climate inputs from ${profile.climateDataVersion}.`,
      `A ${rules.correlationCellDegrees}-degree, ${rules.systemBucketHours}-hour seeded system field supplies geographic and temporal correlation.`,
      `Lead-time uncertainty is ${uncertainty.spreadBasisPoints} bp and is reproduced by ${uncertainty.processVersion}.`,
    ],
  };
}

export function planRouteWeather(
  origin: AirportWeatherSnapshot,
  destination: AirportWeatherSnapshot,
): RouteWeatherPlan {
  const average = (left: number, right: number) => Math.round((left + right) / 2);
  const expectedBlockTimeBasisPoints = clamp(
    average(origin.modifiers.blockTimeBasisPoints, destination.modifiers.blockTimeBasisPoints),
    9_000,
    13_500,
  );
  const expectedFuelBurnBasisPoints = clamp(
    average(origin.modifiers.fuelBurnBasisPoints, destination.modifiers.fuelBurnBasisPoints),
    9_500,
    12_500,
  );
  return {
    origin,
    destination,
    expectedBlockTimeBasisPoints,
    expectedFuelBurnBasisPoints,
    runwayCapacityBasisPoints: Math.min(
      origin.modifiers.runwayCapacityBasisPoints,
      destination.modifiers.runwayCapacityBasisPoints,
    ),
    congestionDelayRiskBasisPoints: Math.max(
      origin.modifiers.congestionDelayRiskBasisPoints,
      destination.modifiers.congestionDelayRiskBasisPoints,
    ),
    diversionRiskBasisPoints: Math.max(
      origin.modifiers.diversionRiskBasisPoints,
      destination.modifiers.diversionRiskBasisPoints,
    ),
    reliabilityBasisPoints: Math.min(
      origin.modifiers.reliabilityBasisPoints,
      destination.modifiers.reliabilityBasisPoints,
    ),
    uncertaintyBasisPoints: Math.max(
      origin.uncertainty.spreadBasisPoints,
      destination.uncertainty.spreadBasisPoints,
    ),
    bounds: {
      blockTimeBasisPoints: [9_000, 13_500],
      fuelBurnBasisPoints: [9_500, 12_500],
      runwayCapacityBasisPoints: [4_000, 10_000],
      reliabilityBasisPoints: [8_000, 10_000],
    },
    explanations: [
      `Expected block time is bounded to ${expectedBlockTimeBasisPoints} bp after endpoint wind and disruption inputs.`,
      `Expected fuel burn is bounded to ${expectedFuelBurnBasisPoints} bp; this is advisory and does not consume ticket 10 inventory.`,
      "Runway capacity, congestion, diversion, and reliability use the more restrictive endpoint result.",
    ],
  };
}

export interface WeatherRepository {
  forecastRoute(
    playerAccountId: string,
    airlineId: string,
    routeId: string,
    issuedAt: Date,
    validAt: Date,
  ): Promise<WeatherForecastSnapshot>;
  forecastDeparture(
    playerAccountId: string,
    airlineId: string,
    datedFlightId: string,
    issuedAt: Date,
  ): Promise<WeatherForecastSnapshot>;
  realizeForecast(forecastSnapshotId: string, realizedAt: Date): Promise<WeatherRealizedSnapshot>;
}
