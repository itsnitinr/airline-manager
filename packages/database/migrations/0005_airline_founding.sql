CREATE TABLE founding_balance_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (version ~ '^[a-z0-9][a-z0-9._-]+$'),
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active', 'retired')),
  founder_equity_minor jsonb NOT NULL CHECK (jsonb_typeof(founder_equity_minor) = 'object'),
  founding_loan_principal_minor jsonb NOT NULL CHECK (jsonb_typeof(founding_loan_principal_minor) = 'object'),
  founding_loan_annual_rate_basis_points integer NOT NULL
    CHECK (founding_loan_annual_rate_basis_points BETWEEN 0 AND 10000),
  founding_loan_term_days integer NOT NULL CHECK (founding_loan_term_days > 0),
  founding_loan_installment_count integer NOT NULL CHECK (founding_loan_installment_count > 0),
  baseline_daily_obligation_minor jsonb NOT NULL
    CHECK (jsonb_typeof(baseline_daily_obligation_minor) = 'object'),
  forecast_horizon_days integer NOT NULL CHECK (forecast_horizon_days BETWEEN 1 AND 3650),
  assumptions jsonb NOT NULL CHECK (jsonb_typeof(assumptions) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (world_ruleset_id, version)
);

CREATE UNIQUE INDEX founding_balance_one_active_per_ruleset_idx
  ON founding_balance_versions (world_ruleset_id) WHERE status = 'active';

CREATE FUNCTION reject_founding_balance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'founding balance versions are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER founding_balance_versions_immutable
  BEFORE UPDATE OR DELETE ON founding_balance_versions
  FOR EACH ROW EXECUTE FUNCTION reject_founding_balance_mutation();

CREATE TABLE game_worlds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]+$'),
  catalog_release_id uuid NOT NULL REFERENCES catalog_releases (id) ON DELETE RESTRICT,
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE careers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_account_id uuid NOT NULL REFERENCES player_accounts (id) ON DELETE RESTRICT,
  game_world_id uuid NOT NULL REFERENCES game_worlds (id) ON DELETE RESTRICT,
  catalog_release_id uuid NOT NULL REFERENCES catalog_releases (id) ON DELETE RESTRICT,
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  founding_balance_version_id uuid NOT NULL REFERENCES founding_balance_versions (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'insolvent', 'closed')),
  founded_at timestamptz NOT NULL,
  ended_at timestamptz,
  CHECK ((status = 'active' AND ended_at IS NULL) OR (status <> 'active' AND ended_at IS NOT NULL))
);

CREATE UNIQUE INDEX careers_one_active_per_player_idx
  ON careers (player_account_id) WHERE status = 'active';

CREATE FUNCTION protect_career_version_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.player_account_id, OLD.game_world_id, OLD.catalog_release_id,
      OLD.world_ruleset_id, OLD.founding_balance_version_id, OLD.founded_at)
    IS DISTINCT FROM
     (NEW.player_account_id, NEW.game_world_id, NEW.catalog_release_id,
      NEW.world_ruleset_id, NEW.founding_balance_version_id, NEW.founded_at) THEN
    RAISE EXCEPTION 'career ownership and published version bindings are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER careers_immutable_bindings
  BEFORE UPDATE ON careers FOR EACH ROW EXECUTE FUNCTION protect_career_version_binding();

CREATE TABLE airlines (
  id uuid PRIMARY KEY,
  career_id uuid NOT NULL UNIQUE REFERENCES careers (id) ON DELETE RESTRICT,
  game_world_id uuid NOT NULL REFERENCES game_worlds (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (name <> ''),
  normalized_name text NOT NULL CHECK (normalized_name <> ''),
  fictional_identity_confirmed boolean NOT NULL CHECK (fictional_identity_confirmed),
  home_jurisdiction char(2) NOT NULL CHECK (home_jurisdiction ~ '^[A-Z]{2}$'),
  principal_base_airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  reporting_currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  brand jsonb NOT NULL CHECK (jsonb_typeof(brand) = 'object'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'insolvent', 'closed')),
  founded_at timestamptz NOT NULL,
  ended_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (game_world_id, normalized_name),
  CHECK ((status = 'active' AND ended_at IS NULL) OR (status <> 'active' AND ended_at IS NOT NULL))
);

CREATE TABLE airline_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_id uuid NOT NULL REFERENCES airlines (id) ON DELETE RESTRICT,
  airport_id uuid NOT NULL REFERENCES curated_airports (id) ON DELETE RESTRICT,
  station_role text NOT NULL CHECK (station_role = 'principal_base'),
  service_model text NOT NULL CHECK (service_model = 'outsourced'),
  facility_investment_minor bigint NOT NULL DEFAULT 0 CHECK (facility_investment_minor = 0),
  opened_at timestamptz NOT NULL,
  UNIQUE (airline_id, airport_id),
  UNIQUE (airline_id, station_role)
);

CREATE TABLE founder_financing_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  career_id uuid NOT NULL UNIQUE REFERENCES careers (id) ON DELETE RESTRICT,
  balance_version_id uuid NOT NULL REFERENCES founding_balance_versions (id) ON DELETE RESTRICT,
  currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  founder_equity_minor bigint NOT NULL CHECK (founder_equity_minor > 0),
  loan_principal_minor bigint NOT NULL CHECK (loan_principal_minor > 0),
  annual_rate_basis_points integer NOT NULL CHECK (annual_rate_basis_points BETWEEN 0 AND 10000),
  term_days integer NOT NULL CHECK (term_days > 0),
  installment_count integer NOT NULL CHECK (installment_count > 0),
  selection text NOT NULL CHECK (selection IN ('accepted', 'declined')),
  selected_at timestamptz NOT NULL
);

CREATE TABLE founding_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financing_offer_id uuid NOT NULL UNIQUE REFERENCES founder_financing_offers (id) ON DELETE RESTRICT,
  airline_id uuid NOT NULL UNIQUE REFERENCES airlines (id) ON DELETE RESTRICT,
  currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  original_principal_minor bigint NOT NULL CHECK (original_principal_minor > 0),
  outstanding_principal_minor bigint NOT NULL CHECK (outstanding_principal_minor >= 0),
  annual_rate_basis_points integer NOT NULL CHECK (annual_rate_basis_points BETWEEN 0 AND 10000),
  term_days integer NOT NULL CHECK (term_days > 0),
  installment_count integer NOT NULL CHECK (installment_count > 0),
  starts_at timestamptz NOT NULL,
  matures_at timestamptz NOT NULL CHECK (matures_at > starts_at),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'repaid', 'defaulted'))
);

CREATE TABLE founding_loan_schedule (
  loan_id uuid NOT NULL REFERENCES founding_loans (id) ON DELETE RESTRICT,
  installment_number integer NOT NULL CHECK (installment_number > 0),
  due_at timestamptz NOT NULL,
  principal_minor bigint NOT NULL CHECK (principal_minor > 0),
  interest_minor bigint NOT NULL CHECK (interest_minor >= 0),
  total_minor bigint GENERATED ALWAYS AS (principal_minor + interest_minor) STORED,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'paid', 'overdue')),
  PRIMARY KEY (loan_id, installment_number)
);

CREATE INDEX founding_loan_schedule_due_idx
  ON founding_loan_schedule (due_at, loan_id) WHERE status IN ('scheduled', 'overdue');

COMMENT ON TABLE careers IS
  'Player-account career history is retained independently from airline closure or insolvency.';
COMMENT ON TABLE airline_stations IS
  'Ticket 08 permits exactly one outsourced principal-base presence and no station investment.';
COMMENT ON TABLE founding_balance_versions IS
  'Versioned balance data for founding capital, credit, baseline obligations, and runway assumptions.';
COMMENT ON TABLE founding_loan_schedule IS
  'Deterministic strategic-term schedule in real days; it does not accelerate operational time.';
