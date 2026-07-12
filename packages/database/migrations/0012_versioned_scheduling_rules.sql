CREATE TABLE scheduling_ruleset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  version text NOT NULL UNIQUE CHECK (version ~ '^[a-z0-9][a-z0-9._-]+$'),
  status text NOT NULL CHECK (status IN ('draft', 'active')),
  effective_from timestamptz NOT NULL,
  block_time_formula_version text NOT NULL CHECK (block_time_formula_version <> ''),
  operating_cost_formula_version text NOT NULL CHECK (operating_cost_formula_version <> ''),
  turnaround_formula_version text NOT NULL CHECK (turnaround_formula_version <> ''),
  default_horizon_days integer NOT NULL CHECK (default_horizon_days BETWEEN 7 AND 90),
  maximum_horizon_days integer NOT NULL CHECK (maximum_horizon_days BETWEEN default_horizon_days AND 90),
  assumptions jsonb NOT NULL CHECK (jsonb_typeof(assumptions) = 'object'),
  activated_at timestamptz,
  UNIQUE (world_ruleset_id, version),
  CHECK ((status = 'draft' AND activated_at IS NULL) OR (status = 'active' AND activated_at IS NOT NULL))
);

CREATE UNIQUE INDEX scheduling_ruleset_one_active_idx
  ON scheduling_ruleset_versions (world_ruleset_id) WHERE status = 'active';

CREATE TABLE airport_scheduling_rules (
  scheduling_ruleset_version_id uuid NOT NULL REFERENCES scheduling_ruleset_versions (id) ON DELETE RESTRICT,
  airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  outsourced_service_eligible boolean NOT NULL,
  hourly_movement_ceiling integer NOT NULL CHECK (hourly_movement_ceiling > 0),
  curfew_starts_local time,
  curfew_ends_local time,
  congestion_fee_basis_points integer NOT NULL DEFAULT 0 CHECK (congestion_fee_basis_points BETWEEN 0 AND 10000),
  minimum_turnaround_adjustment_minutes integer NOT NULL DEFAULT 0 CHECK (minimum_turnaround_adjustment_minutes >= 0),
  PRIMARY KEY (scheduling_ruleset_version_id, airport_id),
  CHECK ((curfew_starts_local IS NULL) = (curfew_ends_local IS NULL)),
  CHECK (curfew_starts_local IS NULL OR curfew_starts_local <> curfew_ends_local)
);

CREATE FUNCTION reject_active_scheduling_rules_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_version_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'scheduling_ruleset_versions' THEN
    target_version_id := OLD.id;
  ELSE
    target_version_id := OLD.scheduling_ruleset_version_id;
  END IF;
  IF EXISTS (SELECT 1 FROM scheduling_ruleset_versions WHERE id = target_version_id AND status = 'active') THEN
    RAISE EXCEPTION 'active scheduling rules are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scheduling_ruleset_immutable BEFORE UPDATE OR DELETE ON scheduling_ruleset_versions
  FOR EACH ROW WHEN (OLD.status = 'active') EXECUTE FUNCTION reject_active_scheduling_rules_mutation();
CREATE TRIGGER airport_scheduling_rules_immutable BEFORE UPDATE OR DELETE ON airport_scheduling_rules
  FOR EACH ROW EXECUTE FUNCTION reject_active_scheduling_rules_mutation();

CREATE OR REPLACE FUNCTION protect_committed_dated_flight() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('sold', 'in_progress', 'settled') THEN
    RAISE EXCEPTION 'commercially committed and historical flights cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
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
  IF NOT ((OLD.status = 'scheduled' AND NEW.status IN ('scheduled','sold','in_progress','cancelled'))
    OR (OLD.status = 'sold' AND NEW.status IN ('sold','in_progress'))
    OR (OLD.status = 'in_progress' AND NEW.status IN ('in_progress','settled'))
    OR (OLD.status = 'settled' AND NEW.status = 'settled')
    OR (OLD.status = 'cancelled' AND NEW.status = 'cancelled')) THEN
    RAISE EXCEPTION 'dated flight status transition is not monotonic' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON TABLE scheduling_ruleset_versions IS
  'Effective, versioned balance/derived scheduling semantics; active versions are immutable.';
COMMENT ON TABLE airport_scheduling_rules IS
  'Data-driven outsourced-service, curfew, congestion-ceiling, fee, and turnaround rules without player-owned slots.';
