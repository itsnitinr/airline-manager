CREATE TABLE climate_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_release_id uuid NOT NULL REFERENCES catalog_releases (id) ON DELETE RESTRICT,
  version text NOT NULL UNIQUE CHECK (version <> ''),
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  formula_version text NOT NULL CHECK (formula_version <> ''),
  source_basis jsonb NOT NULL CHECK (jsonb_typeof(source_basis) = 'object'),
  effective_from timestamptz NOT NULL,
  published_at timestamptz,
  CHECK ((status = 'draft' AND published_at IS NULL) OR (status = 'published' AND published_at IS NOT NULL))
);

CREATE TABLE airport_climate_profiles (
  climate_profile_version_id uuid NOT NULL REFERENCES climate_profile_versions (id) ON DELETE RESTRICT,
  airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  zone text NOT NULL CHECK (zone IN ('tropical', 'arid', 'temperate', 'continental', 'polar')),
  baseline_wind_kt integer NOT NULL CHECK (baseline_wind_kt BETWEEN 0 AND 40),
  seasonal_wind_amplitude_kt integer NOT NULL CHECK (seasonal_wind_amplitude_kt BETWEEN 0 AND 25),
  storminess_basis_points integer NOT NULL CHECK (storminess_basis_points BETWEEN 0 AND 10000),
  low_visibility_basis_points integer NOT NULL CHECK (low_visibility_basis_points BETWEEN 0 AND 10000),
  wet_season_peak_month integer NOT NULL CHECK (wet_season_peak_month BETWEEN 1 AND 12),
  material_snapshot jsonb NOT NULL CHECK (jsonb_typeof(material_snapshot) = 'object'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  PRIMARY KEY (climate_profile_version_id, airport_id)
);

CREATE TABLE weather_ruleset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  climate_profile_version_id uuid NOT NULL REFERENCES climate_profile_versions (id) ON DELETE RESTRICT,
  version text NOT NULL UNIQUE CHECK (version <> ''),
  status text NOT NULL CHECK (status IN ('draft', 'active')),
  world_seed text NOT NULL CHECK (world_seed <> ''),
  formula_version text NOT NULL CHECK (formula_version <> ''),
  uncertainty_process_version text NOT NULL CHECK (uncertainty_process_version = 'seeded-lead-spread-v1'),
  system_bucket_hours integer NOT NULL CHECK (system_bucket_hours BETWEEN 1 AND 24),
  correlation_cell_degrees integer NOT NULL CHECK (correlation_cell_degrees BETWEEN 1 AND 30),
  maximum_forecast_lead_hours integer NOT NULL CHECK (maximum_forecast_lead_hours BETWEEN 24 AND 8760),
  bounds jsonb NOT NULL CHECK (jsonb_typeof(bounds) = 'object'),
  effective_from timestamptz NOT NULL,
  activated_at timestamptz,
  UNIQUE (world_ruleset_id, version),
  CHECK ((status = 'draft' AND activated_at IS NULL) OR (status = 'active' AND activated_at IS NOT NULL))
);

CREATE UNIQUE INDEX weather_ruleset_one_active_idx
  ON weather_ruleset_versions (world_ruleset_id) WHERE status = 'active';

CREATE TABLE weather_forecast_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_world_id uuid NOT NULL REFERENCES game_worlds (id) ON DELETE RESTRICT,
  weather_ruleset_version_id uuid NOT NULL REFERENCES weather_ruleset_versions (id) ON DELETE RESTRICT,
  climate_profile_version_id uuid NOT NULL REFERENCES climate_profile_versions (id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('route', 'departure')),
  scope_id uuid NOT NULL,
  issued_at timestamptz NOT NULL,
  valid_at timestamptz NOT NULL,
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  material_input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(material_input_snapshot) = 'object'),
  forecast_snapshot jsonb NOT NULL CHECK (jsonb_typeof(forecast_snapshot) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (game_world_id, scope, scope_id, issued_at, valid_at, weather_ruleset_version_id),
  CHECK (valid_at >= issued_at)
);

CREATE TABLE weather_realized_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_snapshot_id uuid NOT NULL UNIQUE REFERENCES weather_forecast_snapshots (id) ON DELETE RESTRICT,
  realized_at timestamptz NOT NULL,
  uncertainty_process_version text NOT NULL CHECK (uncertainty_process_version = 'seeded-lead-spread-v1'),
  material_input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(material_input_snapshot) = 'object'),
  realized_snapshot jsonb NOT NULL CHECK (jsonb_typeof(realized_snapshot) = 'object'),
  created_at timestamptz NOT NULL
);

CREATE TABLE weather_snapshot_intents (
  scope text NOT NULL CHECK (scope IN ('route', 'departure')),
  scope_id uuid NOT NULL,
  available_at timestamptz NOT NULL,
  intent_type text NOT NULL CHECK (intent_type IN ('weather.forecast_due.v1', 'weather.realization_due.v1')),
  material_snapshot jsonb NOT NULL CHECK (jsonb_typeof(material_snapshot) = 'object'),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (scope, scope_id, intent_type)
);

CREATE FUNCTION reject_weather_material_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'weather rules, climate profiles, and snapshots are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER climate_profile_versions_immutable BEFORE UPDATE OR DELETE ON climate_profile_versions
  FOR EACH ROW WHEN (OLD.status = 'published') EXECUTE FUNCTION reject_weather_material_mutation();
CREATE TRIGGER airport_climate_profiles_immutable BEFORE UPDATE OR DELETE ON airport_climate_profiles
  FOR EACH ROW EXECUTE FUNCTION reject_weather_material_mutation();
CREATE TRIGGER weather_ruleset_versions_immutable BEFORE UPDATE OR DELETE ON weather_ruleset_versions
  FOR EACH ROW WHEN (OLD.status = 'active') EXECUTE FUNCTION reject_weather_material_mutation();
CREATE TRIGGER weather_forecast_snapshots_immutable BEFORE UPDATE OR DELETE ON weather_forecast_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_weather_material_mutation();
CREATE TRIGGER weather_realized_snapshots_immutable BEFORE UPDATE OR DELETE ON weather_realized_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_weather_material_mutation();

COMMENT ON TABLE weather_forecast_snapshots IS
  'Immutable explainable route/departure forecasts with explicit seed, rules, climate version, issue time, valid time, uncertainty, and material inputs.';
COMMENT ON TABLE weather_realized_snapshots IS
  'Immutable realized conditions derived only through the persisted seeded uncertainty process; ticket 17 may reference these without rewriting them.';
