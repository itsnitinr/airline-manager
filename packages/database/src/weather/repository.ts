import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  WeatherDomainError,
  generateAirportWeather,
  planRouteWeather,
  type AirportClimateProfile,
  type WeatherForecastSnapshot,
  type WeatherRealizedSnapshot,
  type WeatherRepository,
  type WeatherRules,
} from "@airline-manager/domain";
import type { DB } from "../generated/database.js";
import type { Database } from "../database.js";
import { runInTransaction } from "../transactions.js";

type Queryable = Database | Transaction<DB>;
type ScopeContext = Readonly<{
  game_world_id: string;
  scope_id: string;
  origin_airport_id: string;
  destination_airport_id: string;
  valid_at: Date;
  world_ruleset_version: string;
  weather_ruleset_version_id: string;
  weather_ruleset_version: string;
  world_seed: string;
  formula_version: string;
  uncertainty_process_version: "seeded-lead-spread-v1";
  system_bucket_hours: number;
  correlation_cell_degrees: number;
  maximum_forecast_lead_hours: number;
  climate_profile_version_id: string;
  climate_data_version: string;
}>;

async function routeContext(
  database: Queryable,
  playerAccountId: string,
  airlineId: string,
  routeId: string,
  validAt: Date,
): Promise<ScopeContext> {
  const result = await sql<ScopeContext>`SELECT a.game_world_id, r.id AS scope_id,
    r.origin_airport_id, r.destination_airport_id, ${validAt.toISOString()}::timestamptz AS valid_at,
    world.version AS world_ruleset_version, weather.id AS weather_ruleset_version_id,
    weather.version AS weather_ruleset_version, weather.world_seed, weather.formula_version,
    weather.uncertainty_process_version, weather.system_bucket_hours,
    weather.correlation_cell_degrees, weather.maximum_forecast_lead_hours,
    weather.climate_profile_version_id, climate.version AS climate_data_version
    FROM airline_routes r JOIN airlines a ON a.id = r.airline_id
    JOIN careers career ON career.id = a.career_id
    JOIN resource_ownerships own ON own.resource_type = 'airline' AND own.resource_id = a.id
      AND own.player_account_id = ${playerAccountId}::uuid
    JOIN world_rulesets world ON world.id = career.world_ruleset_id
    JOIN weather_ruleset_versions weather ON weather.world_ruleset_id = world.id AND weather.status = 'active'
    JOIN climate_profile_versions climate ON climate.id = weather.climate_profile_version_id AND climate.status = 'published'
    WHERE a.id = ${airlineId}::uuid AND r.id = ${routeId}::uuid`.execute(database);
  const row = result.rows[0];
  if (!row) throw new WeatherDomainError("weather_not_found", "Route weather is unavailable.");
  return row;
}

async function departureContext(
  database: Queryable,
  playerAccountId: string,
  airlineId: string,
  datedFlightId: string,
): Promise<ScopeContext> {
  const result = await sql<ScopeContext>`SELECT a.game_world_id, flight.id AS scope_id,
    flight.origin_airport_id, flight.destination_airport_id, flight.departure_at AS valid_at,
    world.version AS world_ruleset_version, weather.id AS weather_ruleset_version_id,
    weather.version AS weather_ruleset_version, weather.world_seed, weather.formula_version,
    weather.uncertainty_process_version, weather.system_bucket_hours,
    weather.correlation_cell_degrees, weather.maximum_forecast_lead_hours,
    weather.climate_profile_version_id, climate.version AS climate_data_version
    FROM dated_flights flight JOIN airline_routes route ON route.id = flight.route_id
    JOIN airlines a ON a.id = route.airline_id JOIN careers career ON career.id = a.career_id
    JOIN resource_ownerships own ON own.resource_type = 'airline' AND own.resource_id = a.id
      AND own.player_account_id = ${playerAccountId}::uuid
    JOIN world_rulesets world ON world.id = career.world_ruleset_id
    JOIN weather_ruleset_versions weather ON weather.world_ruleset_id = world.id AND weather.status = 'active'
    JOIN climate_profile_versions climate ON climate.id = weather.climate_profile_version_id AND climate.status = 'published'
    WHERE a.id = ${airlineId}::uuid AND flight.id = ${datedFlightId}::uuid`.execute(database);
  const row = result.rows[0];
  if (!row) throw new WeatherDomainError("weather_not_found", "Departure weather is unavailable.");
  return row;
}

async function climate(
  database: Queryable,
  climateProfileVersionId: string,
  airportId: string,
): Promise<AirportClimateProfile> {
  const result = await sql<{ material_snapshot: unknown }>`SELECT material_snapshot
    FROM airport_climate_profiles WHERE climate_profile_version_id = ${climateProfileVersionId}::uuid
      AND airport_id = ${airportId}::uuid`.execute(database);
  const profile = result.rows[0]?.material_snapshot as AirportClimateProfile | undefined;
  if (!profile)
    throw new WeatherDomainError(
      "weather_not_found",
      "A playable airport is missing climate coverage.",
    );
  return profile;
}

function rules(context: ScopeContext): WeatherRules {
  return {
    worldSeed: context.world_seed,
    worldRulesetVersion: context.world_ruleset_version,
    weatherRulesetVersion: context.weather_ruleset_version,
    climateDataVersion: context.climate_data_version,
    formulaVersion: context.formula_version,
    systemBucketHours: context.system_bucket_hours,
    correlationCellDegrees: context.correlation_cell_degrees,
    maximumForecastLeadHours: context.maximum_forecast_lead_hours,
  };
}

async function persistForecast(
  database: Queryable,
  context: ScopeContext,
  scope: "route" | "departure",
  issuedAt: Date,
): Promise<WeatherForecastSnapshot> {
  const weatherRules = rules(context);
  const [originClimate, destinationClimate] = await Promise.all([
    climate(database, context.climate_profile_version_id, context.origin_airport_id),
    climate(database, context.climate_profile_version_id, context.destination_airport_id),
  ]);
  const plan = planRouteWeather(
    generateAirportWeather(weatherRules, originClimate, issuedAt, context.valid_at),
    generateAirportWeather(weatherRules, destinationClimate, issuedAt, context.valid_at),
  );
  const materialInputSnapshot = {
    rules: weatherRules,
    originClimate,
    destinationClimate,
    issuedAt: issuedAt.toISOString(),
    validAt: context.valid_at.toISOString(),
    uncertaintyProcessVersion: context.uncertainty_process_version,
  };
  const inputHash = createHash("sha256")
    .update(JSON.stringify(materialInputSnapshot))
    .digest("hex");
  const id = randomUUID();
  await sql`INSERT INTO weather_forecast_snapshots
    (id, game_world_id, weather_ruleset_version_id, climate_profile_version_id, scope,
     scope_id, issued_at, valid_at, input_hash, material_input_snapshot, forecast_snapshot, created_at)
    VALUES (${id}::uuid, ${context.game_world_id}::uuid, ${context.weather_ruleset_version_id}::uuid,
      ${context.climate_profile_version_id}::uuid, ${scope}, ${context.scope_id}::uuid,
      ${issuedAt.toISOString()}::timestamptz, ${context.valid_at.toISOString()}::timestamptz,
      ${inputHash}, ${JSON.stringify(materialInputSnapshot)}::jsonb, ${JSON.stringify(plan)}::jsonb,
      ${issuedAt.toISOString()}::timestamptz)
    ON CONFLICT (game_world_id, scope, scope_id, issued_at, valid_at, weather_ruleset_version_id)
    DO NOTHING`.execute(database);
  const stored = await sql<{
    id: string;
    issued_at: Date;
    valid_at: Date;
    material_input_snapshot: unknown;
    forecast_snapshot: unknown;
  }>`SELECT id, issued_at, valid_at, material_input_snapshot, forecast_snapshot
    FROM weather_forecast_snapshots WHERE game_world_id = ${context.game_world_id}::uuid
      AND scope = ${scope} AND scope_id = ${context.scope_id}::uuid
      AND issued_at = ${issuedAt.toISOString()}::timestamptz
      AND valid_at = ${context.valid_at.toISOString()}::timestamptz
      AND weather_ruleset_version_id = ${context.weather_ruleset_version_id}::uuid`.execute(
    database,
  );
  const row = stored.rows[0];
  if (!row) throw new Error("Weather forecast was not persisted.");
  await sql`INSERT INTO weather_snapshot_intents
    (scope, scope_id, available_at, intent_type, material_snapshot, updated_at)
    VALUES (${scope}, ${context.scope_id}::uuid, ${context.valid_at.toISOString()}::timestamptz,
      'weather.realization_due.v1', ${JSON.stringify({ forecastSnapshotId: row.id, validAt: context.valid_at.toISOString() })}::jsonb,
      ${issuedAt.toISOString()}::timestamptz)
    ON CONFLICT (scope, scope_id, intent_type) DO UPDATE SET
      available_at = EXCLUDED.available_at, material_snapshot = EXCLUDED.material_snapshot,
      updated_at = EXCLUDED.updated_at`.execute(database);
  return {
    id: row.id,
    scope,
    scopeId: context.scope_id,
    issuedAt: row.issued_at.toISOString(),
    validAt: row.valid_at.toISOString(),
    plan: row.forecast_snapshot as WeatherForecastSnapshot["plan"],
    materialInputSnapshot: row.material_input_snapshot as Readonly<Record<string, unknown>>,
  };
}

export class KyselyWeatherRepository implements WeatherRepository {
  public constructor(private readonly database: Database) {}

  public async forecastRoute(
    playerAccountId: string,
    airlineId: string,
    routeId: string,
    issuedAt: Date,
    validAt: Date,
  ): Promise<WeatherForecastSnapshot> {
    return runInTransaction(
      this.database,
      async (transaction) =>
        persistForecast(
          transaction,
          await routeContext(transaction, playerAccountId, airlineId, routeId, validAt),
          "route",
          issuedAt,
        ),
      { isolationLevel: "serializable", maximumAttempts: 4 },
    );
  }

  public async forecastDeparture(
    playerAccountId: string,
    airlineId: string,
    datedFlightId: string,
    issuedAt: Date,
  ): Promise<WeatherForecastSnapshot> {
    return runInTransaction(
      this.database,
      async (transaction) =>
        persistForecast(
          transaction,
          await departureContext(transaction, playerAccountId, airlineId, datedFlightId),
          "departure",
          issuedAt,
        ),
      { isolationLevel: "serializable", maximumAttempts: 4 },
    );
  }

  public async realizeForecast(
    forecastSnapshotId: string,
    realizedAt: Date,
  ): Promise<WeatherRealizedSnapshot> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        const result = await sql<{
          id: string;
          issued_at: Date;
          valid_at: Date;
          material_input_snapshot: unknown;
        }>`SELECT id, issued_at, valid_at, material_input_snapshot FROM weather_forecast_snapshots
          WHERE id = ${forecastSnapshotId}::uuid FOR SHARE`.execute(transaction);
        const row = result.rows[0];
        if (!row)
          throw new WeatherDomainError("weather_not_found", "Forecast snapshot is unavailable.");
        const material = row.material_input_snapshot as {
          rules: WeatherRules;
          originClimate: AirportClimateProfile;
          destinationClimate: AirportClimateProfile;
        };
        const plan = planRouteWeather(
          generateAirportWeather(
            material.rules,
            material.originClimate,
            row.issued_at,
            row.valid_at,
            "realized",
          ),
          generateAirportWeather(
            material.rules,
            material.destinationClimate,
            row.issued_at,
            row.valid_at,
            "realized",
          ),
        );
        const realizedMaterial = {
          forecastSnapshotId,
          forecastMaterialInputSnapshot: row.material_input_snapshot,
          uncertaintyProcessVersion: "seeded-lead-spread-v1",
        };
        const id = randomUUID();
        await sql`INSERT INTO weather_realized_snapshots
          (id, forecast_snapshot_id, realized_at, uncertainty_process_version,
           material_input_snapshot, realized_snapshot, created_at)
          VALUES (${id}::uuid, ${forecastSnapshotId}::uuid, ${realizedAt.toISOString()}::timestamptz,
            'seeded-lead-spread-v1', ${JSON.stringify(realizedMaterial)}::jsonb,
            ${JSON.stringify(plan)}::jsonb, ${realizedAt.toISOString()}::timestamptz)
          ON CONFLICT (forecast_snapshot_id) DO NOTHING`.execute(transaction);
        const stored = await sql<{
          id: string;
          forecast_snapshot_id: string;
          realized_at: Date;
          material_input_snapshot: unknown;
          realized_snapshot: unknown;
        }>`SELECT id, forecast_snapshot_id, realized_at, material_input_snapshot, realized_snapshot
          FROM weather_realized_snapshots WHERE forecast_snapshot_id = ${forecastSnapshotId}::uuid`.execute(
          transaction,
        );
        const realized = stored.rows[0];
        if (!realized) throw new Error("Realized weather was not persisted.");
        return {
          id: realized.id,
          forecastSnapshotId: realized.forecast_snapshot_id,
          realizedAt: realized.realized_at.toISOString(),
          plan: realized.realized_snapshot as WeatherRealizedSnapshot["plan"],
          uncertaintyProcessVersion: "seeded-lead-spread-v1",
          materialInputSnapshot: realized.material_input_snapshot as Readonly<
            Record<string, unknown>
          >,
        };
      },
      { isolationLevel: "serializable", maximumAttempts: 4 },
    );
  }
}
