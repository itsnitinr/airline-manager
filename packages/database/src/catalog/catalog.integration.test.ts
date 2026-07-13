import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readDatabasePoolOptions } from "../config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import { readAirportFixture } from "./fixtures.js";
import { importOurAirports } from "./import.js";
import { KyselyCatalogRepository } from "./repository.js";
import { seedSliceOneCatalog } from "./seed.js";

let runtime!: DatabaseRuntime;
let repository: KyselyCatalogRepository;

beforeAll(async () => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
  repository = new KyselyCatalogRepository(runtime.database);
  await seedSliceOneCatalog(runtime.database);
});

afterAll(async () => {
  await runtime?.destroy();
});

describe("reference import and quarantine", () => {
  it("re-imports an identical source idempotently while retaining retrieval metadata", async () => {
    const fixture = await readAirportFixture();
    const input = {
      sourceVersion: fixture.ourairports.source_version,
      checksum: fixture.ourairports.combined_sha256,
      retrievedAt: fixture.ourairports.retrieved_at,
      metadata: {
        airports_sha256: fixture.ourairports.airports_sha256,
        runways_sha256: fixture.ourairports.runways_sha256,
      },
      records: fixture.airports,
      validTimezones: new Set(fixture.timezones.map(({ name }) => name)),
    };
    const first = await importOurAirports(runtime.database, input);
    const second = await importOurAirports(runtime.database, input);
    expect(second.importId).toBe(first.importId);
    expect(first.insertedRecords).toBe(0);
    expect(second.insertedRecords).toBe(0);
    const stored = await sql<{
      imports: string;
      records: string;
      source_version: string;
      sha256: string;
      retrieval_count: number;
      first_retrieved_at: Date;
      last_retrieved_at: Date;
    }>`SELECT count(*) OVER ()::text AS imports, i.source_version, i.sha256,
        i.retrieval_count, i.first_retrieved_at, i.last_retrieved_at,
        (SELECT count(*)::text FROM raw_reference_records r WHERE r.import_id = i.id) AS records
      FROM raw_reference_imports i
      WHERE i.id = ${first.importId}::uuid`.execute(runtime.database);
    expect(stored.rows[0]).toMatchObject({
      imports: "1",
      records: "250",
      source_version: "2026-07-11",
      sha256: fixture.ourairports.combined_sha256,
    });
    expect(stored.rows[0]?.retrieval_count).toBeGreaterThanOrEqual(3);
    expect(stored.rows[0]?.last_retrieved_at.getTime()).toBeGreaterThanOrEqual(
      stored.rows[0]?.first_retrieved_at.getTime() ?? 0,
    );
  });

  it("keeps invalid rows quarantined with every actionable failure", async () => {
    const fixture = await readAirportFixture();
    const sourceRecordId = `invalid-${randomUUID()}`;
    const record = {
      source_record_id: sourceRecordId,
      ident: "bad",
      iata_code: "?",
      icao_code: "?",
      name: "",
      municipality: "",
      country_code: "?",
      region_code: "?",
      world_region: "NA",
      latitude_deg: 91,
      longitude_deg: 181,
      timezone_name: "Invalid/Zone",
      longest_runway_ft: 10,
      scheduled_service: false,
      commercial_relevance: "small_airport",
    };
    const checksum = createHash("sha256").update(sourceRecordId).digest("hex");
    const result = await importOurAirports(runtime.database, {
      sourceVersion: sourceRecordId,
      checksum,
      retrievedAt: "2026-07-11T01:00:00Z",
      metadata: { fixture: "invalid-quarantine" },
      records: [record],
      validTimezones: new Set(fixture.timezones.map(({ name }) => name)),
    });
    expect(result).toMatchObject({ validRecords: 0, quarantinedRecords: 1 });
    const stored = await sql<{ id: string; disposition: string; failures: string }>`
      SELECT r.id, r.disposition,
        count(v.*) FILTER (WHERE NOT v.passed AND v.severity = 'error')::text AS failures
      FROM raw_reference_records r
      JOIN reference_validation_results v ON v.raw_record_id = r.id
      WHERE r.import_id = ${result.importId}::uuid AND r.source_record_id = ${sourceRecordId}
      GROUP BY r.id, r.disposition`.execute(runtime.database);
    expect(stored.rows[0]).toMatchObject({ disposition: "quarantined", failures: "6" });
    const promoted = await sql<{ count: string }>`SELECT count(*)::text AS count
      FROM curated_airports WHERE promoted_from_raw_record_id IN
        (SELECT id FROM raw_reference_records WHERE import_id = ${result.importId}::uuid)`.execute(
      runtime.database,
    );
    expect(promoted.rows[0]?.count).toBe("0");

    const rawId = stored.rows[0]?.id;
    const validTimezone = fixture.timezones[0]?.name;
    if (!rawId || !validTimezone) throw new Error("Constraint test fixture is incomplete.");
    await expect(
      sql`INSERT INTO curated_airports
        (promoted_from_raw_record_id, ident, iata_code, icao_code, name, municipality,
         country_code, region_code, world_region, latitude_deg, longitude_deg,
         timezone_dataset_version, timezone_name, longest_runway_ft, scheduled_service,
         commercial_relevance)
        VALUES (${rawId}::uuid, 'TQZZ', 'TQZ', 'TQZZ', 'Constraint Airport', 'Test City',
          'US', 'US-CA', 'NA', 91, 0, '2026b', ${validTimezone}, 5000, true, 'large_airport')`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql`INSERT INTO curated_airports
        (promoted_from_raw_record_id, ident, iata_code, icao_code, name, municipality,
         country_code, region_code, world_region, latitude_deg, longitude_deg,
         timezone_dataset_version, timezone_name, longest_runway_ft, scheduled_service,
         commercial_relevance)
        VALUES (${rawId}::uuid, 'TQZZ', 'TQZ', 'TQZZ', 'Constraint Airport', 'Test City',
          'US', 'US-CA', 'NA', 0, 0, '2026b', 'Invalid/Zone', 5000, true, 'large_airport')`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      sql`INSERT INTO reference_provenance
        (record_type, record_id, field_name, classification, effective_from, explanation)
        VALUES ('airport', ${randomUUID()}::uuid, 'bad_field', 'sourced', CURRENT_DATE,
          'Missing mandatory sourced provenance fields.')`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("published catalog and world rules", () => {
  it("publishes the expected global airports, variants, and complete field provenance", async () => {
    const catalog = await repository.findPublishedCatalogByWorldRuleset("contemporary-2026.07.11");
    expect(catalog?.airports).toHaveLength(250);
    expect(catalog?.aircraftVariants).toHaveLength(4);
    const regions = (catalog?.airports ?? []).reduce<Record<string, number>>((counts, airport) => {
      counts[airport.worldRegion] = (counts[airport.worldRegion] ?? 0) + 1;
      return counts;
    }, {});
    expect(regions).toEqual({ AF: 25, AS: 60, EU: 60, NA: 60, OC: 20, SA: 25 });
    expect(catalog?.airports.every(({ provenance }) => provenance.length === 15)).toBe(true);
    expect(catalog?.aircraftVariants.every(({ provenance }) => provenance.length === 12)).toBe(
      true,
    );
    expect(catalog?.aircraftVariants.map(({ category }) => category)).toEqual([
      "narrow_body",
      "turboprop",
      "narrow_body",
      "regional_jet",
    ]);
    expect(
      catalog?.aircraftVariants
        .flatMap(({ provenance }) => provenance)
        .every(({ classification }) => ["sourced", "derived", "balance"].includes(classification)),
    ).toBe(true);
    expect(
      catalog?.aircraftVariants
        .flatMap(({ provenance }) => provenance)
        .some(
          ({ classification, rulesetVersion }) =>
            classification === "balance" && rulesetVersion === "contemporary-2026.07.11",
        ),
    ).toBe(true);
  });

  it("selects the current effective active world catalog without a client-supplied version", async () => {
    const catalog = await repository.findCurrentPublishedCatalog();
    expect(catalog).toMatchObject({
      releaseVersion: "slice-one-2026.07.11",
      worldRulesetVersion: "contemporary-2026.07.11",
    });
    expect(catalog?.airports).toHaveLength(250);
  });

  it("applies production defaults and a data-driven ruleset acquisition override", async () => {
    const variants = await repository.listAircraftVariants("contemporary-2026.07.11");
    expect(variants.find(({ code }) => code === "airbus-a320neo")?.acquisitionChannels).toEqual([
      "factory_new",
      "operating_lease",
      "used_purchase",
    ]);
    expect(variants.find(({ code }) => code === "embraer-e175")?.acquisitionChannels).toEqual([
      "operating_lease",
      "used_purchase",
    ]);
    expect(variants.find(({ code }) => code === "embraer-e175")?.productionStatus).toBe(
      "in_production",
    );
  });

  it("rejects release mutation and selection of a draft release", async () => {
    const release = await sql<{ id: string }>`SELECT id FROM catalog_releases
      WHERE version = 'slice-one-2026.07.11'`.execute(runtime.database);
    const releaseId = release.rows[0]?.id;
    expect(releaseId).toBeDefined();
    await expect(
      sql`UPDATE catalog_releases SET description = 'mutated' WHERE id = ${releaseId}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`DELETE FROM catalog_release_airports WHERE release_id = ${releaseId}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    const activeRuleset = await sql<{ id: string }>`SELECT id FROM world_rulesets
      WHERE version = 'contemporary-2026.07.11'`.execute(runtime.database);
    await expect(
      sql`UPDATE world_rulesets SET effective_from = CURRENT_TIMESTAMP
        WHERE id = ${activeRuleset.rows[0]?.id}::uuid`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`UPDATE world_ruleset_acquisition_overrides SET reason = 'mutated'
        WHERE world_ruleset_id = ${activeRuleset.rows[0]?.id}::uuid`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "55000" });

    const draft = await sql<{ id: string }>`INSERT INTO catalog_releases (version, description)
      VALUES (${`draft-${randomUUID()}`}, 'integration-test draft') RETURNING id`.execute(
      runtime.database,
    );
    await expect(
      sql`INSERT INTO world_rulesets (version, catalog_release_id, effective_from)
        VALUES (${`draft-rules-${randomUUID()}`}, ${draft.rows[0]?.id}::uuid, CURRENT_TIMESTAMP)`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("exposes only read operations and returns snapshot data without database mutation", async () => {
    expect("save" in repository).toBe(false);
    expect("publish" in repository).toBe(false);
    const before = await sql<{ count: string }>`SELECT count(*)::text AS count
      FROM administrative_audit_records`.execute(runtime.database);
    const airport = await repository.findAirportByIataCode("contemporary-2026.07.11", "JFK");
    const after = await sql<{ count: string }>`SELECT count(*)::text AS count
      FROM administrative_audit_records`.execute(runtime.database);
    expect(airport?.iataCode).toBe("JFK");
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
