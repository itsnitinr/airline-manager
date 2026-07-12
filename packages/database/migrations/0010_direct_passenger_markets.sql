CREATE TABLE market_ruleset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  version text NOT NULL UNIQUE CHECK (version ~ '^[a-z0-9][a-z0-9._-]+$'),
  status text NOT NULL CHECK (status IN ('draft', 'active')),
  demand_formula_version text NOT NULL CHECK (demand_formula_version <> ''),
  competition_formula_version text NOT NULL CHECK (competition_formula_version <> ''),
  pricing_formula_version text NOT NULL CHECK (pricing_formula_version <> ''),
  world_seed text NOT NULL CHECK (world_seed <> ''),
  reference_fare_per_nm_minor jsonb NOT NULL CHECK (jsonb_typeof(reference_fare_per_nm_minor) = 'object'),
  minimum_reference_fare_minor jsonb NOT NULL CHECK (jsonb_typeof(minimum_reference_fare_minor) = 'object'),
  assumptions jsonb NOT NULL CHECK (jsonb_typeof(assumptions) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at timestamptz,
  UNIQUE (world_ruleset_id, version),
  CHECK ((status = 'draft' AND activated_at IS NULL) OR (status = 'active' AND activated_at IS NOT NULL))
);

CREATE UNIQUE INDEX market_ruleset_one_active_idx
  ON market_ruleset_versions (world_ruleset_id) WHERE status = 'active';

CREATE TABLE passenger_markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_world_id uuid NOT NULL REFERENCES game_worlds (id) ON DELETE RESTRICT,
  catalog_release_id uuid NOT NULL REFERENCES catalog_releases (id) ON DELETE RESTRICT,
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  market_ruleset_version_id uuid NOT NULL REFERENCES market_ruleset_versions (id) ON DELETE RESTRICT,
  origin_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  destination_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  stable_seed text NOT NULL CHECK (stable_seed <> ''),
  created_at timestamptz NOT NULL,
  UNIQUE (game_world_id, origin_airport_id, destination_airport_id, market_ruleset_version_id),
  CHECK (origin_airport_id <> destination_airport_id)
);

CREATE INDEX passenger_markets_pair_idx
  ON passenger_markets (game_world_id, origin_airport_id, destination_airport_id);

CREATE TABLE passenger_market_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES passenger_markets (id) ON DELETE RESTRICT,
  generated_at timestamptz NOT NULL,
  demand_formula_version text NOT NULL,
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  forecast jsonb NOT NULL CHECK (jsonb_typeof(forecast) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (market_id, generated_at, demand_formula_version)
);

CREATE TABLE market_competition_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES passenger_markets (id) ON DELETE RESTRICT,
  bucket text NOT NULL CHECK (bucket ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  as_of timestamptz NOT NULL,
  competition_formula_version text NOT NULL,
  classification text NOT NULL CHECK (classification = 'simulated_aggregate_market_pressure'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  UNIQUE (market_id, bucket, competition_formula_version)
);

CREATE TABLE pricing_strategy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_id uuid NOT NULL REFERENCES airlines (id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES passenger_markets (id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  posture text NOT NULL CHECK (posture IN ('value', 'balanced', 'yield')),
  currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  base_fare_minor bigint NOT NULL CHECK (base_fare_minor > 0),
  minimum_fare_minor bigint NOT NULL CHECK (minimum_fare_minor > 0),
  maximum_fare_minor bigint NOT NULL CHECK (maximum_fare_minor >= minimum_fare_minor),
  load_factor_target_basis_points integer NOT NULL CHECK (load_factor_target_basis_points BETWEEN 1000 AND 10000),
  revenue_target_minor bigint NOT NULL CHECK (revenue_target_minor >= 0),
  pricing_formula_version text NOT NULL CHECK (pricing_formula_version <> ''),
  recommendation text NOT NULL CHECK (recommendation <> ''),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (airline_id, market_id, version),
  UNIQUE (airline_id, market_id, effective_from),
  CHECK (base_fare_minor BETWEEN minimum_fare_minor AND maximum_fare_minor),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX pricing_strategy_effective_idx
  ON pricing_strategy_versions (airline_id, market_id, effective_from DESC);

CREATE TABLE commercial_flight_offers (
  id uuid PRIMARY KEY,
  airline_id uuid NOT NULL REFERENCES airlines (id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES passenger_markets (id) ON DELETE RESTRICT,
  economy_sellable_capacity integer NOT NULL CHECK (economy_sellable_capacity > 0),
  booking_opens_at timestamptz NOT NULL,
  departure_at timestamptz NOT NULL,
  scheduled_arrival_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  schedule_quality_basis_points integer NOT NULL CHECK (schedule_quality_basis_points BETWEEN 0 AND 10000),
  service_quality_basis_points integer NOT NULL CHECK (service_quality_basis_points BETWEEN 0 AND 10000),
  reputation_basis_points integer NOT NULL CHECK (reputation_basis_points BETWEEN 0 AND 10000),
  source_type text NOT NULL CHECK (source_type IN ('external_dated_flight', 'ticket11_fixture')),
  source_version text NOT NULL CHECK (source_version <> ''),
  source_reference text NOT NULL CHECK (source_reference <> ''),
  catalog_release_id uuid NOT NULL REFERENCES catalog_releases (id) ON DELETE RESTRICT,
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  market_ruleset_version_id uuid NOT NULL REFERENCES market_ruleset_versions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  last_checkpoint_at timestamptz NOT NULL,
  booked_passengers integer NOT NULL DEFAULT 0 CHECK (booked_passengers >= 0),
  realized_revenue_minor bigint NOT NULL DEFAULT 0 CHECK (realized_revenue_minor >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (airline_id, source_type, source_reference),
  CHECK (booking_opens_at < departure_at),
  CHECK (scheduled_arrival_at > departure_at),
  CHECK (last_checkpoint_at >= booking_opens_at AND last_checkpoint_at <= departure_at),
  CHECK (booked_passengers <= economy_sellable_capacity)
);

CREATE INDEX commercial_flight_offers_airline_departure_idx
  ON commercial_flight_offers (airline_id, departure_at, id);

CREATE TABLE booking_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES commercial_flight_offers (id) ON DELETE RESTRICT,
  interval_start timestamptz NOT NULL,
  interval_end timestamptz NOT NULL,
  pricing_strategy_id uuid NOT NULL REFERENCES pricing_strategy_versions (id) ON DELETE RESTRICT,
  pricing_strategy_version integer NOT NULL CHECK (pricing_strategy_version > 0),
  passengers_added integer NOT NULL CHECK (passengers_added >= 0),
  revenue_added_minor bigint NOT NULL CHECK (revenue_added_minor >= 0),
  cumulative_passengers integer NOT NULL CHECK (cumulative_passengers >= 0),
  cumulative_revenue_minor bigint NOT NULL CHECK (cumulative_revenue_minor >= 0),
  aggregates jsonb NOT NULL CHECK (jsonb_typeof(aggregates) = 'array'),
  material_input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(material_input_snapshot) = 'object'),
  source_idempotency_key text NOT NULL CHECK (source_idempotency_key <> ''),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (offer_id, interval_start, interval_end),
  UNIQUE (offer_id, source_idempotency_key),
  CHECK (interval_end > interval_start)
);

CREATE INDEX booking_checkpoints_offer_time_idx
  ON booking_checkpoints (offer_id, interval_end, id);

CREATE TABLE booking_aggregate_totals (
  offer_id uuid NOT NULL REFERENCES commercial_flight_offers (id) ON DELETE RESTRICT,
  segment text NOT NULL CHECK (segment IN ('business', 'leisure', 'vfr')),
  booking_class text NOT NULL CHECK (booking_class IN ('economy_saver', 'economy_standard', 'economy_flex')),
  passengers integer NOT NULL CHECK (passengers >= 0),
  revenue_minor bigint NOT NULL CHECK (revenue_minor >= 0),
  PRIMARY KEY (offer_id, segment, booking_class)
);

CREATE FUNCTION reject_market_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'market versions and booking history are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER market_ruleset_versions_immutable
  BEFORE UPDATE OR DELETE ON market_ruleset_versions
  FOR EACH ROW WHEN (OLD.status = 'active') EXECUTE FUNCTION reject_market_history_mutation();
CREATE TRIGGER passenger_market_forecasts_immutable
  BEFORE UPDATE OR DELETE ON passenger_market_forecasts
  FOR EACH ROW EXECUTE FUNCTION reject_market_history_mutation();
CREATE TRIGGER market_competition_snapshots_immutable
  BEFORE UPDATE OR DELETE ON market_competition_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_market_history_mutation();
CREATE TRIGGER pricing_strategy_versions_immutable
  BEFORE UPDATE OR DELETE ON pricing_strategy_versions
  FOR EACH ROW EXECUTE FUNCTION reject_market_history_mutation();
CREATE TRIGGER booking_checkpoints_immutable
  BEFORE UPDATE OR DELETE ON booking_checkpoints
  FOR EACH ROW EXECUTE FUNCTION reject_market_history_mutation();

COMMENT ON TABLE passenger_markets IS
  'Directed origin-destination travel markets bound to immutable playable catalog, world, and market-rule versions.';
COMMENT ON TABLE commercial_flight_offers IS
  'Ticket-11 commercial persistence boundary. The opaque id/source reference is supplied atomically by ticket 12; no route, timetable, rotation, or operational flight aggregate is defined here.';
COMMENT ON TABLE market_competition_snapshots IS
  'Deterministic simulated aggregate market pressure, not live data and not fully operated AI airlines.';
COMMENT ON TABLE booking_checkpoints IS
  'Append-only elapsed-time booking accrual and ticket-17 material-input snapshot. No ledger revenue is posted here.';
