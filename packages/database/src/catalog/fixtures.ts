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

export type FoundingBalanceFixture = Readonly<{
  version: string;
  world_ruleset_version: string;
  founder_equity_minor: Readonly<Record<string, string>>;
  founding_loan_principal_minor: Readonly<Record<string, string>>;
  founding_loan_annual_rate_basis_points: number;
  founding_loan_term_days: number;
  founding_loan_installment_count: number;
  baseline_daily_obligation_minor: Readonly<Record<string, string>>;
  forecast_horizon_days: number;
  assumptions: Readonly<{
    included: readonly string[];
    excludedUntilTicket09: readonly string[];
    method: string;
  }>;
}>;

export type FounderPackageFixture = Readonly<{
  version: string;
  world_ruleset_version: string;
  lessor: Readonly<{ code: string; name: string }>;
  options: readonly Readonly<{
    code: string;
    variant_code: string;
    acquisition_channel: "operating_lease";
    economy_seats: number;
    delivery_delay_minutes: number;
    term_days: number;
    payment_interval_days: number;
    payment_count: number;
    recurring_payment_minor: Readonly<Record<string, string>>;
    deposit_minor: Readonly<Record<string, string>>;
    deposit_subsidy_minor: Readonly<Record<string, string>>;
    network_summary: string;
    cost_summary: string;
    delivery_summary: string;
    commonality_risk_summary: string;
    runway_tradeoff_summary: string;
    usage_conditions: Readonly<Record<string, number>>;
    return_conditions: Readonly<Record<string, number | boolean>>;
  }>[];
}>;

export type FuelRulesFixture = Readonly<{
  version: string;
  world_ruleset_version: string;
  price_formula_version: string;
  world_seed: string;
  time_bucket_minutes: number;
  quote_ttl_seconds: number;
  volatility_basis_points: number;
  minimum_reserve_kg: string;
  base_price_per_tonne_minor: Readonly<Record<string, string>>;
  capacity_tiers: readonly Readonly<{
    tier: number;
    capacity_kg: string;
    upgrade_price_minor: Readonly<Record<string, string>>;
  }>[];
}>;

export type MarketRulesFixture = Readonly<{
  version: string;
  world_ruleset_version: string;
  demand_formula_version: string;
  competition_formula_version: string;
  pricing_formula_version: string;
  world_seed: string;
  reference_fare_per_nm_minor: Readonly<Record<string, string>>;
  minimum_reference_fare_minor: Readonly<Record<string, string>>;
  assumptions: Readonly<Record<string, unknown>>;
}>;

export type SchedulingRulesFixture = Readonly<{
  version: string;
  world_ruleset_version: string;
  effective_from: string;
  block_time_formula_version: string;
  operating_cost_formula_version: string;
  turnaround_formula_version: string;
  default_horizon_days: number;
  maximum_horizon_days: number;
  default_airport_rule: Readonly<{
    outsourced_service_eligible: boolean;
    hourly_movement_ceiling: number;
    long_runway_threshold_ft: number;
    long_runway_hourly_movement_ceiling: number;
    congestion_fee_basis_points: number;
    minimum_turnaround_adjustment_minutes: number;
  }>;
  airport_overrides: Readonly<
    Record<string, Readonly<{ curfew_starts_local: string; curfew_ends_local: string }>>
  >;
  assumptions: Readonly<Record<string, unknown>>;
}>;

export type WorkforceRulesFixture = Readonly<{
  version: string;
  world_ruleset_version: string;
  effective_from: string;
  fatigue_formula_version: string;
  demand_formula_version: string;
  wage_interval_hours: number;
  roles: Readonly<
    Record<
      "pilot" | "cabin_crew" | "line_maintenance" | "ground_handling",
      Readonly<{
        qualification_scope: "aircraft_variant" | "general";
        training_lead_hours: number;
        hiring_cost_minor: Readonly<Record<string, string>>;
        training_cost_minor: Readonly<Record<string, string>>;
        wage_per_interval_minor: Readonly<Record<string, string>>;
        flight_capacity_per_unit: number;
        recovery_minutes_per_block_hour: number;
        minimum_recovery_minutes: number;
      }>
    >
  >;
  starter_packages: Readonly<
    Record<
      string,
      Readonly<{
        pilot: number;
        cabin_crew: number;
        line_maintenance: number;
        ground_handling: number;
      }>
    >
  >;
  assumptions: Readonly<Record<string, unknown>>;
}>;

export type MaintenanceRulesFixture = Readonly<{
  version: string;
  world_ruleset_version: string;
  effective_from: string;
  utilization_formula_version: string;
  condition_formula_version: string;
  fault_formula_version: string;
  calendar_semantics: "elapsed_utc_days";
  variants: Readonly<
    Record<
      string,
      readonly Readonly<{
        code: string;
        name: string;
        work_kind: "line" | "package";
        interval_hours_minutes?: string;
        interval_cycles?: string;
        interval_calendar_days?: number;
        hard_limit: boolean;
        maximum_deferral_hours_minutes: string;
        maximum_deferral_cycles: string;
        maximum_deferral_calendar_days: number;
        duration_minutes: number;
        workforce_capacity: number;
        condition_restore_basis_points: number;
        cost_minor: Readonly<Record<string, string>>;
      }>[]
    >
  >;
  assumptions: Readonly<Record<string, unknown>>;
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

export function readFoundingBalanceFixture(): Promise<FoundingBalanceFixture> {
  return readJson(new URL("../../data/founding-balance-v1.json", import.meta.url));
}

export function readFounderPackageFixture(): Promise<FounderPackageFixture> {
  return readJson(new URL("../../data/founder-packages-v1.json", import.meta.url));
}

export function readFuelRulesFixture(): Promise<FuelRulesFixture> {
  return readJson(new URL("../../data/fuel-rules-v1.json", import.meta.url));
}

export function readMarketRulesFixture(): Promise<MarketRulesFixture> {
  return readJson(new URL("../../data/market-rules-v1.json", import.meta.url));
}

export function readSchedulingRulesFixture(): Promise<SchedulingRulesFixture> {
  return readJson(new URL("../../data/scheduling-rules-v1.json", import.meta.url));
}

export function readWorkforceRulesFixture(): Promise<WorkforceRulesFixture> {
  return readJson(new URL("../../data/workforce-rules-v1.json", import.meta.url));
}

export function readMaintenanceRulesFixture(): Promise<MaintenanceRulesFixture> {
  return readJson(new URL("../../data/maintenance-rules-v1.json", import.meta.url));
}
