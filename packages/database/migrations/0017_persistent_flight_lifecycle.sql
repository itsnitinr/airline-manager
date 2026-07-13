ALTER TABLE dated_flights DROP CONSTRAINT dated_flights_status_check;
DROP TRIGGER dated_flights_history_guard ON dated_flights;
DROP FUNCTION protect_committed_dated_flight();

UPDATE dated_flights SET status = CASE
  WHEN status = 'sold' THEN 'scheduled'
  WHEN status = 'in_progress' THEN 'departed'
  ELSE status
END;

ALTER TABLE dated_flights
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN state_effective_at timestamptz,
  ADD COLUMN actual_departure_at timestamptz,
  ADD COLUMN actual_arrival_at timestamptz,
  ADD COLUMN diversion_airport_id uuid REFERENCES curated_airports (id) ON DELETE RESTRICT,
  ADD COLUMN suspension_reason_code text,
  ADD COLUMN suspension_explanation text,
  ADD COLUMN suspension_recovery_steps jsonb,
  ADD COLUMN suspension_retry_count integer NOT NULL DEFAULT 0 CHECK (suspension_retry_count BETWEEN 0 AND 3),
  ADD COLUMN suspension_next_retry_at timestamptz,
  ADD COLUMN cancellation_reason_code text,
  ADD COLUMN settled_at timestamptz,
  ADD CONSTRAINT dated_flights_lifecycle_status CHECK (status IN
    ('scheduled', 'suspended', 'cancelled', 'delayed', 'boarding', 'departed', 'diverted', 'arrived', 'settled')),
  ADD CONSTRAINT dated_flights_suspension_shape CHECK (
    (status <> 'suspended') OR
    (suspension_reason_code IS NOT NULL AND suspension_explanation IS NOT NULL
      AND jsonb_typeof(suspension_recovery_steps) = 'array')),
  ADD CONSTRAINT dated_flights_actual_time_shape CHECK (
    (status NOT IN ('departed', 'diverted', 'arrived', 'settled') OR actual_departure_at IS NOT NULL)
    AND (status NOT IN ('arrived', 'settled') OR actual_arrival_at IS NOT NULL)
    AND (actual_arrival_at IS NULL OR actual_arrival_at >= actual_departure_at)),
  ADD CONSTRAINT dated_flights_settlement_shape CHECK ((status = 'settled') = (settled_at IS NOT NULL));
UPDATE dated_flights SET state_effective_at = created_at WHERE state_effective_at IS NULL;
ALTER TABLE dated_flights ALTER COLUMN state_effective_at SET NOT NULL;
ALTER TABLE dated_flights ALTER COLUMN state_effective_at SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE flight_lifecycle_commands (
  command_id uuid PRIMARY KEY,
  flight_id uuid NOT NULL REFERENCES dated_flights (id) ON DELETE RESTRICT,
  milestone text NOT NULL CHECK (milestone IN ('booking_lock', 'dispatch', 'arrival', 'settlement')),
  expected_version bigint NOT NULL CHECK (expected_version > 0),
  effective_at timestamptz NOT NULL,
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('processing', 'applied', 'duplicate', 'stale', 'premature', 'noop')),
  resulting_version bigint,
  processed_at timestamptz NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  UNIQUE (flight_id, milestone, expected_version),
  CHECK ((outcome = 'applied' AND resulting_version IS NOT NULL) OR outcome <> 'applied')
);

CREATE TABLE flight_transition_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id uuid NOT NULL REFERENCES dated_flights (id) ON DELETE RESTRICT,
  sequence bigint NOT NULL CHECK (sequence > 0),
  from_state text,
  to_state text NOT NULL CHECK (to_state IN
    ('scheduled', 'suspended', 'cancelled', 'delayed', 'boarding', 'departed', 'diverted', 'arrived', 'settled')),
  milestone text NOT NULL CHECK (milestone IN ('booking_lock', 'dispatch', 'arrival', 'settlement', 'automatic')),
  reason_code text NOT NULL CHECK (reason_code <> ''),
  explanation text NOT NULL CHECK (explanation <> ''),
  effective_at timestamptz NOT NULL,
  command_id uuid,
  expected_version bigint NOT NULL CHECK (expected_version >= 0),
  resulting_version bigint NOT NULL CHECK (resulting_version > expected_version),
  recorded_at timestamptz NOT NULL,
  UNIQUE (flight_id, sequence),
  UNIQUE (flight_id, command_id)
);

CREATE TABLE flight_material_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id uuid NOT NULL REFERENCES dated_flights (id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('booking_lock', 'dispatch', 'arrival')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  effective_at timestamptz NOT NULL,
  material_inputs jsonb NOT NULL CHECK (jsonb_typeof(material_inputs) = 'object'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (flight_id, stage)
);

CREATE TABLE flight_operational_results (
  flight_id uuid PRIMARY KEY REFERENCES dated_flights (id) ON DELETE RESTRICT,
  formula_version text NOT NULL CHECK (formula_version = 'flight-realization-v1'),
  seed text NOT NULL CHECK (seed <> ''),
  realized_block_minutes integer NOT NULL CHECK (realized_block_minutes BETWEEN 1 AND 2880),
  delay_minutes integer NOT NULL CHECK (delay_minutes BETWEEN 0 AND 720),
  diverted boolean NOT NULL,
  passengers_carried bigint NOT NULL CHECK (passengers_carried >= 0),
  fuel_burn_kg bigint NOT NULL CHECK (fuel_burn_kg > 0),
  passenger_revenue_minor bigint NOT NULL CHECK (passenger_revenue_minor >= 0),
  refund_minor bigint NOT NULL CHECK (refund_minor >= 0),
  airport_cost_minor bigint NOT NULL CHECK (airport_cost_minor >= 0),
  wage_allocation_minor bigint NOT NULL CHECK (wage_allocation_minor >= 0),
  maintenance_allocation_minor bigint NOT NULL CHECK (maintenance_allocation_minor >= 0),
  operating_result_minor bigint NOT NULL,
  result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  realized_at timestamptz NOT NULL
);

CREATE TABLE flight_settlement_journals (
  flight_id uuid NOT NULL REFERENCES dated_flights (id) ON DELETE RESTRICT,
  component text NOT NULL CHECK (component IN
    ('revenue', 'refund', 'airport_cost', 'wages', 'maintenance', 'fuel')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  journal_entry_id uuid REFERENCES journal_entries (id) ON DELETE RESTRICT,
  PRIMARY KEY (flight_id, component),
  UNIQUE (journal_entry_id)
);

CREATE TABLE settled_flight_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id uuid NOT NULL UNIQUE REFERENCES dated_flights (id) ON DELETE RESTRICT,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  material_inputs jsonb NOT NULL CHECK (jsonb_typeof(material_inputs) = 'object'),
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  aggregates jsonb NOT NULL CHECK (jsonb_typeof(aggregates) = 'object'),
  ruleset_versions jsonb NOT NULL CHECK (jsonb_typeof(ruleset_versions) = 'object'),
  reconciliation_references jsonb NOT NULL CHECK (jsonb_typeof(reconciliation_references) = 'object'),
  journal_entry_ids jsonb NOT NULL CHECK (jsonb_typeof(journal_entry_ids) = 'array'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  settled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (flight_id, content_hash)
);

CREATE FUNCTION reject_flight_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'flight snapshots and history are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER flight_transition_history_append_only BEFORE UPDATE OR DELETE ON flight_transition_history
  FOR EACH ROW EXECUTE FUNCTION reject_flight_history_mutation();
CREATE TRIGGER flight_material_snapshots_immutable BEFORE UPDATE OR DELETE ON flight_material_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_flight_history_mutation();
CREATE TRIGGER flight_operational_results_immutable BEFORE UPDATE OR DELETE ON flight_operational_results
  FOR EACH ROW EXECUTE FUNCTION reject_flight_history_mutation();
CREATE TRIGGER flight_settlement_journals_immutable BEFORE UPDATE OR DELETE ON flight_settlement_journals
  FOR EACH ROW EXECUTE FUNCTION reject_flight_history_mutation();
CREATE TRIGGER settled_flight_snapshots_immutable BEFORE UPDATE OR DELETE ON settled_flight_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_flight_history_mutation();

CREATE FUNCTION protect_dated_flight_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE legal boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dated flight history is immutable' USING ERRCODE = '55000';
  END IF;
  IF (OLD.route_id, OLD.timetable_version_id, OLD.flight_leg_template_id, OLD.rotation_id,
      OLD.aircraft_id, OLD.market_id, OLD.service_date, OLD.flight_number, OLD.origin_airport_id,
      OLD.destination_airport_id, OLD.departure_at, OLD.arrival_at, OLD.ready_at,
      OLD.planned_block_minutes, OLD.minimum_turnaround_minutes, OLD.ruleset_version,
      OLD.forecast_snapshot, OLD.created_at)
    IS DISTINCT FROM
     (NEW.route_id, NEW.timetable_version_id, NEW.flight_leg_template_id, NEW.rotation_id,
      NEW.aircraft_id, NEW.market_id, NEW.service_date, NEW.flight_number, NEW.origin_airport_id,
      NEW.destination_airport_id, NEW.departure_at, NEW.arrival_at, NEW.ready_at,
      NEW.planned_block_minutes, NEW.minimum_turnaround_minutes, NEW.ruleset_version,
      NEW.forecast_snapshot, NEW.created_at) THEN
    RAISE EXCEPTION 'dated flight schedule facts are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = OLD.status AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'flight mutation must accompany a lifecycle transition' USING ERRCODE = '55000';
  END IF;
  legal := (OLD.status = 'scheduled' AND NEW.status IN ('suspended','cancelled','delayed','boarding'))
    OR (OLD.status = 'suspended' AND NEW.status IN ('cancelled','delayed','boarding'))
    OR (OLD.status = 'delayed' AND NEW.status IN ('suspended','cancelled','boarding'))
    OR (OLD.status = 'boarding' AND NEW.status IN ('suspended','cancelled','delayed','departed'))
    OR (OLD.status = 'departed' AND NEW.status IN ('diverted','arrived'))
    OR (OLD.status = 'diverted' AND NEW.status = 'arrived')
    OR (OLD.status IN ('arrived','cancelled') AND NEW.status = 'settled');
  IF NOT legal THEN RAISE EXCEPTION 'illegal flight lifecycle transition' USING ERRCODE = '23514'; END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'flight optimistic version must advance exactly once' USING ERRCODE = '40001';
  END IF;
  IF NEW.state_effective_at < OLD.state_effective_at THEN
    RAISE EXCEPTION 'flight effective time must be monotonic' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dated_flights_lifecycle_guard BEFORE UPDATE OR DELETE ON dated_flights
  FOR EACH ROW EXECUTE FUNCTION protect_dated_flight_lifecycle();

CREATE FUNCTION bootstrap_flight_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target timestamptz := NEW.departure_at - INTERVAL '30 minutes';
DECLARE milestone_command uuid := gen_random_uuid();
BEGIN
  INSERT INTO flight_transition_history
    (flight_id, sequence, from_state, to_state, milestone, reason_code, explanation,
     effective_at, expected_version, resulting_version, recorded_at)
  VALUES (NEW.id, 1, NULL, NEW.status, 'automatic', 'flight_generated',
    'Dated flight generated from an active immutable timetable version.', NEW.created_at, 0, 1, NEW.created_at);
  INSERT INTO simulation_milestones
    (entity_type, entity_id, expected_version, handler_kind, handler_version, target_time,
     command_id, correlation_id, causation_id, routing)
  VALUES ('dated_flight', NEW.id, 1, 'flight.booking_lock', 1, target,
    milestone_command, gen_random_uuid(), gen_random_uuid(), jsonb_build_object('source','flight_lifecycle'))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dated_flight_lifecycle_bootstrap AFTER INSERT ON dated_flights
  FOR EACH ROW EXECUTE FUNCTION bootstrap_flight_lifecycle();

INSERT INTO flight_transition_history
  (flight_id, sequence, from_state, to_state, milestone, reason_code, explanation,
   effective_at, expected_version, resulting_version, recorded_at)
SELECT id, 1, NULL, status, 'automatic', 'flight_generated',
  'Dated flight existed before lifecycle activation.', created_at, 0, 1, created_at FROM dated_flights
ON CONFLICT DO NOTHING;
INSERT INTO simulation_milestones
  (entity_type, entity_id, expected_version, handler_kind, handler_version, target_time,
   command_id, correlation_id, causation_id, routing)
SELECT 'dated_flight', id, version, 'flight.booking_lock', 1, departure_at - INTERVAL '30 minutes',
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), jsonb_build_object('source','flight_lifecycle')
FROM dated_flights WHERE status IN ('scheduled','delayed','suspended') ON CONFLICT DO NOTHING;

CREATE INDEX dated_flights_lifecycle_due_idx ON dated_flights (state_effective_at, id)
  WHERE status <> 'settled';
CREATE INDEX flight_transition_timeline_idx ON flight_transition_history (flight_id, sequence);

COMMENT ON TABLE settled_flight_snapshots IS
  'Immutable versioned explanation record containing every material input, output, ledger and resource reconciliation reference.';
