CREATE TABLE reference_sources (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]+$'),
  name text NOT NULL CHECK (name <> ''),
  homepage_url text NOT NULL CHECK (homepage_url ~ '^https://'),
  license_name text NOT NULL CHECK (license_name <> ''),
  license_url text NOT NULL CHECK (license_url ~ '^https://'),
  attribution text NOT NULL CHECK (attribution <> ''),
  accuracy_disclaimer text NOT NULL CHECK (accuracy_disclaimer <> ''),
  redistribution_permitted boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE raw_reference_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES reference_sources (id),
  dataset_name text NOT NULL CHECK (dataset_name <> ''),
  source_version text NOT NULL CHECK (source_version <> ''),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  first_retrieved_at timestamptz NOT NULL,
  last_retrieved_at timestamptz NOT NULL,
  retrieval_count integer NOT NULL DEFAULT 1 CHECK (retrieval_count > 0),
  imported_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  record_count integer NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'validated')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (source_id, dataset_name, source_version, sha256),
  CHECK (last_retrieved_at >= first_retrieved_at)
);

CREATE TABLE raw_reference_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES raw_reference_imports (id) ON DELETE CASCADE,
  source_record_id text NOT NULL CHECK (source_record_id <> ''),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  disposition text NOT NULL DEFAULT 'quarantined'
    CHECK (disposition IN ('quarantined', 'validated', 'promoted')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (import_id, source_record_id)
);

CREATE INDEX raw_reference_records_disposition_idx
  ON raw_reference_records (import_id, disposition, source_record_id);

CREATE TABLE reference_validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_record_id uuid NOT NULL REFERENCES raw_reference_records (id) ON DELETE CASCADE,
  rule_code text NOT NULL CHECK (rule_code ~ '^[a-z0-9_]+$'),
  passed boolean NOT NULL,
  severity text NOT NULL CHECK (severity IN ('error', 'warning')),
  message text NOT NULL CHECK (message <> ''),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  validated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (raw_record_id, rule_code)
);

CREATE INDEX reference_validation_failures_idx
  ON reference_validation_results (raw_record_id, severity)
  WHERE NOT passed;

CREATE TABLE timezone_dataset_versions (
  version text PRIMARY KEY CHECK (version ~ '^20[0-9]{2}[a-z]$'),
  source_id text NOT NULL REFERENCES reference_sources (id),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  retrieved_at timestamptz NOT NULL,
  release_url text NOT NULL CHECK (release_url ~ '^https://'),
  UNIQUE (source_id, sha256)
);

CREATE TABLE timezone_definitions (
  dataset_version text NOT NULL REFERENCES timezone_dataset_versions (version),
  name text NOT NULL CHECK (name ~ '^[A-Za-z0-9_+.-]+(/[A-Za-z0-9_+.-]+)+$'),
  country_codes text[] NOT NULL CHECK (cardinality(country_codes) > 0),
  coordinates text NOT NULL CHECK (coordinates <> ''),
  comment text,
  PRIMARY KEY (dataset_version, name)
);

CREATE TABLE curated_airports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoted_from_raw_record_id uuid NOT NULL UNIQUE REFERENCES raw_reference_records (id),
  ident text NOT NULL UNIQUE CHECK (ident ~ '^[A-Z0-9-]{2,12}$'),
  iata_code char(3) NOT NULL UNIQUE CHECK (iata_code ~ '^[A-Z]{3}$'),
  icao_code char(4) NOT NULL UNIQUE CHECK (icao_code ~ '^[A-Z0-9]{4}$'),
  name text NOT NULL CHECK (name <> ''),
  municipality text NOT NULL CHECK (municipality <> ''),
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  region_code text NOT NULL CHECK (region_code ~ '^[A-Z]{2}-[A-Z0-9-]+$'),
  world_region char(2) NOT NULL CHECK (world_region IN ('AF', 'AS', 'EU', 'NA', 'OC', 'SA')),
  latitude_deg numeric(9, 6) NOT NULL CHECK (latitude_deg BETWEEN -90 AND 90),
  longitude_deg numeric(9, 6) NOT NULL CHECK (longitude_deg BETWEEN -180 AND 180),
  elevation_ft integer,
  timezone_dataset_version text NOT NULL,
  timezone_name text NOT NULL,
  longest_runway_ft integer NOT NULL CHECK (longest_runway_ft >= 3000),
  scheduled_service boolean NOT NULL CHECK (scheduled_service),
  commercial_relevance text NOT NULL CHECK (commercial_relevance IN ('large_airport')),
  curated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (timezone_dataset_version, timezone_name)
    REFERENCES timezone_definitions (dataset_version, name)
);

CREATE TABLE curated_aircraft_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]+$'),
  manufacturer text NOT NULL CHECK (manufacturer <> ''),
  model text NOT NULL CHECK (model <> ''),
  certification_reference text NOT NULL CHECK (certification_reference ~ '^FAA TCDS [A-Z0-9]+'),
  category text NOT NULL CHECK (category IN ('turboprop', 'regional_jet', 'narrow_body')),
  passenger_only boolean NOT NULL CHECK (passenger_only),
  typical_seats integer NOT NULL CHECK (typical_seats BETWEEN 30 AND 240),
  maximum_seats integer NOT NULL CHECK (maximum_seats >= typical_seats AND maximum_seats <= 250),
  range_nm integer NOT NULL CHECK (range_nm BETWEEN 500 AND 5000),
  maximum_takeoff_weight_kg integer NOT NULL CHECK (maximum_takeoff_weight_kg > 0),
  minimum_runway_ft integer NOT NULL CHECK (minimum_runway_ft >= 2500),
  production_status text NOT NULL CHECK (production_status IN ('in_production', 'discontinued')),
  production_status_effective_from date NOT NULL,
  curated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reference_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type text NOT NULL CHECK (record_type IN ('airport', 'aircraft_variant')),
  record_id uuid NOT NULL,
  field_name text NOT NULL CHECK (field_name ~ '^[a-z][a-z0-9_]*$'),
  classification text NOT NULL CHECK (classification IN ('sourced', 'derived', 'balance')),
  source_id text REFERENCES reference_sources (id),
  source_locator text,
  effective_from date NOT NULL,
  effective_to date,
  formula_version text,
  ruleset_version text,
  explanation text NOT NULL CHECK (explanation <> ''),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (record_type, record_id, field_name),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (
    (classification = 'sourced' AND source_id IS NOT NULL AND source_locator IS NOT NULL
      AND formula_version IS NULL AND ruleset_version IS NULL)
    OR (classification = 'derived' AND source_id IS NULL AND formula_version IS NOT NULL
      AND ruleset_version IS NULL)
    OR (classification = 'balance' AND source_id IS NULL AND formula_version IS NULL
      AND ruleset_version IS NOT NULL)
  )
);

CREATE INDEX reference_provenance_record_idx
  ON reference_provenance (record_type, record_id, field_name);

CREATE TABLE catalog_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (version ~ '^[a-z0-9][a-z0-9._-]+$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  description text NOT NULL CHECK (description <> ''),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at timestamptz,
  CHECK ((status = 'draft' AND published_at IS NULL) OR (status = 'published' AND published_at IS NOT NULL))
);

CREATE TABLE catalog_release_airports (
  release_id uuid NOT NULL REFERENCES catalog_releases (id),
  airport_id uuid NOT NULL REFERENCES curated_airports (id),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  PRIMARY KEY (release_id, airport_id)
);

CREATE TABLE catalog_release_aircraft_variants (
  release_id uuid NOT NULL REFERENCES catalog_releases (id),
  aircraft_variant_id uuid NOT NULL REFERENCES curated_aircraft_variants (id),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  PRIMARY KEY (release_id, aircraft_variant_id)
);

CREATE TABLE world_rulesets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (version ~ '^[a-z0-9][a-z0-9._-]+$'),
  catalog_release_id uuid NOT NULL REFERENCES catalog_releases (id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK ((status = 'draft' AND activated_at IS NULL) OR (status = 'active' AND activated_at IS NOT NULL))
);

CREATE TABLE world_ruleset_acquisition_overrides (
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id),
  aircraft_variant_id uuid NOT NULL REFERENCES curated_aircraft_variants (id),
  channels text[] NOT NULL CHECK (
    cardinality(channels) > 0
    AND channels <@ ARRAY['factory_new', 'operating_lease', 'used_purchase']::text[]
  ),
  reason text NOT NULL CHECK (reason <> ''),
  PRIMARY KEY (world_ruleset_id, aircraft_variant_id)
);

CREATE FUNCTION guard_published_catalog_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published catalog releases are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalog_releases_immutable_after_publication
  BEFORE UPDATE OR DELETE ON catalog_releases
  FOR EACH ROW EXECUTE FUNCTION guard_published_catalog_release();

CREATE FUNCTION guard_published_catalog_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_release_id uuid;
BEGIN
  target_release_id := COALESCE(NEW.release_id, OLD.release_id);
  IF EXISTS (SELECT 1 FROM catalog_releases WHERE id = target_release_id AND status = 'published') THEN
    RAISE EXCEPTION 'published catalog release membership is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalog_release_airports_immutable_after_publication
  BEFORE INSERT OR UPDATE OR DELETE ON catalog_release_airports
  FOR EACH ROW EXECUTE FUNCTION guard_published_catalog_membership();

CREATE TRIGGER catalog_release_aircraft_immutable_after_publication
  BEFORE INSERT OR UPDATE OR DELETE ON catalog_release_aircraft_variants
  FOR EACH ROW EXECUTE FUNCTION guard_published_catalog_membership();

CREATE FUNCTION require_published_catalog_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM catalog_releases WHERE id = NEW.catalog_release_id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'world rulesets must select a published catalog release' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER world_rulesets_published_release
  BEFORE INSERT OR UPDATE ON world_rulesets
  FOR EACH ROW EXECUTE FUNCTION require_published_catalog_release();

CREATE FUNCTION guard_active_world_ruleset() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'active' THEN
    RAISE EXCEPTION 'active world rulesets are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER world_rulesets_immutable_after_activation
  BEFORE UPDATE OR DELETE ON world_rulesets
  FOR EACH ROW EXECUTE FUNCTION guard_active_world_ruleset();

CREATE FUNCTION guard_active_world_ruleset_override() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_ruleset_id uuid;
BEGIN
  target_ruleset_id := COALESCE(NEW.world_ruleset_id, OLD.world_ruleset_id);
  IF EXISTS (SELECT 1 FROM world_rulesets WHERE id = target_ruleset_id AND status = 'active') THEN
    RAISE EXCEPTION 'active world ruleset overrides are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER world_ruleset_overrides_immutable_after_activation
  BEFORE INSERT OR UPDATE OR DELETE ON world_ruleset_acquisition_overrides
  FOR EACH ROW EXECUTE FUNCTION guard_active_world_ruleset_override();

COMMENT ON TABLE raw_reference_records IS
  'Quarantined upstream rows. Validation never makes them playable; explicit curated promotion is required.';
COMMENT ON TABLE reference_provenance IS
  'Field-level sourced, derived, or balance provenance for every playable record.';
COMMENT ON TABLE catalog_releases IS
  'Immutable after publication; world rulesets select an explicit release version.';
