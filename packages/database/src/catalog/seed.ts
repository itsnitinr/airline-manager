import { sql } from "kysely";
import {
  aircraftVariantPlayableFields,
  airportPlayableFields,
  type FieldProvenance,
} from "@airline-manager/domain";
import type { Database } from "../database.js";
import {
  readAircraftFixture,
  readAirportFixture,
  readFounderPackageFixture,
  readFuelRulesFixture,
  readFoundingBalanceFixture,
  readMarketRulesFixture,
  readMaintenanceRulesFixture,
  readSchedulingRulesFixture,
  readWorkforceRulesFixture,
  readWeatherRulesFixture,
  readSourceFixture,
} from "./fixtures.js";
import { importOurAirports } from "./import.js";

const releaseVersion = "slice-one-2026.07.11";
const worldRulesetVersion = "contemporary-2026.07.11";

async function seedSources(database: Database): Promise<void> {
  for (const source of await readSourceFixture()) {
    await sql`INSERT INTO reference_sources
      (id, name, homepage_url, license_name, license_url, attribution,
       accuracy_disclaimer, redistribution_permitted)
      VALUES (${source.id}, ${source.name}, ${source.homepage_url}, ${source.license_name},
        ${source.license_url}, ${source.attribution}, ${source.accuracy_disclaimer},
        ${source.redistribution_permitted})
      ON CONFLICT (id) DO NOTHING`.execute(database);
  }
}

function airportProvenance(
  airportId: string,
  fieldName: (typeof airportPlayableFields)[number],
): FieldProvenance {
  if (fieldName === "timezone_name") {
    return {
      fieldName,
      classification: "derived",
      effectiveFrom: "2026-07-11",
      formulaVersion: "coordinate-timezone-v1",
      explanation:
        "Coordinate lookup from Timezone Boundary Builder data, validated against IANA tzdb 2026b.",
    };
  }
  if (fieldName === "commercial_relevance") {
    return {
      fieldName,
      classification: "derived",
      effectiveFrom: "2026-07-11",
      formulaVersion: "commercial-airport-eligibility-v1",
      explanation:
        "Derived from OurAirports large-airport classification, scheduled service, runway, and completeness checks.",
    };
  }
  return {
    fieldName,
    classification: "sourced",
    sourceId: "ourairports",
    sourceLocator: `https://ourairports.com/airports/${airportId}/`,
    effectiveFrom: "2026-07-11",
    explanation: "Sourced from the pinned OurAirports airport or runway row.",
  };
}

function aircraftProvenance(
  variant: Awaited<ReturnType<typeof readAircraftFixture>>["variants"][number],
  fieldName: (typeof aircraftVariantPlayableFields)[number],
): FieldProvenance {
  if (fieldName === "acquisition_channels") {
    return variant.code === "embraer-e175"
      ? {
          fieldName,
          classification: "balance",
          effectiveFrom: "2026-07-11",
          rulesetVersion: "contemporary-2026.07.11",
          explanation:
            "World-ruleset override limits slice-one acquisition channels without changing production status.",
        }
      : {
          fieldName,
          classification: "derived",
          effectiveFrom: "2026-07-11",
          formulaVersion: "production-channel-defaults-v1",
          explanation:
            "Derived from versioned production status by the default acquisition-channel rule.",
        };
  }
  if (fieldName === "certification_reference") {
    return {
      fieldName,
      classification: "sourced",
      sourceId: "faa",
      sourceLocator: "https://www.faa.gov/aircraft/air_cert/design_approvals",
      effectiveFrom: "2026-07-11",
      explanation: `Regulator type-certificate identity: ${variant.certification_reference}.`,
    };
  }
  if (fieldName === "category" || fieldName === "passenger_only") {
    return {
      fieldName,
      classification: "derived",
      effectiveFrom: "2026-07-11",
      formulaVersion: "aircraft-taxonomy-v1",
      explanation: "Derived catalog taxonomy for the selected passenger variant.",
    };
  }
  if (fieldName === "minimum_runway_ft" && variant.code !== "atr-72-600") {
    return {
      fieldName,
      classification: "derived",
      effectiveFrom: "2026-07-11",
      formulaVersion: "aircraft-envelope-v1",
      explanation:
        "Conservative gameplay compatibility envelope; not a certified takeoff or landing distance.",
    };
  }
  return {
    fieldName,
    classification: "sourced",
    sourceId: variant.source_id,
    sourceLocator: variant.source_locator,
    effectiveFrom: "2026-07-11",
    explanation: "Sourced from the manufacturer's current public product specification.",
  };
}

async function insertProvenance(
  database: Database,
  recordType: "airport" | "aircraft_variant",
  recordId: string,
  provenance: readonly FieldProvenance[],
): Promise<void> {
  for (const field of provenance) {
    await sql`INSERT INTO reference_provenance
      (record_type, record_id, field_name, classification, source_id, source_locator,
       effective_from, formula_version, ruleset_version, explanation)
      VALUES (${recordType}, ${recordId}::uuid, ${field.fieldName}, ${field.classification},
        ${field.sourceId ?? null}, ${field.sourceLocator ?? null}, ${field.effectiveFrom}::date,
        ${field.formulaVersion ?? null}, ${field.rulesetVersion ?? null}, ${field.explanation})
      ON CONFLICT (record_type, record_id, field_name) DO NOTHING`.execute(database);
  }
}

export type SeedCatalogResult = Readonly<{
  releaseVersion: string;
  worldRulesetVersion: string;
  airportCount: number;
  aircraftVariantCount: number;
}>;

export async function seedSliceOneCatalog(database: Database): Promise<SeedCatalogResult> {
  await seedSources(database);
  const airportFixture = await readAirportFixture();
  const aircraftFixture = await readAircraftFixture();

  await sql`INSERT INTO timezone_dataset_versions
    (version, source_id, sha256, retrieved_at, release_url)
    VALUES (${airportFixture.iana.version}, 'iana-tzdb', ${airportFixture.iana.archive_sha256},
      ${airportFixture.iana.retrieved_at}::timestamptz,
      'https://data.iana.org/time-zones/releases/tzdata2026b.tar.gz')
    ON CONFLICT (version) DO NOTHING`.execute(database);
  for (const timezone of airportFixture.timezones) {
    await sql`INSERT INTO timezone_definitions
      (dataset_version, name, country_codes, coordinates, comment)
      VALUES (${airportFixture.iana.version}, ${timezone.name},
        ${timezone.country_codes}::text[], ${timezone.coordinates}, ${timezone.comment})
      ON CONFLICT (dataset_version, name) DO NOTHING`.execute(database);
  }

  const imported = await importOurAirports(database, {
    sourceVersion: airportFixture.ourairports.source_version,
    checksum: airportFixture.ourairports.combined_sha256,
    retrievedAt: airportFixture.ourairports.retrieved_at,
    metadata: {
      airports_sha256: airportFixture.ourairports.airports_sha256,
      runways_sha256: airportFixture.ourairports.runways_sha256,
      accuracy_boundary: "not_for_navigation_independently_validated",
    },
    records: airportFixture.airports,
    validTimezones: new Set(airportFixture.timezones.map(({ name }) => name)),
  });
  if (imported.quarantinedRecords > 0 || imported.validRecords !== 250) {
    throw new Error(
      `Slice-one fixture validation failed: ${imported.validRecords} valid, ${imported.quarantinedRecords} quarantined.`,
    );
  }

  const airportSnapshots: Array<{ id: string; snapshot: Readonly<Record<string, unknown>> }> = [];
  for (const airport of airportFixture.airports) {
    const raw = await sql<{ id: string }>`SELECT id FROM raw_reference_records
      WHERE import_id = ${imported.importId}::uuid AND source_record_id = ${airport.source_record_id}`.execute(
      database,
    );
    const rawId = raw.rows[0]?.id;
    if (!rawId) throw new Error(`Missing raw airport ${airport.source_record_id}.`);
    await sql`INSERT INTO curated_airports
      (promoted_from_raw_record_id, ident, iata_code, icao_code, name, municipality,
       country_code, region_code, world_region, latitude_deg, longitude_deg, elevation_ft,
       timezone_dataset_version, timezone_name, longest_runway_ft, scheduled_service,
       commercial_relevance)
      VALUES (${rawId}::uuid, ${airport.ident}, ${airport.iata_code}, ${airport.icao_code},
        ${airport.name}, ${airport.municipality}, ${airport.country_code}, ${airport.region_code},
        ${airport.world_region}, ${airport.latitude_deg}::numeric, ${airport.longitude_deg}::numeric,
        ${airport.elevation_ft ?? null}, ${airportFixture.iana.version}, ${airport.timezone_name},
        ${airport.longest_runway_ft}, true, 'large_airport')
      ON CONFLICT (promoted_from_raw_record_id) DO NOTHING`.execute(database);
    const curated = await sql<{ id: string }>`SELECT id FROM curated_airports
      WHERE promoted_from_raw_record_id = ${rawId}::uuid`.execute(database);
    const airportId = curated.rows[0]?.id;
    if (!airportId) throw new Error(`Airport ${airport.iata_code} was not promoted.`);
    const provenance = airportPlayableFields.map((field) =>
      airportProvenance(airport.ident ?? airport.source_record_id, field),
    );
    await insertProvenance(database, "airport", airportId, provenance);
    await sql`UPDATE raw_reference_records SET disposition = 'promoted'
      WHERE id = ${rawId}::uuid`.execute(database);
    airportSnapshots.push({
      id: airportId,
      snapshot: {
        id: airportId,
        ident: airport.ident,
        iataCode: airport.iata_code,
        icaoCode: airport.icao_code,
        name: airport.name,
        municipality: airport.municipality,
        countryCode: airport.country_code,
        regionCode: airport.region_code,
        worldRegion: airport.world_region,
        latitudeDeg: airport.latitude_deg,
        longitudeDeg: airport.longitude_deg,
        elevationFt: airport.elevation_ft ?? undefined,
        timezoneName: airport.timezone_name,
        longestRunwayFt: airport.longest_runway_ft,
        provenance,
      },
    });
  }

  const aircraftSnapshots: Array<{ id: string; snapshot: Readonly<Record<string, unknown>> }> = [];
  for (const variant of aircraftFixture.variants) {
    await sql`INSERT INTO curated_aircraft_variants
      (code, manufacturer, model, certification_reference, category, passenger_only, typical_seats, maximum_seats,
       range_nm, maximum_takeoff_weight_kg, minimum_runway_ft, production_status,
       production_status_effective_from)
      VALUES (${variant.code}, ${variant.manufacturer}, ${variant.model}, ${variant.certification_reference}, ${variant.category}, true,
        ${variant.typical_seats}, ${variant.maximum_seats}, ${variant.range_nm},
        ${variant.maximum_takeoff_weight_kg}, ${variant.minimum_runway_ft},
        ${variant.production_status}, ${aircraftFixture.effective_from}::date)
      ON CONFLICT (code) DO NOTHING`.execute(database);
    const curated = await sql<{ id: string }>`SELECT id FROM curated_aircraft_variants
      WHERE code = ${variant.code}`.execute(database);
    const variantId = curated.rows[0]?.id;
    if (!variantId) throw new Error(`Aircraft variant ${variant.code} was not curated.`);
    const provenance = aircraftVariantPlayableFields.map((field) =>
      aircraftProvenance(variant, field),
    );
    await insertProvenance(database, "aircraft_variant", variantId, provenance);
    aircraftSnapshots.push({
      id: variantId,
      snapshot: {
        id: variantId,
        code: variant.code,
        manufacturer: variant.manufacturer,
        model: variant.model,
        certificationReference: variant.certification_reference,
        category: variant.category,
        typicalSeats: variant.typical_seats,
        maximumSeats: variant.maximum_seats,
        rangeNm: variant.range_nm,
        maximumTakeoffWeightKg: variant.maximum_takeoff_weight_kg,
        minimumRunwayFt: variant.minimum_runway_ft,
        productionStatus: variant.production_status,
        provenance,
      },
    });
  }

  await sql`INSERT INTO catalog_releases (version, description)
    VALUES (${releaseVersion}, 'First playable global passenger reference catalog')
    ON CONFLICT (version) DO NOTHING`.execute(database);
  const release = await sql<{ id: string; status: string }>`SELECT id, status FROM catalog_releases
    WHERE version = ${releaseVersion}`.execute(database);
  const releaseId = release.rows[0]?.id;
  if (!releaseId) throw new Error("Slice-one release was not created.");

  if (release.rows[0]?.status === "draft") {
    for (const airport of airportSnapshots) {
      await sql`INSERT INTO catalog_release_airports (release_id, airport_id, snapshot)
        VALUES (${releaseId}::uuid, ${airport.id}::uuid, ${JSON.stringify(airport.snapshot)}::jsonb)
        ON CONFLICT (release_id, airport_id) DO NOTHING`.execute(database);
    }
    for (const variant of aircraftSnapshots) {
      await sql`INSERT INTO catalog_release_aircraft_variants
        (release_id, aircraft_variant_id, snapshot)
        VALUES (${releaseId}::uuid, ${variant.id}::uuid, ${JSON.stringify(variant.snapshot)}::jsonb)
        ON CONFLICT (release_id, aircraft_variant_id) DO NOTHING`.execute(database);
    }
    const checks = await sql<{
      airports: string;
      aircraft: string;
      missing_airport_provenance: string;
      missing_aircraft_provenance: string;
    }>`SELECT
      (SELECT count(*)::text FROM catalog_release_airports WHERE release_id = ${releaseId}::uuid) AS airports,
      (SELECT count(*)::text FROM catalog_release_aircraft_variants WHERE release_id = ${releaseId}::uuid) AS aircraft,
      (SELECT count(*)::text FROM curated_airports a
        WHERE NOT EXISTS (SELECT 1 FROM reference_provenance p
          WHERE p.record_type = 'airport' AND p.record_id = a.id
          GROUP BY p.record_id HAVING count(*) = ${airportPlayableFields.length})) AS missing_airport_provenance,
      (SELECT count(*)::text FROM curated_aircraft_variants a
        WHERE NOT EXISTS (SELECT 1 FROM reference_provenance p
          WHERE p.record_type = 'aircraft_variant' AND p.record_id = a.id
          GROUP BY p.record_id HAVING count(*) = ${aircraftVariantPlayableFields.length})) AS missing_aircraft_provenance
    `.execute(database);
    const check = checks.rows[0];
    if (
      !check ||
      check.airports !== "250" ||
      check.aircraft !== "4" ||
      check.missing_airport_provenance !== "0" ||
      check.missing_aircraft_provenance !== "0"
    ) {
      throw new Error(`Catalog publication checks failed: ${JSON.stringify(check)}.`);
    }
    await sql`UPDATE catalog_releases SET status = 'published', published_at = CURRENT_TIMESTAMP
      WHERE id = ${releaseId}::uuid AND status = 'draft'`.execute(database);
  }

  await sql`INSERT INTO world_rulesets
    (version, catalog_release_id, effective_from)
    VALUES (${worldRulesetVersion}, ${releaseId}::uuid, '2026-07-11T00:00:00Z'::timestamptz)
    ON CONFLICT (version) DO NOTHING`.execute(database);
  const ruleset = await sql<{ id: string; status: string }>`SELECT id, status FROM world_rulesets
    WHERE version = ${worldRulesetVersion}`.execute(database);
  const rulesetId = ruleset.rows[0]?.id;
  const e175 = aircraftSnapshots.find(({ snapshot }) => snapshot.code === "embraer-e175");
  if (!rulesetId || !e175) throw new Error("World ruleset or E175 override target is missing.");
  if (ruleset.rows[0]?.status === "draft") {
    await sql`INSERT INTO world_ruleset_acquisition_overrides
      (world_ruleset_id, aircraft_variant_id, channels, reason)
      VALUES (${rulesetId}::uuid, ${e175.id}::uuid,
        ARRAY['operating_lease', 'used_purchase']::text[],
        'Slice-one balance override; does not alter real-world production status.')
      ON CONFLICT (world_ruleset_id, aircraft_variant_id) DO NOTHING`.execute(database);
    await sql`UPDATE world_rulesets SET status = 'active', activated_at = CURRENT_TIMESTAMP
      WHERE id = ${rulesetId}::uuid AND status = 'draft'`.execute(database);
  }

  const foundingBalance = await readFoundingBalanceFixture();
  if (foundingBalance.world_ruleset_version !== worldRulesetVersion) {
    throw new Error("Founding balance fixture selects a different world ruleset.");
  }
  await sql`INSERT INTO founding_balance_versions
    (version, world_ruleset_id, status, founder_equity_minor,
     founding_loan_principal_minor, founding_loan_annual_rate_basis_points,
     founding_loan_term_days, founding_loan_installment_count,
     baseline_daily_obligation_minor, forecast_horizon_days, assumptions)
    VALUES (${foundingBalance.version}, ${rulesetId}::uuid, 'active',
      ${JSON.stringify(foundingBalance.founder_equity_minor)}::jsonb,
      ${JSON.stringify(foundingBalance.founding_loan_principal_minor)}::jsonb,
      ${foundingBalance.founding_loan_annual_rate_basis_points},
      ${foundingBalance.founding_loan_term_days},
      ${foundingBalance.founding_loan_installment_count},
      ${JSON.stringify(foundingBalance.baseline_daily_obligation_minor)}::jsonb,
      ${foundingBalance.forecast_horizon_days},
      ${JSON.stringify(foundingBalance.assumptions)}::jsonb)
    ON CONFLICT (version) DO NOTHING`.execute(database);

  const founderPackage = await readFounderPackageFixture();
  if (founderPackage.world_ruleset_version !== worldRulesetVersion) {
    throw new Error("Founder package fixture selects a different world ruleset.");
  }
  if (founderPackage.options.length !== 4) {
    throw new Error("Founder package must contain exactly the four published starter variants.");
  }
  await sql`INSERT INTO aircraft_lessors (code, name)
    VALUES (${founderPackage.lessor.code}, ${founderPackage.lessor.name})
    ON CONFLICT (code) DO NOTHING`.execute(database);
  const lessor = await sql<{ id: string }>`SELECT id FROM aircraft_lessors
    WHERE code = ${founderPackage.lessor.code}`.execute(database);
  const lessorId = lessor.rows[0]?.id;
  if (!lessorId) throw new Error("Founder package lessor was not created.");
  await sql`INSERT INTO founder_package_versions (version, world_ruleset_id, status)
    VALUES (${founderPackage.version}, ${rulesetId}::uuid, 'draft')
    ON CONFLICT (version) DO NOTHING`.execute(database);
  const packageVersion = await sql<{ id: string }>`SELECT id FROM founder_package_versions
    WHERE version = ${founderPackage.version}`.execute(database);
  const packageVersionId = packageVersion.rows[0]?.id;
  if (!packageVersionId) throw new Error("Founder package version was not created.");
  for (const option of founderPackage.options) {
    const variant = aircraftFixture.variants.find(({ code }) => code === option.variant_code);
    const snapshot = aircraftSnapshots.find(
      ({ snapshot: item }) => item.code === option.variant_code,
    );
    if (!variant || !snapshot || option.economy_seats > variant.maximum_seats) {
      throw new Error(`Founder option ${option.code} has an invalid published variant or cabin.`);
    }
    const allowedChannels =
      option.variant_code === "embraer-e175"
        ? ["operating_lease", "used_purchase"]
        : variant.production_status === "discontinued"
          ? ["operating_lease", "used_purchase"]
          : ["factory_new", "operating_lease", "used_purchase"];
    if (!allowedChannels.includes(option.acquisition_channel)) {
      throw new Error(`Founder option ${option.code} violates contemporary acquisition rules.`);
    }
    const existingOption = await sql<{ exists: boolean }>`SELECT EXISTS (
      SELECT 1 FROM founder_package_options
      WHERE package_version_id = ${packageVersionId}::uuid AND code = ${option.code}) AS exists`.execute(
      database,
    );
    if (existingOption.rows[0]?.exists) continue;
    await sql`INSERT INTO founder_package_options
      (package_version_id, code, aircraft_variant_id, lessor_id, acquisition_channel,
       economy_seats, delivery_delay_minutes, term_days, payment_interval_days, payment_count,
       recurring_payment_minor, deposit_minor, deposit_subsidy_minor, network_summary,
       cost_summary, delivery_summary, commonality_risk_summary, runway_tradeoff_summary,
       usage_conditions, return_conditions)
      VALUES (${packageVersionId}::uuid, ${option.code}, ${snapshot.id}::uuid, ${lessorId}::uuid,
        ${option.acquisition_channel}, ${option.economy_seats}, ${option.delivery_delay_minutes},
        ${option.term_days}, ${option.payment_interval_days}, ${option.payment_count},
        ${JSON.stringify(option.recurring_payment_minor)}::jsonb,
        ${JSON.stringify(option.deposit_minor)}::jsonb,
        ${JSON.stringify(option.deposit_subsidy_minor)}::jsonb, ${option.network_summary},
        ${option.cost_summary}, ${option.delivery_summary}, ${option.commonality_risk_summary},
        ${option.runway_tradeoff_summary}, ${JSON.stringify(option.usage_conditions)}::jsonb,
        ${JSON.stringify(option.return_conditions)}::jsonb)
      ON CONFLICT (package_version_id, code) DO NOTHING`.execute(database);
  }
  await sql`UPDATE founder_package_versions SET status = 'active'
    WHERE id = ${packageVersionId}::uuid AND status = 'draft'`.execute(database);

  const fuel = await readFuelRulesFixture();
  if (fuel.world_ruleset_version !== worldRulesetVersion) {
    throw new Error("Fuel rules fixture selects a different world ruleset.");
  }
  await sql`INSERT INTO fuel_ruleset_versions
    (world_ruleset_id, version, status, price_formula_version, time_bucket_minutes,
     quote_ttl_seconds, world_seed, base_price_per_tonne_minor, volatility_basis_points,
     minimum_reserve_kg, activated_at)
    VALUES (${rulesetId}::uuid, ${fuel.version}, 'draft', ${fuel.price_formula_version},
      ${fuel.time_bucket_minutes}, ${fuel.quote_ttl_seconds}, ${fuel.world_seed},
      ${JSON.stringify(fuel.base_price_per_tonne_minor)}::jsonb,
      ${fuel.volatility_basis_points}, ${fuel.minimum_reserve_kg}::bigint, NULL)
    ON CONFLICT (version) DO NOTHING`.execute(database);
  const fuelVersion = await sql<{ id: string }>`SELECT id FROM fuel_ruleset_versions
    WHERE version = ${fuel.version}`.execute(database);
  const fuelVersionId = fuelVersion.rows[0]?.id;
  if (!fuelVersionId) throw new Error("Fuel ruleset version was not created.");
  for (const tier of fuel.capacity_tiers) {
    await sql`INSERT INTO fuel_capacity_tiers
      (fuel_ruleset_version_id, tier, capacity_kg, upgrade_price_minor)
      VALUES (${fuelVersionId}::uuid, ${tier.tier}, ${tier.capacity_kg}::bigint,
        ${JSON.stringify(tier.upgrade_price_minor)}::jsonb)
      ON CONFLICT (fuel_ruleset_version_id, tier) DO NOTHING`.execute(database);
  }
  await sql`UPDATE fuel_ruleset_versions SET status = 'active', activated_at = CURRENT_TIMESTAMP
    WHERE id = ${fuelVersionId}::uuid AND status = 'draft'`.execute(database);

  const market = await readMarketRulesFixture();
  if (market.world_ruleset_version !== worldRulesetVersion) {
    throw new Error("Market rules fixture selects a different world ruleset.");
  }
  await sql`INSERT INTO market_ruleset_versions
    (world_ruleset_id, version, status, demand_formula_version, competition_formula_version,
     pricing_formula_version, world_seed, reference_fare_per_nm_minor,
     minimum_reference_fare_minor, assumptions, activated_at)
    VALUES (${rulesetId}::uuid, ${market.version}, 'draft', ${market.demand_formula_version},
      ${market.competition_formula_version}, ${market.pricing_formula_version},
      ${market.world_seed}, ${JSON.stringify(market.reference_fare_per_nm_minor)}::jsonb,
      ${JSON.stringify(market.minimum_reference_fare_minor)}::jsonb,
      ${JSON.stringify(market.assumptions)}::jsonb, NULL)
    ON CONFLICT (version) DO NOTHING`.execute(database);
  await sql`UPDATE market_ruleset_versions SET status = 'active', activated_at = CURRENT_TIMESTAMP
    WHERE version = ${market.version} AND status = 'draft'`.execute(database);

  const scheduling = await readSchedulingRulesFixture();
  if (scheduling.world_ruleset_version !== worldRulesetVersion)
    throw new Error("Scheduling rules fixture selects a different world ruleset.");
  await sql`INSERT INTO scheduling_ruleset_versions (world_ruleset_id, version, status, effective_from,
    block_time_formula_version, operating_cost_formula_version, turnaround_formula_version,
    default_horizon_days, maximum_horizon_days, assumptions, activated_at)
    VALUES (${rulesetId}::uuid, ${scheduling.version}, 'draft', ${scheduling.effective_from}::timestamptz,
      ${scheduling.block_time_formula_version}, ${scheduling.operating_cost_formula_version}, ${scheduling.turnaround_formula_version},
      ${scheduling.default_horizon_days}, ${scheduling.maximum_horizon_days}, ${JSON.stringify(scheduling.assumptions)}::jsonb, NULL)
    ON CONFLICT (version) DO NOTHING`.execute(database);
  const scheduleVersion = await sql<{
    id: string;
  }>`SELECT id FROM scheduling_ruleset_versions WHERE version = ${scheduling.version}`.execute(
    database,
  );
  const scheduleVersionId = scheduleVersion.rows[0]?.id;
  if (!scheduleVersionId) throw new Error("Scheduling ruleset was not created.");
  for (const snapshot of airportSnapshots) {
    const override = scheduling.airport_overrides[String(snapshot.snapshot.iataCode)];
    const defaults = scheduling.default_airport_rule;
    await sql`INSERT INTO airport_scheduling_rules (scheduling_ruleset_version_id, airport_id, outsourced_service_eligible,
      hourly_movement_ceiling, curfew_starts_local, curfew_ends_local, congestion_fee_basis_points, minimum_turnaround_adjustment_minutes)
      VALUES (${scheduleVersionId}::uuid, ${snapshot.id}::uuid, ${defaults.outsourced_service_eligible},
        ${Number(snapshot.snapshot.longestRunwayFt) >= defaults.long_runway_threshold_ft ? defaults.long_runway_hourly_movement_ceiling : defaults.hourly_movement_ceiling},
        ${override?.curfew_starts_local ?? null}::time, ${override?.curfew_ends_local ?? null}::time,
        ${defaults.congestion_fee_basis_points}, ${defaults.minimum_turnaround_adjustment_minutes})
      ON CONFLICT (scheduling_ruleset_version_id, airport_id) DO NOTHING`.execute(database);
  }
  await sql`UPDATE scheduling_ruleset_versions SET status = 'active', activated_at = CURRENT_TIMESTAMP
    WHERE id = ${scheduleVersionId}::uuid AND status = 'draft'`.execute(database);

  const workforce = await readWorkforceRulesFixture();
  if (workforce.world_ruleset_version !== worldRulesetVersion)
    throw new Error("Workforce rules fixture selects a different world ruleset.");
  await sql`INSERT INTO workforce_ruleset_versions
    (world_ruleset_id, version, status, effective_from, fatigue_formula_version,
     demand_formula_version, wage_interval_hours, assumptions, activated_at)
    VALUES (${rulesetId}::uuid, ${workforce.version}, 'draft', ${workforce.effective_from}::timestamptz,
      ${workforce.fatigue_formula_version}, ${workforce.demand_formula_version},
      ${workforce.wage_interval_hours}, ${JSON.stringify(workforce.assumptions)}::jsonb, NULL)
    ON CONFLICT (version) DO NOTHING`.execute(database);
  const workforceVersion = await sql<{ id: string }>`SELECT id FROM workforce_ruleset_versions
    WHERE version = ${workforce.version}`.execute(database);
  const workforceVersionId = workforceVersion.rows[0]?.id;
  if (!workforceVersionId) throw new Error("Workforce ruleset was not created.");
  for (const [role, rule] of Object.entries(workforce.roles)) {
    await sql`INSERT INTO workforce_role_rules
      (workforce_ruleset_version_id, role, qualification_scope, training_lead_hours,
       hiring_cost_minor, training_cost_minor, wage_per_interval_minor, flight_capacity_per_unit,
       recovery_minutes_per_block_hour, minimum_recovery_minutes)
      VALUES (${workforceVersionId}::uuid, ${role}, ${rule.qualification_scope},
        ${rule.training_lead_hours}, ${JSON.stringify(rule.hiring_cost_minor)}::jsonb,
        ${JSON.stringify(rule.training_cost_minor)}::jsonb,
        ${JSON.stringify(rule.wage_per_interval_minor)}::jsonb, ${rule.flight_capacity_per_unit},
        ${rule.recovery_minutes_per_block_hour}, ${rule.minimum_recovery_minutes})
      ON CONFLICT (workforce_ruleset_version_id, role) DO NOTHING`.execute(database);
  }
  for (const [variantCode, staffing] of Object.entries(workforce.starter_packages)) {
    const variant = aircraftSnapshots.find(({ snapshot }) => snapshot.code === variantCode);
    if (!variant) throw new Error(`Workforce starter variant ${variantCode} is not published.`);
    await sql`INSERT INTO workforce_starter_packages
      (workforce_ruleset_version_id, aircraft_variant_id, aircraft_variant_code, package, explanation)
      VALUES (${workforceVersionId}::uuid, ${variant.id}::uuid, ${variantCode},
        ${JSON.stringify(staffing)}::jsonb,
        'Minimum viable aggregate launch staffing for one founder aircraft; outsourced ground handling requires no in-house ground pool.')
      ON CONFLICT (workforce_ruleset_version_id, aircraft_variant_id) DO NOTHING`.execute(database);
  }
  await sql`UPDATE workforce_ruleset_versions SET status = 'active', activated_at = CURRENT_TIMESTAMP
    WHERE id = ${workforceVersionId}::uuid AND status = 'draft'`.execute(database);

  const maintenance = await readMaintenanceRulesFixture();
  if (maintenance.world_ruleset_version !== worldRulesetVersion)
    throw new Error("Maintenance rules fixture selects a different world ruleset.");
  await sql`INSERT INTO maintenance_program_versions
    (world_ruleset_id, version, status, effective_from, utilization_formula_version,
     condition_formula_version, fault_formula_version, calendar_semantics, assumptions, activated_at)
    VALUES (${rulesetId}::uuid, ${maintenance.version}, 'draft', ${maintenance.effective_from}::timestamptz,
      ${maintenance.utilization_formula_version}, ${maintenance.condition_formula_version},
      ${maintenance.fault_formula_version}, ${maintenance.calendar_semantics},
      ${JSON.stringify(maintenance.assumptions)}::jsonb, NULL)
    ON CONFLICT (version) DO NOTHING`.execute(database);
  const maintenanceVersion = await sql<{ id: string }>`SELECT id FROM maintenance_program_versions
    WHERE version = ${maintenance.version}`.execute(database);
  const maintenanceVersionId = maintenanceVersion.rows[0]?.id;
  if (!maintenanceVersionId) throw new Error("Maintenance program version was not created.");
  for (const [variantCode, rules] of Object.entries(maintenance.variants)) {
    const variant = aircraftSnapshots.find(({ snapshot }) => snapshot.code === variantCode);
    if (!variant) throw new Error(`Maintenance program variant ${variantCode} is not published.`);
    for (const rule of rules) {
      await sql`INSERT INTO maintenance_program_rules
        (maintenance_program_version_id, aircraft_variant_id, aircraft_variant_code, code, name,
         work_kind, interval_hours_minutes, interval_cycles, interval_calendar_days, hard_limit,
         maximum_deferral_hours_minutes, maximum_deferral_cycles, maximum_deferral_calendar_days,
         duration_minutes, workforce_capacity, cost_minor, condition_restore_basis_points, material_snapshot)
        VALUES (${maintenanceVersionId}::uuid, ${variant.id}::uuid, ${variantCode}, ${rule.code},
          ${rule.name}, ${rule.work_kind}, ${rule.interval_hours_minutes ?? null}::bigint,
          ${rule.interval_cycles ?? null}::bigint, ${rule.interval_calendar_days ?? null}::integer,
          ${rule.hard_limit}, ${rule.maximum_deferral_hours_minutes}::bigint,
          ${rule.maximum_deferral_cycles}::bigint, ${rule.maximum_deferral_calendar_days},
          ${rule.duration_minutes}, ${rule.workforce_capacity}, ${JSON.stringify(rule.cost_minor)}::jsonb,
          ${rule.condition_restore_basis_points}, ${JSON.stringify(rule)}::jsonb)
        ON CONFLICT (maintenance_program_version_id, aircraft_variant_id, code) DO NOTHING`.execute(
        database,
      );
    }
  }
  await sql`UPDATE maintenance_program_versions SET status = 'active', activated_at = CURRENT_TIMESTAMP
    WHERE id = ${maintenanceVersionId}::uuid AND status = 'draft'`.execute(database);

  const weather = await readWeatherRulesFixture();
  if (weather.world_ruleset_version !== worldRulesetVersion)
    throw new Error("Weather rules fixture selects a different world ruleset.");
  await sql`INSERT INTO climate_profile_versions
    (catalog_release_id, version, status, formula_version, source_basis, effective_from, published_at)
    VALUES (${releaseId}::uuid, ${weather.climate_data_version}, 'draft',
      ${weather.profile_formula_version}, ${JSON.stringify(weather.source_basis)}::jsonb,
      ${weather.effective_from}::timestamptz, NULL)
    ON CONFLICT (version) DO NOTHING`.execute(database);
  const climateVersion = await sql<{ id: string }>`SELECT id FROM climate_profile_versions
    WHERE version = ${weather.climate_data_version}`.execute(database);
  const climateVersionId = climateVersion.rows[0]?.id;
  if (!climateVersionId) throw new Error("Climate profile version was not created.");
  for (const airport of airportSnapshots) {
    const latitude = Number(airport.snapshot.latitudeDeg);
    const longitude = Number(airport.snapshot.longitudeDeg);
    const absoluteLatitude = Math.abs(latitude);
    const zone =
      absoluteLatitude < 23.5
        ? "tropical"
        : absoluteLatitude >= 60
          ? "polar"
          : absoluteLatitude >= 45
            ? "continental"
            : Math.abs(longitude) >= 15 && Math.abs(longitude) <= 55 && absoluteLatitude < 38
              ? "arid"
              : "temperate";
    const balance = weather.zones[zone];
    const wetSeasonPeakMonth = latitude < 0 ? 7 : 1;
    const material = {
      airportId: airport.id,
      iataCode: airport.snapshot.iataCode,
      latitudeDeg: airport.snapshot.latitudeDeg,
      longitudeDeg: airport.snapshot.longitudeDeg,
      elevationFt: airport.snapshot.elevationFt ?? null,
      timezoneName: airport.snapshot.timezoneName,
      climateDataVersion: weather.climate_data_version,
      zone,
      baselineWindKt: balance.baseline_wind_kt,
      seasonalWindAmplitudeKt: balance.seasonal_wind_amplitude_kt,
      storminessBasisPoints: balance.storminess_basis_points,
      lowVisibilityBasisPoints: balance.low_visibility_basis_points,
      wetSeasonPeakMonth,
      provenance: {
        ...weather.source_basis,
        formulaVersion: weather.profile_formula_version,
        rulesetVersion: weather.version,
        materialFields: ["latitude_deg", "longitude_deg", "elevation_ft", "world_region"],
      },
    };
    await sql`INSERT INTO airport_climate_profiles
      (climate_profile_version_id, airport_id, zone, baseline_wind_kt,
       seasonal_wind_amplitude_kt, storminess_basis_points, low_visibility_basis_points,
       wet_season_peak_month, material_snapshot, provenance)
      VALUES (${climateVersionId}::uuid, ${airport.id}::uuid, ${zone},
        ${balance.baseline_wind_kt}, ${balance.seasonal_wind_amplitude_kt},
        ${balance.storminess_basis_points}, ${balance.low_visibility_basis_points},
        ${wetSeasonPeakMonth}, ${JSON.stringify(material)}::jsonb,
        ${JSON.stringify(material.provenance)}::jsonb)
      ON CONFLICT (climate_profile_version_id, airport_id) DO NOTHING`.execute(database);
  }
  const climateCoverage = await sql<{ missing: string }>`SELECT count(*)::text AS missing
    FROM catalog_release_airports member
    WHERE member.release_id = ${releaseId}::uuid AND NOT EXISTS (
      SELECT 1 FROM airport_climate_profiles profile
      WHERE profile.climate_profile_version_id = ${climateVersionId}::uuid
        AND profile.airport_id = member.airport_id
    )`.execute(database);
  if (climateCoverage.rows[0]?.missing !== "0")
    throw new Error("Every playable airport must have a provenance-tracked climate profile.");
  await sql`UPDATE climate_profile_versions SET status = 'published', published_at = CURRENT_TIMESTAMP
    WHERE id = ${climateVersionId}::uuid AND status = 'draft'`.execute(database);
  await sql`INSERT INTO weather_ruleset_versions
    (world_ruleset_id, climate_profile_version_id, version, status, world_seed,
     formula_version, uncertainty_process_version, system_bucket_hours,
     correlation_cell_degrees, maximum_forecast_lead_hours, bounds, effective_from, activated_at)
    VALUES (${rulesetId}::uuid, ${climateVersionId}::uuid, ${weather.version}, 'draft',
      ${weather.world_seed}, ${weather.formula_version}, ${weather.uncertainty_process_version},
      ${weather.system_bucket_hours}, ${weather.correlation_cell_degrees},
      ${weather.maximum_forecast_lead_hours}, ${JSON.stringify(weather.bounds)}::jsonb,
      ${weather.effective_from}::timestamptz, NULL)
    ON CONFLICT (version) DO NOTHING`.execute(database);
  await sql`UPDATE weather_ruleset_versions SET status = 'active', activated_at = CURRENT_TIMESTAMP
    WHERE version = ${weather.version} AND status = 'draft'`.execute(database);

  return {
    releaseVersion,
    worldRulesetVersion,
    airportCount: airportSnapshots.length,
    aircraftVariantCount: aircraftSnapshots.length,
  };
}
