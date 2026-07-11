CREATE TABLE founder_package_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (version ~ '^[a-z0-9][a-z0-9._-]+$'),
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (world_ruleset_id, version)
);

CREATE UNIQUE INDEX founder_package_one_active_per_ruleset_idx
  ON founder_package_versions (world_ruleset_id) WHERE status = 'active';

CREATE TABLE aircraft_lessors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]+$'),
  name text NOT NULL CHECK (name <> ''),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE founder_package_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_version_id uuid NOT NULL REFERENCES founder_package_versions (id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]+$'),
  aircraft_variant_id uuid NOT NULL REFERENCES curated_aircraft_variants (id) ON DELETE RESTRICT,
  lessor_id uuid NOT NULL REFERENCES aircraft_lessors (id) ON DELETE RESTRICT,
  acquisition_channel text NOT NULL CHECK (acquisition_channel = 'operating_lease'),
  economy_seats integer NOT NULL CHECK (economy_seats > 0),
  delivery_delay_minutes integer NOT NULL CHECK (delivery_delay_minutes BETWEEN 0 AND 1440),
  term_days integer NOT NULL CHECK (term_days > 0),
  payment_interval_days integer NOT NULL CHECK (payment_interval_days > 0),
  payment_count integer NOT NULL CHECK (payment_count > 0),
  recurring_payment_minor jsonb NOT NULL CHECK (jsonb_typeof(recurring_payment_minor) = 'object'),
  deposit_minor jsonb NOT NULL CHECK (jsonb_typeof(deposit_minor) = 'object'),
  deposit_subsidy_minor jsonb NOT NULL CHECK (jsonb_typeof(deposit_subsidy_minor) = 'object'),
  network_summary text NOT NULL CHECK (network_summary <> ''),
  cost_summary text NOT NULL CHECK (cost_summary <> ''),
  delivery_summary text NOT NULL CHECK (delivery_summary <> ''),
  commonality_risk_summary text NOT NULL CHECK (commonality_risk_summary <> ''),
  runway_tradeoff_summary text NOT NULL CHECK (runway_tradeoff_summary <> ''),
  usage_conditions jsonb NOT NULL CHECK (jsonb_typeof(usage_conditions) = 'object'),
  return_conditions jsonb NOT NULL CHECK (jsonb_typeof(return_conditions) = 'object'),
  UNIQUE (package_version_id, code),
  UNIQUE (package_version_id, aircraft_variant_id)
);

CREATE TABLE operating_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  career_id uuid NOT NULL UNIQUE REFERENCES careers (id) ON DELETE RESTRICT,
  airline_id uuid NOT NULL UNIQUE REFERENCES airlines (id) ON DELETE RESTRICT,
  aircraft_id uuid UNIQUE,
  founder_package_option_id uuid NOT NULL REFERENCES founder_package_options (id) ON DELETE RESTRICT,
  lessor_id uuid NOT NULL REFERENCES aircraft_lessors (id) ON DELETE RESTRICT,
  currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  matures_at timestamptz NOT NULL CHECK (matures_at > starts_at),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'defaulted')),
  ended_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  sale_prohibited boolean NOT NULL DEFAULT true CHECK (sale_prohibited),
  collateral_prohibited boolean NOT NULL DEFAULT true CHECK (collateral_prohibited),
  cash_extraction_prohibited boolean NOT NULL DEFAULT true CHECK (cash_extraction_prohibited),
  CHECK ((status = 'active' AND ended_at IS NULL) OR (status <> 'active' AND ended_at IS NOT NULL))
);

CREATE TABLE operating_lease_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES operating_leases (id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  effective_at timestamptz NOT NULL,
  term_days integer NOT NULL CHECK (term_days > 0),
  payment_interval_days integer NOT NULL CHECK (payment_interval_days > 0),
  payment_count integer NOT NULL CHECK (payment_count > 0),
  recurring_payment_minor bigint NOT NULL CHECK (recurring_payment_minor > 0),
  deposit_minor bigint NOT NULL CHECK (deposit_minor >= 0),
  deposit_subsidy_minor bigint NOT NULL CHECK (deposit_subsidy_minor >= 0),
  refundable_deposit_minor bigint NOT NULL CHECK (refundable_deposit_minor >= 0),
  usage_conditions jsonb NOT NULL CHECK (jsonb_typeof(usage_conditions) = 'object'),
  return_conditions jsonb NOT NULL CHECK (jsonb_typeof(return_conditions) = 'object'),
  delivery_terms jsonb NOT NULL CHECK (jsonb_typeof(delivery_terms) = 'object'),
  UNIQUE (lease_id, version),
  CHECK (deposit_subsidy_minor <= deposit_minor),
  CHECK (refundable_deposit_minor = deposit_minor - deposit_subsidy_minor)
);

CREATE TABLE operating_lease_payment_schedule (
  lease_id uuid NOT NULL REFERENCES operating_leases (id) ON DELETE RESTRICT,
  term_version integer NOT NULL,
  payment_number integer NOT NULL CHECK (payment_number > 0),
  due_at timestamptz NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'paid', 'overdue', 'cancelled')),
  journal_entry_id uuid REFERENCES journal_entries (id) ON DELETE RESTRICT,
  PRIMARY KEY (lease_id, term_version, payment_number),
  FOREIGN KEY (lease_id, term_version) REFERENCES operating_lease_terms (lease_id, version) ON DELETE RESTRICT,
  CHECK ((status = 'paid') = (journal_entry_id IS NOT NULL))
);

CREATE INDEX operating_lease_schedule_due_idx ON operating_lease_payment_schedule (due_at, lease_id)
  WHERE status IN ('scheduled', 'overdue');

CREATE TABLE aircraft (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number text NOT NULL UNIQUE CHECK (serial_number ~ '^FND-[A-Z0-9-]+$'),
  catalog_release_id uuid NOT NULL REFERENCES catalog_releases (id) ON DELETE RESTRICT,
  aircraft_variant_id uuid NOT NULL REFERENCES curated_aircraft_variants (id) ON DELETE RESTRICT,
  variant_snapshot jsonb NOT NULL CHECK (jsonb_typeof(variant_snapshot) = 'object'),
  operator_airline_id uuid REFERENCES airlines (id) ON DELETE RESTRICT,
  owner_lessor_id uuid NOT NULL REFERENCES aircraft_lessors (id) ON DELETE RESTRICT,
  operating_lease_id uuid NOT NULL UNIQUE REFERENCES operating_leases (id) ON DELETE RESTRICT,
  current_airport_id uuid REFERENCES curated_airports (id) ON DELETE RESTRICT,
  planned_airport_id uuid REFERENCES curated_airports (id) ON DELETE RESTRICT,
  delivery_state text NOT NULL CHECK (delivery_state IN ('pending', 'delivered', 'returned', 'defaulted')),
  delivery_target_at timestamptz NOT NULL,
  delivered_at timestamptz,
  manufactured_at timestamptz NOT NULL,
  initial_chronological_age_seconds bigint NOT NULL DEFAULT 0 CHECK (initial_chronological_age_seconds >= 0),
  accumulated_hours_minutes bigint NOT NULL DEFAULT 0 CHECK (accumulated_hours_minutes >= 0),
  accumulated_cycles bigint NOT NULL DEFAULT 0 CHECK (accumulated_cycles >= 0),
  condition_basis_points integer NOT NULL CHECK (condition_basis_points BETWEEN 0 AND 10000),
  dispatch_reliability_basis_points integer NOT NULL CHECK (dispatch_reliability_basis_points BETWEEN 0 AND 10000),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  CHECK (delivery_state <> 'delivered' OR delivered_at IS NOT NULL),
  CHECK (delivery_state <> 'pending' OR delivered_at IS NULL),
  CHECK (delivery_state <> 'delivered' OR current_airport_id IS NOT NULL),
  CHECK (delivery_state <> 'pending' OR current_airport_id IS NULL)
);

ALTER TABLE operating_leases ADD CONSTRAINT operating_leases_aircraft_fk
  FOREIGN KEY (aircraft_id) REFERENCES aircraft (id) ON DELETE RESTRICT;

CREATE TABLE aircraft_cabin_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL UNIQUE REFERENCES aircraft (id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version = 1),
  economy_seats integer NOT NULL CHECK (economy_seats > 0),
  premium_economy_seats integer NOT NULL DEFAULT 0 CHECK (premium_economy_seats = 0),
  business_seats integer NOT NULL DEFAULT 0 CHECK (business_seats = 0),
  first_seats integer NOT NULL DEFAULT 0 CHECK (first_seats = 0),
  configured_at timestamptz NOT NULL,
  configuration_kind text NOT NULL DEFAULT 'physical_cabin' CHECK (configuration_kind = 'physical_cabin')
);

CREATE TABLE aircraft_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES aircraft (id) ON DELETE RESTRICT,
  aircraft_version bigint NOT NULL CHECK (aircraft_version > 0),
  event_type text NOT NULL CHECK (event_type IN ('accepted', 'delivery_scheduled', 'delivered', 'returned', 'defaulted')),
  occurred_at timestamptz NOT NULL,
  airport_id uuid REFERENCES curated_airports (id) ON DELETE RESTRICT,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  UNIQUE (aircraft_id, aircraft_version, event_type)
);

CREATE FUNCTION reject_founder_reference_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'founder package and lease terms are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER founder_package_versions_immutable BEFORE UPDATE OR DELETE ON founder_package_versions
  FOR EACH ROW EXECUTE FUNCTION reject_founder_reference_mutation();
CREATE TRIGGER founder_package_options_immutable BEFORE UPDATE OR DELETE ON founder_package_options
  FOR EACH ROW EXECUTE FUNCTION reject_founder_reference_mutation();
CREATE TRIGGER aircraft_lessors_immutable BEFORE UPDATE OR DELETE ON aircraft_lessors
  FOR EACH ROW EXECUTE FUNCTION reject_founder_reference_mutation();
CREATE TRIGGER operating_lease_terms_immutable BEFORE UPDATE OR DELETE ON operating_lease_terms
  FOR EACH ROW EXECUTE FUNCTION reject_founder_reference_mutation();

CREATE FUNCTION protect_aircraft_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.serial_number, OLD.catalog_release_id, OLD.aircraft_variant_id, OLD.variant_snapshot,
      OLD.owner_lessor_id, OLD.operating_lease_id, OLD.manufactured_at,
      OLD.initial_chronological_age_seconds, OLD.created_at)
    IS DISTINCT FROM
     (NEW.serial_number, NEW.catalog_release_id, NEW.aircraft_variant_id, NEW.variant_snapshot,
      NEW.owner_lessor_id, NEW.operating_lease_id, NEW.manufactured_at,
      NEW.initial_chronological_age_seconds, NEW.created_at) THEN
    RAISE EXCEPTION 'aircraft identity and accepted catalog facts are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'aircraft optimistic version must advance exactly once' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER aircraft_identity_and_version BEFORE UPDATE ON aircraft
  FOR EACH ROW EXECUTE FUNCTION protect_aircraft_identity();

CREATE FUNCTION reject_aircraft_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'aircraft lifecycle history is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER aircraft_lifecycle_append_only BEFORE UPDATE OR DELETE ON aircraft_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION reject_aircraft_history_mutation();

COMMENT ON TABLE founder_package_options IS
  'Versioned balance data. Economic values and delivery compression are not manufacturer facts.';
COMMENT ON TABLE aircraft_cabin_configurations IS
  'Slice-one physical economy cabin; deliberately distinct from future booking classes.';
COMMENT ON TABLE aircraft_lifecycle_events IS
  'Append-only aircraft history retained through delivery, return, and default.';
