CREATE TABLE maintenance_program_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  version text NOT NULL UNIQUE CHECK (version ~ '^[a-z0-9][a-z0-9._-]+$'),
  status text NOT NULL CHECK (status IN ('draft', 'active')),
  effective_from timestamptz NOT NULL,
  utilization_formula_version text NOT NULL CHECK (utilization_formula_version <> ''),
  condition_formula_version text NOT NULL CHECK (condition_formula_version <> ''),
  fault_formula_version text NOT NULL CHECK (fault_formula_version <> ''),
  calendar_semantics text NOT NULL CHECK (calendar_semantics = 'elapsed_utc_days'),
  assumptions jsonb NOT NULL CHECK (jsonb_typeof(assumptions) = 'object'),
  activated_at timestamptz,
  UNIQUE (world_ruleset_id, version),
  CHECK ((status = 'draft' AND activated_at IS NULL) OR
         (status = 'active' AND activated_at IS NOT NULL))
);

CREATE UNIQUE INDEX maintenance_program_one_active_idx
  ON maintenance_program_versions (world_ruleset_id) WHERE status = 'active';

CREATE TABLE maintenance_program_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_program_version_id uuid NOT NULL REFERENCES maintenance_program_versions (id) ON DELETE RESTRICT,
  aircraft_variant_id uuid NOT NULL REFERENCES curated_aircraft_variants (id) ON DELETE RESTRICT,
  aircraft_variant_code text NOT NULL CHECK (aircraft_variant_code <> ''),
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]+$'),
  name text NOT NULL CHECK (name <> ''),
  work_kind text NOT NULL CHECK (work_kind IN ('line', 'package')),
  interval_hours_minutes bigint CHECK (interval_hours_minutes > 0),
  interval_cycles bigint CHECK (interval_cycles > 0),
  interval_calendar_days integer CHECK (interval_calendar_days > 0),
  hard_limit boolean NOT NULL,
  maximum_deferral_hours_minutes bigint NOT NULL CHECK (maximum_deferral_hours_minutes >= 0),
  maximum_deferral_cycles bigint NOT NULL CHECK (maximum_deferral_cycles >= 0),
  maximum_deferral_calendar_days integer NOT NULL CHECK (maximum_deferral_calendar_days >= 0),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 30 AND 10080),
  workforce_capacity integer NOT NULL CHECK (workforce_capacity BETWEEN 1 AND 100),
  cost_minor jsonb NOT NULL CHECK (jsonb_typeof(cost_minor) = 'object'),
  condition_restore_basis_points integer NOT NULL CHECK (condition_restore_basis_points BETWEEN 0 AND 5000),
  material_snapshot jsonb NOT NULL CHECK (jsonb_typeof(material_snapshot) = 'object'),
  UNIQUE (maintenance_program_version_id, aircraft_variant_id, code),
  CHECK (num_nonnulls(interval_hours_minutes, interval_cycles, interval_calendar_days) > 0)
);

CREATE TABLE aircraft_maintenance_assignments (
  aircraft_id uuid PRIMARY KEY REFERENCES aircraft (id) ON DELETE RESTRICT,
  maintenance_program_version_id uuid NOT NULL REFERENCES maintenance_program_versions (id) ON DELETE RESTRICT,
  aircraft_variant_id uuid NOT NULL REFERENCES curated_aircraft_variants (id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL,
  starting_hours_minutes bigint NOT NULL CHECK (starting_hours_minutes >= 0),
  starting_cycles bigint NOT NULL CHECK (starting_cycles >= 0),
  program_snapshot jsonb NOT NULL CHECK (jsonb_typeof(program_snapshot) = 'object')
);

CREATE TABLE aircraft_maintenance_due_counters (
  aircraft_id uuid NOT NULL REFERENCES aircraft (id) ON DELETE RESTRICT,
  maintenance_rule_id uuid NOT NULL REFERENCES maintenance_program_rules (id) ON DELETE RESTRICT,
  baseline_hours_minutes bigint NOT NULL CHECK (baseline_hours_minutes >= 0),
  baseline_cycles bigint NOT NULL CHECK (baseline_cycles >= 0),
  calendar_started_at timestamptz NOT NULL,
  due_state text NOT NULL CHECK (due_state IN ('not_due', 'due', 'soft_overdue', 'hard_overdue')),
  assessed_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (aircraft_id, maintenance_rule_id)
);

CREATE TABLE flight_completion_utilization_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_key text NOT NULL UNIQUE CHECK (completion_key <> ''),
  aircraft_id uuid NOT NULL REFERENCES aircraft (id) ON DELETE RESTRICT,
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz NOT NULL,
  block_minutes integer NOT NULL CHECK (block_minutes BETWEEN 1 AND 1440),
  cycles integer NOT NULL CHECK (cycles BETWEEN 1 AND 10),
  fault_seed text NOT NULL CHECK (fault_seed <> ''),
  program_version text NOT NULL CHECK (program_version <> ''),
  material_input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(material_input_snapshot) = 'object'),
  result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  processed_at timestamptz NOT NULL
);

CREATE TABLE maintenance_faults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_completion_utilization_input_id uuid NOT NULL UNIQUE REFERENCES flight_completion_utilization_inputs (id) ON DELETE RESTRICT,
  aircraft_id uuid NOT NULL REFERENCES aircraft (id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('open', 'repair_planned', 'repaired')),
  outcome text NOT NULL CHECK (outcome IN ('delay', 'grounding')),
  severity text NOT NULL CHECK (severity IN ('minor', 'major')),
  delay_minutes integer NOT NULL CHECK (delay_minutes BETWEEN 0 AND 180),
  grounds_aircraft boolean NOT NULL,
  repair_duration_minutes integer NOT NULL CHECK (repair_duration_minutes BETWEEN 30 AND 1440),
  repair_workforce_capacity integer NOT NULL CHECK (repair_workforce_capacity BETWEEN 1 AND 10),
  repair_cost_minor bigint NOT NULL CHECK (repair_cost_minor > 0),
  deterministic_seed text NOT NULL CHECK (deterministic_seed <> ''),
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  outcome_snapshot jsonb NOT NULL CHECK (jsonb_typeof(outcome_snapshot) = 'object'),
  discovered_at timestamptz NOT NULL,
  repaired_at timestamptz
);

CREATE TABLE maintenance_work_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES aircraft (id) ON DELETE RESTRICT,
  maintenance_rule_id uuid REFERENCES maintenance_program_rules (id) ON DELETE RESTRICT,
  maintenance_fault_id uuid UNIQUE REFERENCES maintenance_faults (id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('planned', 'repair')),
  status text NOT NULL CHECK (status IN ('planned', 'completed')),
  program_version text NOT NULL CHECK (program_version <> ''),
  rule_snapshot jsonb NOT NULL CHECK (jsonb_typeof(rule_snapshot) = 'object'),
  workforce_capacity integer NOT NULL CHECK (workforce_capacity BETWEEN 1 AND 100),
  cost_minor bigint NOT NULL CHECK (cost_minor >= 0),
  journal_entry_id uuid UNIQUE REFERENCES journal_entries (id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (aircraft_id, idempotency_key),
  CHECK ((source = 'planned' AND maintenance_rule_id IS NOT NULL AND maintenance_fault_id IS NULL) OR
         (source = 'repair' AND maintenance_rule_id IS NULL AND maintenance_fault_id IS NOT NULL)),
  CHECK ((status = 'planned' AND completed_at IS NULL AND journal_entry_id IS NULL) OR
         (status = 'completed' AND completed_at IS NOT NULL AND journal_entry_id IS NOT NULL))
);

CREATE TABLE maintenance_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_work_package_id uuid NOT NULL UNIQUE REFERENCES maintenance_work_packages (id) ON DELETE RESTRICT,
  aircraft_id uuid NOT NULL REFERENCES aircraft (id) ON DELETE RESTRICT,
  airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'completed')),
  created_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at)
);

ALTER TABLE maintenance_windows ADD CONSTRAINT maintenance_windows_aircraft_no_overlap
  EXCLUDE USING gist (
    aircraft_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  );

CREATE TABLE maintenance_workforce_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_work_package_id uuid NOT NULL UNIQUE REFERENCES maintenance_work_packages (id) ON DELETE RESTRICT,
  workforce_pool_id uuid NOT NULL REFERENCES workforce_pools (id) ON DELETE RESTRICT,
  capacity integer NOT NULL CHECK (capacity > 0),
  duty_starts_at timestamptz NOT NULL,
  duty_ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved', 'released')),
  allocated_at timestamptz NOT NULL,
  released_at timestamptz,
  CHECK (duty_ends_at > duty_starts_at),
  CHECK ((status = 'reserved' AND released_at IS NULL) OR
         (status = 'released' AND released_at IS NOT NULL))
);

CREATE INDEX maintenance_workforce_pool_window_idx
  ON maintenance_workforce_allocations (workforce_pool_id, duty_starts_at, duty_ends_at)
  WHERE status = 'reserved';

CREATE TABLE maintenance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES aircraft (id) ON DELETE RESTRICT,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type IN
    ('program_assigned', 'utilization_recorded', 'work_planned', 'work_completed', 'fault_discovered', 'fault_repaired')),
  occurred_at timestamptz NOT NULL,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  journal_entry_id uuid REFERENCES journal_entries (id) ON DELETE RESTRICT,
  UNIQUE (aircraft_id, sequence)
);

CREATE TABLE maintenance_checkpoint_intents (
  aircraft_id uuid PRIMARY KEY REFERENCES aircraft (id) ON DELETE RESTRICT,
  available_at timestamptz NOT NULL,
  intent_type text NOT NULL CHECK (intent_type = 'maintenance.checkpoint_due.v1'),
  updated_at timestamptz NOT NULL
);

CREATE FUNCTION reject_active_maintenance_rules_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_version_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'maintenance_program_versions' THEN target_version_id := OLD.id;
  ELSE target_version_id := OLD.maintenance_program_version_id;
  END IF;
  IF EXISTS (SELECT 1 FROM maintenance_program_versions WHERE id = target_version_id AND status = 'active') THEN
    RAISE EXCEPTION 'active maintenance programs and material snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maintenance_program_immutable BEFORE UPDATE OR DELETE ON maintenance_program_versions
  FOR EACH ROW WHEN (OLD.status = 'active') EXECUTE FUNCTION reject_active_maintenance_rules_mutation();
CREATE TRIGGER maintenance_rules_immutable BEFORE UPDATE OR DELETE ON maintenance_program_rules
  FOR EACH ROW EXECUTE FUNCTION reject_active_maintenance_rules_mutation();

CREATE FUNCTION reject_maintenance_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'maintenance history and utilization inputs are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER maintenance_history_append_only BEFORE UPDATE OR DELETE ON maintenance_history
  FOR EACH ROW EXECUTE FUNCTION reject_maintenance_history_mutation();
CREATE TRIGGER flight_completion_inputs_append_only BEFORE UPDATE OR DELETE ON flight_completion_utilization_inputs
  FOR EACH ROW EXECUTE FUNCTION reject_maintenance_history_mutation();
CREATE TRIGGER maintenance_assignments_append_only BEFORE UPDATE OR DELETE ON aircraft_maintenance_assignments
  FOR EACH ROW EXECUTE FUNCTION reject_maintenance_history_mutation();

CREATE FUNCTION reject_cross_maintenance_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'maintenance_windows' THEN
    IF EXISTS (SELECT 1 FROM dated_flights f WHERE f.aircraft_id = NEW.aircraft_id
      AND f.status <> 'cancelled'
      AND tstzrange(f.departure_at, f.ready_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')) THEN
      RAISE EXCEPTION 'maintenance window overlaps a dated flight' USING ERRCODE = '23P01';
    END IF;
  ELSE
    IF NEW.status <> 'cancelled' AND EXISTS (SELECT 1 FROM maintenance_windows w
      WHERE w.aircraft_id = NEW.aircraft_id
      AND tstzrange(w.starts_at, w.ends_at, '[)') && tstzrange(NEW.departure_at, NEW.ready_at, '[)')) THEN
      RAISE EXCEPTION 'dated flight overlaps a maintenance window' USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maintenance_window_flight_conflict BEFORE INSERT OR UPDATE ON maintenance_windows
  FOR EACH ROW EXECUTE FUNCTION reject_cross_maintenance_occupancy();
CREATE TRIGGER dated_flight_maintenance_conflict BEFORE INSERT OR UPDATE ON dated_flights
  FOR EACH ROW EXECUTE FUNCTION reject_cross_maintenance_occupancy();

COMMENT ON TABLE maintenance_program_rules IS
  'Versioned aircraft-variant-specific balanced maintenance rules, not certified operator maintenance data.';
COMMENT ON TABLE flight_completion_utilization_inputs IS
  'Stable idempotent ticket-17 input boundary; each completion increments utilization exactly once.';
COMMENT ON TABLE maintenance_checkpoint_intents IS
  'Persisted checkpoint intent only; ticket 16 owns BullMQ delivery and reconciliation.';
