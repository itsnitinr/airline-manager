CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE airline_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_id uuid NOT NULL REFERENCES airlines (id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES passenger_markets (id) ON DELETE RESTRICT,
  origin_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  destination_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  route_number integer NOT NULL CHECK (route_number > 0),
  distance_nm integer NOT NULL CHECK (distance_nm > 0),
  forecast_snapshot jsonb NOT NULL CHECK (jsonb_typeof(forecast_snapshot) = 'object'),
  ruleset_version text NOT NULL CHECK (ruleset_version <> ''),
  status text NOT NULL DEFAULT 'researched' CHECK (status IN ('researched', 'active')),
  created_at timestamptz NOT NULL,
  UNIQUE (airline_id, market_id),
  UNIQUE (airline_id, route_number),
  CHECK (origin_airport_id <> destination_airport_id)
);

CREATE TABLE timetable_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES airline_routes (id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL CHECK (status IN ('active', 'superseded')),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  ruleset_version text NOT NULL CHECK (ruleset_version <> ''),
  generated_through date NOT NULL,
  activated_at timestamptz NOT NULL,
  UNIQUE (route_id, version),
  UNIQUE (route_id, effective_from, input_hash),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX timetable_versions_one_active_idx
  ON timetable_versions (route_id) WHERE status = 'active';

CREATE TABLE flight_leg_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timetable_version_id uuid NOT NULL REFERENCES timetable_versions (id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  origin_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  destination_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  departure_local_time time NOT NULL,
  origin_timezone text NOT NULL CHECK (origin_timezone <> ''),
  destination_timezone text NOT NULL CHECK (destination_timezone <> ''),
  planned_block_minutes integer NOT NULL CHECK (planned_block_minutes > 0),
  minimum_turnaround_minutes integer NOT NULL CHECK (minimum_turnaround_minutes > 0),
  UNIQUE (timetable_version_id, sequence),
  CHECK (origin_airport_id <> destination_airport_id)
);

CREATE TABLE aircraft_rotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timetable_version_id uuid NOT NULL UNIQUE REFERENCES timetable_versions (id) ON DELETE RESTRICT,
  aircraft_id uuid NOT NULL REFERENCES aircraft (id) ON DELETE RESTRICT,
  initial_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  ruleset_version text NOT NULL CHECK (ruleset_version <> ''),
  activated_at timestamptz NOT NULL
);

CREATE TABLE rotation_leg_assignments (
  rotation_id uuid NOT NULL REFERENCES aircraft_rotations (id) ON DELETE RESTRICT,
  flight_leg_template_id uuid NOT NULL UNIQUE REFERENCES flight_leg_templates (id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  PRIMARY KEY (rotation_id, sequence)
);

CREATE TABLE dated_flights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES airline_routes (id) ON DELETE RESTRICT,
  timetable_version_id uuid NOT NULL REFERENCES timetable_versions (id) ON DELETE RESTRICT,
  flight_leg_template_id uuid NOT NULL REFERENCES flight_leg_templates (id) ON DELETE RESTRICT,
  rotation_id uuid NOT NULL REFERENCES aircraft_rotations (id) ON DELETE RESTRICT,
  aircraft_id uuid NOT NULL REFERENCES aircraft (id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES passenger_markets (id) ON DELETE RESTRICT,
  service_date date NOT NULL,
  flight_number text NOT NULL CHECK (flight_number ~ '^[A-Z0-9]{2,4}[0-9]{1,4}$'),
  origin_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  destination_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  departure_local text NOT NULL CHECK (departure_local <> ''),
  arrival_local text NOT NULL CHECK (arrival_local <> ''),
  departure_at timestamptz NOT NULL,
  arrival_at timestamptz NOT NULL,
  ready_at timestamptz NOT NULL,
  planned_block_minutes integer NOT NULL CHECK (planned_block_minutes > 0),
  minimum_turnaround_minutes integer NOT NULL CHECK (minimum_turnaround_minutes > 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sold', 'in_progress', 'settled', 'cancelled')),
  ruleset_version text NOT NULL CHECK (ruleset_version <> ''),
  forecast_snapshot jsonb NOT NULL CHECK (jsonb_typeof(forecast_snapshot) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (flight_leg_template_id, service_date),
  CHECK (arrival_at > departure_at AND ready_at > arrival_at),
  CHECK (origin_airport_id <> destination_airport_id)
);

ALTER TABLE dated_flights ADD CONSTRAINT dated_flights_aircraft_no_overlap
  EXCLUDE USING gist (
    aircraft_id WITH =,
    tstzrange(departure_at, ready_at, '[)') WITH &&
  ) WHERE (status <> 'cancelled');

CREATE INDEX dated_flights_horizon_idx ON dated_flights (timetable_version_id, service_date, id);
CREATE INDEX dated_flights_departure_idx ON dated_flights (departure_at, id) WHERE status <> 'cancelled';

CREATE FUNCTION protect_committed_dated_flight() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('sold', 'in_progress', 'settled') THEN
    IF TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'commercially committed and historical flights are immutable' USING ERRCODE = '55000';
    END IF;
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER dated_flights_history_guard BEFORE UPDATE OR DELETE ON dated_flights
  FOR EACH ROW EXECUTE FUNCTION protect_committed_dated_flight();

COMMENT ON TABLE timetable_versions IS
  'Effective-dated recurring weekly plans. New versions are prospective and do not rewrite dated-flight facts.';
COMMENT ON CONSTRAINT dated_flights_aircraft_no_overlap ON dated_flights IS
  'PostgreSQL-level physical aircraft occupancy protection, including required turnaround.';
COMMENT ON TABLE dated_flights IS
  'Bounded, retry-safe dated schedule instances. Ticket 16 later delivers their persisted outbox intents.';
