export const airportPlayableFields = [
  "ident",
  "iata_code",
  "icao_code",
  "name",
  "municipality",
  "country_code",
  "region_code",
  "world_region",
  "latitude_deg",
  "longitude_deg",
  "elevation_ft",
  "timezone_name",
  "longest_runway_ft",
  "scheduled_service",
  "commercial_relevance",
] as const;

export const aircraftVariantPlayableFields = [
  "manufacturer",
  "model",
  "certification_reference",
  "category",
  "passenger_only",
  "typical_seats",
  "maximum_seats",
  "range_nm",
  "maximum_takeoff_weight_kg",
  "minimum_runway_ft",
  "production_status",
  "acquisition_channels",
] as const;

export type ProvenanceClassification = "sourced" | "derived" | "balance";
export type AircraftCategory = "turboprop" | "regional_jet" | "narrow_body";
export type AcquisitionChannel = "factory_new" | "operating_lease" | "used_purchase";

export type FieldProvenance = Readonly<{
  fieldName: string;
  classification: ProvenanceClassification;
  sourceId?: string;
  sourceLocator?: string;
  effectiveFrom: string;
  formulaVersion?: string;
  rulesetVersion?: string;
  explanation: string;
}>;

export type CatalogAirport = Readonly<{
  id: string;
  ident: string;
  iataCode: string;
  icaoCode: string;
  name: string;
  municipality: string;
  countryCode: string;
  regionCode: string;
  worldRegion: string;
  latitudeDeg: string;
  longitudeDeg: string;
  elevationFt?: number;
  timezoneName: string;
  longestRunwayFt: number;
  provenance: readonly FieldProvenance[];
}>;

export type CatalogAircraftVariant = Readonly<{
  id: string;
  code: string;
  manufacturer: string;
  model: string;
  certificationReference: string;
  category: AircraftCategory;
  typicalSeats: number;
  maximumSeats: number;
  rangeNm: number;
  maximumTakeoffWeightKg: number;
  minimumRunwayFt: number;
  productionStatus: "in_production" | "discontinued";
  acquisitionChannels: readonly AcquisitionChannel[];
  provenance: readonly FieldProvenance[];
}>;

export type PublishedCatalog = Readonly<{
  releaseVersion: string;
  worldRulesetVersion: string;
  airports: readonly CatalogAirport[];
  aircraftVariants: readonly CatalogAircraftVariant[];
}>;

/** Read-only port for future API and administration query consumers. */
export interface CatalogRepository {
  findPublishedCatalogByWorldRuleset(version: string): Promise<PublishedCatalog | undefined>;
  findAirportByIataCode(
    worldRulesetVersion: string,
    iataCode: string,
  ): Promise<CatalogAirport | undefined>;
  listAircraftVariants(worldRulesetVersion: string): Promise<readonly CatalogAircraftVariant[]>;
}
