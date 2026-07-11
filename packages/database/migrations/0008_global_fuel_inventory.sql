CREATE TABLE fuel_ruleset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_ruleset_id uuid NOT NULL REFERENCES world_rulesets (id) ON DELETE RESTRICT,
  version text NOT NULL UNIQUE CHECK (version ~ '^[a-z0-9][a-z0-9._-]+$'),
  status text NOT NULL CHECK (status IN ('draft', 'active')),
  price_formula_version text NOT NULL CHECK (price_formula_version <> ''),
  time_bucket_minutes integer NOT NULL CHECK (time_bucket_minutes > 0),
  quote_ttl_seconds integer NOT NULL CHECK (quote_ttl_seconds > 0),
  world_seed text NOT NULL CHECK (world_seed <> ''),
  base_price_per_tonne_minor jsonb NOT NULL CHECK (jsonb_typeof(base_price_per_tonne_minor) = 'object'),
  volatility_basis_points integer NOT NULL CHECK (volatility_basis_points BETWEEN 0 AND 5000),
  minimum_reserve_kg bigint NOT NULL CHECK (minimum_reserve_kg >= 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at timestamptz,
  UNIQUE (world_ruleset_id, version),
  CHECK ((status = 'draft' AND activated_at IS NULL) OR (status = 'active' AND activated_at IS NOT NULL))
);

CREATE UNIQUE INDEX fuel_ruleset_one_active_idx
  ON fuel_ruleset_versions (world_ruleset_id) WHERE status = 'active';

CREATE TABLE fuel_capacity_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_ruleset_version_id uuid NOT NULL REFERENCES fuel_ruleset_versions (id) ON DELETE RESTRICT,
  tier integer NOT NULL CHECK (tier > 0),
  capacity_kg bigint NOT NULL CHECK (capacity_kg > 0),
  upgrade_price_minor jsonb NOT NULL CHECK (jsonb_typeof(upgrade_price_minor) = 'object'),
  UNIQUE (fuel_ruleset_version_id, tier),
  UNIQUE (fuel_ruleset_version_id, capacity_kg)
);

CREATE TABLE airline_fuel_inventories (
  airline_id uuid PRIMARY KEY REFERENCES airlines (id) ON DELETE RESTRICT,
  fuel_ruleset_version_id uuid NOT NULL REFERENCES fuel_ruleset_versions (id) ON DELETE RESTRICT,
  capacity_tier_id uuid NOT NULL REFERENCES fuel_capacity_tiers (id) ON DELETE RESTRICT,
  on_hand_kg bigint NOT NULL DEFAULT 0 CHECK (on_hand_kg >= 0),
  planning_reserved_kg bigint NOT NULL DEFAULT 0 CHECK (planning_reserved_kg >= 0),
  inventory_value_minor bigint NOT NULL DEFAULT 0 CHECK (inventory_value_minor >= 0),
  minimum_reserve_kg bigint NOT NULL DEFAULT 0 CHECK (minimum_reserve_kg >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (planning_reserved_kg <= on_hand_kg)
);

CREATE TABLE fuel_capacity_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_id uuid NOT NULL REFERENCES airline_fuel_inventories (airline_id) ON DELETE RESTRICT,
  from_tier_id uuid REFERENCES fuel_capacity_tiers (id) ON DELETE RESTRICT,
  to_tier_id uuid NOT NULL REFERENCES fuel_capacity_tiers (id) ON DELETE RESTRICT,
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  ledger_journal_entry_id uuid REFERENCES journal_entries (id) ON DELETE RESTRICT,
  source_idempotency_key text NOT NULL CHECK (source_idempotency_key <> ''),
  applied_at timestamptz NOT NULL,
  UNIQUE (airline_id, source_idempotency_key)
);

CREATE TABLE fuel_purchase_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_id uuid NOT NULL REFERENCES airlines (id) ON DELETE RESTRICT,
  fuel_ruleset_version_id uuid NOT NULL REFERENCES fuel_ruleset_versions (id) ON DELETE RESTRICT,
  price_formula_version text NOT NULL,
  time_bucket_start timestamptz NOT NULL,
  quantity_kg bigint NOT NULL CHECK (quantity_kg > 0),
  currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  unit_price_numerator bigint NOT NULL CHECK (unit_price_numerator > 0),
  unit_price_denominator bigint NOT NULL CHECK (unit_price_denominator > 0),
  total_price_minor bigint NOT NULL CHECK (total_price_minor > 0),
  exchange_rate_import_id uuid REFERENCES exchange_rate_imports (id) ON DELETE RESTRICT,
  exchange_rate_numerator bigint NOT NULL CHECK (exchange_rate_numerator > 0),
  exchange_rate_denominator bigint NOT NULL CHECK (exchange_rate_denominator > 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (accepted_at IS NULL OR accepted_at <= expires_at)
);

CREATE INDEX fuel_purchase_quotes_airline_time_idx
  ON fuel_purchase_quotes (airline_id, created_at DESC, id);

CREATE TABLE fuel_purchase_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_id uuid NOT NULL REFERENCES airline_fuel_inventories (airline_id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL UNIQUE REFERENCES fuel_purchase_quotes (id) ON DELETE RESTRICT,
  quantity_kg bigint NOT NULL CHECK (quantity_kg > 0),
  cost_basis_minor bigint NOT NULL CHECK (cost_basis_minor > 0),
  currency char(3) NOT NULL REFERENCES currencies (code) ON DELETE RESTRICT,
  unit_price_numerator bigint NOT NULL CHECK (unit_price_numerator > 0),
  unit_price_denominator bigint NOT NULL CHECK (unit_price_denominator > 0),
  price_formula_version text NOT NULL,
  fuel_ruleset_version text NOT NULL,
  exchange_rate_import_id uuid REFERENCES exchange_rate_imports (id) ON DELETE RESTRICT,
  exchange_rate_numerator bigint NOT NULL CHECK (exchange_rate_numerator > 0),
  exchange_rate_denominator bigint NOT NULL CHECK (exchange_rate_denominator > 0),
  purchased_at timestamptz NOT NULL,
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  ledger_journal_entry_id uuid NOT NULL REFERENCES journal_entries (id) ON DELETE RESTRICT,
  source_idempotency_key text NOT NULL,
  UNIQUE (airline_id, source_idempotency_key)
);

CREATE TABLE fuel_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_id uuid NOT NULL REFERENCES airline_fuel_inventories (airline_id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN
    ('purchase', 'consumption', 'reservation', 'release', 'correction', 'reversal', 'capacity_adjustment')),
  quantity_delta_kg bigint NOT NULL,
  reserved_delta_kg bigint NOT NULL DEFAULT 0,
  inventory_value_delta_minor bigint NOT NULL,
  balance_after_kg bigint NOT NULL CHECK (balance_after_kg >= 0),
  reserved_after_kg bigint NOT NULL CHECK (reserved_after_kg >= 0),
  inventory_value_after_minor bigint NOT NULL CHECK (inventory_value_after_minor >= 0),
  source_type text NOT NULL CHECK (source_type <> ''),
  source_id text NOT NULL CHECK (source_id <> ''),
  source_idempotency_key text NOT NULL CHECK (source_idempotency_key <> ''),
  reverses_movement_id uuid REFERENCES fuel_inventory_movements (id) ON DELETE RESTRICT,
  purchase_lot_id uuid REFERENCES fuel_purchase_lots (id) ON DELETE RESTRICT,
  ledger_journal_entry_id uuid REFERENCES journal_entries (id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (airline_id, source_type, source_idempotency_key),
  CHECK (reserved_after_kg <= balance_after_kg)
);

CREATE INDEX fuel_movements_airline_time_idx
  ON fuel_inventory_movements (airline_id, occurred_at DESC, id DESC);

CREATE FUNCTION reject_fuel_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fuel audit records are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER fuel_capacity_history_immutable BEFORE UPDATE OR DELETE ON fuel_capacity_history
  FOR EACH ROW EXECUTE FUNCTION reject_fuel_audit_mutation();
CREATE TRIGGER fuel_purchase_lots_immutable BEFORE UPDATE OR DELETE ON fuel_purchase_lots
  FOR EACH ROW EXECUTE FUNCTION reject_fuel_audit_mutation();
CREATE TRIGGER fuel_inventory_movements_immutable BEFORE UPDATE OR DELETE ON fuel_inventory_movements
  FOR EACH ROW EXECUTE FUNCTION reject_fuel_audit_mutation();

COMMENT ON TABLE airline_fuel_inventories IS
  'One airline-wide fungible inventory. Integer kilograms are canonical because mass is stable across temperature and avoids floating-point volume conversion.';
COMMENT ON TABLE fuel_purchase_lots IS
  'Immutable acquisition provenance. Remaining quantity and value are derived from append-only movements under perpetual weighted-average valuation.';
COMMENT ON TABLE fuel_inventory_movements IS
  'Append-only physical and valuation audit trail; authoritative totals are updated atomically on airline_fuel_inventories.';
