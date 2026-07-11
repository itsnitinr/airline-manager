import { sql } from "kysely";
import type {
  AcquisitionChannel,
  CatalogAircraftVariant,
  CatalogAirport,
  CatalogRepository,
  PublishedCatalog,
} from "@airline-manager/domain";
import type { Database } from "../database.js";

type RulesetRow = Readonly<{ id: string; release_id: string; release_version: string }>;

function defaultChannels(
  status: CatalogAircraftVariant["productionStatus"],
): readonly AcquisitionChannel[] {
  return status === "in_production"
    ? ["factory_new", "operating_lease", "used_purchase"]
    : ["operating_lease", "used_purchase"];
}

function parseAirport(snapshot: unknown): CatalogAirport {
  return snapshot as CatalogAirport;
}

function parseAircraft(snapshot: unknown): Omit<CatalogAircraftVariant, "acquisitionChannels"> {
  return snapshot as Omit<CatalogAircraftVariant, "acquisitionChannels">;
}

export class KyselyCatalogRepository implements CatalogRepository {
  public constructor(private readonly database: Database) {}

  private async findRuleset(version: string): Promise<RulesetRow | undefined> {
    const result =
      await sql<RulesetRow>`SELECT w.id, r.id AS release_id, r.version AS release_version
      FROM world_rulesets w
      JOIN catalog_releases r ON r.id = w.catalog_release_id AND r.status = 'published'
      WHERE w.version = ${version} AND w.status = 'active'`.execute(this.database);
    return result.rows[0];
  }

  public async findPublishedCatalogByWorldRuleset(
    version: string,
  ): Promise<PublishedCatalog | undefined> {
    const ruleset = await this.findRuleset(version);
    if (!ruleset) return undefined;
    const [airportRows, aircraftRows, overrideRows] = await Promise.all([
      sql<{ snapshot: unknown }>`SELECT snapshot FROM catalog_release_airports
        WHERE release_id = ${ruleset.release_id}::uuid
        ORDER BY snapshot->>'iataCode'`.execute(this.database),
      sql<{ aircraft_variant_id: string; snapshot: unknown }>`
        SELECT aircraft_variant_id, snapshot FROM catalog_release_aircraft_variants
        WHERE release_id = ${ruleset.release_id}::uuid
        ORDER BY snapshot->>'code'`.execute(this.database),
      sql<{ aircraft_variant_id: string; channels: AcquisitionChannel[] }>`
        SELECT aircraft_variant_id, channels FROM world_ruleset_acquisition_overrides
        WHERE world_ruleset_id = ${ruleset.id}::uuid`.execute(this.database),
    ]);
    const overrides = new Map(
      overrideRows.rows.map(({ aircraft_variant_id, channels }) => [aircraft_variant_id, channels]),
    );
    return {
      releaseVersion: ruleset.release_version,
      worldRulesetVersion: version,
      airports: airportRows.rows.map(({ snapshot }) => parseAirport(snapshot)),
      aircraftVariants: aircraftRows.rows.map(({ aircraft_variant_id, snapshot }) => {
        const variant = parseAircraft(snapshot);
        return {
          ...variant,
          acquisitionChannels:
            overrides.get(aircraft_variant_id) ?? defaultChannels(variant.productionStatus),
        };
      }),
    };
  }

  public async findAirportByIataCode(
    worldRulesetVersion: string,
    iataCode: string,
  ): Promise<CatalogAirport | undefined> {
    const ruleset = await this.findRuleset(worldRulesetVersion);
    if (!ruleset) return undefined;
    const result = await sql<{ snapshot: unknown }>`SELECT snapshot
      FROM catalog_release_airports
      WHERE release_id = ${ruleset.release_id}::uuid
        AND snapshot->>'iataCode' = ${iataCode.toUpperCase()}`.execute(this.database);
    return result.rows[0] ? parseAirport(result.rows[0].snapshot) : undefined;
  }

  public async listAircraftVariants(
    worldRulesetVersion: string,
  ): Promise<readonly CatalogAircraftVariant[]> {
    return (
      (await this.findPublishedCatalogByWorldRuleset(worldRulesetVersion))?.aircraftVariants ?? []
    );
  }
}
