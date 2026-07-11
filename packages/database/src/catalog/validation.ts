export type AirportCandidate = Readonly<{
  source_record_id: string;
  ident?: string;
  iata_code?: string;
  icao_code?: string;
  name?: string;
  municipality?: string;
  country_code?: string;
  region_code?: string;
  world_region?: string;
  latitude_deg?: string | number;
  longitude_deg?: string | number;
  elevation_ft?: string | number | null;
  timezone_name?: string;
  longest_runway_ft?: string | number;
  scheduled_service?: boolean;
  commercial_relevance?: string;
}>;

export type AirportValidationResult = Readonly<{
  ruleCode: string;
  passed: boolean;
  severity: "error" | "warning";
  message: string;
}>;

export function validateAirportCandidate(
  airport: AirportCandidate,
  validTimezones: ReadonlySet<string>,
): readonly AirportValidationResult[] {
  const latitude = Number(airport.latitude_deg);
  const longitude = Number(airport.longitude_deg);
  const runway = Number(airport.longest_runway_ft);
  const required = [
    airport.ident,
    airport.iata_code,
    airport.icao_code,
    airport.name,
    airport.municipality,
    airport.country_code,
    airport.region_code,
    airport.world_region,
    airport.timezone_name,
  ];
  return [
    {
      ruleCode: "coordinates_valid",
      passed:
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180,
      severity: "error",
      message: "Latitude must be within -90..90 and longitude within -180..180.",
    },
    {
      ruleCode: "timezone_valid",
      passed: Boolean(airport.timezone_name && validTimezones.has(airport.timezone_name)),
      severity: "error",
      message: "Timezone must exist in the pinned IANA dataset version.",
    },
    {
      ruleCode: "identifiers_valid",
      passed:
        /^[A-Z0-9-]{2,12}$/.test(airport.ident ?? "") &&
        /^[A-Z]{3}$/.test(airport.iata_code ?? "") &&
        /^[A-Z0-9]{4}$/.test(airport.icao_code ?? "") &&
        /^[A-Z]{2}$/.test(airport.country_code ?? "") &&
        /^[A-Z]{2}-[A-Z0-9-]+$/.test(airport.region_code ?? ""),
      severity: "error",
      message: "Airport, IATA, ICAO, country, or subdivision code has an invalid shape.",
    },
    {
      ruleCode: "runway_sufficient",
      passed: Number.isInteger(runway) && runway >= 3000,
      severity: "error",
      message: "At least one open runway of 3,000 feet or longer is required.",
    },
    {
      ruleCode: "commercial_relevance",
      passed:
        airport.scheduled_service === true && airport.commercial_relevance === "large_airport",
      severity: "error",
      message:
        "A playable airport must be a source-classified large airport with scheduled service.",
    },
    {
      ruleCode: "source_complete",
      passed: required.every((value) => typeof value === "string" && value.trim().length > 0),
      severity: "error",
      message: "Required identity, geography, municipality, and timezone fields must be complete.",
    },
  ];
}
