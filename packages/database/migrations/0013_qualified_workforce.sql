CREATE TABLE workforce_ruleset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  version text NOT NULL UNIQUE CHECK (version ~ '^[a-z0-9][a-z0-9._-]+$'),
  status text NOT NULL CHECK (status IN ('draft', 'active')),
  effective_from timestamptz NOT NULL,
  fatigue_formula_version text NOT NULL CHECK (fatigue_formula_version <> ''),
  demand_formula_version text NOT NULL CHECK (demand_formula_version <> ''),
  wage_interval_hours integer NOT NULL CHECK (wage_interval_hours BETWEEN 1 AND 168),
  assumptions jsonb NOT NULL CHECK (jsonb_typeof(assumptions) = 'object'),
  activated_at timestamptz,
  UNIQUE (world_ruleset_id, version),
  CHECK ((status = 'draft' AND activated_at IS NULL) OR (status = 'active' AND activated_at IS NOT NULL))
);

CREATE UNIQUE INDEX workforce_ruleset_one_active_idx
  ON workforce_ruleset_versions (world_ruleset_id) WHERE status = 'active';

CREATE TABLE workforce_role_rules (
  workforce_ruleset_version_id uuid NOT NULL REFERENCES workforce_ruleset_versions (id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('pilot', 'cabin_crew', 'line_maintenance', 'ground_handling')),
  qualification_scope text NOT NULL CHECK (qualification_scope IN ('aircraft_variant', 'general')),
  training_lead_hours integer NOT NULL CHECK (training_lead_hours >= 0),
  hiring_cost_minor jsonb NOT NULL CHECK (jsonb_typeof(hiring_cost_minor) = 'object'),
  training_cost_minor jsonb NOT NULL CHECK (jsonb_typeof(training_cost_minor) = 'object'),
  wage_per_interval_minor jsonb NOT NULL CHECK (jsonb_typeof(wage_per_interval_minor) = 'object'),
  flight_capacity_per_unit integer NOT NULL CHECK (flight_capacity_per_unit > 0),
  recovery_minutes_per_block_hour integer NOT NULL CHECK (recovery_minutes_per_block_hour >= 0),
  minimum_recovery_minutes integer NOT NULL CHECK (minimum_recovery_minutes >= 0),
  PRIMARY KEY (workforce_ruleset_version_id, role)
);

CREATE TABLE workforce_starter_packages (
  workforce_ruleset_version_id uuid NOT NULL REFERENCES workforce_ruleset_versions (id) ON DELETE RESTRICT,
  aircraft_variant_id uuid NOT NULL REFERENCES curated_aircraft_variants (id) ON DELETE RESTRICT,
  aircraft_variant_code text NOT NULL CHECK (aircraft_variant_code <> ''),
  package jsonb NOT NULL CHECK (jsonb_typeof(package) = 'object'),
  explanation text NOT NULL CHECK (explanation <> ''),
  PRIMARY KEY (workforce_ruleset_version_id, aircraft_variant_id)
);

CREATE TABLE workforce_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_id uuid NOT NULL REFERENCES airlines (id) ON DELETE RESTRICT,
  base_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('pilot', 'cabin_crew', 'line_maintenance', 'ground_handling')),
  qualification_code text NOT NULL CHECK (qualification_code <> ''),
  qualification_aircraft_variant_id uuid REFERENCES curated_aircraft_variants (id) ON DELETE RESTRICT,
  catalog_release_id uuid REFERENCES catalog_releases (id) ON DELETE RESTRICT,
  workforce_ruleset_version_id uuid NOT NULL REFERENCES workforce_ruleset_versions (id) ON DELETE RESTRICT,
  active_capacity integer NOT NULL DEFAULT 0 CHECK (active_capacity >= 0),
  wage_per_interval_minor bigint NOT NULL CHECK (wage_per_interval_minor >= 0),
  reporting_currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  wage_checkpoint_at timestamptz NOT NULL,
  next_wage_due_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (airline_id, base_airport_id, role, qualification_code),
  CHECK ((role = 'pilot' AND qualification_aircraft_variant_id IS NOT NULL AND catalog_release_id IS NOT NULL)
      OR (role <> 'pilot' AND qualification_aircraft_variant_id IS NULL AND catalog_release_id IS NULL))
);

CREATE TABLE workforce_hiring_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workforce_pool_id uuid NOT NULL REFERENCES workforce_pools (id) ON DELETE RESTRICT,
  airline_id uuid NOT NULL REFERENCES airlines (id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  capacity integer NOT NULL CHECK (capacity > 0),
  hired_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  activated_at timestamptz,
  wage_checkpoint_at timestamptz NOT NULL,
  next_wage_due_at timestamptz NOT NULL,
  hiring_cost_minor bigint NOT NULL CHECK (hiring_cost_minor >= 0),
  training_cost_minor bigint NOT NULL CHECK (training_cost_minor >= 0),
  hiring_journal_entry_id uuid NOT NULL REFERENCES journal_entries (id) ON DELETE RESTRICT,
  training_journal_entry_id uuid NOT NULL REFERENCES journal_entries (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'training' CHECK (status IN ('training', 'available')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (airline_id, idempotency_key),
  CHECK (available_at >= hired_at AND wage_checkpoint_at >= available_at AND next_wage_due_at > wage_checkpoint_at),
  CHECK ((status = 'training' AND activated_at IS NULL) OR (status = 'available' AND activated_at IS NOT NULL))
);

CREATE INDEX workforce_hiring_due_idx
  ON workforce_hiring_orders (available_at, id) WHERE status = 'training';

CREATE TABLE workforce_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dated_flight_id uuid NOT NULL REFERENCES dated_flights (id) ON DELETE RESTRICT,
  workforce_pool_id uuid NOT NULL REFERENCES workforce_pools (id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('pilot', 'cabin_crew', 'line_maintenance', 'ground_handling')),
  qualification_code text NOT NULL CHECK (qualification_code <> ''),
  capacity integer NOT NULL CHECK (capacity > 0),
  duty_starts_at timestamptz NOT NULL,
  duty_ends_at timestamptz NOT NULL,
  recovery_ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'released')),
  allocated_at timestamptz NOT NULL,
  released_at timestamptz,
  UNIQUE (dated_flight_id, role),
  CHECK (duty_ends_at > duty_starts_at AND recovery_ends_at >= duty_ends_at),
  CHECK ((status = 'reserved' AND released_at IS NULL) OR (status = 'released' AND released_at IS NOT NULL))
);

CREATE INDEX workforce_allocations_pool_window_idx
  ON workforce_allocations (workforce_pool_id, duty_starts_at, recovery_ends_at)
  WHERE status = 'reserved';

CREATE TABLE workforce_wage_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workforce_pool_id uuid NOT NULL REFERENCES workforce_pools (id) ON DELETE RESTRICT,
  workforce_hiring_order_id uuid NOT NULL REFERENCES workforce_hiring_orders (id) ON DELETE RESTRICT,
  interval_starts_at timestamptz NOT NULL,
  interval_ends_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK (capacity >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries (id) ON DELETE RESTRICT,
  accrued_at timestamptz NOT NULL,
  UNIQUE (workforce_hiring_order_id, interval_starts_at, interval_ends_at),
  CHECK (interval_ends_at > interval_starts_at)
);

CREATE TABLE workforce_checkpoint_intents (
  workforce_pool_id uuid PRIMARY KEY REFERENCES workforce_pools (id) ON DELETE RESTRICT,
  available_at timestamptz NOT NULL,
  intent_type text NOT NULL CHECK (intent_type = 'workforce.checkpoint_due.v1'),
  updated_at timestamptz NOT NULL
);

CREATE FUNCTION reject_active_workforce_rules_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_version_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'workforce_ruleset_versions' THEN target_version_id := OLD.id;
  ELSE target_version_id := OLD.workforce_ruleset_version_id;
  END IF;
  IF EXISTS (SELECT 1 FROM workforce_ruleset_versions WHERE id = target_version_id AND status = 'active') THEN
    RAISE EXCEPTION 'active workforce rules are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workforce_ruleset_immutable BEFORE UPDATE OR DELETE ON workforce_ruleset_versions
  FOR EACH ROW WHEN (OLD.status = 'active') EXECUTE FUNCTION reject_active_workforce_rules_mutation();
CREATE TRIGGER workforce_role_rules_immutable BEFORE UPDATE OR DELETE ON workforce_role_rules
  FOR EACH ROW EXECUTE FUNCTION reject_active_workforce_rules_mutation();
CREATE TRIGGER workforce_starter_packages_immutable BEFORE UPDATE OR DELETE ON workforce_starter_packages
  FOR EACH ROW EXECUTE FUNCTION reject_active_workforce_rules_mutation();

COMMENT ON TABLE workforce_pools IS
  'Aggregated qualified capacity by airline, operating base, role, and catalog-derived qualification; no employee identities.';
COMMENT ON TABLE workforce_allocations IS
  'Transactional dated-flight capacity reservations. Repositories lock pools before summing overlapping reservations.';
COMMENT ON TABLE workforce_checkpoint_intents IS
  'Persisted deterministic catch-up intent only; ticket 16 owns queue delivery and reconciliation runtime.';
