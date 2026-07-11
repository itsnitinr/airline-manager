import { readFile } from "node:fs/promises";
import type { AirportCandidate } from "./validation.js";

type SourceFixture = Readonly<{
  id: string;
  name: string;
  homepage_url: string;
  license_name: string;
  license_url: string;
  attribution: string;
  accuracy_disclaimer: string;
  redistribution_permitted: boolean;
}>;

type AirportFixture = Readonly<{
  ourairports: Readonly<{
    source_version: string;
    retrieved_at: string;
    airports_sha256: string;
    runways_sha256: string;
    combined_sha256: string;
  }>;
  iana: Readonly<{
    version: string;
    retrieved_at: string;
    archive_sha256: string;
  }>;
  distribution: Readonly<Record<string, number>>;
  timezones: readonly Readonly<{
    name: string;
    country_codes: readonly string[];
    coordinates: string;
    comment: string | null;
  }>[];
  airports: readonly AirportCandidate[];
}>;

export type AircraftFixtureVariant = Readonly<{
  code: string;
  manufacturer: string;
  model: string;
  certification_reference: string;
  category: "turboprop" | "regional_jet" | "narrow_body";
  passenger_only: true;
  typical_seats: number;
  maximum_seats: number;
  range_nm: number;
  maximum_takeoff_weight_kg: number;
  minimum_runway_ft: number;
  production_status: "in_production" | "discontinued";
  source_id: string;
  source_locator: string;
}>;

type AircraftFixture = Readonly<{
  effective_from: string;
  formula_version: string;
  ruleset_version: string;
  variants: readonly AircraftFixtureVariant[];
}>;

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, "utf8")) as T;
}

export function readSourceFixture(): Promise<readonly SourceFixture[]> {
  return readJson(new URL("../../data/reference-sources.json", import.meta.url));
}

export function readAirportFixture(): Promise<AirportFixture> {
  return readJson(new URL("../../data/slice-one-airports.json", import.meta.url));
}

export function readAircraftFixture(): Promise<AircraftFixture> {
  return readJson(new URL("../../data/slice-one-aircraft.json", import.meta.url));
}
